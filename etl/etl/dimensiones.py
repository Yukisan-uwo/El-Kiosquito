"""
Carga de las 10 dimensiones que vienen de PostgreSQL (las 2 restantes,
dim_tiempo/dim_hora, se generan por script — ver dim_tiempo.py).

Estrategia de idempotencia: **todas** se recargan completas en cada
corrida (TRUNCATE + INSERT). Son catálogos y tablas maestras — su
volumen es bajo (decenas o cientos de filas, nunca millones), así que
un refresco completo es más simple y más seguro que depender del merge
en segundo plano de `ReplacingMergeTree` para deduplicar antes de que
un reporte lea la tabla. El motor `ReplacingMergeTree` de las 8
dimensiones que lo usan se mantiene tal como lo definió el diseño
original (el-kiosquito-clickhouse-fact-dim.md) porque documenta la
intención (“esta tabla no debería tener dos filas con la misma clave”);
la garantía real de que nunca las tenga la da este loader, no el motor.

Las 2 dimensiones SCD2 (`dim_producto`, `dim_cliente`) también se
recargan completas: no se "actualiza" un rango de vigencia, se copia
tal cual el historial completo que ya vive en PostgreSQL (`producto_
clasificacion_historial`, `segmento_cliente`) — el ETL no calcula
ventanas de vigencia, las copia (regla del propio documento de
arquitectura, §2).
"""

from datetime import datetime


def _truncar_e_insertar(ch_client, tabla: str, columnas: list[str], filas: list[tuple]) -> int:
    ch_client.command(f"TRUNCATE TABLE {tabla}")
    if filas:
        ch_client.insert(tabla, filas, column_names=columnas)
    return len(filas)


def cargar_dim_sucursal(pg_conn, ch_client) -> int:
    with pg_conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, nombre, estado, es.opera_ventas, fecha_activacion
            FROM sucursal s
            JOIN estado_sucursal es ON es.codigo = s.estado
            """
        )
        filas = cur.fetchall()
    version = datetime.utcnow()
    datos = [(r[0], r[1], r[2], int(r[3]), r[4], version) for r in filas]
    return _truncar_e_insertar(
        ch_client, "dim_sucursal", ["sucursal_id", "nombre", "estado", "opera_ventas", "fecha_activacion", "version"], datos
    )


def cargar_dim_categoria(pg_conn, ch_client) -> int:
    with pg_conn.cursor() as cur:
        cur.execute(
            """
            SELECT c.id, c.nombre, COALESCE(padre.nombre, ''), c.es_perecedero
            FROM categoria c
            LEFT JOIN categoria padre ON padre.id = c.categoria_padre_id
            """
        )
        filas = cur.fetchall()
    version = datetime.utcnow()
    datos = [(r[0], r[1], r[2], int(r[3]), version) for r in filas]
    return _truncar_e_insertar(
        ch_client, "dim_categoria", ["categoria_id", "nombre", "categoria_padre", "es_perecedero", "version"], datos
    )


def cargar_dim_producto(pg_conn, ch_client) -> int:
    """SCD2: una fila por versión de clasificación en `producto_
    clasificacion_historial` (003) — nunca solo la vigente. Copia el
    rango `[fecha_desde, fecha_hasta)` tal cual, sin recalcularlo."""
    with pg_conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                p.id, p.nombre, p.categoria_id, cat.nombre,
                COALESCE(padre.nombre, ''),
                um_venta.codigo, um_venta.permite_decimales,
                p.es_fraccionable, p.es_perecedero,
                h.clasificacion, cc.margen_objetivo_min, cc.margen_objetivo_max,
                h.fecha_desde, h.fecha_hasta
            FROM producto p
            JOIN categoria cat ON cat.id = p.categoria_id
            LEFT JOIN categoria padre ON padre.id = cat.categoria_padre_id
            JOIN unidad_medida um_venta ON um_venta.codigo = p.unidad_venta_codigo
            JOIN producto_clasificacion_historial h ON h.producto_id = p.id
            JOIN clasificacion_comercial cc ON cc.codigo = h.clasificacion
            """
        )
        filas = cur.fetchall()
    datos = [
        (
            r[0], r[1], r[2], r[3], r[4], r[5], int(r[6]), int(r[7]), int(r[8]),
            r[9], r[10], r[11], r[12], r[13],
        )
        for r in filas
    ]
    columnas = [
        "producto_id", "nombre", "categoria_id", "categoria", "categoria_padre",
        "unidad_venta", "permite_decimales", "es_fraccionable", "es_perecedero",
        "clasificacion", "margen_objetivo_min", "margen_objetivo_max",
        "valido_desde", "valido_hasta",
    ]
    return _truncar_e_insertar(ch_client, "dim_producto", columnas, datos)


def cargar_dim_cliente(pg_conn, ch_client) -> int:
    """SCD2: una fila por versión de segmentación en `segmento_cliente`
    (002) — `antiguedad_meses` se calcula respecto a `fecha_calculo` de
    CADA versión (cuántos meses de antigüedad tenía el cliente en ESE
    momento), no respecto a hoy — de lo contrario una fila histórica
    mentiría sobre la antigüedad que tenía cuando se calculó.

    `GREATEST(..., 0)`: antiguedad_meses es UInt16 en ClickHouse, que
    rechaza (no trunca) valores negativos. Un cliente no puede tener
    antigüedad negativa; que `creado_en` quede por delante de
    `fecha_calculo` solo pasa por reloj/datos de prueba desalineados
    (ver seed_test_data.sql), nunca por una versión real del negocio —
    el clamp es una salvaguarda de tipo, no un dato inventado."""
    with pg_conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                s.cliente_id, s.segmento_codigo, seg.prioridad_comercial,
                s.version_modelo_id,
                GREATEST(
                    (EXTRACT(YEAR FROM age(s.fecha_calculo, c.creado_en)) * 12
                        + EXTRACT(MONTH FROM age(s.fecha_calculo, c.creado_en)))::int,
                    0
                ),
                s.fecha_calculo, s.vigente_hasta
            FROM segmento_cliente s
            JOIN cliente c ON c.id = s.cliente_id
            JOIN segmento seg ON seg.codigo = s.segmento_codigo
            """
        )
        filas = cur.fetchall()
    columnas = [
        "cliente_id", "segmento", "prioridad_comercial", "version_modelo_id",
        "antiguedad_meses", "valido_desde", "valido_hasta",
    ]
    return _truncar_e_insertar(ch_client, "dim_cliente", columnas, filas)


def cargar_dim_usuario(pg_conn, ch_client) -> int:
    with pg_conn.cursor() as cur:
        cur.execute(
            """
            SELECT u.id, u.nombre, u.rol, r.nivel_jerarquico, r.alcance_cadena
            FROM usuario u
            JOIN rol r ON r.codigo = u.rol
            """
        )
        filas = cur.fetchall()
    version = datetime.utcnow()
    datos = [(r[0], r[1], r[2], r[3], int(r[4]), version) for r in filas]
    return _truncar_e_insertar(
        ch_client, "dim_usuario",
        ["usuario_id", "nombre", "rol", "nivel_jerarquico", "alcance_cadena", "version"], datos,
    )


def cargar_dim_proveedor(pg_conn, ch_client) -> int:
    with pg_conn.cursor() as cur:
        cur.execute("SELECT id, nombre, activo FROM proveedor")
        filas = cur.fetchall()
    version = datetime.utcnow()
    datos = [(r[0], r[1], int(r[2]), version) for r in filas]
    return _truncar_e_insertar(ch_client, "dim_proveedor", ["proveedor_id", "nombre", "activo", "version"], datos)


def cargar_dim_causa_merma(pg_conn, ch_client) -> int:
    with pg_conn.cursor() as cur:
        cur.execute("SELECT codigo, etiqueta, es_atribuible_a_persona, requiere_investigacion FROM causa_merma")
        filas = cur.fetchall()
    datos = [(r[0], r[1], int(r[2]), int(r[3])) for r in filas]
    return _truncar_e_insertar(
        ch_client, "dim_causa_merma", ["codigo", "etiqueta", "es_atribuible_a_persona", "requiere_investigacion"], datos
    )


def cargar_dim_metodo_pago(pg_conn, ch_client) -> int:
    with pg_conn.cursor() as cur:
        cur.execute("SELECT codigo, etiqueta, es_electronico FROM metodo_pago")
        filas = cur.fetchall()
    datos = [(r[0], r[1], int(r[2])) for r in filas]
    return _truncar_e_insertar(ch_client, "dim_metodo_pago", ["codigo", "etiqueta", "es_electronico"], datos)


def cargar_dim_canal_competencia(pg_conn, ch_client) -> int:
    with pg_conn.cursor() as cur:
        cur.execute("SELECT codigo, etiqueta, frecuencia_monitoreo_dias FROM canal_competencia")
        filas = cur.fetchall()
    return _truncar_e_insertar(
        ch_client, "dim_canal_competencia", ["codigo", "etiqueta", "frecuencia_monitoreo_dias"], filas
    )


def cargar_dim_fuente_competencia(pg_conn, ch_client) -> int:
    with pg_conn.cursor() as cur:
        cur.execute("SELECT id, nombre, canal_codigo, activo FROM fuente_competencia")
        filas = cur.fetchall()
    version = datetime.utcnow()
    datos = [(r[0], r[1], r[2], int(r[3]), version) for r in filas]
    return _truncar_e_insertar(
        ch_client, "dim_fuente_competencia", ["fuente_id", "nombre", "canal_codigo", "activo", "version"], datos
    )


def cargar_dim_evento_local(pg_conn, ch_client) -> int:
    with pg_conn.cursor() as cur:
        cur.execute(
            """
            SELECT e.id, e.tipo, t.afecta_demanda_al_alza, e.fecha_inicio, e.fecha_fin, e.sucursal_id
            FROM evento_local e
            JOIN tipo_evento_local t ON t.codigo = e.tipo
            """
        )
        filas = cur.fetchall()
    datos = [(r[0], r[1], int(r[2]), r[3], r[4], r[5]) for r in filas]
    columnas = ["evento_id", "tipo", "afecta_demanda_al_alza", "fecha_inicio", "fecha_fin", "sucursal_id"]
    return _truncar_e_insertar(ch_client, "dim_evento_local", columnas, datos)


def cargar_todas_las_dimensiones(pg_conn, ch_client) -> dict[str, int]:
    """Orden sin importancia entre sí (ninguna dimensión referencia a
    otra dentro de ClickHouse), pero TODAS antes que cualquier hecho —
    regla 3 de el-kiosquito-clickhouse-fact-dim.md §5."""
    return {
        "dim_sucursal": cargar_dim_sucursal(pg_conn, ch_client),
        "dim_categoria": cargar_dim_categoria(pg_conn, ch_client),
        "dim_producto": cargar_dim_producto(pg_conn, ch_client),
        "dim_cliente": cargar_dim_cliente(pg_conn, ch_client),
        "dim_usuario": cargar_dim_usuario(pg_conn, ch_client),
        "dim_proveedor": cargar_dim_proveedor(pg_conn, ch_client),
        "dim_causa_merma": cargar_dim_causa_merma(pg_conn, ch_client),
        "dim_metodo_pago": cargar_dim_metodo_pago(pg_conn, ch_client),
        "dim_canal_competencia": cargar_dim_canal_competencia(pg_conn, ch_client),
        "dim_fuente_competencia": cargar_dim_fuente_competencia(pg_conn, ch_client),
        "dim_evento_local": cargar_dim_evento_local(pg_conn, ch_client),
    }
