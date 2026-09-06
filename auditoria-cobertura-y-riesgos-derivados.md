# El Kiosquito — Auditoría de cobertura (actualizada) + riesgos de segundo orden

**Fecha**: 2026-09-05 | **Contraste contra**: el estado actual de `specs/` (11 módulos, con todas las enmiendas documentadas hasta hoy) y contra `ElKiosquito_Documento_Empresa_y_Objetivos.md` (23 OT / 73 OO oficiales).

Este documento reemplaza en vigencia (no en historial — se conservan) a `auditoria-enunciado-vs-specs.md` y `comparacion-dataset-real-vs-specs.md`, ambos del 2026-09-04: casi todo lo que esos dos documentos marcaban como hueco ya se resolvió con enmiendas documentadas. Acá se deja constancia de qué quedó cerrado, qué sigue abierto, y se agrega un análisis nuevo que no estaba en ninguno de los dos: **qué problema nuevo puede generar cada solución que ya construimos** — no si algo está cubierto, sino si lo que construimos para cubrirlo introduce un riesgo distinto.

## Parte 1 — Estado actualizado de los huecos ya identificados

De los 10 huecos reales que marcaban los dos documentos previos, **8 ya están resueltos** con una enmienda documentada en el módulo correspondiente. Quedan **2 abiertos**, sin decisión tuya todavía.

| # | Hueco (documento previo) | Estado actual | Evidencia |
|---|---|---|---|
| 1 | Canales digitales en `precio_competencia` (texto libre) | ✅ Resuelto | `003`, enmienda v1.2: `fuente_competencia.canal_codigo` → FK a `canal_competencia` (normalizado a 3FN, `precio_competencia` ya no repite el canal) |
| 2 | Medir el tiempo real de cobro (OT2.2, meta <90s) | ✅ Resuelto | `001`: `venta.hora_inicio_cobro`, capturado en `POST /ventas`. Consumido en la capa táctica: `etl/etl/hechos.py` calcula `EXTRACT(EPOCH FROM fecha_hora - hora_inicio_cobro)` como duración real de cobro en `fact_venta` — el indicador de OT2.2 ya es medible de punta a punta, no aspiracional |
| 3 | Confusor "promociones" en el pronóstico de demanda | ✅ Resuelto | `etl/ml/demanda.py`: feature `promocion_activa_semana`, derivada de `fact_cupon` (al menos un cupón enviado en los 7 días previos) |
| 4 | Confusor "sustitutos" — sin tabla que lo respalde | ✅ Resuelto como dato, ⚠️ **no llega al modelo** — ver Parte 2.a | `001`: tabla `producto_sustituto` (catálogo); `004`: `demanda_insatisfecha.sustituto_ofrecido_id`/`sustituto_aceptado` (evento) |
| 5 | Confusor "estacionalidad no promocional" (clima, quincena, eventos locales) | ✅ Resuelto como dato, ⚠️ **parcial en el modelo** — ver Parte 2.a | `004`: tabla `evento_local` + catálogo `tipo_evento_local` (feriado, fiesta patronal, evento comunitario, clima extremo, corte de servicios, cada uno con `afecta_demanda_al_alza`); `dim_evento_local` en ClickHouse |
| 6 | Cuadre de caja horario real (solo se cuadra al cierre del turno) | ❌ Sigue abierto — decisión pendiente | `006`: `turno_caja` cierra una sola vez por turno completo. No hay checkpoints intermedios dentro de un turno largo |
| 7 | Sustitución de marca cuando falta stock | ✅ Resuelto | `001`: `producto_sustituto` + `POST /productos/{id}/sustitutos`; `004`: el evento de si se ofreció/aceptó el sustituto queda en `demanda_insatisfecha` |
| 8 | Layout/anaquel limitado | ❌ Sigue abierto — decisión pendiente | No aparece en ningún módulo, ni siquiera documentado como fuera de alcance explícito |
| 9 | `venta.numero_documento` (comprobante secuencial, no solo el `id`) | ✅ Resuelto | `001`: `numero_documento = 'V-' \|\| lpad(id::text, 8, '0')` |
| 10 | Venta en espera/pausada (`ospos_sales_suspended`) | ❌ Sigue abierto — de menor prioridad, no deriva de ningún OT | No implementado; el propio documento de comparación ya lo marcaba como candidato de baja prioridad |

Los dos huecos que siguen abiertos (#6 cuadre horario real y #8 layout/anaquel) ya estaban documentados como "para decidir contigo" y siguen igual — no encontré nada nuevo que cambie esa evaluación. El de venta en espera (#10) sigue siendo el de menor urgencia de los tres: no deriva de ningún objetivo táctico oficial, es una comodidad operativa del cajero.

## Parte 2 — Riesgos de segundo orden: qué problema puede generar cada solución ya construida

Esto es distinto a la Parte 1. Ahí se preguntaba "¿está cubierto el problema del enunciado?". Acá la pregunta es: **de lo que ya construimos para resolver un problema, ¿qué problema nuevo se puede colar?** Cada punto de esta sección lo verifiqué contra el código real (no es una hipótesis) — modelos, routers o el pipeline ETL, no solo contra el `spec.md`.

### a) El modelo de pronóstico de demanda no usa todos los datos que ya capturamos contra sus propios confusores

`etl/ml/demanda.py` entrena con estas features exactas: `dia_semana`, `es_fin_de_semana`, `es_quincena`, `es_feriado`, `eventos_quiebre` (demanda insatisfecha), `promocion_activa_semana`, `sucursal_id`, `producto_id`.

`es_feriado` sí se nutre de `evento_local` (vía `dim_tiempo`, solo para el tipo `'feriado'`). Pero `evento_local` también registra fiesta patronal, evento comunitario, clima extremo y corte de servicios — los otros cuatro tipos del catálogo `tipo_evento_local`, cada uno con su propio `afecta_demanda_al_alza` ya declarado como dato, no como suposición — y **ninguno de esos cuatro llega al modelo**. Tampoco llegan `sustituto_ofrecido_id`/`sustituto_aceptado` de `demanda_insatisfecha`, aunque sí llegan a `fact_demanda_insatisfecha` en ClickHouse y se cruzan correctamente en el informe compuesto de OT3.7.

**El riesgo concreto**: un día de clima extremo o de un corte de servicios en el barrio produce ventas bajas reales, no una caída de demanda genuina. Ese día ya queda bien registrado en `evento_local` — pero el modelo que debería descontarlo como confusor (Art. 5.6) lo va a leer igual que cualquier otro día flojo, exactamente la trampa que describe el problema de negocio original ("una demanda aparentemente baja podría ocultar ventas perdidas"). Construimos la tabla para resolver el confusor y el motor de features nunca la conecta.

**Para decidir**: agregar `evento_local`/`tipo_evento_local` (los 4 tipos restantes) y el par `sustituto_ofrecido`/`sustituto_aceptado` a `_FEATURES` en `etl/ml/demanda.py` es un cambio acotado — no toca esquema, ya está todo el dato ahí. Dime si avanzamos con esto o lo dejamos documentado como limitación conocida del entrenamiento actual.

### b) Una campaña de recuperación no exige que el riesgo sea real

`registrar_campana_recuperacion` (`backend/app/routers/clientes.py`) valida una sola cosa antes de crear la campaña: RN-CF-001, que el cliente no haya vuelto a comprar desde la evaluación. **Nunca verifica `evaluacion_churn.es_riesgo_real`.**

Esto importa porque el propio documento de objetivos oficial (OO-FC08) define esta operación como "Registrar el envío de una campaña de recuperación a un cliente **en riesgo real**" — el "en riesgo real" no es una frase suelta, es la condición que distingue OT2.5 ("recuperar clientes en riesgo real... **sin descuentos innecesarios**") de simplemente contactar a cualquiera que no compró en 30 días.

**El riesgo concreto**: con el guard actual, se puede registrar (y el sistema ya envía correo real, Art. 8.4) una campaña de recuperación — con cupón de descuento incluido si se quiere — para un cliente cuya evaluación de churn dice explícitamente `es_riesgo_real = false` (es decir, un cliente en su ciclo normal de compra, que iba a volver solo). Es exactamente el escenario que el enunciado original advierte como contraproducente: gastar margen en un descuento que no cambia nada porque el cliente ya iba a volver.

**Para decidir**: agregar una validación en el servicio — `if not evaluacion.es_riesgo_real: 409` — antes de crear la campaña. Es un cambio de una línea de regla de negocio, no de esquema. ¿Avanzamos?

### c) El cupón por "patrón de compra" no tiene ningún motor que lo detecte

El catálogo `tipo_origen_cupon` ya declara `patron_compra` con `es_automatico: true` (T022 de `005`), y el propio documento de objetivos define OO-FC05 — "Registrar el envío de un cupón activado por patrón de compra detectado" — como una operación de **Sistema**, no manual.

Pero no existe, en ninguno de los 5 modelos de ML (demanda, pricing, churn, anomalías de caja, segmentación de clientes), nada que detecte un patrón de compra — ni un modelo de canasta de mercado (market basket / reglas de asociación), ni ninguna otra lógica. `POST /promociones/cupones` con `tipo_origen='patron_compra'` existe y funciona, pero como **punto de entrada manual**: alguien (o un proceso externo no construido) decide que hay un patrón y llama al endpoint. No es un defecto de implementación — es que nunca se construyó el motor de detección en sí, en ningún módulo.

**Esto no es nuevo que yo lo note** — ya estaba implícito en que ningún módulo de ML hace este tipo de análisis — pero conviene dejarlo explícito porque el propio catálogo (`es_automatico: true`) y el documento de objetivos (OO-FC05 "Sistema") dan a entender que sí hay algo automático detrás, y en la sustentación un ingeniero puede pedir ver ese motor. **Para decidir**: ¿lo dejamos documentado como fuera de alcance explícito (honesto: "el disparo es manual/externo, el catálogo declara la intención de automatizarlo a futuro"), o vale la pena un modelo simple de asociación (por ejemplo, reglas de co-ocurrencia con `mlxtend` sobre `detalle_venta`) como un sexto modelo?

### d) El motor de precios dinámico no tiene un piso de margen automático

RN-PM-002 ya impide que el motor escriba directo sobre `historial_precio_producto` — toda recomendación pasa por alguien que la acepta o rechaza (Art. 5.6, ningún modelo actúa solo). Eso es una buena barrera contra el riesgo grande (que el sistema mueva un precio sin supervisión).

**El riesgo que queda**: no hay ninguna regla que impida aceptar una recomendación que deje el precio de venta por debajo del costo de reposición vigente — el humano puede aceptar una recomendación de precio "gancho" agresiva sin que el sistema le advierta que eso implica vender a pérdida. El guardrail de "nadie actúa solo" está — el de "nadie acepta un número que no tiene sentido económico" no.

**Para decidir**: es de menor urgencia que a) y b) porque siempre hay un humano en el medio, pero una advertencia (no un bloqueo — la decisión de negocio de vender a pérdida un producto gancho puntual es legítima a veces) al aceptar una recomendación por debajo del costo vigente sería barato de agregar y cierra el argumento en la sustentación.

### e) La revisión de seguridad de un datáfono no está conectada a la venta real

`datafono`/`revision_datafono` (`007`) no tienen ninguna relación con `venta` — no existe `venta.datafono_id` ni nada equivalente. El sistema registra correctamente que un datáfono está `vencido`, y lo excluye del indicador de conformidad (RN-PS-001/002) — pero una venta con `metodo_pago='tarjeta'` se puede procesar igual sin que nada en el sistema sepa (ni pueda impedir) que se hizo a través de ese terminal vencido.

**El riesgo concreto**: es justo el escenario que el problema de negocio original describe como responsabilidad legal — un datáfono desactualizado permite clonación de tarjeta, y el negocio responde por eso. Hoy el sistema documenta el problema (sabe que el datáfono está vencido) pero no lo conecta con la operación que ese conocimiento debería frenar o al menos trazar.

**Para decidir**: esto es más caro que b)/d) porque sí toca esquema — agregar `venta.datafono_id` (nullable, solo aplica a pagos con tarjeta) implica una migración y tocar el flujo de cobro del mockup de POS que ya armamos. No lo haría sin que lo decidas vos primero: ¿vale la pena para la sustentación, o lo dejamos documentado como limitación conocida (el sistema audita el datáfono pero no la traza contra la venta individual)?

## Parte 3 — Sobre la idea de imágenes de producto

Quedó anotado que la idea de agregar imágenes de producto (por ejemplo en una pantalla de inventario) es algo que planteaste para revisar más adelante, no para actuar ahora — no la construí ni la descarté, queda pendiente para cuando la retomes.

## Resumen de lo que necesito que decidas

De los 5 puntos de la Parte 2, ordenados por cuánto pesan en la sustentación vs. cuánto cuesta resolverlos:

1. **b) es_riesgo_real en campañas de recuperación** — el más barato (una validación) y el que más directamente contradice un objetivo táctico oficial (OT2.5) si queda como está.
2. **a) confusores del pronóstico sin usar** — barato (agregar features ya existentes), cierra exactamente el argumento del Art. 5.6.
3. **d) piso de margen en pricing** — barato, de menor urgencia por el guardrail humano ya existente.
4. **c) motor de detección de patrón de compra** — caro si se construye un modelo nuevo; barato si solo se documenta como fuera de alcance explícito.
5. **e) datafono_id en venta** — el más caro (migración + toca el POS), y el único de los 5 que no tiene una solución barata a mano.

Más los 2 huecos que ya venían abiertos de la Parte 1 (cuadre de caja horario real, layout/anaquel).

Decime con cuáles avanzamos y en qué orden.
