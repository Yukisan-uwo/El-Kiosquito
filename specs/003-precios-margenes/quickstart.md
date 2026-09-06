# Guía de Arranque: Precios y Márgenes

**Feature**: `003-precios-margenes` | **Fecha**: 2026-09-04

## Requisitos previos

- Docker Compose funcionando con `postgres` y `api` (ver `docker-compose.yml` en la raíz de `Proyecto El Kiosquito/`)
- Migraciones de `producto` (`001-core-ventas-inventario`), `sucursal` y `usuario` ya aplicadas
- Al menos un producto con costo de reposición ya registrado en `008-compras-proveedores` (`historial_costo_producto`), para poder probar el cálculo de margen real

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

Respuesta esperada: `200`, con el margen calculado usando el costo más reciente de `008-compras-proveedores`.

**Prueba negativa:** repetir con un `producto_id` que nunca tuvo compras registradas → debe responder con un cuerpo que declare explícitamente "datos insuficientes", nunca un margen calculado con costo cero.

### 3. Registrar precio de competencia y consultar la comparativa (RF-PM-005, RF-PM-006, RF-PM-012/013/014 enmienda v1.2)

Primero se dan de alta los competidores en el catálogo — ya no se escriben a mano en cada observación:

```bash
curl -X POST http://localhost:8000/api/v1/catalogos/fuentes-competencia \
  -H "Authorization: Bearer $TOKEN_PRECIOS" -H "Content-Type: application/json" \
  -d '{"nombre": "Supermercado La Favorita — Quevedo centro", "canal_codigo": "supermercado"}'

curl -X POST http://localhost:8000/api/v1/catalogos/fuentes-competencia \
  -H "Authorization: Bearer $TOKEN_PRECIOS" -H "Content-Type: application/json" \
  -d '{"nombre": "PedidosYa — tienda oficial", "canal_codigo": "canal_digital"}'
```

Ahora las observaciones. Fíjate que **no se envía el canal**: se deriva de la fuente (Decisión 5B de `research.md`).

```bash
curl -X POST http://localhost:8000/api/v1/precios/competencia \
  -H "Authorization: Bearer $TOKEN_PRECIOS" -H "Content-Type: application/json" \
  -d '{"producto_id": "<producto_id>", "fuente_competencia_id": <id_favorita>, "precio_referencia": 0.65}'

curl -X POST http://localhost:8000/api/v1/precios/competencia \
  -H "Authorization: Bearer $TOKEN_PRECIOS" -H "Content-Type: application/json" \
  -d '{"producto_id": "<producto_id>", "fuente_competencia_id": <id_pedidosya>, "precio_referencia": 0.70}'

curl "http://localhost:8000/api/v1/precios/<producto_id>/comparativa-competencia?canal_codigo=canal_digital" \
  -H "Authorization: Bearer $TOKEN_PRECIOS"

# La consulta nueva: una fila por competidor concreto (RF-PM-014)
curl "http://localhost:8000/api/v1/precios/<producto_id>/comparativa-competencia?agrupar_por_fuente=true" \
  -H "Authorization: Bearer $TOKEN_PRECIOS"
```

La última responde **"¿contra qué competidor estoy peor de precio?"** — imposible antes de la enmienda v1.2, porque con el nombre escrito a mano dos observaciones del mismo supermercado con distinta redacción se contaban como competidores distintos.

**Pruebas negativas:**

- Repetir una observación con `fuente_competencia_id` inexistente → `404` (RF-PM-012).
- Enviar `tipo_canal` en el cuerpo → se ignora: ese campo ya no existe en `precio_competencia`.
- Dar de baja La Favorita (`PATCH .../fuentes-competencia/<id> {"activo": false}`) y volver a pedir la comparativa → las observaciones históricas de ese local se siguen consultando sin error (RN-PM-006).

### 4. Clasificar el producto y verificar su historial (RF-PM-007, RF-PM-015/016 enmienda v1.2)

```bash
curl -X PATCH http://localhost:8000/api/v1/precios/clasificacion/<producto_id> \
  -H "Authorization: Bearer $TOKEN_PRECIOS" -H "Content-Type: application/json" \
  -d '{"clasificacion": "nicho", "motivo_cambio": "margen alto y rotación baja en el trimestre"}'

# Rango de margen objetivo que le corresponde, leído del catálogo (RF-PM-017)
curl "http://localhost:8000/api/v1/catalogos/clasificaciones-comerciales" \
  -H "Authorization: Bearer $TOKEN_PRECIOS"

# Reclasificar más adelante
curl -X PATCH http://localhost:8000/api/v1/precios/clasificacion/<producto_id> \
  -H "Authorization: Bearer $TOKEN_PRECIOS" -H "Content-Type: application/json" \
  -d '{"clasificacion": "gancho", "motivo_cambio": "se volvió producto de atracción tras la promoción"}'

curl "http://localhost:8000/api/v1/precios/clasificacion/<producto_id>/historial" \
  -H "Authorization: Bearer $TOKEN_PRECIOS"
```

Respuesta esperada del historial: **dos** filas. `nicho` con `fecha_hasta` cerrado, `gancho` con `fecha_hasta: null`.

**La consulta que protege el margen histórico de OT1.1** (RF-PM-016):

```bash
curl "http://localhost:8000/api/v1/precios/clasificacion/<producto_id>/historial?en_fecha=2026-07-15" \
  -H "Authorization: Bearer $TOKEN_PRECIOS"
```

Debe devolver `nicho`, no `gancho`. Si devolviera la clasificación actual, el margen de julio se evaluaría contra el rango objetivo equivocado y el producto parecería llevar meses fuera de rango cuando en realidad cumplía el que regía entonces.

**Pruebas negativas:**

- Reclasificar sin `motivo_cambio`, o con menos de 10 caracteres → `422` (RN-PM-005).
- Reclasificar con `"clasificacion": "premium"` (no está en el catálogo) → `404`.
- `INSERT` directo de una segunda fila de historial con `fecha_hasta = NULL` para el mismo producto → la base lo rechaza por el índice único parcial (RN-PM-004), igual que con `recomendacion_precio` y RN-PM-001.

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

Con este flujo pasando, `001-core-ventas-inventario` puede tomar `historial_precio_producto` como fuente del precio vigente al momento de vender (ya lo hace como snapshot en `detalle_venta.precio_unitario_aplicado`, ver `001-core-ventas-inventario/data-model.md`).
