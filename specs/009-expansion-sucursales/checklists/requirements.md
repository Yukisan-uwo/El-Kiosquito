# Checklist de Requisitos: Expansión y Sucursales

**Feature**: `009-expansion-sucursales` | **Fecha**: 2026-09-04

## Trazabilidad

- [ ] Todo RF-ES-XXX de `spec.md` tiene al menos un endpoint en `contracts/expansion-sucursales.openapi.yaml`
- [ ] Todo endpoint del contrato tiene al menos un test de contrato en `tasks.md` (Fase 2)
- [ ] Todo RF/RNF/RN tiene código único y es trazable a un OO/OT de `ElKiosquito_Documento_Empresa_y_Objetivos.md` (Art. 7.4 de la constitución)

## Cumplimiento de constitución

- [ ] Ninguna sucursal puede pasar a `estado='operativa'` con el checklist incompleto (RN-ES-001, Art. 2.4) — ver T005/T006
- [ ] La herencia de catálogo y precios solo se ejecuta una vez por sucursal, nunca duplica filas de precio (RN-ES-002) — ver T007
- [ ] Un producto sin precio previo en la cadena nunca recibe un precio inventado durante la herencia (RN-ES-003, extensión de Art. 5.9) — ver T008
- [ ] Este módulo nunca escribe directamente en tablas de `001-core-ventas-inventario`, `003-precios-margenes` ni `010-administracion` — toda escritura cruzada pasa por los endpoints ya existentes de esos módulos (Decisión 2 y 3 de `research.md`)
- [ ] Ningún flujo de este módulo simula una aprobación gerencial no solicitada (Art. 8.6) — la activación es una validación automática de checklist, no una decisión de "aprobar/rechazar"

## Casos límite cubiertos (de `spec.md`)

- [ ] Activación con checklist incompleto se rechaza y lista los ítems faltantes
- [ ] Segundo intento de herencia de catálogo sobre la misma sucursal se rechaza sin efectos secundarios
- [ ] Producto sin precio previo en ninguna sucursal queda explícitamente pendiente, nunca con precio inventado
- [ ] Cierre de una sucursal operativa no afecta las filas ya existentes de otros módulos que la referencian por FK (siguen siendo consultables como histórico)

## Enmienda v1.1 (normalización de catálogos)

- [ ] Los ítems del checklist viven en `item_checklist_apertura`, no en un CHECK (RF-ES-009) — ver T021. **Revierte la Decisión 4 original, documentado en la Decisión 5**
- [ ] Agregar un ítem al catálogo no requiere migración de esquema y no reabre el checklist de sucursales ya creadas (RN-ES-006) — ver T027
- [ ] Un ítem bloqueante no se puede dar de baja del catálogo; uno de puesta a punto sí (RN-ES-004) — ver T026
- [ ] **RN-ES-001 no se relajó**: activar sigue exigiendo todos los ítems, bloqueantes o no (RN-ES-005) — ver T025 (test de no-regresión)
- [ ] `estado-apertura` separa los pendientes en bloqueantes y no bloqueantes (RF-ES-012) — ver T024/T030
- [ ] `estado_sucursal.opera_ventas` está poblado y `001-core-ventas-inventario` lo consulta en vez del literal `'operativa'` (RF-ES-010) — ver T023
- [ ] La generación del checklist lee el catálogo en su `orden`, no una lista fija de 8 — ver T029
- [ ] Los 2 catálogos tienen seed dentro de su propia migración Alembic (T020)

## Fuera de alcance (documentado, no pendiente)

- [ ] La creación del `usuario` asignado como personal — pertenece a `010-administracion` (OO-AD01)
- [ ] La lógica de pricing dinámico posterior a la apertura — pertenece a `003-precios-margenes`
