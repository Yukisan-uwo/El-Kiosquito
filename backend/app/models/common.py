"""
Piezas compartidas por los modelos de los 11 módulos.

`CatalogMixin` es la estructura base que la enmienda de catálogos maestros
(`el-kiosquito-enmienda-catalogos-maestros.md` §2) fija para **todo**
catálogo del proyecto: `codigo` (clave natural, definida en cada catálogo
porque el largo de VARCHAR varía), `etiqueta`, `orden` y `activo`. Ningún
catálogo se borra — baja lógica con `activo = false` (ver notas de
integridad transversales de 010), así que no hay ni falta un método delete.
"""

from sqlalchemy import Boolean, SmallInteger
from sqlalchemy.orm import Mapped, mapped_column


class CatalogMixin:
    """orden/activo son idénticos en los 32 catálogos; codigo/etiqueta se
    declaran en cada uno porque el largo de VARCHAR no es el mismo."""

    orden: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0, server_default="0")
    activo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
