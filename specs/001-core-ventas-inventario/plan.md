# Plan Técnico: Core de Ventas e Inventario

**Feature**: `001-core-ventas-inventario` | **Fecha**: 2026-09-04
**Entrada**: `spec.md`

## Resumen Técnico

Módulo núcleo: catálogo, stock y la transacción de venta. Es el camino más caliente del sistema (cada venta consulta stock y aplica precio en tiempo real) y el que más módulos consumen — casi todos los demás referencian `producto` o `venta`.

## Contexto Técnico

- **Lenguaje/Stack**: Python 3.11, FastAPI, SQLAlchemy, Alembic (Art. 5.1).
- **Base de datos**: PostgreSQL (capa operativa, Art. 5.2).
- **Dependencias externas de este módulo**: `sucursal`/`usuario` (Expansión/Administración), `cliente` (`002-clientes-fidelizacion`, FK opcional), `turno_caja` (`006-caja-mermas-fraude`, FK obligatoria pero solo lectura), `historial_precio_producto` (`003-precios-margenes`, consultado para fijar `precio_unitario_aplicado` al momento de vender).
- **Consumidores de este módulo**: prácticamente todos — `003-precios-margenes` referencia `producto`; `004-pronostico-demanda` referencia `producto`/`stock_sucursal`; `005-promociones-inteligentes` y `002-clientes-fidelizacion` referencian `venta`/`cliente_id`; `006-caja-mermas-fraude` referencia `venta` y `turno_caja_id`; `008-compras-proveedores` referencia `producto`.

## Constitution Check

| Artículo | Regla | Mecanismo de cumplimiento |
|---|---|---|
| 3.3 | Scoping por sucursal | `sucursal_id` obligatorio en todas las tablas; dependencia compartida `backend/app/services/scoping.py` |
| 4.7 | Conversión de fraccionamiento correcta | `factor_conversion` en `producto`, CHECK de base de datos (RN-CVI-001) |
| 10.5 | Auditoría inmutable | Ventas, ajustes y anulaciones generan entrada en el log de auditoría de Administración |
| 8.6 | Sin aprobaciones simuladas | Anulación de venta es `UPDATE` directo con motivo, no un flujo de solicitud/aprobación |

## Estructura del Proyecto

```
backend/
  app/
    models/core_ventas_inventario.py
    schemas/core_ventas_inventario.py
    services/core_ventas_inventario.py
    services/catalogos.py               # enmienda v1.3 — jerarquía, baja con productos activos, armado del árbol
    routers/core_ventas_inventario.py
    routers/catalogos.py                # enmienda v1.3
  alembic/versions/xxxx_core_ventas_inventario.py
  alembic/versions/yyyy_catalogos_maestros.py   # enmienda v1.3 — tablas + seed + conversión de CHECK a FK
frontend/                              # React + Vite (constitución v1.3.0)
  src/features/core/
    PuntoDeVenta.tsx
    CatalogoProductos.tsx
    IngresoStock.tsx
    ProximosACaducar.tsx
    AbmCategorias.tsx
  src/api/                             # cliente generado desde el contrato OpenAPI
tests/
  test_core_ventas_inventario_api.py
  test_core_ventas_inventario_negocio.py
```

## Endpoints REST

| Método | Ruta | Descripción | Código |
|---|---|---|---|
| POST | `/api/v1/ventas` | Crear venta | RF-CVI-001/005 |
| PATCH | `/api/v1/ventas/{id}/pago` | Registrar estado de pago | RF-CVI-002 |
| PATCH | `/api/v1/ventas/{id}/descuento` | Aplicar descuento | RF-CVI-003 |
| PATCH | `/api/v1/ventas/{id}/anular` | Anular venta | RF-CVI-004 |
| POST | `/api/v1/productos` | Crear producto | RF-CVI-007 |
| PATCH | `/api/v1/productos/{id}` | Actualizar producto | RF-CVI-007 |
| POST | `/api/v1/inventario/ingresos` | Ingreso de stock (+ lote) | RF-CVI-008/009 |
| GET | `/api/v1/inventario/proximos-a-caducar` | Próximos a caducar | RF-CVI-010 |
| PATCH | `/api/v1/inventario/lotes/{id}/retiro` | Retiro de lote | RF-CVI-011 |
| GET | `/api/v1/inventario/stock/{producto_id}` | Stock en tiempo real | RF-CVI-012 |
| POST | `/api/v1/inventario/ajustes` | Ajuste de inventario | RF-CVI-013 |
| POST | `/api/v1/inventario/rotacion/evaluar` | Batch de rotación (Sistema) | RF-CVI-015 |
| GET | `/api/v1/inventario/sin-rotacion` | Consultar sin rotación | RF-CVI-016 |
| POST | `/api/v1/productos/{id}/sustitutos` | Registrar sustituto *(enmienda v1.1)* | RF-CVI-018 |
| GET | `/api/v1/productos/{id}/sustitutos` | Consultar sustitutos *(enmienda v1.1)* | RF-CVI-019 |
| PATCH | `/api/v1/inventario/stock/{producto_id}/minimo` | Definir/actualizar `stock_minimo` *(enmienda v1.2)* | RF-CVI-021 |
| GET | `/api/v1/inventario/stock-bajo` | Consultar productos bajo su `stock_minimo` *(enmienda v1.2)* | RF-CVI-022 |
| GET | `/api/v1/catalogos/categorias` | Listar categorías, plano o en árbol *(enmienda v1.3)* | RF-CVI-024/026 |
| POST | `/api/v1/catalogos/categorias` | Crear categoría *(enmienda v1.3)* | RF-CVI-024 |
| PATCH | `/api/v1/catalogos/categorias/{id}` | Actualizar o dar de baja categoría *(enmienda v1.3)* | RF-CVI-024 |
| GET | `/api/v1/catalogos/unidades-medida` | Listar unidades y si admiten decimales *(enmienda v1.3)* | RF-CVI-025/026 |
| GET | `/api/v1/catalogos/metodos-pago` | Listar métodos de pago para el POS *(enmienda v1.3)* | RF-CVI-026 |
| GET | `/api/v1/catalogos/estados-venta` | Listar estados y si cuentan para ingresos *(enmienda v1.3)* | RF-CVI-026 |

*(Enmienda v1.3)* Solo `categoria` tiene escritura por API: es el catálogo que mantiene el negocio. Los otros cuatro (`unidad_medida`, `metodo_pago`, `estado_pago`, `estado_venta`) son de solo lectura desde la API y se modifican por migración — son vocabulario del sistema, no datos que un usuario deba poder cambiar en caliente.

*(Enmienda v1.2)* `Venta` (schema de respuesta de `POST /ventas` y demás endpoints que la devuelven) gana el campo `numero_documento` — no es un endpoint nuevo, es un campo adicional de solo lectura en la respuesta existente (RF-CVI-020).

## Modelo de Datos (resumen — ver `data-model.md`)

7 tablas transaccionales: `producto`, `stock_sucursal` (con `stock_minimo`, enmienda v1.2), `lote_producto`, `ajuste_inventario`, `producto_sustituto` *(enmienda v1.1)*, `venta` (con `hora_inicio_cobro` y `numero_documento`, enmiendas v1.1/v1.2), `detalle_venta`.

*(Enmienda v1.3)* Más 5 catálogos maestros: `categoria` (jerárquica, dos niveles), `unidad_medida`, `metodo_pago`, `estado_pago`, `estado_venta`. Los cuatro últimos usan clave natural (`codigo VARCHAR` como PK), así que `venta.metodo_pago` sigue guardando `'efectivo'` y no un id — la lógica de los servicios no cambia y la migración no reescribe filas. `producto.categoria`, `producto.unidad_venta` y `producto.unidad_inventario` dejan de ser TEXT libre y pasan a ser FK; los tres CHECK de `venta` pasan a ser FK.

Los catálogos agregan un router propio (`routers/catalogos.py`), que expone las consultas que alimentan los selectores del POS y de los formularios en lugar de tener las opciones escritas en los componentes de React.

## Fases

- **Fase 0**: `plan.md` + `research.md` (decisiones 1-4 resueltas, incluyendo la justificación de qué queda fuera de este módulo).
- **Fase 1**: `data-model.md`, `contracts/core-ventas-inventario.openapi.yaml`, `quickstart.md`.
- **Fase 2**: `tasks.md` con tests de contrato primero.

## Riesgos y Decisiones Técnicas Pendientes

Ninguno — las decisiones de frontera del módulo (qué se queda, qué se va a `004`/`006`) quedaron resueltas en `research.md` antes de escribir el resto de artefactos.

**Enmienda v1.1 (2026-09-04)**: se agregaron `venta.hora_inicio_cobro` y la tabla `producto_sustituto` tras la auditoría del enunciado contra las specs ya entregadas (Decisión 5 de `research.md`). Sin impacto en el resto de fases: ambos son aditivos, no rompen ningún contrato previo.

**Enmienda v1.2 (2026-09-04)**: se agregaron `venta.numero_documento` (columna `GENERATED`, sin lógica de servicio adicional) y `stock_sucursal.stock_minimo` tras comparar el proyecto contra el esquema de un POS real de producción (Decisión 6 de `research.md`). Ambos son aditivos y de bajo riesgo — `numero_documento` no requiere ningún cambio en la lógica de creación de venta, solo en la migración.
