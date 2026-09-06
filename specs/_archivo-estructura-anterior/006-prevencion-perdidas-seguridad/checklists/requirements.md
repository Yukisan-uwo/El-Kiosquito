# Checklist de Requisitos: Prevención de Pérdidas y Seguridad

**Feature**: `006-prevencion-perdidas-seguridad` | **Fecha**: 2026-09-04

## Trazabilidad

- [ ] Todo RF-PP-XXX de `spec.md` tiene al menos un endpoint en `contracts/prevencion-perdidas-seguridad.openapi.yaml`
- [ ] Todo endpoint del contrato tiene al menos un test de contrato en `tasks.md` (Fase 2)
- [ ] Todo RF/RNF/RN tiene código único y es trazable a un OO/OT de `ElKiosquito_Documento_Empresa_y_Objetivos.md` (Art. 7.4 de la constitución)

## Cumplimiento de constitución

- [ ] Ninguna merma recibe resultado de investigación sin causa asignada (RN-PP-001) — ver T005/T006/T013
- [ ] `incidencia_cuadre_caja` nunca modifica `turno_caja` de Ventas y Caja (RNF-PP-001) — ver T008
- [ ] La única escritura cruzada del proyecto (`alerta_fraude_pago`) está documentada explícitamente en `research.md`, Decisión 3 — no es una excepción silenciosa
- [ ] Ninguna alerta de fraude en pago puede atenderse más de una vez (RN-PP-002) — ver T010/T017
- [ ] Ningún endpoint omite la validación de scoping por sucursal (Art. 3.3) — ver T011

## Casos límite cubiertos (de `spec.md`)

- [ ] Resultado de investigación sin causa asignada se rechaza
- [ ] Alerta de fraude ya atendida no puede volver a atenderse
- [ ] Dos incidencias de cuadre pendientes para el mismo turno se rechazan (índice único parcial)
- [ ] Datáfono sin revisiones declara explícitamente la ausencia de revisión, nunca asume "actualizado"
- [ ] Merma con cantidad o valor estimado en cero se rechaza

## Fuera de alcance (documentado, no pendiente)

- [ ] La implementación real del modelo Isolation Forest — depende de `009-analitica-reportes` (pendiente); este módulo solo persiste y gestiona el ciclo de vida de las incidencias que ese modelo genere
