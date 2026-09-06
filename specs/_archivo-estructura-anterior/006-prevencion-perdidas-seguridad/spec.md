# Especificación de Feature: Prevención de Pérdidas y Seguridad

**Feature**: `006-prevencion-perdidas-seguridad` | **Fecha**: 2026-09-04
**Departamento**: Prevención de Pérdidas y Seguridad (abreviatura `PP`)
**Deriva de**: OT1.2 (reducir pérdidas por mermas), OT3.4 (diferenciar y registrar la causa de cada merma), OT4.4 (fortalecer la seguridad de pagos electrónicos)

## Resumen

Este módulo gestiona el ciclo de vida completo de una merma (detección → causa → resultado de investigación), la revisión de seguridad de los datáfonos de cada sucursal, y dos flujos que cruzan naturalmente con Ventas y Caja: las incidencias de posible fraude interno que detecta el modelo de anomalías sobre los cuadres de caja, y la atención de las alertas de fraude en pagos con tarjeta que Ventas y Caja registra en el momento de la venta. El enunciado exige distinguir explícitamente robo externo, error humano y fraude interno como causas separadas de merma — este módulo es quien impone esa distinción.

## Escenarios de Usuario

### Historia principal

Como Encargado de Prevención de Pérdidas, cuando se detecta una merma quiero registrarla de inmediato aunque todavía no sepa la causa, investigar después y clasificarla correctamente (robo externo, error humano, fraude interno o caducidad), y cuando el sistema me señale un cuadre de caja con un patrón anómalo o una alerta de pago sospechoso, quiero poder atenderla sin que eso reabra o modifique los registros originales de Ventas y Caja.

### Escenarios de aceptación

1. **Dado** una merma detectada, **cuando** la registro sin conocer todavía la causa, **entonces** el sistema la acepta con `causa = null`, en estado pendiente de clasificar.
2. **Dado** una merma ya registrada, **cuando** le asigno una causa (robo externo, error humano, fraude interno o caducidad), **entonces** queda disponible para consultarse por causa (OT3.4).
3. **Dado** una merma con causa ya asignada, **cuando** registro el resultado de su investigación (confirmada o descartada), **entonces** el sistema lo acepta; si intento registrar un resultado sin causa asignada, lo rechaza.
4. **Dado** un turno de caja cerrado con una diferencia registrada en Ventas y Caja, **cuando** el modelo de detección de anomalías (Isolation Forest) lo marca como posible fraude interno, **entonces** el sistema crea una incidencia en una tabla propia de este módulo, sin modificar el `turno_caja` original.
5. **Dado** un datáfono de una sucursal, **cuando** registro su revisión de seguridad, **entonces** queda un historial completo, y el estado "vigente" del datáfono es siempre el de la revisión más reciente.
6. **Dado** una alerta de fraude en un pago con tarjeta ya registrada por Ventas y Caja en el momento de la venta, **cuando** la atiendo, **entonces** el sistema la marca `atendida` — es la única escritura que este módulo hace sobre una tabla de otro módulo, documentada explícitamente en `research.md`.

### Casos límite (qué pasa si...)

- **¿Qué pasa si** se intenta registrar el resultado de investigación de una merma sin causa asignada? → Rechazado con `422` (RN-PP-001) — la secuencia detección → causa → resultado es obligatoria.
- **¿Qué pasa si** se intenta atender una alerta de fraude en pago que ya estaba `atendida`? → Rechazado con `422` (RN-PP-002).
- **¿Qué pasa si** el modelo de anomalías marca el mismo turno de caja dos veces antes de que la primera incidencia se atienda? → No se permite: solo puede existir una incidencia `pendiente` por `turno_caja_id` a la vez.
- **¿Qué pasa si** se consulta el estado de un datáfono que nunca tuvo una revisión registrada? → El sistema declara explícitamente que no hay revisión registrada, nunca asume "actualizado" por defecto.
- **¿Qué pasa si** se registra una merma con cantidad o valor estimado en cero? → Rechazado — una merma siempre representa una pérdida real, no puede registrarse en cero.

## Requisitos Funcionales

- **RF-PP-001**: El sistema DEBE permitir registrar una merma detectada (producto, sucursal, cantidad, valor estimado), sin exigir causa en el momento de la detección.
- **RF-PP-002**: El sistema DEBE permitir asignar la causa de una merma ya registrada (robo externo, error humano, fraude interno o caducidad).
- **RF-PP-003**: El sistema DEBE permitir consultar el listado de mermas filtrado por sucursal, periodo y causa.
- **RF-PP-004**: El sistema DEBE permitir consultar las diferencias de cuadre de caja registradas por sucursal/cajero, en modo solo lectura sobre `turno_caja` de Ventas y Caja.
- **RF-PP-005**: El modelo de detección de anomalías (Isolation Forest, Sistema) DEBE poder registrar una incidencia sobre un turno de caja cuando su patrón resulte anómalo, sin modificar el turno de caja original.
- **RF-PP-006**: El sistema DEBE permitir registrar la revisión de seguridad de un datáfono, con su resultado (`actualizado`/`vencido`).
- **RF-PP-007**: El sistema DEBE permitir atender (marcar como resuelta) una alerta de posible fraude en un pago con tarjeta, registrada originalmente por Ventas y Caja.
- **RF-PP-008**: El sistema DEBE permitir registrar el resultado de una investigación de merma (confirmada/descartada), solo si ya tiene causa asignada.
- **RF-PP-009**: El sistema DEBE declarar explícitamente cuando un datáfono no tiene ninguna revisión registrada, nunca asumir un estado por defecto.

## Requisitos No Funcionales

- **RNF-PP-001**: `incidencia_cuadre_caja` es append-only y nunca modifica `turno_caja` de Ventas y Caja (RF-PP-005).
- **RNF-PP-002**: `revision_datafono` mantiene historial completo; el estado vigente de un datáfono se deriva de la revisión más reciente, nunca se sobreescribe.

## Reglas de Negocio

- **RN-PP-001**: Una merma no puede recibir resultado de investigación sin tener causa asignada primero (secuencia obligatoria detección → causa → resultado).
- **RN-PP-002**: Una alerta de fraude en pago solo puede atenderse una vez; no puede volver a atenderse una ya `atendida`.

## Entidades Clave

- **Merma**: producto, sucursal, cantidad, valor estimado, causa (asignable después), resultado de investigación (solo si tiene causa).
- **IncidenciaCuadreCaja**: resultado del modelo de detección de anomalías sobre un turno de caja de Ventas y Caja, sin modificarlo.
- **Datafono**: catálogo de terminales de pago por sucursal.
- **RevisionDatafono**: historial de revisiones de seguridad de cada datáfono.
- **AlertaFraudePago** (propiedad de `001-ventas-y-caja`): este módulo solo ejecuta el `UPDATE` de atención sobre ella — excepción documentada en `research.md`.

## Checklist de revisión

- [ ] Todo RF tiene un endpoint correspondiente en `contracts/prevencion-perdidas-seguridad.openapi.yaml`
- [ ] RN-PP-001 está implementado como validación de servicio antes de aceptar un resultado de investigación
- [ ] `incidencia_cuadre_caja` nunca modifica `turno_caja` (RNF-PP-001)
- [ ] La única escritura de este módulo sobre una tabla de otro módulo (`alerta_fraude_pago`) está documentada explícitamente, no es una excepción silenciosa
- [ ] Los 5 casos límite están cubiertos por al menos un test de contrato en `tasks.md`
