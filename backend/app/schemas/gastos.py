"""
Esquemas Pydantic para el módulo de Gastos Fijos por Sucursal,
Costeo por Absorción y Simulador de Precios / Márgenes con IA.
"""

from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel, ConfigDict, Field


class GastoSucursalCrearIn(BaseModel):
    sucursal_id: int
    concepto: str = Field(..., min_length=3, max_length=120)
    categoria_gasto: str = Field(default="servicio", max_length=50)
    monto_mensual: Decimal = Field(..., gt=0)


class GastoSucursalActualizarIn(BaseModel):
    concepto: str | None = Field(default=None, min_length=3, max_length=120)
    categoria_gasto: str | None = Field(default=None, max_length=50)
    monto_mensual: Decimal | None = Field(default=None, gt=0)
    activo: bool | None = None


class GastoSucursalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sucursal_id: int
    concepto: str
    categoria_gasto: str
    monto_mensual: Decimal
    activo: bool
    creado_en: datetime
    actualizado_en: datetime


class SimulacionGastosIn(BaseModel):
    sucursal_id: int
    meta_utilidad_neta_pct: Decimal = Field(default=Decimal("15.0"), ge=0, le=100)
    variacion_gastos_pct: Decimal = Field(default=Decimal("0.0"), ge=-50, le=200)


class ProductoSimuladoOut(BaseModel):
    producto_id: int
    nombre: str
    clasificacion: str
    es_perecedero: bool
    costo_vigente: Decimal | None = None
    precio_actual: Decimal | None = None
    margen_actual_pct: Decimal | None = None
    margen_sugerido_pct: Decimal
    precio_sugerido: Decimal
    cuota_gasto_absorbida: Decimal
    justificacion: str


class SimulacionGastosOut(BaseModel):
    sucursal_id: int
    gastos_totales_mensuales: Decimal
    variacion_aplicada_pct: Decimal
    punto_equilibrio_ventas: Decimal
    margen_promedio_necesario_pct: Decimal
    utilidad_neta_proyectada: Decimal
    total_unidades_proyectadas: int
    productos: list[ProductoSimuladoOut]
    explicacion_ia: str


class ItemPrecioAplicar(BaseModel):
    producto_id: int
    precio_sugerido: Decimal = Field(..., gt=0)
    justificacion: str = Field(..., min_length=5)


class AplicarSimulacionIn(BaseModel):
    sucursal_id: int
    items: list[ItemPrecioAplicar]


class AplicarSimulacionOut(BaseModel):
    sucursal_id: int
    total_precios_aplicados: int
    mensaje: str
