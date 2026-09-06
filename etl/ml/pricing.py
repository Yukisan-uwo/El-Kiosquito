"""
Modelo 2/5 (Art. 5.6): Pricing dinámico — regresión sobre margen y
costo de reposición (OT1.1). Aprende del `precio_unitario` realmente
cobrado en cada línea de venta, dado el `costo_reposicion_vigente`
CONGELADO ese día (nunca el costo actual — ver la nota de diseño de
`fact_venta_linea` en el-kiosquito-clickhouse-fact-dim.md §3, la misma
razón por la que el margen histórico no se recalcula hacia atrás) y el
precio de competencia más cercano en el tiempo para ese producto: la
señal que un pricing dinámico real usaría para recomendar un precio.

Grano: una fila por línea de venta real (`fact_venta_linea`). No se
arma una grilla como en `demanda.py` — acá no tiene sentido una
observación de "precio" en un día sin venta, el precio solo existe
cuando se cobra.
"""

import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error
from sklearn.model_selection import train_test_split

from ml.datos import a_dataframe

MODELO = "pricing"
METRICA = "MAE"

_FEATURES = ["costo_reposicion_vigente", "precio_competencia", "tiene_competencia", "producto_id"]


def _extraer_dataset(ch_client) -> pd.DataFrame:
    ventas = a_dataframe(
        ch_client,
        """
        SELECT fecha, producto_id, precio_unitario, costo_reposicion_vigente
        FROM fact_venta_linea
        WHERE cuenta_para_ingresos = 1
        """,
        ["fecha", "producto_id", "precio_unitario", "costo_reposicion_vigente"],
    )
    if ventas.empty:
        return ventas
    ventas["fecha"] = pd.to_datetime(ventas["fecha"])

    competencia = a_dataframe(
        ch_client,
        """
        SELECT fecha, producto_id, avg(precio_competencia) AS precio_competencia
        FROM fact_precio_competencia
        GROUP BY fecha, producto_id
        """,
        ["fecha", "producto_id", "precio_competencia"],
    )

    if competencia.empty:
        ventas["precio_competencia"] = ventas["costo_reposicion_vigente"]
        ventas["tiene_competencia"] = 0
        return ventas

    competencia["fecha"] = pd.to_datetime(competencia["fecha"])
    partes = []
    for producto_id, grupo_ventas in ventas.groupby("producto_id"):
        grupo_comp = competencia[competencia["producto_id"] == producto_id].sort_values("fecha")
        grupo_ventas = grupo_ventas.sort_values("fecha")
        if grupo_comp.empty:
            grupo_ventas = grupo_ventas.copy()
            grupo_ventas["precio_competencia"] = grupo_ventas["costo_reposicion_vigente"]
            grupo_ventas["tiene_competencia"] = 0
        else:
            # Precio de competencia más cercano en el tiempo (antes o
            # después) a esa venta — `merge_asof` solo mira hacia atrás
            # por defecto, así que se prueba también hacia adelante y se
            # queda con el más cercano de los dos.
            hacia_atras = pd.merge_asof(grupo_ventas, grupo_comp, on="fecha", direction="backward")
            hacia_adelante = pd.merge_asof(grupo_ventas, grupo_comp, on="fecha", direction="forward")
            grupo_ventas = hacia_atras.copy()
            usar_adelante = hacia_atras["precio_competencia"].isna() & hacia_adelante["precio_competencia"].notna()
            grupo_ventas.loc[usar_adelante, "precio_competencia"] = hacia_adelante.loc[
                usar_adelante, "precio_competencia"
            ]
            grupo_ventas["tiene_competencia"] = grupo_ventas["precio_competencia"].notna().astype(int)
            grupo_ventas["precio_competencia"] = grupo_ventas["precio_competencia"].fillna(
                grupo_ventas["costo_reposicion_vigente"]
            )
        partes.append(grupo_ventas)

    return pd.concat(partes, ignore_index=True)


def entrenar(ch_client) -> dict:
    dataset = _extraer_dataset(ch_client)
    if dataset.empty:
        return {"tamano_muestra": 0, "periodo_inicio": None, "periodo_fin": None, "valor_metrica": None}

    periodo_inicio = dataset["fecha"].min().date()
    periodo_fin = dataset["fecha"].max().date()

    if len(dataset) < 10:
        return {
            "tamano_muestra": len(dataset),
            "periodo_inicio": periodo_inicio,
            "periodo_fin": periodo_fin,
            "valor_metrica": None,
        }

    X, y = dataset[_FEATURES], dataset["precio_unitario"]
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    modelo = RandomForestRegressor(n_estimators=200, max_depth=6, random_state=42)
    modelo.fit(X_train, y_train)
    mae = mean_absolute_error(y_test, modelo.predict(X_test))

    return {
        "tamano_muestra": len(dataset),
        "periodo_inicio": periodo_inicio,
        "periodo_fin": periodo_fin,
        "valor_metrica": float(mae),
    }
