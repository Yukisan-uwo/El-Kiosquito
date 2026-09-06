# Guía de Arranque: Promociones Inteligentes

**Feature**: `005-promociones-inteligentes` | **Fecha**: 2026-09-04

## Requisitos previos

- Docker Compose con `postgres`/`api` levantados, migraciones de `002-clientes-fidelizacion` y `001-core-ventas-inventario` aplicadas
- Un cliente registrado en `002-clientes-fidelizacion`

## Levantar el entorno

```bash
docker compose up -d postgres api
docker compose exec api alembic upgrade head
```

## Flujo de prueba manual

### 1. Registrar un cupón de cumpleaños (RF-PI-001)

```bash
curl -X POST http://localhost:8000/api/v1/promociones/cupones \
  -H "Authorization: Bearer $TOKEN_FIDELIZACION" -H "Content-Type: application/json" \
  -d '{"cliente_id": "<cliente_id>", "tipo_origen": "cumpleanos", "descuento_tipo": "porcentaje", "descuento_valor": 10, "fecha_expiracion": "2026-09-30T23:59:59Z"}'
```

### 2. Registrar un cupón de recuperación de churn, vinculado a una evaluación (RF-PI-001, RN-PI-002)

```bash
curl -X POST http://localhost:8000/api/v1/promociones/cupones \
  -H "Authorization: Bearer $TOKEN_FIDELIZACION" -H "Content-Type: application/json" \
  -d '{"cliente_id": "<cliente_id>", "tipo_origen": "recuperacion_churn", "evaluacion_churn_id": "<evaluacion_id>", "descuento_tipo": "monto_fijo", "descuento_valor": 2.00, "fecha_expiracion": "2026-09-20T23:59:59Z"}'
```

**Prueba negativa:** repetir sin `evaluacion_churn_id` → debe responder `422` (RN-PI-002).

### 3. Consultar los cupones de un cliente (RF-PI-003)

```bash
curl "http://localhost:8000/api/v1/clientes/<cliente_id>/cupones" -H "Authorization: Bearer $TOKEN_FIDELIZACION"
```

### 4. Canjear un cupón (RF-PI-002, RN-PI-001)

```bash
curl -X PATCH http://localhost:8000/api/v1/promociones/cupones/<cupon_id>/canjear \
  -H "Authorization: Bearer $TOKEN_CAJERO" -H "Content-Type: application/json" \
  -d '{"venta_id": "<venta_id>"}'
```

**Pruebas negativas:**
- Repetir el mismo `curl` inmediatamente → `422` (cupón ya canjeado).
- Canjear un cupón con `fecha_expiracion` en el pasado → `422` (cupón vencido).

### 5. Catálogos y tope de descuento (RF-PI-005/006/007, RN-PI-004, enmienda v1.1)

```bash
curl "http://localhost:8000/api/v1/catalogos/tipos-origen-cupon" -H "Authorization: Bearer $TOKEN_FIDELIZACION"
curl "http://localhost:8000/api/v1/catalogos/tipos-descuento" -H "Authorization: Bearer $TOKEN_FIDELIZACION"
```

En el primero, `cumpleanos` y `patron_compra` deben venir con `es_automatico: true` y `recuperacion_churn` también — el que quedaría en `false` es cualquier origen manual que se agregue después. Ese campo es el que hace que el indicador de OT2.3 (% de cupones bien segmentados) mida algo: calculado sobre todos los cupones, mezclaría los que segmentó el modelo con los que emitió una persona.

**La prueba que antes no fallaba y ahora sí:**

```bash
curl -X POST http://localhost:8000/api/v1/promociones/cupones \
  -H "Authorization: Bearer $TOKEN_FIDELIZACION" -H "Content-Type: application/json" \
  -d '{"cliente_id": "<cliente_id>", "tipo_origen": "cumpleanos", "descuento_tipo": "porcentaje", "descuento_valor": 200, "fecha_expiracion": "2026-12-31T23:59:59Z"}'
```

Debe responder `422` (RN-PI-004). **Antes de la enmienda v1.1 esto devolvía `201`**: la única validación era `descuento_valor >= 0`, así que un cupón de 200% de descuento se creaba sin ningún error y el sistema terminaba pagándole al cliente por llevarse el producto. Con `descuento_valor: 100` sí debe dar `201` — el tope es inclusivo.

**Otras negativas:**

- `"tipo_origen": "temporada"` (no está en el catálogo) → `404` (RF-PI-005).
- `"tipo_origen": "recuperacion_churn"` sin `evaluacion_churn_id` → sigue rechazándose por el CHECK de base de datos, no por el catálogo (RN-PI-002). Los dos mecanismos conviven a propósito: el CHECK impone la regla fila por fila, el catálogo solo la hace consultable para los formularios.

## Siguiente paso

`002-clientes-fidelizacion` puede vincular el `cupon_id` devuelto en el paso 2 a su propia `campana_recuperacion`.
