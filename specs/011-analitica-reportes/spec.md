# Especificación de Funcionalidad: Analítica y Reportes (BI)

**Feature**: `011-analitica-reportes` | **Fecha**: 2026-09-04
**Estado**: Borrador inicial | **Entrada**: `claude/el-kiosquito-cascada-objetivos.md` (OT3.6, OT4.1, OT4.5, Departamento Analítica y Reportes), `claude/el-kiosquito-constitution.md` (Art. 5.6, 5.9, 5.10)

## Resumen Ejecutivo

Módulo de gobernanza de la capa estratégica/táctica: registra la ejecución de cada ciclo del pipeline ETL (Airflow → ClickHouse), la validación de calidad de los datos cargados, el entrenamiento y despliegue de cada versión de los 5 modelos de scikit-learn comprometidos en el Art. 5.6, y la auditoría de preguntas del asistente conversacional exclusivo del Dueño (Art. 5.10). Este módulo NO calcula los modelos ni corre el pipeline — es el registro operativo de que se ejecutaron, con qué datos y con qué resultado, aplicando de forma sistemática la regla de honestidad de los modelos del Art. 5.9 a cada versión registrada.

## Contexto de Negocio

El OE4 (Perspectiva Aprendizaje y Crecimiento) asigna a Analítica y Reportes tres objetivos tácticos: OT3.6 (pipeline ETL con latencia <10 min/ciclo), OT4.1 (≥5 modelos de ML en producción) y OT4.5 (asistente conversacional, ≥100% de preguntas respondidas con datos reales). La nota metodológica del punto 7 de la cascada de objetivos es explícita: "los reportes agregados/compuestos (dashboards, comparaciones entre sucursales) NO son objetivos operativos — pertenecen al nivel táctico/estratégico y se sirven desde ClickHouse, no desde la capa operativa" — lección directa de NexoStay (Tarea 11) que este módulo respeta desde el diseño: ninguna de sus tablas almacena un reporte compuesto, solo el registro de que un ciclo/modelo/pregunta ocurrió.

## Requisitos Funcionales

- **RF-AR-001**: El sistema DEBE registrar cada ejecución de un ciclo del pipeline ETL (DAG de Airflow), con su estado final (éxito/error) (OO-AR01).
- **RF-AR-002**: El sistema DEBE permitir consultar el estado y la salud del último ciclo del pipeline ETL ejecutado (OO-AR02).
- **RF-AR-003**: El sistema DEBE registrar el entrenamiento y despliegue de una versión de un modelo de ML, declarando obligatoriamente el tamaño de muestra y el periodo cubierto (OO-AR03, Art. 5.9).
- **RF-AR-004**: El sistema DEBE permitir consultar las métricas de desempeño de la versión actualmente activa de cada uno de los 5 modelos (OO-AR04).
- **RF-AR-005**: El sistema DEBE registrar la validación de calidad de los datos cargados en el modelo Fact-Dim de cada ciclo del pipeline (OO-AR05).
- **RF-AR-006**: El sistema DEBE registrar toda pregunta en lenguaje natural del Dueño al asistente conversacional junto con la consulta estructurada real generada y la respuesta (OO-AR06, Art. 5.10).
- **RF-AR-007**: El sistema DEBE permitir consultar el historial de preguntas y respuestas del asistente conversacional (OO-AR07).
- **RF-AR-008** *(añadido en enmienda v1.1, normalización de catálogos)*: El modelo, el estado de una versión y el estado de una ejecución del pipeline DEBEN seleccionarse de sus catálogos, nunca quedar como valores fijos en el contrato de la API.
- **RF-AR-009** *(añadido en enmienda v1.1)*: El catálogo de modelos DEBE declarar, por modelo, su algoritmo, su métrica principal de evaluación y el módulo que consume sus resultados.
- **RF-AR-010** *(añadido en enmienda v1.1)*: El sistema DEBE exponer los tres catálogos de este módulo como consulta, en modo solo lectura.

## Requisitos No Funcionales

- **RNF-AR-001** (Fiabilidad, ISO 25010): `ejecucion_pipeline_etl`, `version_modelo_ml`, `validacion_calidad_datos` y `pregunta_asistente` son estrictamente append-only — ningún router de este módulo expone `UPDATE`/`DELETE` sobre ellas; una versión de modelo superada nunca se borra, se marca `reemplazado`.
- **RNF-AR-002** (Exactitud, ISO 25012 — regla de honestidad, Art. 5.9): `version_modelo_ml.tamano_muestra`, `periodo_inicio` y `periodo_fin` son obligatorios sin excepción; ninguna versión puede marcarse `estado='activo'` sin ellos.
- **RNF-AR-003** (Seguridad, Art. 5.10): `POST /analitica/asistente/preguntas` y `GET /analitica/asistente/preguntas` son accesibles exclusivamente por el rol `dueno` — ningún otro rol de la jerarquía del Art. 3.1 tiene alcance sobre el asistente conversacional.
- **RNF-AR-004** (Eficiencia de desempeño): la latencia registrada de cada ciclo del pipeline (`fecha_fin - fecha_inicio`) es la métrica base del KPI de OT3.6 (<10 min/ciclo), expuesta directamente por `GET /analitica/pipeline/estado` sin necesitar agregación adicional.

## Reglas de Negocio

- **RN-AR-001**: Solo puede existir una versión con `estado='activo'` por `modelo` a la vez — al activar una versión nueva, la anterior pasa automáticamente a `reemplazado` en la misma transacción (mismo patrón de índice único parcial que `turno_caja` en `006-caja-mermas-fraude` y `recomendacion_precio` en `003-precios-margenes`, ver Decisión 2 de `research.md`).
- **RN-AR-002**: Si `tamano_muestra` de una versión de modelo está por debajo del umbral mínimo declarado para ese modelo, el sistema DEBE registrar la versión con `estado='descartado_datos_insuficientes'` y un `motivo` obligatorio, nunca activarla ni inventar una métrica de desempeño (Art. 5.9).
- **RN-AR-004** *(añadida en enmienda v1.1)*: `version_modelo_ml.nombre_metrica` DEBE coincidir con `modelo_ml.metrica_principal` del modelo indicado. Hoy es texto libre, así que nada impide registrar el modelo de churn con una métrica de silueta — que es de clustering y no significa nada para una clasificación. Además, comparar el desempeño de dos versiones del mismo modelo solo tiene sentido si ambas usan la misma métrica, y sin esta regla eso se cumple únicamente por disciplina.
- **RN-AR-005** *(añadida en enmienda v1.1)*: Ninguna fila de los tres catálogos se borra; baja lógica con `activo = false`. Las versiones históricas son el registro de honestidad del Art. 5.9 y deben conservar el significado de su modelo y su estado. Además `segmento_cliente` de `002-clientes-fidelizacion` referencia `version_modelo_ml`, así que romper esa cadena rompería la trazabilidad de la dimensión de cliente.
- **RN-AR-006** *(añadida en enmienda v1.1)*: Agregar un sexto modelo al catálogo NO es suficiente para incorporarlo al sistema — los cinco modelos son los del Art. 5.6 de la constitución, y sumar otro exige enmendarla (Art. 9.1). El catálogo deja de tenerlos escritos dentro de un CHECK; no relaja la constitución.
- **RN-AR-003**: Ninguna fila de `pregunta_asistente.respuesta_texto` puede registrarse sin una `consulta_generada` asociada — el asistente nunca responde sin haber ejecutado una consulta real sobre los datos (Art. 5.10, "nunca genera una cifra... que no provenga de una consulta real").

## Casos de Uso / Historias de Usuario

- **US-AR-001**: Como Dueño, quiero preguntarle al asistente qué sucursal tuvo más merma esta semana, y ver registrada la consulta estructurada real que respondió esa pregunta.
- **US-AR-002**: Como Analítica y Reportes, quiero registrar cada ejecución del DAG de Airflow, para poder auditar la latencia del pipeline contra la meta de OT3.6.
- **US-AR-003**: Como Analítica y Reportes, quiero registrar que el modelo de churn no se pudo entrenar aún por falta de datos suficientes, en vez de desplegar una versión con métricas poco confiables.

## Criterios de Aceptación

- **CA-AR-001**: Dado un `POST /analitica/modelos/versiones` con `tamano_muestra` por debajo del umbral del modelo, cuando se registra, entonces la versión queda en `estado='descartado_datos_insuficientes'`, nunca `activo` (RN-AR-002).
- **CA-AR-002**: Dada una versión de modelo activa, cuando se registra una nueva versión del mismo modelo con `estado='activo'`, entonces la versión anterior pasa a `reemplazado` en la misma operación (RN-AR-001).
- **CA-AR-003**: Dado un intento de `GET /analitica/asistente/preguntas` con un token de rol distinto de `dueno`, cuando se realiza, entonces el sistema responde `403` (RNF-AR-003).

## Entidades Clave

- `ejecucion_pipeline_etl`, `validacion_calidad_datos`, `version_modelo_ml`, `pregunta_asistente`.

## Fuera de Alcance

- El cálculo real de los 5 modelos de scikit-learn (entrenamiento, features, hiperparámetros) — vive en los scripts/notebooks de la capa estratégica; este módulo solo registra el resultado de cada corrida.
- El modelo Fact-Dim de ClickHouse en sí y los DAGs de Airflow — infraestructura de datos, no un endpoint de este módulo; este módulo es quien Airflow llama al final de cada DAG para dejar constancia operativa.
- Cualquier dashboard o reporte compuesto entre sucursales — se sirve directamente desde ClickHouse (nota metodológica del punto 7 de la cascada de objetivos), nunca desde una tabla de este módulo.

## Dependencias con Otros Módulos

- **Depende de**: `usuario` (`010-administracion`, para validar que quien pregunta al asistente es `dueno`, RNF-AR-003).
- **Consumido por**: ninguno de los módulos operativos (001-010) — este módulo es el destino final de la cadena de dependencias, no una fuente que otros módulos consulten en caliente.
