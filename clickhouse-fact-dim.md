# El Kiosquito — Esquema Físico de la Capa Táctica (ClickHouse)

**Fecha**: 2026-09-04 | **Origen**: `informes-simples-vs-compuestos.md` §5 + los 11 `data-model.md` tras la enmienda de catálogos
**Alcance**: los 17 informes compuestos de la tabla de objetivos tácticos. Los 23 informes simples se sirven desde PostgreSQL y **no** pasan por aquí.

---

## 1. Cómo se relaciona con PostgreSQL

PostgreSQL es la fuente; ClickHouse es una copia transformada, nunca la verdad. El pipeline de Airflow (OT3.6) lee de la operativa y escribe aquí; **nadie escribe en ClickHouse a mano**.

Tras la enmienda de catálogos, **el ETL copia las dimensiones, no las inventa**: los 33 catálogos ya existen en la BDR con sus atributos (`es_atribuible_a_persona`, `cuenta_para_ingresos`, `alcance_cadena`…). Antes, esas reglas habrían tenido que reimplementarse en el pipeline — dos definiciones de lo mismo, que es como un informe termina contradiciendo a otro.

Las únicas dos dimensiones sin origen en PostgreSQL son `dim_tiempo` y `dim_hora`, que se generan por script.

**Convención de motores**: `MergeTree` para hechos, `ReplacingMergeTree` para dimensiones (permite reprocesar sin duplicar), `ORDER BY` empezando siempre por `sucursal_id` o la clave más filtrada, y `PARTITION BY` mensual en los hechos de alto volumen.

---

## 2. Dimensiones (12)

### `dim_tiempo` — generada por script

```sql
CREATE TABLE dim_tiempo (
    fecha             Date,
    anio              UInt16,
    trimestre         UInt8,
    mes               UInt8,
    nombre_mes        LowCardinality(String),
    semana_iso        UInt8,
    dia               UInt8,
    dia_semana        UInt8,                    -- 1 = lunes
    nombre_dia        LowCardinality(String),
    es_fin_de_semana  UInt8,
    es_quincena       UInt8,
    es_feriado        UInt8,
    nombre_feriado    LowCardinality(String)
) ENGINE = MergeTree ORDER BY fecha;
```

**`es_quincena` no es decorativo.** En un kiosko de barrio el día de pago mueve la demanda tanto como una promoción, y sin esa bandera el modelo de pronóstico atribuye a la promoción lo que en realidad fue la quincena — exactamente el confusor que el Art. 5.6 obliga a descontar.

`es_feriado` y `nombre_feriado` se rellenan desde `evento_local` (004) cruzando por fecha, en la carga inicial y en cada incremental. No se escriben a mano: el catálogo `tipo_evento_local` ya dice qué tipos cuentan como feriado.

### `dim_hora` — generada por script (24 filas)

```sql
CREATE TABLE dim_hora (
    hora      UInt8,                            -- 0..23
    franja    LowCardinality(String),           -- madrugada / mañana / mediodia / tarde / noche
    es_hora_pico UInt8                          -- se calibra con datos reales, no se asume
) ENGINE = MergeTree ORDER BY hora;
```

`es_hora_pico` arranca en 0 en todas las filas y se recalcula tras el primer mes de ventas reales. Marcarlo por intuición sería inventar un dato, que es justo lo que prohíbe el Art. 5.6.

### Dimensiones copiadas desde PostgreSQL

```sql
CREATE TABLE dim_sucursal (
    sucursal_id       UInt64,
    nombre            String,
    zona              LowCardinality(String),
    estado            LowCardinality(String),
    opera_ventas      UInt8,                    -- de estado_sucursal (009)
    fecha_apertura    Nullable(Date),
    version           DateTime
) ENGINE = ReplacingMergeTree(version) ORDER BY sucursal_id;

CREATE TABLE dim_categoria (
    categoria_id      UInt64,
    nombre            LowCardinality(String),
    categoria_padre   LowCardinality(String),   -- desnormalizada a propósito, ver nota
    es_perecedero     UInt8,
    version           DateTime
) ENGINE = ReplacingMergeTree(version) ORDER BY categoria_id;

CREATE TABLE dim_producto (
    producto_id            UInt64,
    nombre                 String,
    categoria_id           UInt64,
    categoria              LowCardinality(String),
    categoria_padre        LowCardinality(String),
    unidad_venta           LowCardinality(String),
    permite_decimales      UInt8,
    es_fraccionable        UInt8,
    es_perecedero          UInt8,
    -- SCD tipo 2: viene de producto_clasificacion_historial (003)
    clasificacion          LowCardinality(String),   -- gancho / nicho
    margen_objetivo_min    Decimal(5,2),
    margen_objetivo_max    Decimal(5,2),
    valido_desde           DateTime,
    valido_hasta           Nullable(DateTime)
) ENGINE = MergeTree ORDER BY (producto_id, valido_desde);

CREATE TABLE dim_cliente (
    cliente_id         UInt64,
    -- SCD tipo 2: viene de segmento_cliente (002)
    segmento           LowCardinality(String),
    prioridad_comercial UInt8,
    version_modelo_id  UInt64,
    antiguedad_meses   UInt16,
    valido_desde       DateTime,
    valido_hasta       Nullable(DateTime)
) ENGINE = MergeTree ORDER BY (cliente_id, valido_desde);

CREATE TABLE dim_usuario (
    usuario_id       UInt64,
    nombre           String,
    rol              LowCardinality(String),
    nivel_jerarquico UInt8,
    alcance_cadena   UInt8,                     -- de rol (010)
    version          DateTime
) ENGINE = ReplacingMergeTree(version) ORDER BY usuario_id;

CREATE TABLE dim_proveedor (
    proveedor_id UInt64,
    nombre       String,
    activo       UInt8,
    version      DateTime
) ENGINE = ReplacingMergeTree(version) ORDER BY proveedor_id;

CREATE TABLE dim_causa_merma (
    codigo                   LowCardinality(String),
    etiqueta                 String,
    es_atribuible_a_persona  UInt8,
    requiere_investigacion   UInt8
) ENGINE = ReplacingMergeTree ORDER BY codigo;

CREATE TABLE dim_metodo_pago (
    codigo         LowCardinality(String),
    etiqueta       String,
    es_electronico UInt8
) ENGINE = ReplacingMergeTree ORDER BY codigo;

CREATE TABLE dim_canal_competencia (
    codigo                    LowCardinality(String),
    etiqueta                  String,
    frecuencia_monitoreo_dias UInt16
) ENGINE = ReplacingMergeTree ORDER BY codigo;

CREATE TABLE dim_fuente_competencia (
    fuente_id     UInt64,
    nombre        String,
    canal_codigo  LowCardinality(String),
    activo        UInt8,
    version       DateTime
) ENGINE = ReplacingMergeTree(version) ORDER BY fuente_id;

CREATE TABLE dim_evento_local (
    evento_id              UInt64,
    tipo                   LowCardinality(String),
    afecta_demanda_al_alza UInt8,
    fecha_inicio           Date,
    fecha_fin              Date,
    sucursal_id            Nullable(UInt64)     -- NULL = toda la cadena
) ENGINE = ReplacingMergeTree ORDER BY (evento_id, fecha_inicio);
```

**Sobre la desnormalización de `categoria_padre` en `dim_producto`**: en un modelo relacional sería un error; aquí es la práctica correcta. ClickHouse resuelve mucho mejor un filtro sobre una columna `LowCardinality` que un JOIN, y una dimensión existe para ser leída, no para garantizar integridad — esa garantía ya la da la FK en PostgreSQL. La regla del Art. 13 sobre texto libre **no se relaja**: el valor sigue viniendo del catálogo, solo que copiado.

**Sobre las dos dimensiones SCD tipo 2**: `dim_producto` y `dim_cliente` no usan `ReplacingMergeTree` porque no se reemplaza nada — cada versión histórica es una fila que debe conservarse. Se cargan leyendo directamente el rango de vigencia que ya guardan `producto_clasificacion_historial` y `segmento_cliente`; el ETL **no calcula ventanas**, las copia.

---

## 3. Tablas de hechos (9)

### `fact_venta_linea` — el hecho central

```sql
CREATE TABLE fact_venta_linea (
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
    cuenta_para_ingresos     UInt8,             -- de estado_venta (001)
    cantidad_venta           Decimal(10,3),
    cantidad_inventario      Decimal(10,3),
    precio_unitario          Decimal(10,2),
    subtotal_linea           Decimal(10,2),
    costo_reposicion_vigente Decimal(10,2),     -- CONGELADO en la carga, ver abajo
    margen_linea             Decimal(10,2),
    duracion_cobro_seg       Nullable(UInt32)
) ENGINE = MergeTree
PARTITION BY toYYYYMM(fecha)
ORDER BY (sucursal_id, fecha, producto_id);
```

**`costo_reposicion_vigente` es la decisión de diseño más importante de todo el modelo.** El ETL lo resuelve consultando `historial_costo_producto` (008) con la fecha de la venta y lo **congela** en la fila. Si el margen se recalculara después contra el costo actual, cada subida de precio de un proveedor distorsionaría todo el margen histórico hacia atrás y el KPI de OT1.1 (+8% trimestral) mediría algo que nunca ocurrió.

**`cuenta_para_ingresos` viene copiado del catálogo**, no reimplementado como `WHERE estado_venta <> 'anulada'` en cada consulta. Es exactamente lo que el Art. 13.4 busca: la regla se decide una vez.

`duracion_cobro_seg` sale de `fecha_hora - hora_inicio_cobro` (001, enmienda v1.1) y es nullable porque ese campo es opcional — una venta sin él no se descarta, simplemente no entra al promedio de OT2.2.

### Resto de hechos

```sql
CREATE TABLE fact_merma (
    fecha                   Date,
    merma_id                UInt64,
    sucursal_id             UInt64,
    producto_id             UInt64,
    causa                   LowCardinality(String),
    es_atribuible_a_persona UInt8,              -- copiado de dim_causa_merma
    resultado_investigacion Nullable(String),
    registrado_por          UInt64,
    cantidad                Decimal(10,3),
    valor_perdido           Decimal(10,2)
) ENGINE = MergeTree PARTITION BY toYYYYMM(fecha) ORDER BY (sucursal_id, fecha, causa);

CREATE TABLE fact_cuadre_caja (
    fecha            Date,
    hora             UInt8,
    turno_caja_id    UInt64,
    sucursal_id      UInt64,
    cajero_id        UInt64,
    es_checkpoint    UInt8,                     -- 1 = punto horario, 0 = cierre de turno
    monto_esperado   Decimal(10,2),
    monto_contado    Nullable(Decimal(10,2)),   -- NULL en los checkpoints horarios
    diferencia       Nullable(Decimal(10,2))
) ENGINE = MergeTree PARTITION BY toYYYYMM(fecha) ORDER BY (sucursal_id, cajero_id, fecha, hora);

CREATE TABLE fact_compra_recepcion (
    fecha              Date,
    recepcion_id       UInt64,
    orden_compra_id    UInt64,
    sucursal_id        UInt64,
    proveedor_id       UInt64,
    producto_id        UInt64,
    forma_pago         LowCardinality(String),
    dias_plazo         UInt16,                  -- de forma_pago (008)
    es_oferta          UInt8,
    siguio_pronostico  UInt8,
    cantidad_recibida  Decimal(10,3),
    costo_unitario     Decimal(10,2),
    dias_pedido_a_recepcion UInt16
) ENGINE = MergeTree PARTITION BY toYYYYMM(fecha) ORDER BY (proveedor_id, fecha, producto_id);

CREATE TABLE fact_demanda_insatisfecha (
    fecha                Date,
    hora                 UInt8,
    evento_id            UInt64,
    sucursal_id          UInt64,
    producto_id          UInt64,
    sustituto_ofrecido   UInt8,
    sustituto_aceptado   UInt8,
    cantidad_solicitada  Decimal(10,3)
) ENGINE = MergeTree PARTITION BY toYYYYMM(fecha) ORDER BY (sucursal_id, fecha, producto_id);

CREATE TABLE fact_cupon (
    fecha_envio      Date,
    cupon_id         UInt64,
    cliente_id       UInt64,
    tipo_origen      LowCardinality(String),
    es_automatico    UInt8,                     -- de tipo_origen_cupon (005)
    tipo_descuento   LowCardinality(String),
    valor_descuento  Decimal(10,2),
    fue_canjeado     UInt8,
    fecha_canje      Nullable(Date),
    venta_id_canje   Nullable(UInt64),
    dias_hasta_canje Nullable(UInt16)
) ENGINE = MergeTree PARTITION BY toYYYYMM(fecha_envio) ORDER BY (cliente_id, fecha_envio);

CREATE TABLE fact_stock_diario (
    fecha              Date,
    sucursal_id        UInt64,
    producto_id        UInt64,
    unidades           Decimal(10,3),
    valor_inventario   Decimal(12,2),           -- unidades × costo vigente de ese día
    stock_minimo       Decimal(10,3),
    bajo_minimo        UInt8,
    dias_sin_venta     UInt16,
    sin_rotacion       UInt8,
    dias_para_caducar  Nullable(Int32)          -- del lote más próximo; negativo = ya vencido
) ENGINE = MergeTree PARTITION BY toYYYYMM(fecha) ORDER BY (sucursal_id, fecha, producto_id);

CREATE TABLE fact_precio_competencia (
    fecha            Date,
    observacion_id   UInt64,
    producto_id      UInt64,
    fuente_id        UInt64,
    canal_codigo     LowCardinality(String),
    precio_propio    Decimal(10,2),
    precio_competencia Decimal(10,2),
    brecha_absoluta  Decimal(10,2),
    brecha_pct       Decimal(6,2),
    en_rango_competitivo UInt8
) ENGINE = MergeTree PARTITION BY toYYYYMM(fecha) ORDER BY (producto_id, fecha, fuente_id);

CREATE TABLE fact_auditoria (
    fecha        Date,
    hora         UInt8,
    evento_id    UInt64,
    usuario_id   Nullable(UInt64),
    rol          LowCardinality(String),
    accion       LowCardinality(String),
    recurso      LowCardinality(String),
    sucursal_id  Nullable(UInt64),
    exitoso      UInt8
) ENGINE = MergeTree PARTITION BY toYYYYMM(fecha) ORDER BY (fecha, usuario_id, exitoso);
```

**`fact_stock_diario` es un snapshot periódico, no transaccional.** El stock no es un evento, es un estado: para responder "cuánto capital tuve inmovilizado en marzo" (OT1.5) hace falta una foto diaria. Reconstruirlo hacia atrás desde los movimientos acumula error de redondeo y no distingue un ajuste de inventario de una venta.

Es el único hecho cuyo grano es *producto × sucursal × día* sin que exista una transacción detrás, y por eso es el que más filas genera. Se carga una vez al día, al cierre.

**`fact_auditoria` no tiene medida numérica.** Es un hecho de conteo puro: cada fila vale 1. Existe porque `log_auditoria` crece sin techo y es append-only (Art. 10.5) — agregarlo en caliente sobre PostgreSQL castigaría la operación.

---

## 4. Cobertura de los 17 informes compuestos

| OT | Informe compuesto | Hechos y dimensiones |
|---|---|---|
| OT1.1 | Margen real por categoría × sucursal × mes | `fact_venta_linea` × `dim_producto` (SCD2) × `dim_tiempo` |
| OT1.2 | % de merma sobre ventas por sucursal × mes | `fact_merma` + `fact_venta_linea` |
| OT1.3 | Costo de reposición promedio por SKU, periodo a periodo | `fact_compra_recepcion` × `dim_tiempo` |
| OT1.4 | Ticket promedio y frecuencia por segmento × mes | `fact_venta_linea` × `dim_cliente` (SCD2) |
| OT1.5 | Capital inmovilizado por sucursal × mes | `fact_stock_diario` |
| OT2.1 | % de productos en rango competitivo por categoría × canal × semana | `fact_precio_competencia` × `dim_fuente_competencia` |
| OT2.2 | Tiempo de cobro y adopción electrónica por sucursal × hora × día | `fact_venta_linea` × `dim_hora` × `dim_metodo_pago` |
| OT2.3 | % de cupones bien segmentados por segmento y disparador | `fact_cupon` × `dim_cliente` |
| OT2.4 | % de quiebres de stock por sucursal × semana | `fact_stock_diario` + `fact_demanda_insatisfecha` |
| OT2.5 | % de recuperación por cohorte de campaña | `fact_cupon` + `fact_venta_linea` |
| OT3.1 | Diferencia promedio por cajero × sucursal × franja | `fact_cuadre_caja` × `dim_hora` |
| OT3.2 | % de productos alertados con acción a tiempo | `fact_stock_diario` (`dias_para_caducar`) + `fact_merma` |
| OT3.4 | Patrón de merma por causa × cajero × sucursal × turno | `fact_merma` × `fact_cuadre_caja` — **filtra por `es_atribuible_a_persona`** |
| OT3.7 | Demanda insatisfecha por producto × semana, con confusores | `fact_demanda_insatisfecha` × `dim_evento_local` × `fact_cupon` |
| OT4.1 | Pronosticado vs. vendido real por producto × semana | `fact_venta_linea` + salida de los modelos |
| OT4.3 | Actividad crítica por usuario × sucursal × hora | `fact_auditoria` × `dim_usuario` × `dim_hora` |
| OT4.5 | *(consume los anteriores)* | El asistente lee informes ya materializados; no agrega por su cuenta (Art. 5.10) |

Los 6 OT que la tabla clasificó como **simples puros** (OT3.3, OT3.5, OT3.6, OT3.8, OT4.2, OT4.4) no tienen hecho aquí, y eso es correcto: se responden desde PostgreSQL. El caso de OT3.6 es el más claro — monitorear el pipeline desde dentro del propio pipeline sería circular.

---

## 5. Reglas de carga del pipeline (OT3.6)

1. **Incremental por sucursal y por fecha**, como exige el Art. 5.2. Cada DAG registra su corrida en `ejecucion_pipeline_etl` (011) al iniciar y al terminar.
2. **`dim_tiempo` y `dim_hora` se generan una sola vez**, en una tarea de inicialización del DAG. `dim_tiempo` se extiende una vez al año.
3. **Las dimensiones se cargan antes que los hechos.** Un hecho que referencia una dimensión aún no cargada produce un informe con huecos silenciosos.
4. **Los atributos copiados desde catálogos (`es_atribuible_a_persona`, `cuenta_para_ingresos`, `es_electronico`) se leen de PostgreSQL en cada corrida**, nunca se escriben como constantes en el DAG. Es la misma regla del Art. 13.4: una sola definición.
5. **Cada corrida registra sus validaciones** en `validacion_calidad_datos` (011). Mínimo: sin `producto_id` nulo, totales de `fact_venta_linea` cuadran contra PostgreSQL para el rango cargado, y ninguna fila de hecho referencia una dimensión inexistente.
6. **Reprocesar un día es idempotente**: se borra la partición del mes afectado y se recarga. Por eso los hechos van particionados por mes y las dimensiones usan `ReplacingMergeTree`.

---

## 6. Lo que queda pendiente

- **Los valores de `es_hora_pico`** en `dim_hora` se calibran con el primer mes de ventas reales. Hasta entonces quedan en 0: marcarlos por intuición sería inventar un dato (Art. 5.6).
- **El `nombre_feriado`** del calendario ecuatoriano se carga junto con la generación de `dim_tiempo`; los eventos locales propios (fiesta patronal del barrio) entran por `evento_local` conforme se registren.
- **El DAG en sí** (código de Airflow) es tarea de implementación, no de este documento — aquí queda el destino, no el transporte.

*Esquema derivado de los 17 informes compuestos de `informes-simples-vs-compuestos.md` y de los 11 `data-model.md` tras la enmienda de catálogos. Ninguna dimensión inventa un vocabulario: todas copian el catálogo que ya existe en PostgreSQL.*
