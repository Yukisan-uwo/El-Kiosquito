# Plan Técnico: Compras y Proveedores

**Feature**: `003-compras-proveedores` | **Fecha**: 2026-09-04
**Entrada**: `spec.md`

## Resumen Técnico

Módulo dueño del ciclo de compra: proveedores, órdenes, recepciones (posiblemente parciales, en más de un envío) e historial de costos. Es el único módulo que puede escribir en `historial_costo_producto`, dato que Precios y Márgenes consume para calcular el margen real (OT1.1) y que Analítica y Reportes usa como feature de estacionalidad de costos.

## Contexto Técnico

- **Lenguaje/Stack**: Python 3.11, FastAPI, SQLAlchemy, Alembic (Art. 5.1).
- **Base de datos**: PostgreSQL (capa operativa, Art. 5.2).
- **Dependencias externas de este módulo**: `producto` (Inventario y Caducidad), `sucursal` (Expansión), `usuario` (Administración). También consulta (no escribe) el pronóstico de demanda que produce Analítica y Reportes (OT4.1) — mientras ese módulo no exista, se implementa como un stub documentado (ver `quickstart.md`).
- **Consumidores de este módulo**: Precios y Márgenes (`historial_costo_producto`, para OT1.1), Inventario y Caducidad (`orden_compra.estado` para saber si hay mercadería en tránsito), Analítica y Reportes (todo el historial de costos, como serie de tiempo).

## Constitution Check

| Artículo | Regla | Mecanismo de cumplimiento en este módulo |
|---|---|---|
| 3.3 | Todo dato debe filtrarse por sucursal del token, salvo Dueño/Compras (alcance cadena) | Encargado de Compras tiene alcance de cadena completa por diseño de rol (Art. 3.3), único módulo donde eso aplica de forma central; `sucursal_id` en `orden_compra` sigue siendo obligatorio para saber a dónde llega la mercadería |
| 4.7 (extensión de la regla de validación de oferta) | Ninguna compra por oferta puede confirmarse sin validar demanda | RN-CP-001, aplicado a nivel de `detalle_orden_compra` (Decisión 3) |
| 8.6 | Ningún flujo simula una aprobación no solicitada | El cambio de estado de la orden es una consecuencia automática de recepciones registradas, no un flujo de aprobación gerencial — el Encargado de Compras no "aprueba" la orden, solo la crea y la recibe |
| 10.5 | Auditoría inmutable de operaciones críticas | Cada recepción y cada entrada de `historial_costo_producto` generan entrada en el log de auditoría de Administración |

## Estructura del Proyecto

```
backend/
  app/
    models/compras.py
    schemas/compras.py
    services/compras.py       # recalculo de cantidad_recibida y estado, validación RN-CP-001
    routers/compras.py
  alembic/versions/xxxx_compras_proveedores.py
frontend/
  templates/compras/
    proveedores.html
    orden_compra.html
    recepcion.html
    comparativa_precios.html
tests/
  test_compras_api.py
  test_compras_negocio.py
```

## Endpoints REST

| Método | Ruta | Descripción | OO |
|---|---|---|---|
| POST | `/api/v1/proveedores` | Registrar proveedor | OO-CP01 |
| PATCH | `/api/v1/proveedores/{id}` | Actualizar proveedor | OO-CP01 |
| PATCH | `/api/v1/proveedores/{id}/desactivar` | Dar de baja un proveedor | OO-CP09 |
| POST | `/api/v1/compras/ordenes` | Registrar orden de compra | OO-CP02 |
| POST | `/api/v1/compras/ordenes/{detalle_id}/recepciones` | Registrar un evento de recepción | OO-CP03 / OO-CP04 |
| GET | `/api/v1/compras/productos/{producto_id}/historial-costo` | Consultar historial de costo por proveedor | OO-CP05 |
| GET | `/api/v1/compras/productos/{producto_id}/comparativa-proveedores` | Comparar precio vigente entre proveedores | OO-CP06 |
| GET | `/api/v1/compras/productos/{producto_id}/pronostico` | Consultar pronóstico de demanda antes de confirmar oferta | OO-CP07 |
| PATCH | `/api/v1/compras/ordenes/{detalle_id}/motivo-oferta` | Registrar motivo de no seguir el pronóstico | OO-CP08 |

## Modelo de Datos (resumen — ver `data-model.md`)

5 tablas: `proveedor`, `orden_compra` (estado derivado), `detalle_orden_compra` (incluye validación de pronóstico), `recepcion_orden_compra` (log append-only), `historial_costo_producto` (append-only).

## Fases

- **Fase 0**: Este `plan.md` + `research.md` (decisiones 1-3 ya resueltas).
- **Fase 1**: `data-model.md`, `contracts/compras-proveedores.openapi.yaml`, `quickstart.md`.
- **Fase 2**: `tasks.md` con tests de contrato primero, luego implementación.

## Riesgos y Decisiones Técnicas Pendientes

El endpoint de pronóstico de demanda (OO-CP07) depende del módulo `009-analitica-reportes`, todavía no especificado. Mientras tanto, `GET /compras/productos/{producto_id}/pronostico` se implementa como un stub documentado que retorna un valor de ejemplo con un campo `es_estimacion_provisional: true`, para no bloquear el desarrollo de este módulo — se resolverá formalmente al construir `009-analitica-reportes`.
