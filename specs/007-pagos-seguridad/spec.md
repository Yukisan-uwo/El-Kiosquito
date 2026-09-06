# Especificación de Feature: Pagos y Seguridad

**Feature**: `007-pagos-seguridad` | **Fecha**: 2026-09-04
**Departamento que aporta**: Prevención de Pérdidas y Seguridad (`PP`)
**Deriva de**: OT4.4 (fortalecer la seguridad de pagos electrónicos)

## Resumen

Este módulo es dueño del catálogo de datáfonos de cada sucursal y de su historial de revisiones de seguridad. Se separa de `006-caja-mermas-fraude` porque responde a una pregunta distinta: mientras ese módulo investiga pérdidas ya ocurridas (mermas, cuadres anómalos, pagos sospechosos en una venta puntual), este módulo es preventivo — vigila que la infraestructura de cobro con tarjeta (el hardware, no una transacción específica) esté vigente y segura, sin que eso dependa de que ya haya pasado un incidente.

## Escenarios de Usuario

### Historia principal

Como Encargado de Prevención de Pérdidas, quiero llevar un registro de cuándo se revisó por última vez la seguridad de cada datáfono de cada sucursal, para poder detectar terminales que llevan meses sin revisión antes de que se conviertan en un punto débil.

### Escenarios de aceptación

1. **Dado** un datáfono registrado en una sucursal, **cuando** se realiza su revisión de seguridad periódica, **entonces** el sistema registra el resultado (`actualizado` o `vencido`) como una fila nueva, sin sobrescribir revisiones anteriores.
2. **Dado** un datáfono con varias revisiones registradas, **cuando** se consulta su estado, **entonces** el sistema devuelve el resultado de la revisión más reciente.
3. **Dado** un datáfono recién registrado sin ninguna revisión todavía, **cuando** se consulta su estado, **entonces** el sistema declara explícitamente que no hay revisión registrada — nunca asume `actualizado` por defecto.

### Casos límite (qué pasa si...)

- **¿Qué pasa si** un datáfono lleva varios meses sin ninguna revisión nueva? → Su estado vigente sigue siendo el de la última revisión registrada, con su fecha visible — el sistema no lo marca `vencido` automáticamente por el solo paso del tiempo, esa evaluación la hace quien revisa.
- **¿Qué pasa si** se da de baja un datáfono que ya no se usa? → Se marca `activo = false`; su historial de revisiones se conserva, nunca se elimina.
- **¿Qué pasa si** dos datáfonos de la misma sucursal tienen el mismo código de serie? → Rechazado — el código de serie es único en todo el sistema, sin importar la sucursal.

## Requisitos Funcionales

- **RF-PS-001**: El sistema DEBE permitir registrar un datáfono nuevo, asociado a una sucursal, con un código de serie único.
- **RF-PS-002**: El sistema DEBE permitir dar de baja un datáfono sin eliminar su historial de revisiones.
- **RF-PS-003**: El sistema DEBE permitir registrar la revisión de seguridad de un datáfono, con su resultado (`actualizado`/`vencido`).
- **RF-PS-004**: El sistema DEBE exponer el estado vigente de un datáfono, derivado de su revisión más reciente.
- **RF-PS-005**: El sistema DEBE declarar explícitamente cuando un datáfono no tiene ninguna revisión registrada, nunca asumir un estado por defecto.
- **RF-PS-006**: El sistema DEBE permitir consultar el listado de datáfonos de una sucursal con su estado vigente, para identificar cuáles llevan más tiempo sin revisión.
- **RF-PS-007** *(añadido en enmienda v1.1, normalización de catálogos)*: El resultado de una revisión DEBE seleccionarse del catálogo `estado_revision`, que declara por estado si cuenta como conforme para el indicador de OT4.4.
- **RF-PS-008** *(añadido en enmienda v1.1)*: El sistema DEBE exponer el indicador de conformidad de terminales de una sucursal (total, conformes, sin revisión y porcentaje), calculado a partir del catálogo y no de una lista de estados escrita en la consulta.

## Requisitos No Funcionales

- **RNF-PS-001**: `revision_datafono` es append-only; el estado vigente de un datáfono se deriva de la revisión más reciente, nunca se sobreescribe una revisión anterior.
- **RNF-PS-002**: El código de serie de un datáfono es único en todo el sistema (no solo dentro de una sucursal).

## Reglas de Negocio

- **RN-PS-001**: Un datáfono sin ninguna revisión registrada no tiene un estado vigente asumido — se declara explícitamente como "sin revisión registrada". *(Enmienda v1.1)* En el indicador de conformidad, esos datáfonos **nunca** se cuentan como conformes: un terminal sin revisar no es un terminal en regla, y contarlo como tal inflaría el KPI de OT4.4 justo en el caso más riesgoso.
- **RN-PS-002** *(añadida en enmienda v1.1)*: El numerador del indicador de conformidad DEBE leerse de `estado_revision.cuenta_como_conforme`, nunca de una comparación contra el literal `'actualizado'`. Si mañana se agrega un estado intermedio (`'en_revision'` mientras el proveedor certifica), esa decisión se toma una vez al insertar la fila del catálogo, no revisando cada consulta del sistema.
- **RN-PS-003** *(añadida en enmienda v1.1)*: Ninguna fila de `estado_revision` se borra; baja lógica con `activo = false`. Las revisiones históricas deben conservar su significado.
- **RN-PS-004** *(añadida en enmienda v1.2, auditoría de riesgos derivados 2026-09-05)*: `GET /pagos/datafonos/{id}/ventas` (trazabilidad venta↔datáfono, apoyada en `venta.datafono_id` de `001-core-ventas-inventario`, enmienda v1.5) siempre reporta el estado de revisión **vigente en la fecha de esa venta**, nunca el estado actual del datáfono — evaluar una venta pasada contra el estado de hoy daría una respuesta que no corresponde al momento del hecho.

## Caso límite adicional (enmienda v1.1)

- **¿Qué pasa si** en el futuro se necesita un estado intermedio, por ejemplo `'en_revision'` mientras el proveedor certifica el terminal? → Se inserta en `estado_revision` con `cuenta_como_conforme = false` decidido explícitamente, y el indicador de OT4.4 lo trata bien desde el primer registro. Antes de esta enmienda había que modificar el CHECK y revisar cada consulta que comparara contra `'actualizado'`.
- **¿Qué pasa si** una sucursal tiene datáfonos sin ninguna revisión registrada? → Aparecen en `terminales_sin_revision` y **no** suman al numerador (RN-PS-001). Contarlos como conformes inflaría el KPI justo en el caso más riesgoso: un terminal que nadie ha verificado nunca.
- **¿Qué pasa si** *(enmienda v1.2)* se consulta `GET /pagos/datafonos/{id}/ventas` para una venta que ocurrió antes de la primera revisión registrada de ese datáfono? → Esa venta se reporta con `sin_revision_al_momento = true`, igual que un datáfono sin revisión hoy (RN-PS-001) — nunca se le atribuye retroactivamente una revisión posterior.

## Entidades Clave

- **EstadoRevision** *(enmienda v1.1)*: catálogo de resultados de revisión, con `cuenta_como_conforme` — el numerador del KPI de OT4.4 deja de estar repetido como filtro en cada consulta.
- **Datafono**: catálogo de terminales de pago por sucursal.
- **RevisionDatafono**: historial append-only de revisiones de seguridad de cada datáfono.
- *(Enmienda v1.2)* Este módulo también expone, sin poseerla, `venta` (`001-core-ventas-inventario`) para el reporte de trazabilidad — lectura cruzada de solo lectura, nunca escritura.

## Checklist de revisión

- [ ] Todo RF tiene un endpoint correspondiente en `contracts/pagos-seguridad.openapi.yaml`
- [ ] Ninguna consulta de estado de datáfono sin revisiones asume `actualizado` por defecto (RN-PS-001)
- [ ] `revision_datafono` nunca se implementó con `UPDATE` sobre una fila existente (RNF-PS-001)
- [ ] Los 3 casos límite están cubiertos por al menos un test de contrato en `tasks.md`
- [ ] El indicador de conformidad lee `cuenta_como_conforme` del catálogo, no compara contra `'actualizado'` (RN-PS-002, enmienda v1.1)
- [ ] Los datáfonos sin revisión nunca cuentan como conformes (RN-PS-001, enmienda v1.1)
- [ ] `GET /pagos/datafonos/{id}/ventas` (RN-PS-004, enmienda v1.2) muestra el estado de revisión vigente en la fecha de cada venta, nunca el estado actual — verificado con una venta antes y otra después de registrar una revisión nueva
- [ ] Ese endpoint nunca escribe en `venta` — es una lectura cruzada de solo lectura hacia `001-core-ventas-inventario`
