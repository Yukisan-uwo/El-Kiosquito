# Checklist de Requisitos: Compras y Proveedores

**Feature**: `008-compras-proveedores` | **Fecha**: 2026-09-04

## Trazabilidad

- [ ] Todo RF-CP-XXX de `spec.md` tiene al menos un endpoint en `contracts/compras-proveedores.openapi.yaml`
- [ ] Todo endpoint del contrato tiene al menos un test de contrato en `tasks.md` (Fase 2)
- [ ] Todo RF/RNF/RN tiene código único y es trazable a un OO/OT de `ElKiosquito_Documento_Empresa_y_Objetivos.md` (Art. 7.4 de la constitución)

## Cumplimiento de constitución

- [ ] Ningún endpoint permite editar `orden_compra.estado` directamente (RNF-CP-001) — ver T011
- [ ] Ninguna orden `es_oferta=true` puede recibirse sin `pronostico_consultado=true` por línea (RN-CP-001) — ver T007/T008/T015
- [ ] `historial_costo_producto` es estrictamente de solo inserción (RNF-CP-002) — ningún router expone `PATCH`/`DELETE` sobre esa tabla
- [ ] Ningún flujo de este módulo simula una aprobación gerencial no solicitada (Art. 8.6) — el estado de la orden se deriva de recepciones reales, no de una decisión de "aprobar/rechazar"
- [ ] El alcance de cadena completa del rol Encargado de Compras está limitado a este módulo y documentado, no se extiende por defecto a otros módulos (Art. 3.3) — ver T013
- [ ] `GET /compras/productos/{producto_id}/pronostico` consulta `004-pronostico-demanda` en vivo, ya no expone `es_estimacion_provisional` como stub (Decisión 4 de `research.md`)

## Casos límite cubiertos (de `spec.md`)

- [ ] Sobre-entrega del proveedor (cantidad recibida mayor a la pedida) se acepta sin error
- [ ] Recepción en más de un envío se recalcula correctamente vía el log de eventos, nunca vía contador incremental
- [ ] Compra por oferta sin pronóstico consultado se rechaza antes de recibirse
- [ ] `004-pronostico-demanda` sin datos suficientes para un producto no bloquea la consulta, pero exige motivo para cualquier cantidad pedida
- [ ] Proveedor desactivado no bloquea la recepción de sus órdenes ya existentes
- [ ] Dos proveedores cotizando el mismo producto el mismo día quedan ambos registrados sin conflicto
- [ ] Una recepción sin `numero_documento_proveedor` todavía disponible se acepta igual (enmienda v1.1)

## Enmienda v1.1 (comparación contra dataset real — opensourcepos)

- [ ] Toda orden de compra registra `forma_pago` (contado/crédito), obligatorio al crearla (RF-CP-012) — ver T013b/T013c
- [ ] `numero_documento_proveedor` nunca bloquea una recepción por estar ausente (RF-CP-013) — ver T013d/T013e

## Enmienda v1.2 (normalización de catálogos)

- [ ] Ningún endpoint acepta forma de pago ni estado como enum fijo del contrato (RF-CP-014) — ver T026
- [ ] `forma_pago.dias_plazo_default` está poblado y permite anticipar el vencimiento de una orden a crédito (RF-CP-015) — ver T027
- [ ] La validación de recepción consulta `permite_recepcion`, no una lista de estados en el servicio (RN-CP-002) — ver T029/T034
- [ ] **RNF-CP-001 sigue vigente pese a la FK**: no existe ninguna ruta que escriba `orden_compra.estado` — ver T030 (test de no-regresión)
- [ ] Agregar una forma de pago nueva no requiere migración de esquema — ver T031
- [ ] Ningún router expone `DELETE` sobre los 2 catálogos (RN-CP-003) — ver T032
- [ ] Los 2 catálogos tienen seed dentro de su propia migración Alembic (T025)

## Fuera de alcance (documentado, no pendiente)

- [ ] El cálculo del modelo de pronóstico de demanda en sí (scikit-learn) — responsabilidad de `004-pronostico-demanda` y, en última instancia, de Analítica y Reportes; este módulo solo consume el resultado ya calculado
