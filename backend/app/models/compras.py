"""
008-compras-proveedores — proveedor, orden de compra (con estado
derivado del log de recepciones, nunca editable directamente), detalle
con snapshot de la consulta a pronóstico de demanda, recepciones por
evento e historial de costo por producto/proveedor.

Fuente: el-kiosquito-008-compras-proveedores-data-model.md (tras
enmienda v1.2 de catálogos maestros).

`historial_costo_producto` es la tabla que 003-precios-margenes consulta
(sin FK, solo lectura) para calcular el margen real — se crea aquí.
`004-pronostico-demanda` se consulta por HTTP al armar `detalle_orden_
compra`, nunca por FK (Decisión 4 del propio data-model.md).
"""

from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Numeric,
    SmallInteger,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.common import CatalogMixin

# ---------------------------------------------------------------------------
# Catálogos maestros (enmienda v1.2)
# ---------------------------------------------------------------------------


class FormaPago(CatalogMixin, Base):
    """`dias_plazo_default` es deliberadamente un valor por defecto del
    tipo de pago, no un campo por orden — modelar el plazo negociado
    orden por orden sería un módulo de cuentas por pagar que ningún OT
    de la cascada pide."""

    __tablename__ = "forma_pago"

    codigo: Mapped[str] = mapped_column(String(40), primary_key=True)
    etiqueta: Mapped[str] = mapped_column(String(80), nullable=False)
    dias_plazo_default: Mapped[int] = mapped_column(SmallInteger, nullable=False)  # 0 para contado

    __table_args__ = (
        CheckConstraint("dias_plazo_default >= 0", name="ck_forma_pago_plazo_no_negativo"),
    )


class EstadoOrdenCompra(CatalogMixin, Base):
    """La FK agrega integridad referencial pero NO vuelve editable
    `orden_compra.estado` — sigue siendo derivado, recalculado por
    servicio desde el log de recepciones (RNF-CP-001, Decisión 1). Un
    catálogo de estados y un estado editable son cosas distintas."""

    __tablename__ = "estado_orden_compra"

    codigo: Mapped[str] = mapped_column(String(40), primary_key=True)
    etiqueta: Mapped[str] = mapped_column(String(80), nullable=False)
    # false solo en recibida_completa y cancelada.
    permite_recepcion: Mapped[bool] = mapped_column(Boolean, nullable=False)
    es_estado_final: Mapped[bool] = mapped_column(Boolean, nullable=False)


# ---------------------------------------------------------------------------
# Tablas operativas
# ---------------------------------------------------------------------------


class Proveedor(Base):
    __tablename__ = "proveedor"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(Text, nullable=False)
    contacto: Mapped[str | None] = mapped_column(Text, nullable=True)  # teléfono o correo
    activo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    creado_en: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())


class OrdenCompra(Base):
    __tablename__ = "orden_compra"

    id: Mapped[int] = mapped_column(primary_key=True)
    proveedor_id: Mapped[int] = mapped_column(ForeignKey("proveedor.id"), nullable=False)
    sucursal_id: Mapped[int] = mapped_column(ForeignKey("sucursal.id"), nullable=False)
    creado_por: Mapped[int] = mapped_column(ForeignKey("usuario.id"), nullable=False)
    fecha_pedido: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    es_oferta: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    forma_pago: Mapped[str] = mapped_column(
        String(40), ForeignKey("forma_pago.codigo"), nullable=False, default="contado", server_default="contado"
    )
    # Derivado — ver docstring de EstadoOrdenCompra. Nunca escrito
    # directamente por un endpoint (RNF-CP-001).
    estado: Mapped[str] = mapped_column(
        String(40), ForeignKey("estado_orden_compra.codigo"), nullable=False,
        default="pendiente", server_default="pendiente",
    )

    __table_args__ = (
        Index("ix_orden_compra_proveedor", "proveedor_id"),
        Index("ix_orden_compra_sucursal_estado", "sucursal_id", "estado"),
    )


class DetalleOrdenCompra(Base):
    """`cantidad_recibida` NO es columna aquí — se calcula por servicio
    (SUM de recepcion_orden_compra), expuesto en la API pero nunca
    persistido (Decisión 1)."""

    __tablename__ = "detalle_orden_compra"

    id: Mapped[int] = mapped_column(primary_key=True)
    orden_compra_id: Mapped[int] = mapped_column(ForeignKey("orden_compra.id"), nullable=False)
    producto_id: Mapped[int] = mapped_column(ForeignKey("producto.id"), nullable=False)
    cantidad_pedida: Mapped[float] = mapped_column(Numeric(10, 3), nullable=False)
    precio_ofrecido: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    pronostico_consultado: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")  # RN-CP-001
    # Snapshot de la recomendación consultada en 004 — solo si
    # pronostico_consultado=true y esa consulta tenía datos_suficientes=true.
    cantidad_recomendada_pronostico: Mapped[float | None] = mapped_column(Numeric(10, 3), nullable=True)
    # RN-CP-001: si cantidad_pedida excede cantidad_recomendada_pronostico
    # (o no hay dato), este campo es obligatorio ANTES de aceptar una
    # recepción — pero deliberadamente NO hay un CHECK de fila para esto
    # (ver migración 81b45384f520): el flujo real graba el snapshot de la
    # recomendación en el mismo momento en que se descubre que la excede,
    # y recién después el usuario puede justificarla — un CHECK sobre esta
    # fila bloquearía ese primer paso. Se valida en servicio, en
    # `registrarRecepcion`, el único punto donde de verdad importa.
    motivo_no_siguio_pronostico: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        CheckConstraint("cantidad_pedida > 0", name="ck_detalle_oc_cantidad_positiva"),
        CheckConstraint("precio_ofrecido >= 0", name="ck_detalle_oc_precio_no_negativo"),
        Index("ix_detalle_oc_orden", "orden_compra_id"),
        Index("ix_detalle_oc_producto", "producto_id"),
    )


class RecepcionOrdenCompra(Base):
    """Cada INSERT dispara, en la misma transacción del servicio, un
    `historial_costo_producto` (RF-CP-006) y la reevaluación del `estado`
    de la orden_compra correspondiente (RF-CP-005) — lógica de servicio,
    no de base de datos (para poder validar RN-CP-001 en el mismo paso)."""

    __tablename__ = "recepcion_orden_compra"

    id: Mapped[int] = mapped_column(primary_key=True)
    detalle_orden_compra_id: Mapped[int] = mapped_column(ForeignKey("detalle_orden_compra.id"), nullable=False)
    cantidad_recibida_evento: Mapped[float] = mapped_column(Numeric(10, 3), nullable=False)
    # Factura o guía de remisión — opcional: la recepción puede ocurrir
    # antes de que llegue el documento físico (RF-CP-013).
    numero_documento_proveedor: Mapped[str | None] = mapped_column(Text, nullable=True)
    fecha_recepcion: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuario.id"), nullable=False)

    __table_args__ = (
        CheckConstraint("cantidad_recibida_evento > 0", name="ck_recepcion_cantidad_positiva"),
        Index("ix_recepcion_detalle_fecha", "detalle_orden_compra_id", "fecha_recepcion"),
    )


class HistorialCostoProducto(Base):
    """Append-only estricto (RNF-CP-002) — consultada (sin FK) por
    003-precios-margenes para calcular el margen real en el momento de la
    petición."""

    __tablename__ = "historial_costo_producto"

    id: Mapped[int] = mapped_column(primary_key=True)
    producto_id: Mapped[int] = mapped_column(ForeignKey("producto.id"), nullable=False)
    proveedor_id: Mapped[int] = mapped_column(ForeignKey("proveedor.id"), nullable=False)
    costo: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    orden_compra_id: Mapped[int] = mapped_column(ForeignKey("orden_compra.id"), nullable=False)
    fecha: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())

    __table_args__ = (
        CheckConstraint("costo >= 0", name="ck_historial_costo_no_negativo"),
        Index("ix_historial_costo_producto_proveedor_fecha", "producto_id", "proveedor_id", "fecha"),
    )
