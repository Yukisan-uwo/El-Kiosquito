"""
Reportes compuestos del Dashboard Dueño (OT1.1, OT1.2, OT1.4) — margen por
sucursal, merma por sucursal, ticket promedio por sucursal. Antes de este
módulo, la única puerta de entrada a estos datos era el asistente
conversacional (`services/asistente_tools.py`), exclusivo del rol dueño y
pensado para que un LLM elija tools — no para que el frontend pinte 3
cards de KPI en cada carga de pantalla. `el-kiosquito-clickhouse-fact-dim.md`
documenta estos informes como "servidos desde ClickHouse" pero nunca
existió el endpoint REST real que los sirviera — encontrado al construir
el Dashboard Dueño del frontend, antes de escribir el componente, no
después (mismo patrón que la enmienda LOPDP de 002).

Deliberadamente NO se reutilizan las funciones privadas de
`asistente_tools.py` aunque el SQL de margen/merma sea equivalente: ese
módulo es el catálogo de tools del LLM (import de sus internos acoplaría
el dashboard a la existencia del asistente conversacional, algo que debe
poder evolucionar — o incluso desactivarse — sin romper el dashboard).
Se acepta la duplicación puntual de dos consultas a cambio de esa
independencia.

Todas las consultas van contra ClienteClickHouseSoloLectura (nunca
escriben) y usan bind params, nunca interpolación de fechas en el string.
"""

from datetime import date, datetime

from app.core.clickhouse import ClienteClickHouseSoloLectura


def _parse_fecha(valor: str) -> date:
    return datetime.strptime(valor, "%Y-%m-%d").date()


def margen_por_sucursal(ch: ClienteClickHouseSoloLectura, desde: str, hasta: str) -> list[dict]:
    resultado = ch.query(
        """
        SELECT v.sucursal_id, s.nombre,
               sum(v.margen_linea) AS margen_total,
               sum(v.subtotal_linea) AS ingresos_total,
               count() AS lineas_de_venta
        FROM fact_venta_linea v
        INNER JOIN dim_sucursal AS s FINAL ON s.sucursal_id = v.sucursal_id
        WHERE v.cuenta_para_ingresos = 1 AND v.fecha >= %(desde)s AND v.fecha <= %(hasta)s
        GROUP BY v.sucursal_id, s.nombre
        ORDER BY margen_total DESC
        """,
        {"desde": _parse_fecha(desde), "hasta": _parse_fecha(hasta)},
    )
    columnas = ["sucursal_id", "sucursal_nombre", "margen_total", "ingresos_total", "lineas_de_venta"]
    return [dict(zip(columnas, fila)) for fila in resultado.result_rows]


def merma_por_sucursal(ch: ClienteClickHouseSoloLectura, desde: str, hasta: str) -> list[dict]:
    resultado = ch.query(
        """
        SELECT m.sucursal_id, s.nombre,
               sum(m.valor_perdido) AS valor_perdido_total,
               sum(m.cantidad) AS cantidad_total,
               count() AS eventos
        FROM fact_merma m
        INNER JOIN dim_sucursal AS s FINAL ON s.sucursal_id = m.sucursal_id
        WHERE m.fecha >= %(desde)s AND m.fecha <= %(hasta)s
        GROUP BY m.sucursal_id, s.nombre
        ORDER BY valor_perdido_total DESC
        """,
        {"desde": _parse_fecha(desde), "hasta": _parse_fecha(hasta)},
    )
    columnas = ["sucursal_id", "sucursal_nombre", "valor_perdido_total", "cantidad_total", "eventos"]
    return [dict(zip(columnas, fila)) for fila in resultado.result_rows]


def ticket_promedio_por_sucursal(ch: ClienteClickHouseSoloLectura, desde: str, hasta: str) -> list[dict]:
    """OT1.4: ticket promedio = gasto total / N° transacciones. `venta_id`
    identifica la transacción — se cuenta DISTINCT porque `fact_venta_linea`
    es por línea, no por venta (una venta con 5 productos son 5 filas)."""
    resultado = ch.query(
        """
        SELECT v.sucursal_id, s.nombre,
               sum(v.subtotal_linea) / count(DISTINCT v.venta_id) AS ticket_promedio,
               count(DISTINCT v.venta_id) AS numero_ventas
        FROM fact_venta_linea v
        INNER JOIN dim_sucursal AS s FINAL ON s.sucursal_id = v.sucursal_id
        WHERE v.cuenta_para_ingresos = 1 AND v.fecha >= %(desde)s AND v.fecha <= %(hasta)s
        GROUP BY v.sucursal_id, s.nombre
        ORDER BY ticket_promedio DESC
        """,
        {"desde": _parse_fecha(desde), "hasta": _parse_fecha(hasta)},
    )
    columnas = ["sucursal_id", "sucursal_nombre", "ticket_promedio", "numero_ventas"]
    return [dict(zip(columnas, fila)) for fila in resultado.result_rows]
