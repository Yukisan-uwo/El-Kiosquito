"""
Modelo 4/5 (Art. 5.6): Anomalías en cuadre de caja — Isolation Forest
(no supervisado) para identificar patrones de fraude interno más allá
de un umbral fijo (OT3.4). Grano: un cierre de turno
(`fact_cuadre_caja` con `es_checkpoint = 0`) — los checkpoints horarios
intermedios no tienen `monto_contado` (son solo puntos de control, ver
el-kiosquito-clickhouse-fact-dim.md §3) y no aportan una diferencia real
que evaluar.

Métrica reportada (F1) — nota de honestidad importante para quien
revise este script: `incidencia_cuadre_caja` (006-caja-mermas-fraude,
la tabla donde este modelo dejaría sus resultados en producción) es
append-only y la genera el propio sistema, no hay ninguna fila todavía
en ningún ambiente — no existe un conjunto de incidencias YA
CONFIRMADAS contra el cual medir un F1 real. Mientras eso no exista, el
F1 se calcula contra un PROXY explícito (`diferencia != 0` = posible
anomalía) — no es una etiqueta de fraude confirmado, es la mejor señal
disponible hoy. El día que existan incidencias con `estado` resuelto
(confirmada/descartada), ese será el reemplazo correcto de este proxy.
"""

import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.metrics import f1_score

from ml.datos import a_dataframe

MODELO = "anomalias_caja"
METRICA = "F1"

_FEATURES = ["diferencia_abs", "monto_esperado", "hora", "cajero_id", "sucursal_id"]


def _extraer_dataset(ch_client) -> pd.DataFrame:
    cierres = a_dataframe(
        ch_client,
        """
        SELECT fecha, hora, turno_caja_id, sucursal_id, cajero_id, monto_esperado, diferencia
        FROM fact_cuadre_caja
        WHERE es_checkpoint = 0 AND diferencia IS NOT NULL
        """,
        ["fecha", "hora", "turno_caja_id", "sucursal_id", "cajero_id", "monto_esperado", "diferencia"],
    )
    if cierres.empty:
        return cierres
    cierres["fecha"] = pd.to_datetime(cierres["fecha"])
    cierres["diferencia_abs"] = cierres["diferencia"].astype(float).abs()
    return cierres


def entrenar(ch_client) -> dict:
    dataset = _extraer_dataset(ch_client)
    if dataset.empty:
        return {"tamano_muestra": 0, "periodo_inicio": None, "periodo_fin": None, "valor_metrica": None}

    periodo_inicio = dataset["fecha"].min().date()
    periodo_fin = dataset["fecha"].max().date()

    # Proxy de "posible anomalía" (ver docstring del módulo). Si todos
    # los cierres cuadraron exacto o todos tienen diferencia, el proxy
    # no separa nada — F1 no tiene sentido, se reporta la muestra igual.
    proxy_anomalo = (dataset["diferencia_abs"] > 0).astype(int)
    if len(dataset) < 10 or proxy_anomalo.nunique() < 2:
        return {
            "tamano_muestra": len(dataset),
            "periodo_inicio": periodo_inicio,
            "periodo_fin": periodo_fin,
            "valor_metrica": None,
        }

    X = dataset[_FEATURES]
    contaminacion = min(max(proxy_anomalo.mean(), 0.01), 0.5)
    modelo = IsolationForest(contamination=contaminacion, random_state=42)
    # -1 = anómalo, 1 = normal (convención de IsolationForest) → se
    # traduce a 1/0 para comparar contra el proxy binario.
    prediccion_anomalo = (modelo.fit_predict(X) == -1).astype(int)
    f1 = f1_score(proxy_anomalo, prediccion_anomalo, zero_division=0)

    return {
        "tamano_muestra": len(dataset),
        "periodo_inicio": periodo_inicio,
        "periodo_fin": periodo_fin,
        "valor_metrica": float(f1),
    }
