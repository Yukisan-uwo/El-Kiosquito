# Tareas de Implementación: Precios y Márgenes

**Feature**: `003-precios-margenes` | **Fecha**: 2026-09-04
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
- **T012b [P]** *(enmienda v1.1)*: Test de contrato `POST /precios/competencia` sin `tipo_canal` → `422`; `GET /precios/{id}/comparativa-competencia?tipo_canal=canal_digital` con registros de varios canales → devuelve solo el más reciente del canal filtrado.

## Fase 3 — Implementación core (hace pasar los tests de la Fase 2)

- **T013**: Servicio de cálculo de margen (`backend/app/services/precios.py`, función `calcular_margen_real`), que consulta `historial_costo_producto` de `008-compras-proveedores` en modo lectura y declara `datos_suficientes=false` si falta cualquiera de los dos valores (RNF-PM-001).
- **T014**: Endpoint `POST /api/v1/precios`, incluyendo la lógica de marcar `obsoleta` cualquier recomendación pendiente del mismo producto/sucursal (Decisión de `data-model.md`).
- **T015**: Endpoint `GET /api/v1/precios/{producto_id}/margen`, usando T013.
- **T016**: Endpoints `POST /precios/competencia` y `GET /precios/{producto_id}/comparativa-competencia`, con `tipo_canal` obligatorio en el registro y filtro opcional en la consulta (enmienda v1.1).
- **T017**: Endpoint `PATCH /precios/clasificacion/{producto_id}`.
- **T018**: Endpoint `POST /precios/recomendaciones`, con el índice único parcial capturado y devuelto como `409` legible (no un error 500 de constraint de base de datos sin traducir).
- **T019**: Endpoint `PATCH /precios/recomendaciones/{id}/resolucion` — si `decision=aceptada`, crea la entrada correspondiente en `historial_precio_producto` con `fuente="motor_dinamico"` dentro de la misma transacción.

## Fase 4 — Integración

- **T020**: Conectar cambios de precio y resoluciones de recomendaciones al log de auditoría inmutable de Administración (Art. 10.5).
- **T021**: Verificar en un entorno con Docker Compose levantado que el flujo completo de `quickstart.md` pasa de principio a fin, incluyendo el ciclo completo de una recomendación aceptada.

## Fase 5 — Polish

- **T022 [P]** *(actualizado por la constitución v1.3.0)*: Componentes React + TypeScript: `CatalogoPrecios.tsx`, `MargenReal.tsx`, `ComparativaCompetencia.tsx`, `Recomendaciones.tsx`, `HistorialClasificacion.tsx`. Estilos con los tokens de Tailwind del Art. 11.1 — ningún color suelto. Animación con Framer Motion, respetando `prefers-reduced-motion` y sin retrasar el acceso a ninguna función (Art. 5.4). Nota del módulo: la comparativa por competidor y el historial de clasificación son los dos gráficos con más valor visual del módulo.
- **T023 [P]**: Documentar en `plan.md` la referencia cruzada hacia el módulo que reemplazará el stub de `POST /precios/recomendaciones` por el modelo real de pricing dinámico (OT4.1, módulo de Analítica y Reportes).
- **T024 [P]**: Revisar `checklists/requirements.md` de este módulo contra la implementación final antes de marcarlo completo.

## Fase 2b — Tests de contrato de la enmienda v1.2 (nuevas, `[P]`)

- **T040**: Migración de los 5 catálogos **con su seed en la misma revisión**, la tabla `producto_clasificacion_historial` con su índice único parcial, y la conversión de los 3 CHECK a FK. *(Fase 1 — prerrequisito de todo lo demás.)*
- **T041**: Migración de datos de `precio_competencia`: crear una `fuente_competencia` por cada valor distinto del `fuente` TEXT existente (usando su `tipo_canal` como `canal_codigo`), hacer el backfill de `fuente_competencia_id`, y **solo entonces** eliminar las columnas `fuente` y `tipo_canal`. Es la única migración destructiva de toda la enmienda transversal: si se elimina la columna antes del backfill, las observaciones históricas quedan sin competidor y no hay forma de recuperarlas.
- **T042 [P]**: `POST /precios/competencia` con `fuente_competencia_id` inexistente → `404` (RF-PM-012).
- **T043 [P]**: `POST /precios/competencia` ya no acepta `tipo_canal` en el cuerpo; el canal de la respuesta coincide con el `canal_codigo` de la fuente enviada (Decisión 5B).
- **T044 [P]**: `GET /precios/{producto_id}/comparativa-competencia?agrupar_por_fuente=true` con observaciones de tres competidores → devuelve una fila por competidor, cada una con su brecha de precio (RF-PM-014).
- **T045 [P]**: `PATCH /precios/clasificacion/{producto_id}` sin `motivo_cambio` o con menos de 10 caracteres → `422` (RN-PM-005).
- **T046 [P]**: Dos `PATCH /precios/clasificacion/{producto_id}` consecutivos → el historial queda con dos filas, la primera con `fecha_hasta` cerrado y la segunda en `null`; `clasificacion_producto` refleja solo la última (RN-PM-003).
- **T047 [P]**: `INSERT` directo en base de datos de una segunda fila de historial con `fecha_hasta = NULL` para el mismo producto → la base lo rechaza por el índice único parcial (RN-PM-004). **Test contra la base, no contra la API.**
- **T048 [P]**: `GET /precios/clasificacion/{producto_id}/historial?en_fecha=<fecha anterior al cambio>` → devuelve la clasificación **antigua**, no la vigente (RF-PM-016). Es el test que protege el cálculo de margen histórico de OT1.1.
- **T049 [P]**: `GET /catalogos/clasificaciones-comerciales` → cada fila trae `margen_objetivo_min` y `margen_objetivo_max`, con `max > min` (RF-PM-017).
- **T050 [P]**: `PATCH /catalogos/fuentes-competencia/{id}` con `activo=false` → las observaciones históricas de esa fuente siguen consultándose sin error (RN-PM-006).
- **T051 [P]**: Verificar que ningún router expone `DELETE` sobre los 5 catálogos ni sobre `producto_clasificacion_historial`.

## Fase 3b — Implementación de la enmienda v1.2

- **T052**: Servicio `reclasificar_producto`: cierra `fecha_hasta` del historial vigente, inserta la fila nueva y actualiza `clasificacion_producto`, todo en la misma transacción (RN-PM-003).
- **T053**: Servicio `obtener_clasificacion_en_fecha` (RF-PM-016) y endpoint `GET /precios/clasificacion/{producto_id}/historial`.
- **T054**: Router `catalogos.py` de este módulo: CRUD de `fuente_competencia` y consulta de `clasificaciones-comerciales`.
- **T055**: Ajustar el cálculo de margen (T013/RF-PM-003) para que lea el rango objetivo del catálogo en lugar de tenerlo fijo, y para que use la clasificación vigente **en la fecha del periodo evaluado** cuando se consulta margen histórico (RF-PM-016/017).
- **T056**: Ajustar `comparativa-competencia` para resolver el canal vía `fuente_competencia` y soportar `agrupar_por_fuente`.

## Dependencias entre fases

Fase 1 → Fase 2 (los tests necesitan los modelos/esquemas para importarse, aunque deben fallar por lógica de negocio) → Fase 2b → Fase 3 → Fase 3b → Fase 4 → Fase 5. Dentro de la Fase 3, T013 es prerrequisito de T015; T018 es prerrequisito de T019.

*(Enmienda v1.2)* **T040 → T041 es un orden estricto y no negociable**: T041 hace el backfill antes de eliminar columnas, y ejecutarlas al revés destruye datos de forma irrecuperable. Ambas van en Fase 1, antes que cualquier test. T055 modifica una tarea existente (T013), así que va después de ella. T052 es prerrequisito de T053.
