# Checklist de Requisitos: Pronóstico de Demanda

**Feature**: `004-pronostico-demanda` | **Fecha**: 2026-09-04

## Trazabilidad

- [ ] Todo RF-PD-XXX tiene al menos un endpoint en `contracts/pronostico-demanda.openapi.yaml`
- [ ] Todo endpoint tiene al menos un test de contrato en `tasks.md` (Fase 2)
- [ ] Todo RF/RNF/RN es trazable a OT3.7/OT4.1 de la cascada de objetivos (departamentos Ventas y Caja / Analítica y Reportes, Art. 7.4 de la constitución)

## Cumplimiento de constitución

- [ ] Ningún pronóstico se expone sin `tamano_muestra` y periodo (Art. 5.9)
- [ ] Ninguna consulta de pronóstico sin datos disfraza la ausencia como una cantidad recomendada calculada (RN-PD-001)
- [ ] El registro de demanda insatisfecha respeta el scoping por sucursal (Art. 3.3)
- [ ] `pronostico_demanda` nunca se implementó con `UPDATE` sobre una fila existente (RNF-PD-002)

## Casos límite cubiertos

- [ ] Dos eventos de demanda insatisfecha del mismo producto en la misma hora no se deduplican
- [ ] Producto con demanda insatisfecha registrada pero sin pronóstico calculado — ambas tablas son independientes
- [ ] Registro diferido de demanda insatisfecha con `hora_evento` distinta a `hora_registro`
- [ ] `sustituto_ofrecido_id`/`sustituto_aceptado` son opcionales y no rompen el registro existente de demanda insatisfecha (enmienda v1.1) — ver T009b
- [ ] `sustituto_aceptado` nunca queda sin informar si se ofreció un sustituto (enmienda v1.1) — ver T009c
- [ ] `evento_local` con alcance de cadena (`sucursal_id` NULL) aparece siempre en la consulta filtrada por cualquier sucursal dentro del rango (enmienda v1.1) — ver T009e

## Enmienda v1.1 (auditoría enunciado-vs-specs)

- [ ] Los confusores del Art. 5.6 (promociones, sustitutos, estacionalidad, demanda insatisfecha) tienen fuente de datos explícita documentada en `spec.md` (tabla de confusores)
- [ ] El catálogo de sustitución de marca vive en `001-core-ventas-inventario` (`producto_sustituto`); este módulo solo registra el evento de oferta/aceptación — nunca se duplicó el catálogo aquí

## Enmienda v1.2 (normalización de catálogos)

- [ ] Ningún endpoint acepta el tipo de evento como texto libre (RF-PD-009) — ver T018
- [ ] `tipo_evento_local` declara `afecta_demanda_al_alza` por tipo, con los cinco seeds en los valores correctos (RF-PD-010) — ver T019
- [ ] El pipeline de features toma el signo del efecto del catálogo, **nunca lo infiere de los datos** (RN-PD-003) — ver T023. Es la regla más fácil de romper sin darse cuenta al escribir la ingeniería de features
- [ ] Agregar un tipo de evento nuevo no requiere migración de esquema — ver T020
- [ ] Ningún router expone `DELETE` sobre `tipo_evento_local` (RN-PD-002) — ver T021
- [ ] El catálogo tiene seed dentro de su propia migración Alembic (T017)

## Enmienda v1.3 (auditoría de riesgos derivados, 2026-09-05)

- [ ] `etl/ml/demanda.py` usa `evento_local_alza`/`evento_local_baja` (de `dim_evento_local`, sin duplicar `'feriado'`) y `hubo_sustituto_ofrecido`/`hubo_sustituto_aceptado` (de `fact_demanda_insatisfecha`) como features (Decisión 6)
- [ ] El signo de `evento_local_alza`/`_baja` viene de `afecta_demanda_al_alza`, nunca inferido (mismo criterio que RN-PD-003)

## Fuera de alcance (documentado, no pendiente)

- [ ] La implementación del modelo de pronóstico en sí (scikit-learn) — depende del módulo de Analítica y Reportes (pendiente); este módulo solo persiste y expone sus resultados
- [ ] El reemplazo del stub de pronóstico en `008-compras-proveedores` — se resuelve al reconstruir ese módulo, no en este
