# Guía de Arranque: Precios y Márgenes

**Feature**: `004-precios-margenes` | **Fecha**: 2026-09-04

## Requisitos previos

- Docker Compose funcionando con `postgres` y `api` (ver `docker-compose.yml` en la raíz de `Proyecto El Kiosquito/`)
- Migraciones de `producto`, `sucursal` y `usuario` ya aplicadas
- Al menos un producto con costo de reposición ya registrado en `003-compras-proveedores` (`historial_costo_producto`), para poder probar el cálculo de margen real

## Levantar el entorno

```bash
cd "Proyecto El Kiosquito"
docker compose up -d postgres api
docker compose exec api alembic upgrade head
```

## Flujo de prueba manual (cubre los escenarios de aceptación de `spec.md`)

### 1. Registrar el precio de venta de un producto (RF-PM-001, RF-PM-002)

```bash
curl -X POST http://localhost:8000/api/v1/precios \
  -H "Authorization: Bearer $TOKEN_PRECIOS" \
  -H "Content-Type: application/json" \
  -d '{"producto_id": "<producto_id>", "sucursal_id": "<sucursal_id>", "precio_venta": 0.60}'
```

### 2. Consultar el margen real (RF-PM-003, RF-PM-004)

```bash
curl "http://localhost:8000/api/v1/precios/<producto_id>/margen?sucursal_id=<sucursal_id>" \
  -H "Authorization: Bearer $TOKEN_PRECIOS"
```

Respuesta esperada: `200`, con el margen calculado usando el costo más reciente de `003-compras-proveedores`.

**Prueba negativa:** repetir con un `producto_id` que nunca tuvo compras registradas → debe responder con un cuerpo que declare explícitamente "datos insuficientes", nunca un margen calculado con costo cero.

### 3. Registrar precio de competencia y consultar la comparativa (RF-PM-005, RF-PM-006)

```bash
curl -X POST http://localhost:8000/api/v1/precios/competencia \
  -H "Authorization: Bearer $TOKEN_PRECIOS" \
  -H "Content-Type: application/json" \
  -d '{"producto_id": "<producto_id>", "fuente": "Supermercado La Favorita (sucursal cercana)", "precio_referencia": 0.65}'

curl "http://localhost:8000/api/v1/precios/<producto_id>/comparativa-competencia" \
  -H "Authorization: Bearer $TOKEN_PRECIOS"
```

### 4. Clasificar el producto (RF-PM-007)

```bash
curl -X PATCH http://localhost:8000/api/v1/precios/clasificacion/<producto_id> \
  -H "Authorization: Bearer $TOKEN_PRECIOS" \
  -H "Content-Type: application/json" \
  -d '{"clasificacion": "gancho"}'
```

### 5. Generar y resolver una recomendación de precio (RF-PM-008, RF-PM-009, RN-PM-001)

```bash
curl -X POST http://localhost:8000/api/v1/precios/recomendaciones \
  -H "Authorization: Bearer $TOKEN_SISTEMA" \
  -H "Content-Type: application/json" \
  -d '{
    "producto_id": "<producto_id>",
    "sucursal_id": "<sucursal_id>",
    "precio_recomendado": 0.63,
    "justificacion": "margen real por debajo del promedio de categoría y demanda estable las últimas 4 semanas"
  }'
```

**Prueba negativa:** repetir el mismo `curl` inmediatamente → debe responder `409` (RN-PM-001, ya existe una recomendación `pendiente` para ese producto/sucursal).

```bash
curl -X PATCH http://localhost:8000/api/v1/precios/recomendaciones/<recomendacion_id>/resolucion \
  -H "Authorization: Bearer $TOKEN_PRECIOS" \
  -H "Content-Type: application/json" \
  -d '{"decision": "aceptada"}'
```

Respuesta esperada: `200`, y una nueva consulta a `GET /precios/{producto_id}/margen` refleja el nuevo precio (`0.63`) con `fuente = "motor_dinamico"` en el historial.

### 6. Verificar que un precio manual vuelve obsoleta una recomendación pendiente

Repetir el paso 1 con un nuevo precio mientras existe una recomendación `pendiente` para ese producto/sucursal → al consultarla después, su `estado` debe ser `obsoleta`.

## Validación de scoping por sucursal (Art. 3.3 de la constitución)

Un token de Encargado de Sucursal contra `POST /precios` de una sucursal distinta a la suya debe responder `403`.

## Siguiente paso

Con este flujo pasando, Ventas y Caja puede tomar `historial_precio_producto` como fuente del precio vigente al momento de vender (ya lo hace como snapshot en `detalle_venta.precio_unitario_aplicado`, ver `001-ventas-y-caja/data-model.md`).
