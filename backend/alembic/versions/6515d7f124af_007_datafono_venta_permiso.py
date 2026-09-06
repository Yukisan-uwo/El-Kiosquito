"""007_datafono_venta_permiso

Enmienda v1.6 de 001-core-ventas-inventario / v1.1 de 007-pagos-seguridad
(2026-09-06). Hueco encontrado al construir el checkout real del POS del
cajero (Tarea #55 del frontend): `POST /ventas` de 001 exige `datafono_id`
para un pago con tarjeta/electrónico cuando la sucursal tiene terminales
activos (RN-CVI-011, enmienda v1.5), pero el rol `cajero` nunca tuvo el
permiso `datafono`/`leer` — fue una decisión explícita de la migración
`a17e3a247d84_007_pagos_seguridad` ("el cajero no tiene por qué ver ni
tocar esto, RNF de seguridad, no es parte de su operación diaria en el
POS"). Sin poder listar los datáfonos de su propia sucursal, el cajero no
tenía ninguna forma real de saber qué `id` numérico enviar.

Se agrega un recurso NUEVO y deliberadamente más angosto, `datafono_venta`,
en vez de ampliar `datafono`: el endpoint que lo usa
(`GET /sucursales/{id}/datafonos-disponibles`) solo devuelve `id` y
`codigo_serie` — nunca el estado de revisión de seguridad
(`sin_revision`/`estado_vigente`/`fecha_ultima_revision`) que sí expone
`GET /sucursales/{id}/datafonos` bajo `datafono`/`leer`. Esto preserva
intacta la intención original del RNF de 007 (el cajero no debe ver el
estado de seguridad de los terminales) mientras cierra el hueco real de
que necesita saber qué terminal físico está usando para cobrar. Se
concede a `cajero` y `encargado_sucursal` — los dos roles que ya pueden
abrir/cerrar turnos de caja (`turno_caja` en 006) — no a `dueno` ni
`encargado_compras`, que no operan el POS.

Revision ID: 6515d7f124af
Revises: b4e1c9a0f3d7
Create Date: 2026-09-06 01:56:02.359484

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6515d7f124af'
down_revision: Union[str, None] = 'b4e1c9a0f3d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    recurso_sistema = sa.table(
        "recurso_sistema",
        sa.column("codigo", sa.String),
        sa.column("etiqueta", sa.String),
        sa.column("modulo", sa.String),
        sa.column("es_auditable", sa.Boolean),
        sa.column("orden", sa.Integer),
    )
    op.bulk_insert(
        recurso_sistema,
        [
            {
                "codigo": "datafono_venta",
                "etiqueta": "Selección de datáfono para cobro (sin estado de seguridad)",
                "modulo": "007-pagos-seguridad",
                "es_auditable": False,
                "orden": 21,
            },
        ],
    )

    permiso_rol = sa.table(
        "permiso_rol",
        sa.column("rol", sa.String),
        sa.column("recurso", sa.String),
        sa.column("operacion", sa.String),
        sa.column("permitido", sa.Boolean),
    )
    matrices = {
        "dueno": {"datafono_venta": {"leer": False}},
        "encargado_compras": {"datafono_venta": {"leer": False}},
        "encargado_sucursal": {"datafono_venta": {"leer": True}},
        "cajero": {"datafono_venta": {"leer": True}},
    }
    filas = [
        {"rol": rol_codigo, "recurso": recurso, "operacion": op_codigo, "permitido": permitido}
        for rol_codigo, matriz in matrices.items()
        for recurso, ops in matriz.items()
        for op_codigo, permitido in ops.items()
    ]
    op.bulk_insert(permiso_rol, filas)


def downgrade() -> None:
    op.execute("DELETE FROM permiso_rol WHERE recurso = 'datafono_venta'")
    op.execute("DELETE FROM recurso_sistema WHERE codigo = 'datafono_venta'")
