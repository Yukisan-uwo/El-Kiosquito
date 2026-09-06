# Guía de Arranque: Caja, Mermas y Fraude

**Feature**: `006-caja-mermas-fraude` | **Fecha**: 2026-09-04

## Requisitos previos

- Docker Compose con `postgres`/`api` levantados, migraciones de `001-core-ventas-inventario`, `sucursal` y `usuario` aplicadas

## Levantar el entorno

```bash
docker compose up -d postgres api
docker compose exec api alembic upgrade head
```

## Flujo de prueba manual

### 1. Abrir y cerrar un turno de caja (RF-CMF-001, RF-CMF-002, RF-CMF-004)

```bash
curl -X POST http://localhost:8000/api/v1/caja/turnos \
  -H "Authorization: Bearer $TOKEN_CAJERO" -H "Content-Type: application/json" \
  -d '{"sucursal_id": "<sucursal_id>", "monto_inicial": 20.00}'
```

Registrar algunas ventas en efectivo en `001-core-ventas-inventario` usando este `turno_caja_id`, luego:

```bash
curl -X PATCH http://localhost:8000/api/v1/caja/turnos/<turno_id>/cerrar \
  -H "Authorization: Bearer $TOKEN_CAJERO" -H "Content-Type: application/json" \
  -d '{"monto_contado": 85.50}'
```

**Prueba negativa:** repetir sin `monto_contado` → `422` (RF-CMF-004).

Si `diferencia != 0`, el cierre exige `motivo_diferencia` (RN-CMF-002); repetirlo sin ese campo → `422`.

### 2. Registrar y clasificar una merma (RF-CMF-005, RF-CMF-006, RF-CMF-008, RN-CMF-003)

```bash
curl -X POST http://localhost:8000/api/v1/mermas \
  -H "Authorization: Bearer $TOKEN_PERDIDAS" -H "Content-Type: application/json" \
  -d '{"producto_id": "<producto_id>", "sucursal_id": "<sucursal_id>", "cantidad": 3, "valor_estimado": 4.50}'
```

**Prueba negativa:** `PATCH /mermas/<merma_id>/resultado` antes de asignar `causa` → `422` (RN-CMF-003).

```bash
curl -X PATCH http://localhost:8000/api/v1/mermas/<merma_id>/causa \
  -H "Authorization: Bearer $TOKEN_PERDIDAS" -H "Content-Type: application/json" \
  -d '{"causa": "error_humano"}'

curl -X PATCH http://localhost:8000/api/v1/mermas/<merma_id>/resultado \
  -H "Authorization: Bearer $TOKEN_PERDIDAS" -H "Content-Type: application/json" \
  -d '{"resultado_investigacion": "confirmada"}'
```

### 3. Registrar una incidencia de cuadre (RF-CMF-009, RN-CMF-005)

```bash
curl -X POST http://localhost:8000/api/v1/caja/incidencias-cuadre \
  -H "Authorization: Bearer $TOKEN_SISTEMA" -H "Content-Type: application/json" \
  -d '{"turno_caja_id": "<turno_id>", "score_anomalia": 0.87, "justificacion": "diferencia atípica para el patrón histórico de este cajero en este horario"}'
```

**Prueba negativa:** repetir para el mismo `turno_caja_id` mientras la anterior sigue `pendiente` → `409` (RN-CMF-005).

### 4. Registrar y atender una alerta de fraude en pago (RF-CMF-010, RF-CMF-011, RN-CMF-004)

```bash
curl -X POST http://localhost:8000/api/v1/caja/alertas-fraude \
  -H "Authorization: Bearer $TOKEN_SISTEMA_INTERNO" -H "Content-Type: application/json" \
  -d '{"venta_id": "<venta_id>", "motivo": "monto inusual para el perfil de la sucursal", "ultimos_4_digitos": "4242"}'
```

```bash
curl -X PATCH http://localhost:8000/api/v1/caja/alertas-fraude/<alerta_id>/atender \
  -H "Authorization: Bearer $TOKEN_PERDIDAS"
```

**Prueba negativa:** repetir el mismo `curl` → `422` (RN-CMF-004, ya estaba atendida).

### 5. Generar y consultar puntos de control horario (RF-CMF-012, RF-CMF-013, enmienda v1.1)

En producción este endpoint lo invoca el scheduler interno cada hora, nunca una persona — para probarlo manualmente mientras el scheduler no está levantado:

```bash
curl -X POST http://localhost:8000/api/v1/caja/turnos/<turno_id>/checkpoints \
  -H "Authorization: Bearer $TOKEN_SISTEMA"

curl "http://localhost:8000/api/v1/caja/turnos/<turno_id>/checkpoints" \
  -H "Authorization: Bearer $TOKEN_ENCARGADO"
```

Respuesta esperada: el `GET` devuelve la lista de checkpoints generados para ese turno, ordenados cronológicamente, cada uno con el monto esperado acumulado hasta ese instante.

**Prueba negativa:** cerrar el turno (paso 1) y luego intentar generar un checkpoint sobre ese mismo `turno_id` → `409`.

### 6. Catálogos y el filtro de mermas atribuibles (RF-CMF-014/015/016/017, RN-CMF-007, enmienda v1.2)

```bash
curl "http://localhost:8000/api/v1/catalogos/causas-merma" \
  -H "Authorization: Bearer $TOKEN_PREVENCION"
```

Respuesta esperada: las cuatro causas, con `error_humano` y `fraude_interno` en `es_atribuible_a_persona: true`, y `robo_externo` y `caducidad` en `false`. `caducidad` es además la única con `requiere_investigacion: false` — la explicación ya está en la fecha del lote.

Registra una merma de cada causa y luego:

```bash
curl "http://localhost:8000/api/v1/mermas?sucursal_id=<sucursal_id>&atribuible_a_persona=true" \
  -H "Authorization: Bearer $TOKEN_PREVENCION"
```

Debe devolver solo las de `error_humano` y `fraude_interno`. Ese filtro es el que alimenta el cruce merma × cuadre de caja de OT3.4 **sin enumerar códigos a mano**.

**La prueba que demuestra por qué esto importa** (RN-CMF-007):

```bash
docker compose exec postgres psql -U kiosquito -c \
  "INSERT INTO causa_merma (codigo, etiqueta, es_atribuible_a_persona, requiere_investigacion, orden)
   VALUES ('rotura_bodega','Rotura en bodega',false,true,5);"

# Registrar una merma con la causa nueva, y repetir la consulta anterior
```

La merma de `rotura_bodega` **no** aparece en `atribuible_a_persona=true`, y no hubo que tocar ninguna consulta, ningún informe ni el esquema. Antes de la enmienda v1.2 había que modificar el CHECK **y** revisar cada consulta que tuviera la lista de causas escrita a mano — y cualquier olvido significaba contabilizar un fraude interno como pérdida no atribuible, justo lo que OT3.4 existe para evitar.

**Otras negativas:**

- `PATCH /mermas/<merma_id>/causa` con `"causa": "extravio"` (no está en el catálogo) → `404`.
- Buscar un `DELETE` sobre cualquiera de los cinco catálogos → la ruta no existe (RN-CMF-008).

## Siguiente paso

El servicio de ventas de `001-core-ventas-inventario` debe llamar a `POST /caja/alertas-fraude` de este módulo al detectar un pago con tarjeta sospechoso durante una venta — es la única escritura cruzada de todo el proyecto (ver `research.md`, Decisión 3). Además, el backend debe tener configurado el scheduler interno que invoque `POST /caja/turnos/{id}/checkpoints` cada hora por cada turno abierto (enmienda v1.1, Decisión 5 de `research.md`).
