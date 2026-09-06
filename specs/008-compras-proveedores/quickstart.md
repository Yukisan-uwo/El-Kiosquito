# Guía de Arranque: Compras y Proveedores

**Feature**: `008-compras-proveedores` | **Fecha**: 2026-09-04

## Requisitos previos

- Docker Compose funcionando con `postgres` y `api` (ver `docker-compose.yml` en la raíz de `Proyecto El Kiosquito/`)
- Migraciones de `producto` (`001-core-ventas-inventario`), `sucursal` y `usuario` ya aplicadas
- `004-pronostico-demanda` levantado en el mismo entorno, para probar el flujo de compra por oferta

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

### 2. Crear una orden de compra normal (RF-CP-002, forma_pago RF-CP-012 enmienda v1.1)

```bash
curl -X POST http://localhost:8000/api/v1/compras/ordenes \
  -H "Authorization: Bearer $TOKEN_COMPRAS" \
  -H "Content-Type: application/json" \
  -d '{
    "proveedor_id": "<proveedor_id>",
    "sucursal_id": "<sucursal_id>",
    "es_oferta": false,
    "forma_pago": "credito",
    "items": [{"producto_id": "<producto_id>", "cantidad_pedida": 100, "precio_ofrecido": 0.35}]
  }'
```

Respuesta esperada: `201`, `estado: "pendiente"`, `forma_pago: "credito"` — guarda el `detalle_id` del ítem para los siguientes pasos.

**Prueba negativa:** repetir sin `forma_pago` → `422` (RF-CP-012, enmienda v1.1).

### 3. Registrar la recepción en dos envíos parciales, con documento del proveedor (RF-CP-003, RF-CP-004, RF-CP-013 enmienda v1.1)

```bash
curl -X POST http://localhost:8000/api/v1/compras/ordenes/<detalle_id>/recepciones \
  -H "Authorization: Bearer $TOKEN_COMPRAS" \
  -H "Content-Type: application/json" \
  -d '{"cantidad_recibida_evento": 60, "numero_documento_proveedor": "FAC-001-002-000456"}'

curl -X POST http://localhost:8000/api/v1/compras/ordenes/<detalle_id>/recepciones \
  -H "Authorization: Bearer $TOKEN_COMPRAS" \
  -H "Content-Type: application/json" \
  -d '{"cantidad_recibida_evento": 40}'
```

El segundo envío se registra sin `numero_documento_proveedor` (llegó antes que la factura) y se acepta igual — confirma que el campo es opcional.

Respuesta esperada tras el segundo envío: la orden pasa a `recibida_completa` porque `SUM(60+40) = 100 = cantidad_pedida` (RF-CP-005).

### 4. Verificar que se creó el historial de costo (RF-CP-006)

```bash
curl "http://localhost:8000/api/v1/compras/productos/<producto_id>/historial-costo" \
  -H "Authorization: Bearer $TOKEN_COMPRAS"
```

### 5. Probar el flujo de compra por oferta sin pronóstico consultado (RN-CP-001)

```bash
curl -X POST http://localhost:8000/api/v1/compras/ordenes \
  -H "Authorization: Bearer $TOKEN_COMPRAS" \
  -H "Content-Type: application/json" \
  -d '{
    "proveedor_id": "<proveedor_id>",
    "sucursal_id": "<sucursal_id>",
    "es_oferta": true,
    "forma_pago": "contado",
    "items": [{"producto_id": "<producto_id>", "cantidad_pedida": 500, "precio_ofrecido": 0.20}]
  }'

curl -X POST http://localhost:8000/api/v1/compras/ordenes/<detalle_id_oferta>/recepciones \
  -H "Authorization: Bearer $TOKEN_COMPRAS" \
  -H "Content-Type: application/json" \
  -d '{"cantidad_recibida_evento": 500}'
```

**Prueba negativa:** el segundo `curl` (intentar recibir sin haber consultado el pronóstico primero) debe responder `422` (RN-CP-001).

### 6. Consultar el pronóstico real de `004-pronostico-demanda` y registrar el motivo si no se sigue (RF-CP-009, RF-CP-010)

```bash
curl "http://localhost:8000/api/v1/compras/productos/<producto_id>/pronostico?sucursal_id=<sucursal_id>&detalle_id=<detalle_id_oferta>" \
  -H "Authorization: Bearer $TOKEN_COMPRAS"
```

Este endpoint llama internamente a `GET /pronostico/{producto_id}` de `004-pronostico-demanda` y marca `pronostico_consultado = true` en el detalle indicado por `detalle_id`.

**Prueba negativa:** si `004-pronostico-demanda` responde `datos_suficientes: false`, este endpoint marca `pronostico_consultado = true` pero sin `cantidad_recomendada_pronostico` — cualquier `cantidad_pedida` exige `motivo_no_siguio_pronostico` en ese caso.

```bash
curl -X PATCH http://localhost:8000/api/v1/compras/ordenes/<detalle_id_oferta>/motivo-oferta \
  -H "Authorization: Bearer $TOKEN_COMPRAS" \
  -H "Content-Type: application/json" \
  -d '{"motivo_no_siguio_pronostico": "descuento del 40% justifica el riesgo, producto no perecedero"}'
```

Con esto, repetir la recepción del paso 5 ahora debe aceptarse (`201`).

### 7. Catálogos y plazo de crédito (RF-CP-014/015/016, RN-CP-002, enmienda v1.2)

```bash
curl "http://localhost:8000/api/v1/catalogos/formas-pago" -H "Authorization: Bearer $TOKEN_COMPRAS"
curl "http://localhost:8000/api/v1/catalogos/estados-orden-compra" -H "Authorization: Bearer $TOKEN_COMPRAS"
```

En el primero, `credito` debe traer `dias_plazo_default` mayor a 0 y `contado` en 0 — ese dato no existía antes de la enmienda v1.2, así que saber que una orden era a crédito no decía nada sobre cuándo había que pagarla (OT1.3).

En el segundo, `recibida_completa` y `cancelada` deben venir con `permite_recepcion: false`.

**Pruebas negativas:**

- `POST /compras/ordenes` con `"forma_pago": "transferencia"` (no está en el catálogo) → `404`.
- Intentar registrar una recepción sobre la orden del paso 3, ya en `recibida_completa` → se rechaza consultando `permite_recepcion`, no una lista de estados escrita en el servicio (RN-CP-002).
- Buscar cualquier ruta que escriba `orden_compra.estado` directamente → no existe. Que el estado ahora sea FK **no lo volvió editable**: sigue derivándose del log de recepciones (RNF-CP-001).

```bash
docker compose exec postgres psql -U kiosquito -c \
  "INSERT INTO forma_pago (codigo, etiqueta, dias_plazo_default, orden) VALUES ('credito_60','Crédito 60 días',60,3);"
```

Crear una orden con `"forma_pago": "credito_60"` → `201`, sin ningún `ALTER TABLE`.

## Validación de scoping por sucursal (Art. 3.3 de la constitución)

Un token de rol Encargado de Sucursal (no Compras) que intente `POST /compras/ordenes` con `sucursal_id` distinta a la suya debe responder `403`.

## Siguiente paso

Con este flujo pasando, `003-precios-margenes` puede consultar `historial_costo_producto` para calcular el margen real por producto (OT1.1).
