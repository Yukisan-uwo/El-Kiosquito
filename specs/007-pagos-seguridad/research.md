# Investigación Técnica: Pagos y Seguridad

**Feature**: `007-pagos-seguridad` | **Fecha**: 2026-09-04

## Decisión 1: por qué este módulo se separa de `006-caja-mermas-fraude` en vez de fusionarse con él

**Decisión**: `datafono`/`revision_datafono` no se agrupan con `turno_caja`/`alerta_fraude_pago`/`merma`/`incidencia_cuadre_caja` en `006-caja-mermas-fraude`, a pesar de que ambos módulos provienen del mismo departamento original (Prevención de Pérdidas y Seguridad) y de que la estructura mínima obligatoria ya nombra `007-pagos-seguridad` como un módulo aparte.

**Justificación**: la diferencia no es de departamento sino de naturaleza del dato — `006-caja-mermas-fraude` reacciona a eventos que ya ocurrieron (una diferencia de caja, una merma detectada, un pago puntual sospechoso), mientras que este módulo es preventivo y de infraestructura: un datáfono no genera un "evento de venta", es un activo físico que se revisa periódicamente sin relación con ninguna transacción específica. Mezclarlos habría forzado a `006` a modelar dos tipos de datos con ciclos de vida completamente distintos (eventos transaccionales vs. un catálogo de hardware con su propio historial de mantenimiento).

**Alternativas consideradas**: fusionar todo Prevención de Pérdidas y Seguridad en un solo módulo — descartada porque la estructura mínima obligatoria ya exige `007-pagos-seguridad` como módulo separado, y porque el argumento de fondo (evento reactivo vs. activo preventivo) es válido independientemente de esa exigencia.

## Decisión 2: el estado vigente de un datáfono se deriva de su revisión más reciente — `revision_datafono` es append-only (heredada)

**Decisión**: `datafono` es un catálogo simple (uno por terminal física, por sucursal); `revision_datafono` guarda cada revisión como una fila nueva, nunca se sobreescribe una revisión anterior. El estado "vigente" (`actualizado`/`vencido`) se calcula tomando la revisión más reciente por `datafono_id`.

**Justificación**: OT4.4 mide "% de terminales con validación de seguridad actualizada" como una meta sostenida en el tiempo, no un estado puntual — para poder auditar cuándo se revisó cada datáfono por última vez (y detectar terminales que llevan meses sin revisión) hace falta el historial completo, el mismo principio de trazabilidad ya aplicado a costos, precios y pronósticos en otros módulos de este proyecto.

**Alternativas consideradas**: un campo `estado` editable directamente en `datafono` — descartada porque perdería la fecha de cada revisión pasada, necesaria para detectar terminales que dejaron de revisarse regularmente (un patrón de negligencia que un solo campo "vigente" no puede mostrar).

## Decisión 3: la ausencia de revisión se declara explícitamente, nunca se asume `actualizado` por defecto

**Decisión y justificación**: un datáfono recién dado de alta sin ninguna fila en `revision_datafono` responde `sin_revision: true` en vez de un estado por defecto — asumir `actualizado` sería exactamente el tipo de cifra sin respaldo que prohíbe el Art. 5.9, aplicado aquí no a un modelo de IA sino a cualquier dato que el sistema no tiene todavía. Es el mismo patrón de honestidad ya usado para "sin datos suficientes" en segmentación, churn y pronóstico de demanda, aplicado a un dato operativo en vez de un resultado de modelo.

## Decisión 4 (enmienda v1.1, 2026-09-04): `cuenta_como_conforme` en el catálogo, y los datáfonos sin revisión no cuentan

**Decisión**: `revision_datafono.estado` pasa de CHECK a FK sobre `estado_revision`, que declara `cuenta_como_conforme`.

**Por qué el atributo**: el indicador de OT4.4 es "% de terminales con validación de seguridad actualizada". Hoy su numerador vive como un `WHERE estado = 'actualizado'` repetido en cada consulta que lo necesite. Eso funciona mientras haya exactamente dos estados, pero el momento en que aparezca un tercero — `'en_revision'` mientras el proveedor certifica el terminal, por ejemplo — habría que encontrar y revisar cada una de esas consultas para decidir si el nuevo estado cuenta. Con la columna, esa decisión se toma una sola vez: al insertar la fila del catálogo.

Es el mismo patrón que `estado_venta.cuenta_para_ingresos` en `001-core-ventas-inventario` — una regla de negocio que estaba repetida como filtro pasa a ser un dato del modelo.

**Decisión relacionada — los datáfonos sin revisión no son conformes**: al materializar el indicador como endpoint (RF-PS-008) hubo que decidir explícitamente qué hacer con los datáfonos que nunca fueron revisados. No entran al numerador, y se reportan aparte en `terminales_sin_revision`.

La razón es de fondo, no de cálculo: un terminal que nadie ha verificado nunca es precisamente el más riesgoso desde el punto de vista de la exposición legal del negocio ante un fraude (que es lo que OT4.4 busca controlar). Contarlo como conforme inflaría el KPI justo donde el riesgo real es mayor. Es coherente con la Decisión 3 de este mismo módulo: la ausencia de dato se declara, nunca se interpreta a favor.

## Decisión 5 (enmienda v1.2, 2026-09-05, auditoría de riesgos derivados): trazabilidad real venta↔datáfono

**Contexto**: una auditoría de riesgos derivados encontró que este módulo y `001-core-ventas-inventario` trataban el mismo hardware desde ángulos completamente desconectados: 007 sabe si un datáfono está al día en seguridad, 001 sabe qué se vendió y cómo se cobró, pero no había ningún dato que uniera ambas cosas. Ante una disputa con la pasarela de pago o una investigación de `alerta_fraude_pago` (006), no existía forma de responder "¿estaba este terminal conforme cuando cobró esta venta puntual?".

**Decisión**: `001-core-ventas-inventario` agrega `venta.datafono_id` (FK externa hacia `datafono`, ver su propia Decisión 9). Este módulo agrega `GET /pagos/datafonos/{id}/ventas`, que lee `venta` (solo lectura, nunca escribe) y la cruza contra `revision_datafono` calculando, para cada venta, cuál era el estado de revisión vigente **en la fecha de esa venta** — no el estado actual del datáfono.

**Por qué "vigente en la fecha de la venta" y no el estado actual**: si un datáfono estaba conforme cuando cobró una venta hace tres meses pero hoy está vencido (o viceversa), la pregunta relevante para una disputa sobre ESA venta es cómo estaba el terminal en ese momento, no hoy. Mismo criterio ya aplicado en `etl/ml/churn.py` (004) al evaluar `segmento_cliente` vigente en la fecha de cada `evaluacion_churn`, no el segmento actual del cliente.

**Por qué el endpoint vive en 007 y no en 001**: 007 es dueño de la pregunta "¿este datáfono estuvo conforme?" — ya expone `GET /datafonos/{id}/estado` y `GET /sucursales/{id}/datafonos/conformidad` sobre el mismo dato. Este endpoint nuevo es la misma familia de preguntas, solo que ancladas a transacciones puntuales en vez de al estado agregado de una sucursal. Que lea `venta` no contradice ningún RNF de ninguno de los dos módulos: ambos prohíben ESCRIBIR en tablas ajenas, ninguno prohíbe leerlas.

## Resumen de decisiones para `data-model.md`

1. Este módulo no comparte tablas con `006-caja-mermas-fraude`, solo el mismo departamento de origen.
2. `revision_datafono` es append-only; el estado vigente se deriva con `DISTINCT ON (datafono_id) ORDER BY fecha_revision DESC`.
3. Un datáfono sin revisiones responde explícitamente `sin_revision: true`, nunca un estado asumido.
4. *(Enmienda v1.1)* Catálogo `estado_revision` con `cuenta_como_conforme`; `revision_datafono.estado` pasa a FK, y los datáfonos sin revisión nunca entran al numerador del KPI de OT4.4 (Decisión 4).
5. *(Enmienda v1.2)* Este módulo no gana ninguna tabla nueva — solo un endpoint de lectura cruzada (`GET /pagos/datafonos/{id}/ventas`) que se apoya en `venta.datafono_id`, agregado en `001-core-ventas-inventario` (Decisión 5).
