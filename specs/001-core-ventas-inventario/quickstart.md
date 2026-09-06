# Guía de Arranque: Core de Ventas e Inventario

**Feature**: `001-core-ventas-inventario` | **Fecha**: 2026-09-04

## Requisitos previos

- Docker Compose funcionando con `postgres` y `api` (ver `docker-compose.yml` en la raíz del proyecto)
- Migraciones de `sucursal`, `usuario`, `cliente` (`002`) y `turno_caja` (`006`) ya aplicadas — este módulo necesita un `turno_caja_id` válido para registrar una venta
- Al menos un producto marcado `es_fraccionable = true` con `factor_conversion` configurado, y otro `es_perecedero = true`

## Levantar el entorno

```bash
docker compose up -d postgres api
docker compose exec api alembic upgrade head
```

## Flujo de prueba manual

### 0. Verificar que los catálogos quedaron poblados por la migración (RF-CVI-026, enmienda v1.3)

```bash
curl "http://localhost:8000/api/v1/catalogos/categorias?como_arbol=true" \
  -H "Authorization: Bearer $TOKEN_ENCARGADO"

curl "http://localhost:8000/api/v1/catalogos/unidades-medida" \
  -H "Authorization: Bearer $TOKEN_ENCARGADO"
```

Ambas deben devolver filas — el seed va **dentro** de la migración Alembic (T037), así que si alguna sale vacía es que la migración quedó a medias y ningún `POST /productos` va a funcionar. Guarda el `id` de la categoría "Lácteos" y confirma que `libra` tiene `permite_decimales: true` y `unidad` lo tiene en `false`.

### 1. Crear un producto perecedero y fraccionable (RF-CVI-006, RF-CVI-007, RF-CVI-023/025 enmienda v1.3)

```bash
curl -X POST http://localhost:8000/api/v1/productos \
  -H "Authorization: Bearer $TOKEN_ENCARGADO" -H "Content-Type: application/json" \
  -d '{
    "nombre": "Queso fresco",
    "categoria_id": <id_lacteos>,
    "unidad_venta_codigo": "libra",
    "unidad_inventario_codigo": "kilo",
    "es_fraccionable": true,
    "factor_conversion": 0.4536
  }'
```

Fíjate que **no se envía `es_perecedero`**: se hereda de la categoría Lácteos (`es_perecedero: true`). La respuesta debe traerlo en `true`.

**Pruebas negativas:**

- Repetir sin `factor_conversion` → `422` (RN-CVI-001).
- Repetir con `"unidad_venta_codigo": "unidad"` manteniendo `es_fraccionable: true` → `422` (RN-CVI-006: la unidad no admite decimales, así que el producto no puede ser fraccionable en ella).
- Repetir con `"categoria_id": 99999` → `404` (RF-CVI-023: ya no se puede inventar una categoría escribiéndola).
- Crear un segundo producto con `"es_perecedero": false` y la misma categoría Lácteos → se crea con `false`. La categoría orienta, el producto manda.

### 2. Ingresar stock con lote (RF-CVI-008, RF-CVI-009)

```bash
curl -X POST http://localhost:8000/api/v1/inventario/ingresos \
  -H "Authorization: Bearer $TOKEN_ENCARGADO" -H "Content-Type: application/json" \
  -d '{"producto_id": "<producto_id>", "sucursal_id": "<sucursal_id>", "cantidad": 20, "fecha_caducidad": "2026-09-10"}'
```

### 3. Registrar una venta fraccionada (RF-CVI-001, RF-CVI-005)

Requiere un `turno_caja_id` ya abierto en `006-caja-mermas-fraude` (`POST /api/v1/caja/turnos`).

```bash
curl -X POST http://localhost:8000/api/v1/ventas \
  -H "Authorization: Bearer $TOKEN_CAJERO" -H "Content-Type: application/json" \
  -d '{"turno_caja_id": "<turno_caja_id>", "items": [{"producto_id": "<producto_id>", "cantidad_venta": 3}], "metodo_pago": "efectivo"}'
```

Respuesta esperada: `201`, con `cantidad_inventario` convertida y `stock_sucursal.cantidad_disponible` descontado.

### 4. Consultar próximos a caducar y stock (RF-CVI-010, RF-CVI-012)

```bash
curl "http://localhost:8000/api/v1/inventario/proximos-a-caducar?sucursal_id=<sucursal_id>" -H "Authorization: Bearer $TOKEN_ENCARGADO"
curl "http://localhost:8000/api/v1/inventario/stock/<producto_id>?sucursal_id=<sucursal_id>" -H "Authorization: Bearer $TOKEN_CAJERO"
```

### 5. Anular la venta (RF-CVI-004)

```bash
curl -X PATCH http://localhost:8000/api/v1/ventas/<venta_id>/anular \
  -H "Authorization: Bearer $TOKEN_CAJERO" -H "Content-Type: application/json" \
  -d '{"motivo_anulacion": "cliente cambió de opinión"}'
```

Verificar aparte que el turno de caja (`006-caja-mermas-fraude`) no se modificó por esta anulación si ya estaba cerrado.

### 6. Registrar sustitutos y medir tiempo de cobro (RF-CVI-017/018/019, enmienda v1.1)

```bash
curl -X POST http://localhost:8000/api/v1/productos/<producto_id>/sustitutos \
  -H "Authorization: Bearer $TOKEN_ENCARGADO" -H "Content-Type: application/json" \
  -d '{"producto_sustituto_id": "<producto_id_alterno>", "simetrico": true}'

curl "http://localhost:8000/api/v1/productos/<producto_id>/sustitutos" \
  -H "Authorization: Bearer $TOKEN_ENCARGADO"

curl -X POST http://localhost:8000/api/v1/ventas \
  -H "Authorization: Bearer $TOKEN_CAJERO" -H "Content-Type: application/json" \
  -d '{"turno_caja_id": "<turno_caja_id>", "items": [{"producto_id": "<producto_id>", "cantidad_venta": 1}], "metodo_pago": "efectivo", "hora_inicio_cobro": "2026-09-04T15:30:00Z"}'
```

### 7. Definir stock mínimo y consultar stock bajo (RF-CVI-020/021/022, enmienda v1.2)

```bash
curl -X PATCH http://localhost:8000/api/v1/inventario/stock/<producto_id>/minimo \
  -H "Authorization: Bearer $TOKEN_ENCARGADO" -H "Content-Type: application/json" \
  -d '{"sucursal_id": "<sucursal_id>", "stock_minimo": 10}'

curl "http://localhost:8000/api/v1/inventario/stock-bajo?sucursal_id=<sucursal_id>" \
  -H "Authorization: Bearer $TOKEN_ENCARGADO"
```

Respuesta esperada: si `cantidad_disponible` del producto quedó por debajo de `10` tras las ventas del paso 3, aparece en el listado. Además, revisa la respuesta de cualquier venta creada en este flujo — debe incluir `numero_documento` (p. ej. `"V-00000001"`), no solo el `id` interno.

**Prueba negativa:** repetir el primer `curl` con `"stock_minimo": -5` → `422` (RN-CVI-005).

### 8. Gestionar categorías y comprobar que el vocabulario ya no está quemado (RF-CVI-024/026, enmienda v1.3)

```bash
# Subcategoría dentro de una categoría existente — jerarquía de dos niveles
curl -X POST http://localhost:8000/api/v1/catalogos/categorias \
  -H "Authorization: Bearer $TOKEN_ENCARGADO" -H "Content-Type: application/json" \
  -d '{"nombre": "Gaseosas", "categoria_padre_id": <id_bebidas>}'

# Intentar dar de baja Lácteos, que tiene el queso del paso 1
curl -X PATCH http://localhost:8000/api/v1/catalogos/categorias/<id_lacteos> \
  -H "Authorization: Bearer $TOKEN_ENCARGADO" -H "Content-Type: application/json" \
  -d '{"activo": false}'
```

**Pruebas negativas:**

- El segundo `curl` debe responder `409`: Lácteos todavía tiene productos activos, y darla de baja los sacaría en silencio de todos los informes por categoría.
- Crear una tercera categoría con `categoria_padre_id` = el id de "Gaseosas" (que ya tiene padre) → `422` (RN-CVI-008).
- Buscar un `DELETE` sobre cualquier catálogo → la ruta no existe (RN-CVI-009).

**Prueba positiva de la ventaja del catálogo** (esta es la que vale la pena mostrar): registrar una venta con `"metodo_pago": "transferencia"` → `404`, porque no está en el catálogo.

```bash
docker compose exec postgres psql -U kiosquito -c \
  "INSERT INTO metodo_pago (codigo, etiqueta, es_electronico, orden) VALUES ('transferencia','Transferencia',true,4);"
```

Repetir la misma venta → `201`. El vocabulario creció **con un `INSERT`, sin ningún `ALTER TABLE`**: antes de la enmienda v1.3, agregar un método de pago obligaba a modificar el CHECK de `venta`, es decir, un cambio de esquema. Y como la fila trae `es_electronico = true`, el KPI de adopción de pago electrónico de OT2.2 la cuenta sola, sin tocar la consulta del informe.

*(En producción ese `INSERT` va como migración de datos de Alembic, no por `psql` — `metodo_pago` es de solo lectura desde la API a propósito, ver `plan.md`. Aquí se hace directo para que la prueba sea de un paso.)*

## Validación de scoping por sucursal (Art. 3.3)

Repetir el paso 3 con `$TOKEN_CAJERO` de una sucursal distinta a la del `turno_caja_id` → `403`.

## Siguiente paso

Con este flujo pasando: `003-precios-margenes` fija el precio que se snapshotea en cada venta; `004-pronostico-demanda` registra la demanda insatisfecha cuando un producto no tiene stock; `006-caja-mermas-fraude` cierra el turno sumando las ventas en efectivo de este módulo.
