# Investigación Técnica: Inventario y Caducidad

**Feature**: `002-inventario-caducidad` | **Fecha**: 2026-09-04

## Decisión 1: `factor_conversion` se confirma como propiedad de `producto`, no de `stock_sucursal`

**Decisión**: `factor_conversion` (la relación entre la unidad de venta y la unidad de inventario, ej. 1 libra = 0.4536 kg) vive en la tabla `producto`, propiedad de este módulo. Ya se había adoptado esta decisión en `001-ventas-y-caja/research.md` (Decisión 1) porque Ventas y Caja la necesitaba antes de que este módulo existiera formalmente — aquí se confirma como definitiva porque `producto` es dueño de este módulo, no del de Ventas.

**Justificación**: Compras y Proveedores negocia con el proveedor a nivel de producto, no de sucursal — todas las sucursales reciben el mismo producto con la misma conversión de unidades. Si `factor_conversion` variara por sucursal, dos sucursales podrían calcular un stock distinto para el mismo ingreso físico de mercadería, lo cual no tiene justificación de negocio en el enunciado (el fraccionamiento es una propiedad física del producto, no de cómo lo gestiona cada local).

**Alternativas consideradas**: guardar `factor_conversion` en `stock_sucursal` para permitir que cada sucursal fraccione distinto — descartada porque introduciría inconsistencia sin ningún caso de uso real que la sustente, y complicaría innecesariamente el cálculo que hace Ventas y Caja en cada venta fraccionada (tendría que resolver dos tablas en vez de una).

## Decisión 2: `lote_producto` existe solo para productos perecederos; los no perecederos nunca generan lotes

**Decisión**: Un ingreso de stock siempre actualiza `stock_sucursal.cantidad_disponible` (el agregado). Solo si `producto.es_perecedero = true` Y el ingreso incluye fecha de caducidad, se crea además un registro en `lote_producto`. Los productos no perecederos (la mayoría del catálogo de un minimarket: enlatados, limpieza, bebidas de larga duración) nunca generan lotes.

**Justificación**: Implementar trazabilidad FIFO completa (lote por lote, con fecha de caducidad) para *todo* el catálogo sería sobre-ingeniería para un minimarket de barrio — el enunciado pide explícitamente alertas de caducidad de *perecederos*, no un sistema de trazabilidad de lotes universal. Separar la tabla evita que `stock_sucursal` cargue campos de caducidad casi siempre nulos para el 80-90% del catálogo típico de un kiosko.

**Alternativas consideradas**: (a) un solo modelo de lotes para todo el catálogo — descartada por sobre-ingeniería frente al enunciado; (b) guardar la fecha de caducidad directamente en `stock_sucursal` sin tabla de lotes separada — descartada porque un mismo producto/sucursal puede tener múltiples lotes con fechas de caducidad distintas simultáneamente (ver caso límite de `spec.md`), y una sola columna no puede representar eso.

## Decisión 3: los umbrales de "próximo a caducar" y "sin rotación" son parámetros globales, no constantes de código

**Decisión**: Ambos umbrales (días antes de caducidad para generar alerta; días sin venta para marcar "sin rotación") se leen desde la tabla `parametro_sistema` que administra el módulo de Administración (OO-AD07), no se hardcodean en este módulo.

**Justificación**: El Dueño/Gerencia General es quien fija estas metas de negocio (OT1.5 define la meta de 60 días para stock muerto como ejemplo, pero es una meta, no necesariamente el umbral operativo exacto que la Alta Dirección querrá usar en producción) — deben poder ajustarse sin desplegar código nuevo, coherente con el patrón de gobernanza centralizada que ya estableció Administración para IVA y moneda.

**Alternativas consideradas**: constante fija en el código del servicio — descartada porque el enunciado deja claro que las reglas de negocio (umbrales, metas) son decisiones de gestión que cambian con el tiempo, no reglas técnicas inmutables.

## Resumen de decisiones para `data-model.md`

1. `factor_conversion` en `producto`, con CHECK `es_fraccionable = false OR factor_conversion IS NOT NULL` (RN-IN-002).
2. `lote_producto` es una tabla separada, poblada condicionalmente solo para perecederos.
3. Los umbrales de alerta viven fuera de este módulo (tabla de Administración); este módulo solo los consulta.
