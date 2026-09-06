"""
009-expansion-sucursales — sucursal, checklist de apertura (8 ítems,
configurables desde el catálogo) y el log append-only de herencia de
catálogo/precios.

Fuente: specs-v2/009-expansion-sucursales/data-model.md (tras enmienda v1.1).
"""

from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, SmallInteger, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.common import CatalogMixin

# ---------------------------------------------------------------------------
# Catálogos maestros (enmienda v1.1)
# ---------------------------------------------------------------------------


class EstadoSucursal(CatalogMixin, Base):
    __tablename__ = "estado_sucursal"

    codigo: Mapped[str] = mapped_column(String(40), primary_key=True)
    etiqueta: Mapped[str] = mapped_column(String(80), nullable=False)
    opera_ventas: Mapped[bool] = mapped_column(Boolean, nullable=False)


class ItemChecklistApertura(Base):
    """No usa CatalogMixin.orden porque aquí `orden` es NOT NULL sin default
    (es el orden real de ejecución del ítem, siempre se declara a propósito).
    `es_bloqueante`: un ítem bloqueante (permiso_municipal, inspeccion_seguridad)
    nunca puede darse de baja del catálogo — RN-ES-004."""

    __tablename__ = "item_checklist_apertura"

    codigo: Mapped[str] = mapped_column(String(40), primary_key=True)
    etiqueta: Mapped[str] = mapped_column(String(120), nullable=False)
    orden: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    es_bloqueante: Mapped[bool] = mapped_column(Boolean, nullable=False)
    activo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")


# ---------------------------------------------------------------------------
# Tablas operativas
# ---------------------------------------------------------------------------


class Sucursal(Base):
    __tablename__ = "sucursal"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(Text, nullable=False)
    direccion: Mapped[str] = mapped_column(Text, nullable=False)
    # FK externa a 010-administracion.usuario — nullable: en_apertura puede no
    # tener Encargado asignado todavía.
    responsable_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"), nullable=True)
    estado: Mapped[str] = mapped_column(
        String(40), ForeignKey("estado_sucursal.codigo"), nullable=False,
        default="en_apertura", server_default="en_apertura",
    )
    fecha_registro: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    fecha_activacion: Mapped[datetime | None] = mapped_column(nullable=True)  # mide RNF-ES-002 (<15 días)
    fecha_cierre: Mapped[datetime | None] = mapped_column(nullable=True)


class ChecklistAperturaSucursal(Base):
    """Único (sucursal_id, item): se UPDATE-a al completarse, nunca se
    re-inserta (OO-ES02). Las filas se generan en la misma transacción que
    crea la sucursal, leyendo los ítems activo=true del catálogo."""

    __tablename__ = "checklist_apertura_sucursal"

    id: Mapped[int] = mapped_column(primary_key=True)
    sucursal_id: Mapped[int] = mapped_column(ForeignKey("sucursal.id"), nullable=False)
    item: Mapped[str] = mapped_column(String(40), ForeignKey("item_checklist_apertura.codigo"), nullable=False)
    completado: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    fecha_completado: Mapped[datetime | None] = mapped_column(nullable=True)
    completado_por: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"), nullable=True)

    __table_args__ = (
        UniqueConstraint("sucursal_id", "item", name="ux_checklist_sucursal_item"),
    )


class HerenciaCatalogoSucursal(Base):
    """UNIQUE(sucursal_id) impone RN-ES-002 (la herencia corre una sola vez) —
    append-only por diseño: la existencia de la fila ES el registro de que
    ya se ejecutó, no necesita columna de estado."""

    __tablename__ = "herencia_catalogo_sucursal"

    id: Mapped[int] = mapped_column(primary_key=True)
    sucursal_id: Mapped[int] = mapped_column(ForeignKey("sucursal.id"), nullable=False, unique=True)
    fecha: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    cantidad_productos_heredados: Mapped[int] = mapped_column(nullable=False)
    cantidad_productos_pendientes: Mapped[int] = mapped_column(nullable=False)
