# Investigación Técnica: Clientes y Fidelización

**Feature**: `002-clientes-fidelizacion` | **Fecha**: 2026-09-04

## Decisión 1: los cupones se sacaron de este módulo — viven en `005-promociones-inteligentes`

**Decisión**: la tabla `cupon` y todo su ciclo de vida (envío, canje, expiración) ya no viven aquí. `campana_recuperacion` conserva un FK opcional `cupon_id` hacia esa tabla externa, pero este módulo nunca la escribe.

**Justificación**: la estructura mínima obligatoria separa explícitamente "clientes-fidelización" (quién es el cliente, qué tan valioso es, si está en riesgo) de "promociones-inteligentes" (el mecanismo de cupones en sí, que activa tanto cumpleaños como patrones de compra y recuperación de churn). Mezclar ambos en un solo módulo duplicaría la lógica de canje en dos lugares del proyecto si en el futuro otro flujo también necesita emitir cupones sin pasar por una evaluación de churn.

**Alternativas consideradas**: mantener `cupon` aquí como en el diseño original — descartada porque no respeta el límite explícito que exige la estructura mínima del ingeniero.

## Decisión 2: segmentación y evaluación de churn siguen siendo resultados de modelos batch, append-only (heredada)

**Decisión y justificación**: sin cambios respecto al diseño original — `segmento_cliente` y `evaluacion_churn` son historial append-only, poblado por procesos batch de Analítica y Reportes (K-Means, modelo de churn), nunca calculado de forma síncrona. Esto es lo único que permite declarar tamaño de muestra y periodo (Art. 5.9) de forma auditable.

## Decisión 3: la ausencia de fila representa "sin datos suficientes" (heredada)

**Decisión y justificación**: sin cambios — un cliente bajo el umbral mínimo de historial simplemente no recibe fila en el ciclo correspondiente; la API traduce esa ausencia explícitamente, nunca la confunde con un resultado calculado.

## Decisión 4 (enmienda v1.1, 2026-09-04): `segmento_cliente` se convierte en la dimensión SCD tipo 2, en vez de crear una tabla de historia aparte

**Contexto**: la enmienda transversal de catálogos maestros preveía crear una tabla nueva `cliente_segmento_historial` para versionar el segmento del cliente. Al revisar el modelo real de este módulo antes de aplicarla, se comprobó que **esa premisa era incorrecta**: `segmento_cliente` ya era append-only desde el diseño original (Decisión 2), con `fecha_calculo`, `periodo_inicio`, `periodo_fin` y los snapshots de frecuencia/margen/recencia. La historia ya existía.

**Decisión**: no se crea ninguna tabla de historia. Se evoluciona `segmento_cliente` con lo que efectivamente le faltaba para ser una dimensión SCD tipo 2 legible:

1. `segmento_codigo` como FK al catálogo nuevo `segmento` (antes era TEXT libre).
2. `vigente_hasta` explícito, con índice único parcial `UNIQUE (cliente_id) WHERE vigente_hasta IS NULL` (RN-CF-002).
3. `version_modelo_id` obligatorio hacia `version_modelo_ml` de `011-analitica-reportes`.

**Por qué no la tabla aparte**: guardaría exactamente la misma información que `segmento_cliente` y obligaría a mantener las dos sincronizadas en cada ciclo de segmentación. Dos fuentes para el mismo hecho es precisamente el tipo de duplicación que causa que un informe contradiga a otro.

**Por qué `vigente_hasta` explícito y no deducirlo**: sin él, el segmento vigente se obtiene con `ORDER BY fecha_calculo DESC LIMIT 1` — que funciona para la consulta operativa — pero el ETL que construye `dim_cliente` tendría que calcular cada ventana de vigencia con `LEAD(fecha_calculo) OVER (PARTITION BY cliente_id ORDER BY fecha_calculo)` sobre la tabla completa en cada corrida. Guardar el rango es más barato y, sobre todo, hace que la vigencia sea un dato verificable en la BDR en lugar de un resultado que depende de que el pipeline lo calcule bien.

**Por qué el índice único parcial y no solo validación de servicio**: si un error dejara dos asignaciones abiertas para el mismo cliente, no habría ningún error visible — la consulta operativa seguiría devolviendo una de las dos y el problema aparecería mucho después, con la dimensión de cliente ya corrupta. Es el mismo patrón que ya usan `recomendacion_precio` (003) y `turno_caja` (006).

**Por qué `version_modelo_id` es obligatorio y no opcional**: es lo único que permite distinguir una reclasificación masiva causada por un reentrenamiento del K-Means de un cambio real de comportamiento de la clientela. Si fuera opcional, la primera asignación sin él ya rompería esa trazabilidad para siempre, y no hay forma de reconstruirla después.

**Alternativa descartada**: dejar `segmento` como TEXT y resolver el vocabulario en el ETL — descartada porque `prioridad_comercial` es un dato que `005-promociones-inteligentes` necesita en la capa **operativa** (a qué segmento enviarle cupones primero, OT2.3), no en la táctica. Definirlo en el pipeline lo dejaría fuera del alcance de quien lo necesita.

## Decisión 5 (enmienda v1.2, 2026-09-05, auditoría de riesgos derivados): `registrar_campana_recuperacion` faltaba exigir `es_riesgo_real`

**Contexto**: RN-CF-001 ya impedía registrar una campaña si el cliente había vuelto a comprar, pero eso no es lo mismo que exigir que el riesgo sea real. Una evaluación con `es_riesgo_real = false` (cliente en su ciclo normal de compra, aún sin volver a comprar) pasaba igual el único guard existente — el sistema enviaba correo real (Art. 8.4) y podía asociar un cupón con descuento a un cliente que iba a volver solo. El documento de objetivos define esta operación (OO-FC08) explícitamente como dirigida "a un cliente en riesgo real", y OT2.5 exige recuperar "sin descuentos innecesarios" — el guard existente no alcanzaba a garantizar eso.

**Decisión**: `registrar_campana_recuperacion` valida `evaluacion.es_riesgo_real` antes de crear la campaña (RN-CF-005), devolviendo `409` con un mensaje que nombra la regla. Es una validación de servicio, no un `CHECK` de fila — igual que RN-CF-001, depende de leer otra tabla (`evaluacion_churn`), no de una condición sobre las columnas de la fila que se inserta.

**Por qué no un `CHECK` o un trigger**: `es_riesgo_real` vive en `evaluacion_churn`, no en `campana_recuperacion` — no hay forma de expresar esta regla como una restricción de columna sin duplicar el dato. El mismo patrón que ya usa RN-CF-001.

## Resumen de decisiones para `data-model.md`

1. `cupon` no se define en este módulo — ver `005-promociones-inteligentes`.
2. `segmento_cliente`/`evaluacion_churn` append-only con `tamano_muestra`/`periodo` obligatorios.
3. `campana_recuperacion.cupon_id` es FK externa opcional.
4. *(Enmienda v1.2)* `registrar_campana_recuperacion` exige `evaluacion_churn.es_riesgo_real = true` además de RN-CF-001 (Decisión 5).
4. *(Enmienda v1.1)* Catálogo nuevo `segmento` (clave natural, con `prioridad_comercial`), y `segmento_cliente` evoluciona a dimensión SCD tipo 2 con `segmento_codigo` FK, `vigente_hasta` + índice único parcial y `version_modelo_id` obligatorio (Decisión 4). **No se crea tabla de historia aparte** — `segmento_cliente` ya lo era.
