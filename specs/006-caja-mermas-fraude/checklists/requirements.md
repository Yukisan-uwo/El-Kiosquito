# Checklist de Requisitos: Caja, Mermas y Fraude

**Feature**: `006-caja-mermas-fraude` | **Fecha**: 2026-09-04

## Trazabilidad

- [ ] Todo RF-CMF-XXX tiene al menos un endpoint en `contracts/caja-mermas-fraude.openapi.yaml`
- [ ] Todo endpoint tiene al menos un test de contrato en `tasks.md` (Fase 2)
- [ ] Todo RF/RNF/RN es trazable a OT2.2/OT3.4/OT4.4 de la cascada de objetivos (departamentos Ventas y Caja / Prevención de Pérdidas y Seguridad, Art. 7.4 de la constitución)

## Cumplimiento de constitución

- [ ] `turno_caja` nunca se reabre ni se edita una vez `cerrado` (Art. 10.5, RNF-CMF-001)
- [ ] `incidencia_cuadre_caja` nunca modifica `turno_caja`, aunque estén en el mismo módulo (Art. 5.6, RNF-CMF-002)
- [ ] `alerta_fraude_pago` nunca almacena el número completo de una tarjeta (Art. 10.8, RNF-CMF-003)
- [ ] La escritura cruzada de `alerta_fraude_pago` (INSERT desde `001-core-ventas-inventario`, UPDATE desde este módulo) está documentada explícitamente y es la única del proyecto (Art. 4, Decisión 3 de `research.md`)
- [ ] Los puntos de control horario no tienen ningún endpoint de creación accesible por un rol humano (RN-CMF-006, enmienda v1.1) — ver T013b/T018b

## Casos límite cubiertos

- [ ] Merma sin causa asignada no puede recibir resultado de investigación (RN-CMF-003)
- [ ] Alerta de fraude ya atendida no puede volver a atenderse (RN-CMF-004)
- [ ] Dos cajeros de la misma sucursal pueden tener turnos abiertos simultáneos, cada uno con su propio cuadre
- [ ] Venta anulada después del cierre de su turno no reabre el cuadre ya cerrado
- [ ] Merma con cantidad o valor estimado en cero se rechaza
- [ ] No se genera un punto de control de un turno ya cerrado (enmienda v1.1) — ver T013b
- [ ] El cuadre al cierre del turno usa las ventas completas del turno, no el último checkpoint (enmienda v1.1, caso límite de `spec.md`)

## Enmienda v1.1 (auditoría enunciado-vs-specs)

- [ ] La brecha de "cuadre de caja con checkpoints intermedios, no solo por turno completo" está resuelta con `punto_control_horario_turno`, generado sin ninguna acción del cajero (RF-CMF-012/013)
- [ ] El job que genera los checkpoints agrega exclusivamente datos reales ya registrados (`venta`), nunca datos simulados o inventados

## Enmienda v1.2 (normalización de catálogos)

- [ ] Ningún endpoint acepta causa, resultado ni estados como enum fijo del contrato (RF-CMF-014) — ver T031
- [ ] `causa_merma` declara `es_atribuible_a_persona`, con `error_humano`/`fraude_interno` en `true` y `robo_externo`/`caducidad` en `false` (RF-CMF-015) — ver T032
- [ ] `GET /mermas?atribuible_a_persona=true` devuelve solo las mermas con responsable interno (RF-CMF-016) — ver T033
- [ ] **El filtro se implementa como JOIN contra el catálogo, nunca como lista de códigos en el servicio** (RN-CMF-007) — ver T039. Es la regla más fácil de romper por comodidad al escribir la consulta
- [ ] Agregar una causa nueva la clasifica bien en todos los informes sin tocar consultas ni esquema — ver T034
- [ ] El informe de OT3.4 de `011-analitica-reportes` lee `es_atribuible_a_persona` del catálogo y no reimplementa la clasificación — ver T040
- [ ] `estado_alerta` y `estado_incidencia` siguen siendo dos catálogos distintos, no uno compartido (Decisión 6B) — ver T036
- [ ] `estado_turno.admite_ventas` está poblado y `001-core-ventas-inventario` lo usa en vez del literal `'abierto'` — ver T035
- [ ] Ningún router expone `DELETE` sobre los 5 catálogos (RN-CMF-008) — ver T037
- [ ] Los 5 catálogos tienen seed dentro de su propia migración Alembic (T030)

## Enmienda v1.3 (auditoría de riesgos derivados, 2026-09-05)

- [ ] Existe una forma real, voluntaria, de contar la caja físicamente a mitad de turno (`arqueo_parcial_turno`), distinta y complementaria a los checkpoints automáticos de `punto_control_horario_turno` — la Decisión 5 de la enmienda v1.1 excluyó el conteo obligatorio, no la posibilidad de un conteo real
- [ ] `POST /caja/turnos/{turno_id}/arqueos-parciales` exige `motivo_diferencia` en cuanto `monto_contado` no coincide con `monto_esperado_acumulado` (RN-CMF-009), igual que ya exige `TurnoCajaCerrarIn` al cerrar turno
- [ ] Tanto el cajero (cuenta su propia caja) como el encargado de sucursal (spot-check de supervisión) pueden registrar un arqueo parcial; `encargado_compras` solo lee (permisos del recurso `arqueo_parcial`)
- [ ] `arqueo_parcial_turno` es estrictamente append-only, sin `PATCH`/`DELETE`, igual que `turno_caja` cerrado y que `punto_control_horario_turno`

## Fuera de alcance (documentado, no pendiente)

- [ ] La implementación del modelo de detección de anomalías en sí (Isolation Forest) — depende del módulo de Analítica y Reportes (pendiente); este módulo solo persiste sus incidencias
- [ ] Pago mixto efectivo+tarjeta — confirmado fuera de alcance en el diseño original de Ventas y Caja
