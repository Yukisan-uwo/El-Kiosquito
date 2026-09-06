# Especificación de Feature: Core de Ventas e Inventario

**Feature**: `001-core-ventas-inventario` | **Fecha**: 2026-09-04
**Departamentos que aporta**: Ventas y Caja (`VC`) — mecánica de venta — e Inventario y Caducidad (`IN`) — catálogo y stock
**Deriva de**: OT2.2 (reducir tiempo de cobro), OT3.8 (fraccionamiento correcto), OT2.4 (garantizar disponibilidad), OT3.2 (alertas de caducidad), OT1.5 (reducir stock muerto)

## Resumen

Este es el módulo núcleo del sistema: registra qué se vende (`venta`/`detalle_venta`) y mantiene el catálogo y el stock que hace posible vender (`producto`, `stock_sucursal`, `lote_producto`, `ajuste_inventario`). Se fusionan aquí dos departamentos de la cascada de objetivos (Ventas y Caja + Inventario y Caducidad) porque ambos comparten el mismo ciclo de vida corto y transaccional — una venta ocurre en segundos y depende directamente de que el stock esté disponible en ese mismo instante.

Quedan fuera de este módulo, aunque nacieron originalmente en la misma conversación de diseño: el control de caja por turno y el fraude de pago (ver `006-caja-mermas-fraude`, distinto ciclo de vida: se cierra por turno/día, no por venta) y el registro de demanda insatisfecha (ver `004-pronostico-demanda`, un dato que solo tiene valor como insumo del modelo de pronóstico, nunca se consulta por sí solo desde el punto de venta).

## Escenarios de Usuario

### Historia principal

Como Cajero, registro una venta con uno o más productos — algunos por unidad completa, otros fraccionados (venta suelta) — y el sistema descuenta el stock correspondiente de mi sucursal en el mismo momento, usando siempre la conversión de unidades correcta del producto. Como Encargado de Sucursal, recibo mercadería y registro su ingreso al stock, y si es perecedero, registro también su fecha de caducidad para que el sistema me avise antes de que se pierda.

### Escenarios de aceptación

1. **Dado** un producto con `es_fraccionable = false`, **cuando** registro una venta de unidades completas, **entonces** el sistema descuenta esa cantidad de `stock_sucursal.cantidad_disponible` y calcula IVA (15%) y total.
2. **Dado** un producto con `es_fraccionable = true` y `factor_conversion` configurado, **cuando** registro una venta fraccionada, **entonces** el sistema convierte la cantidad vendida a la unidad de inventario antes de descontar el stock.
3. **Dado** un producto con `es_fraccionable = true` pero sin `factor_conversion`, **cuando** intento crearlo o venderlo, **entonces** el sistema rechaza la operación con `422`.
4. **Dado** una venta completada, **cuando** la anulo con un motivo, **entonces** queda marcada `anulada` sin eliminarse (append-mostly, Art. 10.5).
5. **Dado** un producto perecedero, **cuando** registro su ingreso de stock con fecha de caducidad, **entonces** el sistema crea además un registro en `lote_producto`.
6. **Dado** un producto sin ninguna venta reciente, **cuando** corre el proceso batch de rotación, **entonces** se marca `marcado_sin_rotacion = true` en `stock_sucursal`.

### Casos límite (qué pasa si...)

- **¿Qué pasa si** se anula una venta después de que su turno de caja ya cerró (turno gestionado en `006-caja-mermas-fraude`)? → La anulación se registra igual en `venta`, pero no reabre ni modifica el cuadre ya cerrado — ese cuadre es responsabilidad exclusiva del otro módulo.
- **¿Qué pasa si** un ajuste de inventario dejaría `cantidad_disponible` en negativo? → Se rechaza con `422`.
- **¿Qué pasa si** se registra un lote con fecha de caducidad ya vencida al ingresar? → Se acepta el registro, pero genera alerta inmediata (ver `contracts/`).
- **¿Qué pasa si** dos ingresos del mismo producto/sucursal el mismo día tienen fechas de caducidad distintas? → Se crean dos lotes separados, nunca se combinan.
- **¿Qué pasa si** un producto marcado sin rotación recibe una venta nueva? → Se desmarca automáticamente en el siguiente ciclo batch.

## Requisitos Funcionales

- **RF-CVI-001**: El sistema DEBE permitir registrar una venta con uno o más productos, cantidad y método de pago.
- **RF-CVI-002**: El sistema DEBE registrar el estado del pago de una venta (pendiente/aprobado/rechazado).
- **RF-CVI-003**: El sistema DEBE permitir aplicar un descuento a una venta en curso.
- **RF-CVI-004**: El sistema DEBE permitir anular una venta con motivo obligatorio, sin eliminarla.
- **RF-CVI-005**: El sistema DEBE convertir automáticamente la cantidad vendida de un producto fraccionado a su unidad de inventario, usando `producto.factor_conversion`.
- **RF-CVI-006**: El sistema DEBE rechazar la creación/actualización de un producto fraccionable sin `factor_conversion`.
- **RF-CVI-007**: El sistema DEBE permitir registrar/actualizar un producto en el catálogo.
- **RF-CVI-008**: El sistema DEBE registrar el ingreso de stock a una sucursal, actualizando `stock_sucursal.cantidad_disponible`.
- **RF-CVI-009**: Si el producto es perecedero y el ingreso incluye fecha de caducidad, el sistema DEBE crear un registro en `lote_producto`.
- **RF-CVI-010**: El sistema DEBE permitir consultar productos próximos a caducar por sucursal.
- **RF-CVI-011**: El sistema DEBE permitir registrar el retiro/descuento de un lote próximo a caducar.
- **RF-CVI-012**: El sistema DEBE exponer la cantidad disponible en tiempo real de un producto por sucursal.
- **RF-CVI-013**: El sistema DEBE permitir registrar un ajuste de inventario tras conteo físico, con motivo obligatorio.
- **RF-CVI-014**: Ningún ajuste ni retiro puede dejar `cantidad_disponible` en negativo.
- **RF-CVI-015**: El sistema DEBE marcar automáticamente un producto/sucursal como "sin rotación" mediante un proceso batch, nunca manualmente.
- **RF-CVI-016**: El sistema DEBE permitir consultar productos sin rotación por sucursal.
- **RF-CVI-017** *(añadido en enmienda v1.1, auditoría enunciado-vs-specs)*: El sistema DEBE permitir registrar la hora en que inició el cobro de una venta, para poder medir el tiempo real de atención en caja contra la meta de OT2.2 (<90 seg) — sin este dato, esa meta era imposible de auditar.
- **RF-CVI-018** *(añadido en enmienda v1.1)*: El sistema DEBE permitir registrar un producto como sustituto de otro, para ofrecerlo en el punto de venta cuando el original no tiene stock.
- **RF-CVI-019** *(añadido en enmienda v1.1)*: El sistema DEBE permitir consultar los sustitutos registrados de un producto.
- **RF-CVI-020** *(añadido en enmienda v1.2, comparación contra dataset real)*: Toda venta DEBE emitir un número de documento propio (nota de venta interna), distinto y adicional a su identificador interno — sin este dato, `venta` no es defendible como un documento de negocio real ante el criterio de evaluación del ingeniero.
- **RF-CVI-021** *(añadido en enmienda v1.2)*: El sistema DEBE permitir definir/actualizar un nivel mínimo de stock (`stock_minimo`) por producto y sucursal.
- **RF-CVI-022** *(añadido en enmienda v1.2)*: El sistema DEBE permitir consultar los productos de una sucursal cuya `cantidad_disponible` está por debajo de su `stock_minimo` (alerta de reposición).
- **RF-CVI-023** *(añadido en enmienda v1.3, normalización de catálogos)*: La categoría de un producto DEBE seleccionarse de un catálogo mantenido (`categoria`), nunca escribirse como texto libre — dos escrituras distintas del mismo nombre ("Bebidas" y "bebidas") harían que todo informe agregado por categoría devuelva filas separadas para la misma categoría, invalidando los indicadores de OT1.1, OT2.1 y OT3.2.
- **RF-CVI-024** *(añadido en enmienda v1.3)*: El sistema DEBE permitir crear, actualizar y dar de baja categorías, admitiendo una jerarquía de dos niveles (categoría padre → subcategoría).
- **RF-CVI-025** *(añadido en enmienda v1.3)*: Las unidades de venta e inventario de un producto DEBEN seleccionarse del catálogo `unidad_medida`, que declara por unidad si admite cantidades decimales.
- **RF-CVI-026** *(añadido en enmienda v1.3)*: El sistema DEBE exponer los catálogos de este módulo (`categoria`, `unidad_medida`, `metodo_pago`, `estado_pago`, `estado_venta`) como consulta, para que el POS y los formularios los desplieguen en lugar de tener las opciones escritas en el código de la interfaz.

## Requisitos No Funcionales

- **RNF-CVI-001**: La consulta de stock en tiempo real debe responder en menos de 300ms p95 (invocada en cada venta).
- **RNF-CVI-002**: Ninguna tabla de este módulo permite `DELETE` desde la aplicación.
- **RNF-CVI-003**: `venta.turno_caja_id` es una FK hacia `turno_caja`, tabla propiedad de `006-caja-mermas-fraude` — este módulo nunca escribe en ella, solo la referencia.

## Reglas de Negocio

- **RN-CVI-001**: `factor_conversion` es obligatorio si y solo si `producto.es_fraccionable = true`.
- **RN-CVI-002**: `stock_sucursal.cantidad_disponible` nunca puede ser negativa.
- **RN-CVI-003**: `detalle_venta.precio_unitario_aplicado` y `unidad_venta` son snapshots — nunca se recalculan con el catálogo actual una vez registrada la venta.
- **RN-CVI-004** *(añadida en enmienda v1.1)*: `producto_sustituto` no puede tener `producto_sustituto_id = producto_id` (un producto no es sustituto de sí mismo).
- **RN-CVI-005** *(añadida en enmienda v1.2)*: `stock_sucursal.stock_minimo` nunca puede ser negativo.
- **RN-CVI-006** *(añadida en enmienda v1.3)*: Un producto con `es_fraccionable = true` solo puede tener una `unidad_venta` cuyo catálogo declare `permite_decimales = true`. Es la contraparte de RN-CVI-001: aquella obliga a tener `factor_conversion`, esta obliga a que la unidad admita el decimal que ese factor produce. Sin las dos, se puede crear un producto "fraccionable en unidades", que no significa nada y rompe la conversión de OT3.8.
- **RN-CVI-007** *(añadida en enmienda v1.3)*: Una categoría no puede ser su propia categoría padre.
- **RN-CVI-008** *(añadida en enmienda v1.3)*: La jerarquía de categorías admite dos niveles como máximo — una categoría cuyo padre ya tiene padre se rechaza. El límite es deliberado: permite agregar por categoría y subcategoría sin necesitar consultas recursivas en la capa táctica.
- **RN-CVI-009** *(añadida en enmienda v1.3)*: Ninguna fila de catálogo se borra; se da de baja con `activo = false`. Borrar una fila referenciada dejaría sin significado el snapshot histórico de las ventas ya registradas.
- **RN-CVI-010** *(añadida en enmienda v1.4, auditoría de riesgos derivados 2026-09-05)*: Asignar un producto a un anaquel con `capacidad_maxima` declarada nunca puede dejar la cantidad de productos asignados a ese anaquel por encima de su capacidad — se rechaza con `409` (reasignar el mismo producto al mismo anaquel no cuenta dos veces contra el cupo). Cubre el hueco "layout/anaquel limitado" (huecos adicionales del enunciado, #8/#18 de la auditoría previa), documentado hasta ahora como fuera de alcance explícito.
- **RN-CVI-011** *(añadida en enmienda v1.5, auditoría de riesgos derivados 2026-09-05)*: `venta.datafono_id` (FK externa hacia `datafono`, `007-pagos-seguridad`) nunca se indica si `metodo_pago = 'efectivo'` (CHECK de base de datos). Para `tarjeta`/`electronico`, es obligatorio cuando la sucursal del turno tiene al menos un datáfono activo registrado — si la sucursal aún no tiene ninguno cargado, se permite omitirlo para no bloquear su operación. El datáfono indicado debe pertenecer a la sucursal del turno y estar activo. Cierra el último de los cinco riesgos de segundo orden de la auditoría: antes de esta regla, una venta con tarjeta no dejaba ningún rastro de qué terminal físico la cobró, así que no había forma de cruzarla contra el historial de revisiones de seguridad de ese datáfono ante una disputa o un fraude.

## Caso límite adicional (enmienda v1.1)

- **¿Qué pasa si** `hora_inicio_cobro` llega vacía en una venta? → Se acepta igual (es opcional): esa venta simplemente no aporta dato a la métrica de tiempo de cobro de OT2.2, no bloquea el registro de la venta.

## Caso límite adicional (enmienda v1.2)

- **¿Qué pasa si** un producto/sucursal nunca tuvo `stock_minimo` definido? → Se asume `0` por defecto (RF-CVI-021), lo que significa que nunca aparecerá en la alerta de stock bajo hasta que alguien defina un umbral real — no se inventa un valor.

## Caso límite adicional (enmienda v1.3)

- **¿Qué pasa si** se intenta dar de baja una categoría que todavía tiene productos activos? → Se rechaza con `409`. Dar de baja la categoría dejaría a esos productos apuntando a un catálogo inactivo y los sacaría silenciosamente de los informes por categoría. Primero se reasignan los productos, después se da de baja la categoría.
- **¿Qué pasa si** una categoría marcada `es_perecedero = true` recibe un producto que no lo es (leche en polvo dentro de Lácteos)? → Se permite: `categoria.es_perecedero` es solo el valor que se precarga al crear el producto, y `producto.es_perecedero` manda. La categoría orienta, no impone.
- **¿Qué pasa si** el catálogo `metodo_pago` gana un método nuevo (p. ej. transferencia) después de que ya hay ventas registradas? → Se inserta la fila nueva y las ventas anteriores no se tocan. Es exactamente la ventaja de haber sacado el vocabulario del CHECK: agregar un método deja de ser una migración de esquema.

## Entidades Clave

- **Categoria, UnidadMedida, MetodoPago, EstadoPago, EstadoVenta** *(enmienda v1.3)*: catálogos maestros de este módulo. `Categoria` es jerárquica (dos niveles); `UnidadMedida` declara si la unidad admite decimales; `MetodoPago` declara si es electrónico (KPI de OT2.2); `EstadoVenta` declara si la venta cuenta para ingresos (base de OT1.1 y OT1.4).
- **Producto, StockSucursal (con `stock_minimo`, enmienda v1.2), LoteProducto, AjusteInventario, ProductoSustituto**: catálogo y stock (antes módulo Inventario y Caducidad).
- **Venta (con `numero_documento`, enmienda v1.2; `datafono_id`, enmienda v1.5), DetalleVenta**: transacción de venta (antes módulo Ventas y Caja), con `turno_caja_id` como FK externa hacia `006-caja-mermas-fraude` y `datafono_id` como FK externa (opcional) hacia `007-pagos-seguridad`.

## Checklist de revisión

- [ ] Todo RF tiene un endpoint correspondiente en `contracts/core-ventas-inventario.openapi.yaml`
- [ ] `venta` nunca escribe ni modifica `turno_caja` (RNF-CVI-003)
- [ ] RN-CVI-001 y RN-CVI-002 son CHECK de base de datos, no solo validación de aplicación
- [ ] Los 5 casos límite están cubiertos por al menos un test de contrato en `tasks.md`
- [ ] `producto_sustituto` nunca permite `producto_id = producto_sustituto_id` (RN-CVI-004)
- [ ] Toda venta expone `numero_documento` en la respuesta, nunca solo el `id` interno (RF-CVI-020, enmienda v1.2)
- [ ] `stock_minimo` nunca es negativo (RN-CVI-005, enmienda v1.2)
- [ ] Ningún endpoint acepta la categoría ni la unidad como texto libre (RF-CVI-023, RF-CVI-025, enmienda v1.3)
- [ ] Un producto fraccionable con unidad que no admite decimales se rechaza (RN-CVI-006, enmienda v1.3)
- [ ] Ningún catálogo expone `DELETE` (RN-CVI-009, enmienda v1.3)
- [ ] Una venta en efectivo con `datafono_id` se rechaza con `422` (RN-CVI-011, enmienda v1.5) — verificado
- [ ] Una venta con tarjeta/electrónico sin `datafono_id`, en una sucursal con datáfonos activos, se rechaza con `422` (RN-CVI-011) — verificado
- [ ] Una venta con tarjeta/electrónico sin `datafono_id` en una sucursal SIN ningún datáfono registrado se acepta igual — no bloquea sucursales sin terminal cargado — verificado
- [ ] Un `datafono_id` de otra sucursal, o de un datáfono dado de baja, se rechaza con `422`/`404` — verificado
- [ ] `GET /pagos/datafonos/{id}/ventas` (007) muestra, para cada venta, el estado de revisión VIGENTE EN LA FECHA DE ESA VENTA, no el estado actual del datáfono — verificado con una venta antes y otra después de registrar una revisión
