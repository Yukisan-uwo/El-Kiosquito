"""
Validaciones de calidad mínimas de cada corrida (el-kiosquito-
clickhouse-fact-dim.md §5, regla 5): sin producto_id nulo, los totales
de fact_venta_linea cuadran contra PostgreSQL para el rango cargado, y
ninguna fila de hecho referencia una dimensión inexistente. Cada
resultado se registra en `validacion_calidad_datos` vía la API 011
(nunca por SQL directo) — ver `pipeline_api.py`.
"""

from datetime import date


def validar_sin_producto_id_nulo(ch_client) -> tuple[bool, str]:
    tablas_con_producto = [
        "fact_venta_linea", "fact_merma", "fact_compra_recepcion",
        "fact_demanda_insatisfecha", "fact_stock_diario", "fact_precio_competencia",
    ]
    nulos = []
    for tabla in tablas_con_producto:
        n = ch_client.query(f"SELECT count() FROM {tabla} WHERE producto_id = 0").result_rows[0][0]
        if n > 0:
            nulos.append(f"{tabla}: {n}")
    aprobado = not nulos
    detalle = "sin filas con producto_id=0" if aprobado else "producto_id=0 en: " + ", ".join(nulos)
    return aprobado, detalle


def validar_totales_venta_cuadran(pg_conn, ch_client, desde: date, hasta: date) -> tuple[bool, str]:
    with pg_conn.cursor() as cur:
        cur.execute(
            "SELECT count(*) FROM detalle_venta dv JOIN venta v ON v.id = dv.venta_id "
            "WHERE v.fecha_hora::date BETWEEN %s AND %s",
            (desde, hasta),
        )
        total_pg = cur.fetchone()[0]

    total_ch = ch_client.query(
        "SELECT count() FROM fact_venta_linea WHERE fecha BETWEEN %(d)s AND %(h)s",
        parameters={"d": desde, "h": hasta},
    ).result_rows[0][0]

    aprobado = total_pg == total_ch
    detalle = f"PostgreSQL={total_pg} ClickHouse={total_ch}"
    return aprobado, detalle


def validar_dimensiones_referenciadas(ch_client) -> tuple[bool, str]:
    """Ningún `sucursal_id` de `fact_venta_linea` fuera de
    `dim_sucursal`, ningún `producto_id` fuera de `dim_producto`."""
    huerfanos_sucursal = ch_client.query(
        "SELECT count() FROM fact_venta_linea f "
        "LEFT JOIN dim_sucursal d ON d.sucursal_id = f.sucursal_id "
        "WHERE d.sucursal_id = 0"
    ).result_rows[0][0]
    huerfanos_producto = ch_client.query(
        "SELECT count(DISTINCT f.producto_id) FROM fact_venta_linea f "
        "LEFT JOIN (SELECT DISTINCT producto_id FROM dim_producto) d ON d.producto_id = f.producto_id "
        "WHERE d.producto_id = 0"
    ).result_rows[0][0]
    aprobado = huerfanos_sucursal == 0 and huerfanos_producto == 0
    detalle = f"sucursales huérfanas={huerfanos_sucursal}, productos huérfanos={huerfanos_producto}"
    return aprobado, detalle


def ejecutar_validaciones(pg_conn, ch_client, desde: date, hasta: date) -> list[tuple[str, bool, str]]:
    return [
        ("sin_producto_id_nulo", *validar_sin_producto_id_nulo(ch_client)),
        ("totales_venta_cuadran_vs_postgres", *validar_totales_venta_cuadran(pg_conn, ch_client, desde, hasta)),
        ("dimensiones_referenciadas", *validar_dimensiones_referenciadas(ch_client)),
    ]
