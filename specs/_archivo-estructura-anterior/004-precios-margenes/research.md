# Investigación Técnica: Precios y Márgenes

**Feature**: `004-precios-margenes` | **Fecha**: 2026-09-04

## Decisión 1: el precio de venta es un historial append-only, no un campo editable con `UPDATE`

**Decisión**: `historial_precio_producto` registra cada cambio de precio como una fila nueva (producto, sucursal, precio, fuente, fecha); el "precio vigente" es siempre la fila más reciente por `(producto_id, sucursal_id)`, nunca se sobreescribe un precio anterior.

**Justificación**: la meta de OT1.1 se mide trimestralmente ("+8% margen trimestral") — para calcular esa tendencia hace falta poder reconstruir cuál era el precio vigente en cualquier fecha pasada, no solo el de hoy. Un campo `precio_actual` editable perdería esa capacidad la primera vez que alguien lo actualice. Es además el mismo principio de trazabilidad que ya exige Compras y Proveedores para `historial_costo_producto` — aquí se aplica al lado opuesto del cálculo de margen (precio de venta en vez de costo de reposición), porque ambos lados de la fórmula necesitan la misma disciplina para que el margen calculado en cualquier fecha sea reproducible.

**Alternativas consideradas**: columna `precio_venta` directamente en una tabla `producto_sucursal` con `UPDATE` en cada cambio — descartada porque el Encargado de Precios necesita explicar la evolución del margen trimestre a trimestre (KPI de OT1.1), y un valor sobrescrito no permite esa reconstrucción.

## Decisión 2: la clasificación "gancho"/"nicho" vive en una tabla propia de este módulo, a nivel de cadena, no como columna de `producto`

**Decisión**: se crea `clasificacion_producto` (producto_id, clasificacion, actualizado_por) como tabla de este módulo, referenciando `producto` por FK — nunca se agrega una columna `clasificacion` a la tabla `producto` que es propiedad de Inventario y Caducidad (`002-inventario-caducidad`). La clasificación es a nivel de cadena, no por sucursal.

**Justificación**: `producto` es propiedad de Inventario y Caducidad — este proyecto ya estableció el límite de que cada módulo solo escribe en las tablas que declara como propias (Ventas y Caja consulta `producto` pero nunca lo modifica, ver `data-model.md` de `001-ventas-y-caja`). "Gancho"/"nicho" es una decisión de estrategia comercial de Precios y Márgenes, no un atributo físico del producto como su unidad de venta o si es perecedero. Se decide a nivel de cadena porque es una clasificación de catálogo (qué rol cumple el producto en la estrategia comercial general), no algo que tenga sentido que varíe sucursal por sucursal para el mismo producto.

**Alternativas consideradas**: agregar la columna directamente a `producto` — descartada porque rompería la propiedad de datos entre módulos que ya se viene respetando; clasificación por sucursal — descartada porque no hay ningún caso de negocio en el enunciado que justifique que el mismo producto sea "gancho" en una sucursal y "nicho" en otra.

## Decisión 3: el motor de pricing dinámico nunca escribe el precio vigente directamente — siempre pasa por una recomendación que un humano acepta o rechaza

**Decisión**: el motor (Sistema) solo puede crear filas en `recomendacion_precio` con `estado = 'pendiente'`. La única forma de que exista una nueva fila en `historial_precio_producto` con `fuente = 'motor_dinamico'` es que un usuario acepte esa recomendación explícitamente.

**Justificación**: la constitución (Art. 5.6/5.9, regla de honestidad de los modelos) exige que ningún modelo de IA actúe de forma autónoma sobre datos de negocio ni presente una cifra sin que se pueda auditar de dónde salió. Esto no es un flujo de aprobación gerencial de los que prohíbe el Art. 8.6 (que bloquea simular procesos de solicitud/aprobación entre roles humanos, como el caso de `caja/turno` de NexoStay) — es un único paso: el modelo propone con su justificación, un usuario decide, sin cadena de aprobadores ni estados intermedios adicionales.

**Alternativas consideradas**: que el motor aplique el precio directamente y solo notifique al usuario después (patrón "aplica y notifica") — descartada de plano porque viola directamente el Art. 5.6 de la constitución.

## Resumen de decisiones para `data-model.md`

1. `historial_precio_producto` es append-only; el precio vigente se deriva con `DISTINCT ON (producto_id, sucursal_id) ORDER BY vigente_desde DESC`.
2. `clasificacion_producto` es una tabla nueva de este módulo, a nivel de cadena (sin `sucursal_id`).
3. `recomendacion_precio` tiene su propio ciclo de vida (`pendiente`/`aceptada`/`rechazada`/`obsoleta`) y un índice único parcial que impide más de una `pendiente` por producto/sucursal (RN-PM-001).
