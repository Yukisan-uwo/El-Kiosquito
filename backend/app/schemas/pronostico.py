"""
Esquemas Pydantic del contrato el-kiosquito-004-pronostico-demanda-
contracts-openapi.yaml.
"""

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class DemandaInsatisfechaCrearIn(BaseModel):
    producto_id: int
    sucursal_id: int
    hora_evento: datetime
    sustituto_ofrecido_id: int | None = None
    sustituto_aceptado: bool | None = None

    @model_validator(mode="after")
    def _sustituto_coherente(self) -> "DemandaInsatisfechaCrearIn":
        # RF-PD-006: sustituto_aceptado es obligatorio si se informó un
        # sustituto ofrecido — mismo CHECK que respalda esto en BD
        # (ck_demanda_insatisfecha_sustituto_coherente), validado temprano
        # acá para devolver 422 en vez de una IntegrityError 500.
        if self.sustituto_ofrecido_id is not None and self.sustituto_aceptado is None:
            raise ValueError("sustituto_aceptado es obligatorio cuando se informa sustituto_ofrecido_id")
        return self


class DemandaInsatisfechaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    producto_id: int
    sucursal_id: int
    cajero_id: int
    hora_evento: datetime
    hora_registro: datetime
    sustituto_ofrecido_id: int | None
    sustituto_aceptado: bool | None


class PronosticoCrearIn(BaseModel):
    producto_id: int
    sucursal_id: int
    cantidad_recomendada: Decimal = Field(ge=0)
    tamano_muestra: int = Field(ge=1)
    periodo_inicio: date
    periodo_fin: date


class PronosticoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    producto_id: int
    sucursal_id: int
    cantidad_recomendada: Decimal
    tamano_muestra: int
    periodo_inicio: date
    periodo_fin: date
    fecha_calculo: datetime


class PronosticoConsultaOut(BaseModel):
    datos_suficientes: bool
    pronostico: PronosticoOut | None = None


class EventoLocalCrearIn(BaseModel):
    sucursal_id: int | None = None
    fecha_inicio: date
    fecha_fin: date
    tipo: str
    descripcion: str = Field(min_length=3)

    @model_validator(mode="after")
    def _rango_valido(self) -> "EventoLocalCrearIn":
        if self.fecha_fin < self.fecha_inicio:
            raise ValueError("fecha_fin no puede ser anterior a fecha_inicio")
        return self


class EventoLocalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sucursal_id: int | None
    fecha_inicio: date
    fecha_fin: date
    tipo: str
    descripcion: str
    registrado_por: int
    creado_en: datetime


class TipoEventoLocalOut(BaseModel):
    codigo: str
    etiqueta: str
    afecta_demanda_al_alza: bool
    activo: bool
