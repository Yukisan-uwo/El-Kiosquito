# Investigación Técnica: Expansión y Sucursales

**Feature**: `009-expansion-sucursales` | **Fecha**: 2026-09-04

## Decisión 1: `sucursal` no tenía módulo dueño hasta ahora — deuda retroactiva resuelta aquí

Igual que `usuario` (ver Decisión 1 de `010-administracion`), `sucursal` fue referenciada como FK externa desde el primer módulo entregado (`stock_sucursal`, `venta`, `turno_caja`, `historial_precio_producto`, `orden_compra`, etc. — los ocho módulos ya entregados la usan) sin que ningún módulo la definiera formalmente. Se decidió construir `009-expansion-sucursales` y `010-administracion` en ese orden dentro de esta sesión — primero Administración, porque `sucursal.responsable_id` necesita `usuario` ya definido — y documentar aquí, retroactivamente, que este módulo es su dueño canónico.

## Decisión 2: OO-ES04 (asignar personal) reutiliza el endpoint de `010-administracion`, no crea tabla propia

OO-ES04 dice "Asignar personal (cajero, encargado) a una sucursal", pero esa es exactamente la misma operación que OO-AD02 de Administración ("asignar rol y sucursal(es) a un usuario") — la relación `usuario_sucursal` solo puede tener un dueño. Se decidió que este módulo NO crea una tabla ni un endpoint de asignación propio: durante el flujo de apertura, el Encargado llama al endpoint ya existente `PATCH /admin/usuarios/{id}/rol-sucursales` de `010-administracion`, pasando el `id` de la sucursal recién creada. Esto extiende el patrón de llamada HTTP entre módulos ya usado en la Decisión 4 de `008-compras-proveedores` (consulta a `004-pronostico-demanda`), aquí aplicado a una escritura en vez de una lectura — pero la escritura la sigue ejecutando el propio módulo dueño de la tabla (`010`), nunca este módulo directamente, así que no es una excepción al principio de que cada módulo solo escribe sus propias tablas.

**Alternativa descartada**: duplicar una tabla `personal_sucursal` en este módulo, sincronizada con `usuario_sucursal` de Administración. Se descartó porque introduciría dos fuentes de verdad sobre el mismo hecho de negocio (qué usuario tiene alcance sobre qué sucursal), con el riesgo de que queden desincronizadas — el mismo tipo de problema que la constitución evita en otros lados exigiendo una sola tabla dueña por dato (p. ej. `alerta_fraude_pago` en `006`, con un dueño de escritura claro por operación, nunca dos tablas paralelas).

## Decisión 3: herencia de catálogo y precios sin fabricar stock inicial ni precios inventados

OO-ES03 pide "heredar el catálogo de productos y precios base de la cadena" como INSERT en bloque del sistema. Se decidió implementarlo así: por cada `producto.activo=true` (tabla dueña: `001-core-ventas-inventario`), el servicio de este módulo llama al endpoint ya existente `POST /precios` de `003-precios-margenes` (`registrarPrecio`, OO-PM01), usando como `precio_venta` el último precio vigente de ese producto en cualquier otra sucursal de la cadena. Si el producto nunca tuvo precio en ninguna sucursal, NO se crea una fila con un precio inventado — queda listado como pendiente de fijación manual (RN-ES-003). El **stock inicial** deliberadamente no se fabrica con una fila `cantidad=0` en `stock_sucursal`: la ausencia de fila para `(producto_id, nueva_sucursal_id)` ya representa 0 unidades de forma honesta, y el stock real se registra recién cuando llega la primera reposición física vía `POST /inventario/ingresos` (OO-IN02 de `001`), fuera del alcance de este módulo.

**Alternativa descartada**: crear un endpoint nuevo de "inicialización en bloque" en `001` y `003` que reciba un `sucursal_id` y genere todas las filas de golpe en una sola llamada. Se descartó para no tener que reabrir y modificar los contratos OpenAPI ya entregados y comprometidos de esos dos módulos — este módulo orquesta llamando en bucle a los endpoints unitarios que ya existen, con el costo aceptado de más llamadas HTTP a cambio de no tocar contratos ya cerrados (mismo criterio de no-retroceso aplicado en la Decisión 6 de `010-administracion` respecto al IVA en `001`).

## Decisión 4: checklist de apertura como 8 ítems fijos vía CHECK, no una tabla de catálogo aparte

Los 8 ítems del checklist (`local_arrendado`, `mobiliario_instalado`, `pos_instalado`, `personal_asignado`, `catalogo_heredado`, `precios_heredados`, `inspeccion_seguridad`, `permiso_municipal`) son un conjunto cerrado y estable propio de abrir un minimarket físico — no un catálogo configurable que vaya a crecer con el tiempo. Se decidió representarlos con un `CHECK IN (...)` sobre `checklist_apertura_sucursal.item`, igual criterio que `cupon.tipo_origen` en `005-promociones-inteligentes` (conjunto cerrado, valores fijos del dominio del negocio, no una tabla de referencia separada).

> **⚠️ Decisión revertida por la Decisión 5 (enmienda v1.1).** Se conserva escrita porque el razonamiento original explica por qué el modelo quedó como quedó, y porque la enmienda transversal de catálogos revisó exactamente esta clase de argumento en los 11 módulos. Ver abajo por qué no se sostuvo aquí.

## Decisión 5 (enmienda v1.1, 2026-09-04): el checklist sí necesita catálogo — se revierte la Decisión 4

**Qué se revierte**: `checklist_apertura_sucursal.item` pasa de `CHECK IN (...)` a FK sobre una tabla nueva `item_checklist_apertura`. Es la única decisión de todo el proyecto que una enmienda revierte de forma explícita, así que vale la pena decir por qué el argumento original falló.

**Por qué no se sostuvo**: la Decisión 4 se apoyaba en que los 8 ítems eran "un conjunto cerrado y estable". Eso es verdad para el vocabulario de un estado (`abierto`/`cerrado` no van a crecer) pero **no para un proceso de negocio**. El checklist de apertura no es un vocabulario: es la descripción de cómo esta cadena abre una tienda, y eso cambia con la experiencia — se agrega "conexión de internet contratada" después de que una apertura se retrasó por eso, se quita un paso que resultó redundante. Con el CHECK, cada uno de esos ajustes es una migración de esquema para modificar un dato de negocio.

La comparación con `cupon.tipo_origen` tampoco se sostiene: los orígenes de un cupón son categorías de un evento del sistema; los ítems del checklist son **tareas que hacen personas**. Que ambos fueran "conjuntos cerrados" ocultaba que son cosas de naturaleza distinta.

**Qué gana además del cambio mecánico**: `orden` (los 8 ítems tienen una secuencia real de ejecución que el CHECK no podía expresar) y `es_bloqueante`, que distingue los requisitos legales o de seguridad de los de puesta a punto.

**Lo que deliberadamente NO cambia**: RN-ES-001 sigue exigiendo **todos** los ítems completos para activar una sucursal. `es_bloqueante` protege el catálogo (RN-ES-004: un ítem bloqueante no se puede dar de baja) e informa mejor los pendientes (RF-ES-012), pero no habilita una activación con excepciones. Relajar RN-ES-001 sería una regla de negocio nueva, no una consecuencia técnica de catalogar el checklist, y no se hace aquí.

**Regla de generación** (RN-ES-006): el checklist de una sucursal se arma con los ítems `activo = true` al momento de crearla, y no se recalcula. Agregar un ítem al catálogo no debe reabrir el checklist de sucursales que ya están operativas.
