# Investigación Técnica: Promociones Inteligentes

**Feature**: `005-promociones-inteligentes` | **Fecha**: 2026-09-04

## Decisión 1: por qué el cupón se separa en su propio módulo, distinto de `002-clientes-fidelizacion`

**Decisión**: `cupon` deja de vivir junto a `cliente`/`segmento_cliente`/`evaluacion_churn` (donde estaba en el diseño original por departamento) y pasa a ser dueño de este módulo nuevo, con `cliente_id` y `evaluacion_churn_id` como FK externas hacia `002-clientes-fidelizacion`.

**Justificación**: la estructura mínima obligatoria separa explícitamente "clientes-fidelización" (quién es el cliente, qué tan valioso es, si está en riesgo) de "promociones-inteligentes" (el mecanismo de cupones en sí). Esta separación no es solo administrativa: el ciclo de vida de un cupón (`activo` → `canjeado`/`expirado`, validado contra una venta real) es el mismo sin importar qué lo originó, mientras que la lógica de *cuándo* corresponde generar uno es distinta para cada disparador (fecha de nacimiento, un patrón de compra reconocido, o una evaluación de churn). Mantenerlos juntos habría mezclado dos responsabilidades que cambian por razones distintas: si mañana se agrega un cuarto tipo de disparador (por ejemplo, una promoción de temporada), no debería tocar nada de la lógica de segmentación o churn.

**Alternativas consideradas**: mantener `cupon` dentro de `002-clientes-fidelizacion` como en el diseño original — descartada porque no respeta el límite explícito que exige la estructura mínima del ingeniero.

## Decisión 2: los cupones se modelan en una sola tabla con `tipo_origen`, no en tres tablas separadas (heredada)

**Decisión**: `cupon` tiene un campo `tipo_origen` con valores `'cumpleanos'`, `'patron_compra'` o `'recuperacion_churn'`, en vez de existir `cupon_cumpleanos`, `cupon_patron` y `cupon_recuperacion` como tablas independientes.

**Justificación**: el ciclo de vida de un cupón (`activo` → `canjeado` o `expirado`) y la lógica de canje (RF-PI-002/RN-PI-001) son idénticos sin importar qué lo originó — separar en tres tablas obligaría a triplicar esa lógica y a que el endpoint de canje supiera consultar tres tablas distintas según el tipo. El único dato que realmente cambia según el origen es la trazabilidad hacia atrás (qué evaluación de churn originó un cupón de recuperación), que se resuelve con un FK opcional (`evaluacion_churn_id`), no con tablas separadas.

**Alternativas consideradas**: tres tablas separadas, una por origen — descartada por la duplicación de lógica de canje/expiración; un campo `tipo_origen` de texto libre sin CHECK — descartada porque perdería la validez garantizada por base de datos que sí tiene un `CHECK IN (...)`.

## Decisión 3: el motor de "patrón de compra" no tiene tabla propia en este módulo

**Decisión**: no existe una tabla `regla_patron_compra` ni similar en este módulo — el disparador `tipo_origen = 'patron_compra'` se activa desde un proceso batch o desde la capa estratégica que llama al mismo endpoint de creación de cupón que usan los otros dos orígenes, sin que este módulo modele las reglas que decidieron activarlo.

**Justificación**: la lógica de qué constituye un "patrón de compra" reconocible (frecuencia, categoría, ticket promedio) es un problema de análisis de datos, no de este módulo de mecánica de cupones — mezclar ambas cosas aquí repetiría el mismo error que ya se corrigió al sacar `cupon` de `002-clientes-fidelizacion`. Si ese motor de reglas necesita persistencia propia en el futuro, le corresponde a Analítica y Reportes, no a este módulo.

**Alternativas consideradas**: modelar una tabla de reglas de patrón de compra aquí mismo — descartada por ahora al no tener un requisito explícito del enunciado que la exija; se documenta como posible extensión futura, no como pendiente de este módulo.

## Decisión 4 (enmienda v1.1, 2026-09-04): el CHECK de RN-PI-002 se mantiene además del catálogo, y el tope de descuento se agrega como dato

**Decisión A — regla duplicada a propósito**: `tipo_origen_cupon.requiere_evaluacion_churn` expresa la misma regla que el CHECK `(tipo_origen <> 'recuperacion_churn' OR evaluacion_churn_id IS NOT NULL)`. Se mantienen los dos.

No es redundancia por descuido: cumplen funciones distintas. El CHECK impone la regla fila por fila en la base, sin depender de que ningún servicio lea el catálogo. La columna del catálogo la hace **consultable**, para que un formulario sepa si debe pedir el campo sin tener la lista de tipos quemada en la plantilla. Sustituir el CHECK por una validación de aplicación que consulte el catálogo cambiaría una garantía del motor de base de datos por una garantía del código — un retroceso.

**Decisión B — `valor_maximo_permitido`**: al catalogar `descuento_tipo` se hizo evidente un agujero que llevaba desde el diseño original. `descuento_valor` solo tiene `CHECK (descuento_valor >= 0)`, así que un cupón con `descuento_tipo = 'porcentaje'` y `descuento_valor = 200` se crea hoy sin ningún error: el sistema terminaría pagándole al cliente por llevarse el producto.

El tope va en el catálogo y no como un CHECK fijo en `cupon` porque **depende del tipo**: 100 para porcentaje, un monto en dólares para monto fijo. Un CHECK único no puede expresar dos límites distintos según el valor de otra columna sin volverse ilegible, y además el monto máximo del descuento fijo es una decisión comercial que el negocio debería poder ajustar sin una migración.

**Por qué esto no contradice `es_automatico`**: ese otro atributo existe para el indicador de OT2.3, no para una validación. El % de cupones bien segmentados solo tiene sentido calculado sobre los cupones que el modelo segmentó — mezclarlos con los que emitió una persona a mano daría un número que no mide nada.

## Decisión 5 (enmienda v1.2, 2026-09-05, auditoría de riesgos derivados): la Decisión 3 se revisa — sí hay un motor real, pero sigue sin tener "reglas" propias

**Contexto**: una auditoría de riesgos derivados del sistema completo encontró que la Decisión 3 (arriba) tenía una consecuencia que en su momento no se documentó como riesgo: al no existir ningún proceso real detrás de `tipo_origen = 'patron_compra'`, ese tipo de cupón en la práctica solo podía activarse escribiéndolo a mano en `POST /promociones/cupones` — un humano decidiendo "creo que este cliente tiene un patrón", sin ningún dato de soporte. Eso contradice el espíritu del propio nombre del módulo ("promociones inteligentes") y, peor, no tiene ningún paralelo con cómo se resolvió el mismo problema en `evaluacion_churn`/`recomendacion_precio`: ahí sí existe un cálculo real (aunque en 002 sea una evaluación humana estructurada, y en 003 un modelo) antes de que el sistema sugiera algo.

**Decisión**: se agrega `app/services/patron_compra.py`, un cálculo real de asociación de mercado (soporte/confianza/lift, vocabulario estándar de análisis de canasta de compra) sobre `detalle_venta`/`venta`, expuesto por `POST /promociones/sugerencias-patron/recalcular` y persistido en la tabla nueva `sugerencia_patron_compra`. Esto **no contradice** la Decisión 3 en lo esencial: sigue sin existir una tabla `regla_patron_compra` con reglas de negocio configurables a mano (umbrales, categorías, ticket promedio) — los umbrales (soporte mínimo, confianza mínima, lift mínimo, veces mínimas de compra del producto base, límite de sugerencias por cliente) son parámetros del propio endpoint (`SugerenciaPatronRecalcularIn`), no una tabla de configuración persistente. Lo que sí cambia es que ahora hay un cálculo real y trazable detrás de cada sugerencia, en vez de nada.

**Por qué no hace falta una librería de ML nueva**: soporte/confianza/lift son conteos y aritmética simple sobre canastas (`venta.id` como canasta) — no es un modelo entrenado, es análisis de asociación de mercado clásico (Apriori sin la poda de candidatos, viable aquí porque el catálogo de productos de un kiosco es pequeño). Se implementa en SQL agregado + Python puro, coherente con no agregar dependencias nuevas solo para este cálculo.

**Por qué "sistema sugiere, humano confirma" también aplica acá**: el motor de asociación puede decir *qué* producto tiene una oportunidad real de cross-sell para un cliente dado (con métricas verificables), pero nunca debería decidir *cuánto* descontar — eso es una decisión comercial. `PATCH .../resolver` exige `descuento_tipo`/`descuento_valor`/`fecha_expiracion` explícitos cuando se acepta (RN-PI-005), exactamente el mismo principio que ya existe en `recomendacion_precio` (RN-PM-002, 003) y en `evaluacion_churn` → `campana_recuperacion` (002).

**Por qué la exclusión de candidatos es "nunca compró B" (todo el historial) y no solo "no compró B en el período"**: sugerirle a un cliente un producto que compró la semana pasada, solo porque quedó fuera de la ventana de análisis, sería una sugerencia obviamente mala — la pregunta real de negocio es "¿es esto una novedad para este cliente?", no "¿ocurrió dentro de los últimos N días?".

**Alternativas consideradas**: modelar `regla_patron_compra` como tabla de configuración editable por el negocio (umbrales por categoría, por ejemplo) — descartada por ahora al no tener un requisito explícito que la exija; los umbrales como parámetros del endpoint ya cubren la necesidad real sin el costo de una tabla más. Usar una librería de reglas de asociación (`mlxtend`, por ejemplo) — descartada porque el volumen de datos de un kiosco no lo justifica y el cálculo directo en SQL es más simple de auditar.

## Resumen de decisiones para `data-model.md`

1. `cupon` es la única tabla original de este módulo, con FK externas hacia `cliente`/`evaluacion_churn` (`002-clientes-fidelizacion`) y `venta` (`001-core-ventas-inventario`, al canjearse).
2. `tipo_origen` con FK a `tipo_origen_cupon` *(enmienda v1.1; antes era CHECK)*, sin tablas separadas por origen.
3. `CHECK (tipo_origen <> 'recuperacion_churn' OR evaluacion_churn_id IS NOT NULL)` para RN-PI-002 — **se mantiene** aunque el catálogo exprese la misma regla como dato (Decisión 4).
4. *(Enmienda v1.1)* 3 catálogos de clave natural: `tipo_origen_cupon`, `tipo_descuento` (con tope de valor, RN-PI-004) y `estado_cupon`.
5. *(Enmienda v1.2)* `sugerencia_patron_compra` + su catálogo `estado_sugerencia_patron`: salida del motor real de asociación de mercado (Decisión 5), con FK externas hacia `cliente` y `producto` (`001-core-ventas-inventario`) y FK opcional hacia `cupon` (se llena solo si se acepta).
