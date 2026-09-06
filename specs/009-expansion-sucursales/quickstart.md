# Guía de Arranque: Expansión y Sucursales

**Feature**: `009-expansion-sucursales` | **Fecha**: 2026-09-04

## Requisitos previos

- Docker Compose funcionando con `postgres` y `api`
- `010-administracion` levantado en el mismo entorno (para `POST /auth/login`, y para que `POST /sucursales/{id}/personal` pueda delegar la asignación)
- Al menos un producto activo en `001-core-ventas-inventario` para probar la herencia de catálogo

## Levantar el entorno

```bash
cd "Proyecto El Kiosquito"
docker compose up -d postgres api
docker compose exec api alembic upgrade head
```

## Flujo de prueba manual (cubre los escenarios de aceptación de `spec.md`)

### 1. Registrar una nueva sucursal (RF-ES-001, RF-ES-002)

```bash
curl -X POST http://localhost:8000/api/v1/sucursales \
  -H "Authorization: Bearer $TOKEN_DUENO" \
  -H "Content-Type: application/json" \
  -d '{"nombre": "El Kiosquito - La Alborada", "direccion": "Av. Principal y 4ta, Quevedo"}'
```

Respuesta esperada: `201`, `estado: "en_apertura"`, y las 8 filas del checklist ya generadas (verificar con el paso 2).

### 2. Consultar el estado de apertura (RF-ES-007)

```bash
curl "http://localhost:8000/api/v1/sucursales/<sucursal_id>/estado-apertura" \
  -H "Authorization: Bearer $TOKEN_DUENO"
```

### 3. Intentar activar antes de completar el checklist (CA-ES-001)

```bash
curl -X POST http://localhost:8000/api/v1/sucursales/<sucursal_id>/activar \
  -H "Authorization: Bearer $TOKEN_DUENO"
```

**Prueba negativa:** debe responder `422` con `items_pendientes` listando los 8 ítems (RN-ES-001).

### 4. Completar los ítems del checklist, incluyendo la herencia de catálogo (RF-ES-003, RF-ES-004)

```bash
curl -X PATCH "http://localhost:8000/api/v1/sucursales/<sucursal_id>/checklist/local_arrendado" \
  -H "Authorization: Bearer $TOKEN_DUENO"
# repetir para: mobiliario_instalado, pos_instalado, inspeccion_seguridad, permiso_municipal

curl -X POST http://localhost:8000/api/v1/sucursales/<sucursal_id>/personal \
  -H "Authorization: Bearer $TOKEN_DUENO" \
  -H "Content-Type: application/json" \
  -d '{"usuario_id": "<usuario_id_encargado>", "es_responsable": true}'
# marca automáticamente el ítem personal_asignado

curl -X POST http://localhost:8000/api/v1/sucursales/<sucursal_id>/heredar-catalogo \
  -H "Authorization: Bearer $TOKEN_DUENO"
# marca automáticamente catalogo_heredado y precios_heredados
```

**Prueba negativa (CA-ES-002):** repetir el último `curl` debe responder `409` sin duplicar filas de precio.

### 5. Activar la sucursal ya con el checklist completo (RF-ES-006)

```bash
curl -X POST http://localhost:8000/api/v1/sucursales/<sucursal_id>/activar \
  -H "Authorization: Bearer $TOKEN_DUENO"
```

Respuesta esperada: `200`, `estado: "operativa"`, `fecha_activacion` poblada.

### 6. Verificar el caso de producto sin precio previo (CA-ES-003)

Con un producto recién creado en `001-core-ventas-inventario` que nunca tuvo precio en ninguna sucursal, repetir el paso 4 (`heredar-catalogo`) en una sucursal nueva y confirmar que la respuesta de `POST /sucursales/{id}/heredar-catalogo` incluye ese producto en `cantidad_productos_pendientes`, sin fila creada en `historial_precio_producto` para él.

### 7. Catálogos: el checklist ya es configurable (RF-ES-009/010/011/012, RN-ES-004/005/006, enmienda v1.1)

```bash
curl "http://localhost:8000/api/v1/catalogos/items-checklist-apertura" -H "Authorization: Bearer $TOKEN_EXPANSION"
curl "http://localhost:8000/api/v1/catalogos/estados-sucursal" -H "Authorization: Bearer $TOKEN_EXPANSION"
```

Los 8 ítems deben venir ordenados por `orden`, con `es_bloqueante: true` solo en `permiso_municipal` e `inspeccion_seguridad`.

**Agregar un paso al proceso de apertura, sin migración:**

```bash
docker compose exec postgres psql -U kiosquito -c \
  "INSERT INTO item_checklist_apertura (codigo, etiqueta, orden, es_bloqueante)
   VALUES ('internet_contratado','Servicio de internet contratado y activo',9,false);"
```

Crea una sucursal nueva → su checklist trae 9 ítems. Consulta el checklist de la sucursal del paso 1 → sigue con 8, **no se recalculó** (RN-ES-006). Reabrir el checklist de sucursales ya operativas por un cambio de catálogo sería peor que el problema que resuelve.

Esto es lo que antes de la enmienda v1.1 exigía modificar un CHECK, es decir, una migración de esquema para cambiar un dato de negocio. Es la única decisión del proyecto que una enmienda revirtió explícitamente (Decisión 5 de `research.md`).

**Pruebas negativas:**

- `PATCH /sucursales/{id}/checklist/pintura_local` (ítem inexistente) → `404` (RF-ES-009).
- Dar de baja `permiso_municipal` en el catálogo (`activo = false`) → se rechaza (RN-ES-004): es un requisito legal y quitarlo del proceso dejaría abrir una sucursal sin él. Hacer lo mismo con `mobiliario_instalado` → se permite.
- **La prueba que confirma que nada se relajó:** completar los 2 ítems bloqueantes y dejar uno no bloqueante pendiente, y llamar a `POST /sucursales/{id}/activar` → sigue dando `422` (RN-ES-005). `es_bloqueante` no habilita activaciones con excepciones.

## Siguiente paso

Con `sucursal` operativa, cualquiera de los 8 módulos ya entregados puede registrar operaciones sobre ella (ventas, stock, compras, etc.), y `010-administracion` puede asignarle más personal según crezca la operación.
