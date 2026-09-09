# Especificación de Funcionalidad: Administración

**Feature**: `010-administracion` | **Fecha**: 2026-09-04
**Estado**: Borrador inicial | **Entrada**: `claude/el-kiosquito-cascada-objetivos.md` (OT4.2, OT4.3, Departamento Administración), `claude/el-kiosquito-constitution.md` (Art. 3, 5.9, 9.1, 10.3, 10.5)

## Resumen Ejecutivo

Módulo dueño de `usuario` y de la infraestructura de gobernanza de la cadena: autenticación, asignación de rol y alcance por sucursal (RBAC), consulta de la matriz de permisos, log de auditoría inmutable, parámetros globales del sistema (IVA, moneda) y el mecanismo ARCO exigido por la LOPDP (Art. 10.3). Ningún otro módulo puede crear ni modificar un `usuario` — los ocho módulos ya entregados (001 a 008) referencian `usuario` como FK externa sin haberlo definido nunca; este módulo resuelve esa deuda de forma retroactiva y explícita (ver Decisión 1 de `research.md`).

## Contexto de Negocio

La cascada de objetivos asigna a Administración dos objetivos tácticos (OT4.2 RBAC, OT4.3 auditoría inmutable) bajo el OE4 (Perspectiva Aprendizaje y Crecimiento). La constitución añade, fuera de la cascada de objetivos pero como obligación normativa directa, el mecanismo de derechos ARCO (Art. 10.3) y la notificación de brechas de seguridad (Art. 10.5) — ambos gestionados desde este módulo. La jerarquía de 4 roles (Art. 3.1) y el alcance por sucursal (Art. 3.3) llevan usándose desde `001-core-ventas-inventario` como si ya existieran; este módulo es donde efectivamente se implementan.

## Requisitos Funcionales

- **RF-AD-001**: El sistema DEBE permitir registrar un usuario con nombre, email único, contraseña (hash bcrypt) y rol inicial (OO-AD01).
- **RF-AD-002**: El sistema DEBE permitir actualizar los datos de un usuario existente, sin permitir cambiar el email a uno ya registrado por otro usuario (OO-AD01).
- **RF-AD-003**: El sistema DEBE permitir asignar el rol y la(s) sucursal(es) de alcance de un usuario, exigiendo al menos una sucursal para los roles `encargado_sucursal` y `cajero`, y ninguna (alcance de cadena completa) para `dueno` y `encargado_compras` (OO-AD02, Art. 3.1).
- **RF-AD-004**: El sistema DEBE exponer una consulta de la matriz de permisos vigente por rol × recurso × operación (OO-AD03).
- **RF-AD-005**: El sistema DEBE registrar automáticamente en el log de auditoría toda operación crítica ejecutada en cualquier módulo, así como todo intento de acceso no autorizado o anomalía de autenticación, de forma append-only (OO-AD04, Art. 10.5).
- **RF-AD-006**: El sistema DEBE permitir consultar y exportar el log de auditoría filtrado por usuario, rango de fechas y sucursal (OO-AD05).
- **RF-AD-007**: El sistema DEBE permitir desactivar (baja lógica) un usuario, sin eliminar su historial de auditoría ni sus referencias FK en otros módulos (OO-AD06).
- **RF-AD-008**: El sistema DEBE permitir registrar un nuevo valor vigente de un parámetro global (IVA, moneda), conservando el historial de valores anteriores y desde cuándo aplicó cada uno (OO-AD07).
- **RF-AD-009**: El sistema DEBE exponer un mecanismo para que un cliente (vía el propio negocio) solicite acceso, rectificación, cancelación u oposición sobre sus datos personales, y para que Administración registre la resolución de esa solicitud (Art. 10.3).
- **RF-AD-010**: El sistema DEBE emitir un token JWT con claims de rol y sucursal(es) asignada(s) al autenticar un usuario con email y contraseña (Art. 3.3, 5.3, 5.9).
- **RF-AD-011** *(añadido en enmienda v1.1, normalización de catálogos)*: Los roles del sistema DEBEN definirse en un catálogo (`rol`) que declare, por rol, su nivel jerárquico y si su alcance es de cadena completa — la regla del Art. 3.3 deja de estar escrita a mano en el servicio de scoping y pasa a ser un dato consultable.
- **RF-AD-012** *(añadido en enmienda v1.1)*: Los recursos protegidos por la matriz de permisos y los auditados por el log DEBEN provenir del mismo catálogo (`recurso_sistema`), de modo que el log no pueda registrar un recurso que la matriz de permisos no conoce.
- **RF-AD-013** *(añadido en enmienda v1.1)*: Cada tipo de solicitud ARCO DEBE declarar su plazo legal de respuesta en días, y el sistema DEBE permitir consultar las solicitudes vencidas — hoy se registran las fechas de solicitud y de resolución pero no hay contra qué compararlas.
- **RF-AD-014** *(añadido en enmienda v1.1)*: El sistema DEBE exponer los cinco catálogos de este módulo como consulta, en modo solo lectura.
- **RF-AD-015** *(añadido en enmienda v1.2, permisos POS)*: La matriz de permisos RBAC del sistema (`permiso_rol`) DEBE asignar al rol `cajero` las operaciones de lectura (`cupon:leer`) y actualización/canje (`cupon:actualizar`) sobre el recurso `cupon` para habilitar la validación y canje de promociones en el punto de venta.

## Requisitos No Funcionales

- **RNF-AD-001** (Seguridad, ISO 25010): `log_auditoria` es estrictamente de solo inserción — ningún router de este módulo expone `UPDATE` ni `DELETE` sobre esa tabla.
- **RNF-AD-002** (Seguridad): las contraseñas se almacenan exclusivamente como hash bcrypt; el endpoint de login nunca devuelve ni registra la contraseña en texto plano, ni siquiera en el log de auditoría (Art. 10.7).
- **RNF-AD-003** (Mantenibilidad): `permiso_rol` (la matriz de permisos) se siembra por migración, no por endpoint de escritura — modificarla equivale a una enmienda de la jerarquía de roles del Art. 3, que el Art. 9.1 exige versionar formalmente.
- **RNF-AD-004** (Portabilidad de datos, ISO 25012): la exportación del log de auditoría DEBE soportar al menos formato CSV, para cumplir con la obligación de poder entregarlo a la APDP dentro de las 72 horas del Art. 10.5.
- **RNF-AD-005** (Persistencia y disponibilidad de sesión): El token JWT de autenticación emitido por el sistema tiene una vigencia estándar de 8 horas (`exp = 28800 segundos`). El cliente frontend DEBE garantizar la persistencia del token y la restauración sincrónica del estado de sesión en almacenamiento local/sesión (`localStorage`/`sessionStorage`), previniendo condiciones de carrera al recargar la página (F5) que pudieran expulsar al usuario al login antes de que expire su vigencia.

## Reglas de Negocio

- **RN-AD-001**: Un usuario cuyo rol tiene alcance de cadena (`rol.alcance_cadena = true`) nunca tiene filas en `usuario_sucursal` — ese alcance se determina por el rol mismo, no por asignación explícita (Art. 3.1). *(Enmienda v1.1)* La regla se sigue aplicando en el servicio, pero **lee `rol.alcance_cadena` en vez de tener la lista `('dueno','encargado_compras')` escrita a mano**. Antes, agregar un quinto rol con alcance de cadena obligaba a acordarse de editar esa lista en cada lugar donde estuviera repetida.
- **RN-AD-004** *(añadida en enmienda v1.1)*: `scoping.py` — el servicio compartido que usan los 11 módulos para el Art. 3.3 — DEBE decidir el alcance consultando `rol.alcance_cadena`, nunca comparando contra códigos de rol literales. Es el punto de todo el sistema donde una lista desactualizada tiene el peor efecto posible: un rol nuevo quedaría sin scoping aplicado, es decir, viendo datos de toda la red sin que nadie lo haya decidido.
- **RN-AD-005** *(añadida en enmienda v1.1)*: `rol.nivel_jerarquico` es único. La jerarquía del Art. 3.1 es un orden total; dos roles con el mismo nivel harían ambigua cualquier comparación de precedencia.
- **RN-AD-006** *(añadida en enmienda v1.1)*: Ninguna fila de los cinco catálogos se borra; baja lógica con `activo = false`. El log de auditoría es append-only e inmutable (Art. 10.5): si se borrara un rol o un recurso, sus entradas históricas quedarían apuntando a algo inexistente y no habría forma de corregirlas.
- **RN-AD-007** *(añadida en enmienda v1.1)*: Los cinco catálogos son de solo lectura desde la API, igual que `permiso_rol`. Un endpoint que permitiera crear roles en caliente sería una vía de escalación de privilegios.
- **RN-AD-002**: Un usuario con rol `encargado_sucursal` o `cajero` DEBE tener al menos una fila en `usuario_sucursal` antes de poder autenticarse exitosamente contra cualquier endpoint que dependa de alcance por sucursal.
- **RN-AD-003**: Cambiar el rol de un usuario NUNCA borra sus filas históricas de `usuario_sucursal` de forma silenciosa — el cambio de rol y el cambio de sucursales asignadas son dos campos del mismo `PATCH`, pero ambos quedan auditados como una sola operación en `log_auditoria`.

## Casos de Uso / Historias de Usuario

- **US-AD-001**: Como Dueño, quiero registrar un nuevo Encargado de Sucursal y asignarle su(s) sucursal(es), para que pueda operar solo dentro de su alcance.
- **US-AD-002**: Como Dueño, quiero consultar el log de auditoría filtrado por sucursal y fecha, para investigar un incidente reportado por un Encargado.
- **US-AD-003**: Como Administración, quiero registrar un cambio de IVA sin perder el valor anterior, para que las ventas ya cerradas conserven la tasa que realmente aplicó.
- **US-AD-004**: Como Administración, quiero registrar la resolución de una solicitud ARCO de un cliente, para cumplir con la LOPDP.

## Criterios de Aceptación

- **CA-AD-001**: Dado un usuario nuevo con rol `cajero` sin sucursales asignadas, cuando intenta autenticarse y llamar a cualquier endpoint con alcance por sucursal, entonces el sistema responde `403` (RN-AD-002).
- **CA-AD-002**: Dado un cambio de IVA registrado hoy, cuando se consulta una venta de la semana pasada, entonces el sistema sigue mostrando la tasa de IVA vigente en ese momento, no la actual (RF-AD-008).
- **CA-AD-003**: Dado un intento de login con contraseña incorrecta, cuando ocurre, entonces se registra una fila en `log_auditoria` con `exitoso=false`, sin la contraseña ingresada (RNF-AD-002, Art. 10.5).
- **CA-AD-004** *(enmienda v1.1)*: Dado un rol nuevo insertado en el catálogo con `alcance_cadena = true`, cuando se asigna a un usuario, entonces `scoping.py` le aplica alcance de cadena **sin ningún cambio de código** y RN-AD-001 le impide tener filas en `usuario_sucursal` (RF-AD-011, RN-AD-004).
- **CA-AD-005** *(enmienda v1.1)*: Dado un intento de escribir en `log_auditoria` con un `recurso` que no existe en `recurso_sistema`, cuando ocurre, entonces la base lo rechaza — el log no puede auditar recursos que la matriz de permisos no conoce (RF-AD-012).
- **CA-AD-006** *(enmienda v1.1)*: Dada una solicitud ARCO de tipo `acceso` creada hace más días que su `plazo_respuesta_dias` y aún `pendiente`, cuando se consultan las solicitudes vencidas, entonces aparece en el listado (RF-AD-013).

## Entidades Clave

- **Rol, RecursoSistema, Operacion, TipoSolicitudArco, EstadoSolicitudArco** *(enmienda v1.1)*: catálogos maestros. `Rol` declara `nivel_jerarquico` (único) y `alcance_cadena` — el Art. 3.3 pasa de estar escrito en `scoping.py` a ser un dato. `RecursoSistema` es el mismo vocabulario para la matriz de permisos y para el log de auditoría, lo que garantiza coherencia entre OT4.2 y OT4.3. `TipoSolicitudArco` declara el plazo legal de respuesta.
- `usuario`, `usuario_sucursal`, `permiso_rol`, `log_auditoria`, `historial_parametro_sistema`, `solicitud_arco`.

## Fuera de Alcance

- El motor de reglas fino que decide, endpoint por endpoint, si un rol puede hacer una operación — eso vive en el middleware de cada módulo (`scoping.py`), que solo lee los claims del JWT emitido aquí; este módulo expone la matriz como referencia consultable, no la aplica él mismo sobre los demás módulos.
- Recuperación de contraseña por correo (flujo de "olvidé mi contraseña") — no forma parte del enunciado del examen ni de la cascada de objetivos; queda para una futura iteración si se solicita.

## Dependencias con Otros Módulos

- **Consumido por**: los ocho módulos ya entregados (001-008), que referencian `usuario` como FK externa y dependen del JWT emitido aquí para RBAC; `009-expansion-sucursales`, que referencia `usuario` para `sucursal.responsable_id` y para OO-ES04 (asignación de personal en apertura, ver research.md de `009`).
- **Depende de**: `sucursal` (`009-expansion-sucursales`) para poder poblar `usuario_sucursal`.
