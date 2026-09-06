# Especificación de Funcionalidad: Expansión y Sucursales

**Feature**: `009-expansion-sucursales` | **Fecha**: 2026-09-04
**Estado**: Borrador inicial | **Entrada**: `claude/el-kiosquito-cascada-objetivos.md` (OT3.5, Departamento Expansión y Sucursales), `claude/el-kiosquito-constitution.md` (Art. 2.4)

## Resumen Ejecutivo

Módulo dueño de `sucursal` y del proceso estructurado de apertura de una nueva tienda: checklist de apertura, herencia de catálogo y precios base de la cadena, asignación de personal inicial y activación. `sucursal` es, junto con `usuario` (`010-administracion`), una de las dos tablas que los ocho módulos ya entregados (001-008) referencian constantemente como FK externa sin que ningún módulo la haya definido nunca — este módulo resuelve esa deuda (ver Decisión 1 de `research.md`).

## Contexto de Negocio

El Art. 2.4 de la constitución es explícito: "toda sucursal nueva se incorpora mediante un proceso estructurado de apertura... el alta de una sucursal NUNCA debe tratarse como una inserción manual sin checklist ni herencia de catálogo/precios base". La cascada de objetivos asigna a este departamento un único objetivo táctico, OT3.5 ("estandarizar la apertura de nueva sucursal", meta <15 días desde registro hasta operativa), bajo el OE3 (Perspectiva Procesos Internos) — la apertura es un proceso operativo estandarizado entre sucursales, no una decisión estratégica aislada de cada tienda.

## Requisitos Funcionales

- **RF-ES-001**: El sistema DEBE permitir registrar una nueva sucursal con nombre y dirección, quedando en estado `en_apertura` (OO-ES01).
- **RF-ES-002**: Al registrar una sucursal, el sistema DEBE generar automáticamente las filas del checklist de apertura con sus 8 ítems fijos, todas en `completado=false` (OO-ES02).
- **RF-ES-003**: El sistema DEBE permitir marcar un ítem del checklist de apertura como completado, registrando quién y cuándo (OO-ES02).
- **RF-ES-004**: El sistema DEBE permitir ejecutar la herencia del catálogo de productos y precios base de la cadena hacia la nueva sucursal, una única vez por sucursal (OO-ES03).
- **RF-ES-005**: El sistema DEBE permitir asignar personal (cajero, encargado de sucursal) a una sucursal en apertura, delegando en `010-administracion` el mecanismo real de asignación (OO-ES04).
- **RF-ES-006**: El sistema DEBE permitir activar una sucursal como operativa únicamente cuando los 8 ítems del checklist están completados (OO-ES05).
- **RF-ES-007**: El sistema DEBE permitir consultar el estado de apertura de una sucursal en proceso, incluyendo qué ítems del checklist faltan (OO-ES06).
- **RF-ES-008**: El sistema DEBE permitir dar de baja o cerrar temporalmente una sucursal ya operativa (OO-ES07).
- **RF-ES-009** *(añadido en enmienda v1.1, normalización de catálogos)*: Los ítems del checklist de apertura DEBEN definirse en un catálogo (`item_checklist_apertura`), no dentro de una restricción del esquema — agregar o quitar un paso del proceso de apertura no puede seguir siendo una migración de base de datos.
- **RF-ES-010** *(añadido en enmienda v1.1)*: El estado de una sucursal DEBE seleccionarse del catálogo `estado_sucursal`, que declara cuál permite operar ventas.
- **RF-ES-011** *(añadido en enmienda v1.1)*: El sistema DEBE exponer ambos catálogos como consulta, incluyendo el orden de ejecución y si cada ítem es bloqueante.
- **RF-ES-012** *(añadido en enmienda v1.1)*: `GET /sucursales/{id}/estado-apertura` DEBE separar los ítems pendientes en bloqueantes y no bloqueantes, para que el Encargado distinga lo crítico de la puesta a punto.

## Requisitos No Funcionales

- **RNF-ES-001** (Fiabilidad, ISO 25010): la activación de una sucursal (RF-ES-006) es una operación atómica que valida los 8 ítems del checklist en la misma transacción que actualiza `sucursal.estado`, nunca una validación de solo interfaz.
- **RNF-ES-002** (Eficiencia de desempeño): el proceso completo desde `POST /sucursales` hasta la activación DEBE poder completarse en menos de 15 días calendario en condiciones normales (OT3.5) — medido por `fecha_activacion - fecha_registro`, expuesto como métrica en la capa táctica.
- **RNF-ES-003** (Integridad de datos, ISO 25012): la herencia de catálogo (RF-ES-004) es idempotente a nivel de sucursal — un segundo intento sobre una sucursal ya heredada no duplica filas de precio, responde error explícito en su lugar.

## Reglas de Negocio

- **RN-ES-001**: Una sucursal no puede pasar a `estado='operativa'` si tiene al menos un ítem de `checklist_apertura_sucursal` con `completado=false` (OO-ES05, Art. 2.4).
- **RN-ES-002**: La herencia de catálogo y precios (OO-ES03) solo puede ejecutarse una vez por sucursal — un segundo intento se rechaza, no se reintenta silenciosamente ni se duplica.
- **RN-ES-004** *(añadida en enmienda v1.1)*: Un ítem del checklist marcado `es_bloqueante = true` no puede darse de baja del catálogo (`activo = false`). Son requisitos legales o de seguridad (permiso municipal, inspección de seguridad); permitir quitarlos del proceso dejaría abrir una sucursal sin ellos, que es precisamente lo que el checklist existe para impedir. Los ítems de puesta a punto sí pueden darse de baja si el negocio cambia su proceso.
- **RN-ES-005** *(añadida en enmienda v1.1)*: **RN-ES-001 no cambia con la introducción de `es_bloqueante`**: activar una sucursal sigue exigiendo todos los ítems completos, bloqueantes o no. `es_bloqueante` sirve para proteger el catálogo (RN-ES-004) y para informar mejor los pendientes (RF-ES-012), nunca para habilitar una activación con excepciones — esa sería una regla de negocio distinta, que nadie pidió.
- **RN-ES-006** *(añadida en enmienda v1.1)*: El checklist de una sucursal se genera con los ítems `activo = true` **al momento de crearla**, y no se recalcula después. Agregar un ítem nuevo al catálogo no reabre el checklist de sucursales ya operativas.
- **RN-ES-003**: Un producto de la cadena sin ningún precio previo registrado en ninguna otra sucursal no recibe un precio heredado automático: queda explícitamente pendiente de fijación manual por el Encargado de Sucursal, nunca con un precio inventado (extensión de la regla de honestidad del Art. 5.9 a datos operativos, ver Decisión 3 de `research.md`).

## Casos de Uso / Historias de Usuario

- **US-ES-001**: Como Dueño, quiero registrar una nueva sucursal y seguir su checklist de apertura, para asegurarme de que ninguna tienda nueva se salte un paso obligatorio.
- **US-ES-002**: Como Dueño, quiero heredar el catálogo y los precios base de la cadena a la sucursal nueva, para no tener que cargar cada producto manualmente.
- **US-ES-003**: Como Dueño, quiero consultar el estado de apertura de una sucursal en proceso, para saber qué falta antes de activarla.

## Criterios de Aceptación

- **CA-ES-001**: Dada una sucursal con 7 de 8 ítems del checklist completados, cuando se intenta `POST /sucursales/{id}/activar`, entonces el sistema responde `422` y lista el ítem faltante (RN-ES-001).
- **CA-ES-002**: Dada una sucursal ya heredada, cuando se repite `POST /sucursales/{id}/heredar-catalogo`, entonces el sistema responde `409` sin duplicar filas de precio (RN-ES-002).
- **CA-ES-003**: Dado un producto de la cadena sin precio previo en ninguna sucursal, cuando se hereda el catálogo, entonces ese producto queda listado como "pendiente de fijación manual", sin fila de precio creada (RN-ES-003).

## Entidades Clave

- `sucursal`, `checklist_apertura_sucursal`, `herencia_catalogo_sucursal`.

## Fuera de Alcance

- La creación del propio `usuario` que será asignado como personal de la sucursal — pertenece a `010-administracion` (OO-AD01); este módulo solo dispara la asignación de sucursal sobre un usuario ya existente (ver Decisión 2 de `research.md`).
- El cálculo de qué precio exacto "hereda" cada producto más allá de la regla simple del último precio vigente en la cadena — cualquier lógica de pricing dinámico posterior a la apertura es responsabilidad de `003-precios-margenes`.

## Dependencias con Otros Módulos

- **Depende de**: `producto` (`001-core-ventas-inventario`, para saber qué heredar), `historial_precio_producto` (`003-precios-margenes`, destino de la herencia de precios vía su endpoint ya existente `POST /precios`), `usuario`/`usuario_sucursal` (`010-administracion`, para OO-ES04 y `sucursal.responsable_id`).
- **Consumido por**: los ocho módulos ya entregados (001-008), que referencian `sucursal` como FK externa; `010-administracion`, que referencia `sucursal` en `usuario_sucursal` y en `log_auditoria.sucursal_id`.
