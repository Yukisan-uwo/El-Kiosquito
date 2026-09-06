"""
Esquemas Pydantic del contrato el-kiosquito-011-analitica-reportes-
contracts-openapi.yaml.
"""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class EjecucionPipelineIn(BaseModel):
    dag_run_id: str = Field(min_length=1)
    estado: str
    sucursales_procesadas: int | None = None
    filas_cargadas: int | None = None
    mensaje_error: str | None = None


class EjecucionPipelineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    dag_run_id: str
    estado: str
    fecha_inicio: datetime
    fecha_fin: datetime | None
    sucursales_procesadas: int
    filas_cargadas: int
    mensaje_error: str | None = None


class ValidacionCalidadIn(BaseModel):
    ejecucion_id: int
    regla_validada: str = Field(min_length=1)
    aprobado: bool
    detalle: str | None = None


class ValidacionCalidadOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ejecucion_id: int
    regla_validada: str
    aprobado: bool
    detalle: str | None
    fecha: datetime


class VersionModeloIn(BaseModel):
    modelo: str
    version: str = Field(min_length=1)
    tamano_muestra: int = Field(ge=0)
    periodo_inicio: date
    periodo_fin: date
    nombre_metrica: str = Field(min_length=1)
    valor_metrica: float | None = None


class VersionModeloOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    modelo: str
    version: str
    estado: str
    tamano_muestra: int
    periodo_inicio: date
    periodo_fin: date
    nombre_metrica: str
    valor_metrica: float | None
    motivo: str | None


class PreguntaAsistenteIn(BaseModel):
    pregunta_texto: str = Field(min_length=1)
    consulta_generada: str = Field(min_length=1)  # RN-AR-003: nunca vacía
    respuesta_texto: str = Field(min_length=1)


class PreguntaAsistentePreguntarIn(BaseModel):
    """POST /analitica/asistente/preguntar (enmienda v1.4.0, Art. 5.10) —
    a diferencia de PreguntaAsistenteIn, este solo recibe la pregunta en
    lenguaje natural. `consulta_generada` y `respuesta_texto` los produce
    el propio backend orquestando OpenRouter (services/asistente.py),
    nunca los manda el cliente."""

    pregunta_texto: str = Field(min_length=1)


class PreguntaAsistenteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    pregunta_texto: str
    consulta_generada: str
    respuesta_texto: str
    fecha: datetime


class ModeloMlOut(BaseModel):
    codigo: str
    etiqueta: str
    algoritmo: str
    metrica_principal: str
    modulo_consumidor: str
    activo: bool


class EstadoVersionModeloOut(BaseModel):
    codigo: str
    etiqueta: str
    es_version_servible: bool
    exige_motivo: bool
    activo: bool


class EstadoEjecucionOut(BaseModel):
    codigo: str
    etiqueta: str
    es_estado_final: bool
    activo: bool


# ---------------------------------------------------------------------------
# Reportes del Dashboard Dueño (OT1.1, OT1.2, OT1.4) — servidos desde
# ClickHouse vía app/services/reportes_dashboard.py.
# ---------------------------------------------------------------------------


class MargenPorSucursalOut(BaseModel):
    sucursal_id: int
    sucursal_nombre: str
    margen_total: float
    ingresos_total: float
    lineas_de_venta: int


class MermaPorSucursalOut(BaseModel):
    sucursal_id: int
    sucursal_nombre: str
    valor_perdido_total: float
    cantidad_total: float
    eventos: int


class TicketPromedioPorSucursalOut(BaseModel):
    sucursal_id: int
    sucursal_nombre: str
    ticket_promedio: float
    numero_ventas: int
