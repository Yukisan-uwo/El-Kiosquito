-- El Kiosquito — Capa táctica (ClickHouse)
-- 9 tablas de hechos. Fuente: el-kiosquito-clickhouse-fact-dim.md §3.
-- Cubren los 17 informes compuestos de la tabla de objetivos tácticos
-- (los 23 informes simples se sirven desde PostgreSQL, no pasan por acá).
--
-- CREATE DATABASE + USE explícitos: ver el comentario al inicio de
-- 001_dimensiones.sql — cada archivo de docker-entrypoint-initdb.d corre
-- en su propia sesión, así que esto se repite acá también.
CREATE DATABASE IF NOT EXISTS elkiosquito_dw;
USE elkiosquito_dw;

CREATE TABLE IF NOT EXISTS fact_venta_linea
(
    fecha                    Date,
    hora                     UInt8,
    venta_id                 UInt64,
    numero_documento         String,
    sucursal_id              UInt64,
    producto_id              UInt64,
    cliente_id               Nullable(UInt64),
    cajero_id                UInt64,
    metodo_pago              LowCardinality(String),
    estado_venta             LowCardinality(String),
    cuenta_para_ingresos     UInt8,
    cantidad_venta           Decimal(10, 3),
    cantidad_inventario      Decimal(10, 3),
    precio_unitario          Decimal(10, 2),
    subtotal_linea           Decimal(10, 2),
    costo_reposicion_vigente Decimal(10, 2),
    margen_linea             Decimal(10, 2),
    duracion_cobro_seg       Nullable(UInt32)
) ENGINE = MergeTree
PARTITION BY toYYYYMM(fecha)
ORDER BY (sucursal_id, fecha, producto_id);

CREATE TABLE IF NOT EXISTS fact_merma
(
    fecha                   Date,
    merma_id                UInt64,
    sucursal_id             UInt64,
    producto_id             UInt64,
    causa                   LowCardinality(String),
    es_atribuible_a_persona UInt8,
    resultado_investigacion Nullable(String),
    registrado_por          UInt64,
    cantidad                Decimal(10, 3),
    valor_perdido           Decimal(10, 2)
) ENGINE = MergeTree PARTITION BY toYYYYMM(fecha) ORDER BY (sucursal_id, fecha, causa);

CREATE TABLE IF NOT EXISTS fact_cuadre_caja
(
    fecha          Date,
    hora           UInt8,
    turno_caja_id  UInt64,
    sucursal_id    UInt64,
    cajero_id      UInt64,
    es_checkpoint  UInt8,
    monto_esperado Decimal(10, 2),
    monto_contado  Nullable(Decimal(10, 2)),
    diferencia     Nullable(Decimal(10, 2))
) ENGINE = MergeTree PARTITION BY toYYYYMM(fecha) ORDER BY (sucursal_id, cajero_id, fecha, hora);

CREATE TABLE IF NOT EXISTS fact_compra_recepcion
(
    fecha                   Date,
    recepcion_id            UInt64,
    orden_compra_id         UInt64,
    sucursal_id             UInt64,
    proveedor_id            UInt64,
    producto_id             UInt64,
    forma_pago              LowCardinality(String),
    dias_plazo              UInt16,
    es_oferta               UInt8,
    siguio_pronostico       UInt8,
    cantidad_recibida       Decimal(10, 3),
    costo_unitario          Decimal(10, 2),
    dias_pedido_a_recepcion UInt16
) ENGINE = MergeTree PARTITION BY toYYYYMM(fecha) ORDER BY (proveedor_id, fecha, producto_id);

-- Bug real encontrado al escribir el extractor: `cantidad_solicitada`
-- no tiene fuente — `demanda_insatisfecha` (004) no guarda una
-- cantidad, cada fila YA ES un evento de quiebre (RF-004: se registra
-- una vez por intento de venta sin stock). Sumar una columna inventada
-- violaría la misma regla que le costó `zona` a `dim_sucursal`. Se
-- retira: el informe cuenta filas (`count()`), no suma una cantidad
-- que el origen nunca capturó.
CREATE TABLE IF NOT EXISTS fact_demanda_insatisfecha
(
    fecha              Date,
    hora               UInt8,
    evento_id          UInt64,
    sucursal_id        UInt64,
    producto_id        UInt64,
    sustituto_ofrecido UInt8,
    sustituto_aceptado UInt8
) ENGINE = MergeTree PARTITION BY toYYYYMM(fecha) ORDER BY (sucursal_id, fecha, producto_id);

CREATE TABLE IF NOT EXISTS fact_cupon
(
    fecha_envio      Date,
    cupon_id         UInt64,
    cliente_id       UInt64,
    tipo_origen      LowCardinality(String),
    es_automatico    UInt8,
    tipo_descuento   LowCardinality(String),
    valor_descuento  Decimal(10, 2),
    fue_canjeado     UInt8,
    fecha_canje      Nullable(Date),
    venta_id_canje   Nullable(UInt64),
    dias_hasta_canje Nullable(UInt16)
) ENGINE = MergeTree PARTITION BY toYYYYMM(fecha_envio) ORDER BY (cliente_id, fecha_envio);

CREATE TABLE IF NOT EXISTS fact_stock_diario
(
    fecha             Date,
    sucursal_id       UInt64,
    producto_id       UInt64,
    unidades          Decimal(10, 3),
    valor_inventario  Decimal(12, 2),
    stock_minimo      Decimal(10, 3),
    bajo_minimo       UInt8,
    dias_sin_venta    UInt16,
    sin_rotacion      UInt8,
    dias_para_caducar Nullable(Int32)
) ENGINE = MergeTree PARTITION BY toYYYYMM(fecha) ORDER BY (sucursal_id, fecha, producto_id);

CREATE TABLE IF NOT EXISTS fact_precio_competencia
(
    fecha                Date,
    observacion_id       UInt64,
    producto_id          UInt64,
    fuente_id            UInt64,
    canal_codigo         LowCardinality(String),
    precio_propio        Decimal(10, 2),
    precio_competencia   Decimal(10, 2),
    brecha_absoluta      Decimal(10, 2),
    brecha_pct           Decimal(6, 2),
    en_rango_competitivo UInt8
) ENGINE = MergeTree PARTITION BY toYYYYMM(fecha) ORDER BY (producto_id, fecha, fuente_id);

-- Bug real encontrado al aplicar este DDL contra un ClickHouse real:
-- ClickHouse prohíbe columnas Nullable en la clave de ordenamiento
-- (ORDER BY/PRIMARY KEY) — no es una limitación de la versión vieja de
-- prueba (18.16.1), sigue siendo cierto en cualquier versión moderna.
-- El diseño original tenía `usuario_id Nullable(UInt64)` dentro del
-- ORDER BY porque un intento de login fallido no tiene usuario
-- autenticado (log_accion(usuario_id=None) en 010-administracion). Se
-- corrige con un centinela `0` = "sin usuario" en vez de NULL, mismo
-- criterio que `sucursal_id` en otros hechos cuando el evento es de
-- cadena. `sucursal_id` sí puede seguir Nullable porque no forma parte
-- de ninguna clave de ordenamiento acá.
CREATE TABLE IF NOT EXISTS fact_auditoria
(
    fecha       Date,
    hora        UInt8,
    evento_id   UInt64,
    usuario_id  UInt64,          -- 0 = sin usuario autenticado (login fallido)
    rol         LowCardinality(String),
    accion      LowCardinality(String),
    recurso     LowCardinality(String),
    sucursal_id Nullable(UInt64),
    exitoso     UInt8
) ENGINE = MergeTree PARTITION BY toYYYYMM(fecha) ORDER BY (fecha, usuario_id, exitoso);
