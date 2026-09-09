"""
Router del módulo 001-core-ventas-inventario — el camino más caliente del
sistema: cada venta resuelve precio (003), descuenta stock y respeta el
scoping por sucursal (Art. 3.3). Implementa el contrato
el-kiosquito-001-core-ventas-inventario-contracts-openapi.yaml.

Aritmética monetaria y de cantidades siempre en `Decimal`, nunca en
`float` — los CHECK de `venta`/`detalle_venta` comparan valores NUMERIC
exactos en Postgres; un redondeo de coma flotante que no calce con lo que
Postgres calcula rompe el INSERT (ver af785599e904, que corrigió un bug
real de precisión encontrado al escribir este mismo endpoint).

RBAC: la matriz de 001 solo tiene 3 recursos (`producto`, `inventario`,
`venta`) — los endpoints de categoría (que sí escriben, a diferencia de
los otros 4 catálogos de este módulo) se autorizan contra `producto`,
porque son administración del mismo catálogo de productos.
"""

from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, log_accion, require_permission
from app.database import get_db
from app.models.administracion import Rol, Usuario, UsuarioSucursal
from app.models.caja import TurnoCaja
from app.models.clientes import Cliente
from app.models.core_ventas import (
    AjusteInventario,
    Anaquel,
    Categoria,
    DetalleVenta,
    EstadoVenta,
    LoteProducto,
    MetodoPago,
    Producto,
    ProductoSustituto,
    ProductoUbicacion,
    StockSucursal,
    UnidadMedida,
    Venta,
)
from app.models.expansion import Sucursal
from app.models.pagos import Datafono
from app.models.precios import HistorialPrecioProducto
from app.schemas.core_ventas import (
    AjusteInventarioIn,
    AjusteInventarioOut,
    AnaquelCrearIn,
    AnaquelOut,
    CategoriaActualizarIn,
    CategoriaCrearIn,
    CategoriaOut,
    EstadoVentaOut,
    IngresoStockIn,
    LoteOut,
    MetodoPagoOut,
    ProductoActualizarIn,
    ProductoBusquedaOut,
    ProductoCrearIn,
    ProductoOut,
    ProductoSustitutoIn,
    ProductoSustitutoOut,
    ProductoUbicacionAsignarIn,
    ProductoUbicacionOut,
    RetiroLoteIn,
    StockBajoOut,
    StockMinimoIn,
    StockOut,
    UnidadMedidaOut,
    VentaAnularIn,
    VentaCrearIn,
    VentaDescuentoIn,
    VentaOut,
    VentaPagoIn,
)
from app.services.scoping import verificar_alcance_sucursal

router = APIRouter()

# Umbrales de negocio sin columna propia en ningún catálogo del módulo —
# documentados aquí a propósito, listos para moverse a
# `historial_parametro_sistema` (010) el día que el negocio quiera
# ajustarlos sin desplegar código, mismo motivo que `plazo_respuesta_dias`
# en `tipo_solicitud_arco`.
DIAS_ALERTA_CADUCIDAD = 7
UMBRAL_DIAS_SIN_ROTACION = 30


def _money(x) -> Decimal:
    return Decimal(str(x)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _qty(x) -> Decimal:
    return Decimal(str(x)).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)


# ---------------------------------------------------------------------------
# Ventas (RF-CVI-001 a 005, 017, 020)
# ---------------------------------------------------------------------------


@router.post("/ventas", response_model=VentaOut, status_code=status.HTTP_201_CREATED, tags=["ventas"])
def crear_venta(
    payload: VentaCrearIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("venta", "crear")),
) -> Venta:
    turno = db.get(TurnoCaja, payload.turno_caja_id)
    if turno is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Turno de caja no encontrado")
    # Art. 3.3: el turno pertenece a una sucursal — el cajero solo puede
    # vender dentro del alcance de su propio rol.
    verificar_alcance_sucursal(db, current_user, turno.sucursal_id)

    metodo = db.get(MetodoPago, payload.metodo_pago)
    if metodo is None or not metodo.activo:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Método de pago '{payload.metodo_pago}' inválido")

    # RN-CVI-011 (enmienda v1.5, auditoría de riesgos derivados): traza qué
    # terminal físico cobró una venta con tarjeta/electrónico, para poder
    # cruzarla después contra el historial de revisiones de seguridad de
    # ese datáfono (007-pagos-seguridad) — antes de esto no había ningún
    # vínculo entre una venta y el datáfono real que la procesó.
    if payload.metodo_pago == "efectivo":
        if payload.datafono_id is not None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Un pago en efectivo no debe indicar datafono_id (RN-CVI-011)",
            )
    else:
        if payload.datafono_id is not None:
            datafono = db.get(Datafono, payload.datafono_id)
            if datafono is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Datáfono no encontrado")
            if datafono.sucursal_id != turno.sucursal_id:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    "El datáfono indicado no pertenece a la sucursal de este turno (RN-CVI-011)",
                )
            if not datafono.activo:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY, "El datáfono indicado está dado de baja (RN-CVI-011)"
                )
        else:
            # Si la sucursal no tiene NINGÚN datáfono activo registrado, no
            # se bloquea la venta — obligarlo ahí congelaría la operación
            # de una sucursal que simplemente no cargó su datáfono todavía.
            # Si sí tiene al menos uno, omitirlo ya no es un descuido
            # aceptable: es exactamente el hueco de trazabilidad que esta
            # enmienda vino a cerrar.
            tiene_datafono_activo = (
                db.query(Datafono).filter_by(sucursal_id=turno.sucursal_id, activo=True).first() is not None
            )
            if tiene_datafono_activo:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    f"datafono_id es obligatorio para método de pago '{payload.metodo_pago}' "
                    "cuando la sucursal tiene datáfonos registrados (RN-CVI-011)",
                )

    if payload.cliente_id is not None and db.get(Cliente, payload.cliente_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cliente no encontrado")

    subtotal = Decimal("0")
    detalles: list[DetalleVenta] = []
    for item in payload.items:
        producto = db.get(Producto, item.producto_id)
        if producto is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Producto {item.producto_id} no encontrado")
        if not producto.activo:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Producto {producto.id} está inactivo")
        if producto.es_fraccionable and producto.factor_conversion is None:
            # No debería poder pasar (CHECK de BD en producto), pero un 422
            # aquí es más útil para el cliente que un 500 de integridad.
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Producto fraccionable sin factor_conversion (RN-CVI-001)")

        cantidad_venta = _qty(item.cantidad_venta)
        unidad_venta = db.get(UnidadMedida, producto.unidad_venta_codigo)
        if not producto.es_fraccionable and unidad_venta is not None and not unidad_venta.permite_decimales:
            if cantidad_venta != cantidad_venta.to_integral_value():
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    f"La unidad '{producto.unidad_venta_codigo}' no admite cantidades decimales",
                )

        precio_row = (
            db.query(HistorialPrecioProducto)
            .filter(
                HistorialPrecioProducto.producto_id == producto.id,
                HistorialPrecioProducto.sucursal_id == turno.sucursal_id,
            )
            .order_by(HistorialPrecioProducto.vigente_desde.desc())
            .first()
        )
        if precio_row is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"Producto {producto.id} no tiene un precio vigente en la sucursal {turno.sucursal_id}",
            )
        precio_unitario = _money(precio_row.precio_venta)

        # RF-CVI-005: conversión a la unidad de inventario vía factor_conversion.
        cantidad_inventario = _qty(cantidad_venta * producto.factor_conversion) if producto.es_fraccionable else cantidad_venta

        stock = (
            db.query(StockSucursal)
            .filter_by(producto_id=producto.id, sucursal_id=turno.sucursal_id)
            .first()
        )
        if stock is None or stock.cantidad_disponible < cantidad_inventario:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, f"Stock insuficiente de producto {producto.id} en esta sucursal"
            )
        stock.cantidad_disponible = _qty(stock.cantidad_disponible - cantidad_inventario)
        stock.dias_sin_venta = 0
        stock.marcado_sin_rotacion = False
        stock.actualizado_en = datetime.utcnow()

        subtotal_item = _money(cantidad_venta * precio_unitario)
        subtotal += subtotal_item
        detalles.append(
            DetalleVenta(
                producto_id=producto.id,
                cantidad_venta=cantidad_venta,
                unidad_venta_codigo=producto.unidad_venta_codigo,
                cantidad_inventario=cantidad_inventario,
                precio_unitario_aplicado=precio_unitario,
                subtotal_item=subtotal_item,
            )
        )

    descuento = _money(payload.descuento_aplicado)
    if descuento > subtotal:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "El descuento no puede superar el subtotal")

    iva = _money((subtotal - descuento) * Decimal("0.15"))  # Art. 4.1
    total = subtotal - descuento + iva

    venta = Venta(
        sucursal_id=turno.sucursal_id,
        turno_caja_id=turno.id,
        cajero_id=current_user.id,
        cliente_id=payload.cliente_id,
        hora_inicio_cobro=payload.hora_inicio_cobro,
        subtotal=subtotal,
        descuento_aplicado=descuento,
        iva=iva,
        total=total,
        metodo_pago=payload.metodo_pago,
        datafono_id=payload.datafono_id,
    )
    db.add(venta)
    db.flush()  # asigna venta.id sin cerrar la transacción (necesario para detalle_venta.venta_id)
    for detalle in detalles:
        detalle.venta_id = venta.id
        db.add(detalle)
    db.commit()
    db.refresh(venta)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="crear_venta",
        recurso="venta",
        recurso_id=venta.id,
        sucursal_id=venta.sucursal_id,
        exitoso=True,
        request=request,
    )
    return venta


@router.patch("/ventas/{venta_id}/pago", response_model=VentaOut, tags=["ventas"])
def registrar_pago_venta(
    venta_id: int,
    payload: VentaPagoIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("venta", "actualizar")),
) -> Venta:
    venta = db.get(Venta, venta_id)
    if venta is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Venta no encontrada")

    from app.models.core_ventas import EstadoPago  # import local: evita ciclo con el resto del módulo

    estado = db.get(EstadoPago, payload.estado_pago)
    if estado is None or not estado.activo:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Estado de pago '{payload.estado_pago}' inválido")

    venta.estado_pago = payload.estado_pago
    db.commit()
    db.refresh(venta)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="registrar_pago_venta",
        recurso="venta",
        recurso_id=venta.id,
        sucursal_id=venta.sucursal_id,
        exitoso=True,
        request=request,
        detalle={"estado_pago": payload.estado_pago},
    )
    return venta


@router.patch("/ventas/{venta_id}/descuento", response_model=VentaOut, tags=["ventas"])
def aplicar_descuento_venta(
    venta_id: int,
    payload: VentaDescuentoIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("venta", "actualizar")),
) -> Venta:
    venta = db.get(Venta, venta_id)
    if venta is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Venta no encontrada")
    if venta.estado_venta == "anulada":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "No se puede aplicar descuento a una venta anulada")

    descuento = _money(payload.descuento_aplicado)
    if descuento > venta.subtotal:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "El descuento no puede superar el subtotal")

    venta.descuento_aplicado = descuento
    venta.iva = _money((venta.subtotal - descuento) * Decimal("0.15"))
    venta.total = venta.subtotal - descuento + venta.iva
    db.commit()
    db.refresh(venta)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="aplicar_descuento_venta",
        recurso="venta",
        recurso_id=venta.id,
        sucursal_id=venta.sucursal_id,
        exitoso=True,
        request=request,
    )
    return venta


@router.patch("/ventas/{venta_id}/anular", response_model=VentaOut, tags=["ventas"])
def anular_venta(
    venta_id: int,
    payload: VentaAnularIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("venta", "actualizar")),
) -> Venta:
    venta = db.get(Venta, venta_id)
    if venta is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Venta no encontrada")

    # Caso límite documentado en spec.md: anular tras cerrado el turno se
    # registra igual — este módulo nunca reabre ni toca el cuadre de 006.
    venta.estado_venta = "anulada"
    venta.motivo_anulacion = payload.motivo_anulacion
    venta.anulada_en = datetime.utcnow()
    db.commit()
    db.refresh(venta)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="anular_venta",
        recurso="venta",
        recurso_id=venta.id,
        sucursal_id=venta.sucursal_id,
        exitoso=True,
        request=request,
        detalle={"motivo_anulacion": payload.motivo_anulacion},
    )
    return venta


@router.get("/ventas", response_model=list[VentaOut], tags=["ventas"])
def listar_ventas(
    turno_caja_id: int | None = Query(None, description="Filtrar ventas por turno de caja"),
    sucursal_id: int | None = Query(None, description="Filtrar ventas por sucursal"),
    limite: int = Query(20, ge=1, le=100, description="Cantidad máxima de ventas"),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("venta", "leer")),
) -> list[Venta]:
    """Consulta las últimas ventas del turno o sucursal para el panel del POS y control de caja."""
    query = db.query(Venta)
    if turno_caja_id is not None:
        turno = db.get(TurnoCaja, turno_caja_id)
        if turno is not None:
            verificar_alcance_sucursal(db, current_user, turno.sucursal_id)
        query = query.filter(Venta.turno_caja_id == turno_caja_id)
    elif sucursal_id is not None:
        verificar_alcance_sucursal(db, current_user, sucursal_id)
        query = query.filter(Venta.sucursal_id == sucursal_id)
    return query.order_by(Venta.hora_inicio_cobro.desc()).limit(limite).all()


# ---------------------------------------------------------------------------
# Productos (RF-CVI-006, 007, 023, 025)
# ---------------------------------------------------------------------------


def _validar_fraccionable(es_fraccionable: bool, factor_conversion, unidad_venta: UnidadMedida | None) -> None:
    if not es_fraccionable:
        return
    if factor_conversion is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "es_fraccionable=true requiere factor_conversion (RN-CVI-001)")
    if unidad_venta is not None and not unidad_venta.permite_decimales:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "es_fraccionable=true exige una unidad_venta que admita decimales (RN-CVI-006)",
        )


@router.get("/productos", response_model=list[ProductoBusquedaOut], tags=["productos"])
def buscar_productos(
    sucursal_id: int = Query(
        ..., description="Requerido — resuelve precio_venta_vigente y aplica el scoping del Art. 3.3"
    ),
    q: str | None = Query(None, min_length=1, description="Búsqueda parcial e insensible a mayúsculas sobre el nombre"),
    codigo_barras: str | None = Query(None, description="Coincidencia exacta — lectura de lector de código de barras"),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("producto", "leer")),
):
    """RF-CVI-027 (enmienda v1.4). Hueco real encontrado al construir la
    pantalla de POS del cajero: hasta esta enmienda, 001 solo exponía
    POST/PATCH /productos por `id` ya conocido — ningún endpoint permitía
    buscar un producto por nombre ni por código de barras, así que un
    cajero no podía cobrar nada sin ya saber el id interno de cada
    producto. Devuelve también `precio_venta_vigente`, leído de
    `historial_precio_producto` (003) en modo solo lectura para la
    `sucursal_id` pedida — mismo criterio de lectura entre módulos que 003
    ya aplica contra `historial_costo_producto` de 008. Deliberadamente
    NUNCA expone costo ni margen: eso sigue siendo exclusivo de
    `GET /precios/{id}/margen`, que un cajero no puede leer."""
    verificar_alcance_sucursal(db, current_user, sucursal_id)

    query = db.query(Producto).filter(Producto.activo.is_(True))
    if codigo_barras:
        query = query.filter(Producto.codigo_barras == codigo_barras)
    elif q:
        query = query.filter(func.lower(Producto.nombre).contains(q.lower()))
    productos = query.order_by(Producto.nombre).all()

    nombres_categoria = {c.id: c.nombre for c in db.query(Categoria).all()}
    stock_rows = {
        s.producto_id: s
        for s in db.query(StockSucursal).filter(StockSucursal.sucursal_id == sucursal_id).all()
    }

    resultado: list[ProductoBusquedaOut] = []
    for producto in productos:
        precio_row = (
            db.query(HistorialPrecioProducto)
            .filter(
                HistorialPrecioProducto.producto_id == producto.id,
                HistorialPrecioProducto.sucursal_id == sucursal_id,
            )
            .order_by(HistorialPrecioProducto.vigente_desde.desc())
            .first()
        )
        stock_item = stock_rows.get(producto.id)
        resultado.append(
            ProductoBusquedaOut(
                id=producto.id,
                nombre=producto.nombre,
                codigo_barras=producto.codigo_barras,
                categoria_id=producto.categoria_id,
                categoria_nombre=nombres_categoria.get(producto.categoria_id, ""),
                unidad_venta_codigo=producto.unidad_venta_codigo,
                es_fraccionable=producto.es_fraccionable,
                activo=producto.activo,
                precio_venta_vigente=_money(precio_row.precio_venta) if precio_row else None,
                stock_actual=stock_item.cantidad_disponible if stock_item else None,
                stock_minimo=stock_item.stock_minimo if stock_item else None,
            )
        )
    return resultado


@router.post("/productos", response_model=ProductoOut, status_code=status.HTTP_201_CREATED, tags=["productos"])
def crear_producto(
    payload: ProductoCrearIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("producto", "crear")),
) -> Producto:
    categoria = db.get(Categoria, payload.categoria_id)
    if categoria is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Categoría no encontrada")
    unidad_venta = db.get(UnidadMedida, payload.unidad_venta_codigo)
    if unidad_venta is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unidad de venta '{payload.unidad_venta_codigo}' no existe")
    if db.get(UnidadMedida, payload.unidad_inventario_codigo) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unidad de inventario '{payload.unidad_inventario_codigo}' no existe")

    _validar_fraccionable(payload.es_fraccionable, payload.factor_conversion, unidad_venta)

    es_perecedero = payload.es_perecedero if payload.es_perecedero is not None else categoria.es_perecedero

    producto = Producto(
        nombre=payload.nombre,
        categoria_id=payload.categoria_id,
        codigo_barras=payload.codigo_barras,
        unidad_venta_codigo=payload.unidad_venta_codigo,
        unidad_inventario_codigo=payload.unidad_inventario_codigo,
        es_fraccionable=payload.es_fraccionable,
        factor_conversion=payload.factor_conversion,
        es_perecedero=es_perecedero,
    )
    db.add(producto)
    db.commit()
    db.refresh(producto)
    log_accion(
        db, usuario_id=current_user.id, accion="crear_producto", recurso="producto", recurso_id=producto.id, exitoso=True, request=request
    )
    return producto


@router.patch("/productos/{producto_id}", response_model=ProductoOut, tags=["productos"])
def actualizar_producto(
    producto_id: int,
    payload: ProductoActualizarIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("producto", "actualizar")),
) -> Producto:
    producto = db.get(Producto, producto_id)
    if producto is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Producto no encontrado")

    if payload.categoria_id is not None:
        if db.get(Categoria, payload.categoria_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Categoría no encontrada")
        producto.categoria_id = payload.categoria_id
    if payload.unidad_venta_codigo is not None:
        if db.get(UnidadMedida, payload.unidad_venta_codigo) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unidad de venta '{payload.unidad_venta_codigo}' no existe")
        producto.unidad_venta_codigo = payload.unidad_venta_codigo
    if payload.unidad_inventario_codigo is not None:
        if db.get(UnidadMedida, payload.unidad_inventario_codigo) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unidad de inventario '{payload.unidad_inventario_codigo}' no existe")
        producto.unidad_inventario_codigo = payload.unidad_inventario_codigo
    if payload.nombre is not None:
        producto.nombre = payload.nombre
    if payload.es_fraccionable is not None:
        producto.es_fraccionable = payload.es_fraccionable
    if payload.factor_conversion is not None:
        producto.factor_conversion = payload.factor_conversion
    if payload.es_perecedero is not None:
        producto.es_perecedero = payload.es_perecedero
    if payload.activo is not None:
        producto.activo = payload.activo

    unidad_venta_final = db.get(UnidadMedida, producto.unidad_venta_codigo)
    _validar_fraccionable(producto.es_fraccionable, producto.factor_conversion, unidad_venta_final)

    db.commit()
    db.refresh(producto)
    log_accion(
        db, usuario_id=current_user.id, accion="actualizar_producto", recurso="producto", recurso_id=producto.id, exitoso=True, request=request
    )
    return producto


# ---------------------------------------------------------------------------
# Sustitutos (RF-CVI-018/019, enmienda v1.1) — autorizados contra 'producto'
# ---------------------------------------------------------------------------


@router.post(
    "/productos/{producto_id}/sustitutos",
    response_model=ProductoSustitutoOut,
    status_code=status.HTTP_201_CREATED,
    tags=["productos"],
)
def registrar_producto_sustituto(
    producto_id: int,
    payload: ProductoSustitutoIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("producto", "actualizar")),
) -> ProductoSustitutoOut:
    if payload.producto_sustituto_id == producto_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Un producto no puede ser sustituto de sí mismo (RN-CVI-004)")
    if db.get(Producto, producto_id) is None or db.get(Producto, payload.producto_sustituto_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alguno de los dos productos no existe")

    def _upsert(origen: int, destino: int) -> None:
        fila = (
            db.query(ProductoSustituto)
            .filter_by(producto_id=origen, producto_sustituto_id=destino)
            .first()
        )
        if fila is None:
            db.add(ProductoSustituto(producto_id=origen, producto_sustituto_id=destino))
        else:
            fila.activo = True

    _upsert(producto_id, payload.producto_sustituto_id)
    if payload.simetrico:
        _upsert(payload.producto_sustituto_id, producto_id)
    db.commit()
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="registrar_producto_sustituto",
        recurso="producto",
        recurso_id=producto_id,
        exitoso=True,
        request=request,
        detalle={"producto_sustituto_id": payload.producto_sustituto_id, "simetrico": payload.simetrico},
    )
    return ProductoSustitutoOut(producto_sustituto_id=payload.producto_sustituto_id, activo=True)


@router.get("/productos/{producto_id}/sustitutos", response_model=list[ProductoSustitutoOut], tags=["productos"])
def consultar_producto_sustitutos(
    producto_id: int,
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(require_permission("producto", "leer")),
) -> list[ProductoSustituto]:
    return db.query(ProductoSustituto).filter_by(producto_id=producto_id).all()


# ---------------------------------------------------------------------------
# Layout/anaquel (enmienda 2026-09-05, auditoría de riesgos derivados) —
# huecos #8 y #18 del enunciado ("layout/anaquel limitado"), documentado
# hasta ahora como fuera de alcance explícito.
# ---------------------------------------------------------------------------


def _anaquel_out(db: Session, anaquel: Anaquel) -> AnaquelOut:
    ocupados = db.query(ProductoUbicacion).filter_by(anaquel_id=anaquel.id).count()
    return AnaquelOut(
        id=anaquel.id,
        sucursal_id=anaquel.sucursal_id,
        codigo=anaquel.codigo,
        descripcion=anaquel.descripcion,
        capacidad_maxima=anaquel.capacidad_maxima,
        activo=anaquel.activo,
        productos_asignados=ocupados,
    )


@router.post(
    "/inventario/anaqueles",
    response_model=AnaquelOut,
    status_code=status.HTTP_201_CREATED,
    tags=["inventario"],
)
def registrar_anaquel(
    payload: AnaquelCrearIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("anaquel", "crear")),
) -> AnaquelOut:
    if db.get(Sucursal, payload.sucursal_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sucursal no encontrada")
    verificar_alcance_sucursal(db, current_user, payload.sucursal_id)
    if db.query(Anaquel).filter_by(sucursal_id=payload.sucursal_id, codigo=payload.codigo).first() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya existe un anaquel con ese código en la sucursal")

    anaquel = Anaquel(
        sucursal_id=payload.sucursal_id,
        codigo=payload.codigo,
        descripcion=payload.descripcion,
        capacidad_maxima=payload.capacidad_maxima,
    )
    db.add(anaquel)
    db.commit()
    db.refresh(anaquel)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="registrar_anaquel",
        recurso="anaquel",
        recurso_id=anaquel.id,
        sucursal_id=payload.sucursal_id,
        exitoso=True,
        request=request,
    )
    return _anaquel_out(db, anaquel)


@router.get("/inventario/anaqueles", response_model=list[AnaquelOut], tags=["inventario"])
def listar_anaqueles(
    sucursal_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("anaquel", "leer")),
) -> list[AnaquelOut]:
    verificar_alcance_sucursal(db, current_user, sucursal_id)
    anaqueles = db.query(Anaquel).filter_by(sucursal_id=sucursal_id, activo=True).order_by(Anaquel.codigo).all()
    return [_anaquel_out(db, a) for a in anaqueles]


@router.get("/inventario/anaqueles/{anaquel_id}/productos", response_model=list[ProductoUbicacionOut], tags=["inventario"])
def consultar_productos_en_anaquel(
    anaquel_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("anaquel", "leer")),
) -> list[ProductoUbicacion]:
    anaquel = db.get(Anaquel, anaquel_id)
    if anaquel is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Anaquel no encontrado")
    verificar_alcance_sucursal(db, current_user, anaquel.sucursal_id)
    return db.query(ProductoUbicacion).filter_by(anaquel_id=anaquel_id).all()


@router.put(
    "/productos/{producto_id}/ubicacion",
    response_model=ProductoUbicacionOut,
    tags=["productos"],
)
def asignar_ubicacion_producto(
    producto_id: int,
    payload: ProductoUbicacionAsignarIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("anaquel", "actualizar")),
) -> ProductoUbicacion:
    if db.get(Producto, producto_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Producto no encontrado")
    anaquel = db.get(Anaquel, payload.anaquel_id)
    if anaquel is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Anaquel no encontrado")
    if anaquel.sucursal_id != payload.sucursal_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "El anaquel no pertenece a la sucursal indicada")
    verificar_alcance_sucursal(db, current_user, payload.sucursal_id)

    existente = db.query(ProductoUbicacion).filter_by(producto_id=producto_id, sucursal_id=payload.sucursal_id).first()

    # RN-CVI-010: el anaquel es un espacio físico limitado — si declara
    # capacidad_maxima, no se puede asignar un producto nuevo que la
    # supere. Una reasignación del mismo producto al mismo anaquel no
    # cuenta dos veces contra el cupo.
    if anaquel.capacidad_maxima is not None and (existente is None or existente.anaquel_id != anaquel.id):
        ocupados = db.query(ProductoUbicacion).filter_by(anaquel_id=anaquel.id).count()
        if ocupados >= anaquel.capacidad_maxima:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"El anaquel {anaquel.codigo} ya está en su capacidad máxima "
                f"({anaquel.capacidad_maxima} productos) — RN-CVI-010",
            )

    if existente is None:
        existente = ProductoUbicacion(
            producto_id=producto_id,
            sucursal_id=payload.sucursal_id,
            anaquel_id=payload.anaquel_id,
            asignado_por=current_user.id,
        )
        db.add(existente)
    else:
        existente.anaquel_id = payload.anaquel_id
        existente.asignado_por = current_user.id
        existente.actualizado_en = datetime.utcnow()

    db.commit()
    db.refresh(existente)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="asignar_ubicacion_producto",
        recurso="anaquel",
        recurso_id=payload.anaquel_id,
        sucursal_id=payload.sucursal_id,
        exitoso=True,
        request=request,
        detalle={"producto_id": producto_id},
    )
    return existente


@router.get("/productos/{producto_id}/ubicacion", response_model=ProductoUbicacionOut, tags=["productos"])
def consultar_ubicacion_producto(
    producto_id: int,
    sucursal_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("anaquel", "leer")),
) -> ProductoUbicacion:
    verificar_alcance_sucursal(db, current_user, sucursal_id)
    ubicacion = db.query(ProductoUbicacion).filter_by(producto_id=producto_id, sucursal_id=sucursal_id).first()
    if ubicacion is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "El producto no tiene ubicación de anaquel asignada en esa sucursal")
    return ubicacion


# ---------------------------------------------------------------------------
# Inventario (RF-CVI-008 a 016, 021, 022)
# ---------------------------------------------------------------------------


@router.post("/inventario/ingresos", status_code=status.HTTP_201_CREATED, tags=["inventario"])
def registrar_ingreso_stock(
    payload: IngresoStockIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("inventario", "crear")),
):
    producto = db.get(Producto, payload.producto_id)
    if producto is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Producto no encontrado")
    if db.get(Sucursal, payload.sucursal_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sucursal no encontrada")
    verificar_alcance_sucursal(db, current_user, payload.sucursal_id)

    cantidad = _qty(payload.cantidad)
    stock = db.query(StockSucursal).filter_by(producto_id=payload.producto_id, sucursal_id=payload.sucursal_id).first()
    if stock is None:
        stock = StockSucursal(producto_id=payload.producto_id, sucursal_id=payload.sucursal_id, cantidad_disponible=Decimal("0"))
        db.add(stock)
    stock.cantidad_disponible = _qty(stock.cantidad_disponible + cantidad)
    stock.actualizado_en = datetime.utcnow()

    # RF-CVI-009: solo perecedero + fecha_caducidad enviada crea lote — un
    # producto no perecedero con fecha enviada por error no genera nada (T009).
    lote: LoteProducto | None = None
    if producto.es_perecedero and payload.fecha_caducidad is not None:
        lote = LoteProducto(
            producto_id=payload.producto_id,
            sucursal_id=payload.sucursal_id,
            fecha_caducidad=payload.fecha_caducidad,
            cantidad_lote=cantidad,
            cantidad_restante=cantidad,
        )
        db.add(lote)

    db.commit()
    db.refresh(stock)
    if lote is not None:
        db.refresh(lote)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="registrar_ingreso_stock",
        recurso="inventario",
        recurso_id=stock.id,
        sucursal_id=payload.sucursal_id,
        exitoso=True,
        request=request,
        detalle={"producto_id": payload.producto_id, "cantidad": str(cantidad), "lote_creado": lote is not None},
    )
    return {
        "producto_id": payload.producto_id,
        "sucursal_id": payload.sucursal_id,
        "cantidad_disponible": stock.cantidad_disponible,
        "lote_id": lote.id if lote is not None else None,
    }


@router.get("/inventario/proximos-a-caducar", response_model=list[LoteOut], tags=["inventario"])
def consultar_proximos_a_caducar(
    sucursal_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("inventario", "leer")),
) -> list[LoteProducto]:
    verificar_alcance_sucursal(db, current_user, sucursal_id)
    limite = date.today() + timedelta(days=DIAS_ALERTA_CADUCIDAD)
    return (
        db.query(LoteProducto)
        .filter(
            LoteProducto.sucursal_id == sucursal_id,
            LoteProducto.retirado_en.is_(None),
            LoteProducto.cantidad_restante > 0,
            LoteProducto.fecha_caducidad <= limite,
        )
        .order_by(LoteProducto.fecha_caducidad.asc())
        .all()
    )


@router.patch("/inventario/lotes/{lote_id}/retiro", response_model=LoteOut, tags=["inventario"])
def registrar_retiro_lote(
    lote_id: int,
    payload: RetiroLoteIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("inventario", "actualizar")),
) -> LoteProducto:
    lote = db.get(LoteProducto, lote_id)
    if lote is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Lote no encontrado")

    cantidad_retirada = _qty(payload.cantidad_retirada)
    if cantidad_retirada > lote.cantidad_restante:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "cantidad_retirada mayor a cantidad_restante")

    stock = db.query(StockSucursal).filter_by(producto_id=lote.producto_id, sucursal_id=lote.sucursal_id).first()
    if stock is None or stock.cantidad_disponible < cantidad_retirada:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "El retiro dejaría el stock de la sucursal en negativo (RN-CVI-002)")

    lote.cantidad_restante = _qty(lote.cantidad_restante - cantidad_retirada)
    lote.motivo_retiro = payload.motivo_retiro
    if lote.cantidad_restante == 0:
        lote.retirado_en = datetime.utcnow()
    stock.cantidad_disponible = _qty(stock.cantidad_disponible - cantidad_retirada)
    stock.actualizado_en = datetime.utcnow()

    db.commit()
    db.refresh(lote)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="registrar_retiro_lote",
        recurso="inventario",
        recurso_id=lote.id,
        sucursal_id=lote.sucursal_id,
        exitoso=True,
        request=request,
        detalle={"cantidad_retirada": str(cantidad_retirada), "motivo_retiro": payload.motivo_retiro},
    )
    return lote


@router.get("/inventario/stock/{producto_id}", response_model=StockOut, tags=["inventario"])
def consultar_stock(
    producto_id: int,
    sucursal_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("inventario", "leer")),
) -> StockOut:
    if db.get(Producto, producto_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Producto no encontrado")
    verificar_alcance_sucursal(db, current_user, sucursal_id)

    stock = db.query(StockSucursal).filter_by(producto_id=producto_id, sucursal_id=sucursal_id).first()
    if stock is None:
        return StockOut(
            producto_id=producto_id, sucursal_id=sucursal_id, cantidad_disponible=Decimal("0"),
            stock_minimo=Decimal("0"), dias_sin_venta=0, marcado_sin_rotacion=False,
        )
    return StockOut(
        producto_id=producto_id,
        sucursal_id=sucursal_id,
        cantidad_disponible=stock.cantidad_disponible,
        stock_minimo=stock.stock_minimo,
        dias_sin_venta=stock.dias_sin_venta,
        marcado_sin_rotacion=stock.marcado_sin_rotacion,
    )


@router.post("/inventario/ajustes", response_model=AjusteInventarioOut, status_code=status.HTTP_201_CREATED, tags=["inventario"])
def registrar_ajuste_inventario(
    payload: AjusteInventarioIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("inventario", "crear")),
) -> AjusteInventario:
    if db.get(Producto, payload.producto_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Producto no encontrado")
    if db.get(Sucursal, payload.sucursal_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sucursal no encontrada")
    verificar_alcance_sucursal(db, current_user, payload.sucursal_id)

    stock = db.query(StockSucursal).filter_by(producto_id=payload.producto_id, sucursal_id=payload.sucursal_id).first()
    actual = stock.cantidad_disponible if stock is not None else Decimal("0")
    nueva_cantidad = _qty(actual + payload.cantidad_ajuste)
    if nueva_cantidad < 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "El ajuste dejaría cantidad_disponible en negativo")

    if stock is None:
        stock = StockSucursal(producto_id=payload.producto_id, sucursal_id=payload.sucursal_id, cantidad_disponible=Decimal("0"))
        db.add(stock)
    stock.cantidad_disponible = nueva_cantidad
    stock.actualizado_en = datetime.utcnow()

    ajuste = AjusteInventario(
        producto_id=payload.producto_id,
        sucursal_id=payload.sucursal_id,
        cantidad_ajuste=_qty(payload.cantidad_ajuste),
        motivo=payload.motivo,
        usuario_id=current_user.id,
    )
    db.add(ajuste)
    db.commit()
    db.refresh(ajuste)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="registrar_ajuste_inventario",
        recurso="inventario",
        recurso_id=ajuste.id,
        sucursal_id=payload.sucursal_id,
        exitoso=True,
        request=request,
    )
    return ajuste


@router.post("/inventario/rotacion/evaluar", tags=["inventario"])
def evaluar_rotacion(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("inventario", "actualizar")),
):
    """RF-CVI-015: proceso batch — nunca marca/desmarca manualmente. Alcance
    respetado: un rol sin alcance_cadena solo evalúa sus propias sucursales."""

    rol = db.get(Rol, current_user.rol)
    query = db.query(StockSucursal)
    if rol is None or not rol.alcance_cadena:
        sucursal_ids = [
            row.sucursal_id for row in db.query(UsuarioSucursal.sucursal_id).filter_by(usuario_id=current_user.id).all()
        ]
        query = query.filter(StockSucursal.sucursal_id.in_(sucursal_ids))

    ultima_venta_subq = (
        db.query(func.max(Venta.fecha_hora))
        .join(DetalleVenta, DetalleVenta.venta_id == Venta.id)
        .filter(
            DetalleVenta.producto_id == StockSucursal.producto_id,
            Venta.sucursal_id == StockSucursal.sucursal_id,
            Venta.estado_venta == "completada",
        )
        .correlate(StockSucursal)
        .scalar_subquery()
    )

    ahora = datetime.utcnow()
    procesados = 0
    marcados = 0
    for stock, ultima_venta in query.add_columns(ultima_venta_subq).all():
        if ultima_venta is not None:
            dias = (ahora - ultima_venta).days
        else:
            producto = db.get(Producto, stock.producto_id)
            dias = (ahora - producto.creado_en).days if producto is not None else 0
        stock.dias_sin_venta = dias
        stock.marcado_sin_rotacion = dias >= UMBRAL_DIAS_SIN_ROTACION
        stock.actualizado_en = ahora
        procesados += 1
        if stock.marcado_sin_rotacion:
            marcados += 1
    db.commit()
    return {"procesados": procesados, "marcados_sin_rotacion": marcados, "umbral_dias": UMBRAL_DIAS_SIN_ROTACION}


@router.get("/inventario/sin-rotacion", response_model=list[StockOut], tags=["inventario"])
def consultar_sin_rotacion(
    sucursal_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("inventario", "leer")),
) -> list[StockOut]:
    verificar_alcance_sucursal(db, current_user, sucursal_id)
    filas = db.query(StockSucursal).filter_by(sucursal_id=sucursal_id, marcado_sin_rotacion=True).all()
    return [
        StockOut(
            producto_id=f.producto_id,
            sucursal_id=sucursal_id,
            cantidad_disponible=f.cantidad_disponible,
            stock_minimo=f.stock_minimo,
            dias_sin_venta=f.dias_sin_venta,
            marcado_sin_rotacion=f.marcado_sin_rotacion,
        )
        for f in filas
    ]


@router.patch("/inventario/stock/{producto_id}/minimo", response_model=StockOut, tags=["inventario"])
def actualizar_stock_minimo(
    producto_id: int,
    payload: StockMinimoIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("inventario", "actualizar")),
) -> StockOut:
    if db.get(Producto, producto_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Producto no encontrado")
    verificar_alcance_sucursal(db, current_user, payload.sucursal_id)

    stock = db.query(StockSucursal).filter_by(producto_id=producto_id, sucursal_id=payload.sucursal_id).first()
    if stock is None:
        stock = StockSucursal(producto_id=producto_id, sucursal_id=payload.sucursal_id, cantidad_disponible=Decimal("0"))
        db.add(stock)
    stock.stock_minimo = _qty(payload.stock_minimo)
    db.commit()
    db.refresh(stock)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="actualizar_stock_minimo",
        recurso="inventario",
        recurso_id=stock.id,
        sucursal_id=payload.sucursal_id,
        exitoso=True,
        request=request,
    )
    return StockOut(
        producto_id=producto_id,
        sucursal_id=payload.sucursal_id,
        cantidad_disponible=stock.cantidad_disponible,
        stock_minimo=stock.stock_minimo,
        dias_sin_venta=stock.dias_sin_venta,
        marcado_sin_rotacion=stock.marcado_sin_rotacion,
    )


@router.get("/inventario/stock-bajo", response_model=list[StockBajoOut], tags=["inventario"])
def consultar_stock_bajo(
    sucursal_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("inventario", "leer")),
) -> list[StockBajoOut]:
    verificar_alcance_sucursal(db, current_user, sucursal_id)
    filas = (
        db.query(StockSucursal)
        .filter(StockSucursal.sucursal_id == sucursal_id, StockSucursal.cantidad_disponible < StockSucursal.stock_minimo)
        .all()
    )
    return [
        StockBajoOut(producto_id=f.producto_id, cantidad_disponible=f.cantidad_disponible, stock_minimo=f.stock_minimo)
        for f in filas
    ]


# ---------------------------------------------------------------------------
# Catálogos (RF-CVI-024 a 026, enmienda v1.3) — solo `categoria` escribe
# ---------------------------------------------------------------------------


@router.get("/catalogos/categorias", response_model=list[CategoriaOut], tags=["catalogos"])
def listar_categorias(
    solo_activas: bool = Query(True),
    como_arbol: bool = Query(False),
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(get_current_user),
) -> list[CategoriaOut]:
    query = db.query(Categoria)
    if solo_activas:
        query = query.filter(Categoria.activo.is_(True))
    filas = query.order_by(Categoria.nombre).all()

    if not como_arbol:
        return [CategoriaOut.model_validate(c) for c in filas]

    por_padre: dict[int | None, list[Categoria]] = {}
    for c in filas:
        por_padre.setdefault(c.categoria_padre_id, []).append(c)

    def _armar(c: Categoria) -> CategoriaOut:
        salida = CategoriaOut.model_validate(c)
        salida.subcategorias = [_armar(hijo) for hijo in por_padre.get(c.id, [])]
        return salida

    raices = [c for c in filas if c.categoria_padre_id is None]
    return [_armar(r) for r in raices]


@router.post("/catalogos/categorias", response_model=CategoriaOut, status_code=status.HTTP_201_CREATED, tags=["catalogos"])
def crear_categoria(
    payload: CategoriaCrearIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("producto", "crear")),
) -> Categoria:
    if db.query(Categoria).filter_by(nombre=payload.nombre).first() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya existe una categoría con ese nombre")

    if payload.categoria_padre_id is not None:
        padre = db.get(Categoria, payload.categoria_padre_id)
        if padre is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Categoría padre no encontrada")
        if padre.categoria_padre_id is not None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "La categoría padre ya tiene padre — la jerarquía admite dos niveles (RN-CVI-008)",
            )

    categoria = Categoria(
        nombre=payload.nombre, categoria_padre_id=payload.categoria_padre_id, es_perecedero=payload.es_perecedero
    )
    db.add(categoria)
    db.commit()
    db.refresh(categoria)
    log_accion(
        db, usuario_id=current_user.id, accion="crear_categoria", recurso="producto", recurso_id=categoria.id, exitoso=True, request=request
    )
    return categoria


@router.patch("/catalogos/categorias/{categoria_id}", response_model=CategoriaOut, tags=["catalogos"])
def actualizar_categoria(
    categoria_id: int,
    payload: CategoriaActualizarIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("producto", "actualizar")),
) -> Categoria:
    categoria = db.get(Categoria, categoria_id)
    if categoria is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Categoría no encontrada")

    if payload.categoria_padre_id is not None:
        if payload.categoria_padre_id == categoria_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Una categoría no puede ser su propia padre (RN-CVI-007)")
        padre = db.get(Categoria, payload.categoria_padre_id)
        if padre is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Categoría padre no encontrada")
        if padre.categoria_padre_id is not None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "La categoría padre ya tiene padre — la jerarquía admite dos niveles (RN-CVI-008)",
            )
        tiene_hijos = db.query(Categoria).filter(Categoria.categoria_padre_id == categoria_id).first() is not None
        if tiene_hijos:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Esta categoría ya tiene subcategorías propias — no puede convertirse en subcategoría de otra (RN-CVI-008)",
            )
        categoria.categoria_padre_id = payload.categoria_padre_id

    if payload.nombre is not None:
        duplicado = db.query(Categoria).filter(Categoria.nombre == payload.nombre, Categoria.id != categoria_id).first()
        if duplicado is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "Ya existe una categoría con ese nombre")
        categoria.nombre = payload.nombre

    if payload.es_perecedero is not None:
        categoria.es_perecedero = payload.es_perecedero

    if payload.activo is not None:
        if payload.activo is False:
            tiene_productos_activos = (
                db.query(Producto).filter(Producto.categoria_id == categoria_id, Producto.activo.is_(True)).first()
                is not None
            )
            if tiene_productos_activos:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    "No se puede dar de baja una categoría con productos activos — reasígnelos primero",
                )
        categoria.activo = payload.activo

    db.commit()
    db.refresh(categoria)
    log_accion(
        db, usuario_id=current_user.id, accion="actualizar_categoria", recurso="producto", recurso_id=categoria.id, exitoso=True, request=request
    )
    return categoria


@router.get("/catalogos/unidades-medida", response_model=list[UnidadMedidaOut], tags=["catalogos"])
def listar_unidades_medida(
    db: Session = Depends(get_db), _current_user: Usuario = Depends(get_current_user)
) -> list[UnidadMedida]:
    return db.query(UnidadMedida).order_by(UnidadMedida.orden).all()


@router.get("/catalogos/metodos-pago", response_model=list[MetodoPagoOut], tags=["catalogos"])
def listar_metodos_pago(
    db: Session = Depends(get_db), _current_user: Usuario = Depends(get_current_user)
) -> list[MetodoPago]:
    return db.query(MetodoPago).filter_by(activo=True).order_by(MetodoPago.orden).all()


@router.get("/catalogos/estados-venta", response_model=list[EstadoVentaOut], tags=["catalogos"])
def listar_estados_venta(
    db: Session = Depends(get_db), _current_user: Usuario = Depends(get_current_user)
) -> list[EstadoVenta]:
    return db.query(EstadoVenta).order_by(EstadoVenta.orden).all()
