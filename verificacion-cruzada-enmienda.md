# El Kiosquito — Verificación Cruzada de la Enmienda Transversal de Catálogos

**Fecha**: 2026-09-04 | **Alcance**: los 11 módulos de `specs/` + la constitución
**Resultado**: enmienda completa y coherente. Se encontraron y corrigieron 3 desviaciones en los módulos y **7 fallas reales en la constitución**, que motivan la versión 1.2.0.

---

## 1. Verificación mecánica de los 11 módulos

| Comprobación | Resultado |
|---|---|
| CHECK de vocabulario huérfanos (sin convertir a FK) | **0** — los 33 convertidos |
| Contratos OpenAPI que parsean correctamente | **11 de 11** (119 rutas en total) |
| Enums fijos de negocio restantes en los contratos | **0** tras corregir uno (ver §2) |
| Módulos con tarea de migración que incluye el seed | **11 de 11** |
| Módulos con la regla de baja lógica documentada | **11 de 11** tras corregir dos (ver §2) |
| Tablas SCD tipo 2 con índice único parcial | **2 de 2** (`segmento_cliente`, `producto_clasificacion_historial`) |

**Catálogos creados, por módulo**: 001 → 5, 002 → 1, 003 → 5, 004 → 1, 005 → 3, 006 → 5, 007 → 1, 008 → 2, 009 → 2, 010 → 5, 011 → 3. **Total: 33.**

El diseño original preveía 32; el 33 es `fuente_competencia` en 003, aprobado durante la ejecución al detectarse que el nombre del competidor era texto libre.

---

## 2. Desviaciones encontradas en los módulos y corregidas

**1. Un enum desalineado con su catálogo (003).** `PATCH /precios/recomendaciones/{id}/resolucion` seguía declarando `decision: enum [aceptada, rechazada]` en el contrato, pese a que esos valores ya viven en `estado_recomendacion`. Era el único enum de negocio que quedaba sin alinear. Corregido: ahora referencia el catálogo y exige un estado final.

**2 y 3. Regla de baja lógica solo en el `spec.md` (004 y 006).** En ambos módulos la regla estaba como RN (RN-PD-002 y RN-CMF-008) pero no aparecía en las notas de integridad del `data-model.md`, que es donde la busca quien implementa la migración. Agregada en los dos, con el motivo concreto en cada caso: en 004, borrar un tipo de evento degrada el entrenamiento del modelo hacia atrás; en 006, borrar una causa de merma hace perder justamente los casos ya investigados del cruce de OT3.4.

**Un enum que se deja a propósito**: `formato: [json, csv]` en `GET /admin/auditoria` (010). Es un formato de exportación técnico, no un vocabulario de negocio — no corresponde catalogarlo.

---

## 3. Fallas encontradas en la constitución

La constitución v1.1.0 tenía siete problemas. Ninguno se había detectado antes porque solo se hacen visibles al contrastarla contra los 11 módulos ya escritos.

### Contradicciones (el texto se desmiente a sí mismo)

**1. El artículo de gobernanza declaraba una versión que ya no era cierta.** El Art. 9.2 decía `**Versión 1.0.0 | Ratificada: 04 de septiembre de 2026**`, mientras que los artículos 5.6 y 5.10 declaran explícitamente "Enmendado en v1.1.0" y "nuevo en v1.1.0". El documento afirmaba ser 1.0.0 y a la vez contener enmiendas de 1.1.0.

Es la falla más delicada de las siete: el Art. 9.1 exige que toda enmienda quede registrada con una versión numerada, y precisamente ese registro era el que faltaba. **Corregido**: el Art. 9.2 pasa a ser un historial de versiones con las tres (1.0.0, 1.1.0, 1.2.0) y el detalle de qué cambió en cada una.

**2. Meta de modelos de ML en contradicción directa.** El Art. 12.1 fijaba "modelos de ML en producción **≥3**", mientras que el Art. 5.6 compromete **cinco** modelos y el OT4.1 de la cascada de objetivos fija la meta en **≥5**. Un evaluador que compare la constitución con la cascada encuentra dos números distintos para el mismo indicador. **Corregido a ≥5**, citando el Art. 5.6.

**3. Referencia cruzada rota.** El Art. 5.10 remitía a "Art. 4.2 de auditoría inmutable" — pero el Art. 4.2 es la regla de causas de merma; la auditoría inmutable es el **Art. 10.5**. **Corregido.**

### Imprecisiones frente al modelo ya construido

**4. El Art. 4.2 describía mal las causas de merma.** Decía "una de estas **tres** categorías: robo externo, error humano, o fraude interno (además de caducidad, que se gestiona por su propio flujo)". El modelo tiene **cuatro** causas en un solo catálogo, y la caducidad no tiene un flujo separado: es una causa más de `causa_merma`.

**Reescrito**, remitiendo al catálogo e incorporando `es_atribuible_a_persona` — que es lo que separa dos respuestas de negocio distintas y no debe rehacerse enumerando códigos en cada consulta.

**5. El Art. 3.3 definía el scoping solo por la negativa.** Decía qué no pueden ver el Encargado de Sucursal y el Cajero, pero no nombraba el alcance de cadena de los otros dos roles, que quedaba implícito en el código. **Ampliado**: el alcance es ahora un dato del catálogo `rol`, con el motivo explícito — un rol nuevo que quede fuera de una lista escrita a mano no produce ningún error, simplemente queda sin scoping, viendo toda la red.

### Defecto de forma

**6. Numeración rota en el Artículo 5.** El apartado 5.10, agregado en la enmienda v1.1.0, quedó insertado **entre 5.6 y 5.7**. El artículo se leía 5.6 → 5.10 → 5.7 → 5.8 → 5.9. **Reubicado** después de 5.9.

**7. Faltaba la regla que rige los 33 catálogos.** El Art. 1.1 establece que la constitución contiene las reglas *transversales* a todo el proyecto. La convención de datos maestros que acabamos de aplicar en los 11 módulos — clave natural, seed en la migración, baja lógica, atributos con significado — es transversal por definición, y no estaba en ninguna parte. Sin ella, un módulo futuro puede volver legítimamente a usar `CHECK` o texto libre.

**Agregado el Artículo 13.**

---

## 4. Artículo 13 — Datos Maestros y Catálogos (resumen)

Nueve apartados. Los que no son obvios:

- **13.4 — un catálogo lleva atributos, no solo código y etiqueta.** Es lo que separa esta enmienda de una normalización cosmética. Una regla expresada como dato se decide una vez, al insertar la fila; expresada como filtro repetido en las consultas, se decide cada vez que alguien escribe una, y basta un olvido para que un informe mienta sin avisar.
- **13.6 — un catálogo no es permiso para ampliar el sistema.** Sacar los cuatro roles o los cinco modelos de un `CHECK` los hace configurables, no ilimitados: insertar una fila no incorpora el valor, eso sigue exigiendo una enmienda. Un catálogo invita justamente a pensar lo contrario, por eso queda escrito.
- **13.7 — catalogar un campo no cambia quién lo escribe.** Un estado derivado sigue siendo derivado; los catálogos de gobernanza son de solo lectura porque un endpoint que cree roles en caliente es una vía de escalación de privilegios.
- **13.8 — qué NO se cataloga**, con el criterio: si el conjunto de valores crece con el desarrollo del propio sistema y una entrada no registrada rompería la función del campo (la acción del log de auditoría, la regla de validación del pipeline), queda como texto libre. Catalogarlos convertiría la auditoría en un punto de fallo.
- **13.9 — SCD tipo 2**, con la aclaración de que la forma la dicta cómo esté modelada cada tabla: si ya es append-only basta con hacer su vigencia explícita; si guarda solo el estado vigente, hace falta tabla de historia aparte. No se impone una solución única, porque los dos casos aparecieron en este mismo proyecto.

---

## 5. Estado final

- **11 módulos** con la enmienda aplicada y sus 8 artefactos actualizados.
- **33 catálogos** maestros, **2 dimensiones SCD tipo 2**, **119 rutas** de API en contratos que parsean.
- **Constitución v1.2.0**, con historial de versiones y el Artículo 13.
- Respaldos en `.specify/memory/`: `constitution.BACKUP-v1.1.0.md` y `constitution.BACKUP-pre-speckit-real.md`.

**Lo que queda pendiente y por qué no se hizo aquí:**

1. **RN-AD-001 sigue aplicándose en el servicio** (010). Llevarla a la base con una FK compuesta daría garantía a nivel de motor, coherente con lo que el proyecto prefiere en todos los casos análogos, pero exige una columna redundante y cambia dónde se aplica una regla ya aprobada. Documentada como mejora disponible.
2. **RN-ES-001 no se relajó** (009). `es_bloqueante` habilitaría activar una sucursal con los ítems no críticos pendientes, pero eso es una regla de negocio nueva que nadie pidió. Hay un test de no-regresión que verifica que no se relajó.
3. **La tabla de informes** (`informes-simples-vs-compuestos.md`) sigue vigente: los 33 catálogos son las dimensiones que allí se listaban, y ahora existen en la BDR, así que el ETL las copia en vez de inventarlas. Las únicas que siguen generándose por script son `dim_tiempo` y `dim_hora`.

*Verificación hecha contrastando los 11 `data-model.md`, los 11 contratos OpenAPI (parseados con `yaml.safe_load`), los 11 `tasks.md` y la constitución. Las tres desviaciones de módulo y las siete fallas de constitución están corregidas en los archivos entregados.*
