"""fix_ck_detalle_oc_motivo_desvio

Revision ID: 81b45384f520
Revises: af785599e904
Create Date: 2026-09-05 05:01:25.713660

Bug real encontrado probando 008-compras-proveedores (mismo patrón que
`af785599e904` para 001): `ck_detalle_oc_motivo_desvio_pronostico`
exigía que, si `cantidad_pedida > cantidad_recomendada_pronostico`,
`motivo_no_siguio_pronostico` YA estuviera presente en la misma fila —
pero el flujo real del contrato es (1) `GET .../pronostico?detalle_id=`
graba el snapshot de la recomendación en el momento exacto en que se
descubre que la excede, y (2) recién ahí el usuario puede llamar
`PATCH .../motivo-oferta` para justificarlo. El paso (1) por sí solo ya
viola el CHECK — confirmado en vivo (`IntegrityError` real contra
Postgres, no un caso hipotético).

RN-CP-001 pasa a validarse enteramente en el servicio, en el único
punto donde de verdad hay que bloquear el flujo: `registrarRecepcion`
(nunca al guardar el snapshot del pronóstico). Mismo patrón que otras
reglas inter-tabla no expresables como CHECK de una sola fila en este
proyecto (ej. RN-CVI-006): se documentan en el modelo, se validan en
servicio.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '81b45384f520'
down_revision: Union[str, None] = 'af785599e904'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint(
        "ck_detalle_oc_motivo_desvio_pronostico", "detalle_orden_compra", type_="check"
    )


def downgrade() -> None:
    op.create_check_constraint(
        "ck_detalle_oc_motivo_desvio_pronostico",
        "detalle_orden_compra",
        "cantidad_recomendada_pronostico IS NULL "
        "OR cantidad_pedida <= cantidad_recomendada_pronostico "
        "OR motivo_no_siguio_pronostico IS NOT NULL",
    )
