"""002_cliente_consentimiento_lopdp

Cierra un incumplimiento normativo real, no un riesgo de segundo orden:
el Art. 10.4 de la constitución (LOPDP Ecuador, Ley 0/2021) exige que
todo alta de cliente en el programa de fidelización registre el
consentimiento de la política de privacidad con fecha, hora y versión
— y `cliente` nunca tuvo esas columnas desde que el módulo se construyó.
Encontrado al preparar el formulario de alta de cliente del frontend
(POS del cajero), antes de escribir el componente, no después.

Backfill antes de NOT NULL (mismo orden estricto que T024 de 010 y la
baja de `precio_competencia.tipo_canal` en 003): las filas ya
existentes se crearon antes de que este requisito tuviera columnas
donde vivir, así que se marcan explícitamente como consentimiento
retroactivo — nunca se inventa una fecha de aceptación real que no
ocurrió.

Revision ID: 9a3c5f1e7b02
Revises: 57b7fd556e67
Create Date: 2026-09-05 22:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9a3c5f1e7b02'
down_revision: Union[str, None] = '57b7fd556e67'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_VERSION_RETROACTIVA = 'retroactivo-pre-art-10.4'


def upgrade() -> None:
    op.add_column('cliente', sa.Column('consentimiento_privacidad_en', sa.DateTime(timezone=True), nullable=True))
    op.add_column('cliente', sa.Column('version_politica_privacidad', sa.Text(), nullable=True))

    # Backfill honesto: nunca se afirma que un cliente ya existente
    # aceptó una política que no existía cuando se registró — se marca
    # con una versión que dice exactamente eso, usando creado_en como la
    # única fecha real disponible (RNF de honestidad, Art. 5.9 aplicado
    # acá a datos de cumplimiento en vez de a un modelo de ML).
    op.execute(
        f"""
        UPDATE cliente
        SET consentimiento_privacidad_en = creado_en,
            version_politica_privacidad = '{_VERSION_RETROACTIVA}'
        WHERE consentimiento_privacidad_en IS NULL
        """
    )

    op.alter_column('cliente', 'consentimiento_privacidad_en', nullable=False)
    op.alter_column('cliente', 'version_politica_privacidad', nullable=False)


def downgrade() -> None:
    op.drop_column('cliente', 'version_politica_privacidad')
    op.drop_column('cliente', 'consentimiento_privacidad_en')
