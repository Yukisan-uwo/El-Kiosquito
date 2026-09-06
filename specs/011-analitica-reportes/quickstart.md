# Guía de Arranque: Analítica y Reportes (BI)

**Feature**: `011-analitica-reportes` | **Fecha**: 2026-09-04

## Requisitos previos

- Docker Compose funcionando con `postgres` y `api`
- `010-administracion` levantado (para autenticar como Dueño y probar el acceso exclusivo al asistente)
- No requiere Airflow/ClickHouse realmente corriendo para probar este módulo de forma aislada — los `curl` de este quickstart simulan las llamadas que Airflow y los scripts de entrenamiento harían en producción

## Levantar el entorno

```bash
cd "Proyecto El Kiosquito"
docker compose up -d postgres api
docker compose exec api alembic upgrade head
```

## Flujo de prueba manual (cubre los escenarios de aceptación de `spec.md`)

### 1. Registrar una ejecución del pipeline ETL (RF-AR-001)

```bash
curl -X POST http://localhost:8000/api/v1/analitica/pipeline/ejecuciones \
  -H "Authorization: Bearer $TOKEN_SISTEMA" \
  -H "Content-Type: application/json" \
  -d '{"dag_run_id": "elkiosquito_etl_2026-09-04T06:00:00", "estado": "exitoso", "sucursales_procesadas": 3, "filas_cargadas": 15420}'
```

### 2. Consultar el estado del último ciclo (RF-AR-002)

```bash
curl "http://localhost:8000/api/v1/analitica/pipeline/estado" \
  -H "Authorization: Bearer $TOKEN_DUENO"
```

### 3. Registrar una validación de calidad de datos (RF-AR-005)

```bash
curl -X POST http://localhost:8000/api/v1/analitica/pipeline/validaciones \
  -H "Authorization: Bearer $TOKEN_SISTEMA" \
  -H "Content-Type: application/json" \
  -d '{"ejecucion_id": "<ejecucion_id>", "regla_validada": "totales_cuadran_vs_postgres", "aprobado": true}'
```

### 4. Registrar una versión de modelo con datos suficientes (RF-AR-003, CA-AR-002)

```bash
curl -X POST http://localhost:8000/api/v1/analitica/modelos/versiones \
  -H "Authorization: Bearer $TOKEN_SISTEMA" \
  -H "Content-Type: application/json" \
  -d '{"modelo": "churn", "version": "2026.09.04-a", "tamano_muestra": 480, "periodo_inicio": "2026-06-01", "periodo_fin": "2026-09-01", "nombre_metrica": "F1", "valor_metrica": 0.78}'
```

Respuesta esperada: `estado: "activo"`.

### 5. Registrar una segunda versión del mismo modelo y verificar el reemplazo (CA-AR-002)

```bash
curl -X POST http://localhost:8000/api/v1/analitica/modelos/versiones \
  -H "Authorization: Bearer $TOKEN_SISTEMA" \
  -H "Content-Type: application/json" \
  -d '{"modelo": "churn", "version": "2026.09.11-a", "tamano_muestra": 512, "periodo_inicio": "2026-06-08", "periodo_fin": "2026-09-08", "nombre_metrica": "F1", "valor_metrica": 0.81}'

curl "http://localhost:8000/api/v1/analitica/modelos/churn/metricas" \
  -H "Authorization: Bearer $TOKEN_DUENO"
```

La segunda versión debe devolverse como `estado: "activo"`; una consulta directa a la base de datos debe mostrar la primera versión (`2026.09.04-a`) ahora como `estado: "reemplazado"`.

### 6. Registrar una versión con datos insuficientes (CA-AR-001)

```bash
curl -X POST http://localhost:8000/api/v1/analitica/modelos/versiones \
  -H "Authorization: Bearer $TOKEN_SISTEMA" \
  -H "Content-Type: application/json" \
  -d '{"modelo": "anomalias_caja", "version": "2026.09.04-a", "tamano_muestra": 12, "periodo_inicio": "2026-08-28", "periodo_fin": "2026-09-04", "nombre_metrica": "F1", "valor_metrica": null}'
```

Respuesta esperada: `estado: "descartado_datos_insuficientes"`, con `motivo` explicando el umbral no alcanzado; `GET /analitica/modelos/anomalias_caja/metricas` debe responder `404` (ningún modelo activo).

### 7. Preguntar al asistente conversacional, exclusivo del Dueño (RF-AR-006, CA-AR-003)

```bash
curl -X POST http://localhost:8000/api/v1/analitica/asistente/preguntas \
  -H "Authorization: Bearer $TOKEN_DUENO" \
  -H "Content-Type: application/json" \
  -d '{"pregunta_texto": "¿Qué sucursal tuvo más merma esta semana?", "consulta_generada": "SELECT sucursal_id, SUM(valor) FROM merma WHERE fecha >= now() - interval 7 day GROUP BY sucursal_id ORDER BY 2 DESC LIMIT 1", "respuesta_texto": "La Alborada, con $142.30 en mermas esta semana."}'
```

**Prueba negativa:** repetir el mismo `curl` con `$TOKEN_CAJERO` (u otro rol distinto de `dueno`) debe responder `403` (RNF-AR-003).

### 8. Consultar el historial del asistente (RF-AR-007)

```bash
curl "http://localhost:8000/api/v1/analitica/asistente/preguntas" \
  -H "Authorization: Bearer $TOKEN_DUENO"
```

### Catálogos del módulo (RF-AR-008/009/010, RN-AR-004, enmienda v1.1)

```bash
curl "http://localhost:8000/api/v1/catalogos/modelos-ml" -H "Authorization: Bearer $TOKEN_DUENO"
```

Cada modelo debe traer su `algoritmo`, su `metrica_principal`, su `tamano_muestra_minimo` y el `modulo_consumidor` que usa su salida. Eso último responde "si retiro este modelo, ¿qué se rompe?" sin leer los 11 documentos.

**La prueba que antes no fallaba** (RN-AR-004):

```bash
curl -X POST http://localhost:8000/api/v1/analitica/modelos/versiones \
  -H "Authorization: Bearer $TOKEN_SISTEMA" -H "Content-Type: application/json" \
  -d '{"modelo": "churn", "version": "2026.09.04-a", "estado": "activo", "tamano_muestra": 500,
       "periodo_inicio": "2026-06-01", "periodo_fin": "2026-08-31",
       "nombre_metrica": "silhouette", "valor_metrica": 0.62}'
```

Debe responder `422`: `silhouette` es una métrica de clustering y el modelo de churn es una clasificación — su `metrica_principal` es `F1`. **Antes de la enmienda v1.1 esto devolvía `201`**, y peor: comparar el desempeño de dos versiones del mismo modelo solo tiene sentido si ambas usan la misma métrica, así que una versión mal etiquetada envenena la comparación sin lanzar ningún error. Con `"nombre_metrica": "F1"` → `201`.

**El umbral de muestra ahora vive en la base** (Decisión 6B):

```bash
# Registrar una versión por debajo del umbral del catálogo → queda descartada, con motivo
# Luego, cambiar el umbral sin tocar código:
docker compose exec postgres psql -U kiosquito -c \
  "UPDATE modelo_ml SET tamano_muestra_minimo = 100 WHERE codigo = 'churn';"
```

Repetir el mismo registro con el mismo `tamano_muestra`: el resultado cambia, sin desplegar nada. Antes ese umbral era un diccionario en `services/analitica.py`, así que la respuesta a "¿por qué se descartó esta versión?" vivía en un archivo Python que nadie audita junto con los datos. El Art. 5.9 no solo exige descartar cuando los datos no alcanzan: exige **documentar por qué**, y ahora el umbral y el `motivo` están en la misma base.

**Pruebas negativas:**

- Registrar una versión con un `modelo` que no está en el catálogo → `404`.
- Buscar un `POST` o `PATCH` sobre cualquiera de los tres catálogos → no existe (RN-AR-005).
- Insertar un sexto modelo en `modelo_ml` **no** lo incorpora al sistema: los cinco son los del Art. 5.6 y sumar otro exige enmendar la constitución (RN-AR-006). El catálogo saca los códigos del CHECK; no relaja la constitución.

## Siguiente paso

Con los 11 módulos de `Proyecto El Kiosquito/specs/` completos (001 a 011), el siguiente paso natural es empezar la implementación real siguiendo el orden de `tasks.md` de cada módulo, comenzando por `010-administracion` (base de autenticación y del catálogo `rol`, del que ahora depende `usuario` en todos los módulos) y `009-expansion-sucursales` (base de `sucursal`), de los que dependen los demás.
