"""
Carga de las 9 tablas de hechos. Todas particionadas por mes
(`toYYYYMM`, salvo `fact_stock_diario` que se particiona por día de
carga aunque física-mente use el mismo `PARTITION BY toYYYYMM`) — la
idempotencia la da la regla 6 de el-kiosquito-clickhouse-fact-dim.md
§5: reprocesar un rango se hace borrando las particiones de mes
afectadas y recargando, nunca con INSERT acumulativo.

`fact_stock_diario` es la única excepción real de fondo: es un
snapshot del **estado actual** de `stock_sucursal`/`lote_producto` en
PostgreSQL (esas tablas no llevan historial), así que solo puede
cargarse para "hoy" en el momento en que corre — no se puede
reconstruir un día pasado que no se snapshotéo entonces. Reprocesar
"hoy" sigue siendo idempotente (se borra y recarga el día).
"""

from datetime import date, datetime, timedelta

# RN de esta implementación (no está en un catálogo — ver README para
# la nota sobre por qué no se modela así todavía): margen de tolerancia
# para considerar un precio propio "en rango competitivo" frente al de
# la fuente observada. Vive acá como constante explícita, documentada,
# en vez de escondida sin comentario — candidato natural a moverse a
# `parametro_sistema` (010) el día que un ticket lo pida.
RANGO_COMPETITIVO_PCT = 5.0


def _meses_en_rango(desde: date, hasta: date) -> list[str]:
    particiones = []
    cursor = date(desde.year, desde.month, 1)
    fin = date(hasta.year, hasta.month, 1)
    while cursor <= fin:
        particiones.append(f"{cursor.year:04d}{cursor.month:02d}")
        cursor = date(cursor.year + (cursor.month // 12), (cursor.month % 12) + 1, 1)
    return particiones


def _particiones_existentes(ch_client, tabla: str) -> set[str]:
    filas = ch_client.query(
        "SELECT DISTINCT partition FROM system.parts WHERE table = %(t)s AND active",
        parameters={"t": tabla},
    ).result_rows
    return {r[0] for r in filas}


def _borrar_particiones(ch_client, tabla: str, desde: date, hasta: date) -> None:
    """Todas las tablas de hecho particionan `PARTITION BY toYYYYMM(fecha)`,
    una expresión numérica (UInt32) — DROP PARTITION exige el literal SIN
    comillas para ese caso (comillas son solo para claves de partición de
    tipo String). Pasar '202608' entre comillas revienta con "Type
    mismatch ... Expected: UInt32. Got: String" en ClickHouse 18.16.1."""
    existentes = _particiones_existentes(ch_client, tabla)
    for particion in _meses_en_rango(desde, hasta):
        if particion in existentes:
            ch_client.command(f"ALTER TABLE {tabla} DROP PARTITION {int(particion)}")


def _cargar(ch_client, tabla: str, columnas: list[str], filas: list[tuple], desde: date, hasta: date) -> int:
    """Idempotente por rango de fechas: borra las particiones de mes
    afectadas ANTES de insertar, para que reprocesar el mismo rango dos
    veces nunca duplique filas."""
    _borrar_particiones(ch_client, tabla, desde, hasta)
    if filas:
        ch_client.insert(tabla, filas, column_names=columnas)
    return len(filas)


def cargar_fact_venta_linea(pg_conn, ch_client, desde: date, hasta: date) -> int:
    """`costo_reposicion_vigente` se resuelve y CONGELA con el costo
    vigente en `historial_costo_producto` (008) a la fecha de la venta
    — decisión de diseño más importante del modelo (ver DDL): si se
    recalculara después contra el costo actual, cada subida de un
    proveedor distorsionaría el margen histórico hacia atrás."""
    with pg_conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                v.fecha_hora::date, EXTRACT(HOUR FROM v.fecha_hora)::int,
                v.id, v.numero_documento, v.sucursal_id, dv.producto_id,
                v.cliente_id, v.cajero_id, v.metodo_pago, v.estado_venta,
                ev.cuenta_para_ingresos,
                dv.cantidad_venta, dv.cantidad_inventario,
                dv.precio_unitario_aplicado, dv.subtotal_item,
                costo.costo,
                round(dv.subtotal_item - COALESCE(costo.costo, 0) * dv.cantidad_inventario, 2),
                CASE WHEN v.hora_inicio_cobro IS NOT NULL
                     THEN EXTRACT(EPOCH FROM (v.fecha_hora - v.hora_inicio_cobro))::int
                     ELSE NULL END
            FROM venta v
            JOIN detalle_venta dv ON dv.venta_id = v.id
            JOIN estado_venta ev ON ev.codigo = v.estado_venta
            LEFT JOIN LATERAL (
                SELECT h.costo
                FROM historial_costo_producto h
                WHERE h.producto_id = dv.producto_id AND h.fecha <= v.fecha_hora
                ORDER BY h.fecha DESC
                LIMIT 1
            ) costo ON true
            WHERE v.fecha_hora::date BETWEEN %s AND %s
            """,
            (desde, hasta),
        )
        filas = cur.fetchall()
    columnas = [
        "fecha", "hora", "venta_id", "numero_documento", "sucursal_id", "producto_id",
        "cliente_id", "cajero_id", "metodo_pago", "estado_venta", "cuenta_para_ingresos",
        "cantidad_venta", "cantidad_inventario", "precio_unitario", "subtotal_linea",
        "costo_reposicion_vigente", "margen_linea", "duracion_cobro_seg",
    ]
    datos = [tuple(cuenta_para_ingresos_bool(v) for v in fila) for fila in filas]
    return _cargar(ch_client, "fact_venta_linea", columnas, datos, desde, hasta)


def cuenta_para_ingresos_bool(v):
    """psycopg ya trae bool nativo para columnas boolean; ClickHouse
    quiere UInt8 — normaliza sin tocar el resto de los tipos."""
    return int(v) if isinstance(v, bool) else v


def cargar_fact_merma(pg_conn, ch_client, desde: date, hasta: date) -> int:
    with pg_conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                m.fecha_deteccion::date, m.id, m.sucursal_id, m.producto_id,
                m.causa, cm.es_atribuible_a_persona, m.resultado_investigacion,
                m.registrado_por, m.cantidad, m.valor_estimado
            FROM merma m
            JOIN causa_merma cm ON cm.codigo = m.causa
            WHERE m.fecha_deteccion::date BETWEEN %s AND %s
            """,
            (desde, hasta),
        )
        filas = [tuple(cuenta_para_ingresos_bool(v) for v in f) for f in cur.fetchall()]
    columnas = [
        "fecha", "merma_id", "sucursal_id", "producto_id", "causa",
        "es_atribuible_a_persona", "resultado_investigacion", "registrado_por",
        "cantidad", "valor_perdido",
    ]
    return _cargar(ch_client, "fact_merma", columnas, filas, desde, hasta)


def cargar_fact_cuadre_caja(pg_conn, ch_client, desde: date, hasta: date) -> int:
    """Un turno aporta dos tipos de fila: sus checkpoints horarios
    (`es_checkpoint=1`, sin monto contado — todavía no se ha cerrado) y
    su cierre (`es_checkpoint=0`, con `monto_contado`/`diferencia`)."""
    with pg_conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                p.hora_checkpoint::date, EXTRACT(HOUR FROM p.hora_checkpoint)::int,
                p.turno_caja_id, t.sucursal_id, t.cajero_id,
                1, p.monto_esperado_acumulado, NULL, NULL
            FROM punto_control_horario_turno p
            JOIN turno_caja t ON t.id = p.turno_caja_id
            WHERE p.hora_checkpoint::date BETWEEN %s AND %s

            UNION ALL

            SELECT
                t.hora_cierre::date, EXTRACT(HOUR FROM t.hora_cierre)::int,
                t.id, t.sucursal_id, t.cajero_id,
                0, t.monto_esperado, t.monto_contado, t.diferencia
            FROM turno_caja t
            WHERE t.hora_cierre IS NOT NULL AND t.hora_cierre::date BETWEEN %s AND %s
            """,
            (desde, hasta, desde, hasta),
        )
        filas = [tuple(cuenta_para_ingresos_bool(v) for v in f) for f in cur.fetchall()]
    columnas = [
        "fecha", "hora", "turno_caja_id", "sucursal_id", "cajero_id",
        "es_checkpoint", "monto_esperado", "monto_contado", "diferencia",
    ]
    return _cargar(ch_client, "fact_cuadre_caja", columnas, filas, desde, hasta)


def cargar_fact_compra_recepcion(pg_conn, ch_client, desde: date, hasta: date) -> int:
    """`siguio_pronostico`: 1 si no había recomendación que comparar
    (`cantidad_recomendada_pronostico IS NULL` — no aplica la regla) o
    si `cantidad_pedida` no la excedió; 0 si la excedió (RN-CP-001,
    008) — sin importar si ya se justificó con `motivo_no_siguio_
    pronostico`: ese motivo es la EXCEPCIÓN documentada, no cambia el
    hecho de que se salió del pronóstico."""
    with pg_conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                r.fecha_recepcion::date, r.id, oc.id, oc.sucursal_id, oc.proveedor_id,
                d.producto_id, oc.forma_pago, fp.dias_plazo_default, oc.es_oferta,
                CASE
                    WHEN d.cantidad_recomendada_pronostico IS NULL THEN 1
                    WHEN d.cantidad_pedida <= d.cantidad_recomendada_pronostico THEN 1
                    ELSE 0
                END,
                r.cantidad_recibida_evento,
                costo.costo,
                (r.fecha_recepcion::date - oc.fecha_pedido::date)
            FROM recepcion_orden_compra r
            JOIN detalle_orden_compra d ON d.id = r.detalle_orden_compra_id
            JOIN orden_compra oc ON oc.id = d.orden_compra_id
            JOIN forma_pago fp ON fp.codigo = oc.forma_pago
            LEFT JOIN LATERAL (
                SELECT h.costo
                FROM historial_costo_producto h
                WHERE h.orden_compra_id = oc.id AND h.producto_id = d.producto_id
                ORDER BY abs(EXTRACT(EPOCH FROM (h.fecha - r.fecha_recepcion)))
                LIMIT 1
            ) costo ON true
            WHERE r.fecha_recepcion::date BETWEEN %s AND %s
            """,
            (desde, hasta),
        )
        filas = [tuple(cuenta_para_ingresos_bool(v) for v in f) for f in cur.fetchall()]
    columnas = [
        "fecha", "recepcion_id", "orden_compra_id", "sucursal_id", "proveedor_id",
        "producto_id", "forma_pago", "dias_plazo", "es_oferta", "siguio_pronostico",
        "cantidad_recibida", "costo_unitario", "dias_pedido_a_recepcion",
    ]
    return _cargar(ch_client, "fact_compra_recepcion", columnas, filas, desde, hasta)


def cargar_fact_demanda_insatisfecha(pg_conn, ch_client, desde: date, hasta: date) -> int:
    with pg_conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                d.hora_evento::date, EXTRACT(HOUR FROM d.hora_evento)::int, d.id,
                d.sucursal_id, d.producto_id,
                (d.sustituto_ofrecido_id IS NOT NULL),
                COALESCE(d.sustituto_aceptado, false)
            FROM demanda_insatisfecha d
            WHERE d.hora_evento::date BETWEEN %s AND %s
            """,
            (desde, hasta),
        )
        filas = [tuple(cuenta_para_ingresos_bool(v) for v in f) for f in cur.fetchall()]
    columnas = ["fecha", "hora", "evento_id", "sucursal_id", "producto_id", "sustituto_ofrecido", "sustituto_aceptado"]
    return _cargar(ch_client, "fact_demanda_insatisfecha", columnas, filas, desde, hasta)


def cargar_fact_cupon(pg_conn, ch_client, desde: date, hasta: date) -> int:
    with pg_conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                c.fecha_envio::date, c.id, c.cliente_id, c.tipo_origen, t.es_automatico,
                c.descuento_tipo, c.descuento_valor, (c.estado = 'canjeado'),
                c.fecha_canje::date, c.venta_id_canje,
                CASE WHEN c.fecha_canje IS NOT NULL
                     THEN (c.fecha_canje::date - c.fecha_envio::date) END
            FROM cupon c
            JOIN tipo_origen_cupon t ON t.codigo = c.tipo_origen
            WHERE c.fecha_envio::date BETWEEN %s AND %s
            """,
            (desde, hasta),
        )
        filas = [tuple(cuenta_para_ingresos_bool(v) for v in f) for f in cur.fetchall()]
    columnas = [
        "fecha_envio", "cupon_id", "cliente_id", "tipo_origen", "es_automatico",
        "tipo_descuento", "valor_descuento", "fue_canjeado", "fecha_canje",
        "venta_id_canje", "dias_hasta_canje",
    ]
    return _cargar(ch_client, "fact_cupon", columnas, filas, desde, hasta)


def cargar_fact_stock_diario(pg_conn, ch_client, fecha_snapshot: date) -> int:
    """Snapshot de HOY — `stock_sucursal`/`lote_producto` no llevan
    historial en PostgreSQL, así que este hecho solo puede construirse
    con el estado en el momento en que corre (ver docstring del
    módulo). `dias_para_caducar` toma el lote con caducidad más
    próxima que todavía tenga `cantidad_restante > 0`."""
    with pg_conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                s.producto_id, s.sucursal_id, s.cantidad_disponible,
                round(s.cantidad_disponible * COALESCE(costo.costo, 0), 2),
                s.stock_minimo, (s.cantidad_disponible < s.stock_minimo),
                s.dias_sin_venta, s.marcado_sin_rotacion,
                lote.dias_para_caducar
            FROM stock_sucursal s
            LEFT JOIN LATERAL (
                SELECT h.costo
                FROM historial_costo_producto h
                WHERE h.producto_id = s.producto_id AND h.fecha <= now()
                ORDER BY h.fecha DESC
                LIMIT 1
            ) costo ON true
            LEFT JOIN LATERAL (
                SELECT (l.fecha_caducidad - %s::date) AS dias_para_caducar
                FROM lote_producto l
                WHERE l.producto_id = s.producto_id AND l.sucursal_id = s.sucursal_id
                  AND l.cantidad_restante > 0
                ORDER BY l.fecha_caducidad ASC
                LIMIT 1
            ) lote ON true
            """,
            (fecha_snapshot,),
        )
        filas = cur.fetchall()
    datos = [
        (fecha_snapshot, r[1], r[0], r[2], r[3], r[4], cuenta_para_ingresos_bool(r[5]), r[6], cuenta_para_ingresos_bool(r[7]), r[8])
        for r in filas
    ]
    columnas = [
        "fecha", "sucursal_id", "producto_id", "unidades", "valor_inventario",
        "stock_minimo", "bajo_minimo", "dias_sin_venta", "sin_rotacion", "dias_para_caducar",
    ]
    return _cargar(ch_client, "fact_stock_diario", columnas, datos, fecha_snapshot, fecha_snapshot)


def cargar_fact_precio_competencia(pg_conn, ch_client, desde: date, hasta: date) -> int:
    """`precio_propio`: el precio manual/motor vigente MÁS RECIENTE en
    `historial_precio_producto` (003) a la fecha de la observación, sin
    filtrar por sucursal — `precio_competencia` (el hecho de origen) no
    se registra por sucursal, así que compararlo contra un precio de
    cadena es la única lectura consistente."""
    with pg_conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT
                p.fecha_registro::date, p.id, p.producto_id, p.fuente_competencia_id,
                fc.canal_codigo, propio.precio_venta, p.precio_referencia,
                round(propio.precio_venta - p.precio_referencia, 2),
                round((propio.precio_venta - p.precio_referencia) / NULLIF(p.precio_referencia, 0) * 100, 2),
                (abs((propio.precio_venta - p.precio_referencia)
                     / NULLIF(p.precio_referencia, 0) * 100) <= {RANGO_COMPETITIVO_PCT})
            FROM precio_competencia p
            JOIN fuente_competencia fc ON fc.id = p.fuente_competencia_id
            LEFT JOIN LATERAL (
                SELECT h.precio_venta
                FROM historial_precio_producto h
                WHERE h.producto_id = p.producto_id AND h.vigente_desde <= p.fecha_registro
                ORDER BY h.vigente_desde DESC
                LIMIT 1
            ) propio ON true
            WHERE p.fecha_registro::date BETWEEN %s AND %s AND propio.precio_venta IS NOT NULL
            """,
            (desde, hasta),
        )
        filas = [tuple(cuenta_para_ingresos_bool(v) for v in f) for f in cur.fetchall()]
    columnas = [
        "fecha", "observacion_id", "producto_id", "fuente_id", "canal_codigo",
        "precio_propio", "precio_competencia", "brecha_absoluta", "brecha_pct",
        "en_rango_competitivo",
    ]
    return _cargar(ch_client, "fact_precio_competencia", columnas, filas, desde, hasta)


def cargar_fact_auditoria(pg_conn, ch_client, desde: date, hasta: date) -> int:
    """`usuario_id` con centinela `0` = sin usuario autenticado (login
    fallido) — ver el bug real documentado en el DDL sobre Nullable en
    la clave de ordenamiento."""
    with pg_conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                l.creado_en::date, EXTRACT(HOUR FROM l.creado_en)::int, l.id,
                COALESCE(l.usuario_id, 0), COALESCE(u.rol, ''),
                l.accion, l.recurso, l.sucursal_id, l.exitoso
            FROM log_auditoria l
            LEFT JOIN usuario u ON u.id = l.usuario_id
            WHERE l.creado_en::date BETWEEN %s AND %s
            """,
            (desde, hasta),
        )
        filas = [tuple(cuenta_para_ingresos_bool(v) for v in f) for f in cur.fetchall()]
    columnas = ["fecha", "hora", "evento_id", "usuario_id", "rol", "accion", "recurso", "sucursal_id", "exitoso"]
    return _cargar(ch_client, "fact_auditoria", columnas, filas, desde, hasta)


def cargar_todos_los_hechos(pg_conn, ch_client, desde: date, hasta: date) -> dict[str, int]:
    resultado = {
        "fact_venta_linea": cargar_fact_venta_linea(pg_conn, ch_client, desde, hasta),
        "fact_merma": cargar_fact_merma(pg_conn, ch_client, desde, hasta),
        "fact_cuadre_caja": cargar_fact_cuadre_caja(pg_conn, ch_client, desde, hasta),
        "fact_compra_recepcion": cargar_fact_compra_recepcion(pg_conn, ch_client, desde, hasta),
        "fact_demanda_insatisfecha": cargar_fact_demanda_insatisfecha(pg_conn, ch_client, desde, hasta),
        "fact_cupon": cargar_fact_cupon(pg_conn, ch_client, desde, hasta),
        "fact_precio_competencia": cargar_fact_precio_competencia(pg_conn, ch_client, desde, hasta),
        "fact_auditoria": cargar_fact_auditoria(pg_conn, ch_client, desde, hasta),
    }
    resultado["fact_stock_diario"] = cargar_fact_stock_diario(pg_conn, ch_client, datetime.utcnow().date())
    return resultado
