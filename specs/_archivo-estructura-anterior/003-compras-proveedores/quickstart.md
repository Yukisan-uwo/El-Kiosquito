# Guía de Arranque: Compras y Proveedores

**Feature**: `003-compras-proveedores` | **Fecha**: 2026-09-04

## Requisitos previos

- Docker Compose funcionando con `postgres` y `api` (ver `docker-compose.yml` en la raíz de `Proyecto El Kiosquito/`)
- Migraciones de `producto`, `sucursal` y `usuario` ya aplicadas
- Al menos un producto y una sucursal existentes para poder crear una orden de compra

## Levantar el entorno

```bash
cd "Proyecto El Kiosquito"
docker compose up -d postgres api
docker compose exec api alembic upgrade head
```

## Flujo de prueba manual (cubre los escenarios de aceptación de `spec.md`)

### 1. Registrar un proveedor (RF-CP-001)

```bash
curl -X POST http://localhost:8000/api/v1/proveedores \
  -H "Authorization: Bearer $TOKEN_COMPRAS" \
  -H "Content-Type: application/json" \
  -d '{"nombre": "Distribuidora Andina", "contacto": "0991234567"}'
```

### 2. Crear una orden de compra normal (RF-CP-002)

```bash
curl -X POST http://localhost:8000/api/v1/compras/ordenes \
  -H "Authorization: Bearer $TOKEN_COMPRAS" \
  -H "Content-Type: application/json" \
  -d '{
    "proveedor_id": "<proveedor_id>",
    "sucursal_id": "<sucursal_id>",
    "es_oferta": false,
    "items": [{"producto_id": "<producto_id>", "cantidad_pedida": 100, "precio_ofrecido": 0.35}]
  }'
```

Respuesta esperada: `201`, `estado: "pendiente"`, guarda el `detalle_id` del ítem para los siguientes pasos.

### 3. Registrar la recepción en dos envíos parciales (RF-CP-003, RF-CP-004)

```bash
curl -X POST http://localhost:8000/api/v1/compras/ordenes/<detalle_id>/recepciones \
  -H "Authorization: Bearer $TOKEN_COMPRAS" \
  -H "Content-Type: application/json" \
  -d '{"cantidad_recibida_evento": 60}'

curl -X POST http://localhost:8000/api/v1/compras/ordenes/<detalle_id>/recepciones \
  -H "Authorization: Bearer $TOKEN_COMPRAS" \
  -H "Content-Type: application/json" \
  -d '{"cantidad_recibida_evento": 40}'
```

Respuesta esperada tras el segundo envío: la orden pasa a `recibida_completa` porque `SUM(60+40) = 100 = cantidad_pedida` (RF-CP-005) — verificar consultando `GET /compras/ordenes/{id}` que `estado` se derivó correctamente, no fue editado manualmente.

### 4. Verificar que se creó el historial de costo (RF-CP-006)

```bash
curl "http://localhost:8000/api/v1/compras/productos/<producto_id>/historial-costo" \
  -H "Authorization: Bearer $TOKEN_COMPRAS"
```

Respuesta esperada: `200`, con al menos una entrada de costo `0.35` asociada al proveedor y a la orden.

### 5. Probar el flujo de compra por oferta sin pronóstico consultado (RN-CP-001)

```bash
curl -X POST http://localhost:8000/api/v1/compras/ordenes \
  -H "Authorization: Bearer $TOKEN_COMPRAS" \
  -H "Content-Type: application/json" \
  -d '{
    "proveedor_id": "<proveedor_id>",
    "sucursal_id": "<sucursal_id>",
    "es_oferta": true,
    "items": [{"producto_id": "<producto_id>", "cantidad_pedida": 500, "precio_ofrecido": 0.20}]
  }'

curl -X POST http://localhost:8000/api/v1/compras/ordenes/<detalle_id_oferta>/recepciones \
  -H "Authorization: Bearer $TOKEN_COMPRAS" \
  -H "Content-Type: application/json" \
  -d '{"cantidad_recibida_evento": 500}'
```

**Prueba negativa:** el segundo `curl` (intentar recibir sin haber consultado el pronóstico primero) debe responder `422` (RN-CP-001).

### 6. Consultar el pronóstico y registrar el motivo si no se sigue (RF-CP-009, RF-CP-010)

```bash
curl "http://localhost:8000/api/v1/compras/productos/<producto_id>/pronostico" \
  -H "Authorization: Bearer $TOKEN_COMPRAS"

curl -X PATCH http://localhost:8000/api/v1/compras/ordenes/<detalle_id_oferta>/motivo-oferta \
  -H "Authorization: Bearer $TOKEN_COMPRAS" \
  -H "Content-Type: application/json" \
  -d '{"motivo_no_siguio_pronostico": "descuento del 40% justifica el riesgo, producto no perecedero"}'
```

Con esto, repetir la recepción del paso 5 ahora debe aceptarse (`201`).

## Validación de scoping por sucursal (Art. 3.3 de la constitución)

Un token de rol Encargado de Sucursal (no Compras) que intente `POST /compras/ordenes` con `sucursal_id` distinta a la suya debe responder `403`.

## Siguiente paso

Con este flujo pasando, Precios y Márgenes (módulo `004-precios-margenes`, pendiente) puede consultar `historial_costo_producto` para calcular el margen real por producto (OT1.1).
