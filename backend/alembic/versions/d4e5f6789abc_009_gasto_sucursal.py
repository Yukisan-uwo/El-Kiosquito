"""009_gasto_sucursal

Gastos fijos operativos del local (arriendo, luz/refrigeración, agua, sueldos,
internet/POS, mantenimiento). Base para el costeo por absorción y la simulación
de punto de equilibrio con IA.

Revision ID: d4e5f6789abc
Revises: 6515d7f124af
Create Date: 2026-09-09 16:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd4e5f6789abc'
down_revision: Union[str, None] = '6515d7f124af'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'gasto_sucursal',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('sucursal_id', sa.Integer(), nullable=False),
        sa.Column('concepto', sa.String(length=120), nullable=False),
        sa.Column('categoria_gasto', sa.String(length=50), server_default='servicio', nullable=False),
        sa.Column('monto_mensual', sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column('activo', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('creado_en', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.Column('actualizado_en', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['sucursal_id'], ['sucursal.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_gasto_sucursal_sucursal_activo',
        'gasto_sucursal',
        ['sucursal_id', 'activo'],
        unique=False,
    )

    # Sembrado inicial de gastos típicos para las sucursales existentes (sucursal 1 y 2 si existen)
    gasto_tabla = sa.table(
        'gasto_sucursal',
        sa.column('sucursal_id', sa.Integer),
        sa.column('concepto', sa.String),
        sa.column('categoria_gasto', sa.String),
        sa.column('monto_mensual', sa.Numeric),
        sa.column('activo', sa.Boolean),
    )

    # Insertamos gastos base para sucursal 1 (Matriz / Centro) y sucursal 2
    for s_id in [1, 2]:
        op.bulk_insert(
            gasto_tabla,
            [
                {
                    'sucursal_id': s_id,
                    'concepto': 'Arriendo de local comercial',
                    'categoria_gasto': 'arriendo',
                    'monto_mensual': 450.00 if s_id == 1 else 380.00,
                    'activo': True,
                },
                {
                    'sucursal_id': s_id,
                    'concepto': 'Energía eléctrica (refrigeradores vitrina y luces)',
                    'categoria_gasto': 'energia',
                    'monto_mensual': 165.00 if s_id == 1 else 140.00,
                    'activo': True,
                },
                {
                    'sucursal_id': s_id,
                    'concepto': 'Planilla de agua potable',
                    'categoria_gasto': 'servicio',
                    'monto_mensual': 22.50,
                    'activo': True,
                },
                {
                    'sucursal_id': s_id,
                    'concepto': 'Internet fibra óptica y enlace POS',
                    'categoria_gasto': 'servicio',
                    'monto_mensual': 35.00,
                    'activo': True,
                },
                {
                    'sucursal_id': s_id,
                    'concepto': 'Sueldo base personal cajero / atención',
                    'categoria_gasto': 'personal',
                    'monto_mensual': 460.00,
                    'activo': True,
                },
                {
                    'sucursal_id': s_id,
                    'concepto': 'Mantenimiento preventivo y limpieza',
                    'categoria_gasto': 'mantenimiento',
                    'monto_mensual': 45.00,
                    'activo': True,
                },
            ],
        )


def downgrade() -> None:
    op.drop_index('ix_gasto_sucursal_sucursal_activo', table_name='gasto_sucursal')
    op.drop_table('gasto_sucursal')
