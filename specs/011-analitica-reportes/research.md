# Investigación Técnica: Analítica y Reportes (BI)

**Feature**: `011-analitica-reportes` | **Fecha**: 2026-09-04

## Decisión 1: este módulo registra, no calcula — separación estricta entre orquestación y modelo

Los 5 modelos de scikit-learn (Art. 5.6) y el pipeline Airflow→ClickHouse (Art. 5.2) corren fuera de este módulo, como scripts/DAGs independientes. Este módulo solo expone los endpoints que esos procesos llaman al terminar, para dejar constancia operativa en PostgreSQL de lo que ocurrió. Se decidió esta separación para no repetir el error de mezclar cálculo estratégico con registro operativo — la nota metodológica de la cascada de objetivos ya advierte que confundir informe compuesto con objetivo operativo "obliga a rehacer la clasificación después" (lección de NexoStay, Tarea 11); aquí se aplica el mismo cuidado un nivel más abajo, entre el cálculo del modelo y el registro de que se calculó.

## Decisión 2: `version_modelo_ml` reutiliza el patrón de índice único parcial ya establecido en el proyecto

`UNIQUE (modelo) WHERE estado = 'activo'` es el mismo patrón estructural que `turno_caja` usa en `006-caja-mermas-fraude` (`WHERE estado='abierto'`, evitar dos turnos abiertos a la vez) y que `recomendacion_precio` usa en `003-precios-margenes` (`WHERE estado='pendiente'`, evitar dos recomendaciones pendientes simultáneas): un solo estado "activo" permitido a la vez por clave. Se eligió mantenerlo como índice único parcial en vez de un `UPDATE` sobre la fila anterior porque el historial completo de versiones (incluidas las descartadas por datos insuficientes) es en sí mismo un dato de auditoría del proceso de ML, no solo un puntero al valor vigente.

## Decisión 3: umbral mínimo de `tamano_muestra` es un parámetro por modelo, no un valor fijo en el CHECK de SQL

El Art. 5.9 exige que, si los datos no alcanzan para sostener un modelo, "el informe NO se implementa: se documenta por qué" — pero no fija un número mínimo universal (el umbral razonable para un modelo de churn no es el mismo que para segmentación K-Means). Se decidió que el umbral vive en la capa de servicio (`services/analitica.py`, un diccionario `UMBRAL_MINIMO_POR_MODELO`), no en un `CHECK` de PostgreSQL, para poder ajustarlo por modelo sin una migración — la propia tabla `version_modelo_ml` solo garantiza que `tamano_muestra` nunca sea `NULL` (RNF-AR-002), la decisión de activar o descartar la evalúa el servicio antes de insertar.

**Alternativa descartada**: un `CHECK (tamano_muestra >= 30)` genérico igual para los 5 modelos. Se descartó por ser una cifra arbitraria sin respaldo estadístico distinto por modelo — habría sido exactamente el tipo de "regla fija disfrazada de rigor" que el Art. 5.9 busca evitar en los propios informes de IA.

> *(Enmienda v1.1)* **El fondo de esta decisión se mantiene; cambia dónde vive el dato.** El umbral sigue siendo por modelo y sigue sin ser un CHECK genérico — pasa del diccionario `UMBRAL_MINIMO_POR_MODELO` en `services/analitica.py` a la columna `modelo_ml.tamano_muestra_minimo`. Ver Decisión 6.

## Decisión 4: `pregunta_asistente` audita la consulta generada, nunca solo la respuesta

El Art. 5.10 es explícito: el asistente "traduce la pregunta en lenguaje natural a una consulta estructurada sobre datos reales... y responde solo con lo que esa consulta devuelve". Si `pregunta_asistente` solo guardara `pregunta_texto` y `respuesta_texto`, no habría forma de auditar después si la respuesta realmente vino de una consulta real o fue una alucinación del LLM. Se decidió que `consulta_generada` es un campo obligatorio y que `RN-AR-003` lo impone a nivel de regla de negocio (no sólo `NOT NULL`, porque una consulta vacía `''` técnicamente pasaría un `NOT NULL`): el servicio rechaza registrar una pregunta sin una consulta estructurada no vacía asociada.

## Decisión 5: acceso exclusivo del rol `dueno` al asistente se valida en este módulo, no delegado a `010-administracion`

Aunque el JWT y sus claims de rol los emite `010-administracion`, la restricción "exclusivo del Dueño/Gerencia General" del Art. 5.10 es una regla de negocio específica de este módulo (ningún otro módulo tiene un recurso reservado a un solo rol de forma tan estricta — hasta el propio `010` permite que varios roles consulten distintos endpoints de auditoría con distinto alcance). Se decidió validar `rol == 'dueno'` explícitamente en el middleware de este módulo (`scoping.py` reutilizado, con una regla adicional específica), en vez de asumir que la matriz de permisos genérica de `010-administracion` (`permiso_rol`) sea suficientemente expresiva para esta restricción de "un único rol, sin excepciones".

## Decisión 6 (enmienda v1.1, 2026-09-04): los catálogos del módulo, y el umbral de muestra se muda del código al catálogo

**Decisión A — `modelo_ml` con `metrica_principal`**: `version_modelo_ml.nombre_metrica` era TEXT libre. Eso permite registrar el modelo de churn con `'silhouette'` — una métrica de clustering que no significa nada para una clasificación — sin que nada lo impida. Y hay un efecto peor y más silencioso: comparar el desempeño de dos versiones del mismo modelo solo tiene sentido si ambas se midieron con la misma métrica, y sin catálogo eso se cumple únicamente por disciplina de quien registra. RN-AR-004 lo vuelve una regla verificable.

**Decisión B — el umbral de muestra se muda al catálogo**: la Decisión 3 acertó en que el umbral debe ser por modelo y no un CHECK genérico. Lo que no acertó fue el lugar: un diccionario en `services/analitica.py`.

El Art. 5.9 no solo exige descartar el modelo cuando los datos no alcanzan; exige **documentar por qué**. Con el umbral en el código, la respuesta a "¿por qué se descartó esta versión?" vive en un archivo Python que nadie audita junto con los datos; con el umbral en `modelo_ml.tamano_muestra_minimo`, vive en la misma base que la versión descartada y su `motivo`, y una consulta puede mostrar los dos números juntos. Además se ajusta por migración, que deja rastro, en vez de por un cambio de código que puede pasar en cualquier commit.

Esto no contradice la Decisión 3: no se introduce un umbral único ni un CHECK genérico. Sigue habiendo un umbral distinto por modelo, con la misma justificación de entonces.

**Decisión C — `estado_version_modelo.es_version_servible`**: la regla de que solo la versión activa responde consultas vivía en el código. Como dato del catálogo, deja explícito que una versión `descartado_datos_insuficientes` **existe a propósito** — es el registro de honestidad que pide el Art. 5.9, no un error ni una fila a limpiar.

**Decisión D — el catálogo no relaja la constitución**: los cinco modelos son los del Art. 5.6. Que ahora vivan en una tabla en vez de un CHECK no significa que insertar una sexta fila incorpore un modelo nuevo al sistema — eso exige enmendar la constitución (Art. 9.1). RN-AR-006 lo deja escrito, porque un catálogo invita justamente a pensar lo contrario.

**Lo que NO se cataloga**: `validacion_calidad_datos.regla_validada` sigue siendo TEXT libre. Lo escribe el propio DAG y crece con cada regla de calidad nueva; catalogarlo obligaría a una migración cada vez que se agrega una comprobación. Mismo argumento que deja `log_auditoria.accion` sin catálogo en `010-administracion`.
