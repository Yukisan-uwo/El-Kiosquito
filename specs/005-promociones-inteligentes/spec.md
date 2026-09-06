# Especificación de Feature: Promociones Inteligentes

**Feature**: `005-promociones-inteligentes` | **Fecha**: 2026-09-04
**Departamento que aporta**: Fidelización y Clientes (`FC`)
**Deriva de**: OT2.3 (personalizar promociones según el valor real del cliente), OT2.5 (recuperar clientes en riesgo real de abandono)

## Resumen

Este es un módulo nuevo bajo la estructura mínima obligatoria: en el diseño original por departamento, el cupón vivía como una tabla más dentro de Fidelización y Clientes, junto a `cliente`/`segmento_cliente`/`evaluacion_churn`. Aquí se separa en su propio módulo porque el cupón tiene un ciclo de vida transaccional propio (`activo` → `canjeado`/`expirado`, con canje contra una venta real) que no depende de qué lo originó — cumpleaños, patrón de compra o recuperación de churn son tres disparadores distintos que terminan en el mismo mecanismo de envío/canje. Este módulo es dueño de ese mecanismo; `002-clientes-fidelizacion` sigue siendo dueño de decidir *cuándo* corresponde generar un cupón de recuperación (a través de `campana_recuperacion`).

## Escenarios de Usuario

### Historia principal

Como Encargado de Fidelización, quiero enviar cupones personalizados según el valor real del cliente y su situación (cumpleaños, patrón de compra reconocido, o riesgo real de abandono), y quiero que el sistema impida que un cupón se use dos veces o después de vencido, sin tener que revisarlo manualmente cada vez.

### Escenarios de aceptación

1. **Dado** un cliente cuya fecha de nacimiento cae en el mes actual, **cuando** se registra el envío de un cupón, **entonces** queda registrado con `tipo_origen = 'cumpleanos'`.
2. **Dado** un cliente cuyo patrón de compra activa una regla del motor de fidelización, **cuando** se registra el envío de un cupón, **entonces** queda registrado con `tipo_origen = 'patron_compra'`.
3. **Dado** una campaña de recuperación registrada en `002-clientes-fidelizacion`, **cuando** esa campaña incluye un cupón, **entonces** el cupón queda registrado con `tipo_origen = 'recuperacion_churn'` y trazable hasta la evaluación de churn que lo originó.
4. **Dado** un cupón activo y vigente, **cuando** se registra su canje en una venta, **entonces** el sistema valida que no esté ya canjeado ni vencido antes de aceptarlo.

### Casos límite (qué pasa si...)

- **¿Qué pasa si** se intenta canjear un cupón ya canjeado? → Rechazado con `422`; el estado `canjeado` es definitivo.
- **¿Qué pasa si** se intenta canjear un cupón después de su fecha de expiración? → Rechazado con `422`, sin importar que nunca se haya usado.
- **¿Qué pasa si** se genera un cupón de tipo `recuperacion_churn` sin indicar la evaluación de churn que lo originó? → Rechazado — este tipo de cupón siempre debe poder trazarse hasta su evaluación de origen (RN-PI-002).
- **¿Qué pasa si** dos cupones distintos del mismo cliente están activos al mismo tiempo? → Se permite: no hay límite de cupones activos simultáneos por cliente, cada uno vive su propio ciclo de vida de forma independiente.

## Requisitos Funcionales

- **RF-PI-001**: El sistema DEBE permitir registrar el envío de un cupón, indicando su origen (`cumpleanos`, `patron_compra` o `recuperacion_churn`).
- **RF-PI-002**: El sistema DEBE permitir registrar el canje de un cupón en una venta, validando que no esté vencido ni ya canjeado.
- **RF-PI-003**: El sistema DEBE permitir consultar los cupones (activos e históricos) de un cliente.
- **RF-PI-004**: Un cupón de tipo `recuperacion_churn` DEBE registrar la evaluación de churn (`002-clientes-fidelizacion`) que lo originó.
- **RF-PI-005** *(añadido en enmienda v1.1, normalización de catálogos)*: El origen, el tipo de descuento y el estado de un cupón DEBEN seleccionarse de sus catálogos (`tipo_origen_cupon`, `tipo_descuento`, `estado_cupon`), nunca escribirse como texto libre ni quedar fijos en el contrato de la API.
- **RF-PI-006** *(añadido en enmienda v1.1)*: El sistema DEBE rechazar un cupón cuyo `descuento_valor` supere el máximo permitido para su tipo de descuento.
- **RF-PI-007** *(añadido en enmienda v1.1)*: El sistema DEBE exponer los tres catálogos como consulta, incluyendo `es_automatico` de `tipo_origen_cupon`, que `011-analitica-reportes` necesita para calcular correctamente el indicador de OT2.3.

## Requisitos No Funcionales

- **RNF-PI-001**: Este módulo nunca escribe en `venta`/`detalle_venta` (`001-core-ventas-inventario`) ni en `cliente`/`evaluacion_churn` (`002-clientes-fidelizacion`) — solo los referencia por FK externa.
- **RNF-PI-002**: El código de un cupón (`codigo`) es único en todo el sistema.

## Reglas de Negocio

- **RN-PI-001**: Un cupón no puede canjearse más de una vez ni después de su fecha de expiración.
- **RN-PI-002**: Un cupón con `tipo_origen = 'recuperacion_churn'` siempre debe llevar `evaluacion_churn_id`. *(Enmienda v1.1)* La regla queda expresada dos veces a propósito: como CHECK de base de datos (que la impone fila por fila) y como `tipo_origen_cupon.requiere_evaluacion_churn` (que la hace consultable para los formularios). El CHECK no se sustituye por el catálogo — hacerlo debilitaría la garantía sin ganar nada.
- **RN-PI-003** *(añadida en enmienda v1.1)*: Ninguna fila de los tres catálogos se borra; baja lógica con `activo = false`. Un cupón ya emitido debe conservar el significado de su tipo de origen y de descuento.
- **RN-PI-004** *(añadida en enmienda v1.1)*: `descuento_valor` nunca puede superar el `valor_maximo_permitido` de su tipo de descuento. Hoy `descuento_valor` solo valida `>= 0`, así que un cupón de 200% de descuento se puede crear sin ningún error — el sistema terminaría pagándole al cliente por llevarse el producto.
- **RN-PI-005** *(añadida en enmienda v1.2, auditoría de riesgos derivados)*: una fila de `sugerencia_patron_compra` nunca crea un `cupon` por sí sola. El motor de asociación (`POST /promociones/sugerencias-patron/recalcular`) decide únicamente QUÉ producto sugerirle a qué cliente, basado en soporte/confianza/lift reales sobre `detalle_venta`/`venta` — nunca decide de cuánto es el descuento. `PATCH /promociones/sugerencias-patron/{id}/resolver` con `aceptar=true` exige `descuento_tipo`/`descuento_valor`/`fecha_expiracion` explícitos; sin ellos se rechaza con `422`. Antes de esta enmienda, `tipo_origen = 'patron_compra'` (Decisión 3 de `research.md`) no tenía ningún proceso real detrás — se documentaba como responsabilidad de "un proceso batch o la capa estratégica" que en la práctica no existía.

## Caso límite adicional (enmienda v1.1)

- **¿Qué pasa si** se intenta crear un cupón de `porcentaje` con `descuento_valor = 200`? → Se rechaza con `422` (RN-PI-004). Antes de esta enmienda se creaba sin ningún error, porque la única validación era `descuento_valor >= 0`.
- **¿Qué pasa si** el negocio deja de usar los cupones de cumpleaños? → Se marca `activo = false` en el catálogo, y los cupones de cumpleaños ya emitidos siguen consultándose y canjeándose con normalidad. Lo que no se permite nunca es borrar la fila (RN-PI-003).

## Entidades Clave

- **TipoOrigenCupon, TipoDescuento, EstadoCupon** *(enmienda v1.1)*: catálogos maestros. `TipoOrigenCupon` declara `es_automatico` (el denominador correcto del indicador de OT2.3) y `requiere_evaluacion_churn`; `TipoDescuento` declara el tope de valor permitido; `EstadoCupon` declara `permite_canje`.
- **Cupon**: cupón enviado a un cliente, con su origen, vigencia y estado de canje. Referencia externa a `cliente` y `evaluacion_churn` (`002-clientes-fidelizacion`) y a `venta` (`001-core-ventas-inventario`, al canjearse).
- **EstadoSugerenciaPatron, SugerenciaPatronCompra** *(enmienda v1.2)*: el motor real de detección de patrón de compra. `SugerenciaPatronCompra` guarda la salida de un cálculo de asociación de mercado (soporte/confianza/lift) sobre `detalle_venta`/`venta`: qué producto sugerirle a qué cliente y por qué, sin decidir nunca el descuento. `EstadoSugerenciaPatron` sigue el mismo patrón de catálogo que `EstadoCupon`.

## Checklist de revisión

- [ ] Todo RF tiene un endpoint correspondiente en `contracts/promociones-inteligentes.openapi.yaml`
- [ ] RN-PI-001 está implementado como validación de servicio antes del `UPDATE` de estado, con los tres estados (`activo`/`canjeado`/`expirado`) cubiertos por tests
- [ ] RN-PI-002 está implementado como CHECK de base de datos, no solo como validación de servicio
- [ ] Los 4 casos límite están cubiertos por al menos un test de contrato en `tasks.md`
- [ ] Ningún endpoint acepta origen, tipo de descuento o estado como texto libre o enum fijo (RF-PI-005, enmienda v1.1)
- [ ] Un cupón de porcentaje con valor mayor a 100 se rechaza (RN-PI-004, enmienda v1.1)
- [ ] El CHECK de RN-PI-002 sigue existiendo además del catálogo, no fue sustituido por él (enmienda v1.1)
- [ ] El motor de patrón de compra calcula soporte/confianza/lift reales sobre `detalle_venta`/`venta`, nunca sobre datos inventados (RN-PI-005, enmienda v1.2)
- [ ] `PATCH .../resolver` con `aceptar=true` sin `descuento_tipo`/`descuento_valor`/`fecha_expiracion` se rechaza con `422` (RN-PI-005)
- [ ] Un recálculo repetido no duplica una sugerencia mientras la anterior siga `pendiente` para el mismo cliente/producto (índice único parcial)
