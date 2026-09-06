# Guía de Arranque: Prevención de Pérdidas y Seguridad

**Feature**: `006-prevencion-perdidas-seguridad` | **Fecha**: 2026-09-04

## Requisitos previos

- Docker Compose funcionando con `postgres` y `api` (ver `docker-compose.yml` en la raíz de `Proyecto El Kiosquito/`)
- Migraciones de `producto`, `sucursal`, `usuario`, y de `001-ventas-y-caja` (`turno_caja`, `alerta_fraude_pago`) ya aplicadas
- Al menos un turno de caja cerrado con diferencia, y una alerta de fraude en pago ya registrada por `001-ventas-y-caja`, para probar los flujos cruzados

## Levantar el entorno

```bash
cd "Proyecto El Kiosquito"
docker compose up -d postgres api
docker compose exec api alembic upgrade head
```

## Flujo de prueba manual (cubre los escenarios de aceptación de `spec.md`)

### 1. Registrar una merma sin causa todavía (RF-PP-001)

```bash
curl -X POST http://localhost:8000/api/v1/perdidas/mermas \
  -H "Authorization: Bearer $TOKEN_PERDIDAS" \
  -H "Content-Type: application/json" \
  -d '{"producto_id": "<producto_id>", "sucursal_id": "<sucursal_id>", "cantidad": 3, "valor_estimado": 4.50}'
```

### 2. Asignar la causa (RF-PP-002)

```bash
curl -X PATCH http://localhost:8000/api/v1/perdidas/mermas/<merma_id>/causa \
  -H "Authorization: Bearer $TOKEN_PERDIDAS" \
  -H "Content-Type: application/json" \
  -d '{"causa": "error_humano"}'
```

### 3. Registrar el resultado de la investigación (RF-PP-008, RN-PP-001)

```bash
curl -X PATCH http://localhost:8000/api/v1/perdidas/mermas/<merma_id>/resultado \
  -H "Authorization: Bearer $TOKEN_PERDIDAS" \
  -H "Content-Type: application/json" \
  -d '{"resultado_investigacion": "confirmada"}'
```

**Prueba negativa:** repetir el paso 3 sobre una merma recién creada (sin pasar por el paso 2) → debe responder `422` (RN-PP-001).

### 4. Registrar una incidencia de cuadre de caja (RF-PP-005)

```bash
curl -X POST http://localhost:8000/api/v1/perdidas/incidencias-cuadre \
  -H "Authorization: Bearer $TOKEN_SISTEMA" \
  -H "Content-Type: application/json" \
  -d '{
    "turno_caja_id": "<turno_caja_id>",
    "score_anomalia": 0.87,
    "justificacion": "diferencia atípica frente al patrón histórico del mismo cajero en los últimos 30 turnos"
  }'
```

**Prueba negativa:** repetir el mismo `curl` con el mismo `turno_caja_id` → debe responder `409` (índice único parcial, Decisión 1).

Verificar aparte que `GET /caja/turnos/<turno_caja_id>` (endpoint de `001-ventas-y-caja`) no cambió — esta incidencia nunca toca `turno_caja`.

### 5. Registrar y revisar un datáfono (RF-PP-006, RF-PP-009)

```bash
curl -X POST http://localhost:8000/api/v1/perdidas/datafonos \
  -H "Authorization: Bearer $TOKEN_PERDIDAS" \
  -H "Content-Type: application/json" \
  -d '{"sucursal_id": "<sucursal_id>", "codigo_serie": "DTF-0042"}'

curl -X POST http://localhost:8000/api/v1/perdidas/datafonos/<datafono_id>/revisiones \
  -H "Authorization: Bearer $TOKEN_PERDIDAS" \
  -H "Content-Type: application/json" \
  -d '{"estado": "actualizado", "observaciones": "firmware actualizado en visita del proveedor"}'
```

**Prueba negativa:** consultar el estado de un datáfono recién creado, antes de registrar ninguna revisión → debe declarar explícitamente que no hay revisión registrada.

### 6. Atender una alerta de fraude en pago (RF-PP-007, RN-PP-002)

```bash
curl -X PATCH http://localhost:8000/api/v1/alertas-fraude-pago/<alerta_id>/atender \
  -H "Authorization: Bearer $TOKEN_PERDIDAS" \
  -H "Content-Type: application/json" \
  -d '{"codigo_respuesta_proveedor": "revisado, transacción legítima confirmada con el cliente"}'
```

**Prueba negativa:** repetir el mismo `curl` sobre la misma alerta → debe responder `422` (RN-PP-002).

## Validación de scoping por sucursal (Art. 3.3 de la constitución)

Un token de Encargado de Sucursal contra `GET /perdidas/mermas` filtrando por una sucursal distinta a la suya debe responder `403`.

## Siguiente paso

Con este flujo pasando, Analítica y Reportes (`009-analitica-reportes`, pendiente) puede reemplazar el `curl` manual de incidencias de cuadre por la salida real del modelo Isolation Forest.
