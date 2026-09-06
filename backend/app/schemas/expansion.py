"""
Esquemas Pydantic del contrato el-kiosquito-009-expansion-sucursales-
contracts-openapi.yaml.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class SucursalCrearIn(BaseModel):
    nombre: str = Field(min_length=1)
    direccion: str = Field(min_length=1)


class SucursalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nombre: str
    direccion: str
    responsable_id: int | None
    estado: str
    fecha_registro: datetime
    fecha_activacion: datetime | None


class ChecklistItemOut(BaseModel):
    item: str
    completado: bool
    fecha_completado: datetime | None


class EstadoAperturaOut(BaseModel):
    sucursal: SucursalOut
    checklist: list[ChecklistItemOut]


class HerenciaCatalogoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    sucursal_id: int
    cantidad_productos_heredados: int
    cantidad_productos_pendientes: int
    fecha: datetime


class AsignarPersonalIn(BaseModel):
    usuario_id: int
    es_responsable: bool = False


class ItemChecklistAperturaOut(BaseModel):
    codigo: str
    etiqueta: str
    orden: int
    es_bloqueante: bool
    activo: bool


class EstadoSucursalOut(BaseModel):
    codigo: str
    etiqueta: str
    opera_ventas: bool
    activo: bool
