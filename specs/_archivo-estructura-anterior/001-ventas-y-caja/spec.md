# Especificación de Funcionalidad: Ventas y Caja

**Feature**: `001-ventas-y-caja`
**Creado**: 2026-09-04
**Estado**: Borrador — pendiente de revisión
**Entrada**: Objetivos Tácticos OT2.2, OT3.1, OT3.7, OT3.8, OT4.4 (ver `ElKiosquito_Documento_Empresa_y_Objetivos.md`)

## Resumen

El módulo de Ventas y Caja es la base transaccional de El Kiosquito: registra cada venta en el punto de venta de una sucursal, calcula el cobro (incluyendo ventas fraccionadas), procesa el pago (efectivo o electrónico), y sostiene el cuadre de caja horario que permite detectar diferencias entre lo cobrado y lo registrado. A diferencia de un POS genérico, este módulo captura dos señales que casi nunca se registran en un kiosko real: la **demanda insatisfecha** (cuando un cliente pide un producto que no hay) y la **causa de cada diferencia de caja**, porque ambas alimentan directamente los modelos de pronóstico de demanda y de detección de anomalías de fraude interno del módulo de Analítica.

## Escenarios de Usuario y Pruebas

### Historia de usuario principal

Como **Cajero/Vendedor** de una sucursal de El Kiosquito, necesito registrar cada venta —incluyendo productos fraccionados— con el método de pago del cliente, para que el sistema calcule el cobro correcto, descuente el inventario en la unidad correcta, y quede disponible para el cuadre de caja de mi turno.

### Escenarios de aceptación

1. **Dado** que el cajero tiene una venta en curso con productos por unidad completa, **cuando** confirma el pago en efectivo, **entonces** el sistema registra la venta (OO-VC01), el método de pago (OO-VC02), descuenta el stock de cada producto y calcula el IVA (15%, Art. 4.1 de la constitución) sobre el total.

2. **Dado** que un cliente compra un producto que se vende suelto (ej. una unidad de un paquete de 6), **cuando** el cajero registra la venta fraccionada, **entonces** el sistema convierte automáticamente la cantidad vendida a la unidad de inventario (OO-VC05, OT3.8) sin que el cajero tenga que calcular la conversión a mano.

3. **Dado** que un cliente pregunta por un producto que no tiene stock disponible, **cuando** el cajero registra el evento en el punto de venta, **entonces** el sistema guarda la demanda insatisfecha (OO-VC09, OT3.7) con el producto, la sucursal y la hora, sin necesidad de que exista una venta asociada.

4. **Dado** que el cajero abre su turno con un monto inicial de caja, **cuando** llega el cierre de la hora/turno, **entonces** el sistema registra el monto contado (OO-VC07) y calcula automáticamente la diferencia contra lo esperado (ventas registradas en efectivo del periodo) — el cajero nunca calcula la diferencia a mano.

5. **Dado** que el cuadre de caja de un turno arroja una diferencia, **cuando** el cajero o el Encargado de Sucursal la registra, **entonces** el sistema exige un motivo (OO-VC08) antes de cerrar el cuadre; si no hay motivo conocido, se registra explícitamente como "diferencia sin causa identificada" para que Prevención de Pérdidas la investigue (OT3.4), nunca se deja el campo vacío.

6. **Dado** que un pago con tarjeta resulta sospechoso (ej. múltiples intentos, monto inusual para el perfil de la sucursal), **cuando** el sistema o el cajero lo detecta, **entonces** se registra una alerta de posible fraude (OO-VC10, OT4.4) sin bloquear la venta legítima que sí se completó.

### Casos límite ("qué pasa si")

- **¿Qué pasa si se necesita anular una venta después de que la caja de ese turno ya cerró?** La venta se anula (OO-VC04) con motivo obligatorio, pero el ajuste de caja correspondiente se registra en el turno ACTUAL, nunca reabriendo un cuadre ya cerrado — un cuadre cerrado es inmutable (Art. 4.2/OT3.4, coherente con la auditoría inmutable del Art. 10.5).
- **¿Qué pasa si el pago con tarjeta es rechazado a mitad de la transacción?** La venta no se confirma (no hay INSERT en OO-VC01) hasta que el método de pago quede en estado "aprobado" (OO-VC02); un rechazo dejaría la venta en un estado explícito "no completada", visible solo para el Cajero, nunca contada como venta ni como demanda insatisfecha (son dos eventos distintos).
- **¿Qué pasa si un producto que se vende fraccionado no tiene configurada su conversión de unidad?** El sistema DEBE impedir el registro de la venta fraccionada y señalar al cajero que el producto necesita configuración en Inventario y Caducidad antes de venderse suelto — nunca debe permitir una conversión "a ojo".
- **¿Qué pasa si dos cajeros distintos usan la misma caja física en el mismo día?** Cada apertura de turno (OO-VC06) es un registro independiente ligado a un cajero y una hora de inicio; el cuadre siempre es por turno, nunca por caja física ni por día completo — así el motivo de una diferencia siempre se puede atribuir a un cajero y un rango de horas concretos, que es precisamente el mecanismo que necesita el modelo de detección de anomalías (OT4.1).
- **¿Qué pasa si el cliente pide un producto agotado pero el cajero está ocupado y no alcanza a registrar la demanda insatisfecha en el momento?** El registro de demanda insatisfecha (OO-VC09) admite un timestamp manual distinto al de creación del registro, para que un cajero pueda registrarlo minutos después sin perder precisión horaria — la meta de OT3.7 es ≥80% de captura, no 100%, precisamente porque se acepta que no siempre se alcanza a registrar en el instante exacto.

## Requisitos

### Requisitos funcionales

- **RF-VC-001**: El sistema DEBE permitir registrar una venta con uno o más productos, cantidades y precio aplicado al momento de la venta (OO-VC01).
- **RF-VC-002**: El sistema DEBE registrar el método de pago de cada venta (efectivo, tarjeta, electrónico) y su estado (OO-VC02).
- **RF-VC-003**: El sistema DEBE permitir aplicar un descuento o cupón a una venta en curso antes de confirmarla (OO-VC03).
- **RF-VC-004**: El sistema DEBE permitir anular o corregir una venta ya registrada, exigiendo un motivo (OO-VC04).
- **RF-VC-005**: El sistema DEBE permitir registrar la venta fraccionada de un producto, convirtiendo automáticamente la unidad de venta a la unidad de inventario configurada para ese producto (OO-VC05).
- **RF-VC-006**: El sistema DEBE permitir abrir un turno de caja con un monto inicial declarado (OO-VC06).
- **RF-VC-007**: El sistema DEBE permitir cerrar un turno de caja registrando el monto contado, calculando automáticamente la diferencia contra el monto esperado (OO-VC07).
- **RF-VC-008**: El sistema DEBE exigir un motivo al registrar cualquier diferencia de cuadre de caja distinta de cero (OO-VC08).
- **RF-VC-009**: El sistema DEBE permitir registrar un evento de demanda insatisfecha (producto solicitado sin stock) de forma independiente de cualquier venta (OO-VC09).
- **RF-VC-010**: El sistema DEBE permitir registrar una alerta de posible fraude en un pago con tarjeta sin revertir la venta legítima asociada (OO-VC10).
- **RF-VC-011**: El sistema DEBE calcular el IVA (15%, parametrizable) sobre el total de cada venta.
- **RF-VC-012**: El sistema NUNCA debe permitir cerrar un turno de caja sin un monto contado explícito — no existe un "cierre automático" sin conteo humano.

### Requisitos no funcionales

- **RNF-VC-001**: El registro de una venta completa (desde el primer producto agregado hasta el pago confirmado) DEBE completarse en menos de 90 segundos en el flujo normal (meta de OT2.2).
- **RNF-VC-002**: El registro de un evento de demanda insatisfecha DEBE tomar menos de 10 segundos, para que el cajero no pierda el ritmo de atención a la fila.
- **RNF-VC-003**: Todo cierre de turno de caja es un registro append-only una vez confirmado — no se edita, solo se referencia desde una anulación posterior (Art. 10.5 de la constitución).

### Reglas de negocio

- **RN-VC-001**: Ninguna venta puede completarse con un producto fraccionado cuya conversión de unidad no esté configurada (Art. 4.7 de la constitución).
- **RN-VC-002**: Toda diferencia de caja distinta de cero DEBE quedar con un motivo registrado antes de considerarse cerrada, aunque el motivo sea "sin causa identificada" (Art. 4.2).

### Entidades clave

- **Venta**: sucursal, cajero, fecha/hora, productos (cantidad, precio aplicado, unidad), método de pago, estado, IVA calculado, total.
- **DetalleVentaFraccionado**: referencia a la venta, producto, cantidad en unidad de venta, cantidad convertida a unidad de inventario.
- **TurnoCaja**: sucursal, cajero, hora de apertura, monto inicial, hora de cierre, monto contado, monto esperado (calculado), diferencia (calculada), motivo de diferencia.
- **DemandaInsatisfecha**: sucursal, producto, hora del evento (puede diferir de la hora de registro), cajero que lo registró.
- **AlertaFraudePago**: venta asociada, motivo de la alerta, estado (abierta/atendida), sucursal.

## Checklist de revisión

- [ ] Todo RF/RNF/RN tiene código único y es trazable a un OO/OT (Art. 7.4 de la constitución)
- [ ] Ningún requisito describe un flujo de aprobación simulado (Art. 8.6)
- [ ] Los casos límite cubren los "qué pasa si" pedidos explícitamente en el proceso de trabajo
- [ ] El IVA y las reglas de negocio citan el artículo exacto de la constitución que las respalda
