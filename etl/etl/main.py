"""
Orquestación del ciclo completo del pipeline — lo que cada tarea del
DAG de Airflow llama (ver dags/etl_el_kiosquito.py). Se puede correr
también standalone (`python -m etl.main --desde ... --hasta ...`) para
probar el ETL sin Airflow, que es como se probó end-to-end antes de
escribir el DAG.
"""

import argparse
import logging
from datetime import date, datetime

from etl.db import clickhouse_client, postgres_conn
from etl.dim_tiempo import actualizar_feriados, generar_dim_hora, generar_dim_tiempo
from etl.dimensiones import cargar_todas_las_dimensiones
from etl.hechos import cargar_todos_los_hechos
from etl.pipeline_api import ClientePipelineApi
from etl.validaciones import ejecutar_validaciones

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("etl")


def correr_ciclo(desde: date, hasta: date, dag_run_id: str, registrar_en_api: bool = True) -> dict:
    api = ClientePipelineApi() if registrar_en_api else None
    ejecucion = None

    if api:
        ejecucion = api.registrar_ejecucion(dag_run_id, "en_progreso")
        log.info("Ejecución registrada: id=%s dag_run_id=%s", ejecucion["id"], dag_run_id)

    try:
        with postgres_conn() as pg_conn:
            ch_client = clickhouse_client()

            # Regla 2: dim_tiempo/dim_hora se generan una sola vez; regla 4:
            # es_feriado se actualiza en CADA corrida, incremental incluida.
            generar_dim_hora(ch_client)
            filas_tiempo = generar_dim_tiempo(ch_client, hasta=date(hasta.year + 1, 12, 31))
            feriados_actualizados = actualizar_feriados(ch_client, pg_conn, desde, hasta)
            log.info("dim_tiempo: +%d filas nuevas, %d días marcados feriado", filas_tiempo, feriados_actualizados)

            # Regla 3: TODAS las dimensiones antes que cualquier hecho.
            resultado_dims = cargar_todas_las_dimensiones(pg_conn, ch_client)
            log.info("Dimensiones cargadas: %s", resultado_dims)

            resultado_hechos = cargar_todos_los_hechos(pg_conn, ch_client, desde, hasta)
            log.info("Hechos cargados: %s", resultado_hechos)

            # Regla 5: cada corrida registra sus validaciones.
            validaciones = ejecutar_validaciones(pg_conn, ch_client, desde, hasta)
            todas_aprobadas = all(v[1] for v in validaciones)
            for regla, aprobado, detalle in validaciones:
                log.info("Validación %s: aprobado=%s (%s)", regla, aprobado, detalle)
                if api and ejecucion:
                    api.registrar_validacion(ejecucion["id"], regla, aprobado, detalle)

            sucursales_procesadas = resultado_dims.get("dim_sucursal", 0)
            filas_cargadas = sum(resultado_hechos.values()) + sum(resultado_dims.values())

            if api:
                api.registrar_ejecucion(
                    dag_run_id,
                    "exitoso" if todas_aprobadas else "error",
                    sucursales_procesadas=sucursales_procesadas,
                    filas_cargadas=filas_cargadas,
                    mensaje_error=None if todas_aprobadas else "una o más validaciones de calidad fallaron",
                )

            return {
                "dimensiones": resultado_dims,
                "hechos": resultado_hechos,
                "validaciones": validaciones,
                "todas_aprobadas": todas_aprobadas,
            }
    except Exception as exc:  # noqa: BLE001 — se registra el error real en la API y se re-lanza
        log.exception("Fallo el ciclo del ETL")
        if api:
            api.registrar_ejecucion(dag_run_id, "error", mensaje_error=str(exc)[:2000])
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--desde", required=True, help="YYYY-MM-DD")
    parser.add_argument("--hasta", required=True, help="YYYY-MM-DD")
    parser.add_argument("--dag-run-id", default=None)
    parser.add_argument("--sin-api", action="store_true", help="no registrar en la API 011 (solo para pruebas locales)")
    args = parser.parse_args()

    desde = datetime.strptime(args.desde, "%Y-%m-%d").date()
    hasta = datetime.strptime(args.hasta, "%Y-%m-%d").date()
    dag_run_id = args.dag_run_id or f"manual__{datetime.utcnow().isoformat()}"

    resultado = correr_ciclo(desde, hasta, dag_run_id, registrar_en_api=not args.sin_api)
    log.info("Ciclo terminado: %s", resultado)
