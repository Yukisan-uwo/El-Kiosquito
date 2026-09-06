# El Kiosquito — Backend

Implementación de la capa operativa (Art. 5 de la constitución v1.4.0).
**Los 11 módulos de `specs/` están construidos**: modelos SQLAlchemy 2.0 +
11 migraciones Alembic encadenadas (autogeneradas + seed a mano), toda la
cadena validada con `upgrade head → downgrade base → upgrade head` contra
PostgreSQL 16 real.

- **010-administracion** — usuario/auth, RBAC, auditoría, parámetros,
  solicitudes ARCO.
- **009-expansion-sucursales** — sucursal, checklist de apertura, herencia
  de catálogo.
- **001-core-ventas-inventario** — producto, stock/lotes/ajustes,
  venta/detalle_venta.
- **002-clientes-fidelizacion** — cliente, segmentación K-Means (SCD2 sin
  tabla aparte), churn, campañas.
- **003-precios-margenes** — historial de precio, clasificación comercial
  (SCD2 con tabla aparte), precio de competencia, recomendaciones.
- **004-pronostico-demanda** — demanda insatisfecha, pronóstico, eventos
  locales.
- **005-promociones-inteligentes** — cupón.
- **006-caja-mermas-fraude** — turno de caja, alertas de fraude en pago
  (escritura cruzada con 001), mermas, incidencias de cuadre.
- **007-pagos-seguridad** — datáfonos y su historial de revisiones.
- **008-compras-proveedores** — proveedor, orden de compra (estado
  derivado), recepciones, historial de costo.
- **011-analitica-reportes** — ejecuciones ETL, versiones de los 5
  modelos ML del Art. 5.6, asistente conversacional (exclusivo dueño),
  con su endpoint interactivo real sobre OpenRouter (enmienda v1.4.0).

## Arrancar en local

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Postgres 16 corriendo localmente, con el rol/DB ya creados:
#   createuser elkiosquito --pwprompt
#   createdb elkiosquito -O elkiosquito
export DATABASE_URL="postgresql+psycopg://elkiosquito:elkiosquito_dev@localhost:5432/elkiosquito"

alembic upgrade head
```

Verificado: `alembic upgrade head` → `alembic downgrade base` → `alembic
upgrade head` corre limpio de punta a punta (**79 tablas**, **32
catálogos maestros sembrados** — los mismos 32 de la enmienda de
catálogos —, matriz `permiso_rol` con **300 filas**). Probado con inserts
reales (rollback) por módulo, incluyendo los cuatro índices únicos
parciales del patrón "un activo/vigente por clave": `segmento_cliente`
(002), `producto_clasificacion_historial` (003), `turno_caja` (006) y
`version_modelo_ml` (011) — los cuatro rechazan correctamente una
segunda fila activa para la misma clave. **Ninguna FK queda diferida**:
las tres que se abrieron a propósito (`solicitud_arco.cliente_id`,
`venta.cliente_id`, `venta.turno_caja_id`, `campana_recuperacion.
cupon_id`, `segmento_cliente.version_modelo_id`) se cerraron todas con
`ALTER TABLE ... ADD CONSTRAINT` en la migración del módulo dueño de la
tabla referenciada, en el orden en que cada uno se construyó.

## Qué hay

- `app/database.py` — engine + `Base` compartido. **Todos** los módulos
  declaran sus modelos contra este mismo `Base`: es lo que le permite a
  Alembic (`--autogenerate`) calcular el orden de `CREATE TABLE` por FK
  automáticamente, sin ordenar migraciones a mano módulo por módulo.
- `app/models/{administracion,expansion,core_ventas,clientes,precios,
  pronostico,promociones,caja,pagos,compras,analitica}.py` — un archivo
  por módulo de `specs/`, cada uno con sus catálogos maestros y tablas
  operativas documentadas en el docstring del archivo y de cada clase.
- `alembic/versions/` — 11 migraciones encadenadas, cada una con su
  `_seed()` de catálogos + las filas de `permiso_rol` que ese módulo
  agrega a la matriz RBAC. Los `downgrade()` limpian a mano las filas de
  `permiso_rol`/`recurso_sistema` que su propia migración no creó como
  tabla (viven en las de 010).

## API (FastAPI) — arrancada por 010-administracion

```bash
export DATABASE_URL="postgresql+psycopg://elkiosquito:elkiosquito_dev@localhost:5432/elkiosquito"
uvicorn app.main:app --reload
```

- `app/core/{config,security,deps}.py` — settings, hash/JWT (bcrypt +
  PyJWT, sin passlib), y las 3 dependencias que reutiliza todo router:
  `get_current_user`, `require_permission(recurso, operacion)` (consulta
  `permiso_rol` en BD, nunca compara contra un código de rol literal) y
  `require_dueno` (para los dos endpoints sin `recurso_sistema` propio:
  `/admin/permisos` y `/admin/auditoria` — por `nivel_jerarquico == 1`,
  no por el código `'dueno'`).
- `app/routers/administracion.py` — los 20 endpoints del contrato de
  010: auth, usuarios, matriz de permisos, auditoría (con export CSV),
  parámetros globales versionados, ARCO y los 5 catálogos de solo
  lectura. Probado end-to-end contra Postgres real (login, RBAC 401 vs.
  403, ciclo ARCO completo, rol-sucursales con validación RN-AD-002).
- `app/main.py` — un único `FastAPI()`; cada módulo nuevo agrega su
  router acá.

**001-core-ventas-inventario** — el camino más caliente del sistema (23
endpoints: ventas, productos, inventario, sustitutos, categorías).
Aritmética monetaria en `Decimal`, nunca `float` (los CHECK de
`venta`/`detalle_venta` comparan NUMERIC exacto en Postgres). Ojo con
`af785599e904`: corrige un bug real de precisión en
`ck_detalle_subtotal_coherente` — el CHECK original comparaba un
producto de escala 5 contra una columna de escala 2, así que rechazaba
cualquier venta fraccionable con cantidad no entera (el caso de uso
central de "vender por peso"). `app/services/scoping.py` — nuevo:
scoping por sucursal (Art. 3.3) compartido por cualquier módulo que
reciba un `sucursal_id`, resuelto siempre contra BD, no contra los
claims del JWT. Probado end-to-end: venta con producto fraccionable
(2.5 lb) y stock descontado correctamente, scoping 403 entre
sucursales, las dos validaciones de producto (RN-CVI-001/006), árbol de
categorías de dos niveles con su límite (RN-CVI-008), ingreso de stock
con/sin lote según `es_perecedero`, ajuste que respeta stock no
negativo, sustitutos simétricos, y el batch de rotación.

**002-clientes-fidelizacion** — cliente, segmentación SCD2 (K-Means) y
churn con sus campañas de recuperación (11 endpoints). El contrato
declara scopes ilustrativos (`fidelizacion`, `gerencia`, `sistema`) que
no son roles reales — se autorizó contra la matriz real de solo 2
recursos (`cliente`, `churn`): alta de cliente e historial de compras
bajo `cliente` (acceso amplio, incluye cajero); segmentación y churn
bajo `churn` (solo dueño/compras leen, solo dueño escribe — es dato
analítico calculado por modelo, no algo que un cajero deba tocar).
`registrarSegmento` cierra la fila vigente anterior y abre la nueva en
la misma transacción (SCD2, mismo patrón documentado en el modelo).
`registrarCampanaRecuperacion` aplica RN-CF-001 en servicio: rechaza con
409 si el cliente ya volvió a comprar solo desde su última evaluación.
Probado end-to-end: reclasificación de segmento con historial correcto,
RBAC 403 de cajero sobre datos analíticos, evaluación de churn,
RN-CF-001 disparando el 409 real con una venta posterior, y
`campanas-recuperacion/{id}/resultado` detectando la recuperación.

**Notificación real por correo (Art. 8.4).** `registrarCampanaRecuperacion`
sigue el mismo patrón que `registrarCupon` de 005 (ver esa sección):
después de insertar la fila, intenta un aviso real por correo al
cliente (`app/services/notificaciones.py`, compartido entre ambos
módulos) y persiste el resultado real en `notificacion_enviada`/
`notificacion_detalle` — es la tercera y última alerta del Art. 8.4
(cupón de cumpleaños y cupón por patrón de compra ya quedan cubiertas
por 005, esta es la alerta de campaña de recuperación en sí, exista o
no un cupón asociado). Probado por HTTP real contra el sandbox con el
mismo resultado honesto que en 005.

**003-precios-margenes** — historial de precio, margen real (cruce de
solo lectura con `historial_costo_producto` de 008), precio y
comparativa de competencia, clasificación comercial gancho/nicho con su
historial SCD2, y recomendaciones del motor de pricing dinámico (11
endpoints). La matriz real solo tiene 2 recursos (`precio`,
`recomendacion_precio`) — el contrato marca `crearRecomendacionPrecio`
como `security: [Sistema]`, igual criterio que los endpoints batch de
002. Nota de implementación: los modelos de este proyecto no declaran
`relationship()` de SQLAlchemy (solo columnas FK), así que
`comparativa-competencia` resuelve el nombre/canal de la fuente con un
`JOIN` explícito devuelto como tupla `(PrecioCompetencia,
FuenteCompetencia)`, no con navegación de atributo. `registrarPrecio`
vuelve `obsoleta` cualquier recomendación pendiente del mismo
producto/sucursal (un precio manual nuevo hace caduca cualquier
propuesta del motor para esa situación). `clasificarProducto` repite el
patrón SCD2 de 002 pero sobre tabla aparte (`producto_clasificacion_
historial`) porque `clasificacion_producto` solo guarda el estado
vigente — las dos se actualizan juntas (RN-PM-003), respaldado por el
índice único parcial `ux_clasif_hist_vigente` (RN-PM-004). El costo de
reposición es de cadena, no por sucursal (`historial_costo_producto`
de 008 no tiene `sucursal_id`). `consultarMargenReal` nunca inventa el
margen si falta precio o costo (RNF-PM-001) pero sí muestra el dato
crudo que exista — solo la cifra *calculada* se oculta cuando falta
alguno de los dos. `comparativa-competencia?agrupar_por_fuente=true`
responde con una lista (una fila por competidor) en vez del objeto
agregado único, mismo endpoint, forma de respuesta distinta según el
query param, tal como pide RF-PM-014. Probado end-to-end contra
Postgres real: margen con datos insuficientes y luego suficientes,
historial de precio "última fila gana" tras dos cambios manuales,
comparativa en sus tres formas (agregada, filtrada por canal,
agrupada por fuente), baja lógica de una fuente de competencia sin
borrarla, ciclo completo de clasificación (dos reclasificaciones +
`en_fecha` + el índice único parcial rechazando un `INSERT` directo de
una segunda fila vigente), y el ciclo completo de recomendación:
RN-PM-001 (409 en la segunda pendiente), rechazo (no toca el precio
vigente), aceptación (nueva fila en `historial_precio_producto` con
`fuente=motor_dinamico`, RN-PM-002), y un precio manual posterior
volviendo obsoleta una recomendación pendiente.

**004-pronostico-demanda** — demanda insatisfecha (quiebre de stock
capturado en el POS), ciclos de pronóstico append-only del modelo de
series de tiempo, y eventos locales como feature al entrenarlo (6
endpoints). La matriz real tiene 2 recursos: `demanda` (cubre a la vez
`demanda_insatisfecha` y `pronostico_demanda` — ninguna de las dos tiene
`actualizar` en ningún rol, son append-only) y `evento_local`. El
contrato marca `POST /pronostico/ciclos` como `security:[Sistema]`, y a
diferencia de 002/003 acá `crear` sobre `demanda` también lo tienen
cajero y encargado_sucursal (quienes registran quiebres de stock) — es
una consecuencia de que la matriz sembrada modela `demanda` como un
recurso único para dos tablas, no algo que este router deba restringir
por su cuenta. `evento_local.sucursal_id` es `NULL` para eventos de toda
la cadena (feriado nacional) — la consulta sin `sucursal_id` trae todo;
con `sucursal_id` trae los propios de esa sucursal más los de cadena.
**Bug de enrutado real encontrado y corregido**: `GET
/pronostico/eventos-locales` quedó registrada después de `GET
/pronostico/{producto_id}` — Starlette resuelve por orden de registro,
así que el parámetro de ruta capturaba "eventos-locales" como si fuera
un `producto_id` (422 de parseo de entero). Se corrigió reordenando las
rutas: todo segmento literal bajo `/pronostico/` va antes que
`/pronostico/{producto_id}` en el archivo. Probado end-to-end: RBAC
(dueño sin `crear` sobre demanda, cajero sin `crear` sobre evento_local),
scoping 403, validación de `sustituto_aceptado` obligatorio si viene
`sustituto_ofrecido_id`, pronóstico con datos insuficientes y luego
suficientes (RN-PD-001: siempre el más reciente), y las tres formas de
`eventos-locales` (sin filtro, con sucursal propia, con sucursal ajena
sin eventos propios) devolviendo la unión correcta con los de cadena.

**005-promociones-inteligentes** — cupón y su ciclo de vida cerrado
(activo → canjeado/expirado, 6 endpoints). Único módulo hasta ahora que
hace `UPDATE` de estado sobre un recurso propio en vez de append-only —
un cupón es de un solo uso. La matriz real tiene 1 recurso (`cupon`):
`crear` es dueño-exclusivo (equivalente a la cuenta "sistema" del
contrato — un batch de cumpleaños o el motor de patrón de compra),
`actualizar` (canjear) lo tienen dueño/cajero/encargado_sucursal (no
compras, coherente con que el canje ocurre en el punto de venta), `leer`
los cuatro. RN-PI-002 (un cupón `recuperacion_churn` siempre debe traer
`evaluacion_churn_id`) se valida en el router además del CHECK de BD —
a propósito, documentado así en el propio data-model.md: el catálogo lo
hace consultable para un formulario, el CHECK lo impone fila por fila
sin depender de que nadie lea el catálogo. RN-PI-004 (tope de
`descuento_valor` según `tipo_descuento.valor_maximo_permitido`, tope
inclusivo) evita el agujero real que la enmienda v1.1 vino a cerrar: un
cupón de 200% de descuento antes se creaba sin error. El canje
(`canjearCupon`) hace expiración perezosa: si un cupón sigue `activo` en
BD pero ya pasó su `fecha_expiracion`, el propio intento de canje lo
transiciona a `expirado` antes de rechazar la operación — no hay cron
de expiración en este módulo, así que el estado se corrige en el primer
request que lo toca. `codigo` (único, `RNF-PI-002`) se genera en el
servidor (`CUP-` + hex aleatorio); el negocio no lo controla como una
clave natural legible, a diferencia de `nombre` en `fuente_competencia`
(003). Probado end-to-end: RBAC (cajero sin `crear`, compras sin
`actualizar`), 404 de catálogo, RN-PI-004 con el tope exacto (100%
acepta, 200% rechaza), RN-PI-002 con y sin `evaluacion_churn_id`, canje
exitoso, doble canje rechazado, canje de un cupón vencido transicionado
a `expirado` en el mismo request, y scoping 403 al canjear contra una
venta de una sucursal fuera del alcance del cajero.

**Notificación real por correo (Art. 8.4).** `registrar_cupon` ya no
solo inserta la fila: después del `INSERT`, intenta un envío real por
Gmail SMTP (`app/services/notificaciones.py`) al `contacto` del cliente
si tiene forma de correo, y persiste el resultado REAL en
`notificacion_enviada`/`notificacion_detalle` — nunca asume "enviado"
por el solo hecho de haberse registrado (mismo principio de honestidad
que el asistente conversacional, Art. 5.9/5.10). Best-effort: una falla
de SMTP nunca deshace el cupón ya creado (Art. 8.6). Probado por HTTP
real contra el sandbox (sin egress a smtp.gmail.com, igual que
OpenRouter): con SMTP sin configurar, un cliente con correo válido en
`contacto` devuelve `notificacion_enviada=false,
notificacion_detalle="SMTP no configurado..."`; un cliente cuyo
`contacto` no tiene forma de correo (ej. un teléfono) devuelve un motivo
distinto, `"sin correo válido en contacto"`, sin siquiera intentar el
envío.

**006-caja-mermas-fraude** — turno de caja con cuadre, mermas (causa e
investigación opcionales), incidencias de cuadre del modelo de
anomalías, alertas de fraude en pago y puntos de control horario (12
endpoints). Matriz real con 4 recursos (`turno_caja`, `merma`,
`incidencia_cuadre`, `alerta_fraude`). Dos particularidades notables:
`turno_caja.crear`/`actualizar` los tiene **solo** `cajero` (ni siquiera
`encargado_sucursal`, que el contrato sí lista) — se respetó la matriz
real igual (RN-AD-004); y `incidencia_cuadre.crear`/`alerta_fraude.crear`
están en `false` para los 4 roles, a diferencia de los `security:
[Sistema]` de otros módulos donde algún rol humano terminaba cubriendo
la cuenta de servicio — acá NINGÚN rol humano puede crearlas por la API,
coherente con que son escrituras genuinamente automáticas (el modelo de
anomalías y el propio proceso de pago de 001, nunca una persona). El
cálculo de `monto_esperado` (`monto_inicial` + ventas en efectivo del
turno que cuentan para ingresos, vía `estado_venta.cuenta_para_ingresos`
para no sumar una venta anulada) se comparte entre `cerrarTurno` y
`generarCheckpoint` en un solo helper. `cerrarTurno` valida RN-CMF-002
(diferencia ≠ 0 exige `motivo_diferencia`) *antes* de tocar la fila,
anticipándose al CHECK de BD para devolver un 422 con mensaje claro.
Probado end-to-end: RBAC exacto de `turno_caja` (encargado_sucursal
rechazado pese al contrato), RN-CMF-001 (409 en el segundo turno
abierto del mismo cajero), cálculo de `monto_esperado` verificado con
una venta real en efectivo, checkpoint sobre turno abierto y su rechazo
409 sobre uno cerrado, cierre con y sin diferencia (RN-CMF-002),
RN-CMF-003 (rechaza resultado sin causa asignada), filtro
`atribuible_a_persona` cruzando con el catálogo, y confirmación
explícita de que ningún rol —ni `dueno`— puede crear una
`incidencia_cuadre` o `alerta_fraude` vía la API (se sembraron por SQL
directo, como haría el proceso interno real), seguida del ciclo
`atender` con su 422 de RN-CMF-004.

**007-pagos-seguridad** — catálogo de datáfonos por sucursal y su
historial append-only de revisiones de seguridad (7 endpoints). Matriz
real con 1 solo recurso (`datafono`), que cubre a la vez `datafono` y
`revision_datafono` — el contrato lista roles ilustrativos
(`prevencion_perdidas`, `gerencia`) que no existen; se autorizó igual
que 006 contra la matriz real: `dueno` y `encargado_sucursal` tienen
CRUD completo, `encargado_compras` solo lee, `cajero` no tiene acceso
en absoluto (es una responsabilidad de seguridad, no de operación
diaria en el POS). `POST /datafonos/{id}/revisiones` se autorizó contra
`datafono/crear` — mismo criterio que los checkpoints de turno en 006:
una sub-tabla append-only nueva hereda el verbo de su tabla dueña
cuando la matriz sembrada no le dio recurso propio. El estado vigente
de un datáfono (RF-PS-004) nunca se cachea: se calcula en el momento de
la consulta con `DISTINCT ON (datafono_id) ORDER BY fecha_revision
DESC` (específico de PostgreSQL, el motor real del proyecto) tanto para
un datáfono individual como para el listado completo de una sucursal.
El indicador de conformidad (RF-PS-008, KPI de OT4.4) lee
`estado_revision.cuenta_como_conforme` en vez de comparar contra el
literal `'actualizado'` (RN-PS-002) y nunca cuenta un datáfono sin
revisión como conforme (RN-PS-001) — se probó con una sucursal de 3
terminales (uno `actualizado`, uno `vencido`, uno sin revisar) dando
exactamente 1 conforme / 3 totales / 33.33%. `dar_de_baja_datafono`
solo apaga `activo`, nunca toca `revision_datafono`; el datáfono dado
de baja desaparece del listado de la sucursal pero su historial sigue
consultable directo por `/datafonos/{id}/estado`. Probado end-to-end:
RBAC exacto (cajero 403 en todo, compras 403 al escribir pero 200 al
leer), scoping 403 al crear/dar de baja un datáfono de una sucursal
ajena, RNF-PS-002 (422 en `codigo_serie` duplicado), 404 de estado
inexistente en el catálogo al registrar una revisión, "última revisión
gana" tras dos revisiones seguidas del mismo datáfono, 409 en doble
baja, y `porcentaje_conformes` en `0.0` sin división por cero para una
sucursal sin datáfonos.

**008-compras-proveedores** — proveedor, orden de compra con estado
derivado del log de recepciones, recepciones por evento e historial de
costo por producto/proveedor (10 endpoints). Matriz real con 2 recursos
(`proveedor`, `orden_compra` — este último cubre también detalle,
recepciones e historial de costo). `dueno`/`encargado_compras` tienen
CRUD completo sobre ambos; `encargado_sucursal` solo lee `proveedor`
pero SÍ puede `actualizar` `orden_compra` (registra recepciones en su
local, nunca crea ni cancela); `cajero` sin acceso. El estado de la
orden (`pendiente`/`recibida_parcial`/`recibida_completa`) se recalcula
en `registrarRecepcion` sumando TODOS los eventos de TODAS las líneas
(nunca un contador incrementado a mano, RF-CP-004/005) y lee
`estado_orden_compra.permite_recepcion` del catálogo antes de aceptar
una recepción nueva (RN-CP-002) en vez de comparar códigos a mano.
`consultarPronosticoParaCompra` integra en vivo la misma consulta que
`GET /pronostico/{producto_id}` de 004 — en proceso, un solo monolito
FastAPI, nunca por HTTP saliente (Decisión 4 de su research.md) — y
graba el snapshot de la recomendación directo en el detalle de la
orden. La comparativa de proveedores usa el mismo patrón `DISTINCT ON`
de 007 para traer el costo más reciente por proveedor (Decisión 2).

**Bug real encontrado y corregido al probar este módulo** (no en el
código, en el CHECK de la migración original): `ck_detalle_oc_motivo_
desvio_pronostico` exigía que si `cantidad_pedida > cantidad_
recomendada_pronostico`, `motivo_no_siguio_pronostico` YA estuviera
presente en esa misma fila. Pero el flujo real del contrato es (1)
`GET .../pronostico?detalle_id=` graba el snapshot de la recomendación
justo en el momento en que se descubre que la excede, y (2) recién ahí
el usuario puede llamar `PATCH .../motivo-oferta` para justificarlo. El
paso (1) por sí solo ya viola el CHECK — confirmado en vivo
(`IntegrityError` real de Postgres contra la BD de prueba, no un caso
hipotético). Se corrigió con la migración `81b45384f520`, que elimina
el CHECK y traslada RN-CP-001 enteramente al servicio, exigido en el
único punto donde de verdad hay que bloquear el flujo:
`registrarRecepcion`, nunca al guardar el snapshot del pronóstico.
Mismo patrón que otras reglas inter-tabla no expresables como CHECK de
una sola fila en este proyecto (ej. RN-CVI-006 en 001): se documentan
en el modelo, se validan en servicio — y mismo espíritu que
`af785599e904` (el fix del CHECK de `detalle_venta` en 001): un CHECK
de fila que no puede modelar una secuencia de dos pasos en el tiempo
real del negocio hay que sacarlo de la BD, no forzarlo.

Probado end-to-end: RBAC exacto (cajero 403 en todo, encargado_sucursal
403 al crear orden pero 200 al recibir), scoping 403 al crear orden o
recibir en una sucursal ajena, 404 de `forma_pago`/producto/proveedor
inexistentes, recepción parcial seguida de una que completa la orden
(recálculo correcto de `cantidad_recibida` y transición automática a
`recibida_completa`), 409 al intentar recibir sobre una orden ya
completa (RN-CP-002), sobre-entrega aceptada sin error
(`cantidad_recibida` > `cantidad_pedida`), historial de costo con una
fila por recepción y comparativa con solo la más reciente por
proveedor, el ciclo completo de RN-CP-001 reproduciendo el bug del
CHECK y confirmando el fix (consulta de pronóstico con recomendación
menor a lo pedido → 422 al intentar recibir sin motivo → `PATCH
motivo-oferta` → recepción aceptada), 422 al crear una orden con un
proveedor desactivado (pero sus órdenes ya existentes se siguen
recibiendo con normalidad, RF-CP-011), y 409 en doble desactivación de
proveedor.

**009-expansion-sucursales** — sucursal, checklist de apertura
configurable (ya no un `CHECK` de 8 ítems fijos, la enmienda v1.1 lo
convirtió en catálogo con `orden` y `es_bloqueante`), herencia de
catálogo/precios y activación (9 endpoints). Matriz real con 2 recursos:
`sucursal` (`crear` dueño-exclusivo, `actualizar` dueño +
encargado_sucursal, `leer` los cuatro roles incluido cajero) y
`checklist_apertura` (mismo patrón de crear/actualizar, pero `leer` NO
lo tiene cajero — el proceso de apertura no es parte de su operación
diaria). `GET .../estado-apertura` se autorizó contra
`checklist_apertura/leer` porque su contenido principal es justamente
el checklist. Dos decisiones de diseño propias, no explícitas en el
contrato (que solo describe el efecto de negocio):
- `heredarCatalogo` (Decisión 3 de research.md: "orquesta llamadas a
  `POST /precios` de 003, no crea filas de precio directamente") se
  implementó reproduciendo en proceso la misma escritura que haría
  `registrar_precio` de 003 — nunca literalmente invocando esa función
  de router, porque su propio `require_permission("precio", "crear")`
  no lo tiene `encargado_sucursal` (quien sí puede ejecutar la herencia
  por la matriz de 009). La autorización real de esta acción ya ocurrió
  en el `Depends` de este endpoint (`sucursal/actualizar`); reescribir
  la inserción acá es reutilización de lógica de servicio, no una
  puerta de RBAC nueva en 003. Por cada producto activo, busca el
  precio más reciente en CUALQUIER sucursal de la cadena; si no
  existe, el producto queda pendiente (RN-ES-003) — nunca un precio
  inventado.
- `heredarCatalogo` y `asignarPersonalSucursal` completan
  automáticamente los ítems del checklist que literalmente describen
  esa acción (`catalogo_heredado`/`precios_heredados` y
  `personal_asignado`) como efecto colateral de haber hecho el trabajo
  real — no tiene sentido exigir una segunda confirmación manual de
  algo que el sistema acaba de hacer. RN-ES-001 no cambia: activar
  sigue exigiendo todos los ítems completos.
- `asignarPersonalSucursal` (Decisión 2: "delega en `PATCH
  /admin/usuarios/{id}/rol-sucursales` de 010") agrega esta sucursal al
  conjunto YA asignado del usuario en vez de reemplazarlo — el
  contrato de este endpoint no recibe `rol` (a diferencia del de 010),
  así que preservar el rol y las sucursales existentes es la lectura
  consistente de "asignar personal" sin pisar una asignación previa en
  otra sucursal. Rechaza con 422 (RN-AD-001) si el rol del usuario
  tiene `alcance_cadena` (dueño/compras no se asignan por sucursal).
- `activarSucursal` responde su 422 con el cuerpo exacto del contrato
  (`{"items_pendientes": [...]}`, vía `JSONResponse` directo) en vez
  del `{"detail": "..."}` habitual de `HTTPException` — es el único
  endpoint de todo el backend hasta ahora cuyo contrato exige una forma
  de error estructurada distinta del patrón estándar.
- `cerrarSucursal` exige que la sucursal esté `operativa` (RF-ES-008
  dice explícitamente "una sucursal YA operativa") — cerrar una que
  sigue `en_apertura` no tiene sentido de negocio por esta vía.

Probado end-to-end: RBAC exacto (compras 403 al crear sucursal, cajero
403 en checklist/estado-apertura), scoping 403 al completar un ítem o
heredar catálogo en una sucursal donde el usuario aún no tiene alcance,
personal asignado que gana alcance real de inmediato (verificado
completando un ítem justo después de la asignación), 422 al asignar un
rol de alcance de cadena por sucursal (RN-AD-001), herencia con 1
producto heredado y 1 pendiente en la misma ejecución, 409 en el
segundo intento de herencia (RN-ES-002) sin duplicar filas de precio,
422 con `items_pendientes` exacto al activar con 3 ítems incompletos,
200 tras completarlos, 409 en doble activación, 409 al cerrar una
sucursal aún `en_apertura`, 200 al cerrar una operativa, y 409 en doble
cierre. Todos los datos de prueba se insertaron y borraron por SQL
directo — no quedó nada sembrado de más.

**011-analitica-reportes** — ejecuciones del pipeline ETL de Airflow
(con su validación de calidad), versiones de los 5 modelos de ML del
Art. 5.6, y el log append-only de preguntas al asistente conversacional
del dueño (10 endpoints). Cierra el ciclo de implementación de los 11
módulos. Matriz real con 3 recursos: `modelo_ml` y `pipeline_etl`
(dueño `crear`+`leer`, encargado_compras/encargado_sucursal solo
`leer`, cajero sin acceso — es analítica de dirección, no operación de
POS) y `asistente` (dueño-exclusivo en los tres verbos, RNF-AR-003
resuelto desde la matriz real de `permiso_rol`, nunca comparando
`usuario.rol == 'dueno'` a mano — RN-AD-004). Es el primer módulo del
backend sin ninguna columna `sucursal_id` que scopear: ningún endpoint
llama `verificar_alcance_sucursal`, porque es analítica agregada de
cadena, no operación de un local.
- `registrarEjecucionPipeline` resuelve un upsert por `dag_run_id`
  (UNIQUE en la tabla): el DAG de Airflow llama este mismo endpoint dos
  veces por corrida real (al iniciar con `estado=en_progreso` y al
  finalizar con `exitoso`/`error`) — la primera llamada hace `INSERT`
  con `fecha_fin=NULL`, la segunda encuentra la fila existente y la
  actualiza (`fecha_fin=now()` solo si `estado_ejecucion.
  es_estado_final`), nunca crea una segunda fila para la misma corrida.
  No es una excepción al patrón append-only del resto del proyecto: es
  un único evento de negocio con dos fases y un ciclo de vida corto,
  mismo criterio que `orden_compra.estado` derivándose de eventos de
  `recepcion_orden_compra` en 008.
- `registrarVersionModelo` aplica, en este orden, RN-AR-004 (422 si
  `nombre_metrica` no es exactamente `modelo_ml.metrica_principal` del
  modelo indicado — nada más impediría registrar el modelo de churn con
  una métrica de silueta que es de clustering) y RN-AR-002 (si
  `tamano_muestra` no alcanza `modelo_ml.tamano_muestra_minimo`, la
  versión se guarda igual pero con `estado=descartado_datos_
  insuficientes`, `valor_metrica` forzado a `NULL` — nunca se informa
  una métrica de un modelo que no se entrenó de verdad — y un `motivo`
  generado en el propio servicio, porque el contrato no lo recibe como
  campo de entrada y el Art. 5.9 exige documentar por qué se descartó).
  Si la versión sí queda `activo`, la anterior versión activa del mismo
  modelo (si existe) pasa a `reemplazado` en la misma transacción antes
  del `INSERT` — RN-AR-001, reforzado por el índice único parcial
  `ux_version_modelo_activa`.
- `consultarMetricasModeloActivo` nunca devuelve una versión
  `reemplazado` o `descartado_datos_insuficientes`: filtra
  estrictamente por `estado='activo'` y responde 404 explícito
  ("descartado por datos insuficientes o nunca entrenado") en vez de
  inventar una respuesta con la versión más reciente que sea — una
  versión descartada es registro de honestidad (Art. 5.9), no algo que
  sirva predicciones.
- `consultarHistorialAsistente` no filtra por `usuario_id`: el contrato
  no lo pide como parámetro (solo `desde`/`hasta`) y, al ser
  `asistente` dueño-exclusivo en la matriz real, es el historial del
  asistente de la cadena — filtrar por el dueño que consulta rompería
  el día que exista más de una cuenta con ese rol.

Probado end-to-end: RBAC exacto en los tres recursos (cajero 403 en
todo el módulo, encargado_compras/encargado_sucursal 403 al escribir
pero 200 al leer `modelo_ml`/`pipeline_etl`, 403 total en `asistente`
para ambos), el upsert de `registrarEjecucionPipeline` confirmado con
la misma corrida (`INSERT` con `en_progreso`/`fecha_fin=NULL` seguido
de `UPDATE` a `exitoso`/`fecha_fin` poblada, una sola fila en la tabla
al final), 404 de `estado`/`modelo` inexistentes en sus catálogos
respectivos, 404 de `ejecucion_id` inexistente al registrar una
validación de calidad, el ciclo completo de RN-AR-002/RN-AR-004/RN-AR-
001 sobre el modelo `churn` (422 por métrica incorrecta, versión
descartada con motivo autogenerado y sin métrica, 404 de `/metricas`
antes de tener una versión activa, versión activa creada, segunda
versión activa reemplazando a la primera con la anterior verificada en
`reemplazado` por SQL directo, `/metricas` devolviendo siempre la más
reciente), y el asistente conversacional con 403 para
encargado_compras/cajero tanto al crear como al leer, 201/200 para
dueño, 422 de Pydantic en `consulta_generada` vacía (antes de llegar al
CHECK de BD), y el filtro `desde` en el futuro devolviendo lista vacía.
Todos los datos de prueba se insertaron y borraron por SQL directo — no
quedó nada sembrado de más.

### Asistente conversacional interactivo — `POST /analitica/asistente/preguntar` (Art. 5.10, enmienda v1.4.0)

El registro de auditoría (`/analitica/asistente/preguntas`, arriba) ya
existía como el camino "externo": recibe `pregunta_texto`/
`consulta_generada`/`respuesta_texto` ya computados por quien llama.
`/preguntar` es el camino real que va a consumir el frontend: recibe
solo `pregunta_texto` y el backend hace todo el trabajo, persistiendo
el resultado con el mismo helper compartido `_persistir_pregunta` (cero
duplicación de la regla RN-AR-003 entre los dos caminos).

- **Por qué cambió el proveedor de LLM.** El Art. 5.10 original fijaba
  la API de Anthropic (Claude) como único proveedor externo admitido.
  El equipo no tiene presupuesto para esa API de pago — la constitución
  se enmendó a **v1.4.0** (ver `.specify/memory/constitution.md`, Art.
  9.2) para admitir **OpenRouter** en su lugar: acceso gratuito real
  (no trial) a modelos con soporte de tool/function calling, sigue
  siendo la única dependencia de red externa del sistema en producción,
  y el modelo gratuito concreto (`OPENROUTER_MODEL`,
  `nvidia/nemotron-3.5-lightning:free` por defecto) es config, no dato
  constitucional — puede cambiar sin nueva enmienda si deja de estar
  disponible.
- **Por qué el LLM nunca genera SQL libre.** `app/services/
  asistente_tools.py` expone un catálogo **cerrado de 8 tools**
  (JSON Schema formato OpenAI/OpenRouter: merma por sucursal, merma por
  causa, margen por sucursal, margen por categoría, productos de baja
  rotación, demanda insatisfecha top productos, diferencias de cuadre
  de caja, métricas de un modelo ML) contra el esquema **real**
  desplegado (`etl/ddl/00{1,2}_*.sql`, no el documento de diseño — hay
  drift documentado entre ambos). El LLM solo elige QUÉ tool y CON QUÉ
  argumentos; el SQL ya está escrito, revisado y parametrizado (bind
  params, nunca interpolación de strings). Esto es lo que hace que
  `consulta_generada` (nombre de tool + argumentos, ver
  `_consulta_generada` en `app/services/asistente.py`) sea auditable Y
  seguro a la vez.
- **`app/core/clickhouse.py`** — primer cliente de ClickHouse del
  backend (hasta ahora solo el ETL le hablaba). `ClienteClickHouseSoloLectura`
  expone únicamente `query()` — sin `insert`/`command` — reforzando en
  código que el backend nunca escribe en la capa táctica.
  `clickhouse-driver==0.2.11` y `httpx==0.28.1` (primera dependencia
  HTTP saliente del backend) se agregaron a `requirements.txt`.
- **`app/services/asistente.py`** — el loop de orquestación
  (`preguntar(pregunta_texto, db)`): arma el mensaje de sistema, llama
  a OpenRouter con `tools=TOOLS_SCHEMA, tool_choice="auto"`, ejecuta
  cada tool call real contra Postgres/ClickHouse, reinyecta el
  resultado como mensaje `role=tool`, y repite hasta que el modelo
  responda sin más tool calls (máximo 4 iteraciones). Si el modelo
  nunca invoca ninguna tool, responde honestamente que no tiene una
  consulta de datos disponible — nunca inventa un número — y aun así
  deja un `consulta_generada` no vacío (`_SIN_CONSULTA`, RN-AR-003
  también en el camino honesto). Un nombre de tool alucinado por el
  modelo se audita igual pero nunca se ejecuta (`EJECUTORES.get(nombre)`
  falla de forma controlada, sin crashear el request).
- **Probado en el sandbox de desarrollo** (sin egress a openrouter.ai
  confirmado con `curl` directo — ver `backend/tests/
  test_asistente_manual.py`): los 8 tool executors contra datos reales
  de Postgres+ClickHouse (incluye un bug real de sintaxis de ClickHouse
  encontrado y corregido: `FROM tabla AS alias FINAL`, no
  `FROM tabla FINAL AS alias`), el loop completo de orquestación con
  una respuesta de LLM simulada realista, el camino honesto sin tools,
  y la defensa contra tool inventada. **A nivel HTTP real**, con
  `OPENROUTER_API_KEY` sin configurar (como queda este sandbox a
  propósito): `POST /api/v1/analitica/asistente/preguntar` devuelve
  `502` con el mensaje real de `ErrorAsistente` ("OPENROUTER_API_KEY no
  está configurada...") — nunca un 500 genérico. La prueba end-to-end
  contra el proveedor real de OpenRouter queda pendiente para la
  máquina del usuario (Docker, con la API key real en `.env`).


## Siguiente

Los 11 módulos de `specs/` tienen ahora su capa de datos Y su API
FastAPI completas, probadas end-to-end contra Postgres real. Sigue: el DAG de Airflow (ETL PostgreSQL → ClickHouse), los 5 modelos
scikit-learn del Art. 5.6, el asistente conversacional interactivo
(Art. 5.10, enmienda v1.4.0), y el canal real de notificaciones por
correo (Art. 8.4) — los cuatro completos y probados en el sandbox.
Sigue: implementación de las interfaces (React + Tailwind + Framer
Motion), usando el sistema de diseño y los mockups ya entregados en
`Proyecto El Kiosquito/frontend/`, y el servicio `nginx` en
`docker-compose.yml` (se suma naturalmente con el build de Vite). Dos
pruebas end-to-end quedan pendientes para la máquina del usuario
(Docker, sin egress desde este sandbox): el asistente contra
OpenRouter real (`OPENROUTER_API_KEY` en `.env`) y el envío de correo
contra Gmail real (`SMTP_USUARIO`/`SMTP_CONTRASENA_APP` en `.env`).
