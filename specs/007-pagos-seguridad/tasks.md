# Tareas de Implementación: Pagos y Seguridad

**Feature**: `007-pagos-seguridad` | **Fecha**: 2026-09-04
**Entrada**: `plan.md`, `data-model.md`, `contracts/pagos-seguridad.openapi.yaml`

`[P]` = paralelizable dentro de su bloque.

## Fase 1 — Setup

- **T001**: Migración Alembic de las 2 tablas (`datafono`, `revision_datafono`), con `codigo_serie` único y los índices.
- **T002 [P]**: Modelos SQLAlchemy en `backend/app/models/pagos_seguridad.py`.
- **T003 [P]**: Esquemas Pydantic en `backend/app/schemas/pagos_seguridad.py`.

## Fase 2 — Tests de contrato primero

- **T004 [P]**: `POST /datafonos` con `codigo_serie` repetido → `422` (RNF-PS-002).
- **T005 [P]**: `GET /datafonos/{id}/estado` de un datáfono sin revisiones → `sin_revision: true` (RN-PS-001).
- **T006 [P]**: `POST /datafonos/{id}/revisiones` seguido de `GET /datafonos/{id}/estado` → refleja la revisión más reciente.
- **T007 [P]**: Dos revisiones consecutivas del mismo datáfono → `GET /estado` devuelve la de `fecha_revision` más reciente, ambas quedan en el historial.
- **T008 [P]**: `PATCH /datafonos/{id}/baja` seguido de `GET /datafonos/{id}/estado` → el historial de revisiones sigue disponible.
- **T009 [P]**: `GET /sucursales/{sucursal_id}/datafonos` → devuelve todos los datáfonos de esa sucursal con su estado vigente.

## Fase 3 — Implementación core

- **T010**: Endpoint `POST /datafonos`.
- **T011**: Endpoint `PATCH /datafonos/{id}/baja`.
- **T012**: Servicio `obtener_estado_vigente` (DISTINCT ON / ORDER BY fecha_revision DESC LIMIT 1, o `sin_revision: true` si no hay fila); endpoints `POST /datafonos/{id}/revisiones`, `GET /datafonos/{id}/estado`.
- **T013**: Endpoint `GET /sucursales/{sucursal_id}/datafonos`, reutilizando el servicio de T012 para cada datáfono de la sucursal.

## Fase 4 — Integración

- **T014**: Verificar en Docker Compose que el flujo completo de `quickstart.md` pasa de principio a fin.

## Fase 5 — Polish

- **T015 [P]** *(actualizado por la constitución v1.3.0)*: Componentes React + TypeScript: `Datafonos.tsx`, `RevisionesDatafono.tsx`, `ConformidadTerminales.tsx`. Estilos con los tokens de Tailwind del Art. 11.1 — ningún color suelto. Animación con Framer Motion, respetando `prefers-reduced-motion` y sin retrasar el acceso a ninguna función (Art. 5.4). Nota del módulo: el indicador de conformidad es un KPI: se lee del endpoint, no se recalcula en el frontend.
- **T016 [P]**: Revisar `checklists/requirements.md` contra la implementación final.

## Fase 2b y 3b — Enmienda v1.1 (normalización de catálogos)

- **T017**: Migración del catálogo `estado_revision` **con su seed en la misma revisión** (`actualizado` con `cuenta_como_conforme=true`, `vencido` con `false`) y conversión de `revision_datafono.estado` a FK. *(Fase 1 — prerrequisito de todo lo demás.)*
- **T018 [P]**: `POST /datafonos/{id}/revisiones` con un `estado` inexistente en el catálogo → `404` (RF-PS-007).
- **T019 [P]**: `GET /catalogos/estados-revision` → los dos estados con su `cuenta_como_conforme`.
- **T020 [P]**: `GET /sucursales/{id}/datafonos/conformidad` con tres datáfonos (uno `actualizado`, uno `vencido`, uno sin revisión) → `terminales_totales: 3`, `terminales_conformes: 1`, `terminales_sin_revision: 1`, `porcentaje_conformes: 33.33` (RF-PS-008, RN-PS-001). **El datáfono sin revisión no suma al numerador.**
- **T021 [P]**: Insertar `en_revision` con `cuenta_como_conforme=false` por SQL, registrar una revisión con ese estado y repetir el endpoint de conformidad → el terminal no cuenta como conforme, **sin haber tocado la consulta ni el esquema** (RN-PS-002).
- **T022 [P]**: Verificar que ningún router expone `DELETE` sobre `estado_revision` (RN-PS-003).
- **T023**: Endpoints `GET /catalogos/estados-revision` y `GET /sucursales/{sucursal_id}/datafonos/conformidad`.
- **T024**: Implementar el numerador de conformidad como JOIN contra `estado_revision.cuenta_como_conforme`, **nunca** comparando contra el literal `'actualizado'` (RN-PS-002).

## Dependencias entre fases

Fase 1 → Fase 2 → Fase 2b → Fase 3 → Fase 3b → Fase 4 → Fase 5. T012 es prerrequisito de T013.

*(Enmienda v1.1)* **T017 va en Fase 1**: al volver `estado` una FK, ningún test que registre una revisión pasa hasta que el catálogo exista poblado. T024 es prerrequisito de que T020 y T021 pasen.
