"""
DAG de Airflow que orquesta el pipeline ETL El Kiosquito (PostgreSQL ->
ClickHouse, el-kiosquito-clickhouse-fact-dim.md). Cada tarea diaria llama
`etl.main.correr_ciclo`, la misma función ya probada standalone
(`python -m etl.main --desde ... --hasta ...`) contra Postgres y
ClickHouse reales — el DAG no reimplementa ninguna lógica de carga, solo
orquesta cuándo correrla y qué le pasa como parámetros.

Requiere que el paquete `etl/` (hermano de esta carpeta `dags/`) esté
importable desde el contenedor del scheduler/worker de Airflow — en
`docker-compose.yml` esto se resuelve montando la raíz del proyecto y
agregándola a `PYTHONPATH` (ver ese archivo). La configuración de
conexión (DSN de Postgres, host/puerto de ClickHouse, credenciales de la
cuenta de servicio contra la API 011) se toma de las mismas variables de
entorno que usa `etl/config.py` — no se usan Connections de Airflow para
esto, para no duplicar la configuración en dos sistemas distintos.

Tres DAGs, no uno:
1. `etl_el_kiosquito_diario` — corre cada noche, carga el día que acaba
   de cerrar (dimensiones + hechos + validaciones de calidad).
2. `etl_el_kiosquito_recalibracion_hora_pico` — corre una vez al mes.
   `recalibrar_hora_pico` (dim_tiempo.py) NO se llama desde el DAG diario
   a propósito: es una calibración estadística sobre el HISTÓRICO de
   ventas ya cargado (percentil de volumen por hora), pensada para
   estabilizarse con el tiempo — recalcularla cada noche haría que
   `dim_hora.es_hora_pico` cambiara todos los días sin que el patrón de
   negocio realmente haya cambiado tanto, lo cual es ruido para
   cualquier reporte/dashboard que dependa de esa columna.
3. `etl_el_kiosquito_modelos_ml` — corre una vez al mes, reentrena y
   registra los 5 modelos scikit-learn del Art. 5.6 (capa estratégica,
   paquete `ml/`) contra el estado ACTUAL de los datos. Mensual por la
   misma razón que la recalibración de hora pico: reentrenar cada noche
   sobre un volumen de datos que todavía no cambió de un día para otro
   no aporta nada y solo genera versiones ruidosas en
   `version_modelo_ml`. No necesita `ds`/fecha lógica como el DAG diario
   porque ningún modelo procesa "el día que acaba de cerrar" — cada uno
   entrena contra todo su histórico disponible en ese momento (ver
   docstring de cada módulo en `ml/`).
"""

from datetime import date, datetime, timedelta

from airflow.decorators import dag, task

from etl.db import clickhouse_client
from etl.dim_tiempo import recalibrar_hora_pico
from etl.main import correr_ciclo
from ml.main import entrenar_y_registrar_todos

DEFAULT_ARGS = {
    "owner": "el-kiosquito",
    "retries": 2,
    "retry_delay": timedelta(minutes=5),
}


@dag(
    dag_id="etl_el_kiosquito_diario",
    description="Carga incremental diaria PostgreSQL -> ClickHouse (dimensiones, hechos, validaciones de calidad)",
    schedule="0 5 * * *",  # 05:00 UTC = 00:00 en Ecuador (UTC-5) — ya cerró la caja del día anterior
    start_date=datetime(2026, 1, 1),
    catchup=False,  # ver docstring del módulo: backfills históricos se corren manualmente con --desde/--hasta
    default_args=DEFAULT_ARGS,
    tags=["el-kiosquito", "etl", "tactico"],
)
def etl_el_kiosquito_diario():
    @task
    def ejecutar_pipeline(ds: str | None = None, dag_run=None) -> dict:
        """`ds` es la fecha lógica de la corrida (el día de negocio que se
        está cargando, no el día en que Airflow ejecuta la tarea) — se usa
        como `desde` y `hasta` porque cada corrida diaria carga un solo
        día. `dag_run.run_id` es el `dag_run_id` que la API 011 usa para
        el upsert de `ejecucion_pipeline_etl` (idempotencia de registro:
        un reintento de la misma corrida actualiza la misma fila, no crea
        otra)."""
        dia = date.fromisoformat(ds)
        return correr_ciclo(desde=dia, hasta=dia, dag_run_id=dag_run.run_id, registrar_en_api=True)

    ejecutar_pipeline()


@dag(
    dag_id="etl_el_kiosquito_recalibracion_hora_pico",
    description="Recalibra dim_hora.es_hora_pico por percentil de ventas reales acumuladas — mensual, no diario",
    schedule="@monthly",
    start_date=datetime(2026, 1, 1),
    catchup=False,
    default_args=DEFAULT_ARGS,
    tags=["el-kiosquito", "etl", "tactico", "mantenimiento"],
)
def etl_el_kiosquito_recalibracion_hora_pico():
    @task
    def recalibrar() -> list[int]:
        ch_client = clickhouse_client()
        horas_pico = recalibrar_hora_pico(ch_client)
        return horas_pico

    recalibrar()


@dag(
    dag_id="etl_el_kiosquito_modelos_ml",
    description="Reentrena y registra los 5 modelos de ML del Art. 5.6 contra el estado actual de los datos",
    schedule="@monthly",
    start_date=datetime(2026, 1, 1),
    catchup=False,
    default_args=DEFAULT_ARGS,
    tags=["el-kiosquito", "ml", "estrategico"],
)
def etl_el_kiosquito_modelos_ml():
    @task
    def entrenar_modelos() -> dict:
        """Reentrena los 5 modelos (demanda, pricing, churn, anomalias_caja,
        segmentacion_clientes) y registra cada resultado en
        `POST /analitica/modelos/versiones` (011-analitica-reportes). Si
        alguno sigue sin datos suficientes, la API lo marca
        `descartado_datos_insuficientes` (o queda `sin_datos` si la fuente
        está vacía y ni siquiera se llama a la API) — comportamiento
        correcto del Art. 5.9, no un fallo del DAG."""
        return entrenar_y_registrar_todos(registrar_en_api=True)

    entrenar_modelos()


etl_el_kiosquito_diario()
etl_el_kiosquito_recalibracion_hora_pico()
etl_el_kiosquito_modelos_ml()
