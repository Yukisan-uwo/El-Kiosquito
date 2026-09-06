# Plan Técnico: Expansión y Sucursales

**Feature**: `009-expansion-sucursales` | **Fecha**: 2026-09-04
**Entrada**: `spec.md`

## Resumen Técnico

Módulo dueño de `sucursal` y del proceso de apertura de una nueva tienda: checklist de 8 ítems fijos, herencia de catálogo/precios base (orquestando llamadas a endpoints ya existentes de `001` y `003`), delegación de asignación de personal a `010-administracion`, y activación condicionada al checklist completo.

## Contexto Técnico

- **Lenguaje/Stack**: Python 3.11, FastAPI, SQLAlchemy, Alembic (Art. 5.1).
- **Base de datos**: PostgreSQL (capa operativa, Art. 5.2).
- **Dependencias externas de este módulo**: `producto` (`001-core-ventas-inventario`, catálogo a heredar), `historial_precio_producto` vía `POST /precios` (`003-precios-margenes`, destino de la herencia), `usuario`/`usuario_sucursal` vía `PATCH /admin/usuarios/{id}/rol-sucursales` (`010-administracion`, para OO-ES04 y `responsable_id`).
- **Consumidores de este módulo**: los 8 módulos ya entregados (001-008), que referencian `sucursal` como FK externa; `010-administracion` (`usuario_sucursal.sucursal_id`, `log_auditoria.sucursal_id`).

## Constitution Check

| Artículo | Regla | Mecanismo de cumplimiento en este módulo |
|---|---|---|
| 2.4 | Toda sucursal nueva se incorpora mediante proceso estructurado, nunca inserción manual sin checklist | `checklist_apertura_sucursal` con 8 ítems fijos, `sucursal.estado` no pasa a `operativa` sin los 8 completados (RN-ES-001) |
| 3.3 | Alcance por sucursal | Este módulo es quien crea la fila `sucursal` que el resto del sistema usa para hacer scoping — no aplica alcance por sucursal sobre sí mismo (el Dueño tiene alcance de cadena completa sobre este módulo) |
| 5.9 (extensión, Decisión 3) | Regla de honestidad de los modelos, aquí aplicada a datos operativos | La herencia de precios nunca inventa un valor cuando no existe precio previo (RN-ES-003) |
| 8.6 | Ningún flujo simula una aprobación no solicitada | La activación es una validación automática de checklist, no un flujo de aprobación gerencial |

## Estructura del Proyecto

```
backend/
  app/
    models/expansion.py
    schemas/expansion.py
    services/
      expansion.py           # checklist, activación, orquestación de herencia (llamadas a 001/003), llamada a 010 para personal
    routers/expansion.py
  alembic/versions/xxxx_expansion_sucursales.py
frontend/                              # React + Vite (constitución v1.3.0)
  src/features/expansion/
    Sucursales.tsx
    ChecklistApertura.tsx
  src/api/                             # cliente generado desde el contrato OpenAPI
tests/
  test_expansion_api.py
  test_expansion_negocio.py
```

## Endpoints REST

| Método | Ruta | Descripción | Código |
|---|---|---|---|
| POST | `/api/v1/sucursales` | Registrar sucursal, genera checklist inicial | RF-ES-001, RF-ES-002 |
| PATCH | `/api/v1/sucursales/{id}/checklist/{item}` | Marcar un ítem del checklist como completado | RF-ES-003 |
| POST | `/api/v1/sucursales/{id}/heredar-catalogo` | Ejecutar herencia de catálogo y precios (una vez) | RF-ES-004 |
| POST | `/api/v1/sucursales/{id}/personal` | Delegar asignación de personal a 010-administracion | RF-ES-005 |
| POST | `/api/v1/sucursales/{id}/activar` | Activar sucursal como operativa | RF-ES-006 |
| GET | `/api/v1/sucursales/{id}/estado-apertura` | Consultar estado del checklist en proceso | RF-ES-007 |
| PATCH | `/api/v1/sucursales/{id}/cerrar` | Dar de baja/cerrar temporalmente | RF-ES-008 |

## Modelo de Datos (resumen — ver `data-model.md`)

3 tablas: `sucursal`, `checklist_apertura_sucursal` (una fila por ítem y sucursal), `herencia_catalogo_sucursal` (log append-only de la ejecución de OO-ES03, único por sucursal).

*(Enmienda v1.1)* Más 2 catálogos maestros de clave natural: `estado_sucursal` (con `opera_ventas`) e `item_checklist_apertura` (con `orden` y `es_bloqueante`). Los dos CHECK pasan a FK.

Esta enmienda **revierte la Decisión 4** del `research.md` original, que había establecido los 8 ítems como CHECK fijo. El argumento de entonces ("conjunto cerrado y estable") vale para el vocabulario de un estado, pero no para un proceso de negocio que cambia con la experiencia: el checklist describe cómo esta cadena abre una tienda, y ajustarlo no debería ser una migración de esquema. La reversión y su motivo quedan documentados en la Decisión 5.

**RN-ES-001 no se relaja**: activar una sucursal sigue exigiendo todos los ítems completos. `es_bloqueante` protege el catálogo e informa los pendientes, nada más.

## Fases

- **Fase 0**: Este `plan.md` + `research.md` (decisiones 1-4 ya resueltas).
- **Fase 1**: `data-model.md`, `contracts/expansion-sucursales.openapi.yaml`, `quickstart.md`.
- **Fase 2**: `tasks.md` con tests de contrato primero, luego implementación.

## Riesgos y Decisiones Técnicas Pendientes

La herencia de catálogo (Decisión 3) hace una llamada HTTP por cada producto activo de la cadena hacia `003-precios-margenes` — con un catálogo grande esto puede tardar; se documenta como candidato a moverse a una tarea en background (cola/worker) en una iteración posterior, sin que eso cambie el contrato del endpoint (`POST /sucursales/{id}/heredar-catalogo` puede responder `202` con estado consultable en vez de `201` síncrono, a definir en implementación).
