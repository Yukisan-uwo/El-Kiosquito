# El Kiosquito — Clasificación de Informes Tácticos: Simples (BDR) vs. Compuestos (BD Columnar)

**Fase**: Táctica | **Fecha**: 2026-09-04
**Entrada**: los 23 Objetivos Tácticos de `ElKiosquito_Documento_Empresa_y_Objetivos.md`
**Salida**: qué informes salen de PostgreSQL (BDR) y cuáles de ClickHouse vía pipeline ETL orquestado por Airflow, y qué tablas maestras/dimensión hacen falta para poder servirlos

---

## 1. Criterio de clasificación aplicado

Para que la tabla discrimine de verdad y no salga "Sí/Sí" en las 23 filas, se fijó un criterio explícito antes de clasificar:

**Es informe SIMPLE** cuando se resuelve con una consulta directa sobre la BDR: un listado o consulta puntual, filtrado y ordenado, sobre una tabla o un join corto, sin pre-transformación. Incluye conteos triviales sobre volúmenes bajos (proveedores, sucursales, datáfonos). Es operativo por origen, pero lo consume el nivel táctico.

**Es informe COMPUESTO** cuando cumple al menos una de estas tres condiciones:

- **(a) Dimensión temporal**: exige agregar por día/semana/mes o comparar periodo contra periodo.
- **(b) Cruce de hechos distintos**: mezcla dos fuentes que en la BDR viven separadas y no comparten grano (ventas × mermas, ventas × costos de compra, cupones × ventas posteriores).
- **(c) Volumen**: el hecho crece sin techo (líneas de venta, log de auditoría append-only) y agregarlo en caliente sobre PostgreSQL degradaría la operación del POS.

**Resultado del conteo**: 23 OT generan informe simple; 17 generan además informe compuesto; **6 son simples puros** (OT3.3, OT3.5, OT3.6, OT3.8, OT4.2, OT4.4).

**Observación metodológica**: ningún OT resultó "compuesto puro". Todos tienen debajo un listado operativo de respaldo en la BDR — que es justamente lo que el ingeniero llama "operativo pero que lo necesita ver el táctico". Lo que cambia entre un OT y otro no es si tiene informe simple, sino si **además** necesita agregación. Confundir esto es lo que obligó a rehacer la clasificación en NexoStay (Tarea 11).

---

## 2. Tabla — Departamento | Objetivo Táctico | ¿Es informe simple? | ¿Es informe compuesto?

| Departamento | Objetivo Táctico | ¿Es informe simple? | ¿Es informe compuesto? |
|---|---|:---:|:---:|
| Precios y Márgenes | **OT1.1** — Aumentar el margen real vía precios dinámicos por costo y demanda | **Sí** | **Sí** |
| Prevención de Pérdidas | **OT1.2** — Reducir pérdidas por mermas (robo, error, caducidad, fraude) | **Sí** | **Sí** |
| Compras y Proveedores | **OT1.3** — Reducir el costo de reposición promedio | **Sí** | **Sí** |
| Fidelización y Clientes | **OT1.4** — Aumentar ticket promedio y frecuencia vía fidelización | **Sí** | **Sí** |
| Inventario y Caducidad / Compras | **OT1.5** — Reducir capital inmovilizado en stock muerto | **Sí** | **Sí** |
| Precios y Márgenes | **OT2.1** — Precios competitivos frente a competencia física y digital | **Sí** | **Sí** |
| Ventas y Caja | **OT2.2** — Reducir tiempo de cobro y facilitar pago electrónico | **Sí** | **Sí** |
| Fidelización y Clientes | **OT2.3** — Personalizar promociones según valor real del cliente | **Sí** | **Sí** |
| Inventario y Caducidad | **OT2.4** — Garantizar disponibilidad (evitar quiebres de stock) | **Sí** | **Sí** |
| Fidelización y Clientes | **OT2.5** — Recuperar clientes en riesgo real de abandono | **Sí** | **Sí** |
| Ventas y Caja / Prevención de Pérdidas | **OT3.1** — Estandarizar el cuadre de caja horario | **Sí** | **Sí** |
| Inventario y Caducidad | **OT3.2** — Automatizar alertas de caducidad | **Sí** | **Sí** |
| Compras y Proveedores | **OT3.3** — Mantener actualizado el costo de reposición en cada compra | **Sí** | **No** |
| Prevención de Pérdidas | **OT3.4** — Diferenciar y registrar la causa de cada merma | **Sí** | **Sí** |
| Expansión y Sucursales | **OT3.5** — Estandarizar la apertura de nueva sucursal | **Sí** | **No** |
| Analítica y Reportes | **OT3.6** — Consolidar el pipeline ETL entre sucursales | **Sí** | **No** |
| Ventas y Caja | **OT3.7** — Registrar la demanda insatisfecha | **Sí** | **Sí** |
| Ventas y Caja / Inventario | **OT3.8** — Registrar venta fraccionada con conversión de unidad | **Sí** | **No** |
| Analítica y Reportes | **OT4.1** — Desarrollar los 5 modelos de ML | **Sí** | **Sí** |
| Administración | **OT4.2** — RBAC jerárquico con alcance por sucursal | **Sí** | **No** |
| Administración | **OT4.3** — Auditoría inmutable de operaciones críticas | **Sí** | **Sí** |
| Prevención de Pérdidas / Ventas y Caja | **OT4.4** — Seguridad de pagos electrónicos y exposición legal | **Sí** | **No** |
| Analítica y Reportes | **OT4.5** — Consulta en lenguaje natural sobre datos consolidados | **Sí** | **Sí** |

---

## 3. Detalle por OT — qué informe es, y de dónde sale el dato

Esta sección responde por adelantado a "¿y dónde veo esto?". Cada informe se ancla a tablas que ya existen en los 11 módulos de `specs/`.

### OE1 — Perspectiva Financiera

**OT1.1 — Margen real / pricing dinámico**
- *Simple*: Recomendaciones de precio pendientes de aceptar o rechazar, por sucursal → `recomendacion_precio` (003), estado pendiente.
- *Compuesto* — condiciones (a) + (b) + (c): Margen bruto real promedio por categoría × sucursal × mes. Exige cruzar cada línea de `detalle_venta` (001) contra el `historial_costo_producto` (008) **vigente en la fecha de esa venta**, no el costo actual.

**OT1.2 — Mermas**
- *Simple*: Listado de mermas por sucursal/periodo/causa → `merma` (006). Es el OO-PP03 tal cual.
- *Compuesto* — (a) + (b): % de merma sobre ventas totales por sucursal × mes. Σvalor de `merma` sobre Σvalor de `detalle_venta`: dos hechos de grano distinto que en PostgreSQL no se pueden agregar juntos sin castigar al POS.

**OT1.3 — Costo de reposición**
- *Simple*: Historial de variación de costo por proveedor (OO-CP05) y comparativa de costo vigente entre proveedores (OO-CP06, `DISTINCT ON`) → `historial_costo_producto` (008).
- *Compuesto* — (a): Costo de reposición promedio por SKU periodo contra periodo, con variación %. Necesita serie temporal por SKU, no una consulta puntual.

**OT1.4 — Ticket promedio y frecuencia**
- *Simple*: Historial de compras de un cliente (OO-FC02) → `venta` + `detalle_venta` (001) filtrado por `cliente_id`.
- *Compuesto* — (a) + (b): Ticket promedio y frecuencia mensual, comparando clientes fidelizados contra no fidelizados por segmento K-Means. Cruza `venta` con `segmento_cliente` (002), que es una asignación que cambia en el tiempo.

**OT1.5 — Stock muerto y compra por oferta**
- *Simple*: Productos sin rotación candidatos a liquidación (OO-IN09, bandera `sin_rotacion` de 001) y compras por oferta con `motivo_no_siguio_pronostico` registrado (008).
- *Compuesto* — (a) + (b): Valor de capital inmovilizado por sucursal × mes y su evolución. Exige valorizar el stock (`stock_sucursal`) contra el costo vigente (`historial_costo_producto`) y agregar en el tiempo.

### OE2 — Perspectiva Cliente

**OT2.1 — Precios competitivos**
- *Simple*: Precio propio vs. precio de referencia de competencia, producto a producto (OO-PM04) → `precio_competencia` (003), ya con `tipo_canal` desde la enmienda v1.1.
- *Compuesto* — (a): % de productos en rango competitivo por categoría × canal × semana.

**OT2.2 — Tiempo de cobro y pago electrónico**
- *Simple*: Listado de ventas por cajero y turno con su método de pago → `venta` + `venta_pago` (001). Es literalmente el ejemplo del ingeniero ("listado de ventas por vendedor").
- *Compuesto* — (a) + (c): Tiempo promedio de cobro y % de adopción de pago electrónico por sucursal × hora × día. Se calcula con `venta.hora_inicio_cobro` menos `venta.fecha_hora` (campo añadido en la enmienda v1.1 de 001, precisamente para poder medir esto).

**OT2.3 — Promociones personalizadas**
- *Simple*: Cupones emitidos y su estado de canje por cliente → `cupon` (005).
- *Compuesto* — (a) + (b): % de cupones bien segmentados = canjeados/emitidos, abierto por segmento K-Means y por tipo de disparador. Cruza emisión, canje y la venta donde se canjeó.

**OT2.4 — Disponibilidad / quiebres**
- *Simple*: Stock disponible en tiempo real (OO-IN06) y productos bajo umbral → `stock_sucursal.stock_minimo` (001, enmienda v1.2).
- *Compuesto* — (a) + (b): % de quiebres de stock por sucursal × semana, cruzando SKUs en cero contra `demanda_insatisfecha` (004) para separar "sin stock y nadie lo pidió" de "sin stock y se perdió venta".

**OT2.5 — Churn y recuperación**
- *Simple*: Clientes marcados en riesgo real (OO-FC07) y campañas enviadas (OO-FC08) → `evaluacion_churn`, `campana_recuperacion` (002).
- *Compuesto* — (a) + (b): % de recuperación por cohorte de campaña. Exige comparar la actividad de compra del cliente en la ventana anterior contra la posterior al envío: análisis de cohorte, imposible como consulta puntual.

### OE3 — Perspectiva Procesos Internos

**OT3.1 — Cuadre de caja horario**
- *Simple*: Cuadres por turno con diferencia y motivo (OO-PP04) → `turno_caja`, `incidencia_cuadre_caja` (006).
- *Compuesto* — (a) + (c): Diferencia promedio y % de cuadres a tiempo por cajero × sucursal × franja horaria. Se alimenta de `punto_control_horario_turno` (006, enmienda v1.1) y es **el dataset de entrenamiento del Isolation Forest**: sin agregación horaria no hay detección de anomalías.

**OT3.2 — Alertas de caducidad**
- *Simple*: Productos próximos a caducar por sucursal (OO-IN04) → `lote_producto` (001).
- *Compuesto* — (a) + (b): % de productos alertados con acción a tiempo por categoría × mes. Exige emparejar cada alerta con la acción posterior (descuento o retiro) dentro de una ventana temporal.

**OT3.3 — Costo actualizado en cada compra** → *simple puro*
- *Simple*: Recepciones con su entrada de historial de costo y `numero_documento_proveedor` → `recepcion_orden_compra` (008, enmienda v1.1).
- *Por qué NO es compuesto*: el indicador (% de compras con costo actualizado el mismo día) compara dos fechas **de la misma fila**, sobre un volumen bajo (las compras son órdenes de magnitud menos que las ventas). Llevarlo a ClickHouse sería sobreingeniería.

**OT3.4 — Causa de merma**
- *Simple*: Mermas con causa clasificada y resultado de investigación (OO-PP08) → `merma.causa` (006).
- *Compuesto* — (b): Patrón de merma por causa × cajero × sucursal × turno. La iniciativa del OT dice explícitamente "cruzado con cuadre de caja": son dos hechos distintos, y ese cruce es lo que separa robo externo de fraude interno.

**OT3.5 — Apertura de sucursal** → *simple puro*
- *Simple*: Estado del checklist de apertura, 8 ítems fijos (OO-ES06) → `checklist_apertura_sucursal` (009).
- *Por qué NO es compuesto*: el indicador es una resta de dos campos de la misma fila de `sucursal` (fecha operativa − fecha de registro), sobre un puñado de sucursales al año. No hay volumen ni serie temporal que justifique el pipeline.

**OT3.6 — Pipeline ETL** → *simple puro*
- *Simple*: Estado y latencia del último ciclo (OO-AR02) → `ejecucion_pipeline_etl` (011).
- *Por qué NO es compuesto*: **es el único OT que no puede ser compuesto por diseño.** Monitorear el pipeline desde dentro del propio pipeline es circular: si el ETL falla, el informe que reporta la falla también falla. La metadata de salud del pipeline se queda obligatoriamente en la BDR.

**OT3.7 — Demanda insatisfecha**
- *Simple*: Eventos por sucursal/producto, con sustituto ofrecido y si fue aceptado → `demanda_insatisfecha` (004, campos de la enmienda v1.1).
- *Compuesto* — (a) + (b): Demanda insatisfecha agregada por producto × semana, cruzada con `cupon` (005) y `evento_local` (004). Es la entrada directa del modelo de pronóstico: sirve para descontar los confusores del Art. 5.6.

**OT3.8 — Venta fraccionada** → *simple puro*
- *Simple*: Ventas fraccionadas con su conversión aplicada → `detalle_venta` × `producto.factor_conversion` (001).
- *Por qué NO es compuesto*: la meta es 100% de conversiones correctas — eso es una **validación de integridad**, no un informe agregado. Se verifica contando las filas donde la conversión no cuadra; el resultado esperado es cero.

### OE4 — Perspectiva Aprendizaje y Crecimiento

**OT4.1 — Los 5 modelos de ML**
- *Simple*: Versiones desplegadas con sus métricas de desempeño (OO-AR04) → `version_modelo_ml` (011).
- *Compuesto* — (a) + (b) + (c): Los 5 modelos **se entrenan sobre el Fact-Dim de ClickHouse**, no sobre PostgreSQL. Además, evaluar el modelo (pronosticado vs. vendido real por producto × semana) es compuesto puro.

**OT4.2 — RBAC** → *simple puro*
- *Simple*: Matriz de permisos por rol × tabla × operación (OO-AD03) → `permiso_rol` (010).
- *Por qué NO es compuesto*: es **configuración, no un hecho que ocurra en el tiempo**. No tiene grano temporal, así que no entra en un modelo Fact-Dim. (Distinto de OT4.3, que sí registra eventos.)

**OT4.3 — Auditoría inmutable**
- *Simple*: Log filtrado o exportado por usuario/fecha/sucursal (OO-AD05) → `log_auditoria` (010).
- *Compuesto* — (a) + (c): Actividad crítica por usuario × sucursal × hora. Es el caso de volumen más claro del proyecto: una tabla append-only que nunca se purga y crece con cada operación de las tres capas.

**OT4.4 — Seguridad de pagos** → *simple puro*
- *Simple*: Datáfonos con su última revisión y estado vigente/vencido → `datafono`, `revision_datafono` (007); alertas de fraude en pago con tarjeta y su estado de atención → `alerta_fraude_pago` (006).
- *Por qué NO es compuesto*: con pocos datáfonos por sucursal, el % de terminales conformes es un conteo directo; y las alertas de fraude se atienden **una a una en el momento**, que es el flujo operativo real. El análisis de patrones de anomalía no vive aquí: vive en OT3.4/OT4.1.

**OT4.5 — Asistente conversacional**
- *Simple*: Historial de preguntas y de la consulta estructurada generada (OO-AR07) → `consulta_asistente` (011), auditoría del asistente.
- *Compuesto* — indirecto pero real: el asistente **no agrega nada por su cuenta** (Art. 5.6: nunca genera una cifra que no venga de una consulta real). Es el consumidor final de los informes compuestos ya materializados en ClickHouse. Sin la capa compuesta, el asistente no tiene qué responder.

---

## 4. Hallazgo crítico sobre la BDR: `categoria` no es tabla maestra

En `001-core-ventas-inventario/data-model.md`, la tabla `producto` tiene:

```
| categoria | TEXT | NOT NULL |
```

Es **texto libre**. Esto rompe cuatro informes compuestos de la tabla de arriba (OT1.1 margen por categoría, OT2.1 % competitivo por categoría, OT3.2 acción a tiempo por categoría, y la `dim_producto` completa): si un cajero escribe "Bebidas", otro "bebidas" y otro "BEBIDAS", la agregación por categoría devuelve tres filas distintas para lo mismo, y la respuesta a "¿cuál es mi categoría más rentable?" es falsa.

Es exactamente el tipo de hueco que el ingeniero detecta preguntando "¿y dónde veo esto?".

**Corrección propuesta** (enmienda v1.3 de 001, pendiente de tu visto bueno):

```sql
CREATE TABLE categoria (
    id            SERIAL PRIMARY KEY,
    nombre        VARCHAR(60) UNIQUE NOT NULL,
    categoria_padre_id INTEGER REFERENCES categoria(id),  -- jerarquía: Bebidas > Gaseosas
    es_perecedero BOOLEAN NOT NULL DEFAULT false,          -- dispara el flujo de caducidad (OT3.2)
    activo        BOOLEAN NOT NULL DEFAULT true
);
-- producto.categoria TEXT  →  producto.categoria_id INTEGER NOT NULL REFERENCES categoria(id)
```

`categoria_padre_id` permite jerarquía de dos niveles sin complicar el modelo, y `es_perecedero` a nivel de categoría evita marcarlo producto por producto.

---

## 5. Tablas maestras y de dimensión que exige la capa compuesta

De los 17 informes compuestos se derivan estas dimensiones. Las que ya existen en la BDR se pueblan por ETL; las marcadas **(nueva)** hay que crearlas.

### Dimensiones

| Dimensión | Origen | Atributos clave | Sirve a |
|---|---|---|---|
| `dim_tiempo` **(nueva, generada)** | Generada por script, no viene de la BDR | fecha, día, día_semana, semana_iso, mes, trimestre, año, es_fin_de_semana, **es_quincena**, **es_feriado** | Todos los compuestos con condición (a) |
| `dim_hora` **(nueva, generada)** | Generada (24 filas) | hora, franja (madrugada/mañana/mediodía/tarde/noche) | OT2.2, OT3.1, OT4.3 |
| `dim_producto` | `producto` + `categoria` | producto_id, nombre, categoría, subcategoría, unidad_venta, unidad_inventario, es_fraccionable, **clasificación gancho/nicho (SCD tipo 2)** | OT1.1, OT2.1, OT2.4, OT3.2 |
| `dim_categoria` | `categoria` **(hay que crearla, §4)** | nombre, categoría padre, es_perecedero | OT1.1, OT2.1, OT3.2 |
| `dim_sucursal` | `sucursal` (009) | nombre, zona/barrio, fecha de apertura, estado | Todos |
| `dim_cliente` | `cliente` + `segmento_cliente` (002) | **segmento K-Means vigente (SCD tipo 2)**, antigüedad, rango etario | OT1.4, OT2.3, OT2.5 |
| `dim_proveedor` | `proveedor` (008) | nombre, estado activo | OT1.3, OT1.5 |
| `dim_usuario` | `usuario` (010) | rol, sucursal(es) asignada(s) | OT3.1, OT3.4, OT4.3 |
| `dim_causa_merma` **(nueva, catálogo)** | Hoy es un CHECK en `merma.causa` | robo externo / error humano / fraude interno / caducidad | OT1.2, OT3.4 |
| `dim_metodo_pago` **(nueva, catálogo)** | Hoy es un CHECK en `venta_pago` | efectivo / tarjeta / transferencia | OT2.2 |
| `dim_canal_competencia` **(nueva, catálogo)** | Hoy es un CHECK en `precio_competencia.tipo_canal` | tienda física / supermercado / canal digital | OT2.1 |
| `dim_evento_local` | `evento_local` (004, enmienda v1.1) | tipo (feriado/clima/evento comunitario), fecha, sucursal afectada | OT3.7, OT4.1 |

**Nota sobre SCD tipo 2**: `dim_producto` (clasificación gancho/nicho) y `dim_cliente` (segmento K-Means) **cambian con el tiempo**. Si se sobreescriben, el margen histórico se recalcula mal: un producto que hoy es "gancho" pero hace seis meses era "nicho" aparecería siempre como gancho. Necesitan versionado con `fecha_desde`/`fecha_hasta`.

**Nota sobre los tres catálogos nuevos**: hoy son CHECK constraints en PostgreSQL, lo que está bien para la capa operativa. Al pasar a ClickHouse se materializan como dimensiones para poder etiquetar, ordenar y agrupar sin repetir el string en cada fila del hecho.

**Nota sobre `es_quincena` en `dim_tiempo`**: no es decorativo. La quincena es un confusor real de demanda en un kiosko de barrio (Art. 5.6) y sin esa bandera el modelo de pronóstico atribuye a promoción lo que en realidad fue día de pago.

### Tablas de hechos

| Hecho | Grano | Origen (BDR) | Medidas |
|---|---|---|---|
| `fact_venta_linea` | Una línea de venta | `detalle_venta` (001) | cantidad, precio aplicado, **costo de reposición vigente al momento de la venta**, margen de línea, duración del cobro |
| `fact_merma` | Un evento de merma | `merma` (006) | cantidad, valor perdido |
| `fact_cuadre_caja` | Un punto de control horario + el cierre de turno | `punto_control_horario_turno`, `turno_caja` (006) | monto esperado, monto contado, diferencia |
| `fact_compra_recepcion` | Una línea recibida | `recepcion_orden_compra` (008) | cantidad recibida, costo unitario, días entre pedido y recepción |
| `fact_demanda_insatisfecha` | Un evento de quiebre | `demanda_insatisfecha` (004) | cantidad solicitada, si se ofreció sustituto, si se aceptó |
| `fact_cupon` | Un cupón emitido | `cupon` (005) | valor del descuento, si fue canjeado, venta donde se canjeó |
| `fact_stock_diario` | Producto × sucursal × día (**snapshot periódico**) | `stock_sucursal`, `lote_producto` (001) | unidades, valor valorizado, días sin rotación, días para caducar |
| `fact_precio_competencia` | Producto × canal × fecha de observación | `precio_competencia` (003) | precio propio, precio competencia, brecha % |
| `fact_auditoria` | Un evento crítico | `log_auditoria` (010) | conteo (hecho sin medida numérica) |

**Decisión de diseño más importante de todo el modelo**: `fact_venta_linea` debe guardar el **costo de reposición vigente en la fecha de la venta**, congelado por el ETL en el momento de la carga. Si el margen se recalculara después contra el costo actual de `historial_costo_producto`, todo el margen histórico quedaría distorsionado cada vez que un proveedor sube un precio — y el KPI de OT1.1 (+8% trimestral) sería mentira. Es el mismo principio por el que `historial_costo_producto` es append-only en 008.

**`fact_stock_diario` es un snapshot periódico, no transaccional**: el stock no es un evento, es un estado. Para responder "cuánto capital tuve inmovilizado en marzo" (OT1.5) hace falta una foto diaria; no se puede reconstruir hacia atrás desde los movimientos sin acumular error.

---

## 6. Qué queda pendiente en la BDR antes de congelar el esquema físico

1. **Crear la tabla maestra `categoria`** y migrar `producto.categoria` de TEXT a FK (§4) — enmienda v1.3 de `001-core-ventas-inventario`.
2. **Confirmar el versionado (SCD tipo 2)** de la clasificación gancho/nicho en 003 y del segmento K-Means en 002: hoy se guardan como estado actual, sin historia. Sin `fecha_desde`/`fecha_hasta` en la BDR, el ETL no puede reconstruir la dimensión histórica.
3. **Verificar que `venta_pago` distingue método de pago** con un CHECK cerrado, no texto libre (mismo problema que `categoria`, a menor escala).
4. **`dim_tiempo` y `dim_hora` se generan por script**, no salen de ninguna tabla operativa — hay que incluir ese script en el DAG de Airflow como tarea de inicialización, una sola vez.

---

*Documento derivado de los 23 OT de la cascada de objetivos de El Kiosquito y de los data-models de los 11 módulos en `specs/`. Ninguna clasificación es genérica: cada "No" en la columna de informe compuesto tiene su justificación específica en §3.*
