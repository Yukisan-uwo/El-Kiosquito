# Guía de Arranque: Clientes y Fidelización

**Feature**: `002-clientes-fidelizacion` | **Fecha**: 2026-09-04

## Requisitos previos

- Docker Compose con `postgres`/`api` levantados, migraciones de `usuario`, `parametro_sistema` y `001-core-ventas-inventario` aplicadas
- Un cliente con algunas ventas ya registradas en `001-core-ventas-inventario`

## Levantar el entorno

```bash
docker compose up -d postgres api
docker compose exec api alembic upgrade head
```

## Flujo de prueba manual

### 1. Registrar cliente y consultar historial (RF-CF-001, RF-CF-002)

```bash
curl -X POST http://localhost:8000/api/v1/clientes \
  -H "Authorization: Bearer $TOKEN_FIDELIZACION" -H "Content-Type: application/json" \
  -d '{"nombre": "María Cevallos", "contacto": "0987654321", "fecha_nacimiento": "1990-09-10"}'

curl "http://localhost:8000/api/v1/clientes/<cliente_id>/historial-compras" -H "Authorization: Bearer $TOKEN_FIDELIZACION"
```

### 2. Ciclo de segmentación (RF-CF-003, RF-CF-007, RF-CF-008/009 enmienda v1.1)

```bash
# Primero, ver qué segmentos existen y con qué prioridad comercial
curl "http://localhost:8000/api/v1/catalogos/segmentos" \
  -H "Authorization: Bearer $TOKEN_SISTEMA"

curl -X POST http://localhost:8000/api/v1/fidelizacion/segmentos \
  -H "Authorization: Bearer $TOKEN_SISTEMA" -H "Content-Type: application/json" \
  -d '{
    "cliente_id": "<cliente_id>",
    "segmento_codigo": "frecuente_bajo_margen",
    "version_modelo_id": "<version_modelo_id>",
    "tamano_muestra": 87,
    "periodo_inicio": "2026-06-01",
    "periodo_fin": "2026-08-31"
  }'
```

El `version_modelo_id` sale de `011-analitica-reportes` (la versión activa del modelo de segmentación). Respuesta esperada: `201` con `vigente_hasta: null`.

**Pruebas negativas:**

- Repetir con `"segmento_codigo": "frecuente"` (que no está en el catálogo) → `404` (RF-CF-008: ya no se puede inventar un segmento escribiéndolo).
- Repetir sin `version_modelo_id` → `422` (RF-CF-009).
- Consultar el segmento de un cliente sin ciclo registrado → declara explícitamente "sin datos suficientes".

### 2b. Comprobar la dimensión SCD tipo 2 (RF-CF-010, RN-CF-002/003, enmienda v1.1)

```bash
# Segundo ciclo para el mismo cliente, con otro segmento
curl -X POST http://localhost:8000/api/v1/fidelizacion/segmentos \
  -H "Authorization: Bearer $TOKEN_SISTEMA" -H "Content-Type: application/json" \
  -d '{"cliente_id": "<cliente_id>", "segmento_codigo": "leal_alto_margen", "version_modelo_id": "<version_modelo_id>", "tamano_muestra": 91, "periodo_inicio": "2026-09-01", "periodo_fin": "2026-11-30"}'

curl "http://localhost:8000/api/v1/clientes/<cliente_id>/segmento/historial" \
  -H "Authorization: Bearer $TOKEN_FIDELIZACION"
```

Respuesta esperada del historial: **dos** asignaciones. La primera con `vigente_hasta` ya cerrado (la fecha del segundo ciclo), la segunda con `vigente_hasta: null`. Ese par de rangos es literalmente la dimensión SCD tipo 2 que consume el ETL de `011-analitica-reportes` — no hay que calcular nada, está guardado.

**Prueba negativa contra la base, no contra la API** (esta es la que importa):

```bash
docker compose exec postgres psql -U kiosquito -c \
  "INSERT INTO segmento_cliente (cliente_id, segmento_codigo, version_modelo_id, tamano_muestra, periodo_inicio, periodo_fin, vigente_hasta)
   VALUES (<cliente_id>, 'ocasional', <version_modelo_id>, 50, '2026-09-01', '2026-11-30', NULL);"
```

Debe fallar con violación de índice único: ese cliente ya tiene una asignación con `vigente_hasta IS NULL` (RN-CF-002). Es la prueba de que la regla vive en el esquema y no solo en el servicio — si viviera solo en el código, este `INSERT` pasaría y el historial quedaría corrupto sin que nadie se entere.

### 3. Evaluación de churn y campaña de recuperación (RF-CF-004, RF-CF-005, RN-CF-001)

```bash
curl -X POST http://localhost:8000/api/v1/fidelizacion/evaluaciones-churn \
  -H "Authorization: Bearer $TOKEN_SISTEMA" -H "Content-Type: application/json" \
  -d '{"cliente_id": "<cliente_id>", "es_riesgo_real": true, "dias_sin_compra_al_momento": 52, "frecuencia_historica_dias": 20, "justificacion": "52 días vs. ciclo histórico de 20 días", "tamano_muestra": 87}'

curl -X POST http://localhost:8000/api/v1/fidelizacion/campanas-recuperacion \
  -H "Authorization: Bearer $TOKEN_FIDELIZACION" -H "Content-Type: application/json" \
  -d '{"cliente_id": "<cliente_id>", "evaluacion_churn_id": "<evaluacion_id>"}'
```

**Prueba negativa:** si el cliente ya registró una venta después de la evaluación, este `curl` responde `409` (RN-CF-001).

### 4. Consultar recuperación (RF-CF-006)

```bash
curl "http://localhost:8000/api/v1/fidelizacion/campanas-recuperacion/<campana_id>/resultado" -H "Authorization: Bearer $TOKEN_FIDELIZACION"
```

## Siguiente paso

`005-promociones-inteligentes` puede vincular un `cupon_id` a esta campaña de recuperación.
