# Investigación Técnica: Fidelización y Clientes

**Feature**: `005-fidelizacion-clientes` | **Fecha**: 2026-09-04

## Decisión 1: los cupones se modelan en una sola tabla con `tipo_origen`, no en tres tablas separadas

**Decisión**: `cupon` tiene un campo `tipo_origen` con valores `'cumpleanos'`, `'patron_compra'` o `'recuperacion_churn'`, en vez de existir `cupon_cumpleanos`, `cupon_patron` y `cupon_recuperacion` como tablas independientes.

**Justificación**: el ciclo de vida de un cupón (`activo` → `canjeado` o `expirado`) y la lógica de canje (RF-FC-005/RN-FC-001) son idénticos sin importar qué lo originó — separar en tres tablas obligaría a triplicar esa lógica y a que el endpoint de canje (OO-FC06) supiera consultar tres tablas distintas según el tipo. El único dato que realmente cambia según el origen es la trazabilidad hacia atrás (qué evaluación de churn originó un cupón de recuperación), que se resuelve con un FK opcional (`evaluacion_churn_id`), no con tablas separadas.

**Alternativas consideradas**: tres tablas separadas, una por origen — descartada por la duplicación de lógica de canje/expiración; un campo `tipo_origen` de texto libre sin CHECK — descartada porque perdería la validez garantizada por base de datos que sí tiene un `CHECK IN (...)`.

## Decisión 2: la segmentación y la evaluación de churn son resultados de modelos batch, guardados como historial append-only — nunca calculados de forma síncrona en cada consulta

**Decisión**: `segmento_cliente` y `evaluacion_churn` son tablas de solo inserción, pobladas por un proceso batch (K-Means y el modelo de churn, ambos de la capa estratégica de Analítica y Reportes, OT4.1) que corre periódicamente vía Airflow. Una consulta de segmento o riesgo de abandono siempre lee la fila más reciente por cliente — nunca dispara un cálculo en el momento de la petición.

**Justificación**: la constitución exige (Art. 5.9) que ningún informe de IA presente una cifra sin declarar tamaño de muestra y periodo — eso solo es posible si el resultado queda fijado en el momento en que el modelo corrió sobre un conjunto de datos específico, no si se recalcula sobre datos que cambian constantemente en cada consulta. Además, tanto K-Means como el modelo de churn necesitan el historial completo de compras de todos los clientes para entrenar/inferir, algo demasiado costoso para ejecutar en cada `GET`. Esto también reinterpreta el catálogo de objetivos: OO-FC07 se describe ahí como "marcar" (`UPDATE`) a un cliente en riesgo, pero se implementa como un `INSERT` en un historial append-only por la misma razón de trazabilidad — un `UPDATE` sobre un campo `en_riesgo` en `cliente` perdería el registro de evaluaciones anteriores y su justificación.

**Alternativas consideradas**: calcular el segmento/riesgo en el momento de cada consulta — descartada por costo computacional y porque impediría declarar un tamaño de muestra fijo y auditable; un campo `en_riesgo_abandono` editable directamente en `cliente` — descartada por la misma razón de trazabilidad que llevó a `historial_costo_producto` y `historial_precio_producto` a ser append-only en módulos anteriores.

## Decisión 3: un cliente sin historial de compras suficiente no recibe fila en `segmento_cliente` ni en `evaluacion_churn` en ese ciclo

**Decisión**: el umbral mínimo de compras para que un cliente entre al cálculo de segmentación o de churn es un parámetro configurable en `parametro_sistema` (Administración, mismo patrón que los umbrales de Inventario y Caducidad) — no una constante de código. Si un cliente no alcanza el umbral, el modelo simplemente no genera fila para él en ese ciclo.

**Justificación**: un K-Means o un modelo de churn entrenado con uno o dos puntos de dato por cliente producen un resultado estadísticamente vacío de significado — presentarlo igual violaría la regla de honestidad del Art. 5.9 ("si no hay datos suficientes, no se implementa"). Dejar el umbral configurable evita hardcodear un número arbitrario que Alta Dirección no podría ajustar sin desplegar código nuevo.

**Alternativas consideradas**: asignar un segmento/riesgo por defecto ("nuevo cliente") a quien no alcanza el umbral — descartada porque un valor por defecto etiquetado como resultado de un modelo sería, en la práctica, una cifra inventada.

## Resumen de decisiones para `data-model.md`

1. `cupon` es una sola tabla con `tipo_origen` y un FK opcional `evaluacion_churn_id` para trazabilidad de recuperación.
2. `segmento_cliente` y `evaluacion_churn` son append-only, cada fila con `tamano_muestra` y `periodo_inicio`/`periodo_fin` obligatorios.
3. La ausencia de fila para un cliente en un ciclo dado es la forma correcta de representar "sin datos suficientes" — la API lo traduce explícitamente, nunca lo confunde con un valor calculado.
