# Especificación de Feature: Inventario y Caducidad

**Feature**: `002-inventario-caducidad` | **Fecha**: 2026-09-04
**Departamento**: Inventario y Caducidad (abreviatura `IN`)
**Deriva de**: OT2.4 (garantizar disponibilidad), OT3.2 (automatizar alertas de caducidad), OT1.5 (reducir stock muerto, compartido con Compras y Proveedores)

## Resumen

Este módulo es dueño del catálogo de productos (`producto`) y del stock físico por sucursal. A diferencia de Ventas y Caja — que solo consume el catálogo — Inventario y Caducidad es quien define qué es un producto, si se vende fraccionado, si es perecedero, y qué cantidad hay disponible en cada sucursal en cada momento. También es responsable de dos problemas de negocio del enunciado que Ventas y Caja no resuelve: la caducidad de perecederos (alertas antes de que se pierdan) y el stock muerto (productos sin rotación que inmovilizan capital, OT1.5).

## Escenarios de Usuario

### Historia principal

Como Encargado de Sucursal, cuando recibo un pedido del proveedor necesito registrar el ingreso de stock de cada producto a mi sucursal. Si el producto es perecedero, necesito además registrar la fecha de caducidad del lote recibido, para que el sistema me avise cuando esté por vencer y pueda aplicar un descuento o retirarlo antes de perderlo por completo.

### Escenarios de aceptación

1. **Dado** un producto ya existente en el catálogo con `es_fraccionable = false`, **cuando** registro un ingreso de 50 unidades a mi sucursal, **entonces** `stock_sucursal.cantidad_disponible` pasa a sumar esas 50 unidades.
2. **Dado** un producto marcado `es_perecedero = true`, **cuando** registro un ingreso de stock indicando fecha de caducidad, **entonces** el sistema crea un registro en `lote_producto` además de actualizar el stock agregado.
3. **Dado** un lote con fecha de caducidad dentro del umbral configurado (parámetro global de Administración), **cuando** consulto "próximos a caducar" de mi sucursal, **entonces** ese lote aparece en el resultado.
4. **Dado** un lote próximo a caducar, **cuando** registro su retiro o descuento, **entonces** `lote_producto.cantidad_restante` y `stock_sucursal.cantidad_disponible` se reducen en la misma cantidad retirada.
5. **Dado** un producto sin ninguna venta registrada por más del umbral de días configurado, **cuando** corre el proceso batch de evaluación de rotación, **entonces** `stock_sucursal.marcado_sin_rotacion` pasa a `true` para ese producto/sucursal.
6. **Dado** un producto marcado `es_fraccionable = true`, **cuando** intento crearlo sin `factor_conversion`, **entonces** el sistema rechaza la operación con `422` (RN-IN-002) — misma regla que valida Ventas y Caja al vender, pero exigida aquí en el origen del dato.

### Casos límite (qué pasa si...)

- **¿Qué pasa si** se registra un lote con fecha de caducidad anterior a la fecha de ingreso (ya vencido al llegar)? → Se permite el registro (es un dato real que puede ocurrir por demora del proveedor), pero el sistema genera la alerta de "próximo a caducar" de inmediato, sin esperar al umbral normal de días.
- **¿Qué pasa si** un ajuste de inventario dejaría `cantidad_disponible` en negativo? → Se rechaza con `422`; el ajuste debe reflejar lo contado físicamente, nunca forzar un valor imposible.
- **¿Qué pasa si** un producto marcado "sin rotación" recibe una venta nueva? → Se desmarca automáticamente en el siguiente ciclo del proceso batch, sin necesidad de revisión manual (evita que quede una etiqueta obsoleta contradiciendo una venta real).
- **¿Qué pasa si** llegan dos ingresos del mismo producto/sucursal el mismo día con fechas de caducidad distintas? → Se crean dos registros de `lote_producto` separados; nunca se combinan lotes con fechas de caducidad distintas bajo un mismo registro, porque eso rompería la trazabilidad de cuál vence primero.
- **¿Qué pasa si** se intenta retirar de un lote una cantidad mayor a su `cantidad_restante`? → Se rechaza con `422`; el retiro nunca puede exceder lo que efectivamente queda de ese lote.

## Requisitos Funcionales

- **RF-IN-001**: El sistema DEBE permitir registrar un producto con nombre, categoría, código de barras, unidad de venta, unidad de inventario, `es_fraccionable`, `factor_conversion` y `es_perecedero`.
- **RF-IN-002**: El sistema DEBE permitir actualizar los datos de un producto existente sin alterar registros de venta ya generados (los precios y unidades aplicados en ventas pasadas son snapshots, ver `data-model.md` de `001-ventas-y-caja`).
- **RF-IN-003**: El sistema DEBE registrar el ingreso de stock a una sucursal, incrementando `stock_sucursal.cantidad_disponible`.
- **RF-IN-004**: Si el producto es perecedero y el ingreso incluye fecha de caducidad, el sistema DEBE crear un registro independiente en `lote_producto`.
- **RF-IN-005**: El sistema DEBE permitir consultar los productos con fecha de caducidad dentro del umbral configurado, filtrando por sucursal.
- **RF-IN-006**: El sistema DEBE permitir registrar el retiro o descuento aplicado a un lote próximo a caducar, reduciendo tanto `lote_producto.cantidad_restante` como el stock agregado de la sucursal.
- **RF-IN-007**: El sistema DEBE exponer la cantidad disponible en tiempo real de un producto por sucursal (consultada por el POS de Ventas y Caja en cada venta).
- **RF-IN-008**: El sistema DEBE permitir registrar un ajuste de inventario tras conteo físico, exigiendo un motivo obligatorio.
- **RF-IN-009**: Ningún ajuste ni retiro de lote puede dejar la cantidad disponible en un valor negativo.
- **RF-IN-010**: El sistema DEBE marcar automáticamente un producto/sucursal como "sin rotación" cuando supera el umbral de días sin venta, mediante un proceso batch — nunca por acción manual de un usuario.
- **RF-IN-011**: El sistema DEBE permitir consultar el listado de productos sin rotación por sucursal, como candidatos a liquidación (alimenta OT1.5).
- **RF-IN-012**: El sistema DEBE rechazar la creación o actualización de un producto fraccionable que no tenga `factor_conversion` configurado.

## Requisitos No Funcionales

- **RNF-IN-001**: La consulta de stock en tiempo real (RF-IN-007) debe responder en menos de 300ms p95, porque es invocada por el POS en el flujo crítico de cada venta.
- **RNF-IN-002**: `stock_sucursal` debe tener un índice único por `(producto_id, sucursal_id)` que garantice acceso directo sin escaneo, dado el volumen de consultas desde el POS.
- **RNF-IN-003**: El registro de lotes (`lote_producto`) no debe bloquear ni retrasar el flujo de venta del POS — es un proceso independiente del cobro.

## Reglas de Negocio

- **RN-IN-001**: `stock_sucursal.cantidad_disponible` nunca puede ser negativa (CHECK a nivel de base de datos + validación de servicio antes del `UPDATE`).
- **RN-IN-002**: `factor_conversion` es obligatorio si y solo si `es_fraccionable = true` — el mismo patrón de restricción que aplicó Ventas y Caja al vender (RN-VC-001 de `001-ventas-y-caja`), pero exigido aquí en el origen del dato, no solo al momento de la venta.

## Entidades Clave

- **Producto**: catálogo maestro — nombre, categoría, código de barras, unidad de venta/inventario, `es_fraccionable`, `factor_conversion`, `es_perecedero`. Es la entidad que Ventas y Caja, Compras y Proveedores, y Precios y Márgenes referencian por FK.
- **StockSucursal**: cantidad disponible en tiempo real por producto y sucursal, más los indicadores de rotación (`dias_sin_venta`, `marcado_sin_rotacion`).
- **LoteProducto**: registro de un lote recibido con fecha de caducidad, solo para productos perecederos — permite saber cuál lote vence primero.
- **AjusteInventario**: corrección manual tras conteo físico, con motivo obligatorio y trazabilidad de quién lo hizo.

## Checklist de revisión

- [ ] Todo RF tiene un endpoint correspondiente en `contracts/inventario-caducidad.openapi.yaml`
- [ ] RN-IN-001 y RN-IN-002 están implementados como CHECK de base de datos, no solo validación de aplicación
- [ ] El proceso batch de OO-IN08 está documentado como Sistema, no como endpoint invocable por un rol de negocio
- [ ] Los 5 casos límite están cubiertos por al menos un test de contrato en `tasks.md`
