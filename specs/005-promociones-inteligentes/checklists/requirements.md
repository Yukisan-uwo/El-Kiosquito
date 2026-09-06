# Checklist de Requisitos: Promociones Inteligentes

**Feature**: `005-promociones-inteligentes` | **Fecha**: 2026-09-04

## Trazabilidad

- [ ] Todo RF-PI-XXX tiene al menos un endpoint en `contracts/promociones-inteligentes.openapi.yaml`
- [ ] Todo endpoint tiene al menos un test de contrato en `tasks.md` (Fase 2)
- [ ] Todo RF/RNF/RN es trazable a OT2.3/OT2.5 de la cascada de objetivos (departamento Fidelización y Clientes, Art. 7.4 de la constitución)

## Cumplimiento de constitución

- [ ] Este módulo nunca escribe en `cliente`/`evaluacion_churn` (`002-clientes-fidelizacion`) ni en `venta`/`detalle_venta` (`001-core-ventas-inventario`) (RNF-PI-001)
- [ ] RN-PI-002 está implementado como CHECK de base de datos, no solo como validación de servicio
- [ ] El canje de un cupón es una transacción atómica (valida antes de actualizar) — nunca deja un cupón en estado inconsistente

## Casos límite cubiertos

- [ ] Cupón ya canjeado no puede volver a canjearse
- [ ] Cupón vencido no puede canjearse aunque nunca se haya usado
- [ ] Cupón `recuperacion_churn` sin `evaluacion_churn_id` se rechaza
- [ ] Dos cupones activos simultáneos del mismo cliente conviven sin conflicto

## Enmienda v1.1 (normalización de catálogos)

- [ ] Ningún endpoint acepta origen, tipo de descuento o estado como texto libre ni como enum fijo del contrato (RF-PI-005) — ver T018
- [ ] Un cupón de porcentaje con valor mayor a 100 se rechaza (RN-PI-004) — ver T019. **Antes de esta enmienda ese cupón se creaba sin error**
- [ ] El tope es inclusivo: `descuento_valor = 100` en porcentaje se acepta — ver T020
- [ ] El CHECK de RN-PI-002 sigue existiendo y sigue siendo quien rechaza; no fue sustituido por `requiere_evaluacion_churn` (Decisión 4A) — ver T021
- [ ] `tipo_origen_cupon.es_automatico` permite calcular el indicador de OT2.3 sin enumerar códigos (RF-PI-007) — ver T022
- [ ] La validación de canje consulta `estado_cupon.permite_canje`, no el literal `'activo'` — ver T027
- [ ] Ningún router expone `DELETE` sobre los 3 catálogos, y dar de baja un origen no rompe los cupones ya emitidos con él (RN-PI-003) — ver T024
- [ ] Los 3 catálogos tienen seed dentro de su propia migración Alembic (T017)

## Enmienda v1.2 (auditoría de riesgos derivados, 2026-09-05)

- [ ] **Ya no está fuera de alcance**: el motor de reglas que decide cuándo sugerir un cupón de `patron_compra` (antes documentado como responsabilidad externa, ver Decisión 3 de `research.md`) ahora existe realmente en este módulo — `app/services/patron_compra.py` + `sugerencia_patron_compra` (Decisión 5)
- [ ] `POST /promociones/sugerencias-patron/recalcular` calcula soporte/confianza/lift reales sobre `detalle_venta`/`venta` — verificado con datos de prueba reales (8 canastas producto A+B, 2 canastas solo A del cliente objetivo, 10 canastas de relleno): generó 1 sugerencia con soporte 0.33/confianza 0.62/lift 1.85, cifras coherentes con el cálculo manual
- [ ] Un recálculo repetido sin resolver la sugerencia pendiente la omite como duplicada (`ux_sugerencia_patron_pendiente`) — verificado: segunda llamada con la misma sugerencia pendiente devolvió `sugerencias_omitidas_duplicadas: 1`
- [ ] `PATCH .../resolver` con `aceptar=true` sin `descuento_tipo`/`descuento_valor`/`fecha_expiracion` se rechaza con `422` (RN-PI-005) — verificado
- [ ] Aceptar una sugerencia crea un `cupon` real con `tipo_origen='patron_compra'`, reusando exactamente la misma validación que `POST /promociones/cupones` (factorizada en `_crear_cupon`) — verificado, cupón creado con `estado='activo'`
- [ ] Una sugerencia ya resuelta (`aceptada`/`descartada`) no puede volver a resolverse — `409` — verificado
- [ ] RBAC: `crear` (recalcular) y `actualizar` (resolver) son dueño-exclusivo, mismo criterio que `cupon.crear`; `leer` lo tienen los cuatro roles — verificado que `cajero` recibe `403` al intentar recalcular y `200` al leer

## Fuera de alcance (documentado, no pendiente)

- [ ] La decisión de cuándo corresponde una campaña de recuperación de churn — ver `002-clientes-fidelizacion`
