"""001_fix_ck_detalle_subtotal_coherente

Revision ID: af785599e904
Revises: b191cc325e88
Create Date: 2026-09-05 01:02:55.669154

Corrige un bug real de la migración de 001: `cantidad_venta` es
NUMERIC(10,3) y `precio_unitario_aplicado` es NUMERIC(10,2), así que su
producto exacto tiene escala 5 (p. ej. 2.500 * 1.99 = 4.97500) — nunca
puede ser literalmente igual a `subtotal_item`, que es NUMERIC(10,2)
(4.98). El CHECK original (`subtotal_item = cantidad_venta *
precio_unitario_aplicado`) por lo tanto rechazaba CUALQUIER venta de un
producto fraccionable con una cantidad que no diera un producto exacto
de 2 decimales — es decir, el caso de uso central de "vender por peso"
del propio negocio. Se descubrió al implementar el endpoint `POST
/ventas` (capa de API), antes de que ninguna venta real lo hubiera
disparado. Se redefine para comparar contra el producto ya redondeado a
2 decimales con `round()`, que es lo que la aplicación efectivamente
calcula y persiste.
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'af785599e904'
down_revision: Union[str, None] = 'b191cc325e88'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("ck_detalle_subtotal_coherente", "detalle_venta", type_="check")
    op.create_check_constraint(
        "ck_detalle_subtotal_coherente",
        "detalle_venta",
        "subtotal_item = round(cantidad_venta * precio_unitario_aplicado, 2)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_detalle_subtotal_coherente", "detalle_venta", type_="check")
    op.create_check_constraint(
        "ck_detalle_subtotal_coherente",
        "detalle_venta",
        "subtotal_item = cantidad_venta * precio_unitario_aplicado",
    )
