# Plan Técnico: Precios y Márgenes

**Feature**: `003-precios-margenes` | **Fecha**: 2026-09-04
**Entrada**: `spec.md`

## Resumen Técnico

Módulo dueño del precio de venta vigente por producto/sucursal, del cálculo de margen real, de la comparación contra precios de competencia y del ciclo de vida de las recomendaciones del motor de pricing dinámico. No modifica ninguna tabla de otro módulo — ni `producto` (`001-core-ventas-inventario`) ni `historial_costo_producto` (`008-compras-proveedores`), solo los consulta.

## Contexto Técnico

- **Lenguaje/Stack**: Python 3.11, FastAPI, SQLAlchemy, Alembic (Art. 5.1).
- **Base de datos**: PostgreSQL (capa operativa, Art. 5.2). El motor de pricing dinámico en sí (el modelo scikit-learn de OT4.1) entrena y se sirve desde la capa estratégica (pandas/numpy/scikit-learn) — este módulo solo expone el endpoint donde ese proceso batch inserta sus recomendaciones, no implementa el modelo.
- **Dependencias externas de este módulo**: `producto` (`001-core-ventas-inventario`), `historial_costo_producto` (`008-compras-proveedores`, solo lectura), `sucursal` (Expansión), `usuario` (Administración).
- **Consumidores de este módulo**: `001-core-ventas-inventario` (`historial_precio_producto` para el precio vigente en cada venta — snapshot en `detalle_venta.precio_unitario_aplicado`), Analítica y Reportes (todo el historial de precios y recomendaciones, para medir el desempeño del motor).

## Constitution Check

| Artículo | Regla | Mecanismo de cumplimiento en este módulo |
|---|---|---|
| 5.6/5.9 | Ningún modelo de IA actúa de forma autónoma; ninguna cifra sin justificación | `recomendacion_precio.justificacion` obligatoria (CHECK longitud mínima); el motor solo crea filas `pendiente`, nunca aplica el precio directamente (Decisión 3) |
| 8.6 | Ningún flujo simula una aprobación no solicitada | Aceptar/rechazar una recomendación es un único paso usuario↔sistema, sin cadena de aprobadores — se documenta explícitamente por qué esto no es el patrón prohibido (ver `research.md`, Decisión 3) |
| 4 (propiedad de datos por módulo) | Cada módulo solo escribe en sus propias tablas | `clasificacion_producto` es tabla propia de este módulo aunque referencia `producto`; nunca se agrega columna a `producto` (Decisión 2) |
| 10.5 | Auditoría inmutable de operaciones críticas | Cambios de precio y resoluciones de recomendaciones generan entrada en el log de auditoría de Administración |

## Estructura del Proyecto

```
backend/
  app/
    models/precios.py
    schemas/precios.py
    services/precios.py       # cálculo de margen, resolución de índice único parcial, obsolescencia de recomendaciones
    routers/precios.py
  alembic/versions/xxxx_precios_margenes.py
frontend/                              # React + Vite (constitución v1.3.0)
  src/features/precios/
    CatalogoPrecios.tsx
    MargenReal.tsx
    ComparativaCompetencia.tsx
    Recomendaciones.tsx
    HistorialClasificacion.tsx
  src/api/                             # cliente generado desde el contrato OpenAPI
tests/
  test_precios_api.py
  test_precios_negocio.py
```

## Endpoints REST

| Método | Ruta | Descripción | OO |
|---|---|---|---|
| POST | `/api/v1/precios` | Registrar/actualizar precio de venta manual | OO-PM01 |
| GET | `/api/v1/precios/{producto_id}/margen` | Consultar margen real | OO-PM02 |
| POST | `/api/v1/precios/competencia` | Registrar precio de referencia de competencia | OO-PM03 |
| GET | `/api/v1/precios/{producto_id}/comparativa-competencia` | Comparar precio propio vs. competencia | OO-PM04 |
| PATCH | `/api/v1/precios/clasificacion/{producto_id}` | Marcar producto como gancho/nicho (desde v1.2 exige `motivo_cambio` y abre historial) | OO-PM05 |
| GET | `/api/v1/precios/clasificacion/{producto_id}/historial` | Historial de clasificación, o la vigente en una fecha *(enmienda v1.2)* | RF-PM-015/016 |
| GET | `/api/v1/catalogos/fuentes-competencia` | Listar competidores monitoreados *(enmienda v1.2)* | RF-PM-013 |
| POST | `/api/v1/catalogos/fuentes-competencia` | Registrar competidor *(enmienda v1.2)* | RF-PM-013 |
| PATCH | `/api/v1/catalogos/fuentes-competencia/{id}` | Actualizar o dar de baja competidor *(enmienda v1.2)* | RF-PM-013 |
| GET | `/api/v1/catalogos/clasificaciones-comerciales` | Rangos de margen objetivo *(enmienda v1.2)* | RF-PM-017 |

*(Enmienda v1.2)* `GET /precios/{producto_id}/comparativa-competencia` gana `agrupar_por_fuente` (RF-PM-014) y su filtro `tipo_canal` pasa a llamarse `canal_codigo`, resuelto vía la fuente. Solo `fuente_competencia` tiene escritura por API; los otros cuatro catálogos se modifican por migración.
| POST | `/api/v1/precios/recomendaciones` | Generar recomendación de precio (Sistema) | OO-PM06 |
| PATCH | `/api/v1/precios/recomendaciones/{id}/resolucion` | Aceptar o rechazar una recomendación | OO-PM07 |

## Modelo de Datos (resumen — ver `data-model.md`)

4 tablas: `historial_precio_producto` (append-only), `clasificacion_producto` (a nivel de cadena), `precio_competencia` (append-only), `recomendacion_precio` (con índice único parcial por RN-PM-001).

*(Enmienda v1.2)* Más 5 catálogos maestros — `clasificacion_comercial` (con `margen_objetivo_min`/`max`), `fuente_precio`, `canal_competencia`, `fuente_competencia` (con `id SERIAL`, es el único con escritura por API) y `estado_recomendacion` — y 1 tabla de historia: `producto_clasificacion_historial`, la dimensión SCD tipo 2 de la clasificación gancho/nicho, con índice único parcial por RN-PM-004.

**Cambio destructivo de la enmienda v1.2**: `precio_competencia.tipo_canal` **se elimina**. Al catalogar la fuente, el canal pasó a depender de ella y no de la observación — dependencia transitiva, violación de 3NF (Decisión 5 de `research.md`). Es el único campo que esta enmienda borra en lugar de convertir, y la migración debe hacer el backfill de `fuente_competencia_id` a partir del texto libre existente **antes** de eliminar la columna.

## Fases

- **Fase 0**: Este `plan.md` + `research.md` (decisiones 1-3 ya resueltas).
- **Fase 1**: `data-model.md`, `contracts/precios-margenes.openapi.yaml`, `quickstart.md`.
- **Fase 2**: `tasks.md` con tests de contrato primero, luego implementación.

## Riesgos y Decisiones Técnicas Pendientes

El endpoint `POST /precios/recomendaciones` (OO-PM06) hoy solo valida y persiste lo que le envíen — no implementa el modelo de pricing dinámico en sí (eso es responsabilidad de la capa estratégica, el módulo de Analítica y Reportes, aún sin número asignado bajo esta estructura, o un proceso batch independiente vía Airflow). Se documenta como dependencia externa, igual que el stub de pronóstico de `008-compras-proveedores`.
