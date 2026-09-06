# Plan Técnico: Compras y Proveedores

**Feature**: `008-compras-proveedores` | **Fecha**: 2026-09-04
**Entrada**: `spec.md`

## Resumen Técnico

Módulo dueño del ciclo de compra: proveedores, órdenes, recepciones (posiblemente parciales, en más de un envío) e historial de costos. Es el único módulo que puede escribir en `historial_costo_producto`, dato que `003-precios-margenes` consume para calcular el margen real (OT1.1) y que Analítica y Reportes usa como feature de estacionalidad de costos.

## Contexto Técnico

- **Lenguaje/Stack**: Python 3.11, FastAPI, SQLAlchemy, Alembic (Art. 5.1).
- **Base de datos**: PostgreSQL (capa operativa, Art. 5.2).
- **Dependencias externas de este módulo**: `producto` (`001-core-ventas-inventario`), `sucursal` (Expansión), `usuario` (Administración). También consulta en vivo (no escribe) `004-pronostico-demanda` vía `GET /pronostico/{producto_id}` (Decisión 4 de `research.md`) — ya no es un stub.
- **Consumidores de este módulo**: `003-precios-margenes` (`historial_costo_producto`, para OT1.1), `001-core-ventas-inventario` (`orden_compra.estado` para saber si hay mercadería en tránsito), Analítica y Reportes (todo el historial de costos, como serie de tiempo).

## Constitution Check

| Artículo | Regla | Mecanismo de cumplimiento en este módulo |
|---|---|---|
| 3.3 | Todo dato debe filtrarse por sucursal del token, salvo Dueño/Compras (alcance cadena) | Encargado de Compras tiene alcance de cadena completa por diseño de rol, único módulo donde eso aplica de forma central; `sucursal_id` en `orden_compra` sigue siendo obligatorio para saber a dónde llega la mercadería |
| 4.7 (extensión de la regla de validación de oferta) | Ninguna compra por oferta puede confirmarse sin validar demanda | RN-CP-001, aplicado a nivel de `detalle_orden_compra` (Decisión 3), ahora contra el pronóstico real de `004-pronostico-demanda` (Decisión 4) |
| 8.6 | Ningún flujo simula una aprobación no solicitada | El cambio de estado de la orden es una consecuencia automática de recepciones registradas, no un flujo de aprobación gerencial |
| 10.5 | Auditoría inmutable de operaciones críticas | Cada recepción y cada entrada de `historial_costo_producto` generan entrada en el log de auditoría de Administración |

## Estructura del Proyecto

```
backend/
  app/
    models/compras.py
    schemas/compras.py
    services/compras.py       # recalculo de cantidad_recibida y estado, validación RN-CP-001, cliente HTTP hacia 004-pronostico-demanda
    routers/compras.py
  alembic/versions/xxxx_compras_proveedores.py
frontend/                              # React + Vite (constitución v1.3.0)
  src/features/compras/
    Proveedores.tsx
    OrdenCompra.tsx
    RecepcionOrden.tsx
    ComparativaPrecios.tsx
  src/api/                             # cliente generado desde el contrato OpenAPI
tests/
  test_compras_api.py
  test_compras_negocio.py
```

## Endpoints REST

| Método | Ruta | Descripción | Código |
|---|---|---|---|
| POST | `/api/v1/proveedores` | Registrar proveedor | RF-CP-001 |
| PATCH | `/api/v1/proveedores/{id}` | Actualizar proveedor | RF-CP-001 |
| PATCH | `/api/v1/proveedores/{id}/desactivar` | Dar de baja un proveedor | RF-CP-011 |
| POST | `/api/v1/compras/ordenes` | Registrar orden de compra | RF-CP-002 |
| POST | `/api/v1/compras/ordenes/{detalle_id}/recepciones` | Registrar un evento de recepción | RF-CP-003, RF-CP-004 |
| GET | `/api/v1/compras/productos/{producto_id}/historial-costo` | Consultar historial de costo por proveedor | RF-CP-007 |
| GET | `/api/v1/compras/productos/{producto_id}/comparativa-proveedores` | Comparar precio vigente entre proveedores | RF-CP-008 |
| GET | `/api/v1/compras/productos/{producto_id}/pronostico` | Consultar pronóstico de demanda (integra `004-pronostico-demanda`) | RF-CP-009 |
| PATCH | `/api/v1/compras/ordenes/{detalle_id}/motivo-oferta` | Registrar motivo de no seguir el pronóstico | RF-CP-010 |

## Modelo de Datos (resumen — ver `data-model.md`)

5 tablas: `proveedor`, `orden_compra` (estado derivado, con `forma_pago`, enmienda v1.1), `detalle_orden_compra` (incluye validación de pronóstico), `recepcion_orden_compra` (log append-only, con `numero_documento_proveedor` opcional, enmienda v1.1), `historial_costo_producto` (append-only).

*(Enmienda v1.2)* Más 2 catálogos maestros de clave natural: `forma_pago` (con `dias_plazo_default`, dato que faltaba para anticipar cuándo pagar una orden a crédito, OT1.3) y `estado_orden_compra` (con `permite_recepcion`). Los dos CHECK de `orden_compra` pasan a FK. **`estado` sigue siendo derivado y no editable** — la FK valida el valor, no abre una vía de escritura (RNF-CP-001 intacta, Decisión 6A de `research.md`).

*(Enmienda v1.1)* `POST /compras/ordenes` y `POST /compras/ordenes/{detalle_id}/recepciones` ganan campos adicionales en su cuerpo — no son endpoints nuevos, son los mismos ya existentes con dos campos más (RF-CP-012, RF-CP-013).

## Fases

- **Fase 0**: Este `plan.md` + `research.md` (decisiones 1-4 ya resueltas).
- **Fase 1**: `data-model.md`, `contracts/compras-proveedores.openapi.yaml`, `quickstart.md`.
- **Fase 2**: `tasks.md` con tests de contrato primero, luego implementación.

## Riesgos y Decisiones Técnicas Pendientes

`GET /compras/productos/{producto_id}/pronostico` ahora depende de que `004-pronostico-demanda` esté disponible en el mismo entorno (ya construido bajo esta estructura) — si esa llamada HTTP falla, el endpoint debe responder `datos_suficientes: false` en vez de romper el flujo de creación de la orden, nunca inventar una cantidad recomendada.
