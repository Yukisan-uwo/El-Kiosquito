# Checklist de Requisitos: Compras y Proveedores

**Feature**: `003-compras-proveedores` | **Fecha**: 2026-09-04

## Trazabilidad

- [ ] Todo RF-CP-XXX de `spec.md` tiene al menos un endpoint en `contracts/compras-proveedores.openapi.yaml`
- [ ] Todo endpoint del contrato tiene al menos un test de contrato en `tasks.md` (Fase 2)
- [ ] Todo RF/RNF/RN tiene código único y es trazable a un OO/OT de `ElKiosquito_Documento_Empresa_y_Objetivos.md` (Art. 7.4 de la constitución)

## Cumplimiento de constitución

- [ ] Ningún endpoint permite editar `orden_compra.estado` directamente (RNF-CP-001) — ver T010
- [ ] Ninguna orden `es_oferta=true` puede recibirse sin `pronostico_consultado=true` por línea (RN-CP-001) — ver T007/T008/T014
- [ ] `historial_costo_producto` es estrictamente de solo inserción (RNF-CP-002) — ningún router expone `PATCH`/`DELETE` sobre esa tabla
- [ ] Ningún flujo de este módulo simula una aprobación gerencial no solicitada (Art. 8.6) — el estado de la orden se deriva de recepciones reales, no de una decisión de "aprobar/rechazar"
- [ ] El alcance de cadena completa del rol Encargado de Compras está limitado a este módulo y documentado, no se extiende por defecto a otros módulos (Art. 3.3) — ver T012

## Casos límite cubiertos (de `spec.md`)

- [ ] Sobre-entrega del proveedor (cantidad recibida mayor a la pedida) se acepta sin error
- [ ] Recepción en más de un envío se recalcula correctamente vía el log de eventos, nunca vía contador incremental
- [ ] Compra por oferta sin pronóstico consultado se rechaza antes de recibirse
- [ ] Proveedor desactivado no bloquea la recepción de sus órdenes ya existentes
- [ ] Dos proveedores cotizando el mismo producto el mismo día quedan ambos registrados sin conflicto

## Fuera de alcance (documentado, no pendiente)

- [ ] Cálculo real del pronóstico de demanda — depende de `009-analitica-reportes` (pendiente); este módulo consume un stub documentado (`es_estimacion_provisional: true`), ver `plan.md`
