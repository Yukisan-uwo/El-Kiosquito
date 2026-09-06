"""
Esquemas Pydantic del contrato el-kiosquito-007-pagos-seguridad-
contracts-openapi.yaml.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class DatafonoCrearIn(BaseModel):
    sucursal_id: int
    codigo_serie: str = Field(min_length=1)


class DatafonoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sucursal_id: int
    codigo_serie: str
    activo: bool


class RevisionDatafonoCrearIn(BaseModel):
    estado: str
    observaciones: str | None = None


class RevisionDatafonoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    datafono_id: int
    estado: str
    observaciones: str | None
    fecha_revision: datetime
    revisado_por: int


class EstadoDatafonoOut(BaseModel):
    datafono_id: int
    codigo_serie: str
    sin_revision: bool
    estado_vigente: str | None
    fecha_ultima_revision: datetime | None


class DatafonoDisponibleOut(BaseModel):
    """RF-PS-013 (enmienda v1.1, 2026-09-06) — respuesta de
    `GET /sucursales/{id}/datafonos-disponibles`. Deliberadamente mucho más
    angosta que `EstadoDatafonoOut`: nunca incluye `sin_revision`,
    `estado_vigente` ni `fecha_ultima_revision` — ese estado de seguridad
    sigue siendo exclusivo de `datafono`/`leer` (dueño, encargado_sucursal,
    encargado_compras). Esta solo trae lo mínimo para que un cajero elija
    qué terminal físico está usando al cobrar una venta con tarjeta."""

    id: int
    codigo_serie: str


class ConformidadSucursalOut(BaseModel):
    terminales_totales: int
    terminales_conformes: int
    terminales_sin_revision: int
    porcentaje_conformes: float


class EstadoRevisionOut(BaseModel):
    codigo: str
    etiqueta: str
    cuenta_como_conforme: bool
    activo: bool


class VentaConEstadoRevisionOut(BaseModel):
    """Enmienda v1.2 (auditoría de riesgos derivados): trazabilidad
    real venta ↔ datáfono. `estado_revision_al_momento` es el estado
    VIGENTE EN LA FECHA DE ESA VENTA — nunca el estado actual del
    datáfono — mismo criterio que el join lateral de `segmento_cliente`
    contra `evaluacion_churn` en `etl/ml/churn.py`: evaluar una venta
    pasada contra el estado de hoy del terminal distorsionaría la
    trazabilidad que esto existe para dar."""

    venta_id: int
    numero_documento: str
    fecha_hora: datetime
    total: float
    sin_revision_al_momento: bool
    estado_revision_al_momento: str | None
