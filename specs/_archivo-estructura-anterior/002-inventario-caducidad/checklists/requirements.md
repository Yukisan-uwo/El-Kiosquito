# Checklist de Requisitos: Inventario y Caducidad

**Feature**: `002-inventario-caducidad` | **Fecha**: 2026-09-04

## Trazabilidad

- [ ] Todo RF-IN-XXX de `spec.md` tiene al menos un endpoint en `contracts/inventario-caducidad.openapi.yaml`
- [ ] Todo endpoint del contrato tiene al menos un test de contrato en `tasks.md` (Fase 2)
- [ ] Todo RF/RNF/RN tiene código único y es trazable a un OO/OT de `ElKiosquito_Documento_Empresa_y_Objetivos.md` (Art. 7.4 de la constitución)

## Cumplimiento de constitución

- [ ] Ningún endpoint omite la validación de scoping por sucursal (Art. 3.3) — ver T012/T021
- [ ] Ningún producto fraccionable puede guardarse sin `factor_conversion` (Art. 4.7) — ver T004/T005/T014
- [ ] Ningún ajuste ni retiro deja `cantidad_disponible` en negativo (RF-IN-009) — ver T009/T010/T022
- [ ] El proceso de marcado sin-rotación (OO-IN08) es exclusivamente Sistema/batch, nunca un endpoint accionado directamente por un rol de negocio en el flujo normal — ver T023, T028
- [ ] Ningún flujo de este módulo simula una aprobación no solicitada (Art. 8.6) — el ajuste de inventario es un `INSERT` directo con motivo, no un flujo de solicitud/aprobación

## Casos límite cubiertos (de `spec.md`)

- [ ] Lote registrado con fecha de caducidad ya vencida al ingresar genera alerta inmediata, no espera al umbral normal
- [ ] Ajuste que dejaría stock negativo se rechaza antes de persistir
- [ ] Producto marcado sin rotación se desmarca automáticamente tras una venta nueva, en el siguiente ciclo batch
- [ ] Dos ingresos del mismo producto/sucursal el mismo día con fechas de caducidad distintas generan dos lotes separados
- [ ] Retiro de lote con cantidad mayor a `cantidad_restante` se rechaza

## Fuera de alcance (documentado, no pendiente)

- [ ] Trazabilidad de lotes para productos no perecederos — confirmado fuera de alcance en `research.md`, Decisión 2 (sobre-ingeniería frente al enunciado)
