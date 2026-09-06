# Checklist de Requisitos: Fidelización y Clientes

**Feature**: `005-fidelizacion-clientes` | **Fecha**: 2026-09-04

## Trazabilidad

- [ ] Todo RF-FC-XXX de `spec.md` tiene al menos un endpoint en `contracts/fidelizacion-clientes.openapi.yaml`
- [ ] Todo endpoint del contrato tiene al menos un test de contrato en `tasks.md` (Fase 2)
- [ ] Todo RF/RNF/RN tiene código único y es trazable a un OO/OT de `ElKiosquito_Documento_Empresa_y_Objetivos.md` (Art. 7.4 de la constitución)

## Cumplimiento de constitución

- [ ] Ninguna consulta de segmento o riesgo de abandono presenta un resultado calculado sin datos suficientes (Art. 5.9) — ver T005/T016/T018
- [ ] `segmento_cliente` y `evaluacion_churn` son estrictamente append-only (RNF-FC-001) — ningún router expone `UPDATE`/`DELETE`
- [ ] Este módulo nunca escribe en `venta`/`detalle_venta` de Ventas y Caja (RNF-FC-002) — ver T013
- [ ] Ningún flujo de este módulo simula una aprobación no solicitada (Art. 8.6) — canje de cupón y envío de campaña son operaciones directas con validación, no un flujo de solicitud/aprobación

## Casos límite cubiertos (de `spec.md`)

- [ ] Cliente sin historial de compras suficiente no recibe segmento ni evaluación de riesgo calculados en el ciclo
- [ ] Cupón ya canjeado no puede volver a canjearse
- [ ] Cupón vencido no puede canjearse aunque nunca se haya usado
- [ ] Campaña de recuperación se rechaza si el cliente ya volvió a comprar desde su evaluación de riesgo

## Fuera de alcance (documentado, no pendiente)

- [ ] La implementación real de los modelos K-Means y de churn (scikit-learn) — depende de `009-analitica-reportes` (pendiente); este módulo solo persiste y gestiona el ciclo de vida de sus resultados
