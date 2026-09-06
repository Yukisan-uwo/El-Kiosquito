# Tareas de Implementación: Fidelización y Clientes

**Feature**: `005-fidelizacion-clientes` | **Fecha**: 2026-09-04
**Entrada**: `plan.md`, `data-model.md`, `contracts/fidelizacion-clientes.openapi.yaml`

`[P]` = se puede hacer en paralelo con otras tareas `[P]` de su mismo bloque. Las tareas sin `[P]` son secuenciales dentro de su bloque.

## Fase 1 — Setup

- **T001**: Crear la migración Alembic de las 5 tablas de `data-model.md` (`cliente`, `segmento_cliente`, `evaluacion_churn`, `cupon`, `campana_recuperacion`), incluyendo los CHECK constraints. Archivo: `backend/alembic/versions/xxxx_fidelizacion_clientes.py`.
- **T002 [P]**: Crear los modelos SQLAlchemy en `backend/app/models/fidelizacion.py`.
- **T003 [P]**: Crear los esquemas Pydantic en `backend/app/schemas/fidelizacion.py`, uno por endpoint del contrato OpenAPI.

## Fase 2 — Tests de contrato primero (deben fallar antes de implementar)

- **T004 [P]**: Test de contrato `POST /api/v1/clientes` en `tests/test_fidelizacion_api.py`.
- **T005 [P]**: Test de contrato `GET /clientes/{id}/segmento` de un cliente sin ningún ciclo registrado → verifica `datos_suficientes: false` (RF-FC-009).
- **T006 [P]**: Test de contrato `POST /fidelizacion/segmentos` seguido de `GET /clientes/{id}/segmento` → verifica que devuelve el ciclo recién registrado con su `tamano_muestra` y periodo.
- **T007 [P]**: Test de contrato `POST /fidelizacion/cupones` con `tipo_origen=cumpleanos` y `tipo_origen=patron_compra` → ambos aceptados por el mismo endpoint (Decisión 1).
- **T008 [P]**: Test de contrato: canjear un cupón dos veces → el segundo intento espera `422` (RN-FC-001).
- **T009 [P]**: Test de contrato: canjear un cupón después de su `fecha_expiracion` → espera `422` (RN-FC-001).
- **T010 [P]**: Test de contrato `POST /fidelizacion/evaluaciones-churn` seguido de `POST /fidelizacion/campanas-recuperacion` sin ventas nuevas del cliente → espera `201`.
- **T011 [P]**: Test de contrato: repetir T010 pero con una venta nueva del cliente registrada después de la evaluación → espera `409` (RN-FC-002).
- **T012 [P]**: Test de contrato `GET /fidelizacion/campanas-recuperacion/{id}/resultado` → verifica `recupero_actividad` correcto contra el historial de ventas.
- **T013 [P]**: Test de contrato: verificar que ningún router de este módulo expone un `PATCH`/`POST`/`DELETE` sobre `venta`/`detalle_venta` (RNF-FC-002).

## Fase 3 — Implementación core (hace pasar los tests de la Fase 2)

- **T014**: Endpoint `POST /api/v1/clientes`.
- **T015**: Endpoint `GET /clientes/{id}/historial-compras`, consultando `venta`/`detalle_venta` de `001-ventas-y-caja` en modo solo lectura.
- **T016**: Servicio `obtener_segmento_vigente` (`backend/app/services/fidelizacion.py`) que traduce la ausencia de fila en "datos insuficientes" (Decisión 3); endpoints `POST /fidelizacion/segmentos` y `GET /clientes/{id}/segmento`.
- **T017**: Servicio de validación de canje `validar_canje_cupon` (RN-FC-001); endpoints `POST /fidelizacion/cupones` y `PATCH /fidelizacion/cupones/{id}/canjear`.
- **T018**: Servicio `obtener_riesgo_vigente` (mismo patrón que T016); endpoints `POST /fidelizacion/evaluaciones-churn` y `GET /clientes/{id}/riesgo-abandono`.
- **T019**: Servicio de validación `validar_envio_campana` (RN-FC-002, consulta `venta` desde la fecha de la evaluación); endpoint `POST /fidelizacion/campanas-recuperacion`.
- **T020**: Endpoint `GET /fidelizacion/campanas-recuperacion/{id}/resultado`.

## Fase 4 — Integración

- **T021**: Conectar envíos de cupones, canjes y campañas al log de auditoría inmutable de Administración (Art. 10.5).
- **T022**: Verificar en un entorno con Docker Compose levantado que el flujo completo de `quickstart.md` pasa de principio a fin, incluyendo el rechazo de RN-FC-002.

## Fase 5 — Polish

- **T023 [P]**: Plantillas Jinja2 (`frontend/templates/fidelizacion/clientes.html`, `segmentos.html`, `cupones.html`, `campanas_recuperacion.html`), aplicando la paleta del Art. 11 de la constitución.
- **T024 [P]**: Documentar en `plan.md` la referencia cruzada hacia `009-analitica-reportes` para reemplazar las llamadas manuales de segmentación/churn por los procesos batch reales.
- **T025 [P]**: Revisar `checklists/requirements.md` de este módulo contra la implementación final antes de marcarlo completo.

## Dependencias entre fases

Fase 1 → Fase 2 (los tests necesitan los modelos/esquemas para importarse, aunque deben fallar por lógica de negocio) → Fase 3 → Fase 4 → Fase 5. Dentro de la Fase 3, T016 es prerrequisito de T017 (el canje necesita poder leer el cliente); T018 es prerrequisito de T019.
