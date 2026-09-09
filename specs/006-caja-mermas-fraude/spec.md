# Especificación de Feature: Caja, Mermas y Fraude

**Feature**: `006-caja-mermas-fraude` | **Fecha**: 2026-09-04
**Departamentos que aportan**: Ventas y Caja (`turno_caja`, `alerta_fraude_pago`) + Prevención de Pérdidas y Seguridad (`merma`, `incidencia_cuadre_caja`)
**Deriva de**: OT2.2 (agilidad del cobro y control de caja), OT3.4 (diferenciar y registrar la causa de cada merma), OT4.4 (fortalecer la seguridad de pagos electrónicos)

## Resumen

Este es un módulo nuevo bajo la estructura mínima obligatoria que junta piezas de dos departamentos distintos del diseño original: el control de caja por turno y las alertas de fraude en pago (antes en Ventas y Caja) se combinan con las mermas y las incidencias de cuadre detectadas por el modelo de anomalías (antes en Prevención de Pérdidas). La agrupación tiene sentido de negocio: todo lo que aquí se registra es una posible pérdida de dinero o mercadería que necesita investigarse — ya sea una diferencia de caja, un producto perdido, o un pago sospechoso — y el mismo encargado suele revisarlas juntas. Es dueño de cuatro tablas: `turno_caja`, `alerta_fraude_pago`, `merma` e `incidencia_cuadre_caja`.

## Escenarios de Usuario

### Historia principal

Como Cajero, quiero abrir y cerrar mi turno de caja sin calcular la diferencia a mano. Como Encargado de Prevención de Pérdidas, quiero registrar una merma apenas la detecto aunque no sepa la causa todavía, investigarla después, y que el sistema me señale automáticamente cuadres de caja con patrones anómalos o alertas de pago sospechosas — sin que atenderlas reabra o modifique los registros contables originales.

### Escenarios de aceptación

1. **Dado** que el cajero abre su turno con un monto inicial, **cuando** llega el cierre, **entonces** el sistema registra el monto contado y calcula automáticamente la diferencia contra lo esperado (ventas en efectivo de ese turno, consultadas por FK hacia `001-core-ventas-inventario`).
2. **Dado** que el cuadre de un turno arroja una diferencia distinta de cero, **cuando** se registra, **entonces** el sistema exige un motivo antes de cerrar el cuadre; si no hay causa conocida, se registra explícitamente "sin causa identificada", nunca se deja vacío.
3. **Dado** una merma detectada, **cuando** se registra sin conocer todavía la causa, **entonces** el sistema la acepta con `causa = null`, en estado pendiente de clasificar.
4. **Dado** una merma con causa ya asignada, **cuando** se registra el resultado de su investigación, **entonces** el sistema lo acepta; si se intenta registrar un resultado sin causa asignada, lo rechaza.
5. **Dado** un pago con tarjeta que resulta sospechoso durante una venta (`001-core-ventas-inventario`), **cuando** se detecta, **entonces** este módulo registra la alerta de fraude sin bloquear ni revertir la venta legítima que sí se completó.
6. **Dado** un turno de caja con un patrón anómalo detectado por el modelo de Isolation Forest, **cuando** el modelo registra la incidencia, **entonces** el turno de caja original permanece intacto — la incidencia vive en su propia tabla.

### Casos límite (qué pasa si...)

- **¿Qué pasa si** se intenta registrar el resultado de investigación de una merma sin causa asignada? → Rechazado con `422` (RN-CMF-003) — la secuencia detección → causa → resultado es obligatoria.
- **¿Qué pasa si** se intenta atender una alerta de fraude en pago que ya estaba `atendida`? → Rechazado con `422` (RN-CMF-004).
- **¿Qué pasa si** dos cajeros distintos intentan abrir turno con la misma sucursal el mismo día? → Se permite: cada apertura es un registro independiente por cajero, el cuadre siempre es por turno, nunca por caja física ni por día completo.
- **¿Qué pasa si** se anula una venta después de que su turno de caja ya cerró? → El cuadre cerrado es inmutable; el ajuste, si aplica, se refleja en el turno vigente al momento de la anulación, nunca reabriendo un cuadre ya cerrado (Art. 10.5).
- **¿Qué pasa si** se registra una merma con cantidad o valor estimado en cero? → Rechazado — una merma siempre representa una pérdida real.

## Requisitos Funcionales

- **RF-CMF-001**: El sistema DEBE permitir abrir un turno de caja con un monto inicial declarado.
- **RF-CMF-002**: El sistema DEBE permitir cerrar un turno de caja registrando el monto contado, calculando automáticamente la diferencia contra el monto esperado.
- **RF-CMF-003**: El sistema DEBE exigir un motivo al registrar cualquier diferencia de cuadre de caja distinta de cero.
- **RF-CMF-004**: El sistema NUNCA debe permitir cerrar un turno de caja sin un monto contado explícito.
- **RF-CMF-005**: El sistema DEBE permitir registrar una merma detectada (producto, sucursal, cantidad, valor estimado), sin exigir causa en el momento de la detección.
- **RF-CMF-006**: El sistema DEBE permitir asignar la causa de una merma ya registrada (robo externo, error humano, fraude interno o caducidad).
- **RF-CMF-007**: El sistema DEBE permitir consultar el listado de mermas filtrado por sucursal, periodo y causa.
- **RF-CMF-008**: El sistema DEBE permitir registrar el resultado de una investigación de merma (confirmada/descartada), solo si ya tiene causa asignada.
- **RF-CMF-009**: El modelo de detección de anomalías (Isolation Forest, Sistema) DEBE poder registrar una incidencia sobre un turno de caja cuando su patrón resulte anómalo, sin modificar el turno de caja original.
- **RF-CMF-010**: El sistema DEBE permitir registrar una alerta de posible fraude en un pago con tarjeta, generada desde `001-core-ventas-inventario` al momento de la venta, sin revertir la venta legítima asociada.
- **RF-CMF-011**: El sistema DEBE permitir atender (marcar como resuelta) una alerta de posible fraude en un pago con tarjeta.
- **RF-CMF-012** *(añadido en enmienda v1.1, auditoría enunciado-vs-specs)*: El sistema DEBE generar automáticamente, cada hora, un punto de control con el monto esperado acumulado de cada turno de caja que siga abierto, agregando únicamente ventas ya registradas — sin pedirle ninguna acción al cajero.
- **RF-CMF-013** *(añadido en enmienda v1.1)*: El sistema DEBE permitir consultar el historial de puntos de control de un turno de caja, ordenados cronológicamente, como insumo del modelo de detección de anomalías (RF-CMF-009) para dar granularidad intra-turno, no solo al cierre.
- **RF-CMF-014** *(añadido en enmienda v1.2, normalización de catálogos)*: La causa de una merma, el resultado de su investigación y los estados de turno, alerta e incidencia DEBEN seleccionarse de sus catálogos, nunca quedar como valores fijos en el contrato de la API.
- **RF-CMF-015** *(añadido en enmienda v1.2)*: El catálogo de causas de merma DEBE declarar, por causa, si es **atribuible a una persona** — es lo que permite separar la pérdida por robo externo o caducidad (sin responsable interno) de la causada por error humano o fraude interno, que es la base del cruce merma × cuadre de caja de OT3.4.
- **RF-CMF-016** *(añadido en enmienda v1.2)*: El sistema DEBE permitir consultar el listado de mermas filtrado por si la causa es atribuible a una persona, sin que el consumidor tenga que enumerar los códigos de causa.
- **RF-CMF-017** *(añadido en enmienda v1.2)*: El sistema DEBE exponer los cinco catálogos de este módulo como consulta.
- **RF-CMF-018** *(añadido en enmienda v1.4, calculadora de efectivo y vuelto en POS)*: Al seleccionar el método de pago en efectivo en el punto de venta, la interfaz DEBE ofrecer una calculadora interactiva de efectivo con botones rápidos de denominaciones ($5, $10, $20, $50, Exacto) y cálculo automático del vuelto exacto a entregar al cliente.

## Requisitos No Funcionales

- **RNF-CMF-001**: Todo cierre de turno de caja es un registro append-only una vez confirmado — no se edita, solo se referencia desde una anulación posterior (Art. 10.5).
- **RNF-CMF-002**: `incidencia_cuadre_caja` es append-only y nunca modifica `turno_caja`, aunque ambas tablas vivan en este mismo módulo.
- **RNF-CMF-003**: `alerta_fraude_pago` nunca almacena el número completo de una tarjeta, solo los últimos 4 dígitos (Art. 10.8).

## Reglas de Negocio

- **RN-CMF-001**: Un cajero no puede tener dos turnos de caja abiertos a la vez.
- **RN-CMF-002**: Toda diferencia de caja distinta de cero DEBE quedar con un motivo registrado antes de considerarse cerrada, aunque el motivo sea "sin causa identificada".
- **RN-CMF-003**: Una merma no puede recibir resultado de investigación sin tener causa asignada primero.
- **RN-CMF-004**: Una alerta de fraude en pago solo puede atenderse una vez; no puede volver a atenderse una ya `atendida`.
- **RN-CMF-005**: Nunca puede haber más de una incidencia de cuadre en estado `pendiente` para el mismo turno de caja.
- **RN-CMF-006** *(enmienda v1.1)*: Los puntos de control horario son de generación exclusivamente automática — ningún endpoint permite crearlos ni editarlos manualmente, ni siquiera por Gerencia.
- **RN-CMF-007** *(añadida en enmienda v1.2)*: Ninguna consulta ni informe puede determinar si una merma es atribuible a una persona enumerando códigos de causa a mano; DEBE leerse de `causa_merma.es_atribuible_a_persona`. Una lista escrita a mano se puede quedar corta al agregarse una causa nueva, y el efecto de ese olvido es que un fraude interno se contabilice como pérdida no atribuible — exactamente el error que OT3.4 existe para evitar.
- **RN-CMF-008** *(añadida en enmienda v1.2)*: Ninguna fila de catálogo se borra; baja lógica con `activo = false`. Las mermas históricas deben conservar el significado de su causa.
- **RN-CMF-009** *(añadida en enmienda v1.3, auditoría de riesgos derivados 2026-09-05)*: Un arqueo parcial de turno (`arqueo_parcial_turno`) solo puede registrarse contra un turno `abierto`, y si `monto_contado` no coincide con el monto esperado acumulado en ese instante, `motivo_diferencia` es obligatorio (mismo criterio que RN-CMF-002 al cierre). A diferencia de `punto_control_horario_turno` (RN-CMF-006, exclusivamente automático, sin conteo físico), el arqueo parcial es un conteo real y voluntario — nunca un job obligatorio — que un cajero o un encargado de sucursal puede registrar en cualquier momento del turno. Cierra el gap de "cuadre de caja horario real": antes de esta enmienda, un fraude revertido antes del cierre del turno era invisible incluso con los checkpoints automáticos, porque estos nunca comparan contra efectivo contado de verdad.
- **RN-CMF-010** *(añadida en enmienda v1.4)*: El sistema DEBE impedir concretar una venta en efectivo si el monto ingresado como entregado por el cliente es insuficiente para cubrir el total a cobrar, deshabilitando el botón de cobro hasta que se registre un importe igual o superior al total.

## Caso límite adicional (enmienda v1.1)

- **¿Qué pasa si** un turno de caja cierra entre dos generaciones automáticas de punto de control? → No pasa nada especial: el punto de control es solo un insumo adicional para el modelo, el cuadre real sigue calculándose al cierre (RF-CMF-002) con las ventas completas del turno, no con el último checkpoint.

## Caso límite adicional (enmienda v1.2)

- **¿Qué pasa si** el negocio necesita distinguir una causa de merma nueva (por ejemplo "rotura en bodega")? → Se inserta en `causa_merma` con su `es_atribuible_a_persona` decidido explícitamente, sin ninguna migración de esquema, y todos los informes de OT3.4 la clasifican correctamente desde el primer registro. Antes de esta enmienda había que modificar el CHECK **y** revisar cada consulta que enumerara causas a mano.
- **¿Qué pasa si** una merma ya registrada tiene una causa que después se da de baja? → La merma conserva su causa y su clasificación. Los catálogos solo se dan de baja lógicamente (RN-CMF-008), nunca se borran.

## Entidades Clave

- **CausaMerma, ResultadoInvestigacion, EstadoTurno, EstadoAlerta, EstadoIncidencia** *(enmienda v1.2)*: catálogos maestros. `CausaMerma` declara `es_atribuible_a_persona` (la base del cruce de OT3.4) y `requiere_investigacion`; `EstadoTurno` declara `admite_ventas`. `EstadoAlerta` y `EstadoIncidencia` se mantienen separados aunque hoy sus valores coincidan: son procesos distintos y no deben compartir vocabulario.
- **TurnoCaja**: sucursal, cajero, apertura, monto inicial, cierre, monto contado, monto esperado (calculado), diferencia (calculada), motivo de diferencia.
- **AlertaFraudePago**: venta asociada (externa, `001-core-ventas-inventario`), motivo, estado, últimos 4 dígitos, sucursal.
- **Merma**: producto (externo, `001-core-ventas-inventario`), sucursal, cantidad, valor estimado, causa (asignable después), resultado de investigación (solo si tiene causa).
- **IncidenciaCuadreCaja**: resultado del modelo de detección de anomalías sobre un turno de caja propio de este módulo, sin modificarlo.
- **PuntoControlHorarioTurno** *(enmienda v1.1)*: snapshot automático por hora del monto esperado acumulado de un turno abierto, generado por el sistema sin intervención del cajero.

## Checklist de revisión

- [ ] Todo RF tiene un endpoint correspondiente en `contracts/caja-mermas-fraude.openapi.yaml`
- [ ] RN-CMF-001 y RN-CMF-005 están implementados como índices únicos parciales, no solo como validación de servicio
- [ ] `incidencia_cuadre_caja` nunca modifica `turno_caja` (RNF-CMF-002)
- [ ] Los 5 casos límite (más el de enmienda v1.1) están cubiertos por al menos un test de contrato en `tasks.md`
- [ ] Los puntos de control horario nunca requieren una acción del cajero y no tienen ningún endpoint de creación manual (RN-CMF-006, enmienda v1.1)
- [ ] Ninguna consulta enumera códigos de causa a mano para saber si una merma es atribuible (RN-CMF-007, enmienda v1.2)
- [ ] Los cinco catálogos son consultables y ninguno expone `DELETE` (RF-CMF-017, RN-CMF-008, enmienda v1.2)
