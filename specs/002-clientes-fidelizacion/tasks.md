# Tareas de Implementación: Clientes y Fidelización

**Feature**: `002-clientes-fidelizacion` | **Fecha**: 2026-09-04
**Entrada**: `plan.md`, `data-model.md`, `contracts/clientes-fidelizacion.openapi.yaml`

`[P]` = paralelizable dentro de su bloque.

## Fase 1 — Setup

- **T001**: Migración Alembic de las 4 tablas (`cliente`, `segmento_cliente`, `evaluacion_churn`, `campana_recuperacion`), con CHECK, índices y el FK externo nullable `campana_recuperacion.cupon_id`.
- **T002 [P]**: Modelos SQLAlchemy en `backend/app/models/clientes_fidelizacion.py`.
- **T003 [P]**: Esquemas Pydantic en `backend/app/schemas/clientes_fidelizacion.py`.

## Fase 2 — Tests de contrato primero

- **T004 [P]**: `POST /clientes` con datos válidos → `201`.
- **T005 [P]**: `GET /clientes/{id}/historial-compras` de un cliente con ventas en `001-core-ventas-inventario` → devuelve la lista correcta.
- **T006 [P]**: `POST /fidelizacion/segmentos` sin `tamano_muestra` o sin `periodo_inicio`/`periodo_fin` → `422` (Art. 5.9).
- **T007 [P]**: `GET /clientes/{id}/segmento` de un cliente sin ciclo registrado → `datos_suficientes: false`, nunca un segmento inventado (RF-CF-007).
- **T008 [P]**: `POST /fidelizacion/evaluaciones-churn` con `justificacion` menor a 10 caracteres → `422`.
- **T009 [P]**: `GET /clientes/{id}/riesgo-abandono` de un cliente sin evaluación → `datos_suficientes: false`.
- **T010 [P]**: `POST /fidelizacion/campanas-recuperacion` para un cliente que ya compró después de `evaluacion_churn.fecha_evaluacion` → `409` (RN-CF-001).
- **T011 [P]**: `POST /fidelizacion/campanas-recuperacion` para un cliente en riesgo que no volvió a comprar → `201`.
- **T012 [P]**: `GET /fidelizacion/campanas-recuperacion/{id}/resultado` con compra posterior a `fecha_envio` → `recupero_actividad: true`.

## Fase 3 — Implementación core

- **T013**: Servicio `consultar_historial_compras` (lectura cross-módulo sobre `venta`/`detalle_venta` de `001-core-ventas-inventario`, sin JOIN de escritura).
- **T014**: Endpoints `POST /clientes`, `GET /clientes/{id}/historial-compras`.
- **T015**: Servicio `obtener_segmento_reciente` (DISTINCT ON / ORDER BY fecha_calculo DESC LIMIT 1, o `datos_suficientes: false` si no hay fila); endpoint `POST /fidelizacion/segmentos`, `GET /clientes/{id}/segmento`.
- **T016**: Servicio `obtener_riesgo_reciente` (mismo patrón); endpoints `POST /fidelizacion/evaluaciones-churn`, `GET /clientes/{id}/riesgo-abandono`.
- **T017**: Servicio `validar_sin_recompra` (RN-CF-001: consulta `venta.fecha_hora > evaluacion_churn.fecha_evaluacion` antes del `INSERT`); endpoint `POST /fidelizacion/campanas-recuperacion`.
- **T018**: Endpoint `GET /fidelizacion/campanas-recuperacion/{id}/resultado`.

## Fase 2b — Tests de contrato de la enmienda v1.1 (nuevas, `[P]`)

- **T023**: Migración del catálogo `segmento` **con su seed en la misma revisión Alembic**, más los tres cambios en `segmento_cliente`: `segmento` TEXT → `segmento_codigo` FK, `version_modelo_id` NOT NULL, `vigente_hasta` nullable, y el índice único parcial `UNIQUE (cliente_id) WHERE vigente_hasta IS NULL`. *(Fase 1 — prerrequisito de todo lo demás de la enmienda; sin catálogo poblado ningún `POST /fidelizacion/segmentos` funciona.)*
- **T024 [P]**: `POST /fidelizacion/segmentos` con `segmento_codigo` inexistente → `404` (RF-CF-008).
- **T025 [P]**: `POST /fidelizacion/segmentos` sin `version_modelo_id` → `422` (RF-CF-009).
- **T026 [P]**: Dos `POST /fidelizacion/segmentos` consecutivos para el mismo cliente → el primero queda con `vigente_hasta` cerrado y el segundo con `vigente_hasta: null` (RN-CF-003).
- **T027 [P]**: Intentar insertar directamente en base de datos una segunda fila con `vigente_hasta = NULL` para un cliente que ya tiene una → la base la rechaza por el índice único parcial (RN-CF-002). **Este test va contra la base, no contra la API**: comprueba que la regla es del esquema y no solo del servicio.
- **T028 [P]**: `GET /clientes/{id}/segmento/historial` de un cliente con tres ciclos → devuelve las tres asignaciones ordenadas cronológicamente, con solo la última en `vigente_hasta: null` (RF-CF-010).
- **T029 [P]**: `GET /clientes/{id}/segmento/historial` de un cliente sin ningún ciclo → lista vacía, nunca `404` ni error (coherente con RF-CF-007).
- **T030 [P]**: `GET /catalogos/segmentos` → cada fila trae `prioridad_comercial` entre 1 y 10 (RF-CF-011).
- **T031 [P]**: Verificar que ningún router expone `DELETE` sobre `segmento` (RN-CF-004).

## Fase 3b — Implementación de la enmienda v1.1

- **T032**: Modificar `registrar_ciclo_segmentacion` para que cierre la vigencia de la asignación anterior e inserte la nueva **en la misma transacción** (RN-CF-003). Si la transacción falla a la mitad, el cliente no puede quedar sin ningún segmento vigente.
- **T033**: Endpoint `GET /clientes/{id}/segmento/historial` y `GET /catalogos/segmentos`.
- **T034**: Ajustar `obtener_segmento_reciente` (T015) para que consulte por `vigente_hasta IS NULL` en vez de `ORDER BY fecha_calculo DESC LIMIT 1` — es la misma respuesta, pero deja de depender del orden y usa el índice único parcial.

## Fase 4 — Integración

- **T019**: Verificar que `venta.cliente_id` (`001-core-ventas-inventario`) resuelve correctamente contra `cliente.id` de este módulo en un entorno Docker Compose compartido.
- **T020**: Dejar el FK `campana_recuperacion.cupon_id` como columna nullable sin restricción activa hasta que `005-promociones-inteligentes` exista (documentar en migración).

## Fase 5 — Polish

- **T021 [P]** *(actualizado por la constitución v1.3.0)*: Componentes React + TypeScript: `Clientes.tsx`, `Segmentos.tsx`, `CampanasRecuperacion.tsx`, `HistorialSegmento.tsx`. Estilos con los tokens de Tailwind del Art. 11.1 — ningún color suelto. Animación con Framer Motion, respetando `prefers-reduced-motion` y sin retrasar el acceso a ninguna función (Art. 5.4). Nota del módulo: el historial de segmento se presta a una línea de tiempo animada, que es donde el movimiento sí aporta lectura.
- **T022 [P]**: Revisar `checklists/requirements.md` contra la implementación final.

## Dependencias entre fases

Fase 1 → Fase 2 → Fase 2b → Fase 3 → Fase 3b → Fase 4 → Fase 5. T013 es prerrequisito de T014; T015/T016 son prerrequisito de T017.

*(Enmienda v1.1)* **T023 es prerrequisito de todo lo demás del módulo**, incluidas las tareas ya existentes: al volver `segmento` una FK, ningún test que registre un ciclo de segmentación pasa hasta que el catálogo exista y esté poblado. Por eso se ejecuta en Fase 1 aunque su numeración sea posterior. T034 modifica una tarea ya existente (T015), así que debe hacerse después de ella, no en paralelo.
