"""
Esquemas Pydantic del contrato el-kiosquito-005-promociones-inteligentes-
contracts-openapi.yaml.
"""

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class CuponCrearIn(BaseModel):
    cliente_id: int
    tipo_origen: str
    evaluacion_churn_id: int | None = None
    descuento_tipo: str
    descuento_valor: Decimal = Field(ge=0)
    fecha_expiracion: datetime


class CuponOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    cliente_id: int
    tipo_origen: str
    evaluacion_churn_id: int | None
    codigo: str
    descuento_tipo: str
    descuento_valor: Decimal
    fecha_envio: datetime
    fecha_expiracion: datetime
    estado: str
    venta_id_canje: int | None
    fecha_canje: datetime | None
    notificacion_enviada: bool
    notificacion_detalle: str | None


class CuponCanjearIn(BaseModel):
    venta_id: int


class TipoOrigenCuponOut(BaseModel):
    codigo: str
    etiqueta: str
    es_automatico: bool
    requiere_evaluacion_churn: bool
    activo: bool


class TipoDescuentoOut(BaseModel):
    codigo: str
    etiqueta: str
    valor_maximo_permitido: Decimal
    activo: bool


class EstadoCuponOut(BaseModel):
    codigo: str
    etiqueta: str
    es_estado_final: bool
    permite_canje: bool
    activo: bool


class SugerenciaPatronRecalcularIn(BaseModel):
    periodo_dias: int = Field(default=90, gt=0, le=365)
    soporte_minimo: Decimal = Field(default=Decimal("0.01"), gt=0, le=1)
    confianza_minima: Decimal = Field(default=Decimal("0.30"), gt=0, le=1)
    lift_minimo: Decimal = Field(default=Decimal("1.10"), gt=0)
    veces_minimas_base: int = Field(default=2, gt=0)
    limite_por_cliente: int = Field(default=3, gt=0, le=20)


class SugerenciaPatronRecalcularOut(BaseModel):
    periodo_dias: int
    reglas_evaluadas: int
    sugerencias_generadas: int
    sugerencias_omitidas_duplicadas: int


class SugerenciaPatronOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    cliente_id: int
    producto_base_id: int
    producto_sugerido_id: int
    veces_comprado_base: int
    soporte: Decimal
    confianza: Decimal
    lift: Decimal
    periodo_dias: int
    estado: str
    generado_en: datetime
    atendida_en: datetime | None
    atendida_por: int | None
    cupon_id: int | None


class SugerenciaPatronResolverIn(BaseModel):
    aceptar: bool
    # Obligatorios solo si aceptar=true — el motor de asociación decide
    # QUÉ producto sugerir, nunca de cuánto es el descuento (RN-PI-005).
    descuento_tipo: str | None = None
    descuento_valor: Decimal | None = Field(default=None, ge=0)
    fecha_expiracion: datetime | None = None


class EstadoSugerenciaPatronOut(BaseModel):
    codigo: str
    etiqueta: str
    es_estado_final: bool
    activo: bool
