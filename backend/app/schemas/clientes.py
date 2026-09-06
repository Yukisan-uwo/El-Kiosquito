"""
Esquemas Pydantic del contrato el-kiosquito-002-clientes-fidelizacion-
contracts-openapi.yaml.

Nota sobre `security` del contrato: declara scopes ilustrativos
(`fidelizacion`, `gerencia`, `sistema`) que no existen como roles reales
en la matriz sembrada (solo hay 4: `dueno`, `encargado_compras`,
`encargado_sucursal`, `cajero`, con 2 recursos para este módulo: `cliente`
y `churn`). El router autoriza contra esa matriz real vía
`require_permission`, igual que en 001 y 010 — nunca contra los nombres
de scope del YAML.
"""

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class ClienteCrearIn(BaseModel):
    nombre: str
    contacto: str | None = None
    fecha_nacimiento: date | None = None
    # Art. 10.4 (LOPDP): casilla real, previa al envío del formulario —
    # el 422 de Pydantic para un booleano faltante/false ES el "formulario
    # no se puede enviar sin marcarla" de la regla constitucional.
    acepto_politica_privacidad: bool


class PoliticaPrivacidadOut(BaseModel):
    version: str
    vigente_desde: str
    contenido: str
    punto_contacto: str


class ClienteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nombre: str
    contacto: str | None
    fecha_nacimiento: date | None
    creado_en: datetime
    consentimiento_privacidad_en: datetime
    version_politica_privacidad: str


class VentaResumenOut(BaseModel):
    id: int
    fecha_hora: datetime
    total: Decimal


class SegmentoCrearIn(BaseModel):
    cliente_id: int
    segmento_codigo: str
    version_modelo_id: int
    frecuencia_snapshot: Decimal | None = None
    margen_snapshot: Decimal | None = None
    recencia_dias_snapshot: int | None = None
    tamano_muestra: int = Field(ge=1)
    periodo_inicio: date
    periodo_fin: date


class SegmentoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    cliente_id: int
    segmento_codigo: str
    version_modelo_id: int
    frecuencia_snapshot: Decimal | None
    margen_snapshot: Decimal | None
    recencia_dias_snapshot: int | None
    tamano_muestra: int
    periodo_inicio: date
    periodo_fin: date
    fecha_calculo: datetime
    vigente_hasta: datetime | None


class SegmentoConsultaOut(BaseModel):
    datos_suficientes: bool
    segmento: SegmentoOut | None = None


class SegmentoCatalogoOut(BaseModel):
    codigo: str
    etiqueta: str
    descripcion: str
    prioridad_comercial: int
    activo: bool


class EvaluacionChurnCrearIn(BaseModel):
    cliente_id: int
    es_riesgo_real: bool
    dias_sin_compra_al_momento: int = Field(ge=0)
    frecuencia_historica_dias: Decimal | None = None
    justificacion: str = Field(min_length=10)
    tamano_muestra: int = Field(ge=1)


class EvaluacionChurnOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    cliente_id: int
    es_riesgo_real: bool
    dias_sin_compra_al_momento: int
    frecuencia_historica_dias: Decimal | None
    justificacion: str
    tamano_muestra: int
    fecha_evaluacion: datetime


class EvaluacionChurnConsultaOut(BaseModel):
    datos_suficientes: bool
    evaluacion: EvaluacionChurnOut | None = None


class CampanaRecuperacionCrearIn(BaseModel):
    cliente_id: int
    evaluacion_churn_id: int
    cupon_id: int | None = None


class CampanaRecuperacionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    cliente_id: int
    evaluacion_churn_id: int
    cupon_id: int | None
    fecha_envio: datetime
    usuario_id: int
    notificacion_enviada: bool
    notificacion_detalle: str | None


class CampanaResultadoOut(BaseModel):
    campana_id: int
    recupero_actividad: bool
    fecha_compra_posterior: datetime | None = None
