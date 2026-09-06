"""
Modelo 3/5 (Art. 5.6): Predicción de churn — clasificación con
scikit-learn, distinguiendo ciclo normal de abandono real (Art. 4.6).

A diferencia de los otros 4 modelos, este entrena contra PostgreSQL
directo, no contra ClickHouse: la etiqueta real de entrenamiento es
`evaluacion_churn.es_riesgo_real` (002-clientes-fidelizacion) — la
distinción "en riesgo real" vs. "ciclo normal" que el negocio ya evaluó
y registró, no algo que este script pueda inventar. Ninguna tabla de
`elkiosquito_dw` guarda esa etiqueta (correcto: es una decisión
operativa de 002, no un hecho analítico). Las features de
comportamiento (frecuencia, margen, recencia) SÍ sirven de
`segmento_cliente`, tomando la fila vigente en la fecha de cada
evaluación — nunca el gasto acumulado solo (Art. 4.5).

`evaluacion_churn` empieza vacía en un sistema nuevo (nadie la siembra
en `tests/seed_test_data.sql` a propósito: es la salida de un proceso
de negocio, no un dato maestro) — con 0 filas este modelo se reporta
honestamente `tamano_muestra=0`, que es el estado correcto hasta que el
negocio empiece a evaluar clientes.
"""

from datetime import date

import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import f1_score
from sklearn.model_selection import train_test_split

MODELO = "churn"
METRICA = "F1"

_FEATURES = ["dias_sin_compra_al_momento", "frecuencia_historica_dias", "frecuencia_snapshot", "margen_snapshot"]


def _extraer_dataset(pg_conn) -> pd.DataFrame:
    with pg_conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                ec.cliente_id, ec.es_riesgo_real, ec.dias_sin_compra_al_momento,
                ec.frecuencia_historica_dias, ec.fecha_evaluacion,
                sc.frecuencia_snapshot, sc.margen_snapshot
            FROM evaluacion_churn ec
            LEFT JOIN LATERAL (
                -- Fila de segmento_cliente vigente en la fecha de ESA
                -- evaluación, no la vigente hoy — evaluar contra el
                -- estado actual del cliente distorsionaría una
                -- evaluación pasada (misma razón que dim_cliente en
                -- ClickHouse conserva el rango SCD2 en vez de solo lo
                -- vigente).
                SELECT frecuencia_snapshot, margen_snapshot
                FROM segmento_cliente sc2
                WHERE sc2.cliente_id = ec.cliente_id
                  AND sc2.fecha_calculo <= ec.fecha_evaluacion
                ORDER BY sc2.fecha_calculo DESC
                LIMIT 1
            ) sc ON true
            """
        )
        filas = cur.fetchall()
    columnas = [
        "cliente_id", "es_riesgo_real", "dias_sin_compra_al_momento",
        "frecuencia_historica_dias", "fecha_evaluacion", "frecuencia_snapshot", "margen_snapshot",
    ]
    dataset = pd.DataFrame(filas, columns=columnas)
    if dataset.empty:
        return dataset
    # Sin segmento_cliente previo a la evaluación: 0 es un valor neutro
    # razonable (cliente sin historial de segmentación todavía), nunca
    # se descarta la fila — la etiqueta real (es_riesgo_real) sigue
    # siendo válida aunque falte esta feature secundaria.
    dataset["frecuencia_snapshot"] = dataset["frecuencia_snapshot"].fillna(0.0)
    dataset["margen_snapshot"] = dataset["margen_snapshot"].fillna(0.0)
    dataset["frecuencia_historica_dias"] = dataset["frecuencia_historica_dias"].fillna(
        dataset["dias_sin_compra_al_momento"]
    )
    return dataset


def entrenar(pg_conn) -> dict:
    dataset = _extraer_dataset(pg_conn)
    if dataset.empty:
        return {"tamano_muestra": 0, "periodo_inicio": None, "periodo_fin": None, "valor_metrica": None}

    periodo_inicio = dataset["fecha_evaluacion"].min().date()
    periodo_fin = dataset["fecha_evaluacion"].max().date()

    # Con muy pocas evaluaciones, o si todas comparten la misma clase
    # (todas riesgo real o todas ciclo normal), un F1 de holdout no
    # significa nada — se reporta la muestra real igual.
    clases = dataset["es_riesgo_real"].nunique()
    if len(dataset) < 10 or clases < 2:
        return {
            "tamano_muestra": len(dataset),
            "periodo_inicio": periodo_inicio,
            "periodo_fin": periodo_fin,
            "valor_metrica": None,
        }

    X, y = dataset[_FEATURES], dataset["es_riesgo_real"]
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
    modelo = RandomForestClassifier(n_estimators=200, max_depth=6, random_state=42, class_weight="balanced")
    modelo.fit(X_train, y_train)
    f1 = f1_score(y_test, modelo.predict(X_test), zero_division=0)

    return {
        "tamano_muestra": len(dataset),
        "periodo_inicio": periodo_inicio,
        "periodo_fin": periodo_fin,
        "valor_metrica": float(f1),
    }
