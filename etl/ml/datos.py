"""
Helper compartido por los 5 scripts de entrenamiento: convierte el
resultado de `ClienteClickHouse.query` (tuplas planas — clickhouse-
driver no devuelve nombres de columna, ver docstring de `etl/db.py`) a
un DataFrame de pandas, usando el mismo orden del `SELECT`.
"""

import pandas as pd


def a_dataframe(ch_client, sql: str, columnas: list[str], parametros: dict | None = None) -> pd.DataFrame:
    resultado = ch_client.query(sql, parametros)
    return pd.DataFrame(resultado.result_rows, columns=columnas)
