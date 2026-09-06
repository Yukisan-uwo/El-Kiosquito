"""
Modelo 5/5 (Art. 5.6): Segmentación de clientes — K-Means por
comportamiento (frecuencia + margen + recencia, NUNCA solo gasto
acumulado — Art. 4.5) para personalizar fidelización (OT2.3).

Grano: un cliente = una fila, features calculadas sobre TODO su
histórico en `fact_venta_linea` hasta la fecha más reciente cargada en
ClickHouse (no hay ventana de evaluación como en `churn.py`: acá se
segmenta el estado actual del cliente, no se evalúa un evento puntual).

Métrica (silhouette): mide qué tan bien separados quedan los clusters,
no requiere ninguna etiqueta externa — a diferencia de los otros 4
modelos, este es no supervisado sin proxy, así que no tiene el problema
de honestidad de `anomalias_caja.py`.
"""

import pandas as pd
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler

from ml.datos import a_dataframe

MODELO = "segmentacion_clientes"
METRICA = "silhouette"

_FEATURES = ["frecuencia", "margen_promedio", "recencia_dias"]
_K = 3  # bajo/medio/alto valor — mínimo razonable para que el resultado sea legible en un dashboard


def _extraer_dataset(ch_client) -> pd.DataFrame:
    clientes = a_dataframe(
        ch_client,
        """
        SELECT
            cliente_id,
            count(DISTINCT fecha) AS frecuencia,
            avg(margen_linea) AS margen_promedio,
            max(fecha) AS ultima_compra
        FROM fact_venta_linea
        WHERE cuenta_para_ingresos = 1 AND cliente_id IS NOT NULL
        GROUP BY cliente_id
        """,
        ["cliente_id", "frecuencia", "margen_promedio", "ultima_compra"],
    )
    if clientes.empty:
        return clientes

    clientes["ultima_compra"] = pd.to_datetime(clientes["ultima_compra"])
    fecha_referencia = clientes["ultima_compra"].max()
    clientes["recencia_dias"] = (fecha_referencia - clientes["ultima_compra"]).dt.days
    return clientes


def entrenar(ch_client) -> dict:
    dataset = _extraer_dataset(ch_client)
    if dataset.empty:
        return {"tamano_muestra": 0, "periodo_inicio": None, "periodo_fin": None, "valor_metrica": None}

    periodo_inicio = dataset["ultima_compra"].min().date()
    periodo_fin = dataset["ultima_compra"].max().date()

    # K-Means/silhouette exigen más clientes que clusters, y silhouette
    # además exige al menos 2 clusters con más de 1 muestra cada uno —
    # con muy pocos clientes no hay forma honesta de calcularlo.
    if len(dataset) <= _K:
        return {
            "tamano_muestra": len(dataset),
            "periodo_inicio": periodo_inicio,
            "periodo_fin": periodo_fin,
            "valor_metrica": None,
        }

    X = StandardScaler().fit_transform(dataset[_FEATURES])
    modelo = KMeans(n_clusters=_K, random_state=42, n_init=10)
    etiquetas = modelo.fit_predict(X)

    if len(set(etiquetas)) < 2:
        valor_metrica = None
    else:
        valor_metrica = float(silhouette_score(X, etiquetas))

    return {
        "tamano_muestra": len(dataset),
        "periodo_inicio": periodo_inicio,
        "periodo_fin": periodo_fin,
        "valor_metrica": valor_metrica,
    }
