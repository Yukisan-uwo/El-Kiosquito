# Especificación de Feature: Fidelización y Clientes

**Feature**: `005-fidelizacion-clientes` | **Fecha**: 2026-09-04
**Departamento**: Fidelización y Clientes (abreviatura `FC`)
**Deriva de**: OT1.4 (aumentar ticket y frecuencia vía fidelización personalizada), OT2.3 (personalizar promociones según el valor real del cliente), OT2.5 (recuperar clientes en riesgo real de abandono sin descuentos innecesarios)

## Resumen

Este módulo es dueño de la entidad `cliente` (ya referenciada como FK opcional desde `venta` en `001-ventas-y-caja`), y gestiona tres cosas que el enunciado pide explícitamente distinguir de un programa de fidelización genérico: el valor real de un cliente no es solo cuánto gasta (frecuencia y margen importan tanto como el monto), los cupones deben activarse por comportamiento y no solo por fecha de cumpleaños, y el riesgo de abandono real debe distinguirse de un ciclo normal de compra — para no gastar un descuento de recuperación en alguien que de todas formas iba a volver.

## Escenarios de Usuario

### Historia principal

Como Encargado de Fidelización, quiero identificar qué clientes son realmente valiosos (no solo los que más gastan) para personalizar cupones, y quiero que el sistema me avise solo cuando un cliente está en riesgo real de dejar de comprar — nunca a los 30 días fijos para todos, porque algunos clientes compran naturalmente cada 45 o 60 días.

### Escenarios de aceptación

1. **Dado** un cliente registrado, **cuando** consulto su historial de compras, **entonces** el sistema devuelve las ventas asociadas a su `cliente_id` (dato que vive en Ventas y Caja, este módulo solo lo consulta).
2. **Dado** un ciclo de cálculo del modelo de segmentación (K-Means, ejecutado por Analítica y Reportes), **cuando** consulto el segmento de un cliente, **entonces** el sistema devuelve el segmento más reciente junto con el tamaño de muestra y el periodo considerado (Art. 5.9 de la constitución).
3. **Dado** un cliente cuya fecha de nacimiento cae en el mes actual, **cuando** registro el envío de un cupón de cumpleaños, **entonces** queda registrado con `tipo_origen = 'cumpleanos'`.
4. **Dado** un cliente cuyo patrón de compra activa una regla del motor de fidelización, **cuando** el sistema registra el envío de un cupón, **entonces** queda registrado con `tipo_origen = 'patron_compra'`.
5. **Dado** un cupón activo y no vencido, **cuando** se canjea en una venta, **entonces** el sistema lo marca `canjeado` y lo vincula a esa venta — no puede volver a canjearse.
6. **Dado** un cliente evaluado por el modelo de churn como en riesgo real de abandono, **cuando** se registra el envío de una campaña de recuperación, **entonces** el sistema primero valida que el cliente no haya vuelto a comprar desde la evaluación — si ya compró, rechaza el envío.
7. **Dado** una campaña de recuperación enviada, **cuando** consulto si el cliente recuperó actividad, **entonces** el sistema responde si hubo una compra posterior a la fecha de envío.

### Casos límite (qué pasa si...)

- **¿Qué pasa si** un cliente nunca ha comprado (o tiene muy pocas compras)? → No se le calcula segmento ni evaluación de riesgo de abandono en ese ciclo — la consulta responde explícitamente que no hay datos suficientes, nunca un segmento o riesgo asumido por defecto.
- **¿Qué pasa si** se intenta canjear un cupón ya canjeado? → Rechazado con `422`; el estado `canjeado` es definitivo.
- **¿Qué pasa si** se intenta canjear un cupón después de su fecha de expiración? → Rechazado con `422`, sin importar que nunca se haya usado.
- **¿Qué pasa si** un cliente marcado en riesgo de abandono compra por su cuenta antes de que se le envíe la campaña de recuperación? → El sistema rechaza el envío de la campaña (RN-FC-002) — enviar un descuento a alguien que ya volvió por su cuenta es exactamente el desperdicio que el enunciado pide evitar.
- **¿Qué pasa si** el modelo de churn evalúa a un cliente con 45 días sin comprar pero su frecuencia histórica normal es cada 60 días? → No se marca en riesgo real (esta decisión la toma el modelo de Analítica, este módulo solo almacena y expone el resultado con su justificación, nunca aplica un umbral fijo de días propio).

## Requisitos Funcionales

- **RF-FC-001**: El sistema DEBE permitir registrar un cliente (nombre, contacto, fecha de nacimiento).
- **RF-FC-002**: El sistema DEBE permitir consultar el historial de compras de un cliente, en modo solo lectura sobre los datos de Ventas y Caja.
- **RF-FC-003**: El sistema DEBE exponer el segmento de valor más reciente calculado para un cliente, junto con el tamaño de muestra y el periodo considerado; si nunca se calculó, DEBE declararlo explícitamente.
- **RF-FC-004**: El sistema DEBE permitir registrar el envío de un cupón, indicando su origen (`cumpleanos`, `patron_compra` o `recuperacion_churn`).
- **RF-FC-005**: El sistema DEBE permitir registrar el canje de un cupón en una venta, validando que no esté vencido ni ya canjeado.
- **RF-FC-006**: El sistema DEBE exponer la evaluación de riesgo de abandono más reciente de un cliente, con su justificación y el periodo evaluado.
- **RF-FC-007**: Antes de registrar el envío de una campaña de recuperación, el sistema DEBE validar que el cliente no haya vuelto a comprar desde su última evaluación de riesgo — si ya compró, DEBE rechazar el envío.
- **RF-FC-008**: El sistema DEBE permitir consultar si un cliente recuperó actividad (nueva compra) después de recibir una campaña de recuperación.
- **RF-FC-009**: Ningún cliente sin historial de compras suficiente DEBE recibir un segmento o una evaluación de riesgo calculados en un ciclo dado — la ausencia de datos se declara explícitamente, nunca se asume un valor por defecto.

## Requisitos No Funcionales

- **RNF-FC-001**: `segmento_cliente` y `evaluacion_churn` son append-only; cada fila declara su tamaño de muestra y periodo (Art. 5.9, regla de honestidad de los modelos).
- **RNF-FC-002**: Este módulo nunca escribe en `venta` ni `detalle_venta` (propiedad de Ventas y Caja) — el historial de compras y la validación de recuperación de actividad son siempre consultas de solo lectura.

## Reglas de Negocio

- **RN-FC-001**: Un cupón no puede canjearse más de una vez ni después de su fecha de expiración.
- **RN-FC-002**: No se puede registrar el envío de una campaña de recuperación para un cliente que ya volvió a comprar desde su última evaluación de riesgo de abandono.

## Entidades Clave

- **Cliente**: nombre, contacto, fecha de nacimiento — ya referenciado por `venta.cliente_id` en Ventas y Caja.
- **SegmentoCliente**: resultado histórico (append-only) del modelo de segmentación K-Means, con tamaño de muestra y periodo.
- **EvaluacionChurn**: resultado histórico (append-only) del modelo de riesgo de abandono, con su justificación.
- **Cupon**: cupón enviado a un cliente, con su origen, vigencia y estado de canje.
- **CampanaRecuperacion**: envío de una campaña de recuperación vinculado a la evaluación de riesgo que la originó.

## Checklist de revisión

- [ ] Todo RF tiene un endpoint correspondiente en `contracts/fidelizacion-clientes.openapi.yaml`
- [ ] Ninguna consulta de segmento o riesgo de abandono devuelve un valor calculado sin datos suficientes (RF-FC-009, Art. 5.9)
- [ ] RN-FC-002 está implementado como validación de servicio antes del `INSERT` de la campaña, no solo documentado
- [ ] Los 4 casos límite están cubiertos por al menos un test de contrato en `tasks.md`
