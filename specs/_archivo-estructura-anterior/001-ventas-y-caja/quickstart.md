# Guía de Arranque: Ventas y Caja

**Feature**: `001-ventas-y-caja` | **Fecha**: 2026-09-04

## Requisitos previos

- Docker Compose funcionando con los servicios `postgres` y `api` del proyecto (ver `docker-compose.yml` en la raíz de `Proyecto El Kiosquito/`)
- Migraciones de `producto`, `sucursal`, `usuario` y `cliente` ya aplicadas (dependencias de este módulo — ver `data-model.md`, sección "Diagrama de relaciones")
- Al menos una sucursal, un usuario con rol Cajero/Vendedor, y un producto marcado `es_fraccionable = true` con `factor_conversion` configurado, para poder probar el caso de venta fraccionada

## Levantar el entorno

```bash
cd "Proyecto El Kiosquito"
docker compose up -d postgres api
docker compose exec api alembic upgrade head
```

## Flujo de prueba manual (cubre los escenarios de aceptación de `spec.md`)

### 1. Abrir turno de caja (RF-VC-006)

```bash
curl -X POST http://localhost:8000/api/v1/caja/turnos \
  -H "Authorization: Bearer $TOKEN_CAJERO" \
  -H "Content-Type: application/json" \
  -d '{"monto_inicial": 20.00}'
```

Respuesta esperada: `201`, con `estado: "abierto"` y `turno_caja_id` — guárdalo para los pasos siguientes.

### 2. Registrar una venta con un producto fraccionado (RF-VC-001, RF-VC-005)

```bash
curl -X POST http://localhost:8000/api/v1/ventas \
  -H "Authorization: Bearer $TOKEN_CAJERO" \
  -H "Content-Type: application/json" \
  -d '{
    "turno_caja_id": "<turno_caja_id>",
    "items": [
      {"producto_id": "<producto_fraccionable_id>", "cantidad_venta": 3}
    ],
    "metodo_pago": "efectivo"
  }'
```

Respuesta esperada: `201`, con `detalle_venta[0].cantidad_inventario` ya convertida según el `factor_conversion` del producto (Decisión 1 de `research.md`), `iva` calculado al 15%, y `total`.

**Prueba negativa:** repetir con un `producto_id` que tenga `es_fraccionable = true` pero `factor_conversion IS NULL` → debe responder `422` (RN-VC-001).

### 3. Registrar demanda insatisfecha (RF-VC-009)

```bash
curl -X POST http://localhost:8000/api/v1/demanda-insatisfecha \
  -H "Authorization: Bearer $TOKEN_CAJERO" \
  -H "Content-Type: application/json" \
  -d '{"producto_id": "<producto_id_sin_stock>", "hora_evento": "2026-09-04T15:30:00Z"}'
```

Respuesta esperada: `201`, sin requerir ninguna venta asociada.

### 4. Cerrar el turno (RF-VC-007, RF-VC-012)

```bash
curl -X PATCH http://localhost:8000/api/v1/caja/turnos/<turno_caja_id>/cierre \
  -H "Authorization: Bearer $TOKEN_CAJERO" \
  -H "Content-Type: application/json" \
  -d '{"monto_contado": 55.30}'
```

Respuesta esperada: `200`, con `monto_esperado` calculado por el sistema (suma de ventas en efectivo del turno, Decisión 2 de `research.md`) y `diferencia = monto_contado - monto_esperado`.

**Prueba negativa:** intentar cerrar sin `monto_contado` → debe responder `422` (RF-VC-012, "nunca cierre automático sin conteo humano").

### 5. Si hay diferencia, registrar el motivo (RF-VC-008)

```bash
curl -X PATCH http://localhost:8000/api/v1/caja/turnos/<turno_caja_id>/motivo-diferencia \
  -H "Authorization: Bearer $TOKEN_CAJERO" \
  -H "Content-Type: application/json" \
  -d '{"motivo_diferencia": "sin causa identificada"}'
```

## Validación de scoping por sucursal (Art. 3.3 de la constitución)

Repetir el paso 2 con `$TOKEN_CAJERO` de una sucursal distinta a la del `turno_caja_id` usado → debe responder `403`, nunca `404` silencioso (para que el error de scoping sea explícito en los tests de contrato).

## Siguiente paso

Con este flujo pasando, el módulo está listo para que Analítica y Reportes (OT3.6) lo incluya en el pipeline ELT hacia ClickHouse — eso se especifica en el módulo `009-analitica-reportes` (pendiente), no en este.
