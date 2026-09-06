# Tareas de Implementación: Inventario y Caducidad

**Feature**: `002-inventario-caducidad` | **Fecha**: 2026-09-04
**Entrada**: `plan.md`, `data-model.md`, `contracts/inventario-caducidad.openapi.yaml`

`[P]` = se puede hacer en paralelo con otras tareas `[P]` de su mismo bloque. Las tareas sin `[P]` son secuenciales dentro de su bloque.

## Fase 1 — Setup

- **T001**: Crear la migración Alembic de las 4 tablas de `data-model.md` (`producto`, `stock_sucursal`, `lote_producto`, `ajuste_inventario`), incluyendo el índice único de `stock_sucursal` y los CHECK constraints. Archivo: `backend/alembic/versions/xxxx_inventario_caducidad.py`.
- **T002 [P]**: Crear los modelos SQLAlchemy en `backend/app/models/inventario.py`.
- **T003 [P]**: Crear los esquemas Pydantic en `backend/app/schemas/inventario.py`, uno por endpoint del contrato OpenAPI.

## Fase 2 — Tests de contrato primero (deben fallar antes de implementar)

- **T004 [P]**: Test de contrato `POST /api/v1/productos` con `es_fraccionable=true` y `factor_conversion` presente → espera `201`.
- **T005 [P]**: Test de contrato `POST /api/v1/productos` con `es_fraccionable=true` sin `factor_conversion` → espera `422` (RN-IN-002).
- **T006 [P]**: Test de contrato `POST /api/v1/inventario/ingresos` de un producto perecedero con `fecha_caducidad` → verifica que se creó `lote_producto` además de actualizar `stock_sucursal`.
- **T007 [P]**: Test de contrato `POST /api/v1/inventario/ingresos` de un producto NO perecedero con `fecha_caducidad` enviado por error → verifica que el campo se ignora y no se crea `lote_producto` (Decisión 2 de `research.md`).
- **T008 [P]**: Test de contrato `GET /api/v1/inventario/proximos-a-caducar` sin umbral configurado en `parametro_sistema` → espera `409`.
- **T009 [P]**: Test de contrato `PATCH /api/v1/inventario/lotes/{id}/retiro` con `cantidad_retirada` mayor a `cantidad_restante` → espera `422`.
- **T010 [P]**: Test de contrato `POST /api/v1/inventario/ajustes` con un `cantidad_ajuste` negativo que dejaría stock en negativo → espera `422` (RF-IN-009).
- **T011 [P]**: Test de contrato `POST /api/v1/inventario/ajustes` con motivo vacío → espera `422` (RF-IN-008).
- **T012 [P]**: Test de scoping por sucursal: token de sucursal A contra `GET /inventario/stock/{producto_id}?sucursal_id=<B>` → espera `403` (Art. 3.3).
- **T013 [P]**: Test de contrato `POST /api/v1/inventario/rotacion/evaluar` — verifica que marca `marcado_sin_rotacion=true` para un producto con `dias_sin_venta` mayor al umbral, y lo desmarca si hubo venta reciente (escenario del caso límite 3 de `spec.md`).

## Fase 3 — Implementación core (hace pasar los tests de la Fase 2)

- **T014**: Servicio de validación `factor_conversion` en `backend/app/services/inventario.py` (`validar_fraccionamiento`), usado por `crearProducto`/`actualizarProducto` (RN-IN-002).
- **T015**: Servicio de ingreso de stock (`registrar_ingreso`) — actualiza `stock_sucursal` y crea `lote_producto` condicionalmente según `producto.es_perecedero` (Decisión 2).
- **T016**: Endpoints `POST /api/v1/productos`, `PATCH /api/v1/productos/{id}`, usando T014.
- **T017**: Endpoint `POST /api/v1/inventario/ingresos`, usando T015.
- **T018**: Servicio de consulta de umbrales (`obtener_umbral`) que lee `parametro_sistema` de Administración — lanza `409` si no existe (Decisión 3).
- **T019**: Endpoint `GET /api/v1/inventario/proximos-a-caducar`, usando T018.
- **T020**: Endpoint `PATCH /api/v1/inventario/lotes/{id}/retiro`, con validación de `cantidad_restante` antes de actualizar.
- **T021**: Endpoint `GET /api/v1/inventario/stock/{producto_id}`, con la dependencia de scoping compartida de `001-ventas-y-caja` (`backend/app/services/scoping.py`).
- **T022**: Servicio de ajuste (`aplicar_ajuste_inventario`) que recalcula el resultado antes de persistir y rechaza si es negativo (RF-IN-009); endpoint `POST /api/v1/inventario/ajustes`.
- **T023**: Servicio y endpoint del proceso batch de rotación (`evaluar_rotacion`, `POST /api/v1/inventario/rotacion/evaluar`), usando el umbral de T018.
- **T024**: Endpoint `GET /api/v1/inventario/sin-rotacion`.

## Fase 4 — Integración

- **T025**: Conectar ingresos, retiros y ajustes al log de auditoría inmutable de Administración (Art. 10.5), mismo patrón que T023 de `001-ventas-y-caja`.
- **T026**: Verificar en un entorno con Docker Compose levantado que el flujo completo de `quickstart.md` pasa de principio a fin.

## Fase 5 — Polish

- **T027 [P]**: Plantillas Jinja2 (`frontend/templates/inventario/catalogo.html`, `ingreso_stock.html`, `proximos_a_caducar.html`, `sin_rotacion.html`), aplicando la paleta del Art. 11 de la constitución.
- **T028 [P]**: Programar `POST /inventario/rotacion/evaluar` como tarea periódica en el DAG de Airflow (Analítica y Reportes, OT3.6), no como job manual.
- **T029 [P]**: Revisar `checklists/requirements.md` de este módulo contra la implementación final antes de marcarlo completo.

## Dependencias entre fases

Fase 1 → Fase 2 (los tests necesitan los modelos/esquemas para importarse, aunque deben fallar por lógica de negocio) → Fase 3 → Fase 4 → Fase 5. Dentro de la Fase 3, T014 es prerrequisito de T016; T018 es prerrequisito de T019 y T023.
