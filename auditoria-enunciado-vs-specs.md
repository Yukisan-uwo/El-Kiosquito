# Auditoría: Enunciado del Examen vs. Especificaciones Construidas

**Fecha**: 2026-09-04 | **Contraste contra**: los 11 módulos de `Proyecto El Kiosquito/specs/` (001 a 011)
**Fuente del enunciado**: lista de "problemas de negocio identificados" derivada del enunciado original (`claude/el-kiosquito-cascada-objetivos.md`, sección 5) más los huecos adicionales que confirmaste explícitamente al inicio del proyecto.

## 1. Problemas explícitos del enunciado (12)

| # | Problema del enunciado | Estado | Módulo(s) / evidencia |
|---|---|---|---|
| 1 | Comparación de precios en tiempo real (tiendas, supermercado, competencia local, canales digitales) | ⚠️ Parcial | `003-precios-margenes`: `precio_competencia` (RF-PM-005/006) registra fuente/precio/fecha y expone `GET /precios/{id}/comparativa-competencia`. **Pero** `fuente` es texto libre — no distingue estructuralmente "tienda física" de "canal digital", así que no se puede filtrar/reportar por tipo de canal sin parsear texto |
| 2 | Velocidad de cobro y adopción de pago electrónico | ⚠️ Parcial | `001-core-ventas-inventario`: `venta.metodo_pago CHECK IN ('efectivo','tarjeta','electronico')` sí permite calcular % de adopción electrónica (OT2.2, meta ≥60%). **Pero** no existe ningún campo que mida la duración real del cobro (`venta.fecha_hora` es un único timestamp de cierre) — la meta de OT2.2 (<90 seg) no tiene cómo medirse con el esquema actual |
| 3 | Precios dinámicos por margen (productos gancho vs. nicho) | ✅ Cubierto | `003-precios-margenes`: `clasificacion_producto` (RF-PM-007), `recomendacion_precio` con motor dinámico (RF-PM-008/009) |
| 4 | Fidelización personalizada, valor de cliente ≠ solo gasto acumulado | ✅ Cubierto | `002-clientes-fidelizacion`: `segmento_cliente` (K-Means: frecuencia + margen + recencia, OO-FC03) |
| 5 | Alertas de caducidad de perecederos | ✅ Cubierto | `001-core-ventas-inventario`: `lote_producto`, `GET /inventario/proximos-a-caducar` (OO-IN04) |
| 6 | Pronóstico de demanda que descuenta confusores (promociones pasadas, ausencia de sustitutos, disponibilidad circunstancial, quiebres relacionados) | ⚠️ Parcial (gap real) | `004-pronostico-demanda`: `demanda_insatisfecha` cubre bien el confusor "quiebre de stock". **Pero** `pronostico_demanda` no tiene ningún campo ni FK que conecte con datos de promociones (`005-promociones-inteligentes.cupon`), sustitutos, o estacionalidad — esos tres confusores están mencionados como intención en la Constitución (Art. 5.6) pero no tienen una fuente de datos operativa documentada en ningún módulo |
| 7 | Demanda insatisfecha no capturada (ventas perdidas por quiebre de stock) | ✅ Cubierto | `004-pronostico-demanda`: `demanda_insatisfecha`, RF-PD-001/002, registrado desde el POS de `001` |
| 8 | Stock muerto por decisiones de compra mal informadas (oferta de proveedor sin validar demanda) | ✅ Cubierto — el escenario insignia del proyecto | `001` (OO-IN08/09, sin rotación) + `008-compras-proveedores` (RN-CP-001, validación obligatoria de pronóstico antes de aceptar compra por oferta) |
| 9 | Mermas no controladas (hasta 20% de la ganancia anual) | ✅ Cubierto | `006-caja-mermas-fraude`: `merma`, causa obligatoria (Art. 4.2) |
| 10 | Fraude interno detectable solo con cuadre de caja horario | ⚠️ Parcial (gap real) | `006-caja-mermas-fraude`: `turno_caja` cierra con diferencia calculada e `incidencia_cuadre_caja` (Isolation Forest). **Pero** el cuadre es por turno completo (apertura/cierre una vez por cajero), nunca dentro del turno — un fraude a media mañana en un turno de 8 horas no se detectaría hasta el cierre. La cascada de objetivos (OT3.1) dice literalmente "cuadre de caja horario"; el diseño actual no tiene checkpoints intermedios |
| 11 | Seguridad de pagos (datáfonos desactualizados, clonación de tarjetas, responsabilidad legal) | ✅ Cubierto | `007-pagos-seguridad`: `datafono`/`revision_datafono`; `006`: `alerta_fraude_pago`; Art. 10.8 (solo últimos 4 dígitos) |
| 12 | Churn ambiguo (30 días: ciclo normal vs. abandono real) | ✅ Cubierto | `002-clientes-fidelizacion`: `evaluacion_churn`, `campana_recuperacion`, Art. 4.6 |

## 2. Huecos adicionales que confirmaste incorporar (6)

| # | Hueco adicional | Estado | Módulo(s) / evidencia |
|---|---|---|---|
| 13 | Costo de reposición variable del proveedor (margen real vs. teórico) | ✅ Cubierto | `008-compras-proveedores`: `historial_costo_producto` → `003-precios-margenes`: margen real (RF-PM-003) |
| 14 | Fraccionamiento de producto (venta suelta rompe conteo por unidad de fábrica) | ✅ Cubierto | `001`: `producto.es_fraccionable`/`factor_conversion`, OO-VC05 |
| 15 | Sustitución de marca cuando falta stock | ❌ No cubierto | Ningún módulo tiene una tabla de tipo `producto_sustituto` ni un endpoint que sugiera un reemplazo al momento de un quiebre de stock. `demanda_insatisfecha` registra que faltó el producto, pero no si se ofreció/aceptó un sustituto |
| 16 | Estacionalidad no promocional (clima, quincena, eventos locales) | ❌ No cubierto | No existe ninguna tabla que capture "evento local" (una fecha no se puede derivar por sí sola de un festival de barrio o un cambio de clima); la única mención es "estacionalidad de costos" en el `plan.md` de `008`, que es un concepto distinto (variación de costo de compra, no de demanda) |
| 17 | Robo externo vs. error humano vs. fraude interno como causas separadas de merma | ✅ Cubierto | `006`: `merma.causa CHECK IN ('robo_externo','error_humano','fraude_interno','caducidad')` |
| 18 | Layout/anaquel limitado | ❌ No cubierto | No aparece en ningún módulo — ni como tabla, ni como campo, ni siquiera mencionado en un `spec.md` como fuera de alcance explícito |

*(Descartado por decisión tuya explícita, no aplica auditar: fiado/crédito informal a clientes)*

## 3. Restricción de originalidad y criterios de evaluación del ingeniero

- **No repetir estructura de compañeros**: cada módulo tiene su propio `research.md` con decisiones de diseño justificadas contra el negocio real de El Kiosquito (nunca genéricas) — cumplido de forma sistemática en los 11 módulos.
- **"Operativo" = INSERT/UPDATE/DELETE o consulta puntual, sin aprobaciones simuladas** (Art. 8.6): verificado módulo por módulo — ningún flujo de activación/aceptación se modeló como aprobación gerencial no pedida (turno de caja, activación de sucursal, resolución de recomendación de precio son todos automáticos o de un solo paso).
- **Documentos de negocio reales, no solo columnas sueltas**: cada módulo tiene `spec.md` con historias de usuario, criterios de aceptación y casos límite — no son solo tablas.

## 4. Los 6 gaps reales, para decidir contigo

Ninguno de estos rompe lo ya construido — son extensiones. Antes de tocar cualquier spec ya entregada, prefiero que decidas qué hacer con cada uno:

1. **Canales digitales en `precio_competencia`** — ¿agregar un campo `tipo_canal CHECK IN ('tienda_fisica','supermercado','canal_digital')` en `003-precios-margenes`, o dejar `fuente` como texto libre y documentarlo como decisión aceptada?
2. **Medir tiempo de cobro** — ¿agregar `hora_inicio_cobro` a `venta` en `001-core-ventas-inventario`, o dejar la meta de OT2.2 como aspiracional sin medición directa (documentando por qué)?
3. **Confusores del pronóstico** (promociones/sustitutos/estacionalidad) — ¿documentar en `004-pronostico-demanda` que el modelo consulta `005` (cupones activos) como feature, y dejar sustitutos/estacionalidad fuera de alcance explícito por ahora, o modelarlos?
4. **Cuadre de caja horario real** — ¿agregar una tabla de checkpoints intermedios dentro de un turno largo (p. ej. `arqueo_parcial_turno`), o reinterpretar "horario" como "durante el horario de atención, una vez por turno" y dejarlo documentado así en `006`?
5. **Sustitución de marca** — ¿es un módulo/tabla nuevo que quieras agregar, o queda fuera de alcance explícito del examen?
6. **Layout/anaquel** — ¿lo dejamos fuera de alcance explícito (documentado, no solo omitido), o quieres una tabla mínima para asignación de espacio en anaquel?

Dime con cuáles quieres que avancemos y en qué orden, y seguimos igual que con el resto de módulos: una decisión a la vez, documentada en `research.md`.
