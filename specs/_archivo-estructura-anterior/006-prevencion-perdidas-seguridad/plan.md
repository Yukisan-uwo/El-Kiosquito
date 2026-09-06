# Plan Técnico: Prevención de Pérdidas y Seguridad

**Feature**: `006-prevencion-perdidas-seguridad` | **Fecha**: 2026-09-04
**Entrada**: `spec.md`

## Resumen Técnico

Módulo dueño del ciclo de vida de las mermas y de la revisión de seguridad de datáfonos. Consume en modo lectura los cuadres de caja de Ventas y Caja para generar incidencias de posible fraude interno sin modificarlos, y es el único módulo del proyecto autorizado a escribir (solo el `UPDATE` de atención) sobre una tabla de otro módulo (`alerta_fraude_pago`), excepción documentada en `research.md`.

## Contexto Técnico

- **Lenguaje/Stack**: Python 3.11, FastAPI, SQLAlchemy, Alembic (Art. 5.1).
- **Base de datos**: PostgreSQL (capa operativa, Art. 5.2).
- **Dependencias externas de este módulo**: `producto` (Inventario), `sucursal`/`usuario` (Expansión/Administración), `turno_caja` y `alerta_fraude_pago` (Ventas y Caja, `001-ventas-y-caja`) — las dos únicas tablas de otro módulo que este consulta o modifica.
- **Consumidores de este módulo**: Analítica y Reportes consume `merma` (con causa clasificada) para el KPI de OT1.2/OT3.4, e `incidencia_cuadre_caja`/`revision_datafono` como historial de seguridad para OT4.4.

## Constitution Check

| Artículo | Regla | Mecanismo de cumplimiento en este módulo |
|---|---|---|
| 5.6/5.9 | Ningún modelo actúa de forma autónoma; ninguna cifra sin justificación | El modelo de anomalías solo crea `incidencia_cuadre_caja` con `justificacion` obligatoria, nunca modifica `turno_caja` directamente (Decisión 1) |
| 4 (propiedad de datos por módulo) | Cada módulo solo escribe en sus propias tablas | Única excepción documentada explícitamente: `alerta_fraude_pago` (Decisión 3) — cualquier lector de este plan debe poder ver la excepción sin tener que inferirla |
| 8.6 | Ningún flujo simula una aprobación no solicitada | Atender una alerta o resolver una incidencia es una operación directa con un solo paso, no una cadena de aprobadores |
| 10.5 | Auditoría inmutable de operaciones críticas | Registro de mermas, incidencias y atenciones generan entrada en el log de auditoría de Administración |

## Estructura del Proyecto

```
backend/
  app/
    models/perdidas.py
    schemas/perdidas.py
    services/perdidas.py       # secuencia causa→resultado de merma, atención de alerta_fraude_pago, estado derivado de datáfono
    routers/perdidas.py
  alembic/versions/xxxx_prevencion_perdidas_seguridad.py
frontend/
  templates/perdidas/
    mermas.html
    incidencias_cuadre.html
    datafonos.html
    alertas_fraude.html
tests/
  test_perdidas_api.py
  test_perdidas_negocio.py
```

## Endpoints REST

| Método | Ruta | Descripción | OO |
|---|---|---|---|
| POST | `/api/v1/perdidas/mermas` | Registrar una merma detectada | OO-PP01 |
| PATCH | `/api/v1/perdidas/mermas/{id}/causa` | Asignar causa a una merma | OO-PP02 |
| GET | `/api/v1/perdidas/mermas` | Consultar mermas por sucursal/periodo/causa | OO-PP03 |
| GET | `/api/v1/perdidas/cuadres-caja/diferencias` | Consultar diferencias de cuadre por sucursal/cajero | OO-PP04 |
| POST | `/api/v1/perdidas/incidencias-cuadre` | Registrar incidencia de posible fraude interno (Sistema) | OO-PP05 |
| POST | `/api/v1/perdidas/datafonos` | Registrar un datáfono | Base |
| POST | `/api/v1/perdidas/datafonos/{id}/revisiones` | Registrar revisión de seguridad de un datáfono | OO-PP06 |
| PATCH | `/api/v1/alertas-fraude-pago/{id}/atender` | Atender una alerta de fraude en pago (tabla de `001`) | OO-PP07 |
| PATCH | `/api/v1/perdidas/mermas/{id}/resultado` | Registrar resultado de investigación de una merma | OO-PP08 |

## Modelo de Datos (resumen — ver `data-model.md`)

4 tablas propias (`merma`, `incidencia_cuadre_caja`, `datafono`, `revision_datafono`) + 1 tabla externa modificada bajo excepción documentada (`alerta_fraude_pago` de `001`).

## Fases

- **Fase 0**: Este `plan.md` + `research.md` (decisiones 1-3 ya resueltas).
- **Fase 1**: `data-model.md`, `contracts/prevencion-perdidas-seguridad.openapi.yaml`, `quickstart.md`.
- **Fase 2**: `tasks.md` con tests de contrato primero, luego implementación.

## Riesgos y Decisiones Técnicas Pendientes

`POST /perdidas/incidencias-cuadre` hoy solo valida y persiste lo que le envíe el proceso batch — la implementación real del modelo Isolation Forest es responsabilidad de la capa estratégica (`009-analitica-reportes`, pendiente), mismo patrón de dependencia externa documentado en los módulos anteriores.
