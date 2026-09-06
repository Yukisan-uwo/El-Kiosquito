"""
Orquestación de los 5 modelos de ML (Art. 5.6) — lo que la tarea
`entrenar_modelos` del DAG mensual llama (ver
`dags/etl_el_kiosquito.py`). Se puede correr también standalone
(`python -m ml.main --modelo <codigo>|--todos`) para entrenar y
registrar sin Airflow, igual que `etl/main.py` para el pipeline ETL.

Reentrena SIEMPRE los 5 contra el estado actual de los datos: si un
modelo sigue sin datos suficientes, se registra otra vez como
`descartado_datos_insuficientes` (o `sin_datos` si la fuente está
vacía) — no es un error, es el comportamiento correcto del Art. 5.9
mientras el negocio no acumule el volumen mínimo.
"""

import argparse
import logging

from etl.db import clickhouse_client, postgres_conn
from etl.pipeline_api import ClientePipelineApi
from ml import anomalias_caja, churn, demanda, pricing, registro, segmentacion_clientes

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("ml")

# Los 3 que entrenan contra ClickHouse (fuente: elkiosquito_dw).
_MODELOS_CLICKHOUSE = {
    demanda.MODELO: (demanda.entrenar, demanda.METRICA),
    pricing.MODELO: (pricing.entrenar, pricing.METRICA),
    anomalias_caja.MODELO: (anomalias_caja.entrenar, anomalias_caja.METRICA),
    segmentacion_clientes.MODELO: (segmentacion_clientes.entrenar, segmentacion_clientes.METRICA),
}
# churn es el único que entrena contra PostgreSQL directo (ver docstring
# de ml/churn.py: su etiqueta real, evaluacion_churn.es_riesgo_real, no
# pasa por ClickHouse).
_MODELOS_POSTGRES = {
    churn.MODELO: (churn.entrenar, churn.METRICA),
}

MODELOS_DISPONIBLES = sorted(set(_MODELOS_CLICKHOUSE) | set(_MODELOS_POSTGRES))


def entrenar_y_registrar_todos(registrar_en_api: bool = True) -> dict[str, dict]:
    api = ClientePipelineApi() if registrar_en_api else None
    resultados: dict[str, dict] = {}

    with postgres_conn() as pg_conn:
        ch_client = clickhouse_client()

        for modelo_codigo, (entrenar_fn, metrica) in _MODELOS_CLICKHOUSE.items():
            resultado = entrenar_fn(ch_client)
            log.info("%s: tamano_muestra=%s valor_metrica=%s", modelo_codigo, resultado["tamano_muestra"], resultado["valor_metrica"])
            resultados[modelo_codigo] = resultado
            if api:
                registro_resultado = registro.registrar(api, modelo_codigo, metrica, resultado)
                log.info("%s registrado: %s", modelo_codigo, registro_resultado.get("estado", registro_resultado))

        for modelo_codigo, (entrenar_fn, metrica) in _MODELOS_POSTGRES.items():
            resultado = entrenar_fn(pg_conn)
            log.info("%s: tamano_muestra=%s valor_metrica=%s", modelo_codigo, resultado["tamano_muestra"], resultado["valor_metrica"])
            resultados[modelo_codigo] = resultado
            if api:
                registro_resultado = registro.registrar(api, modelo_codigo, metrica, resultado)
                log.info("%s registrado: %s", modelo_codigo, registro_resultado.get("estado", registro_resultado))

    return resultados


def entrenar_y_registrar_uno(modelo_codigo: str, registrar_en_api: bool = True) -> dict:
    api = ClientePipelineApi() if registrar_en_api else None

    with postgres_conn() as pg_conn:
        ch_client = clickhouse_client()
        if modelo_codigo in _MODELOS_CLICKHOUSE:
            entrenar_fn, metrica = _MODELOS_CLICKHOUSE[modelo_codigo]
            resultado = entrenar_fn(ch_client)
        elif modelo_codigo in _MODELOS_POSTGRES:
            entrenar_fn, metrica = _MODELOS_POSTGRES[modelo_codigo]
            resultado = entrenar_fn(pg_conn)
        else:
            raise ValueError(f"modelo desconocido: '{modelo_codigo}' (disponibles: {MODELOS_DISPONIBLES})")

        log.info("%s: tamano_muestra=%s valor_metrica=%s", modelo_codigo, resultado["tamano_muestra"], resultado["valor_metrica"])
        if api:
            registro_resultado = registro.registrar(api, modelo_codigo, metrica, resultado)
            log.info("%s registrado: %s", modelo_codigo, registro_resultado.get("estado", registro_resultado))
        return resultado


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    grupo = parser.add_mutually_exclusive_group(required=True)
    grupo.add_argument("--modelo", choices=MODELOS_DISPONIBLES, help="entrenar y registrar un solo modelo")
    grupo.add_argument("--todos", action="store_true", help="entrenar y registrar los 5 modelos")
    parser.add_argument("--sin-api", action="store_true", help="no registrar en la API 011 (solo para pruebas locales)")
    args = parser.parse_args()

    if args.todos:
        entrenar_y_registrar_todos(registrar_en_api=not args.sin_api)
    else:
        entrenar_y_registrar_uno(args.modelo, registrar_en_api=not args.sin_api)
