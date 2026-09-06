# Tareas de Implementación: Expansión y Sucursales

**Feature**: `009-expansion-sucursales` | **Fecha**: 2026-09-04
**Entrada**: `plan.md`, `data-model.md`, `contracts/expansion-sucursales.openapi.yaml`

`[P]` = se puede hacer en paralelo con otras tareas `[P]` de su mismo bloque. Las tareas sin `[P]` son secuenciales dentro de su bloque.

## Fase 1 — Setup

- **T001**: Crear la migración Alembic de las 3 tablas de `data-model.md` (`sucursal`, `checklist_apertura_sucursal`, `herencia_catalogo_sucursal`), incluyendo los CHECK constraints. Archivo: `backend/alembic/versions/xxxx_expansion_sucursales.py`.
- **T002 [P]**: Crear los modelos SQLAlchemy en `backend/app/models/expansion.py`.
- **T003 [P]**: Crear los esquemas Pydantic en `backend/app/schemas/expansion.py`.

## Fase 2 — Tests de contrato primero (deben fallar antes de implementar)

- **T004 [P]**: Test de contrato `POST /api/v1/sucursales` → verifica `201` y que se generaron exactamente 8 filas en `checklist_apertura_sucursal`, todas `completado=false`.
- **T005 [P]**: Test de contrato `POST /sucursales/{id}/activar` con checklist incompleto → `422` con `items_pendientes` no vacío (RN-ES-001, CA-ES-001).
- **T006 [P]**: Test de contrato: completar los 8 ítems del checklist (incluyendo `heredar-catalogo` y `personal` mockeados) seguido de `POST /sucursales/{id}/activar` → `200`, `estado="operativa"`, `fecha_activacion` poblada.
- **T007 [P]**: Test de contrato: segundo `POST /sucursales/{id}/heredar-catalogo` sobre la misma sucursal → `409`, sin filas nuevas en el mock de `historial_precio_producto` (RN-ES-002, CA-ES-002).
- **T008 [P]**: Test de contrato: `heredar-catalogo` con un producto sin precio previo en ninguna sucursal (mockeando la respuesta de `003-precios-margenes`) → aparece en `cantidad_productos_pendientes`, no en `cantidad_productos_heredados` (RN-ES-003, CA-ES-003).
- **T009 [P]**: Test de contrato `POST /sucursales/{id}/personal` → verifica que se llamó a `PATCH /admin/usuarios/{id}/rol-sucursales` de `010-administracion` (mockeado) y que, si `es_responsable=true`, `sucursal.responsable_id` queda actualizado.
- **T010 [P]**: Test de contrato `PATCH /sucursales/{id}/cerrar` sobre una sucursal `operativa` → `200`, `estado="cerrada"`, `fecha_cierre` poblada.

## Fase 3 — Implementación core (hace pasar los tests de la Fase 2)

- **T011**: Servicio `crear_sucursal_con_checklist` (`backend/app/services/expansion.py`) — transacción única que inserta `sucursal` y las 8 filas de `checklist_apertura_sucursal`.
- **T012**: Servicio `completar_item_checklist`; endpoint `PATCH /sucursales/{id}/checklist/{item}`.
- **T013**: Cliente HTTP hacia `003-precios-margenes` (`consultar_ultimo_precio_cadena`, `registrar_precio_heredado`) y servicio `heredar_catalogo` que itera sobre productos activos (cliente HTTP hacia `001-core-ventas-inventario` para listarlos); endpoint `POST /sucursales/{id}/heredar-catalogo`, marca automáticamente los ítems `catalogo_heredado`/`precios_heredados` del checklist al finalizar.
- **T014**: Cliente HTTP hacia `010-administracion` (`asignar_rol_y_sucursales_externo`); endpoint `POST /sucursales/{id}/personal`, marca automáticamente el ítem `personal_asignado`.
- **T015**: Servicio `validar_checklist_completo` (RN-ES-001) y endpoint `POST /sucursales/{id}/activar`.
- **T016**: Endpoints `GET /sucursales/{id}/estado-apertura`, `PATCH /sucursales/{id}/cerrar`.

## Fase 4 — Integración

- **T017**: Conectar la creación de sucursal, la activación y el cierre al log de auditoría de `010-administracion` (`services/auditoria.registrar_evento`, T017/T020 de `010-administracion`).
- **T018**: Verificar en un entorno con Docker Compose levantado (con `001`, `003` y `010` también corriendo) que el flujo completo de `quickstart.md` pasa de principio a fin, incluyendo el caso del producto sin precio previo.

## Fase 5 — Polish

- **T019 [P]** *(actualizado por la constitución v1.3.0)*: Componentes React + TypeScript: `Sucursales.tsx`, `ChecklistApertura.tsx`. Estilos con los tokens de Tailwind del Art. 11.1 — ningún color suelto. Animación con Framer Motion, respetando `prefers-reduced-motion` y sin retrasar el acceso a ninguna función (Art. 5.4). Nota del módulo: el checklist se arma leyendo el catálogo en su `orden`, y separa los ítems bloqueantes de los de puesta a punto.
- **T020 [P]**: Revisar `checklists/requirements.md` de este módulo contra la implementación final antes de marcarlo completo.

## Fase 2b y 3b — Enmienda v1.1 (normalización de catálogos)

- **T040**: Migración de los 2 catálogos **con su seed en la misma revisión**: `estado_sucursal` (`operativa` con `opera_ventas=true`, los otros dos en `false`) e `item_checklist_apertura` con los 8 ítems en su `orden` real y `es_bloqueante=true` solo en `permiso_municipal` e `inspeccion_seguridad`. Conversión de los 2 CHECK a FK. *(Fase 1 — prerrequisito de todo lo demás.)*
- **T041 [P]**: `PATCH /sucursales/{id}/checklist/{item}` con un ítem inexistente en el catálogo → `404` (RF-ES-009).
- **T042 [P]**: `GET /catalogos/items-checklist-apertura` → los 8 ítems ordenados por `orden`, con `es_bloqueante` correcto (RF-ES-011).
- **T043 [P]**: `GET /catalogos/estados-sucursal` → solo `operativa` con `opera_ventas: true` (RF-ES-010).
- **T044 [P]**: `GET /sucursales/{id}/estado-apertura` con 6 de 8 ítems completos → los pendientes vienen separados en bloqueantes y no bloqueantes (RF-ES-012).
- **T045 [P]**: **Test de no-regresión de RN-ES-001/RN-ES-005**: una sucursal con los 2 ítems bloqueantes completos pero uno no bloqueante pendiente → `POST /sucursales/{id}/activar` sigue respondiendo `422`. `es_bloqueante` **no** habilita activación con excepciones.
- **T046 [P]**: Intentar dar de baja (`activo = false`) `permiso_municipal` en el catálogo → se rechaza (RN-ES-004); hacer lo mismo con `mobiliario_instalado` → se permite.
- **T047 [P]**: Insertar un ítem nuevo en el catálogo, crear una sucursal después y verificar que su checklist lo incluye; verificar que el checklist de una sucursal creada **antes** no lo incluye ni se recalcula (RN-ES-006).
- **T048**: Endpoints `GET /catalogos/items-checklist-apertura` y `GET /catalogos/estados-sucursal`.
- **T049**: Ajustar la generación del checklist (T011) para leer los ítems `activo = true` del catálogo en su `orden`, en vez de la lista fija de 8.
- **T050**: Ajustar `GET /sucursales/{id}/estado-apertura` para separar pendientes bloqueantes de no bloqueantes.

## Dependencias entre fases

Fase 1 → Fase 2 → Fase 2b → Fase 3 → Fase 3b → Fase 4 → Fase 5.

*(Enmienda v1.1)* **T040 va en Fase 1**: al volver `item` y `estado` FK, ninguna sucursal se puede crear hasta que los catálogos existan poblados. T049 modifica T011 y va después de ella. T045 es un test de no-regresión: su propósito es verificar que la enmienda **no** relajó RN-ES-001. T011 es prerrequisito de todas las demás tareas de Fase 3. T013 y T014 son prerrequisito de T015 (la activación depende de que esos ítems puedan completarse primero en un flujo real, aunque en tests se pueden mockear de forma independiente).
