"""001_venta_datafono_id

Enmienda v1.5 (auditoría de riesgos derivados, 2026-09-05). Cierra el
último de los cinco riesgos de segundo orden encontrados en la auditoría:
antes de esta migración, una venta con tarjeta/electrónico no dejaba
ningún rastro de qué datáfono físico la cobró — `datafono`/
`revision_datafono` (007-pagos-seguridad) vivían completamente
desconectados de `venta` (001), así que ante una disputa o un fraude no
había forma de cruzar la venta contra el estado de seguridad del
terminal que la procesó en ese momento.

FK directa (no diferida): 007 ya existía cuando se agregó esta columna,
a diferencia de `turno_caja_id`/`cliente_id` que sí se diferieron en su
momento porque 006/002 todavía no existían.

Revision ID: 57b7fd556e67
Revises: c267444e212d
Create Date: 2026-09-05 20:23:47.046254

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '57b7fd556e67'
down_revision: Union[str, None] = 'c267444e212d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('venta', sa.Column('datafono_id', sa.Integer(), nullable=True))
    op.create_index('ix_venta_datafono', 'venta', ['datafono_id'], unique=False)
    op.create_foreign_key('fk_venta_datafono', 'venta', 'datafono', ['datafono_id'], ['id'])
    # RN-CVI-011: la mitad de la regla que SÍ es expresable como CHECK de
    # una sola tabla — un pago en efectivo nunca lleva datáfono. La otra
    # mitad (obligatorio para tarjeta/electrónico cuando la sucursal tiene
    # un datáfono activo) depende de una fila de OTRA tabla y se valida en
    # el router (mismo criterio que RN-CF-001 en 002).
    op.create_check_constraint(
        'ck_venta_efectivo_sin_datafono',
        'venta',
        "metodo_pago <> 'efectivo' OR datafono_id IS NULL",
    )


def downgrade() -> None:
    op.drop_constraint('ck_venta_efectivo_sin_datafono', 'venta', type_='check')
    op.drop_constraint('fk_venta_datafono', 'venta', type_='foreignkey')
    op.drop_index('ix_venta_datafono', table_name='venta')
    op.drop_column('venta', 'datafono_id')
