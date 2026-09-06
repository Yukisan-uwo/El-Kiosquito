# Investigación Técnica: Compras y Proveedores

**Feature**: `003-compras-proveedores` | **Fecha**: 2026-09-04

## Decisión 1: la recepción de una orden se modela como un log de eventos append-only, no como un contador que se actualiza directamente

**Decisión**: `recepcion_orden_compra` es una tabla independiente donde cada envío físico recibido genera una fila nueva. `detalle_orden_compra.cantidad_recibida` NO se actualiza con un `UPDATE cantidad_recibida = cantidad_recibida + X`; se recalcula sumando `SUM(cantidad_recibida_evento)` de todos los eventos de esa línea cada vez que se necesita.

**Justificación**: un proveedor de barrio no siempre entrega todo el pedido en un solo camión — puede llegar en dos o tres envíos distintos en días diferentes. Un contador vivo que se incrementa directamente es frágil ante reintentos de red o dobles envíos accidentales del cliente HTTP (el mismo problema, en otra forma, que llevó a decidir en `001-ventas-y-caja/research.md` que `monto_esperado` del cuadre de caja se recalcula desde `venta` en vez de mantenerse como contador incremental). Aquí se aplica el mismo principio de diseño porque el riesgo de negocio es equivalente: un doble conteo de recepción infla el stock que después no existe físicamente.

**Alternativas consideradas**: mantener `cantidad_recibida` como columna editable directamente vía `UPDATE` en cada recepción — descartada porque un reintento de red duplicaría la cantidad recibida sin dejar rastro de qué pasó, mientras que el log de eventos siempre permite auditar cada entrega por separado.

## Decisión 2: no existe una tabla de "catálogo por proveedor" separada — la comparación de precios se deriva de `historial_costo_producto`

**Decisión**: OO-CP06 (comparar precios de un producto entre proveedores) se resuelve consultando, por cada proveedor que haya vendido ese producto, su registro más reciente en `historial_costo_producto` — no se crea una tabla adicional tipo `producto_proveedor` con un precio "vigente" cacheado.

**Justificación**: `historial_costo_producto` de todas formas es obligatorio para OT1.3/OT3.3 (mantener actualizado el costo de reposición). Duplicar esa información en una segunda tabla de catálogo por proveedor obligaría a mantener sincronizados dos lugares con el mismo dato — exactamente el patrón de inconsistencia que el proyecto evita desde la constitución (Art. 4, snapshot vs. dato vivo bien diferenciados). Una consulta con `DISTINCT ON (proveedor_id) ... ORDER BY fecha DESC` resuelve el "precio vigente por proveedor" sin tabla adicional.

**Alternativas consideradas**: tabla `producto_proveedor` con un campo `precio_vigente` actualizado en cada recepción — descartada por duplicar el dato que ya vive en el historial y por el riesgo de que ambos queden desincronizados si un `UPDATE` falla a mitad de camino.

## Decisión 3: la validación de "compra por oferta contra pronóstico" vive a nivel de `detalle_orden_compra`, no de la orden completa

**Decisión**: los campos `pronostico_consultado` y `motivo_no_siguio_pronostico` (RN-CP-001) se guardan por línea de producto (`detalle_orden_compra`), no una sola vez por orden completa.

**Justificación**: una orden de compra por oferta puede incluir varios productos, y el pronóstico de demanda es específico por producto — el enunciado exige validar la compra "antes de aprovechar una oferta de proveedor sin validar demanda" a nivel de producto, no de orden completa. Si un proveedor ofrece 5 productos en oferta, cada uno puede tener un pronóstico distinto (uno con demanda alta que sí justifica comprar más, otro sin rotación reciente que no la justifica).

**Alternativas consideradas**: un único flag a nivel de `orden_compra` — descartada porque mezclaría productos que sí siguieron el pronóstico con otros que no, perdiendo la trazabilidad que pide OT1.5.

## Resumen de decisiones para `data-model.md`

1. `recepcion_orden_compra` es un log append-only; `cantidad_recibida` es un valor derivado, recalculado por el servicio en cada consulta o transición de estado.
2. No hay tabla `producto_proveedor`; la comparación de precios se deriva de `historial_costo_producto` con `DISTINCT ON`.
3. `pronostico_consultado` y `motivo_no_siguio_pronostico` viven en `detalle_orden_compra`, no en `orden_compra`.
