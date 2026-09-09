"""
Router de Gastos Fijos Operativos del Local y Simulador de Precios / Márgenes con IA.

Permite registrar los gastos fijos mensuales por sucursal (arriendo, luz/refrigeración,
agua, sueldos, internet, etc.), simular el punto de equilibrio y los márgenes de
absorción asistidos por IA, y aplicar los precios recomendados a la sucursal.
"""

from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, log_accion, require_permission
from app.database import get_db
from app.models.administracion import Usuario
from app.models.core_ventas import Producto
from app.models.expansion import GastoSucursal, Sucursal
from app.models.precios import HistorialPrecioProducto, RecomendacionPrecio
from app.schemas.gastos import (
    AplicarSimulacionIn,
    AplicarSimulacionOut,
    GastoSucursalActualizarIn,
    GastoSucursalCrearIn,
    GastoSucursalOut,
    SimulacionGastosIn,
    SimulacionGastosOut,
)
from app.services.scoping import verificar_alcance_sucursal
from app.services.simulador_precios_ia import ejecutar_simulacion_gastos_ia

router = APIRouter(prefix="/gastos-sucursal", tags=["gastos-sucursal"])


@router.get("", response_model=list[GastoSucursalOut])
def listar_gastos_sucursal(
    sucursal_id: int = Query(..., description="ID de la sucursal"),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("sucursal", "leer")),
) -> list[GastoSucursal]:
    """Lista todos los gastos fijos activos de una sucursal."""
    verificar_alcance_sucursal(db, current_user, sucursal_id)
    return (
        db.query(GastoSucursal)
        .filter(
            GastoSucursal.sucursal_id == sucursal_id,
            GastoSucursal.activo.is_(True),
        )
        .order_by(GastoSucursal.categoria_gasto.asc(), GastoSucursal.monto_mensual.desc())
        .all()
    )


@router.post("", response_model=GastoSucursalOut, status_code=status.HTTP_201_CREATED)
def crear_gasto_sucursal(
    payload: GastoSucursalCrearIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("sucursal", "actualizar")),
) -> GastoSucursal:
    """Registra un nuevo gasto fijo mensual para la sucursal."""
    if db.get(Sucursal, payload.sucursal_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sucursal no encontrada")
    verificar_alcance_sucursal(db, current_user, payload.sucursal_id)

    nuevo = GastoSucursal(
        sucursal_id=payload.sucursal_id,
        concepto=payload.concepto.strip(),
        categoria_gasto=payload.categoria_gasto.strip().lower(),
        monto_mensual=payload.monto_mensual,
        activo=True,
    )
    db.add(nuevo)
    db.commit()
    db.refresh(nuevo)

    log_accion(
        db,
        usuario_id=current_user.id,
        accion="crear_gasto_sucursal",
        recurso="sucursal",
        recurso_id=nuevo.id,
        sucursal_id=payload.sucursal_id,
        exitoso=True,
        request=request,
        detalle={"concepto": nuevo.concepto, "monto_mensual": str(nuevo.monto_mensual)},
    )
    return nuevo


@router.patch("/{gasto_id}", response_model=GastoSucursalOut)
def actualizar_gasto_sucursal(
    gasto_id: int,
    payload: GastoSucursalActualizarIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("sucursal", "actualizar")),
) -> GastoSucursal:
    """Modifica el monto, concepto o estado de un gasto del local."""
    gasto = db.get(GastoSucursal, gasto_id)
    if gasto is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Gasto de sucursal no encontrado")
    verificar_alcance_sucursal(db, current_user, gasto.sucursal_id)

    if payload.concepto is not None:
        gasto.concepto = payload.concepto.strip()
    if payload.categoria_gasto is not None:
        gasto.categoria_gasto = payload.categoria_gasto.strip().lower()
    if payload.monto_mensual is not None:
        gasto.monto_mensual = payload.monto_mensual
    if payload.activo is not None:
        gasto.activo = payload.activo

    db.commit()
    db.refresh(gasto)

    log_accion(
        db,
        usuario_id=current_user.id,
        accion="actualizar_gasto_sucursal",
        recurso="sucursal",
        recurso_id=gasto.id,
        sucursal_id=gasto.sucursal_id,
        exitoso=True,
        request=request,
        detalle={"concepto": gasto.concepto, "monto_mensual": str(gasto.monto_mensual)},
    )
    return gasto


@router.delete("/{gasto_id}")
def eliminar_gasto_sucursal(
    gasto_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("sucursal", "actualizar")),
) -> dict:
    """Baja lógica de un gasto fijo del local."""
    gasto = db.get(GastoSucursal, gasto_id)
    if gasto is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Gasto de sucursal no encontrado")
    verificar_alcance_sucursal(db, current_user, gasto.sucursal_id)

    gasto.activo = False
    db.commit()

    log_accion(
        db,
        usuario_id=current_user.id,
        accion="eliminar_gasto_sucursal",
        recurso="sucursal",
        recurso_id=gasto.id,
        sucursal_id=gasto.sucursal_id,
        exitoso=True,
        request=request,
        detalle={"concepto": gasto.concepto},
    )
    return {"id": gasto_id, "eliminado": True}


@router.post("/simulacion-ia", response_model=SimulacionGastosOut)
def simular_precios_ia(
    payload: SimulacionGastosIn,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("precio", "leer")),
) -> SimulacionGastosOut:
    """Ejecuta el costeo por absorción, punto de equilibrio y recomendaciones de IA."""
    verificar_alcance_sucursal(db, current_user, payload.sucursal_id)
    try:
        return ejecutar_simulacion_gastos_ia(db, payload)
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc


@router.post("/aplicar-simulacion", response_model=AplicarSimulacionOut)
def aplicar_precios_simulados(
    payload: AplicarSimulacionIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("precio", "actualizar")),
) -> AplicarSimulacionOut:
    """Aplica los precios sugeridos por la simulación como precios vigentes oficiales."""
    if db.get(Sucursal, payload.sucursal_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sucursal no encontrada")
    verificar_alcance_sucursal(db, current_user, payload.sucursal_id)

    total_aplicados = 0
    for item in payload.items:
        prod = db.get(Producto, item.producto_id)
        if not prod or not prod.activo:
            continue

        # Cerrar recomendaciones pendientes previas
        pendientes = (
            db.query(RecomendacionPrecio)
            .filter(
                RecomendacionPrecio.producto_id == item.producto_id,
                RecomendacionPrecio.sucursal_id == payload.sucursal_id,
                RecomendacionPrecio.estado == "pendiente",
            )
            .all()
        )
        for rec in pendientes:
            rec.estado = "aplicada"
            rec.resuelto_por = current_user.id

        # Insertar nuevo precio vigente en el historial oficial
        nuevo_precio = HistorialPrecioProducto(
            producto_id=item.producto_id,
            sucursal_id=payload.sucursal_id,
            precio_venta=item.precio_sugerido,
            fuente="simulador_gastos_ia",
            registrado_por=current_user.id,
        )
        db.add(nuevo_precio)
        total_aplicados += 1

    db.commit()

    log_accion(
        db,
        usuario_id=current_user.id,
        accion="aplicar_precios_simulacion_ia",
        recurso="precio",
        recurso_id=payload.sucursal_id,
        sucursal_id=payload.sucursal_id,
        exitoso=True,
        request=request,
        detalle={"total_aplicados": total_aplicados},
    )

    return AplicarSimulacionOut(
        sucursal_id=payload.sucursal_id,
        total_precios_aplicados=total_aplicados,
        mensaje=f"Se actualizaron exitosamente {total_aplicados} precios y márgenes según la simulación de absorción de gastos.",
    )
