"""
Esquemas Pydantic del contrato el-kiosquito-006-caja-mermas-fraude-
contracts-openapi.yaml.
"""

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class TurnoCajaCrearIn(BaseModel):
    sucursal_id: int
    monto_inicial: Decimal = Field(ge=0)


class TurnoCajaCerrarIn(BaseModel):
    monto_contado: Decimal = Field(ge=0)
    motivo_diferencia: str | None = None


class TurnoCajaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sucursal_id: int
    cajero_id: int
    hora_apertura: datetime
    monto_inicial: Decimal
    hora_cierre: datetime | None
    monto_contado: Decimal | None
    monto_esperado: Decimal | None
    diferencia: Decimal | None
    motivo_diferencia: str | None
    estado: str


class MermaCrearIn(BaseModel):
    producto_id: int
    sucursal_id: int
    cantidad: Decimal = Field(gt=0)
    valor_estimado: Decimal = Field(gt=0)


class MermaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    producto_id: int
    sucursal_id: int
    cantidad: Decimal
    valor_estimado: Decimal
    causa: str | None
    resultado_investigacion: str | None
    fecha_deteccion: datetime
    fecha_resultado: datetime | None


class MermaCausaIn(BaseModel):
    causa: str


class MermaResultadoIn(BaseModel):
    resultado_investigacion: str


class IncidenciaCuadreCrearIn(BaseModel):
    turno_caja_id: int
    score_anomalia: Decimal
    justificacion: str = Field(min_length=10)


class IncidenciaCuadreOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    turno_caja_id: int
    score_anomalia: Decimal
    justificacion: str
    estado: str
    fecha_deteccion: datetime


class AlertaFraudeCrearIn(BaseModel):
    venta_id: int
    motivo: str
    ultimos_4_digitos: str | None = Field(default=None, min_length=4, max_length=4)
    codigo_respuesta_proveedor: str | None = None


class AlertaFraudeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    venta_id: int
    motivo: str
    ultimos_4_digitos: str | None
    codigo_respuesta_proveedor: str | None
    estado: str
    creada_en: datetime
    atendida_en: datetime | None
    atendida_por: int | None


class PuntoControlOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    turno_caja_id: int
    hora_checkpoint: datetime
    monto_esperado_acumulado: Decimal
    generado_en: datetime


class ArqueoParcialCrearIn(BaseModel):
    monto_contado: Decimal = Field(ge=0)
    motivo_diferencia: str | None = None


class ArqueoParcialOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    turno_caja_id: int
    monto_esperado_acumulado: Decimal
    monto_contado: Decimal
    diferencia: Decimal
    motivo_diferencia: str | None
    registrado_por: int
    hora_arqueo: datetime


class CausaMermaOut(BaseModel):
    codigo: str
    etiqueta: str
    es_atribuible_a_persona: bool
    requiere_investigacion: bool
    activo: bool


class EstadoTurnoOut(BaseModel):
    codigo: str
    etiqueta: str
    es_estado_final: bool
    admite_ventas: bool
    activo: bool


class EstadoIncidenciaOut(BaseModel):
    codigo: str
    etiqueta: str
    es_estado_final: bool
    activo: bool


class EstadoAlertaOut(BaseModel):
    codigo: str
    etiqueta: str
    es_estado_final: bool
    activo: bool


class ResultadoInvestigacionOut(BaseModel):
    codigo: str
    etiqueta: str
    cierra_investigacion: bool
    activo: bool
