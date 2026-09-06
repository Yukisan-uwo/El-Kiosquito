# Especificación de Feature: Pronóstico de Demanda

**Feature**: `004-pronostico-demanda` | **Fecha**: 2026-09-04
**Departamentos que aportan**: Ventas y Caja (captura del evento crudo) + Analítica y Reportes (el modelo de pronóstico en sí)
**Deriva de**: OT3.7 (capturar al menos el 80% de la demanda insatisfecha real), OT4.1 (pronosticar demanda para reducir quiebres de stock y compras innecesarias)

## Resumen

Este es un módulo nuevo bajo la estructura mínima obligatoria: no existía como unidad propia en el diseño original por departamento, donde la captura del evento vivía dentro de Ventas y Caja y el resultado del modelo era apenas un stub sin tabla dentro de Compras y Proveedores. Aquí se juntan ambas piezas porque tienen la misma cadena causal: sin `demanda_insatisfecha` capturada en el punto de venta no hay dato de entrada para entrenar el modelo, y sin un resultado de pronóstico persistido y auditable no tiene sentido seguir teniendo el stub que usaba `003-compras-proveedores` (ahora `008-compras-proveedores`) para su regla `RN-CP-001`. Es dueño de dos cosas: el registro crudo de "producto pedido sin stock" y el historial append-only de resultados del modelo de pronóstico de demanda (OT4.1).

## Escenarios de Usuario

### Historia principal

Como Cajero, quiero poder anotar en segundos cuando un cliente pide un producto que no tengo en stock, sin que eso interrumpa la fila. Como Encargado de Compras, quiero poder consultar qué cantidad recomienda el pronóstico de demanda para un producto antes de aprovechar una oferta de proveedor, y que quede claro cuándo el sistema todavía no tiene suficiente historial para pronosticar.

### Escenarios de aceptación

1. **Dado** que un cliente pregunta por un producto sin stock disponible, **cuando** el cajero registra el evento, **entonces** el sistema guarda la demanda insatisfecha (producto, sucursal, hora del evento) sin necesidad de que exista una venta asociada.
2. **Dado** que el cajero no alcanzó a registrar el evento en el instante exacto, **cuando** lo registra minutos después, **entonces** el sistema acepta una `hora_evento` distinta a la hora de creación del registro.
3. **Dado** un ciclo de entrenamiento del modelo de pronóstico de demanda, **cuando** se registra su resultado, **entonces** el sistema exige tamaño de muestra y periodo cubierto (Art. 5.9) antes de aceptar la fila.
4. **Dado** un producto/sucursal con un pronóstico ya calculado, **cuando** `008-compras-proveedores` lo consulta para decidir sobre una compra por oferta, **entonces** el sistema devuelve la cantidad recomendada más reciente.
5. **Dado** un producto/sucursal sin ningún pronóstico calculado todavía, **cuando** se consulta, **entonces** el sistema declara explícitamente que no hay datos suficientes — nunca inventa una cantidad recomendada.

### Casos límite (qué pasa si...)

- **¿Qué pasa si** el mismo cajero registra dos eventos de demanda insatisfecha del mismo producto en la misma hora? → Se permite: cada solicitud de un cliente distinto es un evento independiente, el sistema no deduplica por producto/hora.
- **¿Qué pasa si** un producto tiene demanda insatisfecha registrada pero nunca se calculó su pronóstico? → Las dos cosas son independientes: `demanda_insatisfecha` es el insumo crudo, `pronostico_demanda` es el resultado del modelo; puede existir la una sin la otra.
- **¿Qué pasa si** `008-compras-proveedores` consulta el pronóstico de un producto sin historial suficiente? → Recibe `datos_suficientes: false`; según su propia regla `RN-CP-001`, eso no bloquea la orden pero exige que quien decide igual documente el motivo si excede lo razonable.

## Requisitos Funcionales

- **RF-PD-001**: El sistema DEBE permitir registrar un evento de demanda insatisfecha (producto, sucursal, cajero) de forma independiente de cualquier venta.
- **RF-PD-002**: El registro de demanda insatisfecha DEBE aceptar una `hora_evento` distinta a la hora de creación del registro (registro diferido).
- **RF-PD-003**: El sistema DEBE permitir consultar el histórico de demanda insatisfecha de un producto/sucursal en un rango de fechas, como insumo para el modelo de pronóstico.
- **RF-PD-004**: El sistema DEBE permitir registrar un ciclo de pronóstico de demanda calculado por el modelo (Sistema), con tamaño de muestra y periodo cubierto obligatorios.
- **RF-PD-005**: El sistema DEBE exponer el pronóstico más reciente de un producto/sucursal; si nunca se calculó, DEBE declararlo explícitamente en vez de omitir el campo o devolver cero.
- **RF-PD-006** *(añadido en enmienda v1.1, auditoría enunciado-vs-specs)*: El registro de un evento de demanda insatisfecha DEBE permitir indicar, opcionalmente, si se ofreció un producto sustituto (`producto_sustituto` de `001-core-ventas-inventario`) y si el cliente lo aceptó — el enunciado pide que el pronóstico descuente confusores, y "se resolvió con un sustituto" es información distinta de "se perdió la venta por completo".
- **RF-PD-007** *(añadido en enmienda v1.1)*: El sistema DEBE permitir registrar un evento local (feriado, fiesta patronal, evento comunitario, clima extremo) que pueda afectar la demanda de una fecha, como insumo adicional del modelo de pronóstico — el confusor de "estacionalidad no promocional" no se puede derivar solo de la fecha calendario.
- **RF-PD-008** *(añadido en enmienda v1.1)*: El sistema DEBE permitir consultar los eventos locales registrados en un rango de fechas, opcionalmente filtrados por sucursal.
- **RF-PD-009** *(añadido en enmienda v1.2, normalización de catálogos)*: El tipo de un evento local DEBE seleccionarse del catálogo `tipo_evento_local`, que declara para cada tipo si su efecto esperado sobre la demanda es al alza o a la baja.
- **RF-PD-010** *(añadido en enmienda v1.2)*: El sistema DEBE exponer el catálogo `tipo_evento_local` como consulta, para que el modelo de pronóstico lea el signo esperado de cada tipo en vez de inferirlo de los datos.

## Requisitos No Funcionales

- **RNF-PD-001**: El registro de un evento de demanda insatisfecha DEBE tomar menos de 10 segundos de principio a fin (mismo umbral operativo que ya exigía Ventas y Caja, OT3.7 se mide sobre ≥80% de captura, no 100%).
- **RNF-PD-002**: `pronostico_demanda` es append-only, cada fila con `tamano_muestra` y `periodo` obligatorios (Art. 5.9); ningún endpoint expone `UPDATE`/`DELETE` sobre pronósticos ya registrados.

## Reglas de Negocio

- **RN-PD-001**: Ningún producto/sucursal sin ciclo de pronóstico calculado recibe una cantidad recomendada inventada — la ausencia se declara explícitamente como `datos_suficientes: false`.
- **RN-PD-002** *(añadida en enmienda v1.2)*: Ninguna fila de `tipo_evento_local` se borra; baja lógica con `activo = false`. Los eventos históricos registrados con ese tipo son insumo permanente del modelo y deben conservar su significado.
- **RN-PD-003** *(añadida en enmienda v1.2)*: El signo del efecto de un evento sobre el pronóstico DEBE tomarse de `tipo_evento_local.afecta_demanda_al_alza`, nunca inferirse de los datos históricos del propio evento. Con pocos eventos por tipo, esa inferencia es poco confiable y contradice el propósito del Art. 5.6 de descontar confusores con información conocida, no adivinada.

## Nota sobre confusores del pronóstico (enmienda v1.1)

El Art. 5.6 de la constitución compromete un modelo de pronóstico "considerando confusores: promociones, sustitutos, estacionalidad, demanda insatisfecha". Esta enmienda documenta explícitamente de dónde sale cada uno:

| Confusor | Fuente de datos | Requiere tabla nueva aquí |
|---|---|---|
| Demanda insatisfecha | `demanda_insatisfecha` (este módulo, ya existía) | No |
| Sustitutos | `producto_sustituto` (`001-core-ventas-inventario`) + `sustituto_ofrecido_id`/`sustituto_aceptado` de `demanda_insatisfecha` (RF-PD-006) | Sí (campos) |
| Promociones pasadas | `cupon` de `005-promociones-inteligentes`, consultado por fecha/producto al entrenar (solo lectura, sin FK — el modelo corre en la capa estratégica y consulta ambas bases) | No |
| Estacionalidad — quincena/mes | Se deriva directamente de la fecha de cada venta/evento, sin necesidad de tabla | No |
| Estacionalidad — eventos locales/clima puntual | `evento_local` (RF-PD-007/008, este módulo) | Sí (tabla nueva) |

## Entidades Clave

- **DemandaInsatisfecha**: sucursal, producto, hora del evento (puede diferir de la hora de registro), cajero que lo registró, y desde la enmienda v1.1, si se ofreció/aceptó un sustituto.
- **PronosticoDemanda**: resultado append-only del modelo de pronóstico, por producto/sucursal, con tamaño de muestra, periodo y cantidad recomendada.
- **EventoLocal** *(enmienda v1.1)*: fecha/rango, tipo y descripción de un evento que puede afectar la demanda, no derivable del calendario.
- **TipoEventoLocal** *(enmienda v1.2)*: catálogo de tipos de evento, cada uno con el signo esperado de su efecto sobre la demanda (`afecta_demanda_al_alza`).

## Checklist de revisión

- [ ] Todo RF tiene un endpoint correspondiente en `contracts/pronostico-demanda.openapi.yaml`
- [ ] Ninguna consulta de pronóstico sin datos suficientes devuelve una cantidad recomendada inventada (RN-PD-001)
- [ ] `pronostico_demanda` nunca se implementó con `UPDATE` sobre una fila existente (RNF-PD-002)
- [ ] Los 3 casos límite están cubiertos por al menos un test de contrato en `tasks.md`
- [ ] `sustituto_ofrecido_id`/`sustituto_aceptado` y `evento_local` están documentados como fuente de los confusores del Art. 5.6 (enmienda v1.1)
- [ ] Ningún endpoint acepta el tipo de evento como texto libre (RF-PD-009, enmienda v1.2)
- [ ] El signo del efecto se lee del catálogo, no se infiere de los datos (RN-PD-003, enmienda v1.2)
