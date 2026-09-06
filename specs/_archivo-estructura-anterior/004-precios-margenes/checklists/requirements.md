# Checklist de Requisitos: Precios y Márgenes

**Feature**: `004-precios-margenes` | **Fecha**: 2026-09-04

## Trazabilidad

- [ ] Todo RF-PM-XXX de `spec.md` tiene al menos un endpoint en `contracts/precios-margenes.openapi.yaml`
- [ ] Todo endpoint del contrato tiene al menos un test de contrato en `tasks.md` (Fase 2)
- [ ] Todo RF/RNF/RN tiene código único y es trazable a un OO/OT de `ElKiosquito_Documento_Empresa_y_Objetivos.md` (Art. 7.4 de la constitución)

## Cumplimiento de constitución

- [ ] Ninguna consulta de margen real devuelve una cifra calculada con datos faltantes (Art. 5.9) — ver T006/T013
- [ ] El motor de pricing dinámico nunca escribe directamente `historial_precio_producto` (RN-PM-002) — ver T018/T019
- [ ] `clasificacion_producto` nunca se implementó como columna de la tabla `producto` de otro módulo (Art. 4, propiedad de datos) — ver Decisión 2 de `research.md`
- [ ] Aceptar/rechazar una recomendación es un único paso, no una cadena de aprobación simulada (Art. 8.6) — justificado explícitamente en `research.md`, Decisión 3
- [ ] Ningún endpoint permite la validación de scoping por sucursal (Art. 3.3) — ver T012

## Casos límite cubiertos (de `spec.md`)

- [ ] Segunda recomendación pendiente para el mismo producto/sucursal se rechaza (índice único parcial)
- [ ] Precio manual registrado con una recomendación pendiente existente la vuelve obsoleta automáticamente
- [ ] Recomendación rechazada no afecta el precio vigente
- [ ] Margen real sin costo registrado responde "datos insuficientes", nunca una cifra inventada
- [ ] Clasificación gancho/nicho se permite aunque el margen del producto no sea calculable todavía

## Fuera de alcance (documentado, no pendiente)

- [ ] La implementación del modelo de pricing dinámico en sí (scikit-learn) — depende de `009-analitica-reportes` (pendiente); este módulo solo persiste y gestiona el ciclo de vida de las recomendaciones que ese modelo genere
