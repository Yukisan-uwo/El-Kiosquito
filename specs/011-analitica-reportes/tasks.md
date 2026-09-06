# Tareas de Implementación: Analítica y Reportes (BI)

**Feature**: `011-analitica-reportes` | **Fecha**: 2026-09-04
**Entrada**: `plan.md`, `data-model.md`, `contracts/analitica-reportes.openapi.yaml`

`[P]` = se puede hacer en paralelo con otras tareas `[P]` de su mismo bloque. Las tareas sin `[P]` son secuenciales dentro de su bloque.

## Fase 1 — Setup

- **T001**: Crear la migración Alembic de las 4 tablas de `data-model.md` (`ejecucion_pipeline_etl`, `validacion_calidad_datos`, `version_modelo_ml`, `pregunta_asistente`), incluyendo el índice único parcial de `version_modelo_ml`. Archivo: `backend/alembic/versions/xxxx_analitica_reportes.py`.
- **T002 [P]**: Crear los modelos SQLAlchemy en `backend/app/models/analitica.py`.
- **T003 [P]**: Crear los esquemas Pydantic en `backend/app/schemas/analitica.py`.
- **T004 [P]**: Definir `UMBRAL_MINIMO_POR_MODELO` en `backend/app/services/analitica.py` (Decisión 3 de `research.md`), con valores iniciales documentados (placeholder hasta el entrenamiento real).

## Fase 2 — Tests de contrato primero (deben fallar antes de implementar)

- **T005 [P]**: Test de contrato `POST /analitica/pipeline/ejecuciones` con `estado=exitoso` → `201`; `GET /analitica/pipeline/estado` inmediatamente después devuelve esa misma ejecución.
- **T006 [P]**: Test de contrato: `POST /analitica/modelos/versiones` con `tamano_muestra` sobre el umbral → `estado="activo"` en la respuesta (CA-AR-001 caso positivo).
- **T007 [P]**: Test de contrato: `POST /analitica/modelos/versiones` con `tamano_muestra` bajo el umbral → `estado="descartado_datos_insuficientes"`, `motivo` no nulo, `valor_metrica` nulo (RN-AR-002, CA-AR-001).
- **T008 [P]**: Test de contrato: dos `POST /analitica/modelos/versiones` consecutivos para el mismo `modelo`, ambos con datos suficientes → el segundo queda `activo`, una consulta directa a la tabla muestra el primero como `reemplazado` (RN-AR-001, CA-AR-002).
- **T009 [P]**: Test de contrato: intento de registrar dos filas `estado='activo'` para el mismo `modelo` insertando directamente vía SQL (sin pasar por el servicio) → falla por el índice único parcial (verificación de integridad de esquema, no de API).
- **T010 [P]**: Test de contrato `POST /analitica/asistente/preguntas` con `consulta_generada=""` → `422` (RN-AR-003).
- **T011 [P]**: Test de contrato `POST /analitica/asistente/preguntas` y `GET /analitica/asistente/preguntas` con token de rol `cajero` → `403` en ambos (RNF-AR-003, CA-AR-003).
- **T012 [P]**: Test de contrato `GET /analitica/modelos/{modelo}/metricas` para un modelo sin ninguna versión activa → `404`.

## Fase 3 — Implementación core (hace pasar los tests de la Fase 2)

- **T013**: Endpoints `POST /analitica/pipeline/ejecuciones`, `GET /analitica/pipeline/estado`.
- **T014**: Endpoint `POST /analitica/pipeline/validaciones`.
- **T015**: Servicio `registrar_version_modelo` (aplica `UMBRAL_MINIMO_POR_MODELO`, decide `activo` vs. `descartado_datos_insuficientes`, reemplaza la versión anterior en la misma transacción); endpoint `POST /analitica/modelos/versiones`.
- **T016**: Endpoint `GET /analitica/modelos/{modelo}/metricas`.
- **T017**: Middleware de alcance exclusivo `dueno` para este módulo (Decisión 5 de `research.md`); servicio `validar_consulta_generada` (RN-AR-003); endpoints `POST`/`GET /analitica/asistente/preguntas`.

## Fase 4 — Integración

- **T018**: Documentar en `docker-compose.yml` el DAG de Airflow de ejemplo que llama a `POST /analitica/pipeline/ejecuciones` al iniciar y al finalizar cada corrida (fuera del código de este backend, pero parte del entorno de este módulo).
- **T019**: Verificar en un entorno con Docker Compose levantado (con `010-administracion` también corriendo) que el flujo completo de `quickstart.md` pasa de principio a fin, incluyendo el caso de datos insuficientes y el rechazo de rol no autorizado al asistente.

## Fase 5 — Polish

- **T020 [P]** *(actualizado por la constitución v1.3.0)*: Componentes React + TypeScript: `EstadoPipeline.tsx`, `ModelosMl.tsx`, `AsistenteConversacional.tsx`. Estilos con los tokens de Tailwind del Art. 11.1 — ningún color suelto. Animación con Framer Motion, respetando `prefers-reduced-motion` y sin retrasar el acceso a ninguna función (Art. 5.4). Nota del módulo: toda cifra mostrada debe venir acompañada de su tamaño de muestra y periodo (Art. 5.6).
- **T021 [P]**: Revisar `checklists/requirements.md` de este módulo contra la implementación final antes de marcarlo completo.

## Fase 2b y 3b — Enmienda v1.1 (normalización de catálogos)

- **T040**: Migración de los 3 catálogos **con su seed en la misma revisión**. `modelo_ml` con los 5 modelos del Art. 5.6, cada uno con su `algoritmo`, `metrica_principal`, `tamano_muestra_minimo` (los valores que hoy están en `UMBRAL_MINIMO_POR_MODELO`) y `modulo_consumidor`. Conversión de los 3 campos a FK. *(Fase 1 — prerrequisito de todo lo demás.)*
- **T041 [P]**: `POST /analitica/modelos/versiones` con un `modelo` inexistente en el catálogo → `404` (RF-AR-008).
- **T042 [P]**: `POST /analitica/modelos/versiones` para `churn` con `nombre_metrica: "silhouette"` → `422` (RN-AR-004). **Este test falla contra el diseño anterior**: antes se registraba sin error una métrica de clustering para una clasificación.
- **T043 [P]**: `POST /analitica/modelos/versiones` para `churn` con `nombre_metrica: "F1"` → `201`.
- **T044 [P]**: `GET /catalogos/modelos-ml` → los 5 modelos con su `algoritmo`, `metrica_principal`, `tamano_muestra_minimo` y `modulo_consumidor` (RF-AR-009).
- **T045 [P]**: Registrar una versión con `tamano_muestra` por debajo del `tamano_muestra_minimo` **del catálogo** → queda `descartado_datos_insuficientes` con `motivo` obligatorio (CA-AR-001, RN-AR-002). El umbral se lee del catálogo, no del diccionario en código.
- **T046 [P]**: Cambiar `tamano_muestra_minimo` de un modelo por SQL y repetir T045 con el mismo `tamano_muestra` → el resultado cambia, **sin tocar código** (Decisión 6B).
- **T047 [P]**: `GET /catalogos/estados-version-modelo` → solo `activo` con `es_version_servible: true`; solo `descartado_datos_insuficientes` con `exige_motivo: true`.
- **T048 [P]**: Verificar que el CHECK de `motivo` en `version_modelo_ml` **sigue existiendo** además de `exige_motivo` del catálogo — no fue sustituido por él (mismo criterio que RN-PI-002 en `005`).
- **T049 [P]**: Verificar que ningún router expone escritura sobre los 3 catálogos (RN-AR-005).
- **T050**: Los 3 endpoints `GET /catalogos/...`.
- **T051**: Refactorizar `services/analitica.py` para leer `modelo_ml.tamano_muestra_minimo` en vez del diccionario `UMBRAL_MINIMO_POR_MODELO`, y validar RN-AR-004 contra `metrica_principal` antes de insertar. **Eliminar el diccionario**, no dejarlo como respaldo: dos fuentes para el mismo umbral es exactamente el problema que la enmienda resuelve.
- **T052**: Ajustar la consulta de métricas (RF-AR-004) para filtrar por `estado_version_modelo.es_version_servible` en vez del literal `'activo'`.

## Dependencias entre fases

Fase 1 → Fase 2 → Fase 2b → Fase 3 → Fase 3b → Fase 4 → Fase 5. T004 es prerrequisito de T015. T017 es prerrequisito de los tests T010/T011.

*(Enmienda v1.1)* **T040 va en Fase 1**: al volver `modelo` una FK, ningún test que registre una versión pasa hasta que el catálogo exista poblado. T051 elimina el diccionario `UMBRAL_MINIMO_POR_MODELO` y debe ir después de T040 y antes de T045/T046, que son los que verifican que el umbral efectivamente se lee del catálogo.
