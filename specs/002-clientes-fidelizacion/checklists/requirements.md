# Checklist de Requisitos: Clientes y Fidelización

**Feature**: `002-clientes-fidelizacion` | **Fecha**: 2026-09-04

## Trazabilidad

- [ ] Todo RF-CF-XXX tiene al menos un endpoint en `contracts/clientes-fidelizacion.openapi.yaml`
- [ ] Todo endpoint tiene al menos un test de contrato en `tasks.md` (Fase 2)
- [ ] Todo RF/RNF/RN es trazable a OT2.3/OT2.5 de la cascada de objetivos (departamento Fidelización y Clientes, Art. 7.4 de la constitución)

## Cumplimiento de constitución

- [ ] Ningún segmento o evaluación de riesgo se expone sin `tamano_muestra` y periodo (Art. 5.9)
- [ ] Ninguna consulta de segmento o riesgo sin datos disfraza la ausencia como un resultado calculado (RF-CF-007)
- [ ] Este módulo nunca escribe en `venta`/`detalle_venta` ni en `cupon` (RNF-CF-002, Decisión 1 de `research.md`)
- [ ] El envío de campaña de recuperación es una operación directa validada, no un flujo de aprobación simulado (Art. 8.6)

## Casos límite cubiertos

- [ ] Cliente sin compras o con historial insuficiente → sin segmento ni evaluación en el ciclo
- [ ] Cliente en riesgo que compra antes del envío de la campaña → envío rechazado (RN-CF-001)
- [ ] Evaluación de riesgo con frecuencia histórica variable (no umbral fijo de días) queda respaldada por `justificacion`

## Enmienda v1.1 (normalización de catálogos y dimensión SCD tipo 2)

- [ ] Ningún endpoint acepta el segmento como texto libre (RF-CF-008) — ver T024
- [ ] Toda asignación de segmento trae `version_modelo_id` obligatorio (RF-CF-009) — ver T025
- [ ] Registrar un segmento nuevo cierra la vigencia del anterior en la misma transacción (RN-CF-003) — ver T026/T032
- [ ] RN-CF-002 es un índice único parcial de base de datos, verificado con un `INSERT` directo que debe fallar — ver T027
- [ ] `GET /clientes/{id}/segmento/historial` de un cliente sin ciclos devuelve lista vacía, nunca `404` — ver T029
- [ ] `obtener_segmento_reciente` consulta por `vigente_hasta IS NULL`, no por `ORDER BY fecha_calculo DESC` — ver T034
- [ ] Ningún router expone `DELETE` sobre `segmento` (RN-CF-004) — ver T031
- [ ] El catálogo `segmento` tiene seed dentro de su propia migración Alembic (T023)
- [ ] **No existe** ninguna tabla `cliente_segmento_historial` — `segmento_cliente` es la dimensión (Decisión 4 de `research.md`)

## Enmienda v1.2 (auditoría de riesgos derivados, 2026-09-05)

- [ ] `registrar_campana_recuperacion` rechaza con `409` una evaluación con `es_riesgo_real = false` (RN-CF-005)
- [ ] El mensaje de error nombra `es_riesgo_real`/RN-CF-005 explícitamente, no un genérico "no permitido"

## Fuera de alcance (documentado, no pendiente)

- [ ] Mecanismo de cupones (envío, canje, expiración) — ver `005-promociones-inteligentes`
- [ ] Cálculo del modelo K-Means y del modelo de churn en sí — responsabilidad de Analítica y Reportes (capa estratégica, pendiente)
- [ ] Historial de compras detallado por producto — este módulo solo consulta el resumen de `venta`, ver `001-core-ventas-inventario`
