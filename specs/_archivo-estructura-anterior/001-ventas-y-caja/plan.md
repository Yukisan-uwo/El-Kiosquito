# Plan de Implementación: Ventas y Caja

**Feature**: `001-ventas-y-caja` | **Rama**: `001-ventas-y-caja` | **Fecha**: 2026-09-04
**Entrada**: `spec.md` de este mismo directorio | **Constitución**: v1.1.0

## Resumen Técnico

El módulo Ventas y Caja expone el punto de venta (POS) de una sucursal: creación de ventas con soporte de productos fraccionados, cobro con IVA calculado, apertura/cierre de turno de caja con diferencia calculada automáticamente, captura de demanda insatisfecha y alertas de fraude en pago. Es el módulo con más volumen transaccional del sistema (cada venta de cada sucursal), por lo que las tablas de este módulo son las que más rápido crecen y las primeras que alimentan el pipeline ETL hacia ClickHouse (OT3.6).

## Contexto Técnico

- **Backend**: FastAPI + Jinja2, Python 3.11 (Art. 5.3 de la constitución)
- **Persistencia**: PostgreSQL (Art. 5.1) — todas las tablas de este módulo son transaccionales, con integridad referencial real (FK entre venta y sus ítems, entre venta y turno de caja)
- **RBAC**: JWT con claims de rol y sucursal (Art. 3.3/5.9) — Cajero/Vendedor solo opera sobre SU sucursal asignada; ningún endpoint de este módulo puede omitir el filtro de sucursal
- **Frontend**: Bootstrap 5 + Chart.js, paleta propia (Art. 11) — pantalla de POS optimizada para uso rápido con teclado/lector de código de barras, no solo mouse
- **Sin conexión externa**: los pagos electrónicos se procesan contra un proveedor simulado/sandbox (Art. 8.2) — este módulo NO integra una pasarela real de pago

## Constitution Check

| Artículo | Regla | Cómo se cumple en este módulo |
|---|---|---|
| 3.3 | Scoping por sucursal obligatorio | Todo endpoint valida `sucursal_id` del JWT contra la sucursal del recurso antes de cualquier operación |
| 4.2 | Causa obligatoria en toda merma/diferencia | `TurnoCaja.motivo_diferencia` es NOT NULL cuando `diferencia != 0`; se rechaza el cierre sin ese campo |
| 4.4 | Demanda insatisfecha se registra al momento | Endpoint independiente, sin requerir venta asociada, con timestamp editable (ver spec.md, caso límite) |
| 4.7 | Conversión de unidad obligatoria en fraccionado | La API rechaza (422) un ítem fraccionado de un producto sin `factor_conversion` configurado en Inventario |
| 5.1 | PostgreSQL, no DuckDB | Migraciones con Alembic, versión exacta fijada en `requirements.txt` (Art. 5.8) |
| 8.6 | Nada de flujos de aprobación simulados | La anulación de venta (OO-VC04) es un UPDATE directo con motivo, no un flujo de "solicitud → aprobación" |
| 10.7 | Mínimo privilegio sobre datos personales | Este módulo no almacena datos personales del cliente (eso vive en Fidelización); solo referencia un `cliente_id` opcional cuando el cliente se identifica en la venta |
| 10.8 | Nunca almacenar tarjeta completa | `AlertaFraudePago` y el registro de pago solo guardan los últimos 4 dígitos y el código de respuesta del proveedor sandbox, nunca el PAN completo |

## Estructura del Proyecto

```
backend/
├── app/
│   ├── routers/ventas_caja.py       # Endpoints REST de este módulo
│   ├── models/ventas_caja.py        # Modelos SQLAlchemy: Venta, DetalleVenta, TurnoCaja, DemandaInsatisfecha, AlertaFraudePago
│   ├── schemas/ventas_caja.py       # Pydantic: request/response
│   ├── services/ventas_caja.py      # Lógica de negocio: cálculo de IVA, conversión de unidad, diferencia de caja
│   └── services/scoping.py          # Dependencia compartida de validación de sucursal (reutilizada por todos los módulos)
frontend/
├── templates/ventas_caja/
│   ├── pos.html                     # Pantalla de venta (POS)
│   ├── caja_apertura.html
│   └── caja_cierre.html
tests/
├── test_ventas_caja_api.py          # Tests de contrato (uno por endpoint)
└── test_ventas_caja_negocio.py      # Tests de reglas: IVA, conversión, diferencia de caja, RN-VC-001/002
```

## Endpoints REST

| Método | Ruta | Descripción | Deriva de |
|---|---|---|---|
| POST | `/api/v1/ventas` | Crear una venta con sus ítems (unidad completa o fraccionada) | OO-VC01, OO-VC05, RF-VC-001, RF-VC-005 |
| PATCH | `/api/v1/ventas/{id}/pago` | Registrar método de pago y su estado | OO-VC02, RF-VC-002 |
| PATCH | `/api/v1/ventas/{id}/descuento` | Aplicar descuento/cupón a la venta en curso | OO-VC03, RF-VC-003 |
| PATCH | `/api/v1/ventas/{id}/anular` | Anular/corregir una venta con motivo | OO-VC04, RF-VC-004 |
| POST | `/api/v1/caja/turnos` | Abrir turno de caja con monto inicial | OO-VC06, RF-VC-006 |
| PATCH | `/api/v1/caja/turnos/{id}/cierre` | Cerrar turno con monto contado (diferencia calculada por el sistema) | OO-VC07, RF-VC-007, RF-VC-012 |
| PATCH | `/api/v1/caja/turnos/{id}/motivo-diferencia` | Registrar el motivo de una diferencia detectada | OO-VC08, RF-VC-008 |
| POST | `/api/v1/demanda-insatisfecha` | Registrar un evento de demanda insatisfecha | OO-VC09, RF-VC-009 |
| POST | `/api/v1/alertas-fraude-pago` | Registrar una alerta de posible fraude en un pago | OO-VC10, RF-VC-010 |
| GET | `/api/v1/caja/turnos/{id}` | Consultar el estado de un turno (para la pantalla de cierre) | Soporte de UI |
| GET | `/api/v1/ventas/{id}` | Consultar el detalle de una venta | Soporte de UI |

## Modelo de Datos (resumen — detalle completo en `data-model.md`)

| Tabla | Campos clave | FK |
|---|---|---|
| `venta` | id, sucursal_id, cajero_id, fecha_hora, subtotal, iva, total, estado | sucursal, usuario |
| `detalle_venta` | id, venta_id, producto_id, cantidad_venta, unidad_venta, cantidad_inventario, precio_aplicado | venta, producto |
| `turno_caja` | id, sucursal_id, cajero_id, hora_apertura, monto_inicial, hora_cierre, monto_contado, monto_esperado, diferencia, motivo_diferencia | sucursal, usuario |
| `demanda_insatisfecha` | id, sucursal_id, producto_id, hora_evento, hora_registro, cajero_id | sucursal, producto, usuario |
| `alerta_fraude_pago` | id, venta_id, motivo, estado, ultimos_4_digitos, codigo_respuesta | venta |

## Fases

**Fase 0 — Research** (`research.md`): decisiones a resolver antes de codificar — (1) cómo calcular `monto_esperado` del cuadre cuando hay ventas con descuento parcial en efectivo vs. tarjeta; (2) cómo representar `factor_conversion` para que sirva tanto a "12 unidades por paquete" como a "peso variable" (ej. producto a granel), si se decide soportar ambos casos.

**Fase 1 — Design & Contracts** (`data-model.md`, `contracts/`, `quickstart.md`): esquema completo de tablas con constraints, contratos OpenAPI por endpoint, y guía de arranque local del módulo.

**Fase 2 — Tasks** (`tasks.md`): desglose de tareas de implementación en orden ejecutable, generado a partir de este plan y de `data-model.md`.

## Riesgos y Decisiones Técnicas Pendientes

- Definir si `factor_conversion` es un valor fijo por producto o si necesita variar por sucursal (mismo producto, distinto tamaño de paquete según proveedor local) — impacta el modelo de datos de Inventario, no solo el de este módulo.
- Decidir el motor de cálculo de "monto esperado" del cuadre: ¿se recalcula en cada cierre a partir de las ventas del turno, o se mantiene un contador incremental? La primera opción es más simple y auditable (recomendada), la segunda es más rápida pero más frágil ante anulaciones tardías.
