"""
Router del módulo 003-precios-margenes — historial de precio vigente por
sucursal, margen real (cruce de solo lectura con 008-compras-proveedores),
clasificación comercial gancho/nicho con su historial SCD tipo 2, precio
de competencia y recomendaciones del motor de pricing dinámico. Implementa
el contrato el-kiosquito-003-precios-margenes-contracts-openapi.yaml.

RBAC: la matriz de 003 solo tiene 2 recursos — `precio` (historial de
precio, competencia, clasificación comercial y sus catálogos) y
`recomendacion_precio` (crear/resolver recomendaciones del motor de
pricing). El contrato marca `crearRecomendacionPrecio` como
`security: [Sistema]` (el motor batch, no un usuario a mano) — igual que en
002, se autoriza contra la matriz real; en la práctica lo dispara una
cuenta con rol `dueno` o `encargado_compras`.

`historial_costo_producto` (008) se consulta de solo lectura para calcular
el margen real — nunca se referencia por FK ni se materializa aquí (mismo
principio que RNF-CVI-003 y el cruce de 002 con `venta`).
"""

from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, log_accion, require_permission
from app.database import get_db
from app.models.administracion import Usuario
from app.models.compras import HistorialCostoProducto
from app.models.core_ventas import Producto
from app.models.expansion import Sucursal
from app.models.precios import (
    CanalCompetencia,
    ClasificacionComercial,
    ClasificacionProducto,
    FuenteCompetencia,
    HistorialPrecioProducto,
    PrecioCompetencia,
    ProductoClasificacionHistorial,
    RecomendacionPrecio,
)
from app.schemas.precios import (
    ClasificacionActualOut,
    ClasificacionComercialOut,
    ClasificacionHistorialOut,
    ClasificarProductoIn,
    ComparativaCompetenciaOut,
    FuenteCompetenciaActualizarIn,
    FuenteCompetenciaCrearIn,
    FuenteCompetenciaOut,
    HistorialPrecioOut,
    MargenRealOut,
    PrecioCompetenciaCrearIn,
    PrecioCrearIn,
    RecomendacionCrearIn,
    RecomendacionOut,
    RecomendacionResolverIn,
)
from app.services.scoping import verificar_alcance_sucursal

router = APIRouter()


def _money(x) -> Decimal:
    return Decimal(str(x)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _precio_vigente(db: Session, producto_id: int, sucursal_id: int) -> HistorialPrecioProducto | None:
    return (
        db.query(HistorialPrecioProducto)
        .filter(
            HistorialPrecioProducto.producto_id == producto_id,
            HistorialPrecioProducto.sucursal_id == sucursal_id,
        )
        .order_by(HistorialPrecioProducto.vigente_desde.desc())
        .first()
    )


def _costo_vigente(db: Session, producto_id: int) -> HistorialCostoProducto | None:
    # El costo de reposición es de cadena, no por sucursal (008 no modela
    # `sucursal_id` en historial_costo_producto — un mismo proveedor surte a
    # todas las sucursales al mismo costo).
    return (
        db.query(HistorialCostoProducto)
        .filter(HistorialCostoProducto.producto_id == producto_id)
        .order_by(HistorialCostoProducto.fecha.desc())
        .first()
    )


# ---------------------------------------------------------------------------
# Historial de precio y margen real (OO-PM01, OO-PM02)
# ---------------------------------------------------------------------------


@router.post("/precios", response_model=HistorialPrecioOut, status_code=status.HTTP_201_CREATED, tags=["precios"])
def registrar_precio(
    payload: PrecioCrearIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("precio", "crear")),
) -> HistorialPrecioProducto:
    if db.get(Producto, payload.producto_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Producto no encontrado")
    if db.get(Sucursal, payload.sucursal_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sucursal no encontrada")
    verificar_alcance_sucursal(db, current_user, payload.sucursal_id)

    nuevo = HistorialPrecioProducto(
        producto_id=payload.producto_id,
        sucursal_id=payload.sucursal_id,
        precio_venta=_money(payload.precio_venta),
        fuente="manual",
        registrado_por=current_user.id,
    )
    db.add(nuevo)

    # Un precio manual nuevo vuelve obsoleta cualquier recomendación
    # pendiente de este producto/sucursal — el motor propuso un precio para
    # una situación que un humano acaba de decidir sobrescribir a mano.
    pendientes = (
        db.query(RecomendacionPrecio)
        .filter(
            RecomendacionPrecio.producto_id == payload.producto_id,
            RecomendacionPrecio.sucursal_id == payload.sucursal_id,
            RecomendacionPrecio.estado == "pendiente",
        )
        .all()
    )
    for rec in pendientes:
        rec.estado = "obsoleta"
        rec.fecha_resolucion = datetime.utcnow()
        rec.resuelto_por = current_user.id

    db.commit()
    db.refresh(nuevo)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="registrar_precio",
        recurso="precio",
        recurso_id=nuevo.id,
        sucursal_id=payload.sucursal_id,
        exitoso=True,
        request=request,
        detalle={"producto_id": payload.producto_id, "precio_venta": str(nuevo.precio_venta)},
    )
    return nuevo


@router.get("/precios/{producto_id}/margen", response_model=MargenRealOut, tags=["precios"])
def consultar_margen_real(
    producto_id: int,
    sucursal_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("precio", "leer")),
) -> MargenRealOut:
    if db.get(Producto, producto_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Producto no encontrado")
    verificar_alcance_sucursal(db, current_user, sucursal_id)

    precio = _precio_vigente(db, producto_id, sucursal_id)
    costo = _costo_vigente(db, producto_id)

    # RNF-PM-001: nunca inventar una cifra — si falta precio o costo, la
    # respuesta lo declara explícitamente en vez de calcular contra 0 — pero
    # el dato crudo que sí existe (precio o costo) se muestra igual; lo que
    # nunca se inventa es la cifra *calculada* del margen.
    datos_suficientes = precio is not None and costo is not None
    return MargenRealOut(
        producto_id=producto_id,
        sucursal_id=sucursal_id,
        datos_suficientes=datos_suficientes,
        precio_venta_vigente=precio.precio_venta if precio is not None else None,
        costo_reposicion_vigente=costo.costo if costo is not None else None,
        margen_real=(
            _money(Decimal(str(precio.precio_venta)) - Decimal(str(costo.costo)))
            if datos_suficientes
            else None
        ),
    )


# ---------------------------------------------------------------------------
# Precio de competencia y comparativa (OO-PM03, OO-PM04, enmienda v1.2)
# ---------------------------------------------------------------------------


@router.post(
    "/precios/competencia",
    status_code=status.HTTP_201_CREATED,
    tags=["precios"],
)
def registrar_precio_competencia(
    payload: PrecioCompetenciaCrearIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("precio", "crear")),
) -> dict:
    if db.get(Producto, payload.producto_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Producto no encontrado")
    fuente = db.get(FuenteCompetencia, payload.fuente_competencia_id)
    if fuente is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "fuente_competencia_id no encontrada")

    observacion = PrecioCompetencia(
        producto_id=payload.producto_id,
        fuente_competencia_id=payload.fuente_competencia_id,
        precio_referencia=_money(payload.precio_referencia),
        registrado_por=current_user.id,
    )
    db.add(observacion)
    db.commit()
    db.refresh(observacion)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="registrar_precio_competencia",
        recurso="precio",
        recurso_id=observacion.id,
        exitoso=True,
        request=request,
        detalle={"producto_id": payload.producto_id, "fuente_competencia_id": payload.fuente_competencia_id},
    )
    return {
        "id": observacion.id,
        "producto_id": observacion.producto_id,
        "fuente_competencia_id": observacion.fuente_competencia_id,
        "precio_referencia": observacion.precio_referencia,
        "fecha_registro": observacion.fecha_registro,
    }


@router.get("/precios/{producto_id}/comparativa-competencia", tags=["precios"])
def consultar_comparativa_competencia(
    producto_id: int,
    sucursal_id: int = Query(...),
    canal_codigo: str | None = Query(default=None),
    agrupar_por_fuente: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("precio", "leer")),
):
    if db.get(Producto, producto_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Producto no encontrado")
    verificar_alcance_sucursal(db, current_user, sucursal_id)

    if canal_codigo is not None and db.get(CanalCompetencia, canal_codigo) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"canal_codigo '{canal_codigo}' no existe")

    precio_propio = _precio_vigente(db, producto_id, sucursal_id)
    precio_propio_vigente = precio_propio.precio_venta if precio_propio is not None else None

    # Sin `relationship()` declarada en los modelos (este proyecto no las usa
    # — ver models/precios.py, solo columnas FK) el JOIN se trae la fuente
    # como tupla explícita en vez de un atributo de navegación del ORM.
    query = (
        db.query(PrecioCompetencia, FuenteCompetencia)
        .join(FuenteCompetencia, PrecioCompetencia.fuente_competencia_id == FuenteCompetencia.id)
        .filter(PrecioCompetencia.producto_id == producto_id)
    )
    if canal_codigo is not None:
        query = query.filter(FuenteCompetencia.canal_codigo == canal_codigo)
    observaciones = query.order_by(PrecioCompetencia.fecha_registro.desc()).all()

    if not agrupar_por_fuente:
        # RF-PM-006: una sola comparación agregada contra la observación más
        # reciente de cualquier competidor (dentro del canal si se filtró).
        mas_reciente = observaciones[0] if observaciones else None
        obs, fuente = mas_reciente if mas_reciente is not None else (None, None)
        return ComparativaCompetenciaOut(
            producto_id=producto_id,
            precio_propio_vigente=precio_propio_vigente,
            precio_competencia_mas_reciente=obs.precio_referencia if obs else None,
            fuente_competencia=fuente.nombre if fuente else None,
            fuente_competencia_id=obs.fuente_competencia_id if obs else None,
            canal_competencia=fuente.canal_codigo if fuente else None,
        )

    # RF-PM-014 (enmienda v1.2): una fila por competidor concreto — la
    # observación más reciente de cada `fuente_competencia_id` distinta,
    # para responder "¿contra qué competidor estoy peor de precio?".
    mas_reciente_por_fuente: dict[int, tuple[PrecioCompetencia, FuenteCompetencia]] = {}
    for obs, fuente in observaciones:  # ya viene ordenado desc por fecha_registro
        mas_reciente_por_fuente.setdefault(obs.fuente_competencia_id, (obs, fuente))

    return [
        ComparativaCompetenciaOut(
            producto_id=producto_id,
            precio_propio_vigente=precio_propio_vigente,
            precio_competencia_mas_reciente=obs.precio_referencia,
            fuente_competencia=fuente.nombre,
            fuente_competencia_id=obs.fuente_competencia_id,
            canal_competencia=fuente.canal_codigo,
        )
        for obs, fuente in mas_reciente_por_fuente.values()
    ]


# ---------------------------------------------------------------------------
# Catálogo de fuentes de competencia (RF-PM-013, enmienda v1.2)
# ---------------------------------------------------------------------------


@router.get("/catalogos/fuentes-competencia", response_model=list[FuenteCompetenciaOut], tags=["catalogos"])
def listar_fuentes_competencia(
    canal_codigo: str | None = Query(default=None),
    solo_activas: bool = Query(default=True),
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(get_current_user),
) -> list[FuenteCompetencia]:
    query = db.query(FuenteCompetencia)
    if canal_codigo is not None:
        query = query.filter(FuenteCompetencia.canal_codigo == canal_codigo)
    if solo_activas:
        query = query.filter(FuenteCompetencia.activo.is_(True))
    return query.order_by(FuenteCompetencia.nombre).all()


@router.post(
    "/catalogos/fuentes-competencia",
    response_model=FuenteCompetenciaOut,
    status_code=status.HTTP_201_CREATED,
    tags=["catalogos"],
)
def crear_fuente_competencia(
    payload: FuenteCompetenciaCrearIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("precio", "crear")),
) -> FuenteCompetencia:
    if db.get(CanalCompetencia, payload.canal_codigo) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"canal_codigo '{payload.canal_codigo}' no existe")
    if db.query(FuenteCompetencia).filter(FuenteCompetencia.nombre == payload.nombre).first() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya existe una fuente de competencia con ese nombre")

    fuente = FuenteCompetencia(nombre=payload.nombre, canal_codigo=payload.canal_codigo)
    db.add(fuente)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya existe una fuente de competencia con ese nombre")
    db.refresh(fuente)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="crear_fuente_competencia",
        recurso="precio",
        recurso_id=fuente.id,
        exitoso=True,
        request=request,
    )
    return fuente


@router.patch("/catalogos/fuentes-competencia/{id}", response_model=FuenteCompetenciaOut, tags=["catalogos"])
def actualizar_fuente_competencia(
    id: int,
    payload: FuenteCompetenciaActualizarIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("precio", "actualizar")),
) -> FuenteCompetencia:
    fuente = db.get(FuenteCompetencia, id)
    if fuente is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Fuente de competencia no encontrada")

    if payload.canal_codigo is not None:
        if db.get(CanalCompetencia, payload.canal_codigo) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"canal_codigo '{payload.canal_codigo}' no existe")
        fuente.canal_codigo = payload.canal_codigo
    if payload.nombre is not None:
        duplicado = (
            db.query(FuenteCompetencia)
            .filter(FuenteCompetencia.nombre == payload.nombre, FuenteCompetencia.id != id)
            .first()
        )
        if duplicado is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "Ya existe una fuente de competencia con ese nombre")
        fuente.nombre = payload.nombre
    if payload.activo is not None:
        # RN-PM-006: baja lógica únicamente — nunca se borra la fila, las
        # observaciones históricas de precio_competencia siguen apuntando
        # aquí aunque quede inactiva.
        fuente.activo = payload.activo

    db.commit()
    db.refresh(fuente)
    log_accion(
        db, usuario_id=current_user.id, accion="actualizar_fuente_competencia", recurso="precio",
        recurso_id=fuente.id, exitoso=True, request=request,
    )
    return fuente


# ---------------------------------------------------------------------------
# Clasificación comercial gancho/nicho y su historial SCD2 (OO-PM05, RF-PM-017)
# ---------------------------------------------------------------------------


@router.get(
    "/catalogos/clasificaciones-comerciales",
    response_model=list[ClasificacionComercialOut],
    tags=["catalogos"],
)
def listar_clasificaciones_comerciales(
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(get_current_user),
) -> list[ClasificacionComercial]:
    return db.query(ClasificacionComercial).order_by(ClasificacionComercial.codigo).all()


@router.patch("/precios/clasificacion/{producto_id}", response_model=ClasificacionActualOut, tags=["precios"])
def clasificar_producto(
    producto_id: int,
    payload: ClasificarProductoIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("precio", "actualizar")),
) -> ClasificacionActualOut:
    if db.get(Producto, producto_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Producto no encontrado")
    if db.get(ClasificacionComercial, payload.clasificacion) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Clasificación '{payload.clasificacion}' no existe en el catálogo")

    # RN-PM-003: cierra la vigencia anterior y abre la nueva en la misma
    # transacción — mismo patrón SCD2 que segmento_cliente (002), respaldado
    # acá por el índice único parcial ux_clasif_hist_vigente (RN-PM-004).
    ahora = datetime.utcnow()
    vigente_actual = (
        db.query(ProductoClasificacionHistorial)
        .filter(
            ProductoClasificacionHistorial.producto_id == producto_id,
            ProductoClasificacionHistorial.fecha_hasta.is_(None),
        )
        .first()
    )
    if vigente_actual is not None:
        vigente_actual.fecha_hasta = ahora
        db.flush()

    nueva_entrada = ProductoClasificacionHistorial(
        producto_id=producto_id,
        clasificacion=payload.clasificacion,
        fecha_desde=ahora,
        fecha_hasta=None,
        motivo_cambio=payload.motivo_cambio,
        usuario_id=current_user.id,
    )
    db.add(nueva_entrada)

    # clasificacion_producto guarda solo el estado vigente (PK = producto_id
    # ⇒ upsert manual, no hay fila "nueva" que crear si ya existía una).
    actual = db.get(ClasificacionProducto, producto_id)
    if actual is None:
        actual = ClasificacionProducto(
            producto_id=producto_id,
            clasificacion=payload.clasificacion,
            actualizado_en=ahora,
            actualizado_por=current_user.id,
        )
        db.add(actual)
    else:
        actual.clasificacion = payload.clasificacion
        actual.actualizado_en = ahora
        actual.actualizado_por = current_user.id

    db.commit()
    db.refresh(nueva_entrada)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="clasificar_producto",
        recurso="precio",
        recurso_id=producto_id,
        exitoso=True,
        request=request,
        detalle={"clasificacion": payload.clasificacion, "motivo_cambio": payload.motivo_cambio},
    )
    return ClasificacionActualOut(
        producto_id=producto_id, clasificacion=payload.clasificacion, vigente_desde=nueva_entrada.fecha_desde
    )


@router.get(
    "/precios/clasificacion/{producto_id}/historial",
    response_model=list[ClasificacionHistorialOut],
    tags=["precios"],
)
def consultar_historial_clasificacion(
    producto_id: int,
    en_fecha: date | None = Query(default=None),
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(require_permission("precio", "leer")),
) -> list[ProductoClasificacionHistorial]:
    if db.get(Producto, producto_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Producto no encontrado")

    query = db.query(ProductoClasificacionHistorial).filter(
        ProductoClasificacionHistorial.producto_id == producto_id
    )

    if en_fecha is not None:
        # RF-PM-016: el margen histórico de OT1.1 se evalúa contra el rango
        # objetivo que regía en esa fecha, no contra la clasificación actual.
        momento = datetime.combine(en_fecha, datetime.max.time())
        fila = (
            query.filter(
                ProductoClasificacionHistorial.fecha_desde <= momento,
            )
            .filter(
                (ProductoClasificacionHistorial.fecha_hasta.is_(None))
                | (ProductoClasificacionHistorial.fecha_hasta > momento)
            )
            .order_by(ProductoClasificacionHistorial.fecha_desde.desc())
            .first()
        )
        return [fila] if fila is not None else []

    return query.order_by(ProductoClasificacionHistorial.fecha_desde.asc()).all()


# ---------------------------------------------------------------------------
# Recomendaciones del motor de pricing dinámico (OO-PM06, OO-PM07, RN-PM-001/002)
# ---------------------------------------------------------------------------


@router.post(
    "/precios/recomendaciones",
    response_model=RecomendacionOut,
    status_code=status.HTTP_201_CREATED,
    tags=["precios"],
)
def crear_recomendacion_precio(
    payload: RecomendacionCrearIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("recomendacion_precio", "crear")),
) -> RecomendacionPrecio:
    if db.get(Producto, payload.producto_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Producto no encontrado")
    if db.get(Sucursal, payload.sucursal_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sucursal no encontrada")
    verificar_alcance_sucursal(db, current_user, payload.sucursal_id)

    precio_actual = _precio_vigente(db, payload.producto_id, payload.sucursal_id)
    if precio_actual is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "No hay un precio vigente registrado para este producto/sucursal — el motor no tiene contra qué comparar",
        )

    recomendacion = RecomendacionPrecio(
        producto_id=payload.producto_id,
        sucursal_id=payload.sucursal_id,
        precio_actual_snapshot=precio_actual.precio_venta,
        precio_recomendado=_money(payload.precio_recomendado),
        justificacion=payload.justificacion,
        estado="pendiente",
    )
    db.add(recomendacion)
    try:
        db.commit()
    except IntegrityError:
        # RN-PM-001, respaldado por ux_recomendacion_pendiente_unica.
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Ya existe una recomendación pendiente para este producto/sucursal (RN-PM-001)",
        )
    db.refresh(recomendacion)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="crear_recomendacion_precio",
        recurso="recomendacion_precio",
        recurso_id=recomendacion.id,
        sucursal_id=payload.sucursal_id,
        exitoso=True,
        request=request,
    )
    return recomendacion


@router.patch(
    "/precios/recomendaciones/{id}/resolucion",
    response_model=RecomendacionOut,
    tags=["precios"],
)
def resolver_recomendacion_precio(
    id: int,
    payload: RecomendacionResolverIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("recomendacion_precio", "actualizar")),
) -> RecomendacionPrecio:
    recomendacion = db.get(RecomendacionPrecio, id)
    if recomendacion is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recomendación no encontrada")
    if recomendacion.estado != "pendiente":
        raise HTTPException(
            status.HTTP_409_CONFLICT, "La recomendación ya no está pendiente (ya fue resuelta u obsoleta)"
        )
    verificar_alcance_sucursal(db, current_user, recomendacion.sucursal_id)

    recomendacion.estado = payload.decision
    recomendacion.fecha_resolucion = datetime.utcnow()
    recomendacion.resuelto_por = current_user.id

    if payload.decision == "aceptada":
        # RN-PM-007 (enmienda v1.3): RN-PM-002 ya impide que el motor actúe
        # solo, pero no impedía que un humano aceptara sin darse cuenta un
        # precio por debajo del costo de reposición vigente. No se bloquea
        # (vender a pérdida un producto gancho puntual puede ser una decisión
        # de negocio válida) — se exige confirmación explícita para que nunca
        # pase por descuido.
        costo_actual = _costo_vigente(db, recomendacion.producto_id)
        if costo_actual is not None and recomendacion.precio_recomendado < costo_actual.costo and not payload.confirmar_perdida:
            perdida_unitaria = costo_actual.costo - recomendacion.precio_recomendado
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                {
                    "mensaje": (
                        "El precio recomendado queda por debajo del costo de reposición vigente "
                        "(RN-PM-007) — reenviar con confirmar_perdida=true si es una decisión de "
                        "negocio deliberada (p. ej. liquidar un producto gancho puntual)."
                    ),
                    "precio_recomendado": float(recomendacion.precio_recomendado),
                    "costo_reposicion_vigente": float(costo_actual.costo),
                    "perdida_unitaria": float(perdida_unitaria),
                },
            )

        # RN-PM-002: el motor nunca escribe historial_precio_producto
        # directamente — solo la aceptación humana de la recomendación crea
        # la nueva fila, con fuente='motor_dinamico' (Art. 5.6).
        nuevo_precio = HistorialPrecioProducto(
            producto_id=recomendacion.producto_id,
            sucursal_id=recomendacion.sucursal_id,
            precio_venta=recomendacion.precio_recomendado,
            fuente="motor_dinamico",
            registrado_por=current_user.id,
        )
        db.add(nuevo_precio)

    db.commit()
    db.refresh(recomendacion)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="resolver_recomendacion_precio",
        recurso="recomendacion_precio",
        recurso_id=recomendacion.id,
        sucursal_id=recomendacion.sucursal_id,
        exitoso=True,
        request=request,
        detalle={"decision": payload.decision, "confirmar_perdida": payload.confirmar_perdida},
    )
    return recomendacion
