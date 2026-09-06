# Especificación de Feature: Precios y Márgenes

**Feature**: `003-precios-margenes` | **Fecha**: 2026-09-04
**Departamento que aporta**: Precios y Márgenes (`PM`)
**Deriva de**: OT1.1 (aumentar el margen real mediante precios dinámicos), OT2.1 (ofrecer precios competitivos frente a la competencia)

## Resumen

Este módulo es dueño del precio de venta vigente de cada producto por sucursal, del margen real calculado contra el costo de reposición que registra Compras y Proveedores (`008-compras-proveedores`), y del motor de pricing dinámico que propone ajustes de precio. Es también el único módulo que puede clasificar un producto como "gancho" (margen bajo, alta rotación) o "nicho" (margen alto), una decisión de estrategia comercial que no es un atributo físico del producto, así que no se guarda en la tabla `producto` de `001-core-ventas-inventario`.

## Escenarios de Usuario

### Historia principal

Como Encargado de Precios y Márgenes, quiero ver el margen real de cada producto (no el margen teórico de catálogo) y recibir sugerencias del motor de pricing dinámico cuando conviene subir o bajar un precio, pero decidir yo mismo si aplico cada sugerencia — nunca quiero que el sistema cambie un precio sin que yo lo confirme.

### Escenarios de aceptación

1. **Dado** un producto con precio de venta registrado, **cuando** actualizo su precio manualmente en una sucursal, **entonces** el sistema crea una nueva entrada en `historial_precio_producto` con `fuente = 'manual'`, sin sobrescribir la anterior.
2. **Dado** un producto con costo de reposición ya registrado en `008-compras-proveedores`, **cuando** consulto su margen real, **entonces** el sistema calcula `(precio venta vigente − costo de reposición vigente) / precio venta vigente` usando siempre el costo más reciente disponible.
3. **Dado** un producto sin ningún costo de reposición registrado todavía, **cuando** consulto su margen real, **entonces** el sistema responde explícitamente que no hay datos suficientes — nunca asume un costo de cero (regla de honestidad de los modelos, Art. 5.9 de la constitución).
4. **Dado** un precio de referencia de la competencia registrado para un producto, **cuando** consulto la comparativa, **entonces** el sistema muestra el precio propio vigente junto al precio de competencia más reciente registrado.
5. **Dado** que el motor de pricing dinámico genera una recomendación, **cuando** un usuario la revisa, **entonces** puede aceptarla (lo que crea una nueva entrada en `historial_precio_producto` con `fuente = 'motor_dinamico'`) o rechazarla — el precio vigente nunca cambia hasta que un humano decide.
6. **Dado** un producto de alta rotación y margen bajo, **cuando** lo marco como "gancho", **entonces** la clasificación queda registrada a nivel de cadena, no por sucursal.

### Casos límite (qué pasa si...)

- **¿Qué pasa si** se genera una nueva recomendación de precio mientras ya existe una pendiente para el mismo producto/sucursal? → No se permite: solo puede existir una recomendación `pendiente` por producto/sucursal a la vez (RN-PM-001); el motor debe esperar a que la anterior se resuelva.
- **¿Qué pasa si** se actualiza el precio manualmente mientras hay una recomendación pendiente para ese mismo producto/sucursal? → La recomendación pendiente pasa automáticamente a `obsoleta`, porque ya no aplica sobre el precio que tenía cuando se generó.
- **¿Qué pasa si** se rechaza una recomendación? → Queda registrada como `rechazada` con quién y cuándo la resolvió, sin afectar el precio vigente — es información útil para evaluar el desempeño del motor (OT4.1).
- **¿Qué pasa si** se intenta consultar el margen real de un producto sin ningún costo registrado? → Respuesta explícita de "datos insuficientes", nunca un margen calculado con un costo asumido en cero.
- **¿Qué pasa si** se clasifica como "gancho" o "nicho" un producto cuyo margen no se puede calcular todavía? → Se permite igual — la clasificación es una decisión estratégica manual, no depende de que exista un cálculo automático previo.

## Requisitos Funcionales

- **RF-PM-001**: El sistema DEBE permitir registrar o actualizar el precio de venta de un producto en una sucursal específica.
- **RF-PM-002**: Cada cambio de precio DEBE registrarse como una nueva entrada en `historial_precio_producto`, nunca sobrescribiendo el precio anterior.
- **RF-PM-003**: El sistema DEBE calcular el margen real de un producto usando el precio de venta vigente y el costo de reposición más reciente registrado por Compras y Proveedores (`historial_costo_producto`, `008-compras-proveedores`).
- **RF-PM-004**: Si no existe ningún costo de reposición registrado para un producto, el sistema DEBE responder explícitamente que no hay datos suficientes, nunca asumir un costo de cero.
- **RF-PM-005**: El sistema DEBE permitir registrar el precio de referencia de la competencia para un producto (fuente, precio, fecha, tipo de canal).
- **RF-PM-011** *(añadido en enmienda v1.1, auditoría enunciado-vs-specs)*: Todo precio de competencia registrado DEBE clasificarse por tipo de canal (`tienda_fisica`, `supermercado`, `canal_digital`), para poder comparar por tipo de canal y no solo por texto libre — el enunciado pide explícitamente comparar contra "tiendas, supermercado, competencia local, canales digitales".
- **RF-PM-006**: El sistema DEBE permitir consultar la comparación entre el precio propio vigente y el precio de competencia más reciente registrado.
- **RF-PM-007**: El sistema DEBE permitir clasificar un producto como "gancho" o "nicho" a nivel de cadena.
- **RF-PM-008**: El motor de pricing dinámico (Sistema) DEBE generar recomendaciones de precio en estado `pendiente`, nunca aplicarlas directamente al precio vigente.
- **RF-PM-009**: Un usuario DEBE poder aceptar o rechazar una recomendación pendiente; aceptarla DEBE crear una nueva entrada en `historial_precio_producto` con `fuente = 'motor_dinamico'`.
- **RF-PM-010**: Toda recomendación resuelta (aceptada o rechazada) DEBE registrar quién y cuándo la resolvió.
- **RF-PM-012** *(añadido en enmienda v1.2, normalización de catálogos)*: La fuente de un precio de competencia DEBE seleccionarse de un catálogo mantenido (`fuente_competencia`), nunca escribirse como texto libre — con el nombre a mano, dos observaciones del mismo local escritas distinto se cuentan como competidores distintos y la pregunta "¿contra qué competidor estoy peor de precio?" no tiene respuesta.
- **RF-PM-013** *(añadido en enmienda v1.2)*: El sistema DEBE permitir registrar, actualizar y dar de baja fuentes de competencia, cada una asociada a su canal.
- **RF-PM-014** *(añadido en enmienda v1.2)*: El sistema DEBE permitir consultar la comparación de precio propio contra la competencia agrupada por fuente concreta, además de por canal.
- **RF-PM-015** *(añadido en enmienda v1.2)*: Todo cambio de clasificación comercial de un producto DEBE quedar registrado en un historial con su rango de vigencia, el motivo y el usuario que lo hizo.
- **RF-PM-016** *(añadido en enmienda v1.2)*: El sistema DEBE permitir consultar la clasificación que un producto tenía en una fecha dada, no solo la vigente — el margen histórico de OT1.1 debe evaluarse contra el rango objetivo que regía en ese momento, no contra el actual.
- **RF-PM-017** *(añadido en enmienda v1.2)*: El rango de margen objetivo de cada clasificación (`gancho`/`nicho`) DEBE ser un dato consultable del catálogo, no un valor fijo en el código del motor de pricing.

## Requisitos No Funcionales

- **RNF-PM-001**: La consulta de margen real (RF-PM-003) nunca debe fallar silenciosamente ni devolver un valor inventado — si faltan datos, la respuesta lo declara explícitamente (Art. 5.9).
- **RNF-PM-002**: `historial_precio_producto` es de solo inserción — ningún endpoint expone `UPDATE`/`DELETE` sobre precios ya registrados.

## Reglas de Negocio

- **RN-PM-001**: Solo puede existir una recomendación de precio en estado `pendiente` por producto/sucursal a la vez.
- **RN-PM-002**: El motor de pricing dinámico nunca escribe directamente en `historial_precio_producto` — todo cambio de precio originado por el motor pasa primero por una recomendación que un usuario debe aceptar (Art. 5.6, ningún modelo actúa de forma autónoma sobre datos de negocio).
- **RN-PM-003** *(añadida en enmienda v1.2)*: Cambiar la clasificación de un producto DEBE cerrar la vigencia de la anterior e insertar la nueva en el historial, dentro de la misma transacción que actualiza `clasificacion_producto`. Las dos tablas se actualizan juntas o ninguna.
- **RN-PM-004** *(añadida en enmienda v1.2)*: Un producto no puede tener dos clasificaciones vigentes a la vez en `producto_clasificacion_historial`. Se impone con índice único parcial (`UNIQUE (producto_id) WHERE fecha_hasta IS NULL`), no solo con validación de servicio — mismo criterio que RN-PM-001.
- **RN-PM-005** *(añadida en enmienda v1.2)*: `motivo_cambio` es obligatorio con mínimo 10 caracteres al reclasificar un producto. Reclasificar cambia la política de precios del producto, así que la justificación es del mismo orden que la que exige el Art. 5.9 para las cifras del motor.
- **RN-PM-006** *(añadida en enmienda v1.2)*: Ninguna fila de catálogo se borra; baja lógica con `activo = false`. Borrar una `fuente_competencia` dejaría observaciones históricas apuntando a un competidor inexistente.
- **RN-PM-007** *(añadida en enmienda v1.3, auditoría de riesgos derivados 2026-09-05)*: Aceptar una recomendación de precio cuyo `precio_recomendado` queda por debajo del costo de reposición vigente del producto exige `confirmar_perdida=true` explícito en el payload de resolución, o el sistema rechaza con `409` (incluyendo el precio, el costo vigente y la pérdida unitaria calculada). No se bloquea la aceptación en sí — vender un producto gancho puntual por debajo del costo puede ser una decisión de negocio legítima — pero RN-PM-002 (nadie más que un humano acepta la recomendación) no alcanzaba a impedir que se aceptara *por descuido* un número que no tiene sentido económico.

## Caso límite adicional (enmienda v1.2)

- **¿Qué pasa si** hay que evaluar el margen de un producto en un periodo en que tenía otra clasificación? → Se consulta la clasificación vigente en esa fecha vía `producto_clasificacion_historial` (RF-PM-016) y se compara contra el rango objetivo de **esa** clasificación. Evaluar el margen histórico contra la clasificación actual haría parecer que un producto lleva medio año fuera de su rango objetivo cuando en realidad cumplía el que regía entonces.
- **¿Qué pasa si** un local de la competencia cierra o cambia de nombre? → Se da de baja con `activo = false` o se corrige el nombre en `fuente_competencia`; las observaciones históricas siguen apuntando a la misma fila y no se pierde ninguna comparación pasada. Por eso este catálogo lleva `id` propio y no clave natural.
- **¿Qué pasa si** un producto nunca fue clasificado? → No tiene fila en `clasificacion_producto` ni en el historial, y el motor de pricing no puede evaluarlo contra ningún rango objetivo. La consulta lo declara explícitamente, igual que RF-PM-004 hace con el costo ausente — no se asume "gancho" por defecto.

## Entidades Clave

- **ClasificacionComercial, FuentePrecio, CanalCompetencia, FuenteCompetencia, EstadoRecomendacion** *(enmienda v1.2)*: catálogos maestros. `ClasificacionComercial` lleva el rango de margen objetivo (RF-PM-017); `CanalCompetencia` la frecuencia de monitoreo esperada; `FuenteCompetencia` es el local concreto observado, agrupado por canal.
- **HistorialPrecioProducto**: precio de venta vigente y su historial, por producto y sucursal, con la fuente del cambio (`manual` o `motor_dinamico`).
- **ClasificacionProducto**: etiqueta "gancho"/"nicho" a nivel de cadena, propiedad de este módulo aunque referencia a `producto` de `001-core-ventas-inventario`. Guarda **solo el estado vigente**.
- **ProductoClasificacionHistorial** *(enmienda v1.2)*: dimensión SCD tipo 2 de la clasificación, con rango de vigencia, motivo y usuario. Existe como tabla aparte porque `ClasificacionProducto` se sobreescribe — a diferencia de `SegmentoCliente` en `002-clientes-fidelizacion`, que ya era append-only y solo hubo que hacerla legible como dimensión.
- **PrecioCompetencia**: precios de referencia de la competencia, registrados manualmente. *(Enmienda v1.2)* Pierde `tipo_canal`: era una dependencia transitiva de la fuente (3NF), y el canal se obtiene por JOIN.
- **RecomendacionPrecio**: propuesta del motor de pricing dinámico, con su justificación y su ciclo de vida (`pendiente`/`aceptada`/`rechazada`/`obsoleta`).

## Checklist de revisión

- [ ] Todo RF tiene un endpoint correspondiente en `contracts/precios-margenes.openapi.yaml`
- [ ] RN-PM-001 está implementado como índice único parcial, no solo como validación de servicio
- [ ] Ningún endpoint permite que el motor de pricing dinámico escriba directamente `historial_precio_producto` (RN-PM-002)
- [ ] Los 5 casos límite están cubiertos por al menos un test de contrato en `tasks.md`
- [ ] Todo `precio_competencia` queda clasificado por canal (RF-PM-011, enmienda v1.1) — desde la enmienda v1.2 vía `fuente_competencia.canal_codigo`, ya no como columna propia
- [ ] Ningún endpoint acepta la fuente de competencia como texto libre (RF-PM-012, enmienda v1.2)
- [ ] RN-PM-004 es un índice único parcial de base de datos, igual que RN-PM-001 (enmienda v1.2)
- [ ] El rango de margen objetivo se lee del catálogo, no está fijo en el código del motor (RF-PM-017, enmienda v1.2)
