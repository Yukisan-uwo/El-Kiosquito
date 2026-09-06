# Checklist de Requisitos: Precios y Márgenes

**Feature**: `003-precios-margenes` | **Fecha**: 2026-09-04

## Trazabilidad

- [ ] Todo RF-PM-XXX de `spec.md` tiene al menos un endpoint en `contracts/precios-margenes.openapi.yaml`
- [ ] Todo endpoint del contrato tiene al menos un test de contrato en `tasks.md` (Fase 2)
- [ ] Todo RF/RNF/RN tiene código único y es trazable a un OO/OT de `ElKiosquito_Documento_Empresa_y_Objetivos.md` (Art. 7.4 de la constitución)

## Cumplimiento de constitución

- [ ] Ninguna consulta de margen real devuelve una cifra calculada con datos faltantes (Art. 5.9) — ver T006/T013
- [ ] El motor de pricing dinámico nunca escribe directamente `historial_precio_producto` (RN-PM-002) — ver T018/T019
- [ ] `clasificacion_producto` nunca se implementó como columna de la tabla `producto` de otro módulo (Art. 4, propiedad de datos) — ver Decisión 2 de `research.md`
- [ ] Aceptar/rechazar una recomendación es un único paso, no una cadena de aprobación simulada (Art. 8.6) — justificado explícitamente en `research.md`, Decisión 3
- [ ] Ningún endpoint omite la validación de scoping por sucursal (Art. 3.3) — ver T012

## Casos límite cubiertos (de `spec.md`)

- [ ] Segunda recomendación pendiente para el mismo producto/sucursal se rechaza (índice único parcial)
- [ ] Precio manual registrado con una recomendación pendiente existente la vuelve obsoleta automáticamente
- [ ] Recomendación rechazada no afecta el precio vigente
- [ ] Margen real sin costo registrado responde "datos insuficientes", nunca una cifra inventada
- [ ] Clasificación gancho/nicho se permite aunque el margen del producto no sea calculable todavía
- [ ] Ningún `precio_competencia` queda sin canal (RF-PM-011, enmienda v1.1) — desde la v1.2 se garantiza porque `fuente_competencia.canal_codigo` es NOT NULL, ya no por una columna propia — ver T012b/T026

## Enmienda v1.2 (normalización de catálogos y SCD tipo 2)

- [ ] Ningún endpoint acepta la fuente de competencia como texto libre (RF-PM-012) — ver T025
- [ ] `precio_competencia` ya no tiene `tipo_canal`; el canal se resuelve vía la fuente (3NF, Decisión 5B) — ver T026
- [ ] La migración T024 hace el backfill de `fuente_competencia_id` **antes** de eliminar las columnas viejas — es la única migración destructiva de toda la enmienda transversal
- [ ] `agrupar_por_fuente=true` responde "¿contra qué competidor estoy peor?" (RF-PM-014) — ver T027
- [ ] Reclasificar exige `motivo_cambio` de al menos 10 caracteres (RN-PM-005) — ver T028
- [ ] Reclasificar cierra la vigencia anterior y actualiza `clasificacion_producto` en la misma transacción (RN-PM-003) — ver T029/T035
- [ ] RN-PM-004 es índice único parcial de base de datos, verificado con `INSERT` directo que debe fallar — ver T030
- [ ] Consultar el historial `?en_fecha=` devuelve la clasificación de esa fecha, no la vigente (RF-PM-016) — ver T031. **Es el test que protege el margen histórico de OT1.1**
- [ ] El motor de pricing lee `margen_objetivo_min`/`max` del catálogo, no los tiene fijos (RF-PM-017) — ver T032/T038
- [ ] Dar de baja una fuente no rompe la consulta de sus observaciones históricas (RN-PM-006) — ver T033
- [ ] Ningún router expone `DELETE` sobre catálogos ni sobre `producto_clasificacion_historial` — ver T034
- [ ] La tabla de historia existe **aquí** porque `clasificacion_producto` se sobreescribe; en `002-clientes-fidelizacion` no se creó ninguna porque `segmento_cliente` ya era append-only (Decisión 5A)

## Fuera de alcance (documentado, no pendiente)

- [ ] La implementación del modelo de pricing dinámico en sí (scikit-learn) — depende del módulo de Analítica y Reportes (pendiente, aún sin número asignado en la nueva estructura); este módulo solo persiste y gestiona el ciclo de vida de las recomendaciones que ese modelo genere
