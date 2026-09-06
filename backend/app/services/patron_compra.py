"""
Motor real de detección de patrón de compra (005-promociones-inteligentes,
enmienda v1.2, auditoría de riesgos derivados). Antes de esta enmienda,
`tipo_origen = 'patron_compra'` (ver research.md, Decisión 3) se
disparaba desde "un proceso batch o la capa estratégica" sin que existiera
ningún proceso real — en la práctica era un tipo de cupón que solo un
humano podía activar a mano, sin ningún dato de soporte detrás.

Este módulo calcula reglas de asociación de mercado (market-basket) reales
sobre `detalle_venta`/`venta` — soporte, confianza y lift, el mismo
vocabulario estándar del análisis de canasta de compra — usando solo SQL
agregado y aritmética simple (no hace falta una librería de ML nueva: esto
no es un modelo entrenado, es conteo). Nunca escribe un cupón directamente:
guarda sugerencias en `sugerencia_patron_compra`, que un humano acepta o
descarta desde el router (mismo principio "sistema sugiere, humano
confirma" que `recomendacion_precio`, RN-PM-002 de 003).

Definiciones (canasta = una venta completada):
- soporte(A,B)   = P(A y B en la misma canasta) = co_ocurrencias / total_canastas
- confianza(A→B) = P(B | A)                     = co_ocurrencias / canastas_con_A
- lift(A→B)      = confianza(A→B) / P(B)          — > 1 indica asociación
  real, no solo que B es un producto popular que aparece en todos lados.

Para cada regla A→B que supera los tres umbrales, se buscan clientes que
ya compraron A al menos `veces_minimas_base` veces en el período Y que
nunca (en todo el historial, no solo en el período) compraron B — esa es
la oportunidad real de cross-sell que se sugiere.
"""

from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.promociones import SugerenciaPatronCompra


@dataclass
class ParametrosRecalculo:
    periodo_dias: int
    soporte_minimo: Decimal
    confianza_minima: Decimal
    lift_minimo: Decimal
    veces_minimas_base: int
    limite_por_cliente: int


@dataclass
class ResultadoRecalculo:
    reglas_evaluadas: int
    sugerencias_generadas: int
    sugerencias_omitidas_duplicadas: int


_SQL_PARES = text(
    """
    WITH ventas_periodo AS (
        SELECT v.id, v.cliente_id
        FROM venta v
        WHERE v.fecha_hora >= now() - (:periodo_dias * interval '1 day')
          AND v.estado_venta = 'completada'
    ),
    total_canastas AS (
        SELECT count(*)::numeric AS n FROM ventas_periodo
    ),
    items_por_producto AS (
        SELECT dv.producto_id, count(DISTINCT dv.venta_id)::numeric AS canastas
        FROM detalle_venta dv
        JOIN ventas_periodo vp ON vp.id = dv.venta_id
        GROUP BY dv.producto_id
    )
    SELECT
        dv1.producto_id AS producto_a,
        dv2.producto_id AS producto_b,
        count(DISTINCT dv1.venta_id)::numeric AS co_ocurrencias,
        ipa.canastas AS canastas_a,
        ipb.canastas AS canastas_b,
        tc.n AS total_canastas
    FROM detalle_venta dv1
    JOIN detalle_venta dv2
        ON dv1.venta_id = dv2.venta_id AND dv1.producto_id <> dv2.producto_id
    JOIN ventas_periodo vp ON vp.id = dv1.venta_id
    JOIN items_por_producto ipa ON ipa.producto_id = dv1.producto_id
    JOIN items_por_producto ipb ON ipb.producto_id = dv2.producto_id
    CROSS JOIN total_canastas tc
    WHERE tc.n > 0
    GROUP BY dv1.producto_id, dv2.producto_id, ipa.canastas, ipb.canastas, tc.n
    """
)

# Clientes que compraron producto_a al menos N veces dentro del período.
_SQL_CANDIDATOS = text(
    """
    SELECT v.cliente_id, count(DISTINCT dv.venta_id) AS veces
    FROM detalle_venta dv
    JOIN venta v ON v.id = dv.venta_id
    WHERE dv.producto_id = :producto_a
      AND v.cliente_id IS NOT NULL
      AND v.estado_venta = 'completada'
      AND v.fecha_hora >= now() - (:periodo_dias * interval '1 day')
    GROUP BY v.cliente_id
    HAVING count(DISTINCT dv.venta_id) >= :veces_minimas_base
    """
)

# Clientes que YA compraron producto_b alguna vez (todo el historial, no
# solo el período) — a esos no tiene sentido sugerírselo como novedad.
_SQL_YA_COMPRARON = text(
    """
    SELECT DISTINCT v.cliente_id
    FROM detalle_venta dv
    JOIN venta v ON v.id = dv.venta_id
    WHERE dv.producto_id = :producto_b
      AND v.cliente_id IS NOT NULL
      AND v.estado_venta = 'completada'
    """
)


def recalcular_sugerencias(db: Session, params: ParametrosRecalculo) -> ResultadoRecalculo:
    filas_pares = db.execute(_SQL_PARES, {"periodo_dias": params.periodo_dias}).mappings().all()

    reglas = []
    for fila in filas_pares:
        total = fila["total_canastas"]
        if not total:
            continue
        soporte = fila["co_ocurrencias"] / total
        confianza = fila["co_ocurrencias"] / fila["canastas_a"] if fila["canastas_a"] else 0
        p_b = fila["canastas_b"] / total
        lift = (confianza / p_b) if p_b else 0
        if (
            soporte >= params.soporte_minimo
            and confianza >= params.confianza_minima
            and lift >= params.lift_minimo
        ):
            reglas.append(
                {
                    "producto_a": fila["producto_a"],
                    "producto_b": fila["producto_b"],
                    "soporte": soporte,
                    "confianza": confianza,
                    "lift": lift,
                }
            )

    # Mejores reglas primero: si un cliente califica para varias, que las
    # que reciba (hasta el límite por cliente) sean las de mayor calidad.
    reglas.sort(key=lambda r: (r["confianza"] * r["lift"]), reverse=True)

    ya_sugeridas_este_run: dict[int, int] = {}  # cliente_id -> cantidad ya insertada en este recálculo
    generadas = 0
    omitidas_duplicadas = 0

    for regla in reglas:
        candidatos = db.execute(
            _SQL_CANDIDATOS,
            {
                "producto_a": regla["producto_a"],
                "periodo_dias": params.periodo_dias,
                "veces_minimas_base": params.veces_minimas_base,
            },
        ).mappings().all()
        if not candidatos:
            continue

        ya_compraron_b = {
            fila["cliente_id"]
            for fila in db.execute(_SQL_YA_COMPRARON, {"producto_b": regla["producto_b"]}).mappings().all()
        }

        for candidato in candidatos:
            cliente_id = candidato["cliente_id"]
            if cliente_id in ya_compraron_b:
                continue
            if ya_sugeridas_este_run.get(cliente_id, 0) >= params.limite_por_cliente:
                continue

            sugerencia = SugerenciaPatronCompra(
                cliente_id=cliente_id,
                producto_base_id=regla["producto_a"],
                producto_sugerido_id=regla["producto_b"],
                veces_comprado_base=int(candidato["veces"]),
                soporte=round(Decimal(regla["soporte"]), 4),
                confianza=round(Decimal(regla["confianza"]), 4),
                lift=round(Decimal(regla["lift"]), 4),
                periodo_dias=params.periodo_dias,
            )
            # SAVEPOINT propio por intento: un duplicado (ux_sugerencia_
            # patron_pendiente) solo debe deshacer esta fila, nunca las
            # sugerencias ya insertadas en las iteraciones anteriores de
            # este mismo recálculo.
            try:
                with db.begin_nested():
                    db.add(sugerencia)
                    db.flush()
            except IntegrityError:
                # Ya existe una sugerencia pendiente para este mismo par
                # cliente/producto_sugerido — no es un error, es el
                # recálculo respetando lo que ya espera una decisión
                # humana.
                omitidas_duplicadas += 1
                continue

            ya_sugeridas_este_run[cliente_id] = ya_sugeridas_este_run.get(cliente_id, 0) + 1
            generadas += 1

    db.commit()
    return ResultadoRecalculo(
        reglas_evaluadas=len(reglas),
        sugerencias_generadas=generadas,
        sugerencias_omitidas_duplicadas=omitidas_duplicadas,
    )
