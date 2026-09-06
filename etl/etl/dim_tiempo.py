"""
dim_tiempo y dim_hora — las dos dimensiones que NO vienen de PostgreSQL,
se generan por script (el-kiosquito-clickhouse-fact-dim.md §2).

`dim_tiempo` es MergeTree normal (no Replacing): la idempotencia no la da
el motor, la da el propio script comprobando la fecha máxima ya cargada
antes de insertar — nunca reinserta un rango ya generado. `es_feriado`/
`nombre_feriado` sí se actualizan en cada corrida (incluida la
incremental) vía `ALTER TABLE ... UPDATE`, cruzando por fecha contra
`evento_local` donde `tipo = 'feriado'` — ese código es, literalmente,
"lo que el catálogo `tipo_evento_local` ya dice que cuenta como
feriado" (no hay un booleano aparte que inventar).
"""

import calendar
from datetime import date, timedelta

MESES_ES = [
    "", "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]
DIAS_ES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]

FRANJAS_HORA = {
    range(0, 6): "madrugada",
    range(6, 12): "mañana",
    range(12, 14): "mediodia",
    range(14, 19): "tarde",
    range(19, 24): "noche",
}


def _franja(hora: int) -> str:
    for rango, nombre in FRANJAS_HORA.items():
        if hora in rango:
            return nombre
    raise ValueError(f"hora fuera de rango: {hora}")


def _filas_calendario(desde: date, hasta: date) -> list[dict]:
    filas = []
    dia = desde
    while dia <= hasta:
        iso_anio, iso_semana, iso_dia = dia.isocalendar()
        # es_quincena: día de pago típico en Ecuador — 15 y último día del
        # mes. No es decorativo (ver docstring del módulo en el DDL): en
        # un kiosko de barrio mueve la demanda tanto como una promoción.
        ultimo_dia_mes = calendar.monthrange(dia.year, dia.month)[1]
        es_quincena = dia.day == 15 or dia.day == ultimo_dia_mes
        filas.append(
            {
                "fecha": dia,
                "anio": dia.year,
                "trimestre": (dia.month - 1) // 3 + 1,
                "mes": dia.month,
                "nombre_mes": MESES_ES[dia.month],
                "semana_iso": iso_semana,
                "dia": dia.day,
                "dia_semana": dia.isoweekday(),
                "nombre_dia": DIAS_ES[dia.isoweekday() - 1],
                "es_fin_de_semana": 1 if dia.isoweekday() >= 6 else 0,
                "es_quincena": 1 if es_quincena else 0,
                "es_feriado": 0,
                "nombre_feriado": "",
            }
        )
        dia += timedelta(days=1)
    return filas


def generar_dim_tiempo(ch_client, hasta: date) -> int:
    """Extiende `dim_tiempo` hasta la fecha `hasta` inclusive. Idempotente:
    solo genera lo que falta a partir de la fecha máxima ya cargada — una
    segunda corrida con el mismo `hasta` no inserta nada."""
    fila_max = ch_client.query("SELECT max(fecha) FROM dim_tiempo").result_rows
    fecha_max = fila_max[0][0] if fila_max and fila_max[0][0] else None

    desde = date(2025, 1, 1) if fecha_max is None else fecha_max + timedelta(days=1)
    if desde > hasta:
        return 0  # ya está generada hasta esa fecha — nada que hacer

    filas = _filas_calendario(desde, hasta)
    columnas = list(filas[0].keys())
    datos = [[f[c] for c in columnas] for f in filas]
    ch_client.insert("dim_tiempo", datos, column_names=columnas)
    return len(filas)


def actualizar_feriados(ch_client, pg_conn, desde: date, hasta: date) -> int:
    """RF: `es_feriado`/`nombre_feriado` se leen de `evento_local` (004)
    en cada corrida, incremental incluida — nunca se escriben a mano.
    `tipo = 'feriado'` es el código del catálogo `tipo_evento_local` que
    cuenta como feriado nacional (los demás tipos — fiesta patronal,
    evento comunitario, etc. — no lo son)."""
    with pg_conn.cursor() as cur:
        cur.execute(
            """
            SELECT fecha_inicio, fecha_fin, descripcion
            FROM evento_local
            WHERE tipo = 'feriado' AND fecha_fin >= %s AND fecha_inicio <= %s
            """,
            (desde, hasta),
        )
        eventos = cur.fetchall()

    actualizadas = 0
    for fecha_inicio, fecha_fin, descripcion in eventos:
        ch_client.mutacion_sincrona(
            "ALTER TABLE dim_tiempo UPDATE es_feriado = 1, nombre_feriado = %(desc)s "
            "WHERE fecha >= %(ini)s AND fecha <= %(fin)s",
            tabla="dim_tiempo",
            parameters={"desc": descripcion, "ini": fecha_inicio, "fin": fecha_fin},
        )
        actualizadas += (fecha_fin - fecha_inicio).days + 1
    return actualizadas


def generar_dim_hora(ch_client) -> int:
    """24 filas, una sola vez — `es_hora_pico` arranca en 0 en todas: RN de
    el-kiosquito-clickhouse-fact-dim.md §6, marcarlo por intuición sería
    inventar un dato (Art. 5.6). Se recalibra después con
    `recalibrar_hora_pico` sobre ventas reales del primer mes."""
    existentes = ch_client.query("SELECT count() FROM dim_hora").result_rows[0][0]
    if existentes > 0:
        return 0

    filas = [{"hora": h, "franja": _franja(h), "es_hora_pico": 0} for h in range(24)]
    columnas = list(filas[0].keys())
    datos = [[f[c] for c in columnas] for f in filas]
    ch_client.insert("dim_hora", datos, column_names=columnas)
    return len(filas)


def recalibrar_hora_pico(ch_client, umbral_percentil: float = 0.75) -> list[int]:
    """Calibra `es_hora_pico` con ventas reales ya cargadas en
    `fact_venta_linea` — nunca por intuición. Una hora es "pico" si su
    volumen de ventas está en el percentil `umbral_percentil` o por
    encima. Devuelve las horas marcadas como pico."""
    filas = ch_client.query(
        "SELECT hora, count() AS n FROM fact_venta_linea GROUP BY hora ORDER BY hora"
    ).result_rows
    if not filas:
        return []

    conteos = sorted(n for _, n in filas)
    idx = int(len(conteos) * umbral_percentil)
    idx = min(idx, len(conteos) - 1)
    umbral = conteos[idx]

    horas_pico = [hora for hora, n in filas if n >= umbral and umbral > 0]
    ch_client.mutacion_sincrona("ALTER TABLE dim_hora UPDATE es_hora_pico = 0 WHERE 1 = 1", tabla="dim_hora")
    if horas_pico:
        ch_client.mutacion_sincrona(
            "ALTER TABLE dim_hora UPDATE es_hora_pico = 1 WHERE hora IN %(horas)s",
            tabla="dim_hora",
            parameters={"horas": tuple(horas_pico)},
        )
    return horas_pico
