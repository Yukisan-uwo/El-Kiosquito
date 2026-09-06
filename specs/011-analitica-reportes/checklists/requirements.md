# Checklist de Requisitos: Analítica y Reportes (BI)

**Feature**: `011-analitica-reportes` | **Fecha**: 2026-09-04

## Trazabilidad

- [ ] Todo RF-AR-XXX de `spec.md` tiene al menos un endpoint en `contracts/analitica-reportes.openapi.yaml`
- [ ] Todo endpoint del contrato tiene al menos un test de contrato en `tasks.md` (Fase 2)
- [ ] Todo RF/RNF/RN tiene código único y es trazable a un OO/OT de `ElKiosquito_Documento_Empresa_y_Objetivos.md` (Art. 7.4 de la constitución)

## Cumplimiento de constitución

- [ ] Ninguna versión de modelo queda `estado='activo'` sin `tamano_muestra`, `periodo_inicio` y `periodo_fin` (RNF-AR-002, Art. 5.9) — ver T006/T007
- [ ] Una versión con datos insuficientes se registra como `descartado_datos_insuficientes` con `motivo`, nunca se activa ni inventa una métrica (RN-AR-002, CA-AR-001) — ver T007
- [ ] Solo una versión `activo` por modelo a la vez, reforzado por índice único parcial (RN-AR-001, CA-AR-002) — ver T008/T009
- [ ] Ninguna pregunta del asistente se registra sin `consulta_generada` no vacía (RN-AR-003, Art. 5.10) — ver T010
- [ ] El asistente conversacional es accesible exclusivamente por el rol `dueno` (RNF-AR-003) — ver T011
- [ ] Este módulo no calcula ningún modelo de ML ni corre el pipeline ETL — solo registra metadatos de ejecución (Decisión 1 de `research.md`)
- [ ] Ninguna tabla de este módulo almacena un reporte compuesto/dashboard entre sucursales — esos se sirven desde ClickHouse, no desde PostgreSQL (nota metodológica de la cascada de objetivos)

## Casos límite cubiertos (de `spec.md`)

- [ ] Registro de versión de modelo con datos insuficientes no rompe el flujo, queda documentado con motivo
- [ ] Segunda versión activa del mismo modelo reemplaza a la anterior en la misma transacción, sin dejar dos activas simultáneas
- [ ] Consulta de métricas de un modelo sin ninguna versión activa responde 404 explícito, no un objeto vacío ambiguo
- [ ] Acceso al asistente conversacional con un rol distinto de `dueno` se rechaza en ambos endpoints (`POST` y `GET`)

## Enmienda v1.1 (normalización de catálogos)

- [ ] Ningún endpoint acepta modelo ni estados como enum fijo del contrato (RF-AR-008) — ver T021
- [ ] `nombre_metrica` debe coincidir con `modelo_ml.metrica_principal` (RN-AR-004) — ver T022/T023. **Antes de esta enmienda se podía registrar el modelo de churn con una métrica de clustering**
- [ ] El umbral de muestra se lee de `modelo_ml.tamano_muestra_minimo`, y el diccionario `UMBRAL_MINIMO_POR_MODELO` **fue eliminado**, no dejado como respaldo — ver T031. Dos fuentes para el mismo umbral es el problema que la enmienda resuelve
- [ ] Cambiar el umbral en el catálogo cambia el comportamiento sin tocar código (Decisión 6B) — ver T026
- [ ] La consulta de métricas filtra por `es_version_servible`, no por el literal `'activo'` — ver T032
- [ ] El CHECK de `motivo` en `version_modelo_ml` sigue existiendo además de `exige_motivo`; no fue sustituido por él — ver T028
- [ ] Insertar un sexto modelo en el catálogo no lo incorpora al sistema: eso exige enmendar el Art. 5.6 (RN-AR-006)
- [ ] Ningún router expone escritura sobre los 3 catálogos (RN-AR-005) — ver T029
- [ ] `validacion_calidad_datos.regla_validada` sigue siendo TEXT libre a propósito (lo escribe el DAG y crece con cada regla nueva)
- [ ] Los 3 catálogos tienen seed dentro de su propia migración Alembic (T020)

## Fuera de alcance (documentado, no pendiente)

- [ ] El cálculo real de los 5 modelos de scikit-learn — vive en la capa estratégica, fuera de este backend
- [ ] Los DAGs de Airflow y el modelo Fact-Dim de ClickHouse en sí — infraestructura de datos, no un endpoint de este módulo
- [ ] Cualquier dashboard o reporte compuesto entre sucursales — se sirve desde ClickHouse
