# Checklist de Requisitos: Pagos y Seguridad

**Feature**: `007-pagos-seguridad` | **Fecha**: 2026-09-04

## Trazabilidad

- [ ] Todo RF-PS-XXX tiene al menos un endpoint en `contracts/pagos-seguridad.openapi.yaml`
- [ ] Todo endpoint tiene al menos un test de contrato en `tasks.md` (Fase 2)
- [ ] Todo RF/RNF/RN es trazable a OT4.4 de la cascada de objetivos (departamento Prevención de Pérdidas y Seguridad, Art. 7.4 de la constitución)

## Cumplimiento de constitución

- [ ] Ningún datáfono sin revisiones responde un estado `actualizado` asumido por defecto (Art. 5.9, RN-PS-001)
- [ ] `revision_datafono` nunca se implementó con `UPDATE` sobre una fila existente (RNF-PS-001)
- [ ] El código de serie de un datáfono es único en todo el sistema, no solo por sucursal (RNF-PS-002)

## Casos límite cubiertos

- [ ] Datáfono sin ninguna revisión nueva en varios meses conserva el estado de su última revisión, sin marcarse `vencido` automáticamente por el paso del tiempo
- [ ] Datáfono dado de baja conserva su historial completo de revisiones
- [ ] Código de serie duplicado entre sucursales distintas se rechaza

## Enmienda v1.1 (normalización de catálogos)

- [ ] Ningún endpoint acepta el estado de revisión como enum fijo del contrato (RF-PS-007) — ver T018
- [ ] El numerador de conformidad se calcula con JOIN contra `cuenta_como_conforme`, **nunca** comparando contra `'actualizado'` (RN-PS-002) — ver T024
- [ ] Los datáfonos sin revisión se reportan aparte y no suman al numerador (RN-PS-001) — ver T020
- [ ] Agregar un estado intermedio no obliga a tocar ninguna consulta ni el esquema — ver T021
- [ ] Ningún router expone `DELETE` sobre `estado_revision` (RN-PS-003) — ver T022
- [ ] El catálogo tiene seed dentro de su propia migración Alembic (T017)
- [ ] `011-analitica-reportes` consume el endpoint de conformidad en vez de recalcular el KPI por su cuenta

## Enmienda v1.2 (auditoría de riesgos derivados, 2026-09-05 — trazabilidad venta↔datáfono)

- [ ] **Cierra un riesgo antes desconectado**: `venta.datafono_id` (`001-core-ventas-inventario`, enmienda v1.5) + `GET /pagos/datafonos/{id}/ventas` conectan por primera vez una venta con tarjeta al terminal físico que la cobró (RN-PS-004, Decisión 5 de `research.md`)
- [ ] El endpoint muestra, para cada venta, el estado de revisión vigente **en la fecha de esa venta**, nunca el estado actual del datáfono — verificado con una venta antes y otra después de registrar una revisión nueva
- [ ] Una venta anterior a la primera revisión registrada se reporta `sin_revision_al_momento: true`, igual que un datáfono sin revisión (RN-PS-001) — nunca se le atribuye una revisión posterior retroactivamente
- [ ] El endpoint solo LEE `venta` — no la modifica, no la crea, no le cambia estado (mismo RNF de solo-lectura cruzada que ya aplican otros módulos)
- [ ] RBAC: mismo recurso `datafono`/`leer` que el resto de las consultas del módulo, sin recurso nuevo

## Fuera de alcance (documentado, no pendiente)

- [ ] La atención de alertas de fraude en pagos con tarjeta durante una venta puntual — ver `006-caja-mermas-fraude`
- [ ] Un umbral automático de "vencido por antigüedad" — la evaluación de vigencia queda a criterio de quien revisa, no del sistema
