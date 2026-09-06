# Plan Técnico: Caja, Mermas y Fraude

**Feature**: `006-caja-mermas-fraude` | **Fecha**: 2026-09-04
**Entrada**: `spec.md`

## Resumen Técnico

Módulo dueño de `turno_caja`, `alerta_fraude_pago`, `merma` e `incidencia_cuadre_caja`. Es el único módulo del proyecto que recibe una escritura desde otro módulo (`alerta_fraude_pago.INSERT` desde `001-core-ventas-inventario`) — documentado explícitamente como excepción única en `research.md`, Decisión 3.

## Contexto Técnico

- **Stack**: Python 3.11, FastAPI, SQLAlchemy, Alembic, PostgreSQL (Art. 5.1/5.2). El modelo de detección de anomalías (Isolation Forest, OT4.1) entrena y se sirve desde la capa estratégica (pandas/numpy/scikit-learn) — este módulo solo expone el endpoint donde ese proceso batch inserta sus incidencias.
- **Dependencias externas**: `venta` (`001-core-ventas-inventario`, solo lectura — se consulta para calcular `monto_esperado` y para el `INSERT` de `alerta_fraude_pago` que hace ESE módulo, no este); `producto` (`001-core-ventas-inventario`, solo lectura, para `merma`); `sucursal`/`usuario` (Expansión/Administración).
- **Consumidores**: `001-core-ventas-inventario` (`venta.turno_caja_id` referencia `turno_caja` de este módulo; su servicio de ventas hace el único `INSERT` externo permitido en `alerta_fraude_pago`); Analítica y Reportes (todo el historial de mermas, cuadres e incidencias, como insumo del modelo de anomalías).

## Constitution Check

| Artículo | Regla | Mecanismo |
|---|---|---|
| 10.5 | Auditoría inmutable de operaciones críticas | `turno_caja` es append-only una vez `cerrado`; ningún endpoint permite reabrirlo |
| 5.6 | Ningún modelo de IA escribe directamente sobre datos de negocio ya cerrados | `incidencia_cuadre_caja` nunca modifica `turno_caja`, aunque estén en el mismo módulo (Decisión 2) |
| 10.8 | Nunca se almacena el número completo de una tarjeta | `alerta_fraude_pago.ultimos_4_digitos` es `CHAR(4)`, sin columna para el número completo |
| 4 (propiedad de datos) | Escritura cruzada solo si está documentada explícitamente | `alerta_fraude_pago` es la única excepción de todo el proyecto (Decisión 3) |

## Estructura del Proyecto

```
backend/app/{models,schemas,services,routers}/caja_mermas_fraude.py
backend/alembic/versions/xxxx_caja_mermas_fraude.py
frontend/src/features/caja/{Turnos.tsx, Mermas.tsx, AlertasFraude.tsx, IncidenciasCuadre.tsx}
tests/{test_caja_mermas_fraude_api.py,test_caja_mermas_fraude_negocio.py}
```

## Endpoints REST

| Método | Ruta | Descripción | Código |
|---|---|---|---|
| POST | `/api/v1/caja/turnos` | Abrir turno de caja | RF-CMF-001 |
| PATCH | `/api/v1/caja/turnos/{id}/cerrar` | Cerrar turno, calcular diferencia | RF-CMF-002, RF-CMF-003, RF-CMF-004 |
| POST | `/api/v1/mermas` | Registrar merma detectada | RF-CMF-005 |
| PATCH | `/api/v1/mermas/{id}/causa` | Asignar causa a una merma | RF-CMF-006 |
| GET | `/api/v1/mermas` | Consultar mermas por sucursal/periodo/causa | RF-CMF-007 |
| PATCH | `/api/v1/mermas/{id}/resultado` | Registrar resultado de investigación | RF-CMF-008 |
| POST | `/api/v1/caja/incidencias-cuadre` | Registrar incidencia de cuadre (Sistema) | RF-CMF-009 |
| POST | `/api/v1/caja/alertas-fraude` | Registrar alerta de fraude (llamado desde `001-core-ventas-inventario`) | RF-CMF-010 |
| PATCH | `/api/v1/caja/alertas-fraude/{id}/atender` | Atender una alerta de fraude | RF-CMF-011 |
| POST | `/api/v1/caja/turnos/{id}/checkpoints` | Generar punto de control horario (Sistema, interno, invocado por scheduler) | RF-CMF-012 *(enmienda v1.1)* |
| GET | `/api/v1/caja/turnos/{id}/checkpoints` | Consultar historial de puntos de control de un turno | RF-CMF-013 *(enmienda v1.1)* |

## Modelo de Datos (resumen — ver `data-model.md`)

5 tablas: `turno_caja`, `alerta_fraude_pago` (escritura cruzada documentada), `merma`, `incidencia_cuadre_caja` (índice único parcial), `punto_control_horario_turno` *(enmienda v1.1, generación automática)*.

*(Enmienda v1.2)* Más 5 catálogos maestros de clave natural: `causa_merma` (con `es_atribuible_a_persona` y `requiere_investigacion`), `resultado_investigacion`, `estado_turno` (con `admite_ventas`), `estado_alerta` y `estado_incidencia`. Los cinco CHECK correspondientes pasan a FK, y los enums desaparecen del contrato OpenAPI.

`es_atribuible_a_persona` es el atributo de mayor peso de toda la enmienda transversal: convierte el cruce merma × cuadre de caja de OT3.4 en un filtro sobre un dato, en lugar de una lista de códigos escrita a mano en cada consulta e informe (RN-CMF-007). `GET /mermas` gana el parámetro `atribuible_a_persona` para consumirlo directamente.

## Fases

- **Fase 0**: `plan.md` + `research.md`.
- **Fase 1**: `data-model.md`, `contracts/caja-mermas-fraude.openapi.yaml`, `quickstart.md`.
- **Fase 2**: `tasks.md`.

## Riesgos y Decisiones Técnicas Pendientes

El endpoint `POST /caja/incidencias-cuadre` (RF-CMF-009) hoy solo valida y persiste lo que le envíen — no implementa el modelo de detección de anomalías en sí (responsabilidad de la capa estratégica, módulo de Analítica y Reportes, pendiente). `001-core-ventas-inventario` debe llamar a `POST /caja/alertas-fraude` de este módulo al detectar un pago sospechoso — queda documentado aquí como el punto de integración pendiente de verificar cuando se toquen ambos módulos en conjunto.

*(Enmienda v1.1)* `POST /caja/turnos/{id}/checkpoints` necesita un disparador temporal (scheduler interno del backend, cada hora) — no es responsabilidad de este módulo implementar el scheduler en sí (es infraestructura transversal del proyecto), pero sí es responsabilidad de este módulo exponer el endpoint idempotente que ese scheduler invoca por cada turno abierto. Queda documentado como decisión de infraestructura pendiente de definir junto con el resto del backend (APScheduler, Celery beat, o un cron del contenedor — cualquiera sirve, el contrato HTTP no cambia).
