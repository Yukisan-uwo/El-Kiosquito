"""
Esquemas Pydantic del contrato el-kiosquito-001-core-ventas-inventario-
contracts-openapi.yaml.
"""

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Ventas
# ---------------------------------------------------------------------------


class ItemVentaIn(BaseModel):
    producto_id: int
    cantidad_venta: Decimal = Field(gt=0)


class VentaCrearIn(BaseModel):
    turno_caja_id: int
    cliente_id: int | None = None
    items: list[ItemVentaIn] = Field(min_length=1)
    metodo_pago: str
    descuento_aplicado: Decimal = Decimal("0")
    hora_inicio_cobro: datetime | None = None
    # Enmienda v1.5 (auditoría de riesgos derivados): solo tiene sentido
    # para tarjeta/electrónico (RN-CVI-011) — con efectivo, omitirlo.
    datafono_id: int | None = None


class VentaPagoIn(BaseModel):
    estado_pago: str


class VentaDescuentoIn(BaseModel):
    descuento_aplicado: Decimal = Field(ge=0)


class VentaAnularIn(BaseModel):
    motivo_anulacion: str = Field(min_length=3)


class VentaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    numero_documento: str
    sucursal_id: int
    turno_caja_id: int
    total: Decimal
    metodo_pago: str
    estado_venta: str
    datafono_id: int | None = None
    hora_inicio_cobro: datetime | None = None


# ---------------------------------------------------------------------------
# Productos
# ---------------------------------------------------------------------------


class ProductoCrearIn(BaseModel):
    nombre: str
    categoria_id: int
    codigo_barras: str | None = None
    unidad_venta_codigo: str
    unidad_inventario_codigo: str
    es_fraccionable: bool
    factor_conversion: Decimal | None = None
    es_perecedero: bool | None = None


class ProductoActualizarIn(BaseModel):
    nombre: str | None = None
    categoria_id: int | None = None
    unidad_venta_codigo: str | None = None
    unidad_inventario_codigo: str | None = None
    es_fraccionable: bool | None = None
    factor_conversion: Decimal | None = None
    es_perecedero: bool | None = None
    activo: bool | None = None


class ProductoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nombre: str
    categoria_id: int
    codigo_barras: str | None
    unidad_venta_codigo: str
    unidad_inventario_codigo: str
    es_fraccionable: bool
    factor_conversion: Decimal | None
    es_perecedero: bool
    activo: bool


class ProductoBusquedaOut(BaseModel):
    """RF-CVI-027, enmienda v1.4 — respuesta de `GET /productos`. Distinta de
    `ProductoOut` (la de crear/actualizar): agrega `categoria_nombre` (evita
    que el POS tenga que resolverlo aparte) y `precio_venta_vigente`, leído
    de `historial_precio_producto` de 003 en modo solo lectura para la
    `sucursal_id` consultada — nunca costo ni margen, eso sigue siendo
    exclusivo de `GET /precios/{id}/margen` en 003."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    nombre: str
    codigo_barras: str | None
    categoria_id: int
    categoria_nombre: str
    unidad_venta_codigo: str
    es_fraccionable: bool
    activo: bool
    precio_venta_vigente: Decimal | None = None
    stock_actual: Decimal | None = None
    stock_minimo: Decimal | None = None


# ---------------------------------------------------------------------------
# Inventario
# ---------------------------------------------------------------------------


class IngresoStockIn(BaseModel):
    producto_id: int
    sucursal_id: int
    cantidad: Decimal = Field(gt=0)
    fecha_caducidad: date | None = None


class RetiroLoteIn(BaseModel):
    cantidad_retirada: Decimal = Field(gt=0)
    motivo_retiro: str = Field(min_length=3)


class AjusteInventarioIn(BaseModel):
    producto_id: int
    sucursal_id: int
    cantidad_ajuste: Decimal
    motivo: str = Field(min_length=3)


class StockMinimoIn(BaseModel):
    sucursal_id: int
    stock_minimo: Decimal = Field(ge=0)


class StockOut(BaseModel):
    producto_id: int
    sucursal_id: int
    cantidad_disponible: Decimal
    stock_minimo: Decimal
    dias_sin_venta: int
    marcado_sin_rotacion: bool


class StockBajoOut(BaseModel):
    producto_id: int
    cantidad_disponible: Decimal
    stock_minimo: Decimal


class AjusteInventarioOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    producto_id: int
    sucursal_id: int
    cantidad_ajuste: Decimal
    motivo: str


class LoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    producto_id: int
    sucursal_id: int
    fecha_caducidad: date
    cantidad_lote: Decimal
    cantidad_restante: Decimal


# ---------------------------------------------------------------------------
# Sustitutos
# ---------------------------------------------------------------------------


class ProductoSustitutoIn(BaseModel):
    producto_sustituto_id: int
    simetrico: bool = True


class ProductoSustitutoOut(BaseModel):
    producto_sustituto_id: int
    activo: bool


# ---------------------------------------------------------------------------
# Layout/anaquel (enmienda 2026-09-05, auditoría de riesgos derivados)
# ---------------------------------------------------------------------------


class AnaquelCrearIn(BaseModel):
    sucursal_id: int
    codigo: str = Field(min_length=1, max_length=20)
    descripcion: str | None = None
    capacidad_maxima: int | None = Field(default=None, gt=0)


class AnaquelOut(BaseModel):
    id: int
    sucursal_id: int
    codigo: str
    descripcion: str | None
    capacidad_maxima: int | None
    activo: bool
    productos_asignados: int

    model_config = ConfigDict(from_attributes=True)


class ProductoUbicacionAsignarIn(BaseModel):
    sucursal_id: int
    anaquel_id: int


class ProductoUbicacionOut(BaseModel):
    producto_id: int
    sucursal_id: int
    anaquel_id: int
    asignado_por: int
    actualizado_en: datetime

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Catálogos: categoría (único con escritura por API) y los de solo lectura
# ---------------------------------------------------------------------------


class CategoriaCrearIn(BaseModel):
    nombre: str = Field(max_length=60)
    categoria_padre_id: int | None = None
    es_perecedero: bool = False


class CategoriaActualizarIn(BaseModel):
    nombre: str | None = Field(default=None, max_length=60)
    categoria_padre_id: int | None = None
    es_perecedero: bool | None = None
    activo: bool | None = None


class CategoriaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nombre: str
    categoria_padre_id: int | None
    es_perecedero: bool
    activo: bool
    subcategorias: list["CategoriaOut"] = []


class UnidadMedidaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    codigo: str
    etiqueta: str
    permite_decimales: bool
    orden: int
    activo: bool


class MetodoPagoOut(BaseModel):
    codigo: str
    etiqueta: str
    es_electronico: bool
    orden: int


class EstadoVentaOut(BaseModel):
    codigo: str
    etiqueta: str
    cuenta_para_ingresos: bool
