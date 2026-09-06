# Investigación Técnica: Core de Ventas e Inventario

**Feature**: `001-core-ventas-inventario` | **Fecha**: 2026-09-04

## Decisión 1: `factor_conversion` vive en `producto`, no por sucursal (heredada, confirmada en este módulo)

**Decisión y justificación**: sin cambios respecto a la decisión original — Compras negocia a nivel de producto, no de sucursal, así que dos sucursales nunca deben calcular un stock distinto para el mismo ingreso físico. Se reafirma aquí porque `producto` y `venta` ahora conviven en el mismo módulo, lo que hace aún más directo aplicar la conversión en el mismo servicio que registra la venta.

## Decisión 2: `venta` separa su ciclo de vida del de `turno_caja` — por eso viven en módulos distintos

**Decisión**: `venta`/`detalle_venta` quedan en este módulo; `turno_caja` (apertura, cierre, cuadre) pasa a `006-caja-mermas-fraude`. `venta.turno_caja_id` sigue existiendo como FK, pero apunta a una tabla que este módulo nunca escribe.

**Justificación**: una venta se cierra en segundos (el cliente paga y se va); un turno de caja se cierra al final de un periodo agregando decenas de ventas y comparando el efectivo contado contra lo esperado. Son dos ciclos de vida con ritmos y responsables distintos — el cajero abre/cierra su turno una o dos veces al día, pero registra ventas constantemente. Mantenerlos en el mismo módulo obligaría a que cualquier cambio en la lógica de cuadre (que es, en esencia, un problema de control de pérdidas) recompile y retestee todo el flujo transaccional de venta, que es el camino más caliente del sistema (RNF-CVI-001, <300ms).

**Alternativas consideradas**: mantener `turno_caja` en este módulo (como en la versión anterior del proyecto, cuando el Spec Kit se organizaba por departamento) — descartada porque la estructura mínima exigida agrupa explícitamente caja junto con mermas y fraude en un módulo de control de pérdidas, no junto con la venta en sí.

## Decisión 3: `demanda_insatisfecha` se movió fuera de este módulo — solo tiene valor como insumo del pronóstico

**Decisión**: el registro de demanda insatisfecha (cliente pidió un producto sin stock) ya no vive en este módulo — pasa a `004-pronostico-demanda`, que expone su propio endpoint de registro.

**Justificación**: a diferencia de una venta, un evento de demanda insatisfecha nunca se consulta por sí solo desde el punto de venta ni afecta el stock — su único consumidor es el modelo de pronóstico de demanda (OT3.7). Colocarlo en el módulo que también posee el pronóstico evita que este módulo (el más transaccional y sensible a latencia de todos) cargue una responsabilidad que es, en esencia, de recolección de datos para otro modelo.

**Alternativas consideradas**: mantenerlo aquí y que `004-pronostico-demanda` solo lo consulte — descartada porque el POS ya no necesita mostrar ni procesar ese dato una vez registrado, así que no hay razón operativa para que la tabla viva en el módulo transaccional.

## Decisión 4: `lote_producto` sigue existiendo solo para productos perecederos (heredada)

**Decisión y justificación**: sin cambios — implementar trazabilidad de lotes para todo el catálogo sería sobre-ingeniería frente a lo que pide el enunciado (alertas de caducidad de perecederos, no un sistema de lotes universal).

## Decisión 5 (enmienda v1.1, 2026-09-04): `hora_inicio_cobro` y `producto_sustituto` se agregan tras una auditoría del enunciado contra las specs ya entregadas

**Contexto**: al contrastar los 11 módulos ya entregados contra el enunciado punto por punto, aparecieron dos huecos concretos en este módulo: (1) la meta de OT2.2 ("tiempo de cobro <90 seg") no tenía ningún campo que permitiera medirla — `venta` solo guardaba `fecha_hora` (el cierre), nunca el inicio; (2) "sustitución de marca cuando falta stock" (hueco de negocio confirmado desde el inicio del proyecto) nunca llegó a tener tabla propia en ningún módulo.

**Decisión**: se agrega `venta.hora_inicio_cobro` (nullable, opcional — el cajero/POS lo envía si lo captura, sin bloquear la venta si no) y una tabla nueva `producto_sustituto` (pares dirigidos producto↔sustituto, con inserción simétrica opcional desde el servicio).

**Justificación de por qué viven aquí y no en otro módulo**: `hora_inicio_cobro` es un campo más de `venta`, la tabla dueña de este mismo módulo — no ameritaba ni una tabla nueva ni mucho menos un módulo nuevo. `producto_sustituto` es catálogo puro (qué producto reemplaza a cuál), exactamente el mismo tipo de dato que `producto` — vive junto a él por la misma razón que `clasificacion_producto` vive en `003-precios-margenes` en vez de en un módulo aparte: es un atributo relacional del catálogo, no un evento transaccional. El *uso* del sustituto en un quiebre de stock real (si se ofreció, si se aceptó) sí es un evento transaccional, y por eso esos campos se agregan a `demanda_insatisfecha` en `004-pronostico-demanda`, no aquí — este módulo solo expone el catálogo de qué sustituye a qué.

**Alternativas descartadas**: registrar `hora_inicio_cobro` como un endpoint separado (`POST /ventas/iniciar-cobro` seguido de `POST /ventas/{id}/confirmar`) — descartada por agregar una vuelta de red extra al camino más caliente del sistema (RNF-CVI-001, <300ms) sin necesidad: el POS ya conoce localmente cuándo abrió el ticket, así que basta con que lo envíe como un campo más al confirmar.

## Decisión 6 (enmienda v1.2, 2026-09-04): `numero_documento` y `stock_minimo` tras comparar contra un POS real de producción

**Contexto**: se hizo ingeniería inversa de nuestras 11 specs contra el esquema de un POS open-source real (opensourcepos, en producción activa hace más de 15 años en tiendas pequeñas). Dos campos reales de ese sistema no tenían equivalente aquí: un número de documento propio por venta (`invoice_number`) y un umbral de reorden por producto (`reorder_level`).

**Decisión — `numero_documento`**: se agrega como columna `GENERATED ALWAYS AS ('V-' || lpad(id::text, 8, '0')) STORED` en `venta`. Es un número de nota de venta interna, no un comprobante certificado ante el SRI (implementar facturación electrónica certificada sería un aumento de alcance desproporcionado, no pedido por ningún OT ni por el enunciado) — pero sí es un documento de negocio real y auditable, distinto del `id` técnico, que es exactamente lo que el criterio de evaluación exige ("documentos de negocio reales, no columnas sueltas").

**Decisión — `stock_minimo`**: se agrega como columna `stock_sucursal.stock_minimo`, con su propio RF de definición (RF-CVI-021) y de consulta de productos por debajo del umbral (RF-CVI-022). A diferencia de `dias_sin_venta`/`marcado_sin_rotacion` (que detectan exceso de stock, OT1.5), este campo resuelve el problema opuesto: evitar quiebres de stock por no reponer a tiempo — un dato que faltaba pese a que casi todo el resto del módulo ya gira en torno a la disponibilidad de stock (OT2.4).

**Justificación de por qué viven en este módulo**: ambos son campos de las tablas `venta` y `stock_sucursal` que este módulo ya posee — no ameritan tabla nueva ni módulo nuevo, siguiendo el mismo criterio de las enmiendas anteriores (agregar el campo donde ya vive el dato relacionado, no crear estructura nueva para una necesidad pequeña).

**Alternativas descartadas**: un correlativo de venta independiente por sucursal (tabla de contadores, o secuencia dedicada por sucursal, al estilo de la numeración de punto de emisión del SRI) — descartada por ser complejidad desproporcionada para un número que solo necesita ser único y legible, no cumplir un estándar de facturación electrónica que no fue pedido; una tabla `alerta_stock_bajo` separada para materializar el resultado de la consulta de RF-CVI-022 — descartada porque el resultado se deriva en tiempo real de `stock_sucursal` con un simple `WHERE cantidad_disponible < stock_minimo`, no hay nada que persistir.

## Decisión 7 (enmienda v1.3, 2026-09-04): los catálogos usan clave natural, no `SERIAL`

**Problema detectado**: al construir la tabla de informes tácticos (`informes-simples-vs-compuestos.md`) se encontró que `producto.categoria`, `producto.unidad_venta` y `producto.unidad_inventario` eran TEXT libre. Cualquier variación de escritura ("Bebidas" / "bebidas" / "BEBIDAS") produce filas separadas en todo informe agregado por categoría, lo que invalida los indicadores de OT1.1, OT2.1 y OT3.2. Además, los tres vocabularios cerrados de `venta` (`metodo_pago`, `estado_pago`, `estado_venta`) vivían solo dentro de un CHECK: correctos para la capa operativa, pero inconsultables y sin poder cargar atributos.

**Decisión**: se crean cinco catálogos. Los cuatro de vocabulario cerrado usan **clave natural** — la PK es el código de negocio (`VARCHAR`), no un entero autoincremental. `categoria` es la excepción y sí lleva `id BIGSERIAL`.

**Justificación de la clave natural:**

1. **El dato sigue siendo legible sin JOIN.** `SELECT estado_venta FROM venta` devuelve `'anulada'`, no `7`. Con `SERIAL`, defender el modelo frente a una consulta en vivo exigiría un JOIN para leer cualquier fila.
2. **Los servicios no cambian.** La lógica que compara `if venta.estado_venta == 'anulada'` sigue igual; con `SERIAL` habría que resolver ids en cada servicio.
3. **La migración no reescribe datos.** Solo crea la tabla, la puebla con el seed y sustituye el CHECK por una FK sobre el valor ya guardado.
4. **Los estados derivados no se vuelven editables.** La FK agrega integridad referencial; no convierte el campo en algo que la aplicación pueda escribir libremente.

**Por qué `categoria` sí lleva `SERIAL`**: necesita autorreferencia jerárquica (`categoria_padre_id`) y su nombre lo edita el negocio. Con clave natural, renombrar "Snacks" a "Piqueos" obligaría a actualizar en cascada todas las filas de `producto` que la referencian.

**Alternativas descartadas**: dejar los CHECK como estaban y crear las dimensiones solo en ClickHouse — descartada porque el ETL estaría *inventando* un vocabulario que la BDR no tiene, y el atributo (`es_electronico`, `cuenta_para_ingresos`) quedaría definido en el pipeline en lugar de en el modelo de negocio; una única tabla genérica `catalogo(tipo, codigo, etiqueta)` para los cinco — descartada porque impide las FK reales (no se puede referenciar una fila filtrada por `tipo`) y obliga a que cada atributo propio viva en una columna JSON sin restricciones, que es exactamente el problema del texto libre trasladado un nivel más abajo.

**Cómo se relaciona con la unidad fraccionable**: `unidad_medida.permite_decimales` habilita RN-CVI-006. Es la contraparte de RN-CVI-001 — aquella exige `factor_conversion` para un producto fraccionable, esta exige que la unidad admita el decimal que ese factor produce. Sin las dos, se puede crear un producto "fraccionable en unidades", que no significa nada.

## Decisión 8 (enmienda v1.4, 2026-09-05, auditoría de riesgos derivados): layout/anaquel, hueco que llevaba desde el inicio del proyecto sin ninguna tabla

**Contexto**: "layout/anaquel limitado" es uno de los huecos adicionales que confirmaste incorporar al arrancar el proyecto (junto con costo de reposición variable, fraccionamiento, sustitución de marca, estacionalidad, causas de merma). A diferencia de los otros cinco, nunca se le asignó ni tabla ni módulo — quedó documentado como pendiente de decisión en las dos auditorías previas (2026-09-04 y 2026-09-05) hasta que se decidió resolverlo en vez de dejarlo fuera de alcance.

**Decisión**: dos tablas nuevas en este módulo (el layout es un problema de inventario/exhibición dentro de una sucursal, mismo departamento que `stock_sucursal`). `anaquel` (espacio físico por sucursal, `capacidad_maxima` opcional) y `producto_ubicacion` (asignación vigente, un producto por sucursal a la vez — sin historial, es una decisión operativa que cambia con la reposición, no un hecho de negocio a conservar como `historial_precio_producto`). RN-CVI-010 impide asignar por encima de la capacidad declarada.

**Por qué `capacidad_maxima` es opcional y no obligatoria**: un anaquel recién registrado puede no tener todavía un límite conocido — obligarla forzaría a inventar un número. `NULL` significa "sin límite declarado", nunca se interpreta como "capacidad cero" ni "capacidad infinita silenciosa" (mismo criterio que un datáfono sin revisión en `007-pagos-seguridad`, RN-PS-001: la ausencia de dato nunca se disfraza de un valor).

**Por qué no historial (SCD) para `producto_ubicacion`**: a diferencia de un precio o una clasificación comercial, dónde está un producto hoy en el anaquel no es un dato que otro módulo necesite auditar retroactivamente — es una decisión de reposición que puede cambiar varias veces por semana. Modelarlo como historial append-only agregaría costo sin ningún consumidor que lo necesite.

**Recurso RBAC nuevo**: `anaquel`, con `encargado_sucursal` a cargo del día a día (es literalmente su responsabilidad operativa) y `cajero`/`encargado_compras` solo con lectura, para ubicar o reponer sin poder reorganizar el layout.

## Decisión 9 (enmienda v1.5, 2026-09-05, auditoría de riesgos derivados): `venta.datafono_id`, el último de los cinco riesgos de segundo orden

**Contexto**: la misma auditoría que encontró el hueco de layout/anaquel (Decisión 8) encontró un quinto riesgo, esta vez de integración entre módulos: `datafono`/`revision_datafono` (`007-pagos-seguridad`) y `venta` (este módulo) vivían completamente desconectados. Una venta con tarjeta no dejaba ningún rastro de qué terminal físico la cobró — ante una disputa con el proveedor de la pasarela de pago, o una investigación de `alerta_fraude_pago` (006), no había forma de cruzar esa venta específica contra el estado de seguridad del datáfono que la procesó en ese momento.

**Decisión**: `venta.datafono_id`, FK externa nullable hacia `datafono` (007). A diferencia de `turno_caja_id`/`cliente_id` (Decisión 2 del módulo, cerradas con `ALTER TABLE` porque 006/002 no existían todavía cuando se creó `venta`), esta FK se crea **directa**, sin diferir: 007 ya está construido.

**Por qué la regla se divide entre CHECK y validación de servicio (RN-CVI-011)**: la mitad "un pago en efectivo nunca lleva datáfono" es una propiedad de una sola fila de `venta` — CHECK de base de datos, sin excepciones. La otra mitad — "obligatorio para tarjeta/electrónico cuando la sucursal tiene un datáfono activo" — depende de si existe una fila en `datafono` para esa sucursal, algo que un CHECK de una sola tabla no puede expresar. Se valida en el router, exactamente el mismo criterio ya documentado para RN-CF-001 en `002-clientes-fidelizacion`.

**Por qué no se exige siempre, ni con cero excepciones**: una sucursal que todavía no cargó ningún datáfono en el sistema no debería quedar bloqueada para vender con tarjeta — el dato de trazabilidad no existe todavía, y obligarlo inventaría un valor falso o detendría la operación por un problema puramente administrativo (falta de alta de un dato maestro), no por seguridad real. Una vez que la sucursal SÍ tiene al menos un datáfono activo, omitirlo deja de ser un descuido tolerable.

**Por qué el reporte de trazabilidad usa el estado vigente EN LA FECHA DE LA VENTA, no el estado actual**: `GET /pagos/datafonos/{id}/ventas` (007) responde "¿estaba este terminal al día en seguridad cuando cobró esta venta específica?" — la pregunta que realmente importa ante una disputa. Evaluar una venta de hace tres meses contra el estado de hoy del datáfono daría una respuesta que no corresponde al momento del hecho; mismo criterio que el join lateral de `segmento_cliente` contra `evaluacion_churn` en `etl/ml/churn.py` (004).

**Por qué el endpoint de trazabilidad vive en 007 y no en 001**: el dueño de la pregunta "¿este datáfono estuvo conforme?" es `007-pagos-seguridad` — es una extensión natural de `GET /datafonos/{id}/estado` y `GET /sucursales/{id}/datafonos/conformidad`, que ya viven ahí. `001` solo expone el dato crudo (`venta.datafono_id`); cruzarlo contra el historial de revisiones es responsabilidad de quien es dueño de ese historial. Es una lectura cruzada de `venta` desde 007 (no una escritura) — no contradice ningún RNF de ninguno de los dos módulos, ambos solo prohíben escribir en tablas ajenas.

**Alternativas consideradas**: exigir `datafono_id` siempre para tarjeta/electrónico, sin la excepción de "sucursal sin datáfonos registrados" — descartada porque bloquearía sucursales nuevas o que operan con un datáfono prestado/temporal que el negocio decide no dar de alta como activo permanente. Poner el reporte de trazabilidad en 001 en vez de 007 — descartada por el mismo criterio de "dueño de la pregunta" de arriba.

## Resumen de decisiones para `data-model.md`

1. `producto`, `stock_sucursal`, `lote_producto`, `ajuste_inventario`, `producto_sustituto`, `venta`, `detalle_venta` viven todos en este módulo.
2. `venta.turno_caja_id` es FK externa hacia `006-caja-mermas-fraude`.
3. No existe tabla de demanda insatisfecha en este módulo — ver `004-pronostico-demanda`.
4. `venta.hora_inicio_cobro` y `producto_sustituto` se agregaron en la enmienda v1.1 (Decisión 5).
5. *(Enmienda v1.2)* `venta.numero_documento` (columna `GENERATED`) y `stock_sucursal.stock_minimo` se agregaron tras comparar contra un POS real (Decisión 6).
6. *(Enmienda v1.3)* Cinco catálogos maestros con clave natural (`categoria` con `SERIAL` por su jerarquía): `producto.categoria` → `categoria_id`, las dos unidades → FK a `unidad_medida`, y los tres CHECK de `venta` → FK a sus catálogos (Decisión 7). Cada catálogo se puebla con seed dentro de su propia migración.
7. *(Enmienda v1.4)* `anaquel`/`producto_ubicacion` — layout/anaquel, con `capacidad_maxima` opcional y RN-CVI-010 (Decisión 8).
8. *(Enmienda v1.5)* `venta.datafono_id` — FK externa nullable hacia `datafono` (007-pagos-seguridad, NO diferida), con RN-CVI-011 dividida entre CHECK (efectivo nunca lleva datáfono) y validación de servicio (obligatorio para tarjeta/electrónico si la sucursal tiene datáfonos activos) — Decisión 9.
