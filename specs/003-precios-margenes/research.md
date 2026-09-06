# Investigación Técnica: Precios y Márgenes

**Feature**: `003-precios-margenes` | **Fecha**: 2026-09-04

## Decisión 1: el precio de venta es un historial append-only, no un campo editable con `UPDATE` (heredada)

**Decisión**: `historial_precio_producto` registra cada cambio de precio como una fila nueva (producto, sucursal, precio, fuente, fecha); el "precio vigente" es siempre la fila más reciente por `(producto_id, sucursal_id)`, nunca se sobreescribe un precio anterior.

**Justificación**: la meta de OT1.1 se mide trimestralmente ("+8% margen trimestral") — para calcular esa tendencia hace falta poder reconstruir cuál era el precio vigente en cualquier fecha pasada, no solo el de hoy. Un campo `precio_actual` editable perdería esa capacidad la primera vez que alguien lo actualice. Es además el mismo principio de trazabilidad que ya exige Compras y Proveedores (`008-compras-proveedores`) para `historial_costo_producto` — aquí se aplica al lado opuesto del cálculo de margen (precio de venta en vez de costo de reposición), porque ambos lados de la fórmula necesitan la misma disciplina para que el margen calculado en cualquier fecha sea reproducible.

**Alternativas consideradas**: columna `precio_venta` directamente en una tabla `producto_sucursal` con `UPDATE` en cada cambio — descartada porque el Encargado de Precios necesita explicar la evolución del margen trimestre a trimestre (KPI de OT1.1), y un valor sobrescrito no permite esa reconstrucción.

## Decisión 2: la clasificación "gancho"/"nicho" vive en una tabla propia de este módulo, a nivel de cadena, no como columna de `producto`

**Decisión**: se crea `clasificacion_producto` (producto_id, clasificacion, actualizado_por) como tabla de este módulo, referenciando `producto` por FK — nunca se agrega una columna `clasificacion` a la tabla `producto`, que ahora es propiedad de `001-core-ventas-inventario` (el módulo que fusiona Ventas y Caja con Inventario y Caducidad bajo la estructura mínima obligatoria). La clasificación es a nivel de cadena, no por sucursal.

**Justificación**: `producto` es propiedad de `001-core-ventas-inventario` — este proyecto ya estableció el límite de que cada módulo solo escribe en las tablas que declara como propias; ese mismo módulo ya documenta en su propio `data-model.md` que ningún módulo externo modifica `producto` directamente. "Gancho"/"nicho" es una decisión de estrategia comercial de Precios y Márgenes, no un atributo físico del producto como su unidad de venta o si es perecedero. Se decide a nivel de cadena porque es una clasificación de catálogo (qué rol cumple el producto en la estrategia comercial general), no algo que tenga sentido que varíe sucursal por sucursal para el mismo producto.

**Alternativas consideradas**: agregar la columna directamente a `producto` — descartada porque rompería la propiedad de datos entre módulos que ya se viene respetando; clasificación por sucursal — descartada porque no hay ningún caso de negocio en el enunciado que justifique que el mismo producto sea "gancho" en una sucursal y "nicho" en otra.

## Decisión 3: el motor de pricing dinámico nunca escribe el precio vigente directamente — siempre pasa por una recomendación que un humano acepta o rechaza (heredada)

**Decisión**: el motor (Sistema) solo puede crear filas en `recomendacion_precio` con `estado = 'pendiente'`. La única forma de que exista una nueva fila en `historial_precio_producto` con `fuente = 'motor_dinamico'` es que un usuario acepte esa recomendación explícitamente.

**Justificación**: la constitución (Art. 5.6/5.9, regla de honestidad de los modelos) exige que ningún modelo de IA actúe de forma autónoma sobre datos de negocio ni presente una cifra sin que se pueda auditar de dónde salió. Esto no es un flujo de aprobación gerencial de los que prohíbe el Art. 8.6 (que bloquea simular procesos de solicitud/aprobación entre roles humanos) — es un único paso: el modelo propone con su justificación, un usuario decide, sin cadena de aprobadores ni estados intermedios adicionales.

**Alternativas consideradas**: que el motor aplique el precio directamente y solo notifique al usuario después (patrón "aplica y notifica") — descartada de plano porque viola directamente el Art. 5.6 de la constitución.

## Decisión 4 (enmienda v1.1, 2026-09-04): `precio_competencia.tipo_canal` se agrega tras la auditoría del enunciado

**Contexto**: el enunciado pide explícitamente comparar precios contra "tiendas, supermercado, competencia local, canales digitales" — pero `fuente` era texto libre (p. ej. "Supermercado La Favorita"), lo que permite registrar el dato pero no filtrar ni reportar de forma confiable por tipo de canal sin parsear texto.

**Decisión**: se agrega `tipo_canal CHECK IN ('tienda_fisica','supermercado','canal_digital')` como campo obligatorio adicional; `fuente` se conserva para el nombre puntual (para no perder la trazabilidad de "cuál tienda específica"), pero ahora la clasificación estructurada vive en un campo aparte.

**Justificación**: separar "qué tipo de canal es" (estructurado, consultable) de "cuál es el nombre puntual" (texto libre, descriptivo) es el mismo criterio que ya usa el proyecto en otras tablas — por ejemplo `merma.causa` (estructurado) frente a un campo de detalle libre en otras tablas de investigación. No se modeló como una tabla de canales aparte porque son 3 valores fijos y estables, mismo criterio que `cupon.tipo_origen` en `005-promociones-inteligentes` (conjunto cerrado, no ameritaba una tabla de referencia).

**Alternativas descartadas**: dejar `fuente` como texto libre y resolver la clasificación por canal con un `LIKE` en reportes — descartada porque es exactamente el tipo de dato fràgil (depende de cómo cada usuario escriba el nombre) que la regla de calidad de datos del Art. 7.3 (ISO/IEC 25012) busca evitar en la capa analítica.

## Nota de reestructuración

Este módulo corresponde al antiguo `004-precios-margenes` bajo la organización por departamento; bajo la estructura mínima obligatoria de 7+ módulos pasa a numerarse `003-precios-margenes`, sin cambios de contenido — solo se actualizaron las referencias cruzadas a `producto` (ahora en `001-core-ventas-inventario`) y a `historial_costo_producto` (ahora en `008-compras-proveedores`).

## Decisión 5 (enmienda v1.2, 2026-09-04): la clasificación necesita tabla de historia aparte, y `tipo_canal` se elimina por dependencia transitiva

**Decisión A — `producto_clasificacion_historial` como tabla nueva**: `clasificacion_producto` tiene `producto_id` como clave primaria (Decisión 2), o sea una sola fila por producto que se sobreescribe en cada cambio. No hay historia que rescatar: hay que crearla. Se agrega una tabla append-only con `fecha_desde`/`fecha_hasta`, índice único parcial (RN-PM-004), `motivo_cambio` obligatorio y `usuario_id`.

Contraste deliberado con `002-clientes-fidelizacion`: allí la enmienda **no** creó tabla de historia, porque `segmento_cliente` ya era append-only y solo hubo que hacerla legible como dimensión. La forma de la solución la dicta cómo estaba modelada cada tabla, no una regla uniforme aplicada a ciegas.

**Por qué importa para OT1.1**: el margen real se evalúa contra el rango objetivo de la clasificación (`margen_objetivo_min`/`max` del catálogo nuevo). Si un producto hoy es "gancho" pero hace seis meses era "nicho", medir el margen histórico contra la clasificación actual da un resultado falso — parecería llevar medio año fuera de rango cuando cumplía el que regía entonces. Por eso RF-PM-016 permite consultar la clasificación vigente *en una fecha*, no solo la actual.

**Decisión B — se elimina `precio_competencia.tipo_canal`**: al catalogar la fuente observada (`fuente_competencia`, que ya declara su canal), `tipo_canal` pasó a depender de la fuente y no de la observación de precio: `precio_competencia → fuente_competencia → canal_competencia`. Es una dependencia transitiva, es decir una violación de 3NF, y permitiría que la misma fuente apareciera con dos canales distintos en observaciones distintas — un dato contradiciéndose a sí mismo dentro de la misma tabla. El canal se obtiene por JOIN y RF-PM-011 se sigue cumpliendo igual.

No es comparable con los snapshots deliberados del proyecto (`detalle_venta.precio_unitario_aplicado`): allí el valor **debe** congelarse porque cambia con el tiempo y la venta ya ocurrió. Un local no cambia de canal — un supermercado no se vuelve canal digital — así que no hay nada que congelar.

**Por qué `fuente_competencia` lleva `id SERIAL` y no clave natural**, a diferencia de los otros cuatro catálogos de este módulo: el nombre lo escribe y corrige el negocio, y un local puede renombrarse o cambiar de razón social. Con clave natural, corregir "La Favorita centro" a "Supermercado La Favorita — Quevedo centro" obligaría a propagar el cambio a todas las observaciones históricas. Mismo criterio que `categoria` en `001-core-ventas-inventario`.

**Qué habilita este catálogo**: la pregunta "¿contra qué competidor estoy peor de precio?" (RF-PM-014), hoy imposible — con el nombre escrito a mano, dos observaciones del mismo supermercado con distinta redacción se cuentan como competidores distintos. El análisis de OT2.1 deja de tener el canal como único eje y puede bajar al local concreto.

## Decisión 6 (enmienda v1.3, 2026-09-05, auditoría de riesgos derivados): piso de margen al aceptar una recomendación

**Contexto**: RN-PM-002 ya impide que el motor de pricing dinámico escriba `historial_precio_producto` por su cuenta — toda recomendación pasa por una aceptación humana. Pero esa barrera resuelve el riesgo de que el sistema actúe solo, no el de que un humano acepte, sin darse cuenta, una recomendación cuyo precio queda por debajo del costo de reposición vigente (`historial_costo_producto`, de `008-compras-proveedores`). No hay nada de malo en vender un producto gancho puntual a pérdida como decisión de negocio — pero eso debe ser una decisión, no un descuido.

**Decisión**: `PATCH /precios/recomendaciones/{id}/resolucion` calcula el costo vigente del producto (mismo helper que ya usa `GET .../margen-real`) al aceptar. Si `precio_recomendado < costo_vigente` y el payload no trae `confirmar_perdida=true`, responde `409` con el precio, el costo y la pérdida unitaria calculada — nunca bloquea la aceptación en sí, solo exige que sea explícita (RN-PM-007).

**Por qué no bloquear en vez de exigir confirmación**: bloquear le quitaría al negocio la posibilidad legítima de liquidar stock muerto de un producto gancho vía precio, que es justo uno de los escenarios que este mismo proyecto ya resuelve en `001-core-ventas-inventario` (productos sin rotación). Confirmar-antes-de-aceptar da la misma seguridad sin quitar esa opción.

**Por qué no comparar contra el margen objetivo de la clasificación en vez del costo**: el margen objetivo de `clasificacion_comercial` es una meta de rango, no un piso duro — compararse contra él generaría falsos positivos constantes (casi cualquier ajuste puntual se sale del rango objetivo). El costo de reposición es el único número con el que vender por debajo es inequívocamente una pérdida contable, no una discusión de estrategia comercial.

## Resumen de decisiones para `data-model.md`

1. `historial_precio_producto` es append-only; el precio vigente se deriva con `DISTINCT ON (producto_id, sucursal_id) ORDER BY vigente_desde DESC`.
2. `clasificacion_producto` es una tabla nueva de este módulo, a nivel de cadena (sin `sucursal_id`).
3. `recomendacion_precio` tiene su propio ciclo de vida (`pendiente`/`aceptada`/`rechazada`/`obsoleta`) y un índice único parcial que impide más de una `pendiente` por producto/sucursal (RN-PM-001).
4. *(Enmienda v1.2)* 5 catálogos: `clasificacion_comercial` (con rango de margen objetivo), `fuente_precio`, `canal_competencia`, `fuente_competencia` (con `id SERIAL`) y `estado_recomendacion`. Más `producto_clasificacion_historial` como dimensión SCD tipo 2, y la eliminación de `precio_competencia.tipo_canal` por dependencia transitiva (Decisión 5).
5. *(Enmienda v1.3)* Aceptar una recomendación por debajo del costo de reposición vigente exige `confirmar_perdida=true` explícito (RN-PM-007, Decisión 6) — sin cambio de esquema, solo de validación de servicio.
