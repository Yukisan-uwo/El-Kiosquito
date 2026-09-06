# Plan Técnico: Fidelización y Clientes

**Feature**: `005-fidelizacion-clientes` | **Fecha**: 2026-09-04
**Entrada**: `spec.md`

## Resumen Técnico

Módulo dueño de `cliente` (ya referenciado desde `001-ventas-y-caja`), del historial de segmentación/riesgo de abandono producido por los modelos de la capa estratégica, y del ciclo de vida de cupones y campañas de recuperación. No implementa K-Means ni el modelo de churn en sí — solo persiste sus resultados y aplica las reglas de negocio que gobiernan cómo se usan (RN-FC-001, RN-FC-002).

## Contexto Técnico

- **Lenguaje/Stack**: Python 3.11, FastAPI, SQLAlchemy, Alembic (Art. 5.1).
- **Base de datos**: PostgreSQL (capa operativa, Art. 5.2). Los modelos K-Means y de churn en sí entrenan en la capa estratégica (pandas/numpy/scikit-learn) y escriben sus resultados a través de los endpoints `POST /fidelizacion/segmentos` y `POST /fidelizacion/evaluaciones-churn` de este módulo.
- **Dependencias externas de este módulo**: `venta` (Ventas y Caja, solo lectura), `usuario` (Administración), `parametro_sistema` (Administración, umbral mínimo de historial para entrar al cálculo — Decisión 3 de `research.md`).
- **Consumidores de este módulo**: Ventas y Caja ya referencia `cliente_id` desde `001`; Analítica y Reportes consume `segmento_cliente`/`evaluacion_churn` como historial para medir el desempeño de sus propios modelos (OT4.1).

## Constitution Check

| Artículo | Regla | Mecanismo de cumplimiento en este módulo |
|---|---|---|
| 5.9 | Ningún informe de IA presenta una cifra sin declarar tamaño de muestra y periodo; si no hay datos suficientes, no se implementa | `segmento_cliente`/`evaluacion_churn` exigen `tamano_muestra`/`periodo` (CHECK NOT NULL); clientes bajo el umbral simplemente no reciben fila (Decisión 3) |
| 4 (propiedad de datos por módulo) | Cada módulo solo escribe en sus propias tablas | Este módulo nunca escribe en `venta`/`detalle_venta` (RNF-FC-002); solo consulta |
| 8.6 | Ningún flujo simula una aprobación no solicitada | El canje de cupón y el envío de campaña son operaciones directas con validación de negocio, no un flujo de solicitud/aprobación entre roles |
| 10.5 | Auditoría inmutable de operaciones críticas | Envíos de cupones, canjes y campañas de recuperación generan entrada en el log de auditoría de Administración |

## Estructura del Proyecto

```
backend/
  app/
    models/fidelizacion.py
    schemas/fidelizacion.py
    services/fidelizacion.py   # validación RN-FC-001/002, lectura cruzada de venta
    routers/fidelizacion.py
  alembic/versions/xxxx_fidelizacion_clientes.py
frontend/
  templates/fidelizacion/
    clientes.html
    segmentos.html
    cupones.html
    campanas_recuperacion.html
tests/
  test_fidelizacion_api.py
  test_fidelizacion_negocio.py
```

## Endpoints REST

| Método | Ruta | Descripción | OO |
|---|---|---|---|
| POST | `/api/v1/clientes` | Registrar un cliente | OO-FC01 |
| GET | `/api/v1/clientes/{id}/historial-compras` | Consultar historial de compras (solo lectura sobre Ventas y Caja) | OO-FC02 |
| GET | `/api/v1/clientes/{id}/segmento` | Consultar el segmento más reciente | OO-FC03 |
| POST | `/api/v1/fidelizacion/segmentos` | Registrar el resultado de un ciclo de segmentación (Sistema) | OO-FC03 |
| POST | `/api/v1/fidelizacion/cupones` | Registrar el envío de un cupón (cumpleaños o patrón de compra) | OO-FC04 / OO-FC05 |
| PATCH | `/api/v1/fidelizacion/cupones/{id}/canjear` | Registrar el canje de un cupón en una venta | OO-FC06 |
| POST | `/api/v1/fidelizacion/evaluaciones-churn` | Registrar el resultado de una evaluación de riesgo de abandono (Sistema) | OO-FC07 |
| GET | `/api/v1/clientes/{id}/riesgo-abandono` | Consultar la evaluación de riesgo más reciente | OO-FC07 |
| POST | `/api/v1/fidelizacion/campanas-recuperacion` | Registrar el envío de una campaña de recuperación | OO-FC08 |
| GET | `/api/v1/fidelizacion/campanas-recuperacion/{id}/resultado` | Consultar si el cliente recuperó actividad | OO-FC09 |

## Modelo de Datos (resumen — ver `data-model.md`)

5 tablas: `cliente`, `segmento_cliente` (append-only), `evaluacion_churn` (append-only), `cupon` (con `tipo_origen` unificado), `campana_recuperacion`.

## Fases

- **Fase 0**: Este `plan.md` + `research.md` (decisiones 1-3 ya resueltas).
- **Fase 1**: `data-model.md`, `contracts/fidelizacion-clientes.openapi.yaml`, `quickstart.md`.
- **Fase 2**: `tasks.md` con tests de contrato primero, luego implementación.

## Riesgos y Decisiones Técnicas Pendientes

`POST /fidelizacion/segmentos` y `POST /fidelizacion/evaluaciones-churn` hoy solo validan y persisten lo que reciban — la implementación real de K-Means y del modelo de churn es responsabilidad de la capa estratégica (`009-analitica-reportes`, pendiente), igual patrón de dependencia externa documentado en `003-compras-proveedores` (pronóstico) y `004-precios-margenes` (pricing dinámico).
