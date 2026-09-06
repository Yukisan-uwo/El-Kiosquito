# Tareas de Implementación: Precios y Márgenes

**Feature**: `004-precios-margenes` | **Fecha**: 2026-09-04
**Entrada**: `plan.md`, `data-model.md`, `contracts/precios-margenes.openapi.yaml`

`[P]` = se puede hacer en paralelo con otras tareas `[P]` de su mismo bloque. Las tareas sin `[P]` son secuenciales dentro de su bloque.

## Fase 1 — Setup

- **T001**: Crear la migración Alembic de las 4 tablas de `data-model.md` (`historial_precio_producto`, `clasificacion_producto`, `precio_competencia`, `recomendacion_precio`), incluyendo el índice único parcial de `recomendacion_precio`. Archivo: `backend/alembic/versions/xxxx_precios_margenes.py`.
- **T002 [P]**: Crear los modelos SQLAlchemy en `backend/app/models/precios.py`.
- **T003 [P]**: Crear los esquemas Pydantic en `backend/app/schemas/precios.py`, uno por endpoint del contrato OpenAPI.

## Fase 2 — Tests de contrato primero (deben fallar antes de implementar)

- **T004 [P]**: Test de contrato `POST /api/v1/precios` (registro simple) en `tests/test_precios_api.py`.
- **T005 [P]**: Test de contrato `GET /precios/{id}/margen` con precio y costo registrados → verifica el cálculo correcto.
- **T006 [P]**: Test de contrato `GET /precios/{id}/margen` de un producto SIN costo registrado → verifica `datos_suficientes: false` y que no hay ningún margen calculado con costo cero (RF-PM-004).
- **T007 [P]**: Test de contrato `POST /precios/recomendaciones` dos veces seguidas para el mismo producto/sucursal → el segundo espera `409` (RN-PM-001).
- **T008 [P]**: Test de contrato: aceptar una recomendación (`PATCH .../resolucion`) → verifica que se creó una entrada en `historial_precio_producto` con `fuente = "motor_dinamico"` y que el precio vigente cambió.
- **T009 [P]**: Test de contrato: rechazar una recomendación → verifica que el precio vigente NO cambió.
- **T010 [P]**: Test de contrato: registrar un precio manual mientras existe una recomendación pendiente para ese producto/sucursal → verifica que la recomendación pasa a `obsoleta` (caso límite de `spec.md`).
- **T011 [P]**: Test de contrato `PATCH /precios/clasificacion/{producto_id}` de un producto sin margen calculable → se acepta igual (caso límite de `spec.md`).
- **T012 [P]**: Test de scoping: token de sucursal A contra `POST /precios` con `sucursal_id` de sucursal B → espera `403` (Art. 3.3).

## Fase 3 — Implementación core (hace pasar los tests de la Fase 2)

- **T013**: Servicio de cálculo de margen (`backend/app/services/precios.py`, función `calcular_margen_real`), que consulta `historial_costo_producto` de `003-compras-proveedores` en modo lectura y declara `datos_suficientes=false` si falta cualquiera de los dos valores (RNF-PM-001).
- **T014**: Endpoint `POST /api/v1/precios`, incluyendo la lógica de marcar `obsoleta` cualquier recomendación pendiente del mismo producto/sucursal (Decisión de `data-model.md`).
- **T015**: Endpoint `GET /api/v1/precios/{producto_id}/margen`, usando T013.
- **T016**: Endpoints `POST /precios/competencia` y `GET /precios/{producto_id}/comparativa-competencia`.
- **T017**: Endpoint `PATCH /precios/clasificacion/{producto_id}`.
- **T018**: Endpoint `POST /precios/recomendaciones`, con el índice único parcial capturado y devuelto como `409` legible (no un error 500 de constraint de base de datos sin traducir).
- **T019**: Endpoint `PATCH /precios/recomendaciones/{id}/resolucion` — si `decision=aceptada`, crea la entrada correspondiente en `historial_precio_producto` con `fuente="motor_dinamico"` dentro de la misma transacción.

## Fase 4 — Integración

- **T020**: Conectar cambios de precio y resoluciones de recomendaciones al log de auditoría inmutable de Administración (Art. 10.5).
- **T021**: Verificar en un entorno con Docker Compose levantado que el flujo completo de `quickstart.md` pasa de principio a fin, incluyendo el ciclo completo de una recomendación aceptada.

## Fase 5 — Polish

- **T022 [P]**: Plantillas Jinja2 (`frontend/templates/precios/catalogo_precios.html`, `margen_real.html`, `comparativa_competencia.html`, `recomendaciones.html`), aplicando la paleta del Art. 11 de la constitución.
- **T023 [P]**: Documentar en `plan.md` la referencia cruzada hacia el módulo que reemplazará el stub de `POST /precios/recomendaciones` por el modelo real de pricing dinámico (OT4.1, `009-analitica-reportes`).
- **T024 [P]**: Revisar `checklists/requirements.md` de este módulo contra la implementación final antes de marcarlo completo.

## Dependencias entre fases

Fase 1 → Fase 2 (los tests necesitan los modelos/esquemas para importarse, aunque deben fallar por lógica de negocio) → Fase 3 → Fase 4 → Fase 5. Dentro de la Fase 3, T013 es prerrequisito de T015; T018 es prerrequisito de T019.
