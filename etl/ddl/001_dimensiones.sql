-- El Kiosquito — Capa táctica (ClickHouse)
-- 12 dimensiones. Fuente: el-kiosquito-clickhouse-fact-dim.md §2.
-- dim_tiempo y dim_hora se generan por script (ver etl/etl/dim_tiempo.py,
-- etl/etl/dim_hora.py); las demás se cargan desde PostgreSQL (ver
-- etl/etl/dimensiones.py). Ninguna se escribe a mano.
--
-- CREATE DATABASE + USE explícitos: probado en vivo (ClickHouse 24.8,
-- docker-compose.yml) que `CLICKHOUSE_DB=elkiosquito_dw` NO alcanza para
-- que el propio `docker-entrypoint-initdb.d` cree las tablas ahí — sin
-- esto, las 21 tablas terminan creadas en `default` en vez de
-- `elkiosquito_dw`, y el ETL (que sí se conecta explícitamente a
-- `elkiosquito_dw`) no las encuentra. Cada archivo .sql de
-- docker-entrypoint-initdb.d corre en su propia sesión de
-- `clickhouse-client`, así que este preámbulo se repite igual en
-- 002_hechos.sql — un `USE` en este archivo no persiste al siguiente.
CREATE DATABASE IF NOT EXISTS elkiosquito_dw;
USE elkiosquito_dw;

CREATE TABLE IF NOT EXISTS dim_tiempo
(
    fecha             Date,
    anio              UInt16,
    trimestre         UInt8,
    mes               UInt8,
    nombre_mes        LowCardinality(String),
    semana_iso        UInt8,
    dia               UInt8,
    dia_semana        UInt8,
    nombre_dia        LowCardinality(String),
    es_fin_de_semana  UInt8,
    es_quincena       UInt8,
    es_feriado        UInt8,
    nombre_feriado    LowCardinality(String)
) ENGINE = MergeTree ORDER BY fecha;

CREATE TABLE IF NOT EXISTS dim_hora
(
    hora         UInt8,
    franja       LowCardinality(String),
    es_hora_pico UInt8
) ENGINE = MergeTree ORDER BY hora;

-- Bug real encontrado al escribir el loader: el diseño original traía
-- una columna `zona` sin ninguna fuente en PostgreSQL — `sucursal`
-- (009-expansion-sucursales) nunca tuvo ese campo, ni siquiera en el
-- data-model original. El propio §1 de este documento es explícito:
-- "el ETL copia las dimensiones, no las inventa" — así que se retira
-- en vez de rellenarla con NULL/'' para siempre. También se renombra
-- `fecha_apertura` a `fecha_activacion` para que el nombre coincida
-- exactamente con la columna real de origen (`sucursal.fecha_
-- activacion`) y no sugiera un campo que no existe.
CREATE TABLE IF NOT EXISTS dim_sucursal
(
    sucursal_id      UInt64,
    nombre           String,
    estado           LowCardinality(String),
    opera_ventas     UInt8,
    fecha_activacion Nullable(DateTime),
    version          DateTime
) ENGINE = ReplacingMergeTree(version) ORDER BY sucursal_id;

CREATE TABLE IF NOT EXISTS dim_categoria
(
    categoria_id    UInt64,
    nombre          LowCardinality(String),
    categoria_padre LowCardinality(String),
    es_perecedero   UInt8,
    version         DateTime
) ENGINE = ReplacingMergeTree(version) ORDER BY categoria_id;

CREATE TABLE IF NOT EXISTS dim_producto
(
    producto_id         UInt64,
    nombre              String,
    categoria_id        UInt64,
    categoria           LowCardinality(String),
    categoria_padre     LowCardinality(String),
    unidad_venta        LowCardinality(String),
    permite_decimales   UInt8,
    es_fraccionable     UInt8,
    es_perecedero       UInt8,
    clasificacion       LowCardinality(String),
    margen_objetivo_min Decimal(5, 2),
    margen_objetivo_max Decimal(5, 2),
    valido_desde        DateTime,
    valido_hasta        Nullable(DateTime)
) ENGINE = MergeTree ORDER BY (producto_id, valido_desde);

CREATE TABLE IF NOT EXISTS dim_cliente
(
    cliente_id          UInt64,
    segmento            LowCardinality(String),
    prioridad_comercial  UInt8,
    version_modelo_id   UInt64,
    antiguedad_meses    UInt16,
    valido_desde        DateTime,
    valido_hasta        Nullable(DateTime)
) ENGINE = MergeTree ORDER BY (cliente_id, valido_desde);

CREATE TABLE IF NOT EXISTS dim_usuario
(
    usuario_id       UInt64,
    nombre           String,
    rol              LowCardinality(String),
    nivel_jerarquico UInt8,
    alcance_cadena   UInt8,
    version          DateTime
) ENGINE = ReplacingMergeTree(version) ORDER BY usuario_id;

CREATE TABLE IF NOT EXISTS dim_proveedor
(
    proveedor_id UInt64,
    nombre       String,
    activo       UInt8,
    version      DateTime
) ENGINE = ReplacingMergeTree(version) ORDER BY proveedor_id;

CREATE TABLE IF NOT EXISTS dim_causa_merma
(
    codigo                  LowCardinality(String),
    etiqueta                String,
    es_atribuible_a_persona UInt8,
    requiere_investigacion  UInt8
) ENGINE = ReplacingMergeTree ORDER BY codigo;

CREATE TABLE IF NOT EXISTS dim_metodo_pago
(
    codigo         LowCardinality(String),
    etiqueta       String,
    es_electronico UInt8
) ENGINE = ReplacingMergeTree ORDER BY codigo;

CREATE TABLE IF NOT EXISTS dim_canal_competencia
(
    codigo                    LowCardinality(String),
    etiqueta                  String,
    frecuencia_monitoreo_dias UInt16
) ENGINE = ReplacingMergeTree ORDER BY codigo;

CREATE TABLE IF NOT EXISTS dim_fuente_competencia
(
    fuente_id    UInt64,
    nombre       String,
    canal_codigo LowCardinality(String),
    activo       UInt8,
    version      DateTime
) ENGINE = ReplacingMergeTree(version) ORDER BY fuente_id;

CREATE TABLE IF NOT EXISTS dim_evento_local
(
    evento_id              UInt64,
    tipo                   LowCardinality(String),
    afecta_demanda_al_alza UInt8,
    fecha_inicio           Date,
    fecha_fin              Date,
    sucursal_id            Nullable(UInt64)
) ENGINE = ReplacingMergeTree ORDER BY (evento_id, fecha_inicio);
