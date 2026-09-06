# Plan Técnico: Analítica y Reportes (BI)

**Feature**: `011-analitica-reportes` | **Fecha**: 2026-09-04
**Entrada**: `spec.md`

## Resumen Técnico

Módulo de registro operativo de la capa estratégica/táctica: ejecuciones del pipeline ETL, validaciones de calidad de datos, versiones de los 5 modelos de ML y auditoría del asistente conversacional. No calcula ningún modelo ni corre el pipeline — es el destino final de la cadena de dependencias del proyecto (Decisión 1 de `research.md`).

## Contexto Técnico

- **Lenguaje/Stack**: Python 3.11, FastAPI, SQLAlchemy, Alembic para la parte operativa de registro (Art. 5.1); Apache Airflow para el pipeline en sí (Art. 5.2, fuera de este backend); pandas/numpy/scikit-learn para los 5 modelos en sí (Art. 5.6, fuera de este backend); API de Anthropic (Claude) para el asistente conversacional (Art. 5.10, fuera de este backend).
- **Base de datos**: PostgreSQL para el registro operativo de este módulo (Art. 5.2); ClickHouse es el destino de los datos que carga el pipeline, no algo que este módulo administre directamente.
- **Dependencias externas de este módulo**: `usuario` (`010-administracion`, para RNF-AR-003).
- **Consumidores de este módulo**: ninguno de los módulos operativos — es el último eslabón de la cadena (Decisión 1).

## Constitution Check

| Artículo | Regla | Mecanismo de cumplimiento en este módulo |
|---|---|---|
| 5.6 | Solo scikit-learn para los 5 modelos comprometidos, prohibido deep learning/inferencia externa | `version_modelo_ml.modelo` restringido por CHECK a los 5 modelos declarados; este módulo no ejecuta ningún modelo, solo registra metadatos de la versión |
| 5.9 | Regla de honestidad: declarar tamaño de muestra y periodo, documentar si los datos no alcanzan | `version_modelo_ml.tamano_muestra`/`periodo_inicio`/`periodo_fin` obligatorios; `estado='descartado_datos_insuficientes'` con `motivo` cuando no alcanza (RN-AR-002) |
| 5.10 | Asistente conversacional exclusivo del Dueño, nunca predice, solo traduce a consulta real | `pregunta_asistente.consulta_generada` obligatorio y no vacío (RN-AR-003); acceso restringido a `rol='dueno'` (Decisión 5, RNF-AR-003) |

## Estructura del Proyecto

```
backend/
  app/
    models/analitica.py
    schemas/analitica.py
    services/analitica.py     # umbral mínimo por modelo, activación/reemplazo de versión, validación de consulta_generada
    routers/analitica.py
  alembic/versions/xxxx_analitica_reportes.py
frontend/                              # React + Vite (constitución v1.3.0)
  src/features/analitica/
    EstadoPipeline.tsx
    ModelosMl.tsx
    AsistenteConversacional.tsx
  src/api/                             # cliente generado desde el contrato OpenAPI
tests/
  test_analitica_api.py
  test_analitica_negocio.py
```

## Endpoints REST

| Método | Ruta | Descripción | Código |
|---|---|---|---|
| POST | `/api/v1/analitica/pipeline/ejecuciones` | Registrar ejecución de un ciclo ETL (llamado por Airflow) | RF-AR-001 |
| GET | `/api/v1/analitica/pipeline/estado` | Consultar estado del último ciclo ETL | RF-AR-002 |
| POST | `/api/v1/analitica/pipeline/validaciones` | Registrar validación de calidad de datos de un ciclo | RF-AR-005 |
| POST | `/api/v1/analitica/modelos/versiones` | Registrar entrenamiento/despliegue de una versión de modelo | RF-AR-003 |
| GET | `/api/v1/analitica/modelos/{modelo}/metricas` | Consultar métricas de la versión activa | RF-AR-004 |
| POST | `/api/v1/analitica/asistente/preguntas` | Registrar pregunta + consulta generada + respuesta (exclusivo Dueño) | RF-AR-006 |
| GET | `/api/v1/analitica/asistente/preguntas` | Consultar historial del asistente (exclusivo Dueño) | RF-AR-007 |

## Modelo de Datos (resumen — ver `data-model.md`)

4 tablas: `ejecucion_pipeline_etl` (append-only), `validacion_calidad_datos` (append-only), `version_modelo_ml` (append-only, índice único parcial `WHERE estado='activo'`), `pregunta_asistente` (append-only).

*(Enmienda v1.1)* Más 3 catálogos maestros de clave natural: `modelo_ml` (con `algoritmo`, `metrica_principal`, `tamano_muestra_minimo` y `modulo_consumidor`), `estado_ejecucion` y `estado_version_modelo` (con `es_version_servible` y `exige_motivo`). Los tres son de solo lectura desde la API.

Dos cambios de fondo, no solo mecánicos:

- **`nombre_metrica` deja de ser texto libre** y debe coincidir con la `metrica_principal` del modelo (RN-AR-004). Antes se podía registrar el modelo de churn con una métrica de clustering, y comparar dos versiones del mismo modelo dependía de que ambas usaran la misma métrica por disciplina.
- **El umbral mínimo de muestra se muda del código al catálogo**: el diccionario `UMBRAL_MINIMO_POR_MODELO` de `services/analitica.py` pasa a `modelo_ml.tamano_muestra_minimo`. La Decisión 3 se mantiene en su fondo (umbral por modelo, no CHECK genérico); lo que cambia es que ahora vive en la misma base que la versión descartada y su `motivo`, que es lo que el Art. 5.9 pide poder auditar.

## Fases

- **Fase 0**: Este `plan.md` + `research.md` (decisiones 1-5 ya resueltas).
- **Fase 1**: `data-model.md`, `contracts/analitica-reportes.openapi.yaml`, `quickstart.md`.
- **Fase 2**: `tasks.md` con tests de contrato primero, luego implementación.

## Riesgos y Decisiones Técnicas Pendientes

El umbral mínimo de `tamano_muestra` por modelo (Decisión 3) todavía no tiene valores numéricos definitivos — se fijarán junto con el entrenamiento real de cada modelo en la fase de implementación de la capa estratégica, fuera del alcance de este `plan.md`; hasta entonces, `services/analitica.py` los deja como constantes explícitas y documentadas, nunca hardcodeadas de forma dispersa en el router.
