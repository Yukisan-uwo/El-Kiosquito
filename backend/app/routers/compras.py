"""
Router del módulo 008-compras-proveedores — proveedor, orden de compra
(estado derivado del log de recepciones), recepciones por evento,
historial de costo por producto/proveedor, y la validación de compras
por oferta contra el pronóstico de demanda de 004-pronostico-demanda.
Implementa el contrato el-kiosquito-008-compras-proveedores-contracts-
openapi.yaml.

RBAC: la matriz real de 008 tiene 2 recursos: `proveedor` y
`orden_compra` (este último cubre a la vez orden, detalle, recepciones
e historial de costo — ninguno tiene recurso propio en la matriz
sembrada). `dueno` y `encargado_compras` tienen CRUD completo sobre
ambos recursos (compras es literalmente el dueño operativo de este
módulo). `encargado_sucursal` solo lee `proveedor` (necesita saber a
quién le llega el pedido) pero SÍ puede `actualizar` `orden_compra`
(registra recepciones en su local — nunca crea ni cancela una orden,
ese verbo es `crear`, que no tiene). `cajero` no tiene acceso a nada de
este módulo — no es parte de su operación en el POS.

`consultarPronosticoParaCompra` y las consultas de costo se autorizaron
contra `orden_compra`/`leer` — son lecturas que solo tienen sentido en
el flujo de compras, no llevan recurso propio en la matriz.

**Bug real encontrado y corregido al probar este módulo** (no en el
esquema original, en el CHECK de la migración): `detalle_orden_compra`
traía `ck_detalle_oc_motivo_desvio_pronostico` — exige que si
`cantidad_pedida > cantidad_recomendada_pronostico`, `motivo_no_siguio_
pronostico` ya esté presente. Pero el flujo real es: (1)
`consultarPronosticoParaCompra?detalle_id=` graba el snapshot de la
recomendación en el mismo momento en que la excede se descubre, y (2)
recién ahí el usuario puede llamar `PATCH .../motivo-oferta` para
justificarlo. El paso (1) por sí solo ya viola el CHECK (no es
diferible) — un 500 real, confirmado en vivo. Se corrigió con una
migración nueva que elimina el CHECK y traslada RN-CP-001 enteramente
al servicio, exigido en el único punto donde de verdad importa: antes
de aceptar una recepción (`registrarRecepcion`), nunca al guardar el
snapshot del pronóstico. Mismo patrón que reglas inter-tabla no
expresables como CHECK de una sola fila en otros módulos (ej.
RN-CVI-006): se documentan en el modelo, se validan en servicio.

**Brecha real encontrada y corregida al armar la pantalla de frontend
de Compras (Tarea #57, enmienda v1.3 de 008)**: no existía ningún GET
de listado — ni `/proveedores` ni `/compras/ordenes` — solo altas y
consultas puntuales por id de producto. Sin listado, una pantalla real
no puede ofrecer un selector de proveedor (obligaría a escribir el id
a mano) ni encontrar el `detalle_id` de una orden ya creada para
registrarle una recepción. Se verificó primero la matriz RBAC real
(`proveedor/leer` y `orden_compra/leer` ya estaban concedidos a
dueño/encargado_compras/encargado_sucursal desde la siembra original)
— igual que el gap de búsqueda de clientes de 002 (RF-CF-013), **no
hizo falta ninguna migración**. `listarOrdenesCompra` sigue el mismo
patrón de alcance por sucursal que `evaluarRotacion` de 001
(`core_ventas.py`): si se pide `sucursal_id` se valida con
`verificar_alcance_sucursal`; si se omite, un rol con `alcance_cadena`
ve toda la red y uno sin ella queda automáticamente acotado a sus
propias sucursales vía `usuario_sucursal` — nunca a los claims del JWT.
"""

from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, log_accion, require_permission
from app.database import get_db
from app.models.administracion import Rol, Usuario, UsuarioSucursal
from app.models.compras import (
    DetalleOrdenCompra,
    EstadoOrdenCompra,
    FormaPago,
    HistorialCostoProducto,
    OrdenCompra,
    Proveedor,
    RecepcionOrdenCompra,
)
from app.models.core_ventas import Producto
from app.models.expansion import Sucursal
from app.models.pronostico import PronosticoDemanda
from app.schemas.compras import (
    DetalleOrdenCompraOut,
    EstadoOrdenCompraOut,
    FormaPagoOut,
    HistorialCostoOut,
    MotivoOfertaIn,
    OrdenCompraCrearIn,
    OrdenCompraOut,
    PronosticoParaCompraOut,
    ProveedorActualizarIn,
    ProveedorCrearIn,
    ProveedorOut,
    RecepcionCrearIn,
)
from app.services.scoping import verificar_alcance_sucursal

router = APIRouter()




def _cantidad_recibida(db: Session, detalle_id: int) -> Decimal:
    total = (
        db.query(func.coalesce(func.sum(RecepcionOrdenCompra.cantidad_recibida_evento), 0))
        .filter(RecepcionOrdenCompra.detalle_orden_compra_id == detalle_id)
        .scalar()
    )
    return Decimal(str(total))


def _detalle_out(db: Session, detalle: DetalleOrdenCompra) -> DetalleOrdenCompraOut:
    return DetalleOrdenCompraOut(
        id=detalle.id,
        producto_id=detalle.producto_id,
        cantidad_pedida=Decimal(str(detalle.cantidad_pedida)),
        cantidad_recibida=_cantidad_recibida(db, detalle.id),
        precio_ofrecido=Decimal(str(detalle.precio_ofrecido)),
        pronostico_consultado=detalle.pronostico_consultado,
        motivo_no_siguio_pronostico=detalle.motivo_no_siguio_pronostico,
    )


def _orden_out(db: Session, orden: OrdenCompra) -> OrdenCompraOut:
    detalles = db.query(DetalleOrdenCompra).filter(DetalleOrdenCompra.orden_compra_id == orden.id).order_by(DetalleOrdenCompra.id).all()
    return OrdenCompraOut(
        id=orden.id,
        proveedor_id=orden.proveedor_id,
        sucursal_id=orden.sucursal_id,
        fecha_pedido=orden.fecha_pedido,
        es_oferta=orden.es_oferta,
        forma_pago=orden.forma_pago,
        estado=orden.estado,
        items=[_detalle_out(db, d) for d in detalles],
    )


# ---------------------------------------------------------------------------
# Proveedores (OO-CP01, OO-CP09)
# ---------------------------------------------------------------------------


@router.get("/proveedores", response_model=list[ProveedorOut], tags=["compras"])
def listar_proveedores(
    activo: bool | None = Query(None, description="Filtrar por activo/inactivo; si se omite, trae todos"),
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(require_permission("proveedor", "leer")),
) -> list[Proveedor]:
    """RF-CP-017 (enmienda v1.3, Tarea #57). `proveedor` no tiene
    `sucursal_id` — es una entidad de toda la cadena, así que este
    listado nunca se scopea por sucursal, a diferencia de las órdenes."""
    query = db.query(Proveedor)
    if activo is not None:
        query = query.filter(Proveedor.activo == activo)
    return query.order_by(Proveedor.nombre).all()


@router.post("/proveedores", response_model=ProveedorOut, status_code=status.HTTP_201_CREATED, tags=["compras"])
def registrar_proveedor(
    payload: ProveedorCrearIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("proveedor", "crear")),
) -> Proveedor:
    proveedor = Proveedor(nombre=payload.nombre, contacto=payload.contacto, activo=True)
    db.add(proveedor)
    db.commit()
    db.refresh(proveedor)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="registrar_proveedor",
        recurso="proveedor",
        recurso_id=proveedor.id,
        exitoso=True,
        request=request,
        detalle={"nombre": payload.nombre},
    )
    return proveedor


@router.patch("/proveedores/{id}", response_model=ProveedorOut, tags=["compras"])
def actualizar_proveedor(
    id: int,
    payload: ProveedorActualizarIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("proveedor", "actualizar")),
) -> Proveedor:
    proveedor = db.get(Proveedor, id)
    if proveedor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Proveedor no encontrado")

    datos = payload.model_dump(exclude_unset=True)
    if "nombre" in datos:
        proveedor.nombre = datos["nombre"]
    if "contacto" in datos:
        proveedor.contacto = datos["contacto"]
    db.commit()
    db.refresh(proveedor)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="actualizar_proveedor",
        recurso="proveedor",
        recurso_id=proveedor.id,
        exitoso=True,
        request=request,
        detalle=datos,
    )
    return proveedor


@router.patch("/proveedores/{id}/desactivar", response_model=ProveedorOut, tags=["compras"])
def desactivar_proveedor(
    id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("proveedor", "actualizar")),
) -> Proveedor:
    proveedor = db.get(Proveedor, id)
    if proveedor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Proveedor no encontrado")
    if not proveedor.activo:
        raise HTTPException(status.HTTP_409_CONFLICT, "El proveedor ya está desactivado")

    # RF-CP-011: solo bloquea NUEVAS órdenes con este proveedor — sus
    # órdenes ya creadas se siguen pudiendo recibir con normalidad.
    proveedor.activo = False
    db.commit()
    db.refresh(proveedor)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="desactivar_proveedor",
        recurso="proveedor",
        recurso_id=proveedor.id,
        exitoso=True,
        request=request,
    )
    return proveedor


# ---------------------------------------------------------------------------
# Órdenes de compra y recepciones (OO-CP02, OO-CP03, OO-CP04)
# ---------------------------------------------------------------------------


@router.get("/compras/ordenes", response_model=list[OrdenCompraOut], tags=["compras"])
def listar_ordenes_compra(
    sucursal_id: int | None = Query(None, description="Si se omite y el rol no tiene alcance de cadena, se acota a las sucursales del usuario"),
    estado: str | None = Query(None),
    proveedor_id: int | None = Query(None),
    limite: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("orden_compra", "leer")),
) -> list[OrdenCompraOut]:
    """RF-CP-018 (enmienda v1.3, Tarea #57). Mismo patrón de alcance que
    `evaluarRotacion` de 001 (core_ventas.py): con `sucursal_id` se
    valida contra `verificar_alcance_sucursal` (pasa siempre para un rol
    de alcance_cadena); sin `sucursal_id`, un rol sin alcance_cadena se
    acota automáticamente a sus propias sucursales vía `usuario_sucursal`
    — nunca a los claims `sucursal_ids` del JWT (Art. 3.3)."""
    query = db.query(OrdenCompra)
    if sucursal_id is not None:
        verificar_alcance_sucursal(db, current_user, sucursal_id)
        query = query.filter(OrdenCompra.sucursal_id == sucursal_id)
    else:
        rol = db.get(Rol, current_user.rol)
        if rol is None or not rol.alcance_cadena:
            sucursal_ids = [
                row.sucursal_id
                for row in db.query(UsuarioSucursal.sucursal_id).filter_by(usuario_id=current_user.id).all()
            ]
            query = query.filter(OrdenCompra.sucursal_id.in_(sucursal_ids))
    if estado is not None:
        query = query.filter(OrdenCompra.estado == estado)
    if proveedor_id is not None:
        query = query.filter(OrdenCompra.proveedor_id == proveedor_id)

    ordenes = query.order_by(OrdenCompra.fecha_pedido.desc()).limit(limite).all()
    return [_orden_out(db, o) for o in ordenes]


@router.post("/compras/ordenes", response_model=OrdenCompraOut, status_code=status.HTTP_201_CREATED, tags=["compras"])
def crear_orden_compra(
    payload: OrdenCompraCrearIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("orden_compra", "crear")),
) -> OrdenCompraOut:
    proveedor = db.get(Proveedor, payload.proveedor_id)
    if proveedor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Proveedor no encontrado")
    if not proveedor.activo:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "El proveedor está dado de baja — no se pueden crear nuevas órdenes con él (RF-CP-011)",
        )
    if db.get(Sucursal, payload.sucursal_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sucursal no encontrada")
    verificar_alcance_sucursal(db, current_user, payload.sucursal_id)

    if db.get(FormaPago, payload.forma_pago) is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, f"forma_pago '{payload.forma_pago}' no existe en el catálogo"
        )

    for item in payload.items:
        if db.get(Producto, item.producto_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"producto_id {item.producto_id} no encontrado")

    orden = OrdenCompra(
        proveedor_id=payload.proveedor_id,
        sucursal_id=payload.sucursal_id,
        creado_por=current_user.id,
        es_oferta=payload.es_oferta,
        forma_pago=payload.forma_pago,
        estado="pendiente",
    )
    db.add(orden)
    db.flush()

    for item in payload.items:
        db.add(
            DetalleOrdenCompra(
                orden_compra_id=orden.id,
                producto_id=item.producto_id,
                cantidad_pedida=item.cantidad_pedida,
                precio_ofrecido=item.precio_ofrecido,
            )
        )
    db.commit()
    db.refresh(orden)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="crear_orden_compra",
        recurso="orden_compra",
        recurso_id=orden.id,
        sucursal_id=payload.sucursal_id,
        exitoso=True,
        request=request,
        detalle={"proveedor_id": payload.proveedor_id, "es_oferta": payload.es_oferta, "items": len(payload.items)},
    )
    return _orden_out(db, orden)


@router.post(
    "/compras/ordenes/{detalle_id}/recepciones",
    response_model=OrdenCompraOut,
    status_code=status.HTTP_201_CREATED,
    tags=["compras"],
)
def registrar_recepcion(
    detalle_id: int,
    payload: RecepcionCrearIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("orden_compra", "actualizar")),
) -> OrdenCompraOut:
    detalle = db.get(DetalleOrdenCompra, detalle_id)
    if detalle is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Línea de orden de compra no encontrada")
    orden = db.get(OrdenCompra, detalle.orden_compra_id)
    verificar_alcance_sucursal(db, current_user, orden.sucursal_id)

    # RN-CP-002: si la orden admite más recepciones se lee del catálogo,
    # nunca de comparar el código de estado a mano.
    estado_actual = db.get(EstadoOrdenCompra, orden.estado)
    if estado_actual is None or not estado_actual.permite_recepcion:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"La orden está en estado '{orden.estado}' y no admite más recepciones (RN-CP-002)",
        )

    # RN-CP-001: una orden por oferta exige haber consultado el
    # pronóstico para CADA línea antes de poder recibirla, y si la
    # cantidad pedida excede la recomendación (o no había datos
    # suficientes), exige además un motivo — verificado acá, en el único
    # punto donde de verdad hay que bloquear el flujo (ver docstring del
    # módulo sobre el CHECK que se retiró de la migración).
    if orden.es_oferta:
        if not detalle.pronostico_consultado:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Debe consultar el pronóstico de demanda de este producto antes de recibirlo (RN-CP-001)",
            )
        recomendada = detalle.cantidad_recomendada_pronostico
        excede = recomendada is None or Decimal(str(detalle.cantidad_pedida)) > Decimal(str(recomendada))
        if excede and not detalle.motivo_no_siguio_pronostico:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "La cantidad pedida excede la recomendación del pronóstico (o no había datos suficientes); "
                "registre un motivo antes de recibir (RN-CP-001)",
            )

    db.add(
        RecepcionOrdenCompra(
            detalle_orden_compra_id=detalle_id,
            cantidad_recibida_evento=payload.cantidad_recibida_evento,
            numero_documento_proveedor=payload.numero_documento_proveedor,
            usuario_id=current_user.id,
        )
    )
    # RF-CP-006: cada recepción alimenta el historial de costo con el
    # precio pactado en la línea — nunca se corrige un costo ya
    # registrado, se agrega uno nuevo (RNF-CP-002).
    db.add(
        HistorialCostoProducto(
            producto_id=detalle.producto_id,
            proveedor_id=orden.proveedor_id,
            costo=detalle.precio_ofrecido,
            orden_compra_id=orden.id,
        )
    )
    db.flush()

    # RF-CP-004/005: el estado se recalcula sumando TODOS los eventos de
    # recepción de TODAS las líneas — nunca un contador incrementado a mano.
    detalles_orden = db.query(DetalleOrdenCompra).filter(DetalleOrdenCompra.orden_compra_id == orden.id).all()
    todas_completas = all(
        _cantidad_recibida(db, d.id) >= Decimal(str(d.cantidad_pedida)) for d in detalles_orden
    )
    orden.estado = "recibida_completa" if todas_completas else "recibida_parcial"
    db.commit()
    db.refresh(orden)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="registrar_recepcion",
        recurso="orden_compra",
        recurso_id=orden.id,
        sucursal_id=orden.sucursal_id,
        exitoso=True,
        request=request,
        detalle={"detalle_id": detalle_id, "cantidad_recibida_evento": str(payload.cantidad_recibida_evento)},
    )
    return _orden_out(db, orden)


# ---------------------------------------------------------------------------
# Historial y comparativa de costo (OO-CP05, OO-CP06)
# ---------------------------------------------------------------------------


@router.get(
    "/compras/productos/{producto_id}/historial-costo", response_model=list[HistorialCostoOut], tags=["compras"]
)
def consultar_historial_costo(
    producto_id: int,
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(require_permission("orden_compra", "leer")),
) -> list[HistorialCostoProducto]:
    if db.get(Producto, producto_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Producto no encontrado")
    return (
        db.query(HistorialCostoProducto)
        .filter(HistorialCostoProducto.producto_id == producto_id)
        .order_by(HistorialCostoProducto.fecha.desc())
        .all()
    )


@router.get(
    "/compras/productos/{producto_id}/comparativa-proveedores",
    response_model=list[HistorialCostoOut],
    tags=["compras"],
)
def consultar_comparativa_proveedores(
    producto_id: int,
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(require_permission("orden_compra", "leer")),
) -> list[HistorialCostoProducto]:
    if db.get(Producto, producto_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Producto no encontrado")
    # Decisión 2 de research.md: el costo más reciente por cada proveedor,
    # nunca un promedio ni un histórico completo.
    return (
        db.query(HistorialCostoProducto)
        .filter(HistorialCostoProducto.producto_id == producto_id)
        .order_by(HistorialCostoProducto.proveedor_id, HistorialCostoProducto.fecha.desc())
        .distinct(HistorialCostoProducto.proveedor_id)
        .all()
    )


# ---------------------------------------------------------------------------
# Pronóstico para validar compras por oferta (OO-CP07, OO-CP08, RN-CP-001)
# ---------------------------------------------------------------------------


@router.get(
    "/compras/productos/{producto_id}/pronostico", response_model=PronosticoParaCompraOut, tags=["compras"]
)
def consultar_pronostico_para_compra(
    producto_id: int,
    sucursal_id: int = Query(...),
    detalle_id: int | None = Query(None),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("orden_compra", "leer")),
) -> PronosticoParaCompraOut:
    if db.get(Producto, producto_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Producto no encontrado")
    if db.get(Sucursal, sucursal_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sucursal no encontrada")
    verificar_alcance_sucursal(db, current_user, sucursal_id)

    # Integración en vivo con 004-pronostico-demanda (Decisión 4): misma
    # consulta que GET /pronostico/{producto_id} de ese módulo, resuelta
    # en proceso (un solo monolito FastAPI) en vez de por HTTP saliente.
    reciente = (
        db.query(PronosticoDemanda)
        .filter(PronosticoDemanda.producto_id == producto_id, PronosticoDemanda.sucursal_id == sucursal_id)
        .order_by(PronosticoDemanda.fecha_calculo.desc())
        .first()
    )
    datos_suficientes = reciente is not None
    cantidad_recomendada = Decimal(str(reciente.cantidad_recomendada)) if reciente is not None else None

    if detalle_id is not None:
        detalle = db.get(DetalleOrdenCompra, detalle_id)
        if detalle is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "detalle_id no encontrado")
        if detalle.producto_id != producto_id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "detalle_id no corresponde a producto_id"
            )
        # Snapshot de la consulta (Decisión 4) — nunca se persiste una
        # tabla propia de pronósticos acá, solo esta foto en el detalle.
        detalle.pronostico_consultado = True
        detalle.cantidad_recomendada_pronostico = cantidad_recomendada
        db.commit()

    return PronosticoParaCompraOut(
        producto_id=producto_id, datos_suficientes=datos_suficientes, cantidad_recomendada=cantidad_recomendada
    )


@router.patch(
    "/compras/ordenes/{detalle_id}/motivo-oferta", response_model=DetalleOrdenCompraOut, tags=["compras"]
)
def registrar_motivo_oferta(
    detalle_id: int,
    payload: MotivoOfertaIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("orden_compra", "actualizar")),
) -> DetalleOrdenCompraOut:
    detalle = db.get(DetalleOrdenCompra, detalle_id)
    if detalle is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Línea de orden de compra no encontrada")
    orden = db.get(OrdenCompra, detalle.orden_compra_id)
    verificar_alcance_sucursal(db, current_user, orden.sucursal_id)

    detalle.motivo_no_siguio_pronostico = payload.motivo_no_siguio_pronostico
    db.commit()
    db.refresh(detalle)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="registrar_motivo_oferta",
        recurso="orden_compra",
        recurso_id=orden.id,
        sucursal_id=orden.sucursal_id,
        exitoso=True,
        request=request,
        detalle={"detalle_id": detalle_id},
    )
    return _detalle_out(db, detalle)


# ---------------------------------------------------------------------------
# Catálogos (RF-CP-016, enmienda v1.2) — solo lectura, cualquier usuario autenticado
# ---------------------------------------------------------------------------


@router.get("/catalogos/formas-pago", response_model=list[FormaPagoOut], tags=["catalogos"])
def listar_formas_pago(
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(get_current_user),
) -> list[FormaPago]:
    return db.query(FormaPago).order_by(FormaPago.orden).all()


@router.get("/catalogos/estados-orden-compra", response_model=list[EstadoOrdenCompraOut], tags=["catalogos"])
def listar_estados_orden_compra(
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(get_current_user),
) -> list[EstadoOrdenCompra]:
    return db.query(EstadoOrdenCompra).order_by(EstadoOrdenCompra.orden).all()
