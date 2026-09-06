# Tareas de Implementación: Caja, Mermas y Fraude

**Feature**: `006-caja-mermas-fraude` | **Fecha**: 2026-09-04
**Entrada**: `plan.md`, `data-model.md`, `contracts/caja-mermas-fraude.openapi.yaml`

`[P]` = paralelizable dentro de su bloque.

## Fase 1 — Setup

- **T001**: Migración Alembic de las 5 tablas (`turno_caja`, `alerta_fraude_pago`, `merma`, `incidencia_cuadre_caja`, `punto_control_horario_turno`), con los dos índices únicos parciales (RN-CMF-001, RN-CMF-005) y todos los CHECK.
- **T002 [P]**: Modelos SQLAlchemy en `backend/app/models/caja_mermas_fraude.py`.
- **T003 [P]**: Esquemas Pydantic en `backend/app/schemas/caja_mermas_fraude.py`.

## Fase 2 — Tests de contrato primero

- **T004 [P]**: `POST /caja/turnos` dos veces seguidas para el mismo cajero → la segunda espera `409` (RN-CMF-001).
- **T005 [P]**: `PATCH /caja/turnos/{id}/cerrar` sin `monto_contado` → `422` (RF-CMF-004).
- **T006 [P]**: `PATCH /caja/turnos/{id}/cerrar` con diferencia != 0 y sin `motivo_diferencia` → `422` (RN-CMF-002).
- **T007 [P]**: `POST /mermas` con `cantidad` o `valor_estimado` en 0 → `422`.
- **T008 [P]**: `PATCH /mermas/{id}/resultado` antes de asignar `causa` → `422` (RN-CMF-003).
- **T009 [P]**: `PATCH /mermas/{id}/causa` seguido de `PATCH /mermas/{id}/resultado` → `200` en ambos.
- **T010 [P]**: `GET /mermas` filtrado por sucursal/periodo/causa → devuelve solo las coincidentes.
- **T011 [P]**: `POST /caja/incidencias-cuadre` dos veces seguidas para el mismo `turno_caja_id` → la segunda espera `409` (RN-CMF-005).
- **T012 [P]**: `POST /caja/alertas-fraude` seguido de `PATCH .../atender` → `200`, `estado` pasa a `atendida`.
- **T013 [P]**: `PATCH /caja/alertas-fraude/{id}/atender` repetido → `422` (RN-CMF-004).
- **T013b [P]** *(enmienda v1.1)*: `POST /caja/turnos/{id}/checkpoints` sobre un turno ya `cerrado` → `409`.
- **T013c [P]** *(enmienda v1.1)*: `POST /caja/turnos/{id}/checkpoints` dos veces seguidas sobre un turno `abierto` → `201` ambas veces, cada una crea una fila nueva (no es un upsert, es una serie de tiempo).
- **T013d [P]** *(enmienda v1.1)*: `GET /caja/turnos/{id}/checkpoints` → devuelve los puntos de control ordenados por `hora_checkpoint` ascendente.

## Fase 3 — Implementación core

- **T014**: Endpoint `POST /caja/turnos`, con el índice único parcial capturado y devuelto como `409` legible.
- **T015**: Servicio `calcular_monto_esperado` (suma ventas en efectivo de `001-core-ventas-inventario` filtradas por `turno_caja_id`); endpoint `PATCH /caja/turnos/{id}/cerrar`.
- **T016**: Endpoints `POST /mermas`, `PATCH /mermas/{id}/causa`, `PATCH /mermas/{id}/resultado`, `GET /mermas`.
- **T017**: Endpoint `POST /caja/incidencias-cuadre`, con el índice único parcial capturado y devuelto como `409` legible.
- **T018**: Endpoints `POST /caja/alertas-fraude` y `PATCH /caja/alertas-fraude/{id}/atender`.
- **T018b** *(enmienda v1.1)*: Endpoints `POST /caja/turnos/{id}/checkpoints` (reutiliza `calcular_monto_esperado` de T015 sobre las ventas hasta el instante actual, no hasta el cierre) y `GET /caja/turnos/{id}/checkpoints`.

## Fase 4 — Integración

- **T019**: Conectar el servicio de ventas de `001-core-ventas-inventario` a `POST /caja/alertas-fraude` de este módulo — la única escritura cruzada del proyecto (Decisión 3 de `research.md`).
- **T020**: Verificar en Docker Compose que anular una venta después del cierre de su turno no reabre el cuadre (caso límite de `spec.md`).
- **T021**: Conectar cierres de turno, mermas y atenciones de alerta al log de auditoría de Administración (Art. 10.5).
- **T021b** *(enmienda v1.1)*: Configurar el scheduler interno del backend (APScheduler o equivalente) para invocar `POST /caja/turnos/{id}/checkpoints` cada hora, una vez por cada turno con `estado = 'abierto'` (Decisión 5 de `research.md`).

## Fase 5 — Polish

- **T022 [P]** *(actualizado por la constitución v1.3.0)*: Componentes React + TypeScript: `Turnos.tsx`, `Mermas.tsx`, `AlertasFraude.tsx`, `IncidenciasCuadre.tsx`. Estilos con los tokens de Tailwind del Art. 11.1 — ningún color suelto. Animación con Framer Motion, respetando `prefers-reduced-motion` y sin retrasar el acceso a ninguna función (Art. 5.4). Nota del módulo: el listado de mermas usa el filtro `atribuible_a_persona` del catálogo, no una lista de causas en el componente.
- **T022b [P]** *(enmienda v1.1)*: Vista de solo lectura de los puntos de control de un turno dentro de `turnos.html` (línea de tiempo simple, sin plantilla nueva).
- **T023 [P]**: Revisar `checklists/requirements.md` contra la implementación final.

## Fase 2c y 3c — Enmienda v1.2 (normalización de catálogos)

- **T030**: Migración de los 5 catálogos **con su seed en la misma revisión** y conversión de los 5 CHECK a FK. El seed de `causa_merma` debe traer `es_atribuible_a_persona` en `true` para `error_humano` y `fraude_interno`, y en `false` para `robo_externo` y `caducidad`; `requiere_investigacion` en `false` solo para `caducidad`. *(Fase 1 — prerrequisito de todo lo demás.)*
- **T031 [P]**: `PATCH /mermas/{id}/causa` con una causa inexistente en el catálogo → `404` (RF-CMF-014).
- **T032 [P]**: `GET /catalogos/causas-merma` → las cuatro causas con su `es_atribuible_a_persona` en los valores del seed (RF-CMF-015).
- **T033 [P]**: `GET /mermas?atribuible_a_persona=true` con mermas de las cuatro causas registradas → devuelve solo las de `error_humano` y `fraude_interno` (RF-CMF-016).
- **T034 [P]**: Insertar una causa nueva (`rotura_bodega`, `es_atribuible_a_persona=false`) por SQL, registrar una merma con ella, y repetir `GET /mermas?atribuible_a_persona=true` → **no** aparece, sin haber tocado ninguna consulta ni el esquema. Es el test que demuestra RN-CMF-007.
- **T035 [P]**: `GET /catalogos/estados-turno` → `abierto` con `admite_ventas: true` y `cerrado` con `false`.
- **T036 [P]**: Verificar que `/catalogos/estados-alerta` y `/catalogos/estados-incidencia` son endpoints distintos con catálogos distintos, no dos vistas del mismo (Decisión 6B).
- **T037 [P]**: Verificar que ningún router expone `DELETE` sobre los 5 catálogos (RN-CMF-008).
- **T038**: Los 5 endpoints `GET /catalogos/...` en `routers/catalogos.py` de este módulo.
- **T039**: Implementar el filtro `atribuible_a_persona` de `GET /mermas` como JOIN contra `causa_merma`, **nunca** como una lista de códigos en el código del servicio (RN-CMF-007). Dejarlo comentado en el servicio: es la regla más fácil de romper por comodidad al escribir la consulta.
- **T040**: Revisar que el informe de OT3.4 (cruce merma × cuadre de caja) que consuma `011-analitica-reportes` lea `es_atribuible_a_persona` del catálogo y no reimplemente la clasificación.

## Dependencias entre fases

Fase 1 → Fase 2 → Fase 2c → Fase 3 → Fase 3c → Fase 4 → Fase 5. T015 es prerrequisito de T014's flujo de pruebas end-to-end y de T018b; T018 es prerrequisito de T019; T018b es prerrequisito de T021b.

*(Enmienda v1.2)* **T030 va en Fase 1**, antes que cualquier test: al volver los cinco campos FK, ningún test que abra un turno o registre una merma pasa hasta que los catálogos existan poblados. T039 depende de T030 y modifica una consulta ya existente. T040 es una revisión cruzada contra `011-analitica-reportes`, no un test de este módulo.
