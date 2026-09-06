# Investigación Técnica: Compras y Proveedores

**Feature**: `008-compras-proveedores` | **Fecha**: 2026-09-04

## Decisión 1: la recepción de una orden se modela como un log de eventos append-only, no como un contador que se actualiza directamente (heredada)

**Decisión**: `recepcion_orden_compra` es una tabla independiente donde cada envío físico recibido genera una fila nueva. `detalle_orden_compra.cantidad_recibida` NO se actualiza con un `UPDATE cantidad_recibida = cantidad_recibida + X`; se recalcula sumando `SUM(cantidad_recibida_evento)` de todos los eventos de esa línea cada vez que se necesita.

**Justificación**: un proveedor de barrio no siempre entrega todo el pedido en un solo camión — puede llegar en dos o tres envíos distintos en días diferentes. Un contador vivo que se incrementa directamente es frágil ante reintentos de red o dobles envíos accidentales del cliente HTTP — el mismo principio de diseño que `006-caja-mermas-fraude` aplica a `monto_esperado` del cuadre de caja (se recalcula desde `venta`, nunca se mantiene como contador incremental). Aquí se aplica porque el riesgo de negocio es equivalente: un doble conteo de recepción infla el stock que después no existe físicamente.

**Alternativas consideradas**: mantener `cantidad_recibida` como columna editable directamente vía `UPDATE` en cada recepción — descartada porque un reintento de red duplicaría la cantidad recibida sin dejar rastro de qué pasó.

## Decisión 2: no existe una tabla de "catálogo por proveedor" separada — la comparación de precios se deriva de `historial_costo_producto` (heredada)

**Decisión**: la comparación de precios de un producto entre proveedores se resuelve consultando, por cada proveedor que haya vendido ese producto, su registro más reciente en `historial_costo_producto` — no se crea una tabla adicional tipo `producto_proveedor` con un precio "vigente" cacheado.

**Justificación**: `historial_costo_producto` de todas formas es obligatorio para OT1.3/OT3.3. Duplicar esa información en una segunda tabla de catálogo por proveedor obligaría a mantener sincronizados dos lugares con el mismo dato. Una consulta con `DISTINCT ON (proveedor_id) ... ORDER BY fecha DESC` resuelve el "precio vigente por proveedor" sin tabla adicional.

**Alternativas consideradas**: tabla `producto_proveedor` con un campo `precio_vigente` actualizado en cada recepción — descartada por duplicar el dato que ya vive en el historial.

## Decisión 3: la validación de "compra por oferta contra pronóstico" vive a nivel de `detalle_orden_compra`, no de la orden completa (heredada)

**Decisión**: los campos `pronostico_consultado` y `motivo_no_siguio_pronostico` (RN-CP-001) se guardan por línea de producto (`detalle_orden_compra`), no una sola vez por orden completa.

**Justificación**: una orden de compra por oferta puede incluir varios productos, y el pronóstico de demanda es específico por producto — si un proveedor ofrece 5 productos en oferta, cada uno puede tener un pronóstico distinto.

**Alternativas consideradas**: un único flag a nivel de `orden_compra` — descartada porque mezclaría productos que sí siguieron el pronóstico con otros que no.

## Decisión 4: el stub de pronóstico se reemplaza por una integración real con `004-pronostico-demanda`

**Decisión**: `GET /compras/productos/{producto_id}/pronostico` deja de ser un stub que devuelve un valor de ejemplo con `es_estimacion_provisional: true` — ahora consulta en vivo `GET /pronostico/{producto_id}` de `004-pronostico-demanda` (un módulo que no existía cuando se diseñó este módulo por primera vez) y traduce su respuesta (`datos_suficientes`, `cantidad_recomendada`) al formato que usa la validación RN-CP-001 de este módulo.

**Justificación**: bajo la estructura mínima obligatoria, `004-pronostico-demanda` ya existe como módulo real con su propia tabla append-only (`pronostico_demanda`) y su propio endpoint de consulta — mantener el stub aquí habría sido ignorar un módulo que este mismo proyecto ya construyó. La llamada es una consulta HTTP de solo lectura entre módulos (mismo patrón ya usado por `001-core-ventas-inventario` al llamar a `004-pronostico-demanda` para registrar demanda insatisfecha), nunca una FK ni una tabla compartida.

**Alternativas consideradas**: mantener el stub documentado como en el diseño original — descartada porque ya no hay razón para no integrar contra el módulo real; duplicar la lógica de pronóstico dentro de este módulo — descartada porque rompería la propiedad de datos que ya estableció `004-pronostico-demanda` sobre `pronostico_demanda`.

## Decisión 5 (enmienda v1.1, 2026-09-04): `forma_pago` y `numero_documento_proveedor` tras comparar contra un POS real de producción

**Contexto**: la misma comparación contra un POS real (opensourcepos) usada en la enmienda de `001-core-ventas-inventario` encontró dos campos reales en su tabla de recepciones (`ospos_receivings`) sin equivalente aquí: `payment_type` (cómo se pagó la compra) y `reference` (número de factura/guía del proveedor).

**Decisión**: se agrega `orden_compra.forma_pago` (`contado`/`credito`, obligatorio al crear la orden) y `recepcion_orden_compra.numero_documento_proveedor` (opcional, capturado en cada evento de recepción).

**Justificación**: ambos son datos reales de negocio que el criterio de evaluación exige poder mostrar ("documentos de negocio reales, no columnas sueltas"). `forma_pago` afecta directamente el flujo de caja de la cadena (OT1.3, costo de reposición) — una compra a crédito no compromete efectivo inmediato, una a contado sí, y hoy no había forma de distinguirlas. `numero_documento_proveedor` hace trazable cada `recepcion_orden_compra` contra el documento físico real del proveedor (factura o guía de remisión), sin lo cual una recepción registrada en el sistema no es verificable contra el papel que el proveedor entrega.

**Por qué `numero_documento_proveedor` es opcional y `forma_pago` no**: la forma de pago se decide al crear la orden (siempre se sabe de antemano), pero el documento del proveedor puede llegar después de la mercadería (common en compras informales de barrio) — exigirlo bloquearía recepciones legítimas. Mantener la asimetría es más honesto que forzar ambos campos a la misma obligatoriedad por simetría cosmética.

**Alternativas descartadas**: una tabla `documento_proveedor` separada, relacionada 1 a 1 con `recepcion_orden_compra` — descartada por ser sobre-ingeniería para un solo campo de texto opcional; exigir `numero_documento_proveedor` obligatorio — descartada por el argumento de oportunidad ya explicado.

## Decisión 6 (enmienda v1.2, 2026-09-04): catalogar el estado derivado sin volverlo editable, y el plazo de crédito como dato del tipo de pago

**Decisión A — `estado_orden_compra` como catálogo, sin tocar RNF-CP-001**: convertir `orden_compra.estado` de CHECK a FK parecía chocar con la Decisión 1 de este módulo, que establece que el estado es derivado y nunca editable. No hay tal conflicto: la FK garantiza que el valor **exista en el catálogo**, no habilita a nadie a escribirlo. El servicio lo sigue recalculando desde el log de recepciones y ningún endpoint lo expone para escritura directa. Un catálogo de estados y un estado editable son cosas distintas, y vale la pena dejarlo escrito porque a primera vista suena contradictorio.

Lo que sí gana el modelo es `permite_recepcion`: la regla de que una orden cancelada o ya recibida por completo no admite más recepciones vive hoy únicamente dentro del servicio de recepción. Como dato del catálogo, queda explícita y consultable (RN-CP-002).

**Decisión B — `dias_plazo_default` en `forma_pago`**: al catalogar la forma de pago apareció un vacío del diseño original. `forma_pago` distingue contado de crédito, pero **el crédito de un proveedor tiene plazo**, y ese dato no existe en ninguna parte del modelo. Saber que una orden es a crédito sin saber a cuántos días no permite anticipar cuándo hay que pagarla, que es justamente lo que OT1.3 necesita para gestionar el flujo de caja de la cadena.

El plazo se declara **a nivel del tipo de pago, no de cada orden**. Modelar el plazo negociado orden por orden, con fechas de vencimiento y saldos, sería un módulo de cuentas por pagar completo — un aumento de alcance que ningún OT de la cascada pide. El valor por defecto del catálogo da el dato base sin abrir esa puerta, y si más adelante hiciera falta el detalle por orden, se agrega un campo que sobreescriba el default sin rehacer nada.

**Alternativa descartada**: dejar `forma_pago` como CHECK y guardar el plazo como parámetro global en `010-administracion` — descartada porque el plazo depende de la forma de pago, no del sistema: contado y crédito tienen plazos distintos por definición, y un parámetro único no puede expresar eso.

## Resumen de decisiones para `data-model.md`

1. `recepcion_orden_compra` es un log append-only; `cantidad_recibida` es un valor derivado, recalculado por el servicio en cada consulta o transición de estado.
2. No hay tabla `producto_proveedor`; la comparación de precios se deriva de `historial_costo_producto` con `DISTINCT ON`.
3. `pronostico_consultado` y `motivo_no_siguio_pronostico` viven en `detalle_orden_compra`, no en `orden_compra`.
4. `GET /compras/productos/{producto_id}/pronostico` consulta en vivo `004-pronostico-demanda`, sin tabla ni FK propia para el pronóstico en sí.
5. *(Enmienda v1.1)* `orden_compra.forma_pago` (obligatorio) y `recepcion_orden_compra.numero_documento_proveedor` (opcional) se agregaron tras comparar contra un POS real (Decisión 5).
6. *(Enmienda v1.2)* 2 catálogos de clave natural: `forma_pago` (con `dias_plazo_default`) y `estado_orden_compra` (con `permite_recepcion`). `estado` pasa a FK sin dejar de ser derivado ni volverse editable (Decisión 6).
