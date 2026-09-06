# Tareas de Implementación: Compras y Proveedores

**Feature**: `003-compras-proveedores` | **Fecha**: 2026-09-04
**Entrada**: `plan.md`, `data-model.md`, `contracts/compras-proveedores.openapi.yaml`

`[P]` = se puede hacer en paralelo con otras tareas `[P]` de su mismo bloque. Las tareas sin `[P]` son secuenciales dentro de su bloque.

## Fase 1 — Setup

- **T001**: Crear la migración Alembic de las 5 tablas de `data-model.md` (`proveedor`, `orden_compra`, `detalle_orden_compra`, `recepcion_orden_compra`, `historial_costo_producto`), incluyendo los CHECK constraints. Archivo: `backend/alembic/versions/xxxx_compras_proveedores.py`.
- **T002 [P]**: Crear los modelos SQLAlchemy en `backend/app/models/compras.py`.
- **T003 [P]**: Crear los esquemas Pydantic en `backend/app/schemas/compras.py`, uno por endpoint del contrato OpenAPI.

## Fase 2 — Tests de contrato primero (deben fallar antes de implementar)

- **T004 [P]**: Test de contrato `POST /api/v1/compras/ordenes` (orden normal, `es_oferta=false`) en `tests/test_compras_api.py`.
- **T005 [P]**: Test de contrato: dos `POST /compras/ordenes/{detalle_id}/recepciones` consecutivos que suman exactamente `cantidad_pedida` → verifica que el segundo deja `estado = "recibida_completa"` (RF-CP-005).
- **T006 [P]**: Test de contrato: una recepción con `cantidad_recibida_evento` mayor a lo que falta por recibir → se acepta igual, sin error (caso límite de sobre-entrega de `spec.md`).
- **T007 [P]**: Test de contrato `POST /compras/ordenes` con `es_oferta=true` seguido de `POST .../recepciones` sin haber llamado antes a `GET /compras/productos/{id}/pronostico` → espera `422` (RN-CP-001).
- **T008 [P]**: Test de contrato: tras `GET /pronostico` y `PATCH /motivo-oferta`, repetir la recepción del T007 → ahora espera `201`.
- **T009 [P]**: Test de contrato: `GET /compras/productos/{producto_id}/comparativa-proveedores` con dos proveedores que cotizaron el mismo producto → devuelve un registro por proveedor, el más reciente de cada uno (Decisión 2).
- **T010 [P]**: Test de contrato: intento de `PATCH` directo sobre el campo `estado` de una orden (endpoint no expuesto) → verifica que no existe tal ruta en el router (RNF-CP-001).
- **T011 [P]**: Test de contrato: `PATCH /proveedores/{id}/desactivar` seguido de una recepción sobre una orden ya existente de ese proveedor → sigue aceptándose (caso límite de `spec.md`).
- **T012 [P]**: Test de scoping: token de Encargado de Sucursal (no Compras) contra `POST /compras/ordenes` con `sucursal_id` fuera de su alcance → espera `403` (Art. 3.3).

## Fase 3 — Implementación core (hace pasar los tests de la Fase 2)

- **T013**: Servicio de recálculo de `cantidad_recibida` y `estado` (`backend/app/services/compras.py`, función `recalcular_estado_orden`), usado tras cada recepción (Decisión 1).
- **T014**: Servicio de validación `validar_compra_oferta` (RN-CP-001), invocado antes de aceptar cualquier recepción de un detalle con `orden_compra.es_oferta = true`.
- **T015**: Endpoints `POST /api/v1/proveedores`, `PATCH /api/v1/proveedores/{id}`, `PATCH /api/v1/proveedores/{id}/desactivar`.
- **T016**: Endpoint `POST /api/v1/compras/ordenes`, con validación de scoping por sucursal (reutiliza `backend/app/services/scoping.py` de `001-ventas-y-caja`).
- **T017**: Endpoint `POST /api/v1/compras/ordenes/{detalle_id}/recepciones`, usando T013/T014; genera también el `historial_costo_producto` correspondiente en la misma transacción (RF-CP-006).
- **T018**: Endpoints `GET /compras/productos/{producto_id}/historial-costo` y `GET .../comparativa-proveedores`, usando `DISTINCT ON` (Decisión 2).
- **T019**: Endpoint `GET /compras/productos/{producto_id}/pronostico` (stub documentado, ver Riesgos de `plan.md`) y `PATCH /compras/ordenes/{detalle_id}/motivo-oferta`.

## Fase 4 — Integración

- **T020**: Conectar cada recepción y cada entrada de `historial_costo_producto` al log de auditoría inmutable de Administración (Art. 10.5).
- **T021**: Verificar en un entorno con Docker Compose levantado que el flujo completo de `quickstart.md` pasa de principio a fin, incluyendo el escenario de recepción en dos envíos.

## Fase 5 — Polish

- **T022 [P]**: Plantillas Jinja2 (`frontend/templates/compras/proveedores.html`, `orden_compra.html`, `recepcion.html`, `comparativa_precios.html`), aplicando la paleta del Art. 11 de la constitución.
- **T023 [P]**: Reemplazar el stub de `GET /pronostico` por la llamada real al modelo de pronóstico de demanda cuando `009-analitica-reportes` esté implementado (nota cruzada, no bloquea este módulo).
- **T024 [P]**: Revisar `checklists/requirements.md` de este módulo contra la implementación final antes de marcarlo completo.

## Dependencias entre fases

Fase 1 → Fase 2 (los tests necesitan los modelos/esquemas para importarse, aunque deben fallar por lógica de negocio) → Fase 3 → Fase 4 → Fase 5. Dentro de la Fase 3, T013 y T014 son prerrequisito de T017.
