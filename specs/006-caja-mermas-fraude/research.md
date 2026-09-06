# Investigación Técnica: Caja, Mermas y Fraude

**Feature**: `006-caja-mermas-fraude` | **Fecha**: 2026-09-04

## Decisión 1: por qué `turno_caja` y `alerta_fraude_pago` se mudan aquí desde el antiguo módulo de Ventas y Caja

**Decisión**: `turno_caja` (control de caja por turno) y `alerta_fraude_pago` (alertas de fraude en pago) dejan de vivir junto a `venta`/`detalle_venta` y pasan a este módulo, junto con `merma` e `incidencia_cuadre_caja` (que ya venían de Prevención de Pérdidas en el diseño original).

**Justificación**: la estructura mínima obligatoria agrupa explícitamente caja, mermas y fraude en un solo módulo de control de pérdidas — la razón de negocio es que las cuatro tablas comparten el mismo propósito (detectar y documentar una posible pérdida de dinero o mercadería) y suele revisarlas el mismo perfil de encargado, aunque provengan de dos departamentos distintos en la cascada de objetivos original. Además, separar `turno_caja` de `venta` protege la ruta transaccional caliente (`001-core-ventas-inventario`, que debe cerrar una venta en segundos) de la lógica de cuadre y conciliación, que corre en un ciclo distinto (por turno, no por venta) — el mismo argumento que ya usó `001-core-ventas-inventario` en su propio `research.md` al excluir `turno_caja`.

**Alternativas consideradas**: mantener `turno_caja`/`alerta_fraude_pago` en `001-core-ventas-inventario` — descartada porque la estructura mínima exigida agrupa caja junto con mermas y fraude, no junto con la venta en sí; crear un noveno módulo separado solo para caja — descartada porque fragmentaría aún más una funcionalidad que el ingeniero espera ver agrupada según el árbol de referencia.

## Decisión 2: `incidencia_cuadre_caja` sigue sin modificar `turno_caja`, aunque ahora ambas tablas vivan en el mismo módulo

**Decisión**: `incidencia_cuadre_caja` sigue siendo una tabla separada de `turno_caja`, con FK hacia ella y un índice único parcial `UNIQUE (turno_caja_id) WHERE estado = 'pendiente'` — nunca se agrega una columna `posible_fraude` o similar directamente a `turno_caja`.

**Justificación**: en el diseño original esta separación existía porque los dos módulos eran distintos (Art. 4, propiedad de datos entre módulos). Ahora que ambas tablas conviven en `006-caja-mermas-fraude`, la razón de fondo para mantenerlas separadas sigue vigente y es incluso más importante de dejar explícita: el Art. 5.6 prohíbe que un modelo de IA escriba directamente sobre datos de negocio ya cerrados, sin importar si la tabla de destino está en el mismo módulo Spec Kit o no — un turno de caja cerrado es un registro contable inmutable (Art. 10.5), y el resultado de un modelo de anomalías es un juicio probabilístico que necesita su propio espacio auditable (`score_anomalia`, `justificacion`), nunca una alteración del registro original.

**Alternativas consideradas**: ahora que están en el mismo módulo, fusionar `incidencia_cuadre_caja` como columnas de `turno_caja` — descartada explícitamente porque el límite que importa aquí no es el módulo Spec Kit, sino la inmutabilidad de un registro contable ya cerrado frente al juicio de un modelo de IA.

## Decisión 3: `alerta_fraude_pago` sigue siendo la única tabla escrita por dos módulos distintos — ahora entre `001-core-ventas-inventario` y este módulo

**Decisión**: `alerta_fraude_pago` vive en este módulo (`006-caja-mermas-fraude`), pero recibe su único `INSERT` desde `001-core-ventas-inventario` (en el momento de la venta, cuando se detecta un pago con tarjeta sospechoso) y su único `UPDATE` permitido desde este módulo (al atenderla). Ningún otro par de módulos del proyecto comparte una escritura así — es la misma excepción documentada que existía en el diseño original, solo que ahora conecta un par de módulos distinto (antes era Ventas y Caja ↔ Prevención de Pérdidas, ahora es `001-core-ventas-inventario` ↔ `006-caja-mermas-fraude`).

**Justificación**: el enunciado describe un flujo de negocio que cruza naturalmente dos responsabilidades — la alerta se origina en el momento de la venta (competencia de quien tiene el contexto de la transacción, `001-core-ventas-inventario`) pero se investiga y resuelve como parte del proceso de control de pérdidas (competencia de este módulo). Crear una tabla de "atención de alerta" separada no aporta valor porque atender una alerta es un evento binario y único (`abierta`→`atendida`), no un historial de múltiples eventos — mismo razonamiento que ya se documentó en el diseño original.

**Alternativas consideradas**: que `001-core-ventas-inventario` también implemente el endpoint de atención — descartada porque el rol que atiende una alerta de fraude no es el mismo que el que la genera, y mezclar esa lógica en el router de ventas rompería la separación de responsabilidades que ya sigue el resto del proyecto.

## Decisión 4: la secuencia obligatoria detección → causa → resultado de una merma se mantiene sin cambios (heredada)

**Decisión y justificación**: sin cambios respecto al diseño original — una merma se registra apenas se detecta, sin exigir causa; la causa se asigna después; el resultado de investigación solo se acepta si ya existe causa asignada (RN-CMF-003). Esto refleja el flujo real de un kiosko: rara vez se sabe la causa exacta en el momento de notar que falta mercadería.

## Decisión 5 (enmienda v1.1, 2026-09-04): puntos de control horario automáticos para dar granularidad intra-turno al modelo de anomalías

**Contexto**: la auditoría enunciado-vs-specs marcó como parcial el requisito de "cuadre de caja" del enunciado — el diseño original solo detecta un patrón anómalo al cierre completo del turno (`RF-CMF-002`/`RF-CMF-009`), nunca durante el turno mismo. Un fraude o error que se revierte antes del cierre (por ejemplo, sacar dinero de la caja y devolverlo antes de que el turno termine) nunca dejaría rastro si el único punto de medición es el cierre.

**Decisión**: se agrega `punto_control_horario_turno` — cada hora, un job interno del sistema calcula y guarda el monto esperado acumulado de cada turno de caja que siga `abierto`, agregando exclusivamente las ventas en efectivo ya registradas en `001-core-ventas-inventario` hasta ese instante (el mismo cálculo que ya existía para `monto_esperado` al cierre, solo que tomado a mitad de turno). No se le pide nada al cajero: no hay conteo físico intermedio, no hay ninguna pantalla nueva que deba completar. El modelo de detección de anomalías (Isolation Forest, RF-CMF-009) puede entonces entrenar y detectar con una serie de puntos por turno en vez de un solo valor final.

**Justificación de por qué es "real, no simulado"**: el requisito explícito del usuario fue cubrir lo cubrible sin volverlo extremadamente complejo, y sin simular nada salvo la pasarela de pago. Pedirle al cajero un conteo físico de caja cada hora sí sería una carga operativa nueva y poco realista para un kiosko pequeño (y, si se simulara ese conteo, violaría la restricción de "nada simulado"). En cambio, agregar automáticamente ventas que YA son reales y ya están en la base de datos es una funcionalidad genuina y ejecutable, no un mock — el job puede correr de verdad, sobre datos de verdad, sin inventar ninguna interacción humana adicional.

**Por qué es un job y no un endpoint accesible por un rol humano**: a diferencia de `incidencia_cuadre_caja` (que sí necesita un endpoint `POST` porque el modelo de anomalías corre como proceso batch externo e inserta su resultado), aquí el disparador es puramente temporal (cada hora), no el resultado de un cálculo de un modelo — se implementa como una tarea programada del backend (scheduler interno, p. ej. APScheduler o un cron del contenedor) que llama al mismo servicio de cálculo que ya usa `PATCH /caja/turnos/{id}/cerrar`, reutilizando la lógica de `calcular_monto_esperado` (T015 de `tasks.md`) en vez de duplicarla. Se expone igualmente un endpoint interno `POST /caja/turnos/{id}/checkpoints` restringido al rol `sistema` (nunca a un cajero ni encargado) para que el scheduler lo invoque como cualquier otra llamada HTTP interna del proyecto — consistente con cómo ya se implementan `POST /caja/incidencias-cuadre` y `POST /pronostico/ciclos` en otros módulos — y un `GET` de solo lectura para que Prevención de Pérdidas y el propio modelo puedan consultar el historial.

**Alternativas consideradas**: (a) pedirle al cajero un conteo físico intermedio — descartada por carga operativa y por rozar "simulación" si no se puede garantizar que el conteo sea real cada vez. (b) no persistir los checkpoints y calcular la serie de tiempo on-the-fly desde `venta` cada vez que el modelo entrena — descartada porque recalcular sobre todas las ventas de todos los turnos abiertos en cada entrenamiento es más costoso y menos auditable que tener la serie ya materializada, y porque el Art. 5.9 favorece que un resultado usado por un modelo de IA quede persistido y trazable, no recalculado implícitamente cada vez.

## Decisión 6 (enmienda v1.2, 2026-09-04): `es_atribuible_a_persona` como dato del catálogo, y por qué `estado_alerta` y `estado_incidencia` no se unifican

**Decisión A — el atributo clave**: `causa_merma` no es un catálogo de código-etiqueta. Lleva `es_atribuible_a_persona`, que separa `robo_externo` y `caducidad` (sin responsable interno) de `error_humano` y `fraude_interno` (con responsable).

**Por qué importa tanto**: OT3.4 pide cruzar la causa de cada merma con el cuadre de caja, y ese cruce solo tiene sentido sobre las mermas atribuibles. Sin la columna, cada consulta e informe tiene que escribir `WHERE causa IN ('error_humano','fraude_interno')` a mano. Esa lista se puede quedar corta el día que se agregue una causa nueva — y el efecto concreto de ese olvido es que un fraude interno se contabilice como pérdida no atribuible, es decir, exactamente el error que el objetivo táctico existe para evitar. Con el catálogo, una causa nueva se clasifica una vez, al insertarla, y todos los informes la tratan bien desde el primer registro.

Es además la línea que separa dos respuestas de negocio distintas: una merma no atribuible se combate con seguridad física o con gestión de caducidad; una atribuible dispara una investigación sobre una persona. Que esa distinción viva en el modelo y no en el código de cada consulta es lo correcto.

**Decisión B — dos catálogos de estado que hoy parecen iguales**: `estado_alerta` (`abierta`/`atendida`) y `estado_incidencia` (`pendiente`/`atendida`) tienen la misma forma, y sería tentador unificarlos en un catálogo genérico de "estado de seguimiento".

Se mantienen separados. Una alerta de fraude en un pago con tarjeta y una incidencia de cuadre de caja son procesos distintos, con responsables y tiempos distintos. Unificarlos significaría que el día que uno de los dos gane un estado nuevo — `en_revision` para una alerta que está con el proveedor de pagos, `escalada` para una incidencia que pasó a Gerencia — ese estado aparecería automáticamente como opción válida del otro proceso, sin que nadie lo haya decidido. La FK dejaría de garantizar que el valor tiene sentido en su contexto, que es justamente para lo que se creó el catálogo.

**Alternativa descartada**: un único catálogo `estado_seguimiento` compartido — descartada por lo anterior. La coincidencia actual de valores es circunstancial, no estructural.

## Decisión 7 (enmienda v1.3, 2026-09-05, auditoría de riesgos derivados): arqueo parcial voluntario, sin contradecir la Decisión 5

**Contexto**: la Decisión 5 (enmienda v1.1) justificó, correctamente, no imponer un conteo físico obligatorio cada hora — carga operativa real para un kiosko pequeño, y riesgo de volverse "simulado" si no se puede garantizar genuino cada vez. Esa decisión sigue vigente: `punto_control_horario_turno` sigue siendo exclusivamente automático. Pero la auditoría de riesgos derivados encontró la otra cara: sin ningún mecanismo de conteo físico intermedio, un fraude cometido y revertido antes del cierre del turno es invisible incluso con los checkpoints — porque estos nunca comparan contra efectivo contado de verdad, solo calculan lo que se espera.

**Decisión**: se agrega `arqueo_parcial_turno` — un conteo físico real, pero **voluntario, humano-iniciado, nunca un job**. Un cajero puede contar su propia caja a mitad de turno; un encargado de sucursal puede hacer un spot-check de supervisión sin previo aviso (mismo alcance que ya tiene sobre `merma`/`alerta_fraude`). No reintroduce la carga que la Decisión 5 evitó: nadie está obligado a hacerlo nunca, es una herramienta disponible, no un requisito. Recurso RBAC propio (`arqueo_parcial`), separado de `turno_caja` — ahí solo el cajero crea/cierra el suyo; acá tanto cajero como sucursal pueden registrar uno.

**Por qué no ampliar `punto_control_horario_turno` en vez de una tabla nueva**: esa tabla es, por diseño (RN-CMF-006), de generación exclusivamente automática — agregarle un `monto_contado` opcional confundiría dos cosas de naturaleza distinta (un cálculo de sistema vs. un conteo humano) en la misma fila, y complicaría el CHECK de "automático siempre, humano nunca" que la protege hoy.

## Resumen de decisiones para `data-model.md`

1. `turno_caja` y `alerta_fraude_pago` se definen en este módulo (antes en Ventas y Caja); `alerta_fraude_pago` recibe su `INSERT` desde `001-core-ventas-inventario`.
2. `incidencia_cuadre_caja` mantiene su índice único parcial `WHERE estado = 'pendiente'` y nunca modifica `turno_caja`, aunque estén en el mismo módulo.
3. `merma` mantiene `causa` y `resultado_investigacion` nullable con el CHECK de secuencia obligatoria.
4. *(Enmienda v1.1)* `punto_control_horario_turno` es append-only, de generación exclusivamente automática (job interno cada hora), nunca modifica `turno_caja` y reutiliza el mismo cálculo de `monto_esperado` ya existente.
5. *(Enmienda v1.2)* 5 catálogos de clave natural; `causa_merma.es_atribuible_a_persona` es la base del cruce de OT3.4 (Decisión 6A) y `estado_alerta`/`estado_incidencia` se mantienen separados a propósito (Decisión 6B).
