# Plan Técnico: Clientes y Fidelización

**Feature**: `002-clientes-fidelizacion` | **Fecha**: 2026-09-04
**Entrada**: `spec.md`

## Resumen Técnico

Módulo dueño de `cliente` y del historial de segmentación/riesgo de abandono. No implementa K-Means ni el modelo de churn (responsabilidad de la capa estratégica), ni el mecanismo de cupones (ver `005-promociones-inteligentes`).

## Contexto Técnico

- **Stack**: Python 3.11, FastAPI, SQLAlchemy, Alembic, PostgreSQL (Art. 5.1/5.2).
- **Dependencias externas**: `venta` (`001-core-ventas-inventario`, solo lectura), `cupon` (`005-promociones-inteligentes`, FK opcional), `usuario` (Administración), `parametro_sistema` (umbral mínimo de historial).
- **Consumidores**: `001-core-ventas-inventario` ya referencia `cliente_id` desde `venta`; `005-promociones-inteligentes` referencia `cliente_id` y `evaluacion_churn_id`; Analítica y Reportes consume el historial completo.

## Constitution Check

| Artículo | Regla | Mecanismo |
|---|---|---|
| 5.9 | Ninguna cifra sin tamaño de muestra/periodo; sin datos, no se implementa | `segmento_cliente`/`evaluacion_churn` con CHECK NOT NULL en ambos campos; clientes bajo umbral no reciben fila |
| 4 (propiedad de datos) | Cada módulo escribe solo sus tablas | Nunca se escribe en `venta` ni en `cupon` |
| 8.6 | Sin aprobaciones simuladas | Envío de campaña es una operación directa con validación, no un flujo de aprobación |

## Estructura del Proyecto

```
backend/app/{models,schemas,services,routers}/clientes_fidelizacion.py
backend/alembic/versions/xxxx_clientes_fidelizacion.py
frontend/src/features/clientes/{Clientes.tsx, Segmentos.tsx, CampanasRecuperacion.tsx, HistorialSegmento.tsx}
tests/{test_clientes_fidelizacion_api.py,test_clientes_fidelizacion_negocio.py}
```

## Endpoints REST

| Método | Ruta | Descripción | Código |
|---|---|---|---|
| POST | `/api/v1/clientes` | Registrar cliente | RF-CF-001 |
| GET | `/api/v1/clientes/{id}/historial-compras` | Historial de compras | RF-CF-002 |
| GET | `/api/v1/clientes/{id}/segmento` | Segmento más reciente | RF-CF-003 |
| POST | `/api/v1/fidelizacion/segmentos` | Registrar ciclo de segmentación (Sistema) | RF-CF-003 |
| GET | `/api/v1/clientes/{id}/riesgo-abandono` | Riesgo más reciente | RF-CF-004 |
| POST | `/api/v1/fidelizacion/evaluaciones-churn` | Registrar evaluación (Sistema) | RF-CF-004 |
| POST | `/api/v1/fidelizacion/campanas-recuperacion` | Enviar campaña | RF-CF-005 |
| GET | `/api/v1/fidelizacion/campanas-recuperacion/{id}/resultado` | Consultar recuperación | RF-CF-006 |
| GET | `/api/v1/clientes/{id}/segmento/historial` | Historial de segmentos con rango de vigencia *(enmienda v1.1)* | RF-CF-010 |
| GET | `/api/v1/catalogos/segmentos` | Catálogo de segmentos con prioridad comercial *(enmienda v1.1)* | RF-CF-011 |

*(Enmienda v1.1)* `POST /fidelizacion/segmentos` no es un endpoint nuevo, pero cambia: `segmento` pasa a `segmento_codigo` (FK) y `version_modelo_id` se vuelve obligatorio. El catálogo `segmento` es de solo lectura desde la API — se modifica por migración, igual que los catálogos de vocabulario del sistema de `001`.

## Modelo de Datos (resumen — ver `data-model.md`)

4 tablas: `cliente`, `segmento_cliente` (append-only), `evaluacion_churn` (append-only), `campana_recuperacion`.

*(Enmienda v1.1)* Más 1 catálogo maestro: `segmento` (clave natural `codigo VARCHAR`, con `prioridad_comercial`). `segmento_cliente` gana `segmento_codigo` como FK (antes TEXT libre), `version_modelo_id` obligatorio hacia `011-analitica-reportes`, y `vigente_hasta` con índice único parcial — con eso **es** la dimensión SCD tipo 2 de cliente, sin necesidad de una tabla de historia aparte (Decisión 4 de `research.md`).

**Nueva dependencia de este módulo**: `version_modelo_ml` (`011-analitica-reportes`), por el `version_modelo_id` obligatorio. Es una FK de lectura: este módulo nunca escribe esa tabla. En el orden de construcción esto no genera un ciclo — `011` ya está construido bajo esta estructura.

## Fases

- **Fase 0**: `plan.md` + `research.md`.
- **Fase 1**: `data-model.md`, `contracts/clientes-fidelizacion.openapi.yaml`, `quickstart.md`.
- **Fase 2**: `tasks.md`.

## Riesgos y Decisiones Técnicas Pendientes

`POST /fidelizacion/segmentos` y `.../evaluaciones-churn` son endpoints de recepción — la implementación real de K-Means y del modelo de churn depende de la capa estratégica (Analítica y Reportes, pendiente).
