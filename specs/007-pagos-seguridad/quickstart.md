# Guía de Arranque: Pagos y Seguridad

**Feature**: `007-pagos-seguridad` | **Fecha**: 2026-09-04

## Requisitos previos

- Docker Compose con `postgres`/`api` levantados, migraciones de `sucursal` y `usuario` aplicadas

## Levantar el entorno

```bash
docker compose up -d postgres api
docker compose exec api alembic upgrade head
```

## Flujo de prueba manual

### 1. Registrar un datáfono (RF-PS-001)

```bash
curl -X POST http://localhost:8000/api/v1/datafonos \
  -H "Authorization: Bearer $TOKEN_PERDIDAS" -H "Content-Type: application/json" \
  -d '{"sucursal_id": "<sucursal_id>", "codigo_serie": "DTF-0042"}'
```

### 2. Consultar su estado antes de cualquier revisión (RF-PS-004, RF-PS-005, RN-PS-001)

```bash
curl "http://localhost:8000/api/v1/datafonos/<datafono_id>/estado" -H "Authorization: Bearer $TOKEN_PERDIDAS"
```

Respuesta esperada: `sin_revision: true`, nunca un estado `actualizado` asumido por defecto.

### 3. Registrar una revisión de seguridad (RF-PS-003)

```bash
curl -X POST http://localhost:8000/api/v1/datafonos/<datafono_id>/revisiones \
  -H "Authorization: Bearer $TOKEN_PERDIDAS" -H "Content-Type: application/json" \
  -d '{"estado": "actualizado", "observaciones": "certificado PCI vigente hasta 2027"}'
```

Repetir la consulta del paso 2 → ahora responde el estado de esta revisión.

### 4. Listar los datáfonos de una sucursal con su estado vigente (RF-PS-006)

```bash
curl "http://localhost:8000/api/v1/sucursales/<sucursal_id>/datafonos" -H "Authorization: Bearer $TOKEN_PERDIDAS"
```

### 5. Dar de baja un datáfono sin perder su historial (RF-PS-002)

```bash
curl -X PATCH http://localhost:8000/api/v1/datafonos/<datafono_id>/baja -H "Authorization: Bearer $TOKEN_PERDIDAS"
```

Repetir el paso 2 → el historial de revisiones sigue disponible aunque `activo = false`.

### 6. Catálogo de estados y el KPI de conformidad (RF-PS-007/008, RN-PS-001/002, enmienda v1.1)

```bash
curl "http://localhost:8000/api/v1/catalogos/estados-revision" \
  -H "Authorization: Bearer $TOKEN_PERDIDAS"

curl "http://localhost:8000/api/v1/sucursales/<sucursal_id>/datafonos/conformidad" \
  -H "Authorization: Bearer $TOKEN_PERDIDAS"
```

Con tres datáfonos en la sucursal — uno `actualizado`, uno `vencido` y uno sin ninguna revisión — la respuesta esperada es `terminales_totales: 3`, `terminales_conformes: 1`, `terminales_sin_revision: 1`, `porcentaje_conformes: 33.33`.

Fíjate que **el datáfono sin revisión no suma al numerador** (RN-PS-001). Contarlo como conforme inflaría el KPI de OT4.4 justo en el caso más riesgoso: un terminal que nadie verificó nunca es precisamente el que más expone al negocio ante un fraude.

**La prueba de que el KPI no está quemado en la consulta** (RN-PS-002):

```bash
docker compose exec postgres psql -U kiosquito -c \
  "INSERT INTO estado_revision (codigo, etiqueta, cuenta_como_conforme, orden)
   VALUES ('en_revision','En revisión por el proveedor',false,3);"
```

Registra una revisión con `"estado": "en_revision"` sobre el datáfono que estaba `actualizado` y repite el endpoint de conformidad: ese terminal deja de contar como conforme, **sin haber tocado la consulta ni el esquema**. Antes de la enmienda v1.1 eso exigía modificar el CHECK y revisar cada consulta que comparara contra `'actualizado'`.

## Siguiente paso

Analítica y Reportes consume `GET /sucursales/{id}/datafonos/conformidad` para el KPI de OT4.4 ("% de terminales con validación de seguridad actualizada"), en vez de recalcularlo desde `revision_datafono` — así la definición de "conforme" vive en un solo lugar.
