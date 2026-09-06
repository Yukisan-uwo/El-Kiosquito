"""
Catálogo de "tools" (function calling) del asistente conversacional
(Art. 5.10) — la traducción real de 5.10 a código: el LLM NUNCA recibe
acceso a SQL libre contra `elkiosquito_dw` ni contra PostgreSQL. Elige
entre estas funciones, con parámetros tipados y acotados, cada una
mapeada a una consulta fija ya escrita y revisada contra el esquema real
(`el-kiosquito-clickhouse-fact-dim.md` / `etl/ddl/*.sql`) — el modelo de
lenguaje decide QUÉ preguntar, nunca CÓMO se consulta la base.

Esto es lo que hace verificable la regla de honestidad del Art. 5.9/5.10:
`consulta_generada` (ver `services/asistente.py`) queda como el nombre de
la tool + los argumentos exactos que el LLM eligió — nunca una cadena de
SQL que el modelo pudo haber alucinado. Dos beneficios más, no menores:
ninguna tool puede volverse una vía de inyección SQL (los parámetros van
siempre por bind params del driver, nunca interpolados en el string), y
ninguna tool puede escribir — todas usan `ClienteClickHouseSoloLectura`
(sin `insert`/`command`) o una sesión de solo lectura de SQLAlchemy.

Convención de fechas: todo parámetro de fecha es `str` ISO (`YYYY-MM-DD`)
— más simple de declarar en JSON Schema que `date`, y las tools lo
parsean. El prompt del sistema (`asistente.py`) le da al LLM la fecha de
hoy explícitamente para que pueda calcular "esta semana"/"este mes" sin
inventar una fecha.
"""

from datetime import date, datetime

from sqlalchemy.orm import Session

from app.core.clickhouse import ClienteClickHouseSoloLectura
from app.models.analitica import ModeloMl, VersionModeloMl

# Los 5 modelos del Art. 5.6 — mismos códigos que ml/<modelo>.py en etl/ y
# que la columna modelo_ml.codigo. Constreñir el enum acá evita que el
# LLM invente un sexto modelo que no existe (Art. 13.6).
_MODELOS_ML = ["demanda", "pricing", "churn", "anomalias_caja", "segmentacion_clientes"]


def _parse_fecha(valor: str) -> date:
    return datetime.strptime(valor, "%Y-%m-%d").date()


# ---------------------------------------------------------------------------
# Ejecutores — cada uno recibe (clickhouse, db, **argumentos_del_llm) y
# devuelve una lista de dicts serializable a JSON (lo que el LLM lee de
# vuelta como resultado de la tool). Ninguno escribe nada.
# ---------------------------------------------------------------------------


def _merma_por_sucursal(ch: ClienteClickHouseSoloLectura, db: Session, desde: str, hasta: str) -> list[dict]:
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


def _merma_por_causa(
    ch: ClienteClickHouseSoloLectura, db: Session, desde: str, hasta: str, sucursal_id: int | None = None
) -> list[dict]:
    filtro_sucursal = "AND m.sucursal_id = %(sucursal_id)s" if sucursal_id is not None else ""
    resultado = ch.query(
        f"""
        SELECT m.causa, c.etiqueta, c.es_atribuible_a_persona,
               sum(m.valor_perdido) AS valor_perdido_total,
               count() AS eventos
        FROM fact_merma m
        INNER JOIN dim_causa_merma AS c FINAL ON c.codigo = m.causa
        WHERE m.fecha >= %(desde)s AND m.fecha <= %(hasta)s {filtro_sucursal}
        GROUP BY m.causa, c.etiqueta, c.es_atribuible_a_persona
        ORDER BY valor_perdido_total DESC
        """,
        {"desde": _parse_fecha(desde), "hasta": _parse_fecha(hasta), "sucursal_id": sucursal_id},
    )
    columnas = ["causa", "etiqueta", "es_atribuible_a_persona", "valor_perdido_total", "eventos"]
    return [dict(zip(columnas, fila)) for fila in resultado.result_rows]


def _margen_por_sucursal(ch: ClienteClickHouseSoloLectura, db: Session, desde: str, hasta: str) -> list[dict]:
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


def _margen_por_categoria(ch: ClienteClickHouseSoloLectura, db: Session, desde: str, hasta: str) -> list[dict]:
    # Categoría VIGENTE del producto (valido_hasta IS NULL, invariante
    # SCD2 del Art. 13.9), no la vigente al momento de cada venta — para
    # una pregunta de dirección ("¿qué categoría rinde más?") alcanza con
    # la clasificación actual; una comparación histórica exacta por venta
    # necesitaría un join por rango, fuera de alcance de una tool.
    resultado = ch.query(
        """
        SELECT p.categoria_padre,
               sum(v.margen_linea) AS margen_total,
               sum(v.subtotal_linea) AS ingresos_total,
               count() AS lineas_de_venta
        FROM fact_venta_linea v
        INNER JOIN (
            SELECT producto_id, categoria_padre FROM dim_producto WHERE valido_hasta IS NULL
        ) AS p ON p.producto_id = v.producto_id
        WHERE v.cuenta_para_ingresos = 1 AND v.fecha >= %(desde)s AND v.fecha <= %(hasta)s
        GROUP BY p.categoria_padre
        ORDER BY margen_total DESC
        """,
        {"desde": _parse_fecha(desde), "hasta": _parse_fecha(hasta)},
    )
    columnas = ["categoria_padre", "margen_total", "ingresos_total", "lineas_de_venta"]
    return [dict(zip(columnas, fila)) for fila in resultado.result_rows]


def _productos_baja_rotacion(
    ch: ClienteClickHouseSoloLectura, db: Session, sucursal_id: int | None = None, limite: int = 10
) -> list[dict]:
    # fact_stock_diario es un snapshot (una foto por día, no transaccional
    # — ver el-kiosquito-clickhouse-fact-dim.md §3): se responde siempre
    # con el snapshot más reciente cargado, nunca "hoy" a secas (el ETL
    # corre una vez al día, puede no haber snapshot de la fecha actual
    # todavía).
    filtro_sucursal = "AND f.sucursal_id = %(sucursal_id)s" if sucursal_id is not None else ""
    resultado = ch.query(
        f"""
        SELECT f.producto_id, p.nombre, f.sucursal_id, f.unidades, f.valor_inventario,
               f.dias_sin_venta, f.sin_rotacion
        FROM fact_stock_diario f
        INNER JOIN (
            SELECT producto_id, nombre FROM dim_producto WHERE valido_hasta IS NULL
        ) AS p ON p.producto_id = f.producto_id
        WHERE f.fecha = (SELECT max(fecha) FROM fact_stock_diario) AND f.sin_rotacion = 1 {filtro_sucursal}
        ORDER BY f.dias_sin_venta DESC, f.valor_inventario DESC
        LIMIT %(limite)s
        """,
        {"sucursal_id": sucursal_id, "limite": limite},
    )
    columnas = ["producto_id", "producto_nombre", "sucursal_id", "unidades", "valor_inventario", "dias_sin_venta", "sin_rotacion"]
    return [dict(zip(columnas, fila)) for fila in resultado.result_rows]


def _demanda_insatisfecha_top_productos(
    ch: ClienteClickHouseSoloLectura, db: Session, desde: str, hasta: str, limite: int = 10
) -> list[dict]:
    # Se cuentan eventos (count()), nunca se suma una cantidad — la
    # columna cantidad_solicitada no existe en fact_demanda_insatisfecha
    # (bug real #3 de etl/README.md: el origen operativo nunca la
    # capturó). Sumar algo que la fuente no registró sería inventar un
    # dato, justo lo que el Art. 5.9/5.10 prohíbe.
    resultado = ch.query(
        """
        SELECT f.producto_id, p.nombre, count() AS eventos_quiebre,
               sum(f.sustituto_ofrecido) AS veces_con_sustituto_ofrecido,
               sum(f.sustituto_aceptado) AS veces_sustituto_aceptado
        FROM fact_demanda_insatisfecha f
        INNER JOIN (
            SELECT producto_id, nombre FROM dim_producto WHERE valido_hasta IS NULL
        ) AS p ON p.producto_id = f.producto_id
        WHERE f.fecha >= %(desde)s AND f.fecha <= %(hasta)s
        GROUP BY f.producto_id, p.nombre
        ORDER BY eventos_quiebre DESC
        LIMIT %(limite)s
        """,
        {"desde": _parse_fecha(desde), "hasta": _parse_fecha(hasta), "limite": limite},
    )
    columnas = ["producto_id", "producto_nombre", "eventos_quiebre", "veces_con_sustituto_ofrecido", "veces_sustituto_aceptado"]
    return [dict(zip(columnas, fila)) for fila in resultado.result_rows]


def _cuadre_caja_diferencias(
    ch: ClienteClickHouseSoloLectura, db: Session, desde: str, hasta: str, sucursal_id: int | None = None
) -> list[dict]:
    # Solo cierres de turno (es_checkpoint=0) — los checkpoints horarios
    # no tienen monto_contado/diferencia (ver docstring de ml/anomalias_
    # caja.py). Se agrupa por cajero: el objetivo de esta tool es la
    # misma pregunta que entrena el modelo de anomalías (Art. 5.6 #4),
    # aquí como consulta directa, no como predicción.
    filtro_sucursal = "AND sucursal_id = %(sucursal_id)s" if sucursal_id is not None else ""
    resultado = ch.query(
        f"""
        SELECT cajero_id, sucursal_id,
               sum(abs(diferencia)) AS diferencia_absoluta_total,
               count() AS cierres_de_turno
        FROM fact_cuadre_caja
        WHERE es_checkpoint = 0 AND diferencia IS NOT NULL
          AND fecha >= %(desde)s AND fecha <= %(hasta)s {filtro_sucursal}
        GROUP BY cajero_id, sucursal_id
        ORDER BY diferencia_absoluta_total DESC
        """,
        {"desde": _parse_fecha(desde), "hasta": _parse_fecha(hasta), "sucursal_id": sucursal_id},
    )
    columnas = ["cajero_id", "sucursal_id", "diferencia_absoluta_total", "cierres_de_turno"]
    return [dict(zip(columnas, fila)) for fila in resultado.result_rows]


def _metricas_modelo_ml(ch: ClienteClickHouseSoloLectura, db: Session, modelo: str) -> list[dict]:
    # Directo contra PostgreSQL (misma BD del propio backend, no hace
    # falta una llamada HTTP a su propio endpoint) — regla de honestidad
    # del Art. 5.9/5.10 aplicada literalmente: si no hay versión activa,
    # se dice así, nunca se inventa una métrica.
    version = (
        db.query(VersionModeloMl)
        .filter(VersionModeloMl.modelo == modelo, VersionModeloMl.estado == "activo")
        .order_by(VersionModeloMl.fecha_entrenamiento.desc())
        .first()
    )
    modelo_cat = db.get(ModeloMl, modelo)
    if version is None:
        return [
            {
                "modelo": modelo,
                "etiqueta": modelo_cat.etiqueta if modelo_cat else modelo,
                "tiene_version_activa": False,
                "motivo": "ningún modelo activo todavía — datos insuficientes o nunca entrenado (Art. 5.9)",
            }
        ]
    return [
        {
            "modelo": modelo,
            "etiqueta": modelo_cat.etiqueta if modelo_cat else modelo,
            "tiene_version_activa": True,
            "version": version.version,
            "nombre_metrica": version.nombre_metrica,
            "valor_metrica": float(version.valor_metrica) if version.valor_metrica is not None else None,
            "tamano_muestra": version.tamano_muestra,
            "periodo_inicio": version.periodo_inicio.isoformat(),
            "periodo_fin": version.periodo_fin.isoformat(),
        }
    ]


# ---------------------------------------------------------------------------
# Catálogo expuesto al LLM (formato tool-calling compatible OpenAI/OpenRouter)
# ---------------------------------------------------------------------------

TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "merma_por_sucursal",
            "description": "Total de merma (valor perdido, cantidad, número de eventos) agrupado por sucursal, en un rango de fechas. Útil para '¿qué sucursal tuvo más merma?'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "desde": {"type": "string", "description": "Fecha inicial, formato YYYY-MM-DD"},
                    "hasta": {"type": "string", "description": "Fecha final, formato YYYY-MM-DD"},
                },
                "required": ["desde", "hasta"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "merma_por_causa",
            "description": "Total de merma agrupado por causa (robo externo, error humano, fraude interno, caducidad), indicando si cada causa es atribuible a una persona. Útil para '¿por qué se está perdiendo mercadería?'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "desde": {"type": "string", "description": "Fecha inicial, formato YYYY-MM-DD"},
                    "hasta": {"type": "string", "description": "Fecha final, formato YYYY-MM-DD"},
                    "sucursal_id": {"type": "integer", "description": "Opcional: limitar a una sucursal"},
                },
                "required": ["desde", "hasta"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "margen_por_sucursal",
            "description": "Margen real e ingresos totales por sucursal, en un rango de fechas. Útil para comparar el desempeño comercial entre sucursales.",
            "parameters": {
                "type": "object",
                "properties": {
                    "desde": {"type": "string", "description": "Fecha inicial, formato YYYY-MM-DD"},
                    "hasta": {"type": "string", "description": "Fecha final, formato YYYY-MM-DD"},
                },
                "required": ["desde", "hasta"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "margen_por_categoria",
            "description": "Margen real e ingresos totales por categoría de producto (clasificación vigente hoy), en un rango de fechas. Útil para '¿qué categoría deja más margen?'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "desde": {"type": "string", "description": "Fecha inicial, formato YYYY-MM-DD"},
                    "hasta": {"type": "string", "description": "Fecha final, formato YYYY-MM-DD"},
                },
                "required": ["desde", "hasta"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "productos_baja_rotacion",
            "description": "Productos marcados sin rotación en el snapshot de inventario más reciente, ordenados por días sin venta y valor de inventario inmovilizado. Útil para '¿qué productos debería dejar de comprar?'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "sucursal_id": {"type": "integer", "description": "Opcional: limitar a una sucursal"},
                    "limite": {"type": "integer", "description": "Máximo de productos a devolver (default 10)"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "demanda_insatisfecha_top_productos",
            "description": "Productos con más eventos de demanda insatisfecha (cliente pidió y no había stock) en un rango de fechas, con cuántas veces se ofreció y se aceptó un sustituto.",
            "parameters": {
                "type": "object",
                "properties": {
                    "desde": {"type": "string", "description": "Fecha inicial, formato YYYY-MM-DD"},
                    "hasta": {"type": "string", "description": "Fecha final, formato YYYY-MM-DD"},
                    "limite": {"type": "integer", "description": "Máximo de productos a devolver (default 10)"},
                },
                "required": ["desde", "hasta"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "cuadre_caja_diferencias",
            "description": "Diferencia absoluta total de cuadre de caja por cajero (solo cierres de turno, no checkpoints horarios), en un rango de fechas. Útil para detectar patrones de descuadre que podrían indicar fraude interno.",
            "parameters": {
                "type": "object",
                "properties": {
                    "desde": {"type": "string", "description": "Fecha inicial, formato YYYY-MM-DD"},
                    "hasta": {"type": "string", "description": "Fecha final, formato YYYY-MM-DD"},
                    "sucursal_id": {"type": "integer", "description": "Opcional: limitar a una sucursal"},
                },
                "required": ["desde", "hasta"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "metricas_modelo_ml",
            "description": "Métricas de la versión ACTIVA de uno de los 5 modelos de ML del Art. 5.6 (tamaño de muestra, periodo cubierto, métrica de desempeño). Si no hay versión activa, lo dice explícitamente — nunca inventa una métrica (Art. 5.9).",
            "parameters": {
                "type": "object",
                "properties": {
                    "modelo": {"type": "string", "enum": _MODELOS_ML, "description": "Código del modelo"},
                },
                "required": ["modelo"],
            },
        },
    },
]

# Despacho nombre -> ejecutor. Usado por services/asistente.py — nunca se
# llama a un ejecutor por un nombre que no venga de acá (evita que un tool
# call con un nombre inventado por el LLM ejecute código arbitrario).
EJECUTORES = {
    "merma_por_sucursal": _merma_por_sucursal,
    "merma_por_causa": _merma_por_causa,
    "margen_por_sucursal": _margen_por_sucursal,
    "margen_por_categoria": _margen_por_categoria,
    "productos_baja_rotacion": _productos_baja_rotacion,
    "demanda_insatisfecha_top_productos": _demanda_insatisfecha_top_productos,
    "cuadre_caja_diferencias": _cuadre_caja_diferencias,
    "metricas_modelo_ml": _metricas_modelo_ml,
}
