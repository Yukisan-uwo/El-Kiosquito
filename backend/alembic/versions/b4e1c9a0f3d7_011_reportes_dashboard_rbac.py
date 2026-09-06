"""011_reportes_dashboard_rbac

Cierra un vacío de arquitectura real, encontrado al construir el Dashboard
Dueño del frontend: los 3 KPIs compuestos que el diseño exige (margen,
merma, ticket promedio por sucursal) estaban documentados como "servidos
desde ClickHouse" pero nunca existió el endpoint REST que los sirviera —
la única puerta de entrada a esos datos era el asistente conversacional
(`services/asistente_tools.py`), que es dueño-exclusivo pero pensado para
que un LLM elija tools, no para que el frontend pinte 3 cards en cada
carga de pantalla.

Esta migración solo agrega el recurso `reportes_dashboard` a la matriz
RBAC real (mismo patrón retrofit documentado en
`el-kiosquito-backend-progreso.md`: cada módulo nuevo agrega sus propias
filas de `recurso_sistema`/`permiso_rol` sobre la matriz sembrada por
010-administracion, y el downgrade las borra a mano con DELETE). Los 3
endpoints en sí (`app/routers/analitica.py`) y el servicio
(`app/services/reportes_dashboard.py`) no tocan el esquema — consultan
ClickHouse, no PostgreSQL.

Dueño-exclusivo (solo `leer`): el resto de roles ya tiene su propia
analítica operativa scopeada por sucursal en PostgreSQL (001, etc.) —
esta es la comparación consolidada de RED completa que solo le sirve a
Gerencia General para decidir, mismo criterio que restringió el asistente
conversacional al rol dueño.

Revision ID: b4e1c9a0f3d7
Revises: 9a3c5f1e7b02
Create Date: 2026-09-05 22:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b4e1c9a0f3d7'
down_revision: Union[str, None] = '9a3c5f1e7b02'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    recurso_sistema = sa.table(
        "recurso_sistema",
        sa.column("codigo", sa.String),
        sa.column("etiqueta", sa.String),
        sa.column("modulo", sa.String),
        sa.column("es_auditable", sa.Boolean),
        sa.column("orden", sa.SmallInteger),
    )
    op.bulk_insert(
        recurso_sistema,
        [
            {
                "codigo": "reportes_dashboard",
                "etiqueta": "Reportes del Dashboard Dueño (ClickHouse)",
                "modulo": "011-analitica-reportes",
                "es_auditable": False,  # son GET de solo lectura agregada, no una operación crítica individual
                "orden": 30,
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
    op.bulk_insert(
        permiso_rol,
        [
            {"rol": "dueno", "recurso": "reportes_dashboard", "operacion": "leer", "permitido": True},
            {"rol": "encargado_compras", "recurso": "reportes_dashboard", "operacion": "leer", "permitido": False},
            {"rol": "encargado_sucursal", "recurso": "reportes_dashboard", "operacion": "leer", "permitido": False},
            {"rol": "cajero", "recurso": "reportes_dashboard", "operacion": "leer", "permitido": False},
        ],
    )


def downgrade() -> None:
    op.execute("DELETE FROM permiso_rol WHERE recurso = 'reportes_dashboard'")
    op.execute("DELETE FROM recurso_sistema WHERE codigo = 'reportes_dashboard'")
