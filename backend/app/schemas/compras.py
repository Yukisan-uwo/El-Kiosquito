"""
Esquemas Pydantic del contrato el-kiosquito-008-compras-proveedores-
contracts-openapi.yaml.
"""

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class ProveedorCrearIn(BaseModel):
    nombre: str = Field(min_length=1)
    contacto: str | None = None


class ProveedorActualizarIn(BaseModel):
    nombre: str | None = None
    contacto: str | None = None


class ProveedorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nombre: str
    contacto: str | None
    activo: bool


class ItemOrdenCompraIn(BaseModel):
    producto_id: int
    cantidad_pedida: Decimal = Field(gt=0)
    precio_ofrecido: Decimal = Field(ge=0)


class OrdenCompraCrearIn(BaseModel):
    proveedor_id: int
    sucursal_id: int
    es_oferta: bool = False
    forma_pago: str
    items: list[ItemOrdenCompraIn] = Field(min_length=1)


class DetalleOrdenCompraOut(BaseModel):
    id: int
    producto_id: int
    cantidad_pedida: Decimal
    cantidad_recibida: Decimal
    precio_ofrecido: Decimal
    pronostico_consultado: bool
    motivo_no_siguio_pronostico: str | None


class OrdenCompraOut(BaseModel):
    id: int
    proveedor_id: int
    sucursal_id: int
    fecha_pedido: datetime
    es_oferta: bool
    forma_pago: str
    estado: str
    items: list[DetalleOrdenCompraOut]


class RecepcionCrearIn(BaseModel):
    cantidad_recibida_evento: Decimal = Field(gt=0)
    numero_documento_proveedor: str | None = None


class HistorialCostoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    producto_id: int
    proveedor_id: int
    costo: Decimal
    fecha: datetime


class PronosticoParaCompraOut(BaseModel):
    producto_id: int
    datos_suficientes: bool
    cantidad_recomendada: Decimal | None = None


class MotivoOfertaIn(BaseModel):
    motivo_no_siguio_pronostico: str = Field(min_length=3)


class FormaPagoOut(BaseModel):
    codigo: str
    etiqueta: str
    dias_plazo_default: int
    activo: bool


class EstadoOrdenCompraOut(BaseModel):
    codigo: str
    etiqueta: str
    permite_recepcion: bool
    es_estado_final: bool
    activo: bool
