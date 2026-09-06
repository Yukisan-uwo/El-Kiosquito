# Guía de Arranque: Inventario y Caducidad

**Feature**: `002-inventario-caducidad` | **Fecha**: 2026-09-04

## Requisitos previos

- Docker Compose funcionando con `postgres` y `api` (ver `docker-compose.yml` en la raíz de `Proyecto El Kiosquito/`)
- Migraciones de `sucursal`, `usuario` y `parametro_sistema` ya aplicadas (dependencias externas — ver `data-model.md`)
- Al menos un umbral de "próximo a caducar" y uno de "sin rotación" cargados en `parametro_sistema` (si no existen, el endpoint de consulta responde `409` en vez de asumir un valor por defecto — ver `contracts/inventario-caducidad.openapi.yaml`)

## Levantar el entorno

```bash
cd "Proyecto El Kiosquito"
docker compose up -d postgres api
docker compose exec api alembic upgrade head
```

## Flujo de prueba manual (cubre los escenarios de aceptación de `spec.md`)

### 1. Crear un producto perecedero y fraccionable (RF-IN-001, RF-IN-012)

```bash
curl -X POST http://localhost:8000/api/v1/productos \
  -H "Authorization: Bearer $TOKEN_ENCARGADO" \
  -H "Content-Type: application/json" \
  -d '{
    "nombre": "Queso fresco",
    "categoria": "lácteos",
    "unidad_venta": "libra",
    "unidad_inventario": "kg",
    "es_fraccionable": true,
    "factor_conversion": 0.4536,
    "es_perecedero": true
  }'
```

**Prueba negativa:** repetir con `"es_fraccionable": true` y sin `factor_conversion` → debe responder `422` (RN-IN-002).

### 2. Registrar el ingreso de stock con lote (RF-IN-003, RF-IN-004)

```bash
curl -X POST http://localhost:8000/api/v1/inventario/ingresos \
  -H "Authorization: Bearer $TOKEN_ENCARGADO" \
  -H "Content-Type: application/json" \
  -d '{
    "producto_id": "<producto_id>",
    "sucursal_id": "<sucursal_id>",
    "cantidad": 20,
    "fecha_caducidad": "2026-09-10"
  }'
```

Respuesta esperada: `201`, con `stock_sucursal.cantidad_disponible` incrementado y un `lote_producto` creado porque el producto es perecedero.

### 3. Consultar próximos a caducar (RF-IN-005)

```bash
curl "http://localhost:8000/api/v1/inventario/proximos-a-caducar?sucursal_id=<sucursal_id>" \
  -H "Authorization: Bearer $TOKEN_ENCARGADO"
```

Respuesta esperada: `200`, incluye el lote creado en el paso 2 si su `fecha_caducidad` cae dentro del umbral configurado.

### 4. Registrar el retiro del lote (RF-IN-006)

```bash
curl -X PATCH http://localhost:8000/api/v1/inventario/lotes/<lote_id>/retiro \
  -H "Authorization: Bearer $TOKEN_ENCARGADO" \
  -H "Content-Type: application/json" \
  -d '{"cantidad_retirada": 5, "motivo_retiro": "descuento por próxima caducidad"}'
```

**Prueba negativa:** repetir con `cantidad_retirada` mayor a `cantidad_restante` del lote → debe responder `422`.

### 5. Consultar stock en tiempo real (RF-IN-007)

```bash
curl "http://localhost:8000/api/v1/inventario/stock/<producto_id>?sucursal_id=<sucursal_id>" \
  -H "Authorization: Bearer $TOKEN_CAJERO"
```

Respuesta esperada: `200`, con `cantidad_disponible` reflejando ingreso menos retiro (15, según los pasos anteriores).

### 6. Registrar un ajuste tras conteo físico (RF-IN-008, RF-IN-009)

```bash
curl -X POST http://localhost:8000/api/v1/inventario/ajustes \
  -H "Authorization: Bearer $TOKEN_ENCARGADO" \
  -H "Content-Type: application/json" \
  -d '{"producto_id": "<producto_id>", "sucursal_id": "<sucursal_id>", "cantidad_ajuste": -2, "motivo": "conteo físico mensual"}'
```

**Prueba negativa:** repetir con un `cantidad_ajuste` negativo tan grande que dejaría el stock en negativo → debe responder `422`.

## Validación de scoping por sucursal (Art. 3.3 de la constitución)

Repetir el paso 5 con `$TOKEN_CAJERO` de una sucursal distinta a la consultada → debe responder `403`.

## Siguiente paso

Con este flujo pasando, Compras y Proveedores (módulo `003-compras-proveedores`, pendiente) puede referenciar `producto_id` al registrar órdenes de compra, y Analítica y Reportes puede incluir `stock_sucursal.marcado_sin_rotacion` como feature del modelo de pronóstico de demanda (OT4.1).
