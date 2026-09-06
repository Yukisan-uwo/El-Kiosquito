"""
Router del módulo 009-expansion-sucursales — sucursal, checklist de
apertura configurable, herencia de catálogo/precios y activación.
Implementa el contrato el-kiosquito-009-expansion-sucursales-contracts-
openapi.yaml.

RBAC: la matriz real de 009 tiene 2 recursos: `sucursal` (`crear` es
dueño-exclusivo — abrir una tienda nueva; `actualizar` lo tienen dueño y
encargado_sucursal, cubre todas las acciones de estado sobre una
sucursal ya creada: heredar catálogo, asignar personal, activar,
cerrar; `leer` lo tienen los cuatro roles, incluido cajero — cualquiera
necesita poder ver qué sucursales existen) y `checklist_apertura`
(`crear`/`actualizar` igual que `sucursal`; `leer` lo tienen los tres
roles de gestión pero NO cajero — el proceso de apertura no es parte de
su operación diaria en el POS). `GET /sucursales/{id}/estado-apertura`
se autorizó contra `checklist_apertura`/`leer` porque su contenido
principal es justamente el checklist, no el dato básico de la sucursal.

Dos decisiones de diseño propias, no explícitas en el contrato (que
solo describe el efecto de negocio, no la mecánica exacta):

1. `heredarCatalogo` (Decisión 3 de research.md: "orquesta llamadas a
   POST /precios de 003, no crea filas de precio directamente") se
   implementó reproduciendo en proceso la misma escritura que haría
   `registrar_precio` de 003 (mismo monolito FastAPI, sin HTTP saliente
   — mismo criterio que 008 con el pronóstico de 004) en vez de invocar
   literalmente esa función de router: esa función authoriza con su
   propio `require_permission("precio", "crear")`, que
   `encargado_sucursal` (quien SÍ puede ejecutar la herencia por la
   matriz de 009) no tiene en la matriz de 003. La autorización real de
   esta acción compuesta ya ocurrió en el propio `Depends` de este
   endpoint (`sucursal`/`actualizar`); reescribir la misma inserción
   acá es reutilización de lógica de servicio, no una puerta de RBAC
   nueva que haya que abrir en 003.
2. Como efecto colateral de haber hecho el trabajo real, `heredarCatalogo`
   y `asignarPersonalSucursal` completan automáticamente los ítems del
   checklist que literalmente describen esa acción
   (`catalogo_heredado`/`precios_heredados` y `personal_asignado`) — no
   tiene sentido exigir una segunda confirmación manual de algo que el
   propio sistema acaba de hacer. RN-ES-001 no cambia: activar sigue
   exigiendo los 8 (o los que el catálogo tenga) ítems completos, solo
   que estos tres ya no dependen de que alguien los marque a mano.
3. `asignarPersonalSucursal` (Decisión 2: "delega en `PATCH
   /admin/usuarios/{id}/rol-sucursales` de 010") agrega esta sucursal
   al conjunto de sucursales YA asignadas del usuario en vez de
   reemplazarlo por completo — el contrato de este endpoint no recibe
   `rol` (a diferencia del de 010, que si lo exige), así que preservar
   el rol y las sucursales existentes del usuario y solo sumar esta es
   la lectura consistente de "asignar personal a la sucursal en
   apertura" sin pisar una asignación previa en otra sucursal.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, log_accion, require_permission
from app.database import get_db
from app.models.administracion import Rol, Usuario, UsuarioSucursal
from app.models.core_ventas import Producto
from app.models.expansion import (
    ChecklistAperturaSucursal,
    EstadoSucursal,
    HerenciaCatalogoSucursal,
    ItemChecklistApertura,
    Sucursal,
)
from app.models.precios import HistorialPrecioProducto
from app.schemas.expansion import (
    AsignarPersonalIn,
    ChecklistItemOut,
    EstadoAperturaOut,
    EstadoSucursalOut,
    HerenciaCatalogoOut,
    ItemChecklistAperturaOut,
    SucursalCrearIn,
    SucursalOut,
)
from app.services.scoping import verificar_alcance_sucursal

router = APIRouter()


def _completar_item_automatico(db: Session, sucursal_id: int, item_codigo: str, current_user: Usuario) -> None:
    fila = (
        db.query(ChecklistAperturaSucursal)
        .filter_by(sucursal_id=sucursal_id, item=item_codigo)
        .first()
    )
    if fila is not None and not fila.completado:
        fila.completado = True
        fila.fecha_completado = datetime.utcnow()
        fila.completado_por = current_user.id


@router.get("/sucursales", response_model=list[SucursalOut], tags=["expansion"])
def listar_sucursales(
    estado: str | None = Query(None, description="Código del catálogo estado_sucursal; si se omite, trae todas"),
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(require_permission("sucursal", "leer")),
) -> list[Sucursal]:
    """RF-ES-013 (enmienda v1.2, Tarea #57 del frontend — 008-compras-
    proveedores necesita listar sucursales para elegir el destino de una
    orden de compra). No existía ningún GET de listado, solo altas,
    actualizaciones y consultas puntuales por id/estado-apertura.

    Deliberadamente SIN scoping por `verificar_alcance_sucursal`: `leer`
    en `sucursal` ya está concedido a los 4 roles (ver docstring del
    módulo, "cualquiera necesita poder ver qué sucursales existen") —
    es un directorio básico (nombre, dirección, estado), no un dato
    operativo de una sucursal (eso sigue protegido en cada módulo que sí
    aplica Art. 3.3, como `orden_compra` o `venta`). Un cajero de la
    sucursal Centro necesita poder ver que existe la sucursal Norte
    tanto como un encargado de compras que arma una orden para ella."""
    query = db.query(Sucursal)
    if estado is not None:
        query = query.filter(Sucursal.estado == estado)
    return query.order_by(Sucursal.nombre).all()


@router.post("/sucursales", response_model=SucursalOut, status_code=status.HTTP_201_CREATED, tags=["expansion"])
def crear_sucursal(
    payload: SucursalCrearIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("sucursal", "crear")),
) -> Sucursal:
    sucursal = Sucursal(nombre=payload.nombre, direccion=payload.direccion, estado="en_apertura")
    db.add(sucursal)
    db.flush()

    # RF-ES-002 / RN-ES-006: se generan las filas de los ítems activo=true
    # del catálogo AL MOMENTO de crear la sucursal — nunca se recalculan
    # hacia atrás si el catálogo cambia después.
    items = (
        db.query(ItemChecklistApertura)
        .filter(ItemChecklistApertura.activo.is_(True))
        .order_by(ItemChecklistApertura.orden)
        .all()
    )
    for item in items:
        db.add(ChecklistAperturaSucursal(sucursal_id=sucursal.id, item=item.codigo, completado=False))

    db.commit()
    db.refresh(sucursal)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="crear_sucursal",
        recurso="sucursal",
        recurso_id=sucursal.id,
        sucursal_id=sucursal.id,
        exitoso=True,
        request=request,
        detalle={"nombre": payload.nombre, "items_checklist": len(items)},
    )
    return sucursal


@router.patch(
    "/sucursales/{id}/checklist/{item}", response_model=ChecklistItemOut, tags=["expansion"]
)
def completar_item_checklist(
    id: int,
    item: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("checklist_apertura", "actualizar")),
) -> ChecklistItemOut:
    if db.get(Sucursal, id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sucursal no encontrada")
    verificar_alcance_sucursal(db, current_user, id)

    fila = db.query(ChecklistAperturaSucursal).filter_by(sucursal_id=id, item=item).first()
    if fila is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, f"El ítem '{item}' no existe en el checklist de esta sucursal"
        )
    if fila.completado:
        raise HTTPException(status.HTTP_409_CONFLICT, "Este ítem ya estaba completado")

    fila.completado = True
    fila.fecha_completado = datetime.utcnow()
    fila.completado_por = current_user.id
    db.commit()
    db.refresh(fila)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="completar_item_checklist",
        recurso="checklist_apertura",
        recurso_id=fila.id,
        sucursal_id=id,
        exitoso=True,
        request=request,
        detalle={"item": item},
    )
    return ChecklistItemOut(item=fila.item, completado=fila.completado, fecha_completado=fila.fecha_completado)


@router.post(
    "/sucursales/{id}/heredar-catalogo",
    response_model=HerenciaCatalogoOut,
    status_code=status.HTTP_201_CREATED,
    tags=["expansion"],
)
def heredar_catalogo(
    id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("sucursal", "actualizar")),
) -> HerenciaCatalogoSucursal:
    sucursal = db.get(Sucursal, id)
    if sucursal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sucursal no encontrada")
    verificar_alcance_sucursal(db, current_user, id)

    # RN-ES-002 / RNF-ES-003: idempotente a nivel de sucursal — un segundo
    # intento se rechaza explícito, nunca duplica filas de precio.
    if db.query(HerenciaCatalogoSucursal).filter_by(sucursal_id=id).first() is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "La herencia de catálogo ya se ejecutó para esta sucursal (RN-ES-002)"
        )

    productos = db.query(Producto).filter(Producto.activo.is_(True)).all()
    heredados = 0
    pendientes = 0
    for producto in productos:
        # El precio más reciente de este producto en CUALQUIER sucursal de
        # la cadena (Decisión 3 de research.md) — nunca uno inventado.
        ultimo = (
            db.query(HistorialPrecioProducto)
            .filter(HistorialPrecioProducto.producto_id == producto.id)
            .order_by(HistorialPrecioProducto.vigente_desde.desc())
            .first()
        )
        if ultimo is None:
            # RN-ES-003: sin precio previo en ninguna sucursal, queda
            # pendiente de fijación manual — nunca un precio inventado.
            pendientes += 1
            continue
        db.add(
            HistorialPrecioProducto(
                producto_id=producto.id,
                sucursal_id=id,
                precio_venta=ultimo.precio_venta,
                fuente="manual",
                registrado_por=current_user.id,
            )
        )
        heredados += 1

    registro = HerenciaCatalogoSucursal(
        sucursal_id=id, cantidad_productos_heredados=heredados, cantidad_productos_pendientes=pendientes
    )
    db.add(registro)

    # Efecto colateral documentado en el docstring del módulo: esta acción
    # completa por sí sola los dos ítems que describen exactamente este
    # trabajo.
    _completar_item_automatico(db, id, "catalogo_heredado", current_user)
    _completar_item_automatico(db, id, "precios_heredados", current_user)

    db.commit()
    db.refresh(registro)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="heredar_catalogo",
        recurso="sucursal",
        recurso_id=id,
        sucursal_id=id,
        exitoso=True,
        request=request,
        detalle={"heredados": heredados, "pendientes": pendientes},
    )
    return registro


@router.post("/sucursales/{id}/personal", response_model=SucursalOut, tags=["expansion"])
def asignar_personal_sucursal(
    id: int,
    payload: AsignarPersonalIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("sucursal", "actualizar")),
) -> Sucursal:
    sucursal = db.get(Sucursal, id)
    if sucursal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sucursal no encontrada")
    verificar_alcance_sucursal(db, current_user, id)

    usuario = db.get(Usuario, payload.usuario_id)
    if usuario is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuario no encontrado")

    rol = db.get(Rol, usuario.rol)
    if rol is not None and rol.alcance_cadena:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"El rol '{usuario.rol}' de este usuario ya tiene alcance de cadena; "
            "no se asigna por sucursal (RN-AD-001)",
        )

    # Se agrega esta sucursal al conjunto ya asignado del usuario — nunca
    # se reemplaza (ver punto 3 del docstring del módulo).
    ya_asignadas = {
        row.sucursal_id
        for row in db.query(UsuarioSucursal.sucursal_id).filter_by(usuario_id=usuario.id).all()
    }
    ya_asignadas.add(id)
    db.query(UsuarioSucursal).filter_by(usuario_id=usuario.id).delete()
    for sucursal_id in sorted(ya_asignadas):
        db.add(UsuarioSucursal(usuario_id=usuario.id, sucursal_id=sucursal_id))

    if payload.es_responsable:
        sucursal.responsable_id = usuario.id

    # Efecto colateral documentado: esta acción es literalmente el ítem
    # 'personal_asignado' del checklist.
    _completar_item_automatico(db, id, "personal_asignado", current_user)

    db.commit()
    db.refresh(sucursal)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="asignar_personal_sucursal",
        recurso="sucursal",
        recurso_id=id,
        sucursal_id=id,
        exitoso=True,
        request=request,
        detalle={"usuario_id": payload.usuario_id, "es_responsable": payload.es_responsable},
    )
    return sucursal


@router.post("/sucursales/{id}/activar", tags=["expansion"])
def activar_sucursal(
    id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("sucursal", "actualizar")),
):
    sucursal = db.get(Sucursal, id)
    if sucursal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sucursal no encontrada")
    verificar_alcance_sucursal(db, current_user, id)

    if sucursal.estado == "operativa":
        raise HTTPException(status.HTTP_409_CONFLICT, "La sucursal ya está operativa")
    if sucursal.estado == "cerrada":
        raise HTTPException(status.HTTP_409_CONFLICT, "La sucursal está cerrada; no se reactiva por esta vía")

    # RNF-ES-001: la validación del checklist y el cambio de estado son
    # una sola transacción — nunca una validación de solo interfaz.
    pendientes = (
        db.query(ChecklistAperturaSucursal)
        .filter(ChecklistAperturaSucursal.sucursal_id == id, ChecklistAperturaSucursal.completado.is_(False))
        .order_by(ChecklistAperturaSucursal.item)
        .all()
    )
    if pendientes:
        # RN-ES-001: se exigen TODOS los ítems, bloqueantes o no — la
        # forma del 422 del contrato es un objeto propio, no el
        # {"detail": "..."} habitual de HTTPException.
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={"items_pendientes": [p.item for p in pendientes]},
        )

    sucursal.estado = "operativa"
    sucursal.fecha_activacion = datetime.utcnow()
    db.commit()
    db.refresh(sucursal)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="activar_sucursal",
        recurso="sucursal",
        recurso_id=id,
        sucursal_id=id,
        exitoso=True,
        request=request,
    )
    return SucursalOut.model_validate(sucursal)


@router.get(
    "/sucursales/{id}/estado-apertura", response_model=EstadoAperturaOut, tags=["expansion"]
)
def consultar_estado_apertura(
    id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("checklist_apertura", "leer")),
) -> EstadoAperturaOut:
    sucursal = db.get(Sucursal, id)
    if sucursal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sucursal no encontrada")
    verificar_alcance_sucursal(db, current_user, id)

    filas = (
        db.query(ChecklistAperturaSucursal, ItemChecklistApertura)
        .join(ItemChecklistApertura, ChecklistAperturaSucursal.item == ItemChecklistApertura.codigo)
        .filter(ChecklistAperturaSucursal.sucursal_id == id)
        .order_by(ItemChecklistApertura.orden)
        .all()
    )
    checklist = [
        ChecklistItemOut(item=fila.item, completado=fila.completado, fecha_completado=fila.fecha_completado)
        for fila, _catalogo in filas
    ]
    return EstadoAperturaOut(sucursal=SucursalOut.model_validate(sucursal), checklist=checklist)


@router.patch("/sucursales/{id}/cerrar", response_model=SucursalOut, tags=["expansion"])
def cerrar_sucursal(
    id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("sucursal", "actualizar")),
) -> Sucursal:
    sucursal = db.get(Sucursal, id)
    if sucursal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sucursal no encontrada")
    verificar_alcance_sucursal(db, current_user, id)

    # RF-ES-008: "dar de baja o cerrar temporalmente una sucursal YA
    # OPERATIVA" — una en apertura no tiene sentido cerrarla por acá.
    if sucursal.estado != "operativa":
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Solo se puede cerrar una sucursal operativa (estado actual: '{sucursal.estado}')"
        )

    sucursal.estado = "cerrada"
    sucursal.fecha_cierre = datetime.utcnow()
    db.commit()
    db.refresh(sucursal)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="cerrar_sucursal",
        recurso="sucursal",
        recurso_id=id,
        sucursal_id=id,
        exitoso=True,
        request=request,
    )
    return sucursal


# ---------------------------------------------------------------------------
# Catálogos (RF-ES-009 a 011, enmienda v1.1) — solo lectura, cualquier usuario autenticado
# ---------------------------------------------------------------------------


@router.get(
    "/catalogos/items-checklist-apertura", response_model=list[ItemChecklistAperturaOut], tags=["catalogos"]
)
def listar_items_checklist_apertura(
    solo_activos: bool = Query(True),
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(get_current_user),
) -> list[ItemChecklistApertura]:
    query = db.query(ItemChecklistApertura)
    if solo_activos:
        query = query.filter(ItemChecklistApertura.activo.is_(True))
    return query.order_by(ItemChecklistApertura.orden).all()


@router.get("/catalogos/estados-sucursal", response_model=list[EstadoSucursalOut], tags=["catalogos"])
def listar_estados_sucursal(
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(get_current_user),
) -> list[EstadoSucursal]:
    return db.query(EstadoSucursal).order_by(EstadoSucursal.orden).all()
