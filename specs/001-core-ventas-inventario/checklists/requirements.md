# Checklist de Requisitos: Core de Ventas e Inventario

**Feature**: `001-core-ventas-inventario` | **Fecha**: 2026-09-04

## Trazabilidad

- [ ] Todo RF-CVI-XXX tiene al menos un endpoint en `contracts/core-ventas-inventario.openapi.yaml`
- [ ] Todo endpoint tiene al menos un test de contrato en `tasks.md` (Fase 2)
- [ ] Todo RF/RNF/RN es trazable a un OO/OT de la cascada de objetivos (departamentos Ventas y Caja / Inventario y Caducidad, Art. 7.4 de la constitución)

## Cumplimiento de constitución

- [ ] Ningún endpoint omite el scoping por sucursal (Art. 3.3)
- [ ] Ningún producto fraccionable se guarda sin `factor_conversion` (RN-CVI-001)
- [ ] `venta` nunca escribe en `turno_caja` (propiedad de `006-caja-mermas-fraude`)
- [ ] Ningún flujo simula una aprobación no solicitada (Art. 8.6)

## Casos límite cubiertos

- [ ] Anulación de venta tras cierre de turno no reabre el cuadre
- [ ] Producto fraccionable sin conversión bloquea creación y venta
- [ ] Lote con caducidad ya vencida al ingresar genera alerta inmediata
- [ ] Dos lotes del mismo producto/sucursal el mismo día con fechas distintas quedan separados
- [ ] Producto sin rotación se desmarca tras venta nueva

## Enmienda v1.1 (auditoría enunciado-vs-specs)

- [ ] `venta.hora_inicio_cobro` es opcional — una venta sin ese campo se registra igual (RF-CVI-017)
- [ ] `producto_sustituto` nunca permite `producto_id = producto_sustituto_id` (RN-CVI-004) — ver T030
- [ ] Registrar un sustituto con `simetrico=true` crea las dos filas de la relación — ver T031

## Enmienda v1.2 (comparación contra dataset real — opensourcepos)

- [ ] Toda venta expone `numero_documento` en la respuesta, con formato `V-########` y nunca repetido (RF-CVI-020) — ver T033
- [ ] `stock_minimo` nunca es negativo (RN-CVI-005) — ver T034
- [ ] `GET /inventario/stock-bajo` refleja correctamente productos que cruzan el umbral tras una venta (RF-CVI-022) — ver T035/T036

## Enmienda v1.3 (normalización de catálogos maestros)

- [ ] `producto.categoria` es FK a `categoria`, ningún endpoint la acepta como texto (RF-CVI-023) — ver T038
- [ ] Las dos unidades del producto son FK a `unidad_medida` (RF-CVI-025) — ver T038
- [ ] Un producto fraccionable con unidad que no admite decimales se rechaza (RN-CVI-006) — ver T039
- [ ] `es_perecedero` se hereda de la categoría al crear, pero el valor explícito del producto manda (RN-CVI-006 no aplica aquí; ver T040)
- [ ] La jerarquía de categorías nunca supera dos niveles (RN-CVI-008) — ver T041
- [ ] Una categoría con productos activos no se puede dar de baja (`409`) — ver T042
- [ ] Ningún router expone `DELETE` sobre los 5 catálogos; la baja es `activo = false` (RN-CVI-009) — ver T045
- [ ] Los 5 catálogos tienen seed dentro de su propia migración Alembic, no en un script aparte (T037)
- [ ] Agregar un `metodo_pago` nuevo no requiere migración de esquema — ver T046
- [ ] Los tres campos de `venta` (`metodo_pago`, `estado_pago`, `estado_venta`) siguen guardando el código legible, no un id numérico (Decisión 7 de `research.md`)
- [ ] Las altas/bajas/modificaciones de `categoria` quedan en el log de auditoría de `010-administracion` (T025b), ya que los catálogos no llevan columnas propias de auditoría

## Enmienda v1.4 (auditoría de riesgos derivados, 2026-09-05 — layout/anaquel)

- [ ] **Ya no está fuera de alcance**: "layout/anaquel limitado" (huecos adicionales del enunciado, antes documentado como pendiente de decisión) ahora tiene `anaquel`/`producto_ubicacion` reales (Decisión 8 de `research.md`)
- [ ] Asignar un producto a un anaquel con `capacidad_maxima` declarada, por encima del cupo, se rechaza con `409` (RN-CVI-010) — reasignar el mismo producto al mismo anaquel no cuenta dos veces
- [ ] `capacidad_maxima` NULL significa "sin límite declarado", nunca "capacidad cero" — verificado
- [ ] `producto_ubicacion` no lleva historial (SCD): un producto tiene una sola ubicación vigente por sucursal — verificado con el índice único `(producto_id, sucursal_id)`
- [ ] RBAC: `encargado_sucursal` tiene control total sobre `anaquel`; `cajero`/`encargado_compras` solo leen — verificado

## Enmienda v1.5 (auditoría de riesgos derivados, 2026-09-05 — trazabilidad venta↔datáfono)

- [ ] `venta.datafono_id` (FK externa hacia `datafono`, 007) cierra el último de los cinco riesgos de segundo orden: antes de esto no había ningún vínculo entre una venta con tarjeta y el terminal físico que la cobró (Decisión 9 de `research.md`)
- [ ] Una venta en efectivo con `datafono_id` se rechaza con `422` (RN-CVI-011, CHECK de base de datos) — verificado
- [ ] Una venta con tarjeta/electrónico sin `datafono_id`, en una sucursal con datáfonos activos, se rechaza con `422` (RN-CVI-011, validación de servicio) — verificado
- [ ] La misma venta, en una sucursal SIN ningún datáfono registrado, se acepta sin `datafono_id` — no bloquea sucursales sin terminal cargado — verificado
- [ ] Un `datafono_id` de otra sucursal o de un datáfono dado de baja se rechaza (`422`) — verificado
- [ ] `GET /pagos/datafonos/{id}/ventas` (007) muestra el estado de revisión vigente EN LA FECHA DE CADA VENTA, no el estado actual del datáfono — verificado con una venta antes y otra después de registrar una revisión nueva
- [ ] La FK es directa, no diferida — 007 ya existía cuando se agregó la columna

## Fuera de alcance (documentado, no pendiente)

- [ ] Control de caja/turno y fraude — ver `006-caja-mermas-fraude`
- [ ] Demanda insatisfecha — ver `004-pronostico-demanda`
- [ ] Pago mixto efectivo+tarjeta — confirmado fuera de alcance en el diseño original de Ventas y Caja
- [ ] Si se ofreció/aceptó un sustituto ante un quiebre real de stock — ese evento se registra en `demanda_insatisfecha` de `004-pronostico-demanda`, no aquí; este módulo solo posee el catálogo de qué sustituye a qué
