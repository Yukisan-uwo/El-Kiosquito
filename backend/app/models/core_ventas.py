"""
001-core-ventas-inventario — catálogo de productos, stock por sucursal,
lotes/caducidad, ajustes de inventario y el registro de ventas (encabezado +
detalle). Es la base del proyecto: `categoria` y `unidad_medida` los
referencian los demás módulos.

Fuente: el-kiosquito-001-core-ventas-inventario-data-model.md (tras
enmienda v1.3 de catálogos maestros).

`venta.turno_caja_id` → `turno_caja` (006-caja-mermas-fraude) y
`venta.cliente_id` → `cliente` (002-clientes-fidelizacion) ya tienen FK
real: ambos módulos están construidos, cada uno cerró su FK con
`ALTER TABLE venta ADD CONSTRAINT ...` en su propia migración (mismo
patrón que `solicitud_arco.cliente_id` en 010-administracion).

`venta.datafono_id` → `datafono` (007-pagos-seguridad, enmienda v1.5,
auditoría de riesgos derivados) es la misma idea pero SIN diferir: 007 ya
existía cuando se agregó, así que la FK se creó directa en la migración
de esta misma columna, sin necesitar un `ALTER TABLE` posterior.
"""

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Computed,
    Date,
    ForeignKey,
    Index,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.common import CatalogMixin

# ---------------------------------------------------------------------------
# Catálogos maestros (enmienda v1.3)
# ---------------------------------------------------------------------------


class Categoria(Base):
    """Única excepción de clave natural entre los 32 catálogos: lleva `id`
    autoincremental porque necesita autorreferencia jerárquica y el negocio
    edita los nombres. Jerarquía de dos niveles como máximo (RN-CVI-008,
    validado en servicio: una categoría cuyo padre ya tiene padre se
    rechaza — no es expresable como CHECK de una sola fila)."""

    __tablename__ = "categoria"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(60), nullable=False, unique=True)
    categoria_padre_id: Mapped[int | None] = mapped_column(
        ForeignKey("categoria.id"), nullable=True
    )
    # Valor por defecto que hereda producto.es_perecedero al crearse — el
    # campo del producto sigue mandando después (ver docstring de Producto).
    es_perecedero: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    activo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")

    __table_args__ = (
        CheckConstraint("categoria_padre_id <> id", name="ck_categoria_no_autopadre"),
    )


class UnidadMedida(CatalogMixin, Base):
    __tablename__ = "unidad_medida"

    codigo: Mapped[str] = mapped_column(String(20), primary_key=True)
    etiqueta: Mapped[str] = mapped_column(String(80), nullable=False)
    # Da valor real al catálogo: habilita RN-CVI-006 (un producto
    # fraccionable exige unidad con decimales) sin enumerar códigos.
    permite_decimales: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")


class MetodoPago(CatalogMixin, Base):
    __tablename__ = "metodo_pago"

    codigo: Mapped[str] = mapped_column(String(20), primary_key=True)
    etiqueta: Mapped[str] = mapped_column(String(80), nullable=False)
    es_electronico: Mapped[bool] = mapped_column(Boolean, nullable=False)


class EstadoPago(CatalogMixin, Base):
    __tablename__ = "estado_pago"

    codigo: Mapped[str] = mapped_column(String(20), primary_key=True)
    etiqueta: Mapped[str] = mapped_column(String(80), nullable=False)
    es_estado_final: Mapped[bool] = mapped_column(Boolean, nullable=False)


class EstadoVenta(CatalogMixin, Base):
    __tablename__ = "estado_venta"

    codigo: Mapped[str] = mapped_column(String(20), primary_key=True)
    etiqueta: Mapped[str] = mapped_column(String(80), nullable=False)
    # 'anulada' no debe sumar al margen/ticket promedio (OT1.1/OT1.4) — el
    # ETL de 011 aplica esta regla como dato, sin duplicar el WHERE.
    cuenta_para_ingresos: Mapped[bool] = mapped_column(Boolean, nullable=False)


# ---------------------------------------------------------------------------
# Tablas operativas
# ---------------------------------------------------------------------------


class Producto(Base):
    __tablename__ = "producto"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(Text, nullable=False)
    categoria_id: Mapped[int] = mapped_column(ForeignKey("categoria.id"), nullable=False)
    codigo_barras: Mapped[str | None] = mapped_column(Text, nullable=True, unique=True)
    unidad_venta_codigo: Mapped[str] = mapped_column(
        String(20), ForeignKey("unidad_medida.codigo"), nullable=False
    )
    unidad_inventario_codigo: Mapped[str] = mapped_column(
        String(20), ForeignKey("unidad_medida.codigo"), nullable=False
    )
    es_fraccionable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    factor_conversion: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    # es_perecedero se precarga desde categoria.es_perecedero al crear, pero
    # el producto manda: dentro de "Lácteos" puede existir leche en polvo.
    es_perecedero: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    activo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    creado_en: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())

    __table_args__ = (
        CheckConstraint(
            "es_fraccionable = false OR factor_conversion IS NOT NULL",
            name="ck_producto_fraccionable_requiere_factor",
        ),
        Index("ix_producto_categoria", "categoria_id"),
        # RN-CVI-006 (es_fraccionable exige unidad_venta con permite_decimales)
        # depende del valor de otra tabla — no es un CHECK de una sola fila,
        # se valida en servicio, mismo patrón que RN-AD-001 de 010.
    )


class StockSucursal(Base):
    __tablename__ = "stock_sucursal"

    id: Mapped[int] = mapped_column(primary_key=True)
    producto_id: Mapped[int] = mapped_column(ForeignKey("producto.id"), nullable=False)
    sucursal_id: Mapped[int] = mapped_column(ForeignKey("sucursal.id"), nullable=False)
    cantidad_disponible: Mapped[float] = mapped_column(Numeric(10, 3), nullable=False, default=0, server_default="0")
    dias_sin_venta: Mapped[int] = mapped_column(nullable=False, default=0, server_default="0")
    marcado_sin_rotacion: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # RN-CVI-005 (enmienda v1.2) — umbral de reposición, alimenta la alerta
    # de quiebre de stock que consume 004-pronostico-demanda.
    stock_minimo: Mapped[float] = mapped_column(Numeric(10, 3), nullable=False, default=0, server_default="0")
    actualizado_en: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("producto_id", "sucursal_id", name="ux_stock_producto_sucursal"),
        CheckConstraint("cantidad_disponible >= 0", name="ck_stock_cantidad_no_negativa"),
        CheckConstraint("stock_minimo >= 0", name="ck_stock_minimo_no_negativo"),
    )


class LoteProducto(Base):
    __tablename__ = "lote_producto"

    id: Mapped[int] = mapped_column(primary_key=True)
    producto_id: Mapped[int] = mapped_column(ForeignKey("producto.id"), nullable=False)
    sucursal_id: Mapped[int] = mapped_column(ForeignKey("sucursal.id"), nullable=False)
    fecha_caducidad: Mapped[date] = mapped_column(Date, nullable=False)
    cantidad_lote: Mapped[float] = mapped_column(Numeric(10, 3), nullable=False)
    cantidad_restante: Mapped[float] = mapped_column(Numeric(10, 3), nullable=False)
    fecha_ingreso: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    retirado_en: Mapped[datetime | None] = mapped_column(nullable=True)
    motivo_retiro: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        CheckConstraint("cantidad_lote > 0", name="ck_lote_cantidad_positiva"),
        CheckConstraint(
            "cantidad_restante >= 0 AND cantidad_restante <= cantidad_lote",
            name="ck_lote_restante_en_rango",
        ),
    )


class AjusteInventario(Base):
    __tablename__ = "ajuste_inventario"

    id: Mapped[int] = mapped_column(primary_key=True)
    producto_id: Mapped[int] = mapped_column(ForeignKey("producto.id"), nullable=False)
    sucursal_id: Mapped[int] = mapped_column(ForeignKey("sucursal.id"), nullable=False)
    cantidad_ajuste: Mapped[float] = mapped_column(Numeric(10, 3), nullable=False)
    motivo: Mapped[str] = mapped_column(Text, nullable=False)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuario.id"), nullable=False)
    fecha: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())

    __table_args__ = (
        CheckConstraint("length(motivo) >= 3", name="ck_ajuste_motivo_minimo"),
    )


class Venta(Base):
    """`numero_documento`: nota de venta interna (no comprobante certificado
    SRI), derivada del propio `id` con GENERATED — no requiere correlativo
    ni tabla aparte, y su unicidad la garantiza la del `id` que la genera
    (enmienda v1.2). `turno_caja_id` y `cliente_id` son FKs externas
    diferidas — ver docstring del módulo.

    `datafono_id` (enmienda v1.5, auditoría de riesgos derivados) es FK
    externa hacia `datafono` (`007-pagos-seguridad`) — NO diferida, porque
    007 ya existía cuando se agregó esta columna. Antes de esta enmienda,
    una venta con tarjeta/electrónico no dejaba ningún rastro de qué
    terminal físico la cobró: si aparecía una disputa o un fraude,
    `alerta_fraude_pago` (006) podía señalar la venta, pero no había forma
    de cruzar esa venta contra el estado de seguridad del datáfono que la
    procesó en ese momento (RN-CVI-011)."""

    __tablename__ = "venta"

    id: Mapped[int] = mapped_column(primary_key=True)
    numero_documento: Mapped[str] = mapped_column(
        Text,
        Computed("'V-' || lpad(id::text, 8, '0')", persisted=True),
        unique=True,
    )
    sucursal_id: Mapped[int] = mapped_column(ForeignKey("sucursal.id"), nullable=False)
    turno_caja_id: Mapped[int] = mapped_column(ForeignKey("turno_caja.id"), nullable=False)
    cajero_id: Mapped[int] = mapped_column(ForeignKey("usuario.id"), nullable=False)
    cliente_id: Mapped[int | None] = mapped_column(ForeignKey("cliente.id"), nullable=True)
    # Opcional (RF-CVI-017, enmienda v1.1): permite calcular
    # fecha_hora - hora_inicio_cobro como duración real del cobro (OT2.2, <90s).
    hora_inicio_cobro: Mapped[datetime | None] = mapped_column(nullable=True)
    fecha_hora: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    subtotal: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    descuento_aplicado: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0, server_default="0")
    iva: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)  # 15% sobre (subtotal - descuento), Art. 4.1
    total: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    metodo_pago: Mapped[str] = mapped_column(String(20), ForeignKey("metodo_pago.codigo"), nullable=False)
    estado_pago: Mapped[str] = mapped_column(
        String(20), ForeignKey("estado_pago.codigo"), nullable=False, default="pendiente", server_default="pendiente"
    )
    estado_venta: Mapped[str] = mapped_column(
        String(20), ForeignKey("estado_venta.codigo"), nullable=False, default="completada", server_default="completada"
    )
    motivo_anulacion: Mapped[str | None] = mapped_column(Text, nullable=True)
    anulada_en: Mapped[datetime | None] = mapped_column(nullable=True)
    datafono_id: Mapped[int | None] = mapped_column(ForeignKey("datafono.id"), nullable=True)

    __table_args__ = (
        CheckConstraint("subtotal >= 0", name="ck_venta_subtotal_no_negativo"),
        CheckConstraint(
            "total = subtotal - descuento_aplicado + iva", name="ck_venta_total_coherente"
        ),
        CheckConstraint(
            "estado_venta <> 'anulada' OR motivo_anulacion IS NOT NULL",
            name="ck_venta_anulada_requiere_motivo",
        ),
        # RN-CVI-011 (enmienda v1.5): un pago en efectivo nunca pasa por un
        # datáfono — la parte de la regla que SÍ es expresable como CHECK.
        # La otra mitad (obligatorio para tarjeta/electrónico cuando la
        # sucursal tiene al menos un datáfono activo) no lo es — depende de
        # una fila de OTRA tabla (`datafono`) — y se valida en el router,
        # igual que RN-CF-001 en 002.
        CheckConstraint(
            "metodo_pago <> 'efectivo' OR datafono_id IS NULL",
            name="ck_venta_efectivo_sin_datafono",
        ),
        Index("ix_venta_sucursal_fecha", "sucursal_id", "fecha_hora"),
        Index("ix_venta_turno_caja", "turno_caja_id"),
        Index("ix_venta_datafono", "datafono_id"),
    )


class DetalleVenta(Base):
    """`precio_unitario_aplicado` y `unidad_venta_codigo` son snapshots
    deliberados (RN-CVI-003): el historial de ventas nunca cambia si el
    catálogo cambia después. `unidad_venta_codigo` es FK además de
    snapshot — guarda la unidad con la que se vendió, pero no puede
    contener un valor fuera del catálogo (enmienda v1.3)."""

    __tablename__ = "detalle_venta"

    id: Mapped[int] = mapped_column(primary_key=True)
    venta_id: Mapped[int] = mapped_column(ForeignKey("venta.id"), nullable=False)
    producto_id: Mapped[int] = mapped_column(ForeignKey("producto.id"), nullable=False)
    cantidad_venta: Mapped[float] = mapped_column(Numeric(10, 3), nullable=False)
    unidad_venta_codigo: Mapped[str] = mapped_column(
        String(20), ForeignKey("unidad_medida.codigo"), nullable=False
    )
    cantidad_inventario: Mapped[float] = mapped_column(Numeric(10, 3), nullable=False)  # ya convertida vía factor_conversion
    precio_unitario_aplicado: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    subtotal_item: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)

    __table_args__ = (
        CheckConstraint("cantidad_venta > 0", name="ck_detalle_cantidad_positiva"),
        # round(): cantidad_venta (escala 3) * precio_unitario_aplicado
        # (escala 2) da un producto exacto de escala 5 — nunca sería
        # literalmente igual a subtotal_item (escala 2) sin redondear
        # (corregido en af785599e904, encontrado al implementar POST /ventas).
        CheckConstraint(
            "subtotal_item = round(cantidad_venta * precio_unitario_aplicado, 2)",
            name="ck_detalle_subtotal_coherente",
        ),
    )


class ProductoSustituto(Base):
    """Relación dirigida (RN-CVI-004): si la sustitución es de doble vía el
    servicio inserta (A,B) y (B,A); la tabla no asume simetría — permite
    modelar también sustituciones de una sola vía. Consumida por
    004-pronostico-demanda ante quiebres de stock."""

    __tablename__ = "producto_sustituto"

    id: Mapped[int] = mapped_column(primary_key=True)
    producto_id: Mapped[int] = mapped_column(ForeignKey("producto.id"), nullable=False)
    producto_sustituto_id: Mapped[int] = mapped_column(ForeignKey("producto.id"), nullable=False)
    activo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    creado_en: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("producto_id", "producto_sustituto_id", name="ux_producto_sustituto"),
        CheckConstraint("producto_sustituto_id <> producto_id", name="ck_sustituto_no_autoreferencia"),
    )


class Anaquel(Base):
    """Layout/anaquel limitado (enmienda 2026-09-05, auditoría de riesgos
    derivados) — un espacio físico de exhibición dentro de una sucursal.
    `capacidad_maxima` es opcional: NULL significa "sin límite declarado
    todavía", nunca se asume 0 ni infinito por defecto (mismo criterio que
    RN-PS-001 para un datáfono sin revisión — la ausencia de dato nunca se
    disfraza de un valor)."""

    __tablename__ = "anaquel"

    id: Mapped[int] = mapped_column(primary_key=True)
    sucursal_id: Mapped[int] = mapped_column(ForeignKey("sucursal.id"), nullable=False)
    codigo: Mapped[str] = mapped_column(String(20), nullable=False)
    descripcion: Mapped[str | None] = mapped_column(String(200), nullable=True)
    capacidad_maxima: Mapped[int | None] = mapped_column(nullable=True)
    activo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    creado_en: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("sucursal_id", "codigo", name="ux_anaquel_sucursal_codigo"),
        CheckConstraint("capacidad_maxima IS NULL OR capacidad_maxima > 0", name="ck_anaquel_capacidad_positiva"),
    )


class ProductoUbicacion(Base):
    """Asignación vigente de un producto a un anaquel, por sucursal — un
    producto tiene una sola ubicación vigente por sucursal a la vez (RN-
    CVI-010), no historial: es una decisión operativa de reposición que
    cambia con frecuencia, no un hecho de negocio que deba conservar sus
    versiones anteriores (a diferencia de `historial_precio_producto`)."""

    __tablename__ = "producto_ubicacion"

    id: Mapped[int] = mapped_column(primary_key=True)
    producto_id: Mapped[int] = mapped_column(ForeignKey("producto.id"), nullable=False)
    sucursal_id: Mapped[int] = mapped_column(ForeignKey("sucursal.id"), nullable=False)
    anaquel_id: Mapped[int] = mapped_column(ForeignKey("anaquel.id"), nullable=False)
    asignado_por: Mapped[int] = mapped_column(ForeignKey("usuario.id"), nullable=False)
    actualizado_en: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("producto_id", "sucursal_id", name="ux_ubicacion_producto_sucursal"),
    )
