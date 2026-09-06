"""
003-precios-margenes — historial de precio vigente por sucursal,
clasificación comercial gancho/nicho (con su historial SCD tipo 2 en tabla
aparte), observaciones de precio de competencia y recomendaciones del
motor de pricing dinámico.

Fuente: el-kiosquito-003-precios-margenes-data-model.md (tras enmienda
v1.2 de catálogos maestros).

`historial_costo_producto` (008-compras-proveedores) se **consulta** para
calcular el margen real en el momento de la petición — nunca se referencia
por FK ni se materializa aquí (nota del propio data-model.md).

Por qué `producto_clasificacion_historial` SÍ es tabla aparte y
`cliente_segmento_historial` (002) NO: `clasificacion_producto` tiene
`producto_id` como PK — una sola fila que se sobreescribe, sin historia
que rescatar. `segmento_cliente` (002) ya era append-only desde el
diseño original. La forma de la solución la dicta cómo estaba modelada
cada tabla, no una regla uniforme.
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
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.common import CatalogMixin

# ---------------------------------------------------------------------------
# Catálogos maestros (enmienda v1.2)
# ---------------------------------------------------------------------------


class ClasificacionComercial(CatalogMixin, Base):
    __tablename__ = "clasificacion_comercial"

    codigo: Mapped[str] = mapped_column(String(40), primary_key=True)
    etiqueta: Mapped[str] = mapped_column(String(80), nullable=False)
    # El rango esperado deja de estar quemado en el motor de pricing y pasa
    # a ser dato ajustable por el negocio (OT1.1).
    margen_objetivo_min: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False)
    margen_objetivo_max: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False)

    __table_args__ = (
        CheckConstraint("margen_objetivo_min >= 0", name="ck_clasif_margen_min_no_negativo"),
        CheckConstraint("margen_objetivo_max > margen_objetivo_min", name="ck_clasif_margen_max_mayor"),
    )


class FuentePrecio(CatalogMixin, Base):
    __tablename__ = "fuente_precio"

    codigo: Mapped[str] = mapped_column(String(40), primary_key=True)
    etiqueta: Mapped[str] = mapped_column(String(80), nullable=False)
    # Art. 5.9: un precio del motor dinámico debe traer justificación; uno
    # manual del encargado, no. Antes vivía como dos ramas de código.
    requiere_justificacion: Mapped[bool] = mapped_column(Boolean, nullable=False)


class CanalCompetencia(CatalogMixin, Base):
    __tablename__ = "canal_competencia"

    codigo: Mapped[str] = mapped_column(String(40), primary_key=True)
    etiqueta: Mapped[str] = mapped_column(String(80), nullable=False)
    # Un canal digital se revisa a diario, la tienda de la esquina cada
    # semana — habilita detectar observaciones vencidas (OT2.1).
    frecuencia_monitoreo_dias: Mapped[int] = mapped_column(SmallInteger, nullable=False)

    __table_args__ = (
        CheckConstraint("frecuencia_monitoreo_dias > 0", name="ck_canal_frecuencia_positiva"),
    )


class EstadoRecomendacion(CatalogMixin, Base):
    __tablename__ = "estado_recomendacion"

    codigo: Mapped[str] = mapped_column(String(40), primary_key=True)
    etiqueta: Mapped[str] = mapped_column(String(80), nullable=False)
    es_estado_final: Mapped[bool] = mapped_column(Boolean, nullable=False)


class FuenteCompetencia(Base):
    """`id SERIAL`, no clave natural — mismo caso que `categoria` en 001: el
    nombre lo escribe y corrige el negocio (p. ej. "Supermercado La
    Favorita — Quevedo centro"), y un local puede renombrarse sin que eso
    deba propagarse a las observaciones históricas."""

    __tablename__ = "fuente_competencia"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    canal_codigo: Mapped[str] = mapped_column(String(40), ForeignKey("canal_competencia.codigo"), nullable=False)
    activo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")


# ---------------------------------------------------------------------------
# Tablas operativas
# ---------------------------------------------------------------------------


class HistorialPrecioProducto(Base):
    """Append-only estricto (RNF-PM-002) — ningún router expone
    UPDATE/DELETE sobre esta tabla."""

    __tablename__ = "historial_precio_producto"

    id: Mapped[int] = mapped_column(primary_key=True)
    producto_id: Mapped[int] = mapped_column(ForeignKey("producto.id"), nullable=False)
    sucursal_id: Mapped[int] = mapped_column(ForeignKey("sucursal.id"), nullable=False)
    precio_venta: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    fuente: Mapped[str] = mapped_column(String(40), ForeignKey("fuente_precio.codigo"), nullable=False)
    vigente_desde: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    # Quien hizo el cambio manual, o quien aceptó la recomendación.
    registrado_por: Mapped[int] = mapped_column(ForeignKey("usuario.id"), nullable=False)

    __table_args__ = (
        CheckConstraint("precio_venta >= 0", name="ck_historial_precio_no_negativo"),
        Index(
            "ix_historial_precio_producto_sucursal_vigente",
            "producto_id",
            "sucursal_id",
            "vigente_desde",
        ),
    )


class ClasificacionProducto(Base):
    """Solo el estado vigente (una fila por producto, se sobreescribe). La
    historia vive en `producto_clasificacion_historial` — las dos se
    actualizan juntas o ninguna (enmienda v1.2)."""

    __tablename__ = "clasificacion_producto"

    producto_id: Mapped[int] = mapped_column(ForeignKey("producto.id"), primary_key=True)
    clasificacion: Mapped[str] = mapped_column(
        String(40), ForeignKey("clasificacion_comercial.codigo"), nullable=False
    )
    actualizado_en: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    actualizado_por: Mapped[int] = mapped_column(ForeignKey("usuario.id"), nullable=False)


class ProductoClasificacionHistorial(Base):
    """Dimensión SCD tipo 2 (enmienda v1.2) — tabla aparte porque
    `clasificacion_producto` no tiene historia que rescatar (ver docstring
    del módulo). Único UPDATE admitido: cerrar `fecha_hasta` de la fila
    vigente en la misma transacción que inserta la nueva."""

    __tablename__ = "producto_clasificacion_historial"

    id: Mapped[int] = mapped_column(primary_key=True)
    producto_id: Mapped[int] = mapped_column(ForeignKey("producto.id"), nullable=False)
    clasificacion: Mapped[str] = mapped_column(
        String(40), ForeignKey("clasificacion_comercial.codigo"), nullable=False
    )
    fecha_desde: Mapped[datetime] = mapped_column(nullable=False)
    fecha_hasta: Mapped[datetime | None] = mapped_column(nullable=True)  # NULL = vigente
    # Mínimo 10 caracteres, igual que las justificaciones del Art. 5.9:
    # reclasificar cambia la política de precios del producto.
    motivo_cambio: Mapped[str] = mapped_column(Text, nullable=False)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuario.id"), nullable=False)

    __table_args__ = (
        CheckConstraint("length(motivo_cambio) >= 10", name="ck_clasif_hist_motivo_minimo"),
        CheckConstraint(
            "fecha_hasta IS NULL OR fecha_hasta > fecha_desde", name="ck_clasif_hist_rango_valido"
        ),
        Index("ix_clasif_hist_producto_fecha", "producto_id", "fecha_desde"),
        # RN-PM-004 — un producto no puede tener dos clasificaciones
        # vigentes a la vez. Mismo patrón que segmento_cliente (002).
        Index(
            "ux_clasif_hist_vigente",
            "producto_id",
            unique=True,
            postgresql_where=text("fecha_hasta IS NULL"),
        ),
    )


class PrecioCompetencia(Base):
    """Sin `tipo_canal` (enmienda v1.2, 3NF): era dependencia transitiva de
    `fuente_competencia.canal_codigo`, no de la observación en sí — el
    canal se obtiene con el JOIN. No es un snapshot deliberado: un local
    no cambia de canal, así que no hay nada que congelar aquí."""

    __tablename__ = "precio_competencia"

    id: Mapped[int] = mapped_column(primary_key=True)
    producto_id: Mapped[int] = mapped_column(ForeignKey("producto.id"), nullable=False)
    fuente_competencia_id: Mapped[int] = mapped_column(ForeignKey("fuente_competencia.id"), nullable=False)
    precio_referencia: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    fecha_registro: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    registrado_por: Mapped[int] = mapped_column(ForeignKey("usuario.id"), nullable=False)

    __table_args__ = (
        CheckConstraint("precio_referencia >= 0", name="ck_precio_competencia_no_negativo"),
        Index("ix_precio_competencia_producto_fecha", "producto_id", "fecha_registro"),
        Index(
            "ix_precio_competencia_producto_fuente_fecha",
            "producto_id",
            "fuente_competencia_id",
            "fecha_registro",
        ),
    )


class RecomendacionPrecio(Base):
    """RN-PM-001 (índice único parcial): nunca dos recomendaciones
    pendientes simultáneas para el mismo producto/sucursal — mismo patrón
    de índice parcial que `turno_caja` (006) para un problema estructural
    análogo (un solo estado "activo" a la vez por combinación de claves)."""

    __tablename__ = "recomendacion_precio"

    id: Mapped[int] = mapped_column(primary_key=True)
    producto_id: Mapped[int] = mapped_column(ForeignKey("producto.id"), nullable=False)
    sucursal_id: Mapped[int] = mapped_column(ForeignKey("sucursal.id"), nullable=False)
    precio_actual_snapshot: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    precio_recomendado: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    # El modelo debe explicar qué factores consideró (Art. 5.9).
    justificacion: Mapped[str] = mapped_column(Text, nullable=False)
    estado: Mapped[str] = mapped_column(
        String(40), ForeignKey("estado_recomendacion.codigo"), nullable=False,
        default="pendiente", server_default="pendiente",
    )
    fecha_generada: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    fecha_resolucion: Mapped[datetime | None] = mapped_column(nullable=True)
    resuelto_por: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"), nullable=True)

    __table_args__ = (
        CheckConstraint("precio_recomendado >= 0", name="ck_recomendacion_precio_no_negativo"),
        CheckConstraint("length(justificacion) >= 10", name="ck_recomendacion_justificacion_minima"),
        Index("ix_recomendacion_sucursal_estado", "sucursal_id", "estado"),
        Index(
            "ux_recomendacion_pendiente_unica",
            "producto_id",
            "sucursal_id",
            unique=True,
            postgresql_where=text("estado = 'pendiente'"),
        ),
    )
