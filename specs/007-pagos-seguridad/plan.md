# Plan Técnico: Pagos y Seguridad

**Feature**: `007-pagos-seguridad` | **Fecha**: 2026-09-04
**Entrada**: `spec.md`

## Resumen Técnico

Módulo dueño del catálogo de datáfonos por sucursal y de su historial append-only de revisiones de seguridad. No comparte tablas con `006-caja-mermas-fraude` (Decisión 1 de `research.md`) ni con ningún otro módulo — es autocontenido salvo por sus FK hacia `sucursal` y `usuario`.

## Contexto Técnico

- **Stack**: Python 3.11, FastAPI, SQLAlchemy, Alembic, PostgreSQL (Art. 5.1/5.2).
- **Dependencias externas**: `sucursal` (Expansión), `usuario` (Administración).
- **Consumidores**: Analítica y Reportes (histórico de revisiones para el KPI de OT4.4, "% de terminales con validación de seguridad actualizada").

## Constitution Check

| Artículo | Regla | Mecanismo |
|---|---|---|
| 5.9 | Ninguna cifra sin respaldo; sin datos, se declara explícitamente | Un datáfono sin revisiones responde `sin_revision: true`, nunca un estado asumido (RN-PS-001) |
| 10.8 | Seguridad de pagos electrónicos | Historial completo de revisiones, nunca sobrescrito, auditable por sucursal y por terminal |

## Estructura del Proyecto

```
backend/app/{models,schemas,services,routers}/pagos_seguridad.py
backend/alembic/versions/xxxx_pagos_seguridad.py
frontend/src/features/pagos/{Datafonos.tsx, RevisionesDatafono.tsx, ConformidadTerminales.tsx}
tests/{test_pagos_seguridad_api.py,test_pagos_seguridad_negocio.py}
```

## Endpoints REST

| Método | Ruta | Descripción | Código |
|---|---|---|---|
| POST | `/api/v1/datafonos` | Registrar un datáfono nuevo | RF-PS-001 |
| PATCH | `/api/v1/datafonos/{id}/baja` | Dar de baja un datáfono | RF-PS-002 |
| POST | `/api/v1/datafonos/{id}/revisiones` | Registrar una revisión de seguridad | RF-PS-003 |
| GET | `/api/v1/datafonos/{id}/estado` | Consultar el estado vigente | RF-PS-004, RF-PS-005 |
| GET | `/api/v1/sucursales/{sucursal_id}/datafonos` | Listar datáfonos de una sucursal con su estado vigente | RF-PS-006 |

## Modelo de Datos (resumen — ver `data-model.md`)

2 tablas: `datafono` (catálogo simple), `revision_datafono` (append-only).

*(Enmienda v1.1)* Más 1 catálogo maestro de clave natural: `estado_revision`, con `cuenta_como_conforme`. `revision_datafono.estado` pasa de CHECK a FK y el enum desaparece del contrato. Se agregan `GET /catalogos/estados-revision` y `GET /sucursales/{id}/datafonos/conformidad` — este último materializa el KPI de OT4.4 como endpoint, que hasta ahora había que armar a mano desde el listado.

## Fases

- **Fase 0**: `plan.md` + `research.md`.
- **Fase 1**: `data-model.md`, `contracts/pagos-seguridad.openapi.yaml`, `quickstart.md`.
- **Fase 2**: `tasks.md`.

## Riesgos y Decisiones Técnicas Pendientes

Ninguno — este es el módulo más autocontenido del proyecto hasta ahora, sin escrituras cruzadas ni dependencias de un modelo de IA todavía no implementado.
