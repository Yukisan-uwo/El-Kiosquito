# Checklist de Requisitos: Ventas y Caja

**Feature**: `001-ventas-y-caja` | **Fecha**: 2026-09-04

## Trazabilidad

- [ ] Todo RF-VC-XXX de `spec.md` tiene al menos un endpoint en `contracts/ventas-caja.openapi.yaml`
- [ ] Todo endpoint del contrato tiene al menos un test de contrato en `tasks.md` (Fase 2)
- [ ] Todo RF/RNF/RN tiene código único y es trazable a un OO/OT de `ElKiosquito_Documento_Empresa_y_Objetivos.md` (Art. 7.4 de la constitución)

## Cumplimiento de constitución

- [ ] Ningún endpoint omite la validación de scoping por sucursal (Art. 3.3) — ver T013/T016
- [ ] La conversión de producto fraccionado nunca se permite sin `factor_conversion` configurado (Art. 4.7) — ver T006/T015
- [ ] Toda diferencia de caja distinta de cero exige motivo antes de cerrarse (Art. 4.2) — ver T009/T026
- [ ] Ningún dato de tarjeta más allá de los últimos 4 dígitos se almacena o se expone en respuesta (Art. 10.8) — ver T012/T022
- [ ] Ningún flujo de este módulo simula una aprobación no solicitada (Art. 8.6) — la anulación de venta es un UPDATE directo con motivo, no un flujo de solicitud/aprobación

## Casos límite cubiertos (de `spec.md`)

- [ ] Anulación de venta después del cierre de turno no reabre el cuadre cerrado
- [ ] Pago con tarjeta rechazado a mitad de transacción no cuenta como venta ni como demanda insatisfecha
- [ ] Producto fraccionable sin conversión configurada bloquea la venta, nunca permite "a ojo"
- [ ] Dos cajeros no pueden compartir un turno abierto simultáneamente (índice único parcial)
- [ ] Demanda insatisfecha admite registro con retraso (hora_evento ≠ hora_registro)

## Fuera de alcance (documentado, no pendiente)

- [ ] Pago mixto (efectivo + tarjeta en la misma venta) — confirmado fuera de alcance en `research.md`, Decisión 3
