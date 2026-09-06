"""
004-pronostico-demanda — demanda insatisfecha (quiebre de stock), el
pronóstico que produce el modelo de series de tiempo y el catálogo de
eventos locales usado como feature al entrenar.

Fuente: el-kiosquito-004-pronostico-demanda-data-model.md (tras enmienda
v1.2 de catálogos maestros).

`008-compras-proveedores` consulta este módulo por HTTP (nunca por FK)
para resolver su RN-CP-001 — no hay relación en el modelo de datos.
"""

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
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
# Catálogo maestro (enmienda v1.2)
# ---------------------------------------------------------------------------


class TipoEventoLocal(CatalogMixin, Base):
    """`afecta_demanda_al_alza`: el signo esperado del efecto es un dato,
    no una suposición del modelo — un feriado sube la demanda, un corte de
    servicios la baja. Descuenta confusores (Art. 5.6) sin que el modelo
    tenga que inferir el signo con pocos eventos por tipo."""

    __tablename__ = "tipo_evento_local"

    codigo: Mapped[str] = mapped_column(String(40), primary_key=True)
    etiqueta: Mapped[str] = mapped_column(String(80), nullable=False)
    afecta_demanda_al_alza: Mapped[bool] = mapped_column(Boolean, nullable=False)


# ---------------------------------------------------------------------------
# Tablas operativas
# ---------------------------------------------------------------------------


class DemandaInsatisfecha(Base):
    __tablename__ = "demanda_insatisfecha"

    id: Mapped[int] = mapped_column(primary_key=True)
    sucursal_id: Mapped[int] = mapped_column(ForeignKey("sucursal.id"), nullable=False)
    producto_id: Mapped[int] = mapped_column(ForeignKey("producto.id"), nullable=False)
    cajero_id: Mapped[int] = mapped_column(ForeignKey("usuario.id"), nullable=False)
    hora_evento: Mapped[datetime] = mapped_column(nullable=False)  # puede diferir de hora_registro (RF-PD-002)
    hora_registro: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    # RF-PD-006 (enmienda v1.1): el sustituto ofrecido es, en sí, un
    # producto — la relación conceptual con producto_sustituto (001) es de
    # negocio, no una FK a esa tabla de reglas.
    sustituto_ofrecido_id: Mapped[int | None] = mapped_column(ForeignKey("producto.id"), nullable=True)
    sustituto_aceptado: Mapped[bool | None] = mapped_column(nullable=True)

    __table_args__ = (
        CheckConstraint(
            "sustituto_aceptado IS NULL OR sustituto_ofrecido_id IS NOT NULL",
            name="ck_demanda_insatisfecha_sustituto_coherente",
        ),
        Index("ix_demanda_insatisfecha_sucursal_producto_hora", "sucursal_id", "producto_id", "hora_evento"),
    )


class PronosticoDemanda(Base):
    """Append-only estricto (RNF-PD-002): ningún router expone
    UPDATE/DELETE sobre pronósticos ya registrados."""

    __tablename__ = "pronostico_demanda"

    id: Mapped[int] = mapped_column(primary_key=True)
    producto_id: Mapped[int] = mapped_column(ForeignKey("producto.id"), nullable=False)
    sucursal_id: Mapped[int] = mapped_column(ForeignKey("sucursal.id"), nullable=False)
    cantidad_recomendada: Mapped[float] = mapped_column(Numeric(10, 3), nullable=False)
    tamano_muestra: Mapped[int] = mapped_column(nullable=False)
    periodo_inicio: Mapped[date] = mapped_column(Date, nullable=False)
    periodo_fin: Mapped[date] = mapped_column(Date, nullable=False)
    fecha_calculo: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())

    __table_args__ = (
        CheckConstraint("cantidad_recomendada >= 0", name="ck_pronostico_cantidad_no_negativa"),
        CheckConstraint("tamano_muestra > 0", name="ck_pronostico_muestra_positiva"),
        Index("ix_pronostico_producto_sucursal_fecha", "producto_id", "sucursal_id", "fecha_calculo"),
    )


class EventoLocal(Base):
    """No append-only en sentido estricto (se puede editar si se registró
    con una fecha mal digitada), pero sin ciclo de vida activo/inactivo —
    catálogo simple de eventos, feature adicional al entrenar el modelo."""

    __tablename__ = "evento_local"

    id: Mapped[int] = mapped_column(primary_key=True)
    # NULL = afecta a toda la cadena (feriado nacional); no NULL restringe
    # el efecto a una sucursal (fiesta patronal local).
    sucursal_id: Mapped[int | None] = mapped_column(ForeignKey("sucursal.id"), nullable=True)
    fecha_inicio: Mapped[date] = mapped_column(Date, nullable=False)
    fecha_fin: Mapped[date] = mapped_column(Date, nullable=False)
    tipo: Mapped[str] = mapped_column(String(40), ForeignKey("tipo_evento_local.codigo"), nullable=False)
    descripcion: Mapped[str] = mapped_column(Text, nullable=False)
    registrado_por: Mapped[int] = mapped_column(ForeignKey("usuario.id"), nullable=False)
    creado_en: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())

    __table_args__ = (
        CheckConstraint("fecha_fin >= fecha_inicio", name="ck_evento_local_rango_valido"),
        CheckConstraint("length(descripcion) >= 3", name="ck_evento_local_descripcion_minima"),
        Index("ix_evento_local_fechas", "fecha_inicio", "fecha_fin"),
        Index("ix_evento_local_sucursal_fecha", "sucursal_id", "fecha_inicio"),
    )
