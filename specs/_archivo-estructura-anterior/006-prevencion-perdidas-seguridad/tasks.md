# Tareas de Implementación: Prevención de Pérdidas y Seguridad

**Feature**: `006-prevencion-perdidas-seguridad` | **Fecha**: 2026-09-04
**Entrada**: `plan.md`, `data-model.md`, `contracts/prevencion-perdidas-seguridad.openapi.yaml`

`[P]` = se puede hacer en paralelo con otras tareas `[P]` de su mismo bloque. Las tareas sin `[P]` son secuenciales dentro de su bloque.

## Fase 1 — Setup

- **T001**: Crear la migración Alembic de las 4 tablas propias de `data-model.md` (`merma`, `incidencia_cuadre_caja`, `datafono`, `revision_datafono`), incluyendo el índice único parcial de `incidencia_cuadre_caja`. Archivo: `backend/alembic/versions/xxxx_prevencion_perdidas_seguridad.py`. Esta migración NO toca `alerta_fraude_pago` (ya migrada en `001`).
- **T002 [P]**: Crear los modelos SQLAlchemy en `backend/app/models/perdidas.py`, importando el modelo `AlertaFraudePago` ya existente de `001-ventas-y-caja` en vez de redefinirlo.
- **T003 [P]**: Crear los esquemas Pydantic en `backend/app/schemas/perdidas.py`, uno por endpoint del contrato OpenAPI.

## Fase 2 — Tests de contrato primero (deben fallar antes de implementar)

- **T004 [P]**: Test de contrato `POST /api/v1/perdidas/mermas` sin causa → espera `201` en `tests/test_perdidas_api.py`.
- **T005 [P]**: Test de contrato `PATCH /perdidas/mermas/{id}/resultado` sobre una merma sin causa asignada → espera `422` (RN-PP-001).
- **T006 [P]**: Test de contrato: asignar causa y luego registrar resultado → espera `200` en ambos pasos.
- **T007 [P]**: Test de contrato `POST /perdidas/incidencias-cuadre` dos veces con el mismo `turno_caja_id` → el segundo espera `409`.
- **T008 [P]**: Test de contrato: tras `POST /perdidas/incidencias-cuadre`, verificar vía `GET /caja/turnos/{id}` (endpoint de `001`) que `turno_caja` no cambió ningún campo (RNF-PP-001).
- **T009 [P]**: Test de contrato: consultar el estado de un datáfono sin revisiones → verifica respuesta explícita de "sin revisión registrada" (RF-PP-009).
- **T010 [P]**: Test de contrato `PATCH /alertas-fraude-pago/{id}/atender` dos veces sobre la misma alerta → el segundo espera `422` (RN-PP-002).
- **T011 [P]**: Test de scoping: token de sucursal A contra `GET /perdidas/mermas?sucursal_id=<B>` → espera `403` (Art. 3.3).

## Fase 3 — Implementación core (hace pasar los tests de la Fase 2)

- **T012**: Endpoints `POST /perdidas/mermas`, `GET /perdidas/mermas`, `PATCH /perdidas/mermas/{id}/causa`.
- **T013**: Servicio de validación `validar_secuencia_merma` (RN-PP-001); endpoint `PATCH /perdidas/mermas/{id}/resultado`.
- **T014**: Endpoint `GET /perdidas/cuadres-caja/diferencias`, consultando `turno_caja` de `001` en modo solo lectura.
- **T015**: Endpoint `POST /perdidas/incidencias-cuadre`, con el índice único parcial capturado y devuelto como `409` legible.
- **T016**: Endpoints `POST /perdidas/datafonos` y `POST /perdidas/datafonos/{id}/revisiones`; servicio `obtener_estado_vigente_datafono` que declara explícitamente la ausencia de revisión (Decisión 2).
- **T017**: Servicio `atender_alerta_fraude` (RN-PP-002) que opera sobre el modelo `AlertaFraudePago` de `001`; endpoint `PATCH /alertas-fraude-pago/{id}/atender`, montado en el router de este módulo pero apuntando a la tabla externa (Decisión 3).

## Fase 4 — Integración

- **T018**: Conectar registro de mermas, incidencias, revisiones y atenciones al log de auditoría inmutable de Administración (Art. 10.5).
- **T019**: Verificar en un entorno con Docker Compose levantado que el flujo completo de `quickstart.md` pasa de principio a fin, incluyendo la verificación explícita de que `turno_caja` no se modifica.

## Fase 5 — Polish

- **T020 [P]**: Plantillas Jinja2 (`frontend/templates/perdidas/mermas.html`, `incidencias_cuadre.html`, `datafonos.html`, `alertas_fraude.html`), aplicando la paleta del Art. 11 de la constitución.
- **T021 [P]**: Documentar en `plan.md` la referencia cruzada hacia `009-analitica-reportes` para reemplazar el stub de incidencias de cuadre por la salida real del modelo Isolation Forest.
- **T022 [P]**: Revisar `checklists/requirements.md` de este módulo contra la implementación final antes de marcarlo completo.

## Dependencias entre fases

Fase 1 → Fase 2 (los tests necesitan los modelos/esquemas para importarse, aunque deben fallar por lógica de negocio) → Fase 3 → Fase 4 → Fase 5. Dentro de la Fase 3, T012 es prerrequisito de T013; T016 es prerrequisito de T017 solo en el sentido de que ambos comparten el router, no hay dependencia de datos entre ellos.
