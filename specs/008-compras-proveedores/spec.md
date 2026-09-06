# Especificación de Feature: Compras y Proveedores

**Feature**: `008-compras-proveedores` | **Fecha**: 2026-09-04
**Departamento**: Compras y Proveedores (abreviatura `CP`)
**Deriva de**: OT1.3 (reducir el costo de reposición promedio), OT3.3 (mantener actualizado el costo de reposición en cada compra), OT1.5 (reducir stock muerto validando compras por oferta contra el pronóstico, compartido con Inventario y Caducidad)

## Resumen

Este módulo gestiona el ciclo completo de una orden de compra a un proveedor: registro del proveedor, creación de la orden, recepción de mercadería (que puede llegar en más de un envío) y el historial de costos que alimenta el cálculo de margen real (OT1.1, propiedad de `003-precios-margenes`). Incluye además el control de negocio más particular del enunciado para este departamento: una compra "por oferta" del proveedor no puede confirmarse a ciegas sin haber consultado el pronóstico de demanda del producto (ahora un módulo real, `004-pronostico-demanda`), para evitar comprar barato algo que luego se convierte en stock muerto.

## Escenarios de Usuario

### Historia principal

Como Encargado de Compras, cuando un proveedor me ofrece un producto a un precio más bajo de lo normal, quiero poder registrar la orden de compra, pero antes de confirmarla necesito ver qué dice el pronóstico de demanda de ese producto — si decido comprar igual pese a que el pronóstico no lo respalda, el sistema debe dejar registrado por qué, para que quede trazable si termina siendo stock muerto.

### Escenarios de aceptación

1. **Dado** un proveedor ya registrado, **cuando** creo una orden de compra con uno o más productos, cantidades y precio ofrecido, **entonces** el sistema la registra en estado `pendiente`.
2. **Dado** una orden de compra pendiente, **cuando** registro la recepción parcial de uno de sus productos, **entonces** el sistema crea un evento en el historial de recepciones y recalcula `cantidad_recibida` del detalle sumando todos los eventos registrados hasta ahora — nunca lo trata como un contador que se incrementa directamente.
3. **Dado** que todos los productos de una orden alcanzaron `cantidad_recibida >= cantidad_pedida`, **cuando** se registra la última recepción, **entonces** la orden pasa automáticamente a `recibida_completa`.
4. **Dado** una recepción registrada, **cuando** el sistema la procesa, **entonces** también crea un registro en `historial_costo_producto` con el costo pagado, el proveedor y la fecha, para alimentar el cálculo de margen real de `003-precios-margenes` (OT1.1).
5. **Dado** un producto suministrado por más de un proveedor, **cuando** consulto la comparación de precios entre proveedores, **entonces** el sistema devuelve el costo más reciente registrado por cada proveedor para ese producto.
6. **Dado** una orden marcada `es_oferta = true`, **cuando** intento pasarla a `recibida_parcial` sin haber consultado el pronóstico de demanda (`004-pronostico-demanda`) para cada producto de la orden, **entonces** el sistema rechaza el cambio de estado (RN-CP-001).
7. **Dado** una orden `es_oferta = true` donde la cantidad pedida supera la cantidad recomendada por el pronóstico, **cuando** confirmo la orden de todas formas, **entonces** el sistema exige un motivo antes de aceptar la recepción.

### Casos límite (qué pasa si...)

- **¿Qué pasa si** un proveedor entrega más cantidad de la pedida (sobre-entrega)? → Se acepta el registro (es un dato real de lo ocurrido), `cantidad_recibida` puede superar `cantidad_pedida`; no se trata como error del sistema, aunque queda visible en la consulta de la orden para que el Encargado de Compras lo note.
- **¿Qué pasa si** se recibe una orden en más de un envío del mismo proveedor? → Cada envío es un evento independiente en `recepcion_orden_compra`; el estado de la orden se recalcula sumando todos los eventos, nunca se sobreescribe un envío anterior.
- **¿Qué pasa si** se intenta pasar una orden `es_oferta=true` a recibida sin haber consultado el pronóstico? → Rechazado con `422` (RN-CP-001) — no existe forma de saltarse la consulta.
- **¿Qué pasa si** `004-pronostico-demanda` responde que no hay datos suficientes para un producto? → Se acepta igual como "consulta realizada" (`pronostico_consultado = true`), pero sin `cantidad_recomendada_pronostico` — en ese caso, cualquier cantidad pedida exige `motivo_no_siguio_pronostico`, porque no hay recomendación contra la cual comparar.
- **¿Qué pasa si** un proveedor se desactiva mientras tiene órdenes de compra pendientes? → La desactivación solo bloquea la creación de *nuevas* órdenes con ese proveedor; las órdenes ya creadas se pueden seguir recibiendo con normalidad.
- **¿Qué pasa si** dos proveedores distintos cotizan el mismo producto el mismo día a precios diferentes? → Ambos quedan registrados en `historial_costo_producto` sin conflicto.

## Requisitos Funcionales

- **RF-CP-001**: El sistema DEBE permitir registrar y actualizar un proveedor (nombre, contacto).
- **RF-CP-002**: El sistema DEBE permitir registrar una orden de compra con uno o más productos, cantidad pedida y precio ofrecido por producto.
- **RF-CP-003**: El sistema DEBE permitir registrar eventos de recepción de una orden, pudiendo ocurrir en más de un envío.
- **RF-CP-004**: El sistema DEBE recalcular `cantidad_recibida` de cada línea de la orden sumando todos los eventos de recepción registrados, nunca como un contador incrementado directamente.
- **RF-CP-005**: El sistema DEBE cambiar automáticamente el estado de la orden a `recibida_completa` cuando todas sus líneas alcanzan `cantidad_recibida >= cantidad_pedida`, y a `recibida_parcial` mientras eso no ocurra en todas.
- **RF-CP-006**: Cada evento de recepción DEBE generar un registro en `historial_costo_producto` con el costo pagado, para alimentar el cálculo de margen real (OT1.1).
- **RF-CP-007**: El sistema DEBE permitir consultar el historial de variación de costo de un producto por proveedor.
- **RF-CP-008**: El sistema DEBE permitir consultar y comparar el costo más reciente de un mismo producto entre distintos proveedores.
- **RF-CP-009**: El sistema DEBE permitir consultar el pronóstico de demanda de un producto (`004-pronostico-demanda`) antes de confirmar una orden marcada como compra por oferta.
- **RF-CP-010**: Si una orden `es_oferta = true` no siguió la recomendación del pronóstico, el sistema DEBE exigir un motivo antes de aceptar su recepción.
- **RF-CP-011**: El sistema DEBE permitir dar de baja/desactivar un proveedor sin afectar sus órdenes ya existentes.
- **RF-CP-012** *(añadido en enmienda v1.1, comparación contra dataset real)*: Toda orden de compra DEBE registrar su forma de pago (contado/crédito) — dato real de negocio que afecta el flujo de caja de la cadena (OT1.3), ausente hasta ahora.
- **RF-CP-013** *(añadido en enmienda v1.1)*: El sistema DEBE permitir registrar, opcionalmente, el número de documento del proveedor (factura o guía de remisión) en cada evento de recepción, para hacer trazable la recepción contra el documento físico real que la respalda.
- **RF-CP-014** *(añadido en enmienda v1.2, normalización de catálogos)*: La forma de pago y el estado de una orden DEBEN seleccionarse de sus catálogos (`forma_pago`, `estado_orden_compra`), nunca quedar como valores fijos en el contrato de la API.
- **RF-CP-015** *(añadido en enmienda v1.2)*: El catálogo de formas de pago DEBE declarar el plazo por defecto en días de cada una — saber que una orden es a crédito sin saber a cuántos días no permite anticipar cuándo hay que pagarla (OT1.3).
- **RF-CP-016** *(añadido en enmienda v1.2)*: El sistema DEBE exponer ambos catálogos como consulta, incluyendo `permite_recepcion` de `estado_orden_compra`.

## Requisitos No Funcionales

- **RNF-CP-001**: El estado de una orden de compra (`pendiente`/`recibida_parcial`/`recibida_completa`) siempre se deriva de sus eventos de recepción — nunca se permite un `UPDATE` directo del campo `estado` desde un endpoint de usuario.
- **RNF-CP-002**: El historial de costos (`historial_costo_producto`) es de solo inserción — nunca se corrige un costo ya registrado, se agrega uno nuevo (append-only), igual disciplina que la auditoría de Administración (Art. 10.5).

## Reglas de Negocio

- **RN-CP-001**: Una orden con `es_oferta = true` no puede cambiar de `pendiente` a `recibida_parcial` o `recibida_completa` si algún `detalle_orden_compra` no tiene `pronostico_consultado = true`; si la cantidad pedida excede la cantidad recomendada por el pronóstico (o si el pronóstico no tenía datos suficientes), `motivo_no_siguio_pronostico` es obligatorio para ese detalle.

- **RN-CP-002** *(añadida en enmienda v1.2)*: Si una orden admite o no nuevas recepciones DEBE leerse de `estado_orden_compra.permite_recepcion`, nunca de una comparación contra estados escritos a mano en el servicio.
- **RN-CP-003** *(añadida en enmienda v1.2)*: Ninguna fila de catálogo se borra; baja lógica con `activo = false`. Las órdenes históricas deben conservar el significado de su forma de pago.

## Caso límite adicional (enmienda v1.1)

- **¿Qué pasa si** una recepción ocurre antes de que llegue físicamente la factura del proveedor? → Se acepta igual: `numero_documento_proveedor` es opcional (RF-CP-013), la recepción no se bloquea por no tener todavía el documento del proveedor en mano.

## Caso límite adicional (enmienda v1.2)

- **¿Qué pasa si** el negocio negocia una forma de pago nueva con un proveedor (por ejemplo crédito a 60 días)? → Se inserta en `forma_pago` con su `dias_plazo_default`, sin migración de esquema. El plazo se declara a nivel del tipo de pago, no de cada orden: modelar el plazo negociado orden por orden sería un módulo de cuentas por pagar, y ningún OT de la cascada lo pide.
- **¿Qué pasa si** alguien intenta escribir `orden_compra.estado` directamente ahora que es una FK? → Sigue siendo imposible: no existe endpoint que lo exponga (RNF-CP-001). La FK solo garantiza que el valor calculado por el servicio exista en el catálogo; no abre una vía de escritura.

## Entidades Clave

- **FormaPago, EstadoOrdenCompra** *(enmienda v1.2)*: catálogos maestros. `FormaPago` declara `dias_plazo_default`; `EstadoOrdenCompra` declara `permite_recepcion`, que saca del servicio la regla de qué órdenes admiten más recepciones.
- **Proveedor**: nombre, contacto, estado activo/inactivo.
- **OrdenCompra**: proveedor, sucursal destino, fecha, estado (derivado), `es_oferta`, `forma_pago` (enmienda v1.1).
- **DetalleOrdenCompra**: producto, cantidad pedida, precio ofrecido, cantidad recibida (derivada), datos de validación de pronóstico.
- **RecepcionOrdenCompra**: evento individual de recepción — permite entregas parciales en más de un envío; desde la enmienda v1.1, opcionalmente trazable contra el documento del proveedor.
- **HistorialCostoProducto**: costo pagado por producto/proveedor/fecha — alimenta OT1.1 (margen real) y comparación de proveedores.

## Checklist de revisión

- [ ] Todo RF tiene un endpoint correspondiente en `contracts/compras-proveedores.openapi.yaml`
- [ ] RN-CP-001 está implementado como validación de servicio antes del cambio de estado, no solo documentado
- [ ] `estado` de la orden nunca se expone como campo editable directamente en el contrato (RNF-CP-001)
- [ ] Los 6 casos límite (más el de enmienda v1.1) están cubiertos por al menos un test de contrato en `tasks.md`
- [ ] Toda orden de compra registra `forma_pago` (RF-CP-012, enmienda v1.1)
- [ ] `numero_documento_proveedor` nunca bloquea el registro de una recepción por estar ausente (RF-CP-013, enmienda v1.1)
- [ ] Convertir `estado` a FK **no** lo volvió editable: RNF-CP-001 sigue vigente y ningún endpoint lo escribe (enmienda v1.2)
- [ ] La validación de si una orden admite recepciones lee `permite_recepcion` del catálogo, no compara estados a mano (RN-CP-002, enmienda v1.2)
