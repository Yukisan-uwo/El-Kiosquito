# Especificación de Feature: Precios y Márgenes

**Feature**: `004-precios-margenes` | **Fecha**: 2026-09-04
**Departamento**: Precios y Márgenes (abreviatura `PM`)
**Deriva de**: OT1.1 (aumentar el margen real mediante precios dinámicos), OT2.1 (ofrecer precios competitivos frente a la competencia)

## Resumen

Este módulo es dueño del precio de venta vigente de cada producto por sucursal, del margen real calculado contra el costo de reposición que registra Compras y Proveedores, y del motor de pricing dinámico que propone ajustes de precio. Es también el único módulo que puede clasificar un producto como "gancho" (margen bajo, alta rotación) o "nicho" (margen alto), una decisión de estrategia comercial que no es un atributo físico del producto, así que no se guarda en la tabla `producto` de Inventario y Caducidad.

## Escenarios de Usuario

### Historia principal

Como Encargado de Precios y Márgenes, quiero ver el margen real de cada producto (no el margen teórico de catálogo) y recibir sugerencias del motor de pricing dinámico cuando conviene subir o bajar un precio, pero decidir yo mismo si aplico cada sugerencia — nunca quiero que el sistema cambie un precio sin que yo lo confirme.

### Escenarios de aceptación

1. **Dado** un producto con precio de venta registrado, **cuando** actualizo su precio manualmente en una sucursal, **entonces** el sistema crea una nueva entrada en `historial_precio_producto` con `fuente = 'manual'`, sin sobrescribir la anterior.
2. **Dado** un producto con costo de reposición ya registrado en Compras y Proveedores, **cuando** consulto su margen real, **entonces** el sistema calcula `(precio venta vigente − costo de reposición vigente) / precio venta vigente` usando siempre el costo más reciente disponible.
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
- **RF-PM-003**: El sistema DEBE calcular el margen real de un producto usando el precio de venta vigente y el costo de reposición más reciente registrado por Compras y Proveedores (`historial_costo_producto`).
- **RF-PM-004**: Si no existe ningún costo de reposición registrado para un producto, el sistema DEBE responder explícitamente que no hay datos suficientes, nunca asumir un costo de cero.
- **RF-PM-005**: El sistema DEBE permitir registrar el precio de referencia de la competencia para un producto (fuente, precio, fecha).
- **RF-PM-006**: El sistema DEBE permitir consultar la comparación entre el precio propio vigente y el precio de competencia más reciente registrado.
- **RF-PM-007**: El sistema DEBE permitir clasificar un producto como "gancho" o "nicho" a nivel de cadena.
- **RF-PM-008**: El motor de pricing dinámico (Sistema) DEBE generar recomendaciones de precio en estado `pendiente`, nunca aplicarlas directamente al precio vigente.
- **RF-PM-009**: Un usuario DEBE poder aceptar o rechazar una recomendación pendiente; aceptarla DEBE crear una nueva entrada en `historial_precio_producto` con `fuente = 'motor_dinamico'`.
- **RF-PM-010**: Toda recomendación resuelta (aceptada o rechazada) DEBE registrar quién y cuándo la resolvió.

## Requisitos No Funcionales

- **RNF-PM-001**: La consulta de margen real (RF-PM-003) nunca debe fallar silenciosamente ni devolver un valor inventado — si faltan datos, la respuesta lo declara explícitamente (Art. 5.9).
- **RNF-PM-002**: `historial_precio_producto` es de solo inserción — ningún endpoint expone `UPDATE`/`DELETE` sobre precios ya registrados.

## Reglas de Negocio

- **RN-PM-001**: Solo puede existir una recomendación de precio en estado `pendiente` por producto/sucursal a la vez.
- **RN-PM-002**: El motor de pricing dinámico nunca escribe directamente en `historial_precio_producto` — todo cambio de precio originado por el motor pasa primero por una recomendación que un usuario debe aceptar (Art. 5.6, ningún modelo actúa de forma autónoma sobre datos de negocio).

## Entidades Clave

- **HistorialPrecioProducto**: precio de venta vigente y su historial, por producto y sucursal, con la fuente del cambio (`manual` o `motor_dinamico`).
- **ClasificacionProducto**: etiqueta "gancho"/"nicho" a nivel de cadena, propiedad de este módulo aunque referencia a `producto` de Inventario.
- **PrecioCompetencia**: precios de referencia de la competencia, registrados manualmente.
- **RecomendacionPrecio**: propuesta del motor de pricing dinámico, con su justificación y su ciclo de vida (`pendiente`/`aceptada`/`rechazada`/`obsoleta`).

## Checklist de revisión

- [ ] Todo RF tiene un endpoint correspondiente en `contracts/precios-margenes.openapi.yaml`
- [ ] RN-PM-001 está implementado como índice único parcial, no solo como validación de servicio
- [ ] Ningún endpoint permite que el motor de pricing dinámico escriba directamente `historial_precio_producto` (RN-PM-002)
- [ ] Los 5 casos límite están cubiertos por al menos un test de contrato en `tasks.md`
