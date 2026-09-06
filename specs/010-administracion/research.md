# Investigación Técnica: Administración

**Feature**: `010-administracion` | **Fecha**: 2026-09-04

## Decisión 1: `usuario` no tenía módulo dueño hasta ahora — deuda retroactiva resuelta aquí

Los ocho módulos ya entregados (`001-core-ventas-inventario` a `008-compras-proveedores`) referencian `usuario` constantemente como FK externa (`cajero_id`, `completado_por`, `registrado_por`, `atendida_por`, etc.) y todos sus `quickstart.md` asumen un `$TOKEN_X` ya emitido, sin que ningún módulo hasta ahora definiera la tabla ni el endpoint de login. Se decidió que Administración es el dueño canónico de `usuario`, `usuario_sucursal` y del endpoint `POST /auth/login` — exactamente el mismo patrón que resuelve `009-expansion-sucursales` para `sucursal` (ambas tablas fueron "propiedad implícita" durante ocho módulos antes de tener un dueño formal).

**Alternativa descartada**: definir `usuario` dentro de `001-core-ventas-inventario` desde el inicio. Se descartó porque el `cajero` es solo uno de los cuatro roles y `001` no tiene ninguna razón de negocio para poseer la gobernanza de acceso de toda la cadena — mezclar autenticación con ventas habría violado el límite de responsabilidad de módulo (Art. 1.4 de la constitución, "reglas específicas de un módulo").

## Decisión 2: `historial_parametro_sistema` como tabla append-only, no `UPDATE` in situ

El IVA es "parametrizable... para poder ajustarse si la tasa cambia" (Art. 4.1). Si `parametro_sistema` fuera una tabla mutable (`UPDATE` sobre la fila `iva`), una venta calculada la semana pasada con 15% se recalcularía silenciosamente mal si se consulta después de un cambio de tasa. Se aplica el mismo patrón que `historial_costo_producto` (008) e `historial_precio_producto` (003): cada cambio es un `INSERT` con `vigente_desde`, y el valor "actual" se deriva con `ORDER BY vigente_desde DESC LIMIT 1` por `clave`.

**Alternativa descartada**: guardar el IVA como constante en configuración de la aplicación (variable de entorno), fuera de base de datos. Se descartó porque entonces no habría forma de reconstruir qué tasa aplicó a una venta pasada si la constante cambia — rompe la trazabilidad de OT1.1 (margen real).

## Decisión 3: matriz de permisos (`permiso_rol`) sembrada por migración, de solo lectura vía API

OO-AD03 pide "consultar" la matriz de permisos, no escribirla desde la aplicación. Se decidió modelarla como tabla de referencia (`rol`, `recurso`, `operacion`, `permitido`), poblada por la migración Alembic de este módulo, expuesta únicamente vía `GET /admin/permisos`. Cambiarla en caliente equivaldría a redefinir la jerarquía de roles del Art. 3 sin pasar por una enmienda formal de la constitución (Art. 9.1: "esta constitución solo puede enmendarse mediante una nueva versión numerada"), así que deliberadamente no existe un `PATCH`/`POST` sobre esta tabla en este módulo.

## Decisión 4: una sola tabla `log_auditoria` para operaciones críticas y anomalías de autenticación

El Art. 4.3/OT4.3 (auditoría de operaciones críticas) y el Art. 10.5 (registro de accesos no autorizados/anomalías de autenticación) parecen dos requisitos distintos, pero comparten exactamente la misma forma de consulta (OO-AD05: filtrar por usuario/fecha/sucursal) y la misma restricción de inmutabilidad. Se decidió una sola tabla con una columna `exitoso BOOLEAN`: `exitoso=true` para operaciones críticas normales (una recepción de compra, un cierre de caja, una desactivación de proveedor, etc., cada módulo llama a este log) y `exitoso=false` para intentos fallidos de autenticación o accesos rechazados por scoping. Separar en dos tablas habría duplicado el índice `(usuario_id, creado_en)` y la lógica de exportación sin ninguna ganancia de negocio.

**Alternativa descartada**: registrar cada tipo de evento crítico en su propio módulo (por ejemplo, `historial_costo_producto` de 008 ya es en sí mismo un registro auditable de esa operación). Se descartó como reemplazo del log central porque cada tabla de historial documenta el valor, no el "quién/cuándo/desde dónde" que exige el Art. 10.5 de forma homogénea entre módulos — ambas cosas coexisten, no se sustituyen.

## Decisión 5: `solicitud_arco` no tiene código OO, se deriva directamente del Art. 10.3

La cascada de objetivos (OO-AD01 a OO-AD07) no incluye un objetivo operativo para el mecanismo ARCO — es una obligación normativa de la LOPDP que la constitución asigna explícitamente a Administración (Art. 10.3, 10.4) sin pasar por la cascada de objetivos de negocio. Se decidió incluirla igual, trazada directamente al artículo constitucional en vez de a un código `OO-AD`, siguiendo el mismo criterio del Art. 7.4 ("todo requisito... DEBE ser trazable a un caso de uso y a un objetivo") entendiendo que una obligación legal explícita en la constitución cumple el mismo rol de ancla de trazabilidad que un OO.

## Decisión 6: `GET /admin/parametros/{clave}` queda documentado como dependencia hacia adelante de `001-core-ventas-inventario`

`001-core-ventas-inventario` ya fue entregado y su `spec.md`/`data-model.md` no referencian una consulta al IVA vigente de este módulo (se dio por hecho un 15% fijo en los ejemplos de `quickstart.md`). Se documenta aquí, sin modificar el contrato ya entregado de `001`, que en una implementación real `001` debería consultar `GET /admin/parametros/iva` antes de calcular el IVA de cada venta — mismo tipo de dependencia hacia adelante que quedó documentada en `004-pronostico-demanda` hasta que `008-compras-proveedores` la consumió.

## Decisión 7 (enmienda v1.1, 2026-09-04): `rol` y `recurso_sistema` como catálogos, y por qué RN-AD-001 se queda en el servicio

**Contexto**: este módulo tenía la peor duplicación de vocabulario de todo el proyecto. El CHECK de los 4 roles estaba escrito **dos veces** (`usuario.rol` y `permiso_rol.rol`), y `recurso` era TEXT libre en **dos tablas distintas** (`permiso_rol` y `log_auditoria`). Nada garantizaba que quedaran sincronizados.

**Decisión A — `recurso_sistema` compartido por la matriz de permisos y el log**: con la FK desde ambas tablas, el log solo puede auditar recursos que existen en la matriz de permisos. Antes, la matriz podía decir `'orden_compra'` y el log escribir `'ordenCompra'`, y la consulta de auditoría por recurso devolvía resultados incompletos **sin ningún error visible** — el peor tipo de fallo en un log que existe precisamente para ser confiable (Art. 10.5). Es una garantía real de coherencia entre gobernanza (OT4.2) y auditoría (OT4.3) que hasta ahora dependía de que dos personas escribieran el mismo string.

**Decisión B — `rol.alcance_cadena`**: traduce el Art. 3.3 a dato. La regla de que Dueño y Encargado de Compras ven toda la red vivía escrita a mano en `scoping.py`, el servicio compartido que usan los 11 módulos, y repetida en RN-AD-001.

Ese es el punto del sistema donde una lista desactualizada tiene el peor efecto imaginable: si mañana se agrega un rol y alguien olvida incluirlo, **ese rol queda sin scoping aplicado**, viendo datos de toda la cadena sin que nadie lo haya decidido. Un fallo de este tipo no lanza ningún error; simplemente entrega de más. Por eso RN-AD-004 exige que `scoping.py` consulte el catálogo y nunca compare contra códigos literales.

**Decisión C — RN-AD-001 se queda aplicada en el servicio**: se evaluó llevarla a la base con una FK compuesta, desnormalizando `alcance_cadena` en `usuario` (`(rol, alcance_cadena) REFERENCES rol(codigo, alcance_cadena)`) más un CHECK en `usuario_sucursal`. Daría garantía a nivel de motor, que es lo que este proyecto ha preferido en todos los casos análogos (RN-CF-002, RN-PM-004, RN-CMF-001, RN-PM-001).

**No se aplicó**, por dos razones: exige una columna redundante en `usuario` cuyo único propósito es habilitar la FK compuesta, y sobre todo **cambia dónde se aplica una regla ya aprobada**. Mover una regla del servicio a la base es una decisión del dueño del proyecto, no una consecuencia técnica de catalogar el rol. Lo que sí cambia es que la regla deja de tener la lista de roles quemada: ahora lee `rol.alcance_cadena`. La mejora queda documentada como disponible.

**Decisión D — `operacion` no incluye `'eliminar'`**: el Art. 2.4 y los RNF de casi todos los módulos prohíben el borrado desde la aplicación. Ofrecer `eliminar` como operación catalogada sería ofrecer un permiso que el sistema nunca debe conceder, y tarde o temprano alguien lo sembraría en `permiso_rol` "por completitud".

**Decisión E — los cinco catálogos son de solo lectura vía API**, igual que `permiso_rol` (Decisión 3): se siembran y modifican por migración. Un endpoint que permitiera crear roles en caliente sería, literalmente, una vía de escalación de privilegios.
