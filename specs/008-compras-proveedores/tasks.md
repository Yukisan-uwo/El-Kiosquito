# Tareas de Implementación: Compras y Proveedores

**Feature**: `008-compras-proveedores` | **Fecha**: 2026-09-04
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
- **T008 [P]**: Test de contrato: tras `GET /pronostico` (mockeando la respuesta de `004-pronostico-demanda`) y `PATCH /motivo-oferta`, repetir la recepción del T007 → ahora espera `201`.
- **T009 [P]**: Test de contrato: `GET /pronostico` cuando `004-pronostico-demanda` responde `datos_suficientes: false` → este endpoint marca `pronostico_consultado=true` sin `cantidad_recomendada_pronostico`, y cualquier `cantidad_pedida` exige motivo.
- **T010 [P]**: Test de contrato: `GET /compras/productos/{producto_id}/comparativa-proveedores` con dos proveedores que cotizaron el mismo producto → devuelve un registro por proveedor, el más reciente de cada uno (Decisión 2).
- **T011 [P]**: Test de contrato: intento de `PATCH` directo sobre el campo `estado` de una orden (endpoint no expuesto) → verifica que no existe tal ruta en el router (RNF-CP-001).
- **T012 [P]**: Test de contrato: `PATCH /proveedores/{id}/desactivar` seguido de una recepción sobre una orden ya existente de ese proveedor → sigue aceptándose (caso límite de `spec.md`).
- **T013 [P]**: Test de scoping: token de Encargado de Sucursal (no Compras) contra `POST /compras/ordenes` con `sucursal_id` fuera de su alcance → espera `403` (Art. 3.3).

## Fase 2b — Tests de contrato de la enmienda v1.1 (nuevas, `[P]`)

- **T013b [P]**: `POST /compras/ordenes` sin `forma_pago` → `422` (RF-CP-012 obligatorio).
- **T013c [P]**: `POST /compras/ordenes` con `forma_pago: "credito"` → `201`, la respuesta incluye `forma_pago` en la orden creada.
- **T013d [P]**: `POST /compras/ordenes/{detalle_id}/recepciones` sin `numero_documento_proveedor` → `201` igual (opcional, no bloquea, RF-CP-013).
- **T013e [P]**: `POST /compras/ordenes/{detalle_id}/recepciones` con `numero_documento_proveedor` presente → se persiste y aparece en la consulta del evento de recepción correspondiente.

## Fase 3 — Implementación core (hace pasar los tests de la Fase 2)

- **T014**: Servicio de recálculo de `cantidad_recibida` y `estado` (`backend/app/services/compras.py`, función `recalcular_estado_orden`), usado tras cada recepción (Decisión 1).
- **T015**: Servicio de validación `validar_compra_oferta` (RN-CP-001), invocado antes de aceptar cualquier recepción de un detalle con `orden_compra.es_oferta = true`.
- **T016**: Endpoints `POST /api/v1/proveedores`, `PATCH /api/v1/proveedores/{id}`, `PATCH /api/v1/proveedores/{id}/desactivar`.
- **T017**: Endpoint `POST /api/v1/compras/ordenes`, con validación de scoping por sucursal (reutiliza `backend/app/services/scoping.py` de `001-core-ventas-inventario`).
- **T018**: Endpoint `POST /api/v1/compras/ordenes/{detalle_id}/recepciones`, usando T014/T015; genera también el `historial_costo_producto` correspondiente en la misma transacción (RF-CP-006).
- **T019**: Endpoints `GET /compras/productos/{producto_id}/historial-costo` y `GET .../comparativa-proveedores`, usando `DISTINCT ON` (Decisión 2).
- **T020**: Cliente HTTP hacia `004-pronostico-demanda` (`backend/app/services/compras.py`, función `consultar_pronostico_externo`); endpoint `GET /compras/productos/{producto_id}/pronostico` (Decisión 4, ya no es un stub) y `PATCH /compras/ordenes/{detalle_id}/motivo-oferta`.
- **T020b** *(enmienda v1.1)*: Sin servicio nuevo — `forma_pago` se valida con el CHECK de la migración de T001 dentro de T017 (`POST /compras/ordenes`); `numero_documento_proveedor` se persiste como campo opcional dentro de T018 (`POST .../recepciones`).

## Fase 4 — Integración

- **T021**: Conectar cada recepción y cada entrada de `historial_costo_producto` al log de auditoría inmutable de Administración (Art. 10.5).
- **T022**: Verificar en un entorno con Docker Compose levantado (con `004-pronostico-demanda` también corriendo) que el flujo completo de `quickstart.md` pasa de principio a fin, incluyendo el escenario de recepción en dos envíos y la consulta real de pronóstico.

## Fase 5 — Polish

- **T023 [P]** *(actualizado por la constitución v1.3.0)*: Componentes React + TypeScript: `Proveedores.tsx`, `OrdenCompra.tsx`, `RecepcionOrden.tsx`, `ComparativaPrecios.tsx`. Estilos con los tokens de Tailwind del Art. 11.1 — ningún color suelto. Animación con Framer Motion, respetando `prefers-reduced-motion` y sin retrasar el acceso a ninguna función (Art. 5.4). Nota del módulo: el estado de la orden se muestra, nunca se edita desde la interfaz (RNF-CP-001).
- **T024 [P]**: Revisar `checklists/requirements.md` de este módulo contra la implementación final antes de marcarlo completo.

## Fase 2c y 3c — Enmienda v1.2 (normalización de catálogos)

- **T025**: Migración de los 2 catálogos **con su seed en la misma revisión** (`forma_pago` con `contado`/`dias_plazo_default=0` y `credito`/`30`; `estado_orden_compra` con `permite_recepcion` en `false` solo para `recibida_completa` y `cancelada`) y conversión de los 2 CHECK de `orden_compra` a FK. *(Fase 1 — prerrequisito de todo lo demás.)*
- **T026 [P]**: `POST /compras/ordenes` con `forma_pago` inexistente en el catálogo → `404` (RF-CP-014).
- **T027 [P]**: `GET /catalogos/formas-pago` → `credito` trae `dias_plazo_default` mayor a 0 y `contado` lo trae en 0 (RF-CP-015).
- **T028 [P]**: `GET /catalogos/estados-orden-compra` → `recibida_completa` y `cancelada` con `permite_recepcion: false`, los otros dos en `true` (RF-CP-016).
- **T029 [P]**: Intentar registrar una recepción sobre una orden en `recibida_completa` → se rechaza, y la validación consulta el catálogo, no una lista de estados en el servicio (RN-CP-002).
- **T030 [P]**: **Test de no-regresión de RNF-CP-001**: verificar que sigue sin existir ninguna ruta que escriba `orden_compra.estado` directamente, pese a que ahora es una FK. Convertirlo a catálogo no debe haber abierto una vía de escritura (Decisión 6A).
- **T031 [P]**: Insertar `credito_60` en `forma_pago` por SQL y crear una orden con esa forma de pago → `201`, sin migración de esquema.
- **T032 [P]**: Verificar que ningún router expone `DELETE` sobre los 2 catálogos (RN-CP-003).
- **T033**: Endpoints `GET /catalogos/formas-pago` y `GET /catalogos/estados-orden-compra`.
- **T034**: Ajustar la validación de recepción para consultar `estado_orden_compra.permite_recepcion` en vez de comparar contra estados escritos a mano (RN-CP-002).

## Dependencias entre fases

Fase 1 → Fase 2 → Fase 2b → Fase 2c → Fase 3 → Fase 3c → Fase 4 → Fase 5.

*(Enmienda v1.2)* **T025 va en Fase 1**: al volver `forma_pago` y `estado` FK, ningún test que cree una orden pasa hasta que los catálogos existan poblados. T034 modifica la lógica de T018 y va después de ella. T030 es un test de no-regresión y debe ejecutarse **después** de T025, porque su propósito es verificar que la migración no aflojó RNF-CP-001. Dentro de la Fase 3, T014 y T015 son prerrequisito de T018; T020 es prerrequisito de las pruebas de integración de T022. T020b no tiene dependencias fuera de T017/T018.
