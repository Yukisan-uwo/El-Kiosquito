# Investigación Técnica: Ventas y Caja

**Feature**: `001-ventas-y-caja` | **Fecha**: 2026-09-04
**Origen**: decisiones pendientes señaladas en `plan.md`

## Decisión 1 — Dónde vive el factor de conversión de producto fraccionado

**Decisión**: el `factor_conversion` (ej. 1 cigarrillo = 1/20 de paquete) es una propiedad del **catálogo de producto** (módulo Inventario y Caducidad), igual para todas las sucursales — NO se modela como un valor distinto por sucursal.

**Justificación**: las Compras están centralizadas en el rol Encargado de Compras (OT1.3, alcance de toda la red, Art. 3.1 de la constitución), y toda sucursal nueva hereda el catálogo y precios base de la cadena al abrirse (OO-ES03). Como el mismo producto se compra con el mismo empaque para toda la red, el factor de conversión es intrínseco al producto, no a dónde se vende. Si en algún momento una sucursal necesitara vender el mismo producto con un empaque distinto (ej. una sucursal recibe una presentación de proveedor diferente), la solución correcta es dar de alta un producto de catálogo distinto (mismo criterio que ya se usa para variantes de presentación), no agregar una excepción por sucursal a cada producto — eso evitaría el tipo de complejidad oculta que en NexoStay causó el bug de doble cobro (dos lugares del sistema con una misma cifra que se podía desincronizar).

**Alternativas consideradas**:
- *Factor de conversión por sucursal*: se descartó porque obliga a cada sucursal a mantener su propia configuración de cada producto fraccionable, con el riesgo real de que dos sucursales terminen con factores distintos para el mismo producto sin que nadie lo note — exactamente el tipo de inconsistencia entre partes del sistema que ya causó un bug real en NexoStay.
- *Factor de conversión calculado dinámicamente desde la última compra*: se descartó por complejidad innecesaria para el alcance del examen — el factor de conversión de un producto (cuántas unidades sueltas trae un paquete) no cambia entre compras, a diferencia del costo de reposición (que sí varía y ya se rastrea aparte, OT1.3).

**Implicación para `data-model.md`**: `factor_conversion` es un campo del modelo `Producto` (Inventario y Caducidad), no de `DetalleVenta`. `DetalleVenta` solo guarda la cantidad ya convertida, para que el historial de ventas quede correcto aunque el producto cambie de factor de conversión más adelante.

## Decisión 2 — Cómo se calcula el "monto esperado" del cuadre de caja

**Decisión**: el `monto_esperado` de un turno de caja se **recalcula en el momento del cierre**, sumando directamente las ventas en efectivo registradas con ese `turno_caja_id` desde la tabla `venta` — nunca se mantiene como un contador incremental que se actualiza en cada venta.

**Justificación**: con PostgreSQL (transaccional real, a diferencia de DuckDB) el costo de sumar las ventas de un turno al cierre es trivial al volumen de un kiosko (decenas o pocos cientos de ventas por turno), así que no hay necesidad de optimizar con un contador. Recalcular en el momento es más auditable — el número siempre se puede reconstruir desde el origen — y evita exactamente el patrón de bug que ya ocurrió en NexoStay: dos lugares del sistema (un contador vivo y las filas reales) representando la misma cifra, que terminaron desincronizados. La regla de honestidad de los modelos (Art. 5.6 de la constitución) pide lo mismo para los informes de IA — que toda cifra sea trazable a datos reales — y aquí aplicamos el mismo principio a una cifra operativa.

**Alternativas consideradas**:
- *Contador incremental actualizado en cada venta*: más rápido de leer, pero fràgil ante anulaciones tardías (una venta anulada después de sumarse al contador exige un ajuste manual del contador) y ante concurrencia (dos ventas casi simultáneas incrementando el mismo contador). Se descartó.

**Implicación para `data-model.md`**: `venta` DEBE tener una FK a `turno_caja_id` (no solo a `sucursal_id`), para que el cierre pueda filtrar exactamente las ventas de ESE turno. Una venta anulada después del cierre de su turno no participa en el recálculo de un cuadre ya cerrado (ver caso límite de `spec.md`) — el ajuste, si aplica, se refleja en el turno vigente al momento de la anulación.

## Decisión 3 (hallazgo durante la investigación, no estaba en `plan.md`) — Pago mixto (parte efectivo, parte tarjeta)

**Decisión**: el pago mixto (dividir una misma venta entre efectivo y tarjeta) queda **explícitamente fuera de alcance** de esta versión. Cada venta tiene un único método de pago.

**Justificación**: el enunciado y los objetivos tácticos (OT2.2) piden velocidad de cobro y adopción de pago electrónico, no pago dividido — agregarlo ahora complica el cálculo del `monto_esperado` de efectivo (Decisión 2) sin que ningún objetivo lo pida. Se documenta como limitación deliberada, siguiendo la práctica de NexoStay de dejar constancia explícita de los límites de alcance en vez de dejarlos ambiguos (evita que "aparezcan" objetivos no planeados a mitad de la implementación, que fue precisamente la causa raíz señalada para la mala documentación de objetivos en NexoStay).

**Alternativas consideradas**: soportar pago mixto desde el inicio — descartado por alcance; puede añadirse en una iteración futura enmendando `spec.md` y `data-model.md` (agregar una tabla `pago_venta` 1:N en vez de un campo único en `venta`).

## Resumen de decisiones para `data-model.md`

1. `factor_conversion` vive en `Producto`, no en `DetalleVenta` ni por sucursal.
2. `venta` tiene FK a `turno_caja_id`; `monto_esperado` se calcula, nunca se almacena como contador.
3. `venta.metodo_pago` es un único valor por venta (no hay tabla de pagos múltiples en esta versión).
