"""
Router del módulo 010-administracion — implementa 1:1 el contrato
el-kiosquito-010-administracion-contracts-openapi.yaml: auth, usuarios,
matriz de permisos, auditoría, parámetros globales versionados, ARCO y
los 5 catálogos de solo lectura de la enmienda v1.1.

Autorización: cada endpoint de negocio usa `require_permission(recurso,
operacion)`, que consulta `permiso_rol` en BD — nunca compara contra un
código de rol literal. `/admin/permisos` y `/admin/auditoria` no tienen
`recurso_sistema` propio (son datos sobre el propio sistema RBAC, no un
recurso de negocio auditable), así que se gatean con `require_dueno`
(nivel_jerarquico == 1), mismo criterio que `pregunta_asistente` en 011.

Enmienda v1.2 (2026-09-06, Tarea #58 del frontend — pantalla de
Administración): se agregó `GET /admin/usuarios` (RF-AD-015) — sin listado
no había forma de volver a encontrar un usuario ya registrado para
editarlo, reasignarle rol/sucursales o darlo de baja. Se verificó primero
la matriz RBAC real: `usuario/leer` ya estaba concedido a `dueno`,
`encargado_compras` y `encargado_sucursal` — sin migración nueva, mismo
patrón que RF-CF-013/RF-CP-017-018/RF-ES-013. De paso, `UsuarioOut` ganó
`sucursal_ids` (calculado desde `usuario_sucursal`, nunca una columna
propia) en las CUATRO respuestas que devuelven un usuario — sin esto, la
pantalla no podía mostrar con qué sucursales cuenta un usuario antes de
dejar editarlas, arriesgando vaciar su alcance sin querer (RN-AD-002/003).
También se completó `SolicitudArcoOut`, que no exponía `detalle` (el
texto real de lo que pidió el cliente) ni los tres campos que deja
`PATCH .../resolver` (`fecha_resolucion`, `atendida_por`, `respuesta`) —
sin `detalle` quien resuelve la solicitud ni siquiera puede leer qué se
pidió, y sin los otros tres una resolución exitosa no queda confirmada en
la propia respuesta (Art. 10.3).
"""

import csv
import io
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, log_accion, require_dueno, require_permission
from app.core.security import create_access_token, hash_password, verify_password
from app.database import get_db
from app.models.administracion import (
    EstadoSolicitudArco,
    LogAuditoria,
    HistorialParametroSistema,
    Operacion,
    PermisoRol,
    RecursoSistema,
    Rol,
    SolicitudArco,
    TipoSolicitudArco,
    Usuario,
    UsuarioSucursal,
)
from app.models.clientes import Cliente
from app.models.expansion import Sucursal
from app.schemas.administracion import (
    EstadoSolicitudArcoOut,
    LoginIn,
    OperacionOut,
    ParametroSistemaCrearIn,
    ParametroSistemaOut,
    PermisoRolOut,
    RecursoSistemaOut,
    RolOut,
    SolicitudArcoCrearIn,
    SolicitudArcoOut,
    SolicitudArcoResolverIn,
    TipoSolicitudArcoOut,
    TokenOut,
    UsuarioActualizarIn,
    UsuarioCrearIn,
    UsuarioOut,
    UsuarioRolSucursalesIn,
)

router = APIRouter()


def _usuario_out(db: Session, usuario: Usuario) -> UsuarioOut:
    """RF-AD-014-bis / Tarea #58 (enmienda v1.2). `sucursal_ids` no es una
    columna de `usuario` — se arma acá desde `usuario_sucursal` para que
    todo endpoint que devuelva un usuario (alta, edición, rol-sucursales,
    baja y el nuevo listado) muestre siempre su alcance real, nunca uno
    asumido u obsoleto."""
    sucursal_ids = [
        row.sucursal_id for row in db.query(UsuarioSucursal.sucursal_id).filter_by(usuario_id=usuario.id).all()
    ]
    return UsuarioOut(
        id=usuario.id,
        nombre=usuario.nombre,
        email=usuario.email,
        rol=usuario.rol,
        activo=usuario.activo,
        sucursal_ids=sorted(sucursal_ids),
    )


# ---------------------------------------------------------------------------
# Autenticación
# ---------------------------------------------------------------------------


@router.post("/auth/login", response_model=TokenOut, tags=["auth"])
def login(payload: LoginIn, request: Request, db: Session = Depends(get_db)) -> TokenOut:
    usuario = db.query(Usuario).filter(Usuario.email == payload.email).first()
    credenciales_validas = usuario is not None and usuario.activo and verify_password(
        payload.password, usuario.password_hash
    )
    if not credenciales_validas:
        # RF-AD-010: un intento fallido también queda en log_auditoria,
        # exitoso=false — incluso cuando el email no existe (usuario_id NULL).
        log_accion(
            db,
            usuario_id=usuario.id if usuario else None,
            accion="login",
            recurso="usuario",
            exitoso=False,
            request=request,
        )
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Credenciales inválidas")

    sucursal_ids = [
        row.sucursal_id
        for row in db.query(UsuarioSucursal.sucursal_id).filter_by(usuario_id=usuario.id).all()
    ]
    token = create_access_token(usuario_id=usuario.id, rol=usuario.rol, sucursal_ids=sucursal_ids)
    log_accion(db, usuario_id=usuario.id, accion="login", recurso="usuario", exitoso=True, request=request)
    return TokenOut(access_token=token)


# ---------------------------------------------------------------------------
# Usuarios (OO-AD01, OO-AD02, OO-AD06)
# ---------------------------------------------------------------------------


@router.post(
    "/admin/usuarios",
    response_model=UsuarioOut,
    status_code=status.HTTP_201_CREATED,
    tags=["admin"],
)
def crear_usuario(
    payload: UsuarioCrearIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("usuario", "crear")),
) -> UsuarioOut:
    rol = db.get(Rol, payload.rol)
    if rol is None or not rol.activo:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Rol '{payload.rol}' no existe o está inactivo")
    if db.query(Usuario).filter_by(email=payload.email).first() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya existe un usuario con ese email")

    usuario = Usuario(
        nombre=payload.nombre,
        email=payload.email,
        password_hash=hash_password(payload.password),
        rol=payload.rol,
    )
    db.add(usuario)
    db.commit()
    db.refresh(usuario)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="crear_usuario",
        recurso="usuario",
        recurso_id=usuario.id,
        exitoso=True,
        request=request,
    )
    return _usuario_out(db, usuario)


@router.get("/admin/usuarios", response_model=list[UsuarioOut], tags=["admin"])
def listar_usuarios(
    rol: str | None = Query(None, description="Filtrar por código de rol; si se omite, trae todos"),
    activo: bool | None = Query(None, description="Filtrar por activo/inactivo; si se omite, trae todos"),
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(require_permission("usuario", "leer")),
) -> list[UsuarioOut]:
    """RF-AD-015 (enmienda v1.2, Tarea #58 del frontend). Sin este listado
    no había forma de volver a encontrar un usuario ya registrado para
    editarlo, reasignarle rol/sucursales o darlo de baja — solo se podía
    dar de alta. Mismo patrón que RF-CF-013 (002), RF-CP-017/018 (008) y
    RF-ES-013 (009): se verificó primero la matriz RBAC real —
    `usuario/leer` ya estaba concedido a `dueno`, `encargado_compras` y
    `encargado_sucursal` (nunca a `cajero`) desde la migración inicial de
    este módulo, así que no hizo falta ninguna migración nueva."""
    query = db.query(Usuario)
    if rol is not None:
        query = query.filter(Usuario.rol == rol)
    if activo is not None:
        query = query.filter(Usuario.activo == activo)
    usuarios = query.order_by(Usuario.nombre).all()
    return [_usuario_out(db, usuario) for usuario in usuarios]


@router.patch("/admin/usuarios/{usuario_id}", response_model=UsuarioOut, tags=["admin"])
def actualizar_usuario(
    usuario_id: int,
    payload: UsuarioActualizarIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("usuario", "actualizar")),
) -> UsuarioOut:
    usuario = db.get(Usuario, usuario_id)
    if usuario is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuario no encontrado")

    if payload.nombre is not None:
        usuario.nombre = payload.nombre
    if payload.email is not None:
        usuario.email = payload.email
    db.commit()
    db.refresh(usuario)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="actualizar_usuario",
        recurso="usuario",
        recurso_id=usuario.id,
        exitoso=True,
        request=request,
    )
    return _usuario_out(db, usuario)


@router.patch("/admin/usuarios/{usuario_id}/rol-sucursales", response_model=UsuarioOut, tags=["admin"])
def asignar_rol_y_sucursales(
    usuario_id: int,
    payload: UsuarioRolSucursalesIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("usuario", "actualizar")),
) -> UsuarioOut:
    usuario = db.get(Usuario, usuario_id)
    if usuario is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuario no encontrado")

    rol = db.get(Rol, payload.rol)
    if rol is None or not rol.activo:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Rol '{payload.rol}' no existe o está inactivo")

    # RN-AD-002: un rol sin alcance de cadena exige al menos una sucursal.
    # RN-AD-001: un rol con alcance_cadena ignora sucursal_ids si lo mandan.
    sucursal_ids: list[int] = []
    if not rol.alcance_cadena:
        if not payload.sucursal_ids:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "El rol requiere al menos una sucursal asignada (RN-AD-002)",
            )
        sucursal_ids = sorted(set(payload.sucursal_ids))
        encontradas = db.query(Sucursal.id).filter(Sucursal.id.in_(sucursal_ids)).count()
        if encontradas != len(sucursal_ids):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Una o más sucursales no existen")

    usuario.rol = payload.rol
    db.query(UsuarioSucursal).filter_by(usuario_id=usuario.id).delete()
    for sucursal_id in sucursal_ids:
        db.add(UsuarioSucursal(usuario_id=usuario.id, sucursal_id=sucursal_id))
    db.commit()
    db.refresh(usuario)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="asignar_rol_y_sucursales",
        recurso="usuario",
        recurso_id=usuario.id,
        exitoso=True,
        request=request,
        detalle={"rol": payload.rol, "sucursal_ids": sucursal_ids},
    )
    return _usuario_out(db, usuario)


@router.patch("/admin/usuarios/{usuario_id}/desactivar", response_model=UsuarioOut, tags=["admin"])
def desactivar_usuario(
    usuario_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("usuario", "actualizar")),
) -> UsuarioOut:
    usuario = db.get(Usuario, usuario_id)
    if usuario is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuario no encontrado")

    usuario.activo = False
    db.commit()
    db.refresh(usuario)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="desactivar_usuario",
        recurso="usuario",
        recurso_id=usuario.id,
        exitoso=True,
        request=request,
    )
    return _usuario_out(db, usuario)


# ---------------------------------------------------------------------------
# Matriz de permisos y auditoría (OO-AD03, OO-AD05) — dueño exclusivo
# ---------------------------------------------------------------------------


@router.get("/admin/permisos", response_model=list[PermisoRolOut], tags=["admin"])
def consultar_matriz_permisos(
    rol: str | None = Query(None),
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(require_dueno),
) -> list[PermisoRol]:
    query = db.query(PermisoRol)
    if rol is not None:
        query = query.filter(PermisoRol.rol == rol)
    return query.order_by(PermisoRol.rol, PermisoRol.recurso, PermisoRol.operacion).all()


@router.get("/admin/auditoria", tags=["admin"])
def consultar_auditoria(
    usuario_id: int | None = Query(None),
    sucursal_id: int | None = Query(None),
    desde: datetime | None = Query(None),
    hasta: datetime | None = Query(None),
    solo_anomalias: bool | None = Query(None),
    formato: str | None = Query(None, pattern="^(json|csv)$"),
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(require_dueno),
):
    query = db.query(LogAuditoria)
    if usuario_id is not None:
        query = query.filter(LogAuditoria.usuario_id == usuario_id)
    if sucursal_id is not None:
        query = query.filter(LogAuditoria.sucursal_id == sucursal_id)
    if desde is not None:
        query = query.filter(LogAuditoria.creado_en >= desde)
    if hasta is not None:
        query = query.filter(LogAuditoria.creado_en <= hasta)
    if solo_anomalias:
        # Art. 10.5: filtra exitoso=false — los intentos fallidos/denegados.
        query = query.filter(LogAuditoria.exitoso.is_(False))
    filas = query.order_by(LogAuditoria.creado_en.desc()).all()

    if formato == "csv":
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(
            ["id", "usuario_id", "accion", "recurso", "recurso_id", "sucursal_id", "exitoso", "ip_origen", "creado_en"]
        )
        for fila in filas:
            writer.writerow(
                [
                    fila.id,
                    fila.usuario_id,
                    fila.accion,
                    fila.recurso,
                    fila.recurso_id,
                    fila.sucursal_id,
                    fila.exitoso,
                    fila.ip_origen,
                    fila.creado_en.isoformat(),
                ]
            )
        return Response(
            content=buffer.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=auditoria.csv"},
        )

    return [
        {
            "id": fila.id,
            "usuario_id": fila.usuario_id,
            "accion": fila.accion,
            "recurso": fila.recurso,
            "recurso_id": fila.recurso_id,
            "sucursal_id": fila.sucursal_id,
            "detalle": fila.detalle,
            "exitoso": fila.exitoso,
            "ip_origen": fila.ip_origen,
            "creado_en": fila.creado_en,
        }
        for fila in filas
    ]


# ---------------------------------------------------------------------------
# Parámetros globales versionados (OO-AD07)
# ---------------------------------------------------------------------------


@router.post(
    "/admin/parametros",
    response_model=ParametroSistemaOut,
    status_code=status.HTTP_201_CREATED,
    tags=["admin"],
)
def registrar_parametro_sistema(
    payload: ParametroSistemaCrearIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("parametro_sistema", "crear")),
) -> ParametroSistemaOut:
    # Append-only (mismo patrón que historial_costo_producto/historial_precio_
    # producto): nunca se hace UPDATE, el valor anterior queda como histórico.
    registro = HistorialParametroSistema(clave=payload.clave, valor=payload.valor, registrado_por=current_user.id)
    db.add(registro)
    db.commit()
    db.refresh(registro)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="registrar_parametro_sistema",
        recurso="parametro_sistema",
        recurso_id=registro.id,
        exitoso=True,
        request=request,
        detalle={"clave": payload.clave},
    )
    return ParametroSistemaOut(clave=registro.clave, valor=registro.valor, vigente_desde=registro.vigente_desde)


@router.get("/admin/parametros/{clave}", response_model=ParametroSistemaOut, tags=["admin"])
def consultar_parametro_vigente(
    clave: str,
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(require_permission("parametro_sistema", "leer")),
) -> ParametroSistemaOut:
    registro = (
        db.query(HistorialParametroSistema)
        .filter(HistorialParametroSistema.clave == clave)
        .order_by(HistorialParametroSistema.vigente_desde.desc())
        .first()
    )
    if registro is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"El parámetro '{clave}' nunca se ha registrado")
    return ParametroSistemaOut(clave=registro.clave, valor=registro.valor, vigente_desde=registro.vigente_desde)


# ---------------------------------------------------------------------------
# Solicitudes ARCO (Art. 10.3)
# ---------------------------------------------------------------------------


@router.post(
    "/admin/arco",
    response_model=SolicitudArcoOut,
    status_code=status.HTTP_201_CREATED,
    tags=["admin"],
)
def crear_solicitud_arco(
    payload: SolicitudArcoCrearIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("solicitud_arco", "crear")),
) -> SolicitudArco:
    cliente = db.get(Cliente, payload.cliente_id)
    if cliente is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cliente no encontrado")

    tipo = db.get(TipoSolicitudArco, payload.tipo)
    if tipo is None or not tipo.activo:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, f"Tipo de solicitud ARCO '{payload.tipo}' no existe o está inactivo"
        )

    solicitud = SolicitudArco(cliente_id=payload.cliente_id, tipo=payload.tipo, detalle=payload.detalle)
    db.add(solicitud)
    db.commit()
    db.refresh(solicitud)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="crear_solicitud_arco",
        recurso="solicitud_arco",
        recurso_id=solicitud.id,
        exitoso=True,
        request=request,
    )
    return solicitud


@router.get("/admin/arco", response_model=list[SolicitudArcoOut], tags=["admin"])
def listar_solicitudes_arco(
    estado: str | None = Query(None),
    solo_vencidas: bool = Query(False),
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(require_permission("solicitud_arco", "leer")),
) -> list[SolicitudArco]:
    query = db.query(SolicitudArco)
    if estado is not None:
        query = query.filter(SolicitudArco.estado == estado)
    if solo_vencidas:
        # RF-AD-013: pendientes cuya fecha_solicitud + tipo_solicitud_arco.
        # plazo_respuesta_dias ya pasó — el plazo es una columna, no un
        # literal, así que se resuelve con make_interval() en SQL.
        query = query.join(TipoSolicitudArco, SolicitudArco.tipo == TipoSolicitudArco.codigo).filter(
            SolicitudArco.estado == "pendiente",
            text(
                "solicitud_arco.fecha_solicitud + "
                "make_interval(days => tipo_solicitud_arco.plazo_respuesta_dias) < now()"
            ),
        )
    return query.order_by(SolicitudArco.fecha_solicitud.desc()).all()


@router.patch("/admin/arco/{solicitud_id}/resolver", response_model=SolicitudArcoOut, tags=["admin"])
def resolver_solicitud_arco(
    solicitud_id: int,
    payload: SolicitudArcoResolverIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("solicitud_arco", "actualizar")),
) -> SolicitudArco:
    solicitud = db.get(SolicitudArco, solicitud_id)
    if solicitud is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Solicitud ARCO no encontrada")

    estado = db.get(EstadoSolicitudArco, payload.estado)
    if estado is None or not estado.es_estado_final:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "El estado de resolución debe ser un estado final del catálogo estado_solicitud_arco",
        )

    solicitud.estado = payload.estado
    solicitud.respuesta = payload.respuesta
    solicitud.fecha_resolucion = datetime.now(timezone.utc).replace(tzinfo=None)
    solicitud.atendida_por = current_user.id
    db.commit()
    db.refresh(solicitud)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="resolver_solicitud_arco",
        recurso="solicitud_arco",
        recurso_id=solicitud.id,
        exitoso=True,
        request=request,
        detalle={"estado": payload.estado},
    )
    return solicitud


# ---------------------------------------------------------------------------
# Catálogos de solo lectura (RF-AD-014, enmienda v1.1) — cualquier usuario
# autenticado puede listarlos, sin permiso adicional: los consume el propio
# frontend para poblar selects de formularios.
# ---------------------------------------------------------------------------


@router.get("/catalogos/roles", response_model=list[RolOut], tags=["catalogos"])
def listar_roles(db: Session = Depends(get_db), _current_user: Usuario = Depends(get_current_user)) -> list[Rol]:
    return db.query(Rol).order_by(Rol.orden).all()


@router.get("/catalogos/recursos-sistema", response_model=list[RecursoSistemaOut], tags=["catalogos"])
def listar_recursos_sistema(
    modulo: str | None = Query(None),
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(get_current_user),
) -> list[RecursoSistema]:
    query = db.query(RecursoSistema)
    if modulo is not None:
        query = query.filter(RecursoSistema.modulo == modulo)
    return query.order_by(RecursoSistema.orden).all()


@router.get("/catalogos/operaciones", response_model=list[OperacionOut], tags=["catalogos"])
def listar_operaciones(
    db: Session = Depends(get_db), _current_user: Usuario = Depends(get_current_user)
) -> list[Operacion]:
    return db.query(Operacion).order_by(Operacion.orden).all()


@router.get("/catalogos/tipos-solicitud-arco", response_model=list[TipoSolicitudArcoOut], tags=["catalogos"])
def listar_tipos_solicitud_arco(
    db: Session = Depends(get_db), _current_user: Usuario = Depends(get_current_user)
) -> list[TipoSolicitudArco]:
    return db.query(TipoSolicitudArco).order_by(TipoSolicitudArco.orden).all()


@router.get("/catalogos/estados-solicitud-arco", response_model=list[EstadoSolicitudArcoOut], tags=["catalogos"])
def listar_estados_solicitud_arco(
    db: Session = Depends(get_db), _current_user: Usuario = Depends(get_current_user)
) -> list[EstadoSolicitudArco]:
    return db.query(EstadoSolicitudArco).order_by(EstadoSolicitudArco.orden).all()
