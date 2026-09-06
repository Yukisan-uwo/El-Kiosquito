# Investigación Técnica: Prevención de Pérdidas y Seguridad

**Feature**: `006-prevencion-perdidas-seguridad` | **Fecha**: 2026-09-04

## Decisión 1: las incidencias de cuadre de caja nunca modifican `turno_caja` — viven en una tabla propia de este módulo

**Decisión**: `incidencia_cuadre_caja` es una tabla de este módulo, con FK de solo lectura hacia `turno_caja` (`001-ventas-y-caja`). El catálogo de objetivos describe OO-PP05 como "marcar" (`UPDATE`) un cuadre de caja, pero se implementa como `INSERT` en esta tabla separada — un índice único parcial impide más de una incidencia `pendiente` por `turno_caja_id` a la vez.

**Justificación**: mismo principio de propiedad de datos por módulo que ya se aplicó en `clasificacion_producto` (`004-precios-margenes`, Decisión 2) y en `segmento_cliente`/`evaluacion_churn` (`005-fidelizacion-clientes`, Decisión 2): un modelo de IA no puede escribir directamente sobre datos de negocio ya cerrados de otro módulo (Art. 5.6), y el `turno_caja` ya está cerrado quirúrgicamente en su propio módulo — reabrirlo con un `UPDATE` externo rompería la garantía de que un turno cerrado es inmutable. El índice único parcial reutiliza el mismo patrón estructural que `turno_caja` (`001`) y `recomendacion_precio` (`004`) usaron para el mismo problema general: un solo estado "activo" permitido a la vez.

**Alternativas consideradas**: agregar una columna `posible_fraude` directamente a `turno_caja` — descartada porque mezclaría un juicio de un modelo de IA con el registro contable original del cuadre, y porque el score y la justificación del modelo (Art. 5.9) necesitan su propio espacio, no un booleano suelto.

## Decisión 2: el estado vigente de un datáfono se deriva de su revisión más reciente — `revision_datafono` es append-only

**Decisión**: `datafono` es un catálogo simple (uno por terminal físico, por sucursal); `revision_datafono` guarda cada revisión como una fila nueva, nunca se sobreescribe una revisión anterior. El estado "vigente" (`actualizado`/`vencido`) se calcula tomando la revisión más reciente por `datafono_id`.

**Justificación**: OT4.4 mide "% de terminales con validación de seguridad actualizada" como una meta sostenida en el tiempo, no un estado puntual — para poder auditar cuándo se revisó cada datáfono por última vez (y detectar terminales que llevan meses sin revisión) hace falta el historial completo, mismo principio de trazabilidad ya aplicado a costos (`003`) y precios (`004`).

**Alternativas consideradas**: un campo `estado` editable directamente en `datafono` — descartada porque perdería la fecha de cada revisión pasada, necesaria para detectar terminales que dejaron de revisarse regularmente (un patrón de negligencia que un solo campo "vigente" no puede mostrar).

## Decisión 3: `alerta_fraude_pago` es la única tabla escrita por dos módulos distintos — documentado como excepción explícita

**Decisión**: `alerta_fraude_pago` (creada en `001-ventas-y-caja`, con columnas `estado`, `atendida_en`, `atendida_por` ya definidas desde ese módulo) recibe su único `INSERT` desde Ventas y Caja (OO-VC10, en el momento de la venta) y su único `UPDATE` permitido desde este módulo (OO-PP07, al atenderla). Ningún otro módulo de este proyecto escribe en una tabla que no sea propia — esta es la única excepción, y se documenta aquí en vez de dejarla como una inconsistencia silenciosa.

**Justificación**: el enunciado describe un flujo de negocio que cruza naturalmente dos responsabilidades — la alerta se origina en el momento de la venta (competencia de Ventas y Caja, quien tiene el contexto de la transacción) pero se investiga y resuelve como parte del proceso de Prevención de Pérdidas (quien tiene el contexto de seguridad). Crear una tabla `atencion_alerta_fraude` separada en este módulo — el patrón que sí se usó para las recepciones de compra (`003`, que ocurren varias veces por orden) — no aporta valor aquí porque atender una alerta es un evento binario y único (abierta→atendida), no un historial de múltiples eventos.

**Alternativas consideradas**: tabla `atencion_alerta_fraude` separada — descartada por sobre-ingeniería frente a un estado binario sin historial que aportar; que Ventas y Caja implemente también el endpoint de atención — descartada porque el rol que atiende una alerta de fraude (Prevención de Pérdidas) no es el mismo que el que la genera (Cajero/Vendedor), y mezclar esa lógica en el router de Ventas y Caja rompería la separación por departamento que ya sigue el resto del proyecto.

## Resumen de decisiones para `data-model.md`

1. `incidencia_cuadre_caja` es tabla nueva, con índice único parcial `WHERE estado = 'pendiente'`.
2. `datafono` + `revision_datafono` (append-only), estado vigente derivado de la revisión más reciente.
3. `alerta_fraude_pago` no se redefine aquí — se referencia como tabla externa de `001-ventas-y-caja`, con el `UPDATE` de atención documentado como la única excepción de escritura cruzada del proyecto.
