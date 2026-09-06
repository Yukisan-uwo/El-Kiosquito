# Tareas de Implementación: Ventas y Caja

**Feature**: `001-ventas-y-caja` | **Fecha**: 2026-09-04
**Entrada**: `plan.md`, `data-model.md`, `contracts/ventas-caja.openapi.yaml`

`[P]` = se puede hacer en paralelo con otras tareas `[P]` de su mismo bloque (tocan archivos distintos, sin dependencia entre sí). Las tareas sin `[P]` son secuenciales dentro de su bloque.

## Fase 1 — Setup

- **T001**: Crear la migración Alembic de las 5 tablas de `data-model.md` (`venta`, `detalle_venta`, `turno_caja`, `demanda_insatisfecha`, `alerta_fraude_pago`), incluyendo el índice único parcial de `turno_caja` y los CHECK constraints. Archivo: `backend/alembic/versions/xxxx_ventas_caja.py`.
- **T002 [P]**: Crear los modelos SQLAlchemy en `backend/app/models/ventas_caja.py`, reflejando exactamente los campos y constraints de `data-model.md`.
- **T003 [P]**: Crear los esquemas Pydantic (request/response) en `backend/app/schemas/ventas_caja.py`, uno por endpoint del contrato OpenAPI.

## Fase 2 — Tests de contrato primero (deben fallar antes de implementar)

- **T004 [P]**: Test de contrato `POST /api/v1/ventas` (venta simple, unidad completa) en `tests/test_ventas_caja_api.py`.
- **T005 [P]**: Test de contrato `POST /api/v1/ventas` con producto fraccionado y conversión correcta (escenario 2 de `spec.md`).
- **T006 [P]**: Test de contrato `POST /api/v1/ventas` con producto fraccionable sin `factor_conversion` → espera `422` (RN-VC-001).
- **T007 [P]**: Test de contrato `PATCH /api/v1/ventas/{id}/anular` sin `motivo_anulacion` → espera `422`.
- **T008 [P]**: Test de contrato `POST /api/v1/caja/turnos` y doble apertura del mismo cajero → segundo intento espera `409`.
- **T009 [P]**: Test de contrato `PATCH /api/v1/caja/turnos/{id}/cierre` sin `monto_contado` → espera `422` (RF-VC-012).
- **T010 [P]**: Test de contrato `PATCH /api/v1/caja/turnos/{id}/cierre` con ventas previas → verifica que `monto_esperado` se recalculó correctamente desde las ventas del turno (Decisión 2 de `research.md`).
- **T011 [P]**: Test de contrato `POST /api/v1/demanda-insatisfecha` sin venta asociada → espera `201`.
- **T012 [P]**: Test de contrato `POST /api/v1/alertas-fraude-pago` → verifica que la respuesta NUNCA incluye más de los últimos 4 dígitos (Art. 10.8).
- **T013 [P]**: Test de scoping por sucursal: token de sucursal A contra `turno_caja_id` de sucursal B → espera `403` (Art. 3.3, ver `quickstart.md`).

## Fase 3 — Implementación core (hace pasar los tests de la Fase 2)

- **T014**: Servicio de cálculo de IVA y totales en `backend/app/services/ventas_caja.py` (`calcular_totales_venta`), usado por `crearVenta`.
- **T015**: Servicio de conversión de unidad fraccionada (`convertir_a_unidad_inventario`), que valida `factor_conversion` y lanza `422` si falta (RN-VC-001).
- **T016**: Dependencia compartida de scoping por sucursal en `backend/app/services/scoping.py`, reutilizable por otros módulos.
- **T017**: Endpoint `POST /api/v1/ventas` en `backend/app/routers/ventas_caja.py`, usando T014/T015/T016.
- **T018**: Endpoints `PATCH /api/v1/ventas/{id}/pago`, `/descuento`, `/anular`.
- **T019**: Servicio de cálculo de `monto_esperado` (`calcular_monto_esperado_turno`), sumando ventas en efectivo del `turno_caja_id` (Decisión 2 de `research.md`).
- **T020**: Endpoints `POST /api/v1/caja/turnos`, `PATCH /caja/turnos/{id}/cierre`, `PATCH /caja/turnos/{id}/motivo-diferencia`, usando T019.
- **T021 [P]**: Endpoint `POST /api/v1/demanda-insatisfecha`.
- **T022 [P]**: Endpoint `POST /api/v1/alertas-fraude-pago`, con el filtro de datos de tarjeta de Art. 10.8 aplicado en el schema de entrada (nunca aceptar el PAN completo).

## Fase 4 — Integración

- **T023**: Conectar los 5 modelos al pipeline de auditoría inmutable (Art. 10.5) — cada operación crítica (venta, anulación, cierre de turno) genera una entrada en el log de auditoría de Administración (OT4.3), fuera de este módulo pero consumida desde aquí.
- **T024**: Verificar en un entorno con Docker Compose levantado que el flujo completo de `quickstart.md` pasa de principio a fin.

## Fase 5 — Polish

- **T025 [P]**: Plantillas Jinja2 del POS (`frontend/templates/ventas_caja/pos.html`, `caja_apertura.html`, `caja_cierre.html`), aplicando la paleta del Art. 11 de la constitución.
- **T026 [P]**: Test de regla de negocio `RN-VC-002` (toda diferencia distinta de cero exige motivo antes de considerarse cerrada) en `tests/test_ventas_caja_negocio.py`.
- **T027 [P]**: Revisar `checklists/requirements.md` de este módulo contra la implementación final antes de marcarlo completo.

## Dependencias entre fases

Fase 1 → Fase 2 (los tests necesitan los modelos/esquemas para poder importarse, aunque deben fallar por lógica de negocio, no por `ImportError`) → Fase 3 (implementación que hace pasar los tests) → Fase 4 → Fase 5. Dentro de la Fase 3, T014-T016 son prerrequisito de T017; T019 es prerrequisito de T020.
