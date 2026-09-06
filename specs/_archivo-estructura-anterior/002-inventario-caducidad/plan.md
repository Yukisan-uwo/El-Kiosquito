# Plan Técnico: Inventario y Caducidad

**Feature**: `002-inventario-caducidad` | **Fecha**: 2026-09-04
**Entrada**: `spec.md`

## Resumen Técnico

Módulo dueño del catálogo (`producto`) y del stock físico (`stock_sucursal`, `lote_producto`, `ajuste_inventario`). Expone al resto del sistema — sobre todo a Ventas y Caja — la consulta de stock en tiempo real y la validación de `factor_conversion`. Incluye un proceso batch (no un endpoint de negocio) que marca productos sin rotación, insumo directo de OT1.5.

## Contexto Técnico

- **Lenguaje/Stack**: Python 3.11, FastAPI, SQLAlchemy, Alembic — mismo stack que `001-ventas-y-caja` (Art. 5.1 de la constitución).
- **Base de datos**: PostgreSQL (capa operativa, Art. 5.2).
- **Dependencias externas de este módulo**: `sucursal` (Expansión), `usuario` (Administración), `parametro_sistema` (Administración, para umbrales — Decisión 3 de `research.md`).
- **Consumidores de este módulo**: Ventas y Caja (`stock_sucursal`, `producto.factor_conversion`), Precios y Márgenes (`producto`), Compras y Proveedores (`producto`, para registrar costos), Analítica y Reportes (`lote_producto`, `stock_sucursal.marcado_sin_rotacion` como features del modelo de pronóstico de demanda, OT4.1).

## Constitution Check

| Artículo | Regla | Mecanismo de cumplimiento en este módulo |
|---|---|---|
| 3.3 | Todo dato debe filtrarse por sucursal del token, salvo Dueño/Compras (alcance cadena) | `sucursal_id` obligatorio en `stock_sucursal`, `lote_producto`, `ajuste_inventario`; dependencia de scoping compartida con Ventas y Caja (`backend/app/services/scoping.py`, ya creada en 001) |
| 4.7 | Conversión de producto fraccionado debe ser correcta y verificable | `factor_conversion` vive en `producto` (Decisión 1), CHECK de base de datos impide guardarlo vacío si `es_fraccionable = true` |
| 5.1/5.2 | Compatibilidad de versiones Docker/Airflow, PostgreSQL como capa operativa | Mismas versiones fijadas en `docker-compose.yml` de la raíz del proyecto, sin duplicar servicios |
| 8.6 | Ningún flujo simula una aprobación no solicitada | El ajuste de inventario es un `INSERT` directo con motivo obligatorio, no un flujo de solicitud/aprobación — igual criterio que la anulación de venta en 001 |
| 10.5 | Auditoría inmutable de operaciones críticas | Ingresos de stock, ajustes y retiros de lote generan entrada en el log de auditoría de Administración (mismo patrón que T023 de 001) |

## Estructura del Proyecto

```
backend/
  app/
    models/inventario.py
    schemas/inventario.py
    services/inventario.py       # validación factor_conversion, cálculo de umbral, batch de rotación
    routers/inventario.py
  alembic/versions/xxxx_inventario_caducidad.py
frontend/
  templates/inventario/
    catalogo.html
    ingreso_stock.html
    proximos_a_caducar.html
    sin_rotacion.html
tests/
  test_inventario_api.py
  test_inventario_negocio.py
```

## Endpoints REST

| Método | Ruta | Descripción | OO |
|---|---|---|---|
| POST | `/api/v1/productos` | Crear producto en el catálogo | OO-IN01 |
| PATCH | `/api/v1/productos/{id}` | Actualizar producto existente | OO-IN01 |
| POST | `/api/v1/inventario/ingresos` | Registrar ingreso de stock (+ lote si aplica) | OO-IN02 / OO-IN03 |
| GET | `/api/v1/inventario/proximos-a-caducar` | Consultar lotes próximos a caducar por sucursal | OO-IN04 |
| PATCH | `/api/v1/inventario/lotes/{id}/retiro` | Registrar retiro/descuento de un lote | OO-IN05 |
| GET | `/api/v1/inventario/stock/{producto_id}` | Consultar stock disponible en tiempo real | OO-IN06 |
| POST | `/api/v1/inventario/ajustes` | Registrar ajuste tras conteo físico | OO-IN07 |
| POST | `/api/v1/inventario/rotacion/evaluar` | Ejecutar el proceso batch de marcado sin-rotación (Sistema, invocado por Airflow/cron, no por un rol de negocio) | OO-IN08 |
| GET | `/api/v1/inventario/sin-rotacion` | Consultar productos candidatos a liquidación | OO-IN09 |

## Modelo de Datos (resumen — ver `data-model.md`)

4 tablas: `producto` (catálogo maestro), `stock_sucursal` (agregado en tiempo real), `lote_producto` (solo perecederos), `ajuste_inventario` (conteo físico con motivo).

## Fases

- **Fase 0**: Este `plan.md` + `research.md` (decisiones 1-3 ya resueltas).
- **Fase 1**: `data-model.md`, `contracts/inventario-caducidad.openapi.yaml`, `quickstart.md`.
- **Fase 2**: `tasks.md` con tests de contrato primero, luego implementación.

## Riesgos y Decisiones Técnicas Pendientes

Ninguno pendiente — las 3 decisiones de diseño (ubicación de `factor_conversion`, alcance de `lote_producto`, origen de los umbrales) quedaron resueltas en `research.md` antes de escribir `data-model.md`, siguiendo el mismo proceso que `001-ventas-y-caja`.
