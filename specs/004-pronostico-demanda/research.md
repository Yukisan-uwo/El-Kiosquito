# Investigación Técnica: Pronóstico de Demanda

**Feature**: `004-pronostico-demanda` | **Fecha**: 2026-09-04

## Decisión 1: `demanda_insatisfecha` se separa de `001-core-ventas-inventario` porque su único consumidor es este módulo, nunca el punto de venta

**Decisión**: `demanda_insatisfecha` se registra desde la misma pantalla de POS (Ventas y Caja), pero la tabla vive en `004-pronostico-demanda`, no en `001-core-ventas-inventario`.

**Justificación**: la tabla nunca se consulta desde el flujo de una venta — su único propósito es servir de insumo de entrenamiento al modelo de pronóstico (OT4.1). `001-core-ventas-inventario` ya documentó esta exclusión en su propio `spec.md` al construirse: mantenerla ahí habría acoplado una tabla analítica a un módulo cuya prioridad es que la venta se registre en milisegundos (RNF-CVI de ese módulo). El endpoint de registro sigue siendo trivial y rápido (RNF-PD-001), solo cambia en qué módulo vive la tabla — el cajero no percibe la diferencia.

**Alternativas consideradas**: dejarla en `001-core-ventas-inventario` como se había diseñado originalmente — descartada porque ese módulo ya fijó su propio límite de responsabilidad (solo ventas e inventario transaccional) al reestructurarse, y porque agrupar `demanda_insatisfecha` con el resto del pronóstico dentro de un mismo módulo hace más simple entrenar el modelo sin tener que hacer JOIN entre bases de datos o módulos distintos.

## Decisión 2: `pronostico_demanda` es un resultado de modelo batch, append-only, con el mismo patrón que `segmento_cliente`/`evaluacion_churn`

**Decisión**: `pronostico_demanda` (producto_id, sucursal_id, cantidad_recomendada, tamano_muestra, periodo_inicio, periodo_fin, fecha_calculo) nunca se actualiza con `UPDATE` — cada corrida del modelo inserta una fila nueva, y el pronóstico "vigente" se deriva con `DISTINCT ON (producto_id, sucursal_id) ORDER BY fecha_calculo DESC`.

**Justificación**: es exactamente el mismo problema estructural que ya resolvieron `002-clientes-fidelizacion` (`segmento_cliente`, `evaluacion_churn`) y `003-precios-margenes` (indirectamente, vía el ciclo de recomendaciones): un modelo de IA batch que produce resultados periódicos, donde la constitución (Art. 5.9) exige poder auditar con qué muestra y periodo se calculó cada cifra. Reutilizar el mismo patrón en vez de inventar uno nuevo reduce la superficie de diseño y hace que el proyecto sea consistente consigo mismo.

**Alternativas consideradas**: una sola fila por producto/sucursal con `UPDATE` en cada recálculo — descartada porque perdería la capacidad de auditar cuándo cambió la recomendación y con qué muestra, y porque Analítica y Reportes necesita el histórico completo para medir qué tan acertado fue el modelo con el tiempo (mismo argumento que ya se usó para `historial_precio_producto`).

## Decisión 3: la granularidad del pronóstico es por producto Y sucursal, no a nivel de cadena

**Decisión**: `pronostico_demanda` incluye `sucursal_id` como parte de su clave de consulta (`DISTINCT ON (producto_id, sucursal_id)`), igual que `demanda_insatisfecha`.

**Justificación**: la demanda insatisfecha que alimenta el modelo ya se captura por sucursal (índice original `(sucursal_id, producto_id, hora_evento)`), y el consumidor principal (`008-compras-proveedores`, `RN-CP-001`) decide compras por oferta a nivel de una orden que pertenece a una sucursal o a la cadena según el caso, pero siempre necesita poder comparar contra la demanda real de ese punto de venta específico — un pronóstico agregado a nivel de cadena escondería que una sucursal pequeña no necesita la misma cantidad que una grande, exactamente el mismo razonamiento que ya se aplicó para no promediar el stock entre sucursales en `001-core-ventas-inventario`.

**Alternativas consideradas**: pronóstico a nivel de cadena (un solo valor por producto) — descartada porque distorsionaría las decisiones de compra de sucursales con patrones de demanda muy distintos entre sí.

## Decisión 4 (enmienda v1.1, 2026-09-04): los confusores "sustitutos" y "estacionalidad no promocional" del Art. 5.6 necesitaban una fuente de datos explícita

**Contexto**: la auditoría enunciado-vs-specs encontró que el Art. 5.6 compromete un modelo de pronóstico "considerando confusores: promociones, sustitutos, estacionalidad, demanda insatisfecha", pero solo `demanda_insatisfecha` tenía una tabla propia. "Promociones" ya se resuelve leyendo `cupon` de `005-promociones-inteligentes` por fecha/producto al entrenar (no requiere cambio aquí). Los otros dos confusores no tenían de dónde salir.

**Decisión — sustitutos**: se agregan dos campos opcionales a `demanda_insatisfecha`: `sustituto_ofrecido_id` (FK externa a `producto_sustituto` de `001-core-ventas-inventario`) y `sustituto_aceptado` (booleano, NULL si no se ofreció ninguno). El catálogo de qué producto sustituye a cuál (`producto_sustituto`) se agregó en `001-core-ventas-inventario` (enmienda v1.1de ese módulo) porque es un dato de catálogo, no transaccional — vive junto a `producto`. Aquí solo se registra el *evento*: si en ese momento puntual se ofreció un sustituto y si el cliente lo aceptó. Esto también resuelve, de paso, el hueco de "sustitución de marca" que la auditoría marcó como no cubierto en ningún módulo: ahora hay tanto el catálogo (001) como el evento medible (004).

**Decisión — estacionalidad no promocional**: se agrega la tabla `evento_local` (feriados, fiestas patronales, eventos comunitarios, clima extremo, cortes de servicios), con rango de fechas y alcance opcional por sucursal (NULL = toda la cadena). No es append-only en sentido estricto (se permite editar un evento mal registrado) porque es un catálogo de hechos conocidos, no un resultado de modelo ni una transacción financiera — el mismo criterio que ya distingue tablas append-only (`pronostico_demanda`, `historial_precio_producto`) de catálogos editables (`clasificacion_producto`) en el resto del proyecto.

**Justificación de por qué viven en este módulo y no en otro**: ambos son insumos que el modelo de pronóstico de demanda consume al entrenar — no le pertenecen a Ventas y Caja (que solo captura el evento crudo) ni a Expansión y Sucursales (que gestiona la sucursal como entidad, no eventos temporales que la afectan). Mantenerlos aquí evita crear un módulo nuevo solo para dos tablas pequeñas y sigue el mismo criterio de agrupación por cadena causal que ya justificó juntar `demanda_insatisfecha` y `pronostico_demanda` en este módulo (Decisión 1).

**Alternativas consideradas**: (a) modelar `evento_local` como un tipo más de `promocion`/`cupon` en `005-promociones-inteligentes` — descartada porque un feriado no es una promoción que el negocio decide, es un hecho externo que el negocio sufre o aprovecha; mezclar ambos conceptos habría ensuciado el modelo de datos de promociones. (b) no persistir `evento_local` y dejar que el equipo de datos lo cargue manualmente en el momento de entrenar — descartada porque contradice el requisito de que "todo sea real, no simulado": si el dato no está en una tabla auditable, no se puede demostrar en la sustentación que el modelo realmente lo usa.

## Decisión 5 (enmienda v1.2, 2026-09-04): el signo del efecto de cada tipo de evento es un dato del catálogo, no algo que el modelo infiera

**Decisión**: `evento_local.tipo` pasa de CHECK a FK sobre el catálogo nuevo `tipo_evento_local`, que además de código y etiqueta declara `afecta_demanda_al_alza`.

**Por qué esa columna y no un catálogo vacío de código-etiqueta**: los cinco tipos empujan la demanda en direcciones opuestas — un feriado, una fiesta patronal o un evento comunitario la suben; un clima extremo o un corte de servicios la bajan. Si el modelo tuviera que aprender ese signo de los datos, dependería de tener suficientes ocurrencias históricas de cada tipo, y en un kiosko de barrio un tipo de evento puede aparecer tres o cuatro veces al año. Con esa muestra, la inferencia es ruido.

Esto conecta directo con el Art. 5.6: el propósito de este módulo es **descontar confusores con información conocida**, no adivinarlos. El signo del efecto es exactamente el tipo de información que se conoce de antemano y no hay razón para hacer que el modelo la redescubra.

**Beneficio adicional — validación del modelo**: con el signo declarado, un pronóstico que descuente un feriado *a la baja* es un error detectable. Sin el catálogo, ese error sería invisible.

**Alternativa descartada**: guardar el signo como un parámetro del modelo en `011-analitica-reportes` — descartada porque el signo es una propiedad del **tipo de evento** (un corte de luz baja la demanda, punto), no de una versión particular del modelo. Ponerlo en el modelo obligaría a redefinirlo en cada reentrenamiento.

## Decisión 6 (enmienda v1.3, 2026-09-05, auditoría de riesgos derivados): los confusores de la Decisión 4/5 llegaban a la BD pero no al modelo

**Contexto**: `evento_local`/`tipo_evento_local` (Decisión 4/5) y `sustituto_ofrecido_id`/`sustituto_aceptado` (Decisión 4) ya se cargaban correctamente en la capa táctica (`dim_evento_local`, `fact_demanda_insatisfecha` en ClickHouse) y hasta se cruzaban en el informe compuesto de OT3.7. Pero `etl/ml/demanda.py` — el modelo que estos confusores existen para corregir — solo usaba `es_feriado` (un subconjunto de `evento_local`, solo el tipo `'feriado'`, vía `dim_tiempo`). Los otros cuatro tipos del catálogo (fiesta patronal, evento comunitario, clima extremo, corte de servicios) y los dos campos de sustituto nunca llegaban a `_FEATURES`. Un día de clima extremo quedaba indistinguible de un día de demanda genuinamente baja — la trampa exacta que el Art. 5.6 pide evitar.

**Decisión**: `_extraer_dataset` agrega `evento_local_alza`/`evento_local_baja` (de `dim_evento_local`, excluyendo `'feriado'` para no contar el mismo evento dos veces; el signo se toma de `afecta_demanda_al_alza`, nunca se infiere — mismo criterio que RN-PD-003) y `hubo_sustituto_ofrecido`/`hubo_sustituto_aceptado` (de `fact_demanda_insatisfecha`, agregados por `max()` en el mismo `GROUP BY` que ya calculaba `eventos_quiebre`). Sin cambio de esquema — el dato ya existía, solo faltaba conectarlo al entrenamiento.

**Por qué `max()` para el sustituto y no `sum()` o un promedio**: lo que le importa al modelo por (fecha, sucursal, producto) es si *hubo* al menos un evento de sustitución ese día, no cuántos — con el volumen de un kiosko de barrio, dos quiebres del mismo producto el mismo día ya es un caso raro, y contar cuántos en vez de si-hubo-alguno le daría al modelo una escala arbitraria sin significado de negocio adicional.

## Resumen de decisiones para `data-model.md`

1. `demanda_insatisfecha` vive en este módulo, aunque se alimenta desde la pantalla de POS de `001-core-ventas-inventario`.
2. `pronostico_demanda` es append-only; el pronóstico vigente se deriva con `DISTINCT ON (producto_id, sucursal_id) ORDER BY fecha_calculo DESC`.
3. Ambas tablas usan `(producto_id, sucursal_id, ...)` como granularidad, nunca agregado a nivel de cadena.
4. *(Enmienda v1.1)* `demanda_insatisfecha` gana `sustituto_ofrecido_id`/`sustituto_aceptado`; se agrega la tabla `evento_local` — ambos como fuente explícita de los confusores "sustitutos" y "estacionalidad no promocional" del Art. 5.6.
5. *(Enmienda v1.2)* Catálogo `tipo_evento_local` con `afecta_demanda_al_alza`; `evento_local.tipo` pasa de CHECK a FK (Decisión 5).
6. *(Enmienda v1.3)* `etl/ml/demanda.py` conecta esos confusores al entrenamiento real (Decisión 6) — sin cambio de esquema.
