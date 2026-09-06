# El Kiosquito — Capa táctica (ETL + ClickHouse + Airflow)

Pipeline ETL que mueve datos de PostgreSQL (capa operativa, `../backend`)
hacia ClickHouse (`elkiosquito_dw`, columnar) siguiendo el modelo
dimensional documentado en `clickhouse-fact-dim.md` (12 dimensiones, 9
hechos) — la base de los 17 informes compuestos identificados en
`informes-simples-vs-compuestos.md` (los 23 informes simples se sirven
directo desde PostgreSQL, no pasan por acá).

**Probado end-to-end contra Postgres y ClickHouse reales**: carga
completa de 12 dimensiones + 9 hechos, idempotencia verificada
(reprocesar el mismo rango de fechas dos veces no duplica ninguna fila),
3 validaciones de calidad aprobadas, y las dos tareas del DAG de Airflow
corridas de punta a punta con `airflow tasks test` (no solo parseadas)
contra una instancia real del backend vía la API 011. **Además, validado
con el stack completo de `docker-compose.yml` levantado de verdad**
(`clickhouse-server:24.8`, Airflow 2.10.3 en contenedores), incluyendo un
backfill real con datos sembrados (`airflow dags backfill
etl_el_kiosquito_diario -s 2026-08-10 -e 2026-08-11` → `fact_venta_linea`
con las 3 filas esperadas). Dos bugs reales que solo aparecen contra
Docker (no contra los motores nativos del sandbox de desarrollo) se
documentan más abajo.

## Estructura

- `ddl/001_dimensiones.sql`, `ddl/002_hechos.sql` — esquema de
  `elkiosquito_dw`. Se auto-aplican al levantar ClickHouse con
  `docker-compose.yml` (`docker-entrypoint-initdb.d`).
- `etl/` — paquete Python (extract-transform-load). `main.py` orquesta
  el ciclo completo; `dim_tiempo.py` genera `dim_tiempo`/`dim_hora` (las
  únicas 2 dimensiones sin fuente en PostgreSQL); `dimensiones.py` y
  `hechos.py` cargan las 10 dimensiones y 9 hechos restantes;
  `validaciones.py` corre las 3 validaciones de calidad de cada corrida;
  `pipeline_api.py` registra ejecuciones y validaciones contra la API
  011 del backend (nunca por SQL directo — pasa por las mismas reglas
  de negocio y RBAC que cualquier otro cliente).
- `dags/etl_el_kiosquito.py` — DAG diario (`etl_el_kiosquito_diario`,
  carga incremental de un día) y dos DAGs mensuales:
  `etl_el_kiosquito_recalibracion_hora_pico` (recalibra
  `dim_hora.es_hora_pico` — separado del diario a propósito, ver
  docstring del módulo) y `etl_el_kiosquito_modelos_ml` (reentrena y
  registra los 5 modelos de `ml/`, ver sección propia más abajo).
- `ml/` — los 5 modelos scikit-learn del Art. 5.6 (capa estratégica).
  Sección propia más abajo.
- `scripts/crear_cuenta_servicio_etl.py` — crea la cuenta de servicio
  (rol `dueno`) contra la que se autentica el ETL. La corre
  automáticamente el servicio `etl-bootstrap` de `docker-compose.yml`.
- `tests/seed_test_data.sql` — datos de prueba (IDs 901-905) que
  ejercitan las 9 tablas de hecho y las 10 dimensiones con fuente en
  PostgreSQL, incluyendo las transiciones SCD2 de `dim_producto` y
  `dim_cliente`.

## Levantar todo con Docker Compose

```bash
cp ../.env.example ../.env   # completar contraseñas
docker compose -f ../docker-compose.yml up -d --build
```

Esto levanta: Postgres operativo + backend (corre `alembic upgrade
head` solo), ClickHouse (con el DDL de `ddl/` ya aplicado), la cuenta de
servicio del ETL, y Airflow (metastore propio, `LocalExecutor`,
webserver en `:8080` con usuario `admin`/`admin` — cambiarlo en cuanto
se entra). Los dos DAGs quedan visibles y programados
(`etl_el_kiosquito_diario` a las 05:00 UTC = 00:00 Ecuador,
`etl_el_kiosquito_recalibracion_hora_pico` el día 1 de cada mes).

## Correr sin Docker (como se probó durante el desarrollo)

Útil para iterar rápido o cuando no hay Docker disponible (fue el caso
del sandbox donde se construyó esto: sin daemon de Docker, ClickHouse se
instaló nativo vía `apt` para las pruebas).

```bash
pip install -r requirements.txt   # + los requirements.txt del backend

export POSTGRES_DSN="postgresql://elkiosquito:elkiosquito_dev@localhost:5432/elkiosquito"
export CLICKHOUSE_HOST=localhost
export CLICKHOUSE_NATIVE_PORT=9000
export CLICKHOUSE_DATABASE=elkiosquito_dw

# aplicar el DDL una vez:
clickhouse-client --database=elkiosquito_dw --multiquery < ddl/001_dimensiones.sql
clickhouse-client --database=elkiosquito_dw --multiquery < ddl/002_hechos.sql

# opcional, para probar con datos:
psql "$POSTGRES_DSN" -f tests/seed_test_data.sql

# corrida manual, sin registrar en la API 011:
python -m etl.main --desde 2026-08-01 --hasta 2026-09-05 --sin-api

# con la API 011 (requiere el backend corriendo y la cuenta de servicio creada):
export API_BASE_URL="http://localhost:8000/api/v1"
export API_SERVICE_EMAIL="etl@elkiosquito.local"
export API_SERVICE_PASSWORD="..."
python -m etl.main --desde 2026-08-01 --hasta 2026-09-05
```

## Capa estratégica — Modelos de ML (Art. 5.6)

`ml/` — 5 modelos scikit-learn, ni uno más ni uno menos (el Art. 5.6
prohíbe deep learning o servicios de inferencia externos). Cada uno
extrae features de datos reales (ClickHouse para 4 de ellos, PostgreSQL
directo para `churn`), entrena, y reporta el resultado a
`POST /analitica/modelos/versiones` (011-analitica-reportes) —
**nunca decide por su cuenta si la versión queda `activo` o
`descartado_datos_insuficientes`**: eso lo hace el propio endpoint
comparando `tamano_muestra` contra `modelo_ml.tamano_muestra_minimo`
(RN-AR-002, regla de honestidad del Art. 5.9). Ningún script de `ml/`
escribe en otra tabla operativa (`segmento_cliente`,
`recomendacion_precio`, `incidencia_cuadre_caja`) — 011 documenta
explícitamente que ese cómputo está fuera de su alcance; `ml/` solo
registra la METADATA de cada versión de modelo.

| Modelo | Algoritmo | Métrica | Fuente | Alimenta |
|---|---|---|---|---|
| `demanda` | RandomForestRegressor | MAE | ClickHouse | 004-pronóstico-demanda |
| `pricing` | RandomForestRegressor | MAE | ClickHouse | 003-promociones (pricing dinámico) |
| `churn` | RandomForestClassifier | F1 | **PostgreSQL** | 002-clientes-fidelización |
| `anomalias_caja` | IsolationForest | F1 | ClickHouse | 006-caja-mermas-fraude |
| `segmentacion_clientes` | KMeans (k=3) + silhouette | silhouette | ClickHouse | 002-clientes-fidelización |

Decisiones de honestidad específicas de esta capa (además de las reglas
generales de la tabla de abajo):

- **`churn` es el único que entrena contra PostgreSQL, no ClickHouse.**
  Su etiqueta real (`evaluacion_churn.es_riesgo_real` — "riesgo real de
  abandono" vs. "ciclo normal de compra", Art. 4.6) es una decisión
  operativa de 002 que nunca se replicó a `elkiosquito_dw` (correcto:
  no es un hecho analítico, es la salida de un proceso de negocio). Las
  features de comportamiento sí se toman de `segmento_cliente`, pero de
  la fila vigente **en la fecha de cada evaluación**, nunca la vigente
  hoy — evaluar con el estado actual del cliente distorsionaría una
  evaluación pasada.
- **`anomalias_caja` no tiene todavía ninguna incidencia confirmada
  contra la cual medir un F1 real** (`incidencia_cuadre_caja` es
  append-only, la genera el propio sistema, y no hay ninguna fila en
  ningún ambiente). Mientras eso no exista, el F1 se calcula contra un
  PROXY explícito y documentado en el propio script
  (`diferencia_abs > 0` = posible anomalía) — no un dato inventado, la
  mejor señal disponible hoy. El día que existan incidencias con
  `estado` resuelto, ese debe reemplazar el proxy.
- **`demanda` completa la grilla (fecha × sucursal × producto) con cero
  donde no hubo venta** — un día sin venta es una observación real de
  demanda cero, no un hueco a descartar; `tamano_muestra` reportado es
  el tamaño de esa grilla completa, no solo las filas con venta.
- Los 5 scripts comparten el mismo umbral de `len(dataset) < 10` antes
  de intentar entrenar (además del `tamano_muestra_minimo` de 30 que
  aplica el servidor) — con menos de 10 filas ni siquiera un
  `train_test_split` tiene sentido; se reporta la muestra real igual,
  nunca se infla para forzar un `valor_metrica`.

**Reentrenamiento**: mensual (`etl_el_kiosquito_modelos_ml` en
`dags/etl_el_kiosquito.py`, `@monthly` — misma razón que
`recalibrar_hora_pico`: el volumen de datos no cambia noche a noche, y
reentrenar cada noche solo generaría versiones ruidosas en
`version_modelo_ml`). Standalone, sin Airflow:

```bash
# requiere el backend corriendo y la cuenta de servicio del ETL creada
# (mismas variables de entorno que etl/main.py, ver arriba)
python -m ml.main --todos                 # los 5, registrando en la API 011
python -m ml.main --modelo demanda         # uno solo
python -m ml.main --todos --sin-api        # solo entrenar y loguear, sin llamar a la API
```

**Probado end-to-end contra Postgres y ClickHouse reales** (incluyendo
un ciclo completo con datos sintéticos temporales para forzar el
camino "con datos suficientes" de los 5 algoritmos —
RandomForestRegressor, RandomForestClassifier, IsolationForest,
KMeans+StandardScaler+silhouette — y verificar que efectivamente
entrenan sin errores de forma/tipo, no solo que el código compila).
Con el volumen real de `tests/seed_test_data.sql` (los mismos datos que
usa el resto del proyecto, sin inflar nada), el estado real observado
es:

- `demanda`: **`activo`**, MAE real ≈ 0.15 (92 filas de grilla,
  ≥ 30 mínimo).
- `pricing`, `anomalias_caja`, `segmentacion_clientes`:
  **`descartado_datos_insuficientes`** — el `motivo` lo genera la
  propia API, no este README.
- `churn`: local `sin_datos` (`evaluacion_churn` empieza vacía en un
  sistema nuevo — nadie la siembra en `tests/seed_test_data.sql` a
  propósito: es la salida de un proceso de negocio, no un dato
  maestro).

Esto es el comportamiento CORRECTO del Art. 5.9 dado el volumen actual
de datos sembrados, no un bug a corregir inflando datos artificialmente.
Se espera que más modelos pasen a `activo` a medida que el negocio (o
más pruebas con datos reales) acumule volumen ≥ 30 en cada fuente.
También se verificó RN-AR-001 (una sola versión `activo` por modelo a
la vez): reentrenar `demanda` una segunda vez deja la versión anterior
en `reemplazado` automáticamente.

## Decisiones de diseño (encontradas o confirmadas probando contra
motores reales, no solo leyendo el documento de arquitectura)

- **`fact_auditoria.usuario_id` es `UInt64` (no `Nullable`)**, con `0`
  como centinela de "sin usuario autenticado" (login fallido). ClickHouse
  prohíbe columnas `Nullable` en la clave de orden (`Sorting key cannot
  contain nullable columns`) — limitación real del motor, no de la
  versión vieja usada en desarrollo.
- **`dim_sucursal` no tiene columna `zona`**: no existe esa fuente en
  PostgreSQL (`sucursal`, 009-expansion-sucursales nunca tuvo un campo
  geográfico así) — el ETL copia dimensiones, no las inventa.
- **`fact_demanda_insatisfecha` no tiene `cantidad_solicitada`**: la
  tabla origen (`demanda_insatisfecha`, 004) no tiene columna de
  cantidad — cada fila ya es un evento de quiebre de stock; los reportes
  deben `count()` filas, no sumar una cantidad inventada.
- **`ALTER TABLE ... DROP PARTITION` va sin comillas** cuando la clave
  de partición es numérica (`toYYYYMM(fecha)`, `UInt32`) — pasarla como
  string literal revienta con `Type mismatch ... Expected: UInt32. Got:
  String`.
- **`ALTER TABLE ... UPDATE` es una mutación asíncrona** en ClickHouse
  (`es_feriado`, `es_hora_pico`): una lectura inmediatamente después
  puede ver los datos todavía sin actualizar. `ClienteClickHouse.
  mutacion_sincrona` (`etl/db.py`) intenta forzar `mutations_sync=1` y,
  si el servidor no soporta esa setting (ClickHouse < ~19.x), hace
  fallback a sondear `system.mutations` hasta `is_done=1` — funciona en
  ambas versiones.
- **`producto_clasificacion_historial` es obligatoria para todo
  producto vendible**: `cargar_dim_producto` hace `INNER JOIN` contra
  esa tabla (todo producto debe tener clasificación vigente desde su
  alta) — un producto sembrado sin esa fila queda fuera de `dim_producto`
  aunque tenga ventas reales, y lo detecta la propia validación
  `dimensiones_referenciadas` (productos huérfanos).
- **`creado_en` de `cliente` no puede quedar en su default (`now()`)**
  si se van a cargar `segmento_cliente` con `fecha_calculo` en el
  pasado: `antiguedad_meses` se vuelve negativo y ClickHouse rechaza el
  valor (`UInt16`, `ushort format requires 0 <= number <= 65535`) en vez
  de truncarlo. `cargar_dim_cliente` ahora aplica `GREATEST(..., 0)`
  como salvaguarda de tipo (no un dato inventado — antigüedad negativa
  no puede ocurrir en un caso real).
- **`recalibrar_hora_pico` no corre en el DAG diario**: es una
  calibración estadística sobre el histórico acumulado, pensada para
  estabilizarse — recalcularla cada noche haría ruido en
  `dim_hora.es_hora_pico` sin que el patrón de negocio cambie tanto. Vive
  en su propio DAG mensual.
- **`CLICKHOUSE_DB` no alcanza para que `docker-entrypoint-initdb.d`
  cree las tablas en esa base** (bug real, encontrado recién al levantar
  `docker-compose.yml` de verdad — no aparece contra el ClickHouse
  nativo del sandbox, donde `ddl/*.sql` se aplicaba manualmente con
  `--database=elkiosquito_dw`): sin un `USE elkiosquito_dw` explícito al
  inicio de cada archivo, las 21 tablas se crean en `default` en vez de
  `elkiosquito_dw`, y el ETL (que sí se conecta a `elkiosquito_dw`) no
  las encuentra. Cada archivo de `docker-entrypoint-initdb.d` corre en su
  propia sesión de `clickhouse-client`, así que el preámbulo
  (`CREATE DATABASE IF NOT EXISTS elkiosquito_dw; USE elkiosquito_dw;`)
  se repite igual en `ddl/001_dimensiones.sql` y `ddl/002_hechos.sql`.
- **El usuario `default` de ClickHouse necesita una contraseña
  explícita contra la imagen oficial** (otro bug que solo aparece contra
  Docker real): dejarlo sin contraseña — el default de
  `etl/config.py`, pensado para el ClickHouse nativo del sandbox de
  desarrollo — hace que `clickhouse-driver` (el cliente Python que usa
  el ETL) falle con `Code: 516. Authentication failed`, aunque
  `clickhouse-client` sí conecte sin problema. Se corrigió fijando
  `CLICKHOUSE_PASSWORD` en `docker-compose.yml`, desde la misma variable
  de `.env`, tanto en el servicio `clickhouse` (para que la imagen
  configure esa contraseña de verdad) como en `x-airflow-common-env`
  (para que el ETL la use al conectarse) — así los dos lados nunca
  pueden desincronizarse.
