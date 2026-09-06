"""
007-pagos-seguridad — datáfonos por sucursal y su historial append-only
de revisiones de seguridad (actualizado/vencido).

Fuente: el-kiosquito-007-pagos-seguridad-data-model.md (tras enmienda
v1.1 de catálogos maestros). No comparte tablas con 006-caja-mermas-fraude
(Decisión 1 de su research.md) — ambos módulos tratan "pagos" desde
ángulos distintos (fraude en la transacción vs. seguridad del terminal).
"""

from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.common import CatalogMixin

# ---------------------------------------------------------------------------
# Catálogo maestro (enmienda v1.1)
# ---------------------------------------------------------------------------


class EstadoRevision(CatalogMixin, Base):
    """`cuenta_como_conforme` es el numerador de OT4.4 (% terminales con
    validación de seguridad actualizada) — mismo patrón que
    estado_venta.cuenta_para_ingresos en 001: una regla que vivía como
    WHERE repetido pasa a ser un dato del modelo."""

    __tablename__ = "estado_revision"

    codigo: Mapped[str] = mapped_column(String(40), primary_key=True)
    etiqueta: Mapped[str] = mapped_column(String(80), nullable=False)
    cuenta_como_conforme: Mapped[bool] = mapped_column(Boolean, nullable=False)


# ---------------------------------------------------------------------------
# Tablas operativas
# ---------------------------------------------------------------------------


class Datafono(Base):
    __tablename__ = "datafono"

    id: Mapped[int] = mapped_column(primary_key=True)
    sucursal_id: Mapped[int] = mapped_column(ForeignKey("sucursal.id"), nullable=False)
    codigo_serie: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    activo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")

    __table_args__ = (
        Index("ix_datafono_sucursal_activo", "sucursal_id", "activo"),
    )


class RevisionDatafono(Base):
    """Append-only estricto (RNF-PS-001). El estado vigente (RF-PS-004) se
    calcula en el momento de la consulta (DISTINCT ON ... ORDER BY
    fecha_revision DESC), nunca se cachea en `datafono`."""

    __tablename__ = "revision_datafono"

    id: Mapped[int] = mapped_column(primary_key=True)
    datafono_id: Mapped[int] = mapped_column(ForeignKey("datafono.id"), nullable=False)
    estado: Mapped[str] = mapped_column(String(40), ForeignKey("estado_revision.codigo"), nullable=False)
    observaciones: Mapped[str | None] = mapped_column(Text, nullable=True)
    fecha_revision: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    revisado_por: Mapped[int] = mapped_column(ForeignKey("usuario.id"), nullable=False)

    __table_args__ = (
        Index("ix_revision_datafono_fecha", "datafono_id", "fecha_revision"),
    )
