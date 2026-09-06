"""
Esquemas Pydantic del contrato el-kiosquito-003-precios-margenes-
contracts-openapi.yaml.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class PrecioCrearIn(BaseModel):
    producto_id: int
    sucursal_id: int
    precio_venta: Decimal = Field(ge=0)


class HistorialPrecioOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    producto_id: int
    sucursal_id: int
    precio_venta: Decimal
    fuente: str
    vigente_desde: datetime


class MargenRealOut(BaseModel):
    producto_id: int
    sucursal_id: int
    datos_suficientes: bool
    precio_venta_vigente: Decimal | None = None
    costo_reposicion_vigente: Decimal | None = None
    margen_real: Decimal | None = None


class PrecioCompetenciaCrearIn(BaseModel):
    producto_id: int
    fuente_competencia_id: int
    precio_referencia: Decimal = Field(ge=0)


class ComparativaCompetenciaOut(BaseModel):
    producto_id: int
    precio_propio_vigente: Decimal | None = None
    precio_competencia_mas_reciente: Decimal | None = None
    fuente_competencia: str | None = None
    fuente_competencia_id: int | None = None
    canal_competencia: str | None = None


class FuenteCompetenciaCrearIn(BaseModel):
    nombre: str = Field(max_length=120)
    canal_codigo: str


class FuenteCompetenciaActualizarIn(BaseModel):
    nombre: str | None = Field(default=None, max_length=120)
    canal_codigo: str | None = None
    activo: bool | None = None


class FuenteCompetenciaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nombre: str
    canal_codigo: str
    activo: bool


class ClasificacionComercialOut(BaseModel):
    codigo: str
    etiqueta: str
    margen_objetivo_min: Decimal
    margen_objetivo_max: Decimal
    activo: bool


class ClasificarProductoIn(BaseModel):
    clasificacion: str
    motivo_cambio: str = Field(min_length=10)


class ClasificacionActualOut(BaseModel):
    producto_id: int
    clasificacion: str
    vigente_desde: datetime


class ClasificacionHistorialOut(BaseModel):
    clasificacion: str
    fecha_desde: datetime
    fecha_hasta: datetime | None
    motivo_cambio: str
    usuario_id: int


class RecomendacionCrearIn(BaseModel):
    producto_id: int
    sucursal_id: int
    precio_recomendado: Decimal = Field(ge=0)
    justificacion: str = Field(min_length=10)


class RecomendacionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    producto_id: int
    sucursal_id: int
    precio_actual_snapshot: Decimal
    precio_recomendado: Decimal
    justificacion: str
    estado: str


class RecomendacionResolverIn(BaseModel):
    decision: Literal["aceptada", "rechazada"]
    # RN-PM-007 (enmienda v1.3, auditoría de riesgos derivados): obligatorio
    # solo cuando se acepta una recomendación cuyo precio queda por debajo del
    # costo de reposición vigente — vender a pérdida a veces es una decisión
    # de negocio legítima (liquidar un producto gancho puntual), pero nunca
    # debe poder pasar por descuido sin que quien acepta lo confirme.
    confirmar_perdida: bool = False
