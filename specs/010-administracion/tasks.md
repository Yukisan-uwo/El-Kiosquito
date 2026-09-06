# Tareas de Implementación: Administración

**Feature**: `010-administracion` | **Fecha**: 2026-09-04
**Entrada**: `plan.md`, `data-model.md`, `contracts/administracion.openapi.yaml`

`[P]` = se puede hacer en paralelo con otras tareas `[P]` de su mismo bloque. Las tareas sin `[P]` son secuenciales dentro de su bloque.

## Fase 1 — Setup

- **T001**: Crear la migración Alembic de las 6 tablas de `data-model.md` (`usuario`, `usuario_sucursal`, `permiso_rol`, `log_auditoria`, `historial_parametro_sistema`, `solicitud_arco`), incluyendo la siembra de `permiso_rol` y de un primer usuario `dueno`. Archivo: `backend/alembic/versions/xxxx_administracion.py`.
- **T002 [P]**: Crear los modelos SQLAlchemy en `backend/app/models/administracion.py`.
- **T003 [P]**: Crear los esquemas Pydantic en `backend/app/schemas/administracion.py`.

## Fase 2 — Tests de contrato primero (deben fallar antes de implementar)

- **T004 [P]**: Test de contrato `POST /api/v1/auth/login` con credenciales correctas → `200` con `access_token` con claims `rol` y `sucursal_ids` decodificables.
- **T005 [P]**: Test de contrato `POST /api/v1/auth/login` con contraseña incorrecta → `401`, y verifica que se creó una fila en `log_auditoria` con `exitoso=false` sin la contraseña ingresada (RNF-AD-002).
- **T006 [P]**: Test de contrato `PATCH /admin/usuarios/{id}/rol-sucursales` con `rol=cajero` y `sucursal_ids=[]` → `422` (RN-AD-002).
- **T007 [P]**: Test de contrato `PATCH /admin/usuarios/{id}/rol-sucursales` con `rol=dueno` y cualquier `sucursal_ids` → verifica que NO se inserta ninguna fila en `usuario_sucursal` (RN-AD-001).
- **T008 [P]**: Test de contrato: dos `POST /admin/parametros` consecutivos con `clave=iva` y valores distintos → `GET /admin/parametros/iva` devuelve el segundo valor, y una consulta directa a `historial_parametro_sistema` conserva ambas filas (Decisión 2, CA-AD-002).
- **T009 [P]**: Test de contrato: intento de `PATCH`/`DELETE` sobre `permiso_rol` (endpoint no expuesto) → verifica que no existe tal ruta en el router (RNF-AD-003).
- **T010 [P]**: Test de contrato `GET /admin/auditoria?solo_anomalias=true` → solo devuelve filas con `exitoso=false`.
- **T011 [P]**: Test de contrato: flujo completo `POST /admin/arco` → `PATCH /admin/arco/{id}/resolver` con `estado=atendida` → verifica que `fecha_resolucion` y `atendida_por` quedan poblados (CHECK de `solicitud_arco`).
- **T012 [P]**: Test de contrato: intento de `PATCH /admin/arco/{id}/resolver` con `estado=atendida` pero sin `respuesta` → `422`.

## Fase 3 — Implementación core (hace pasar los tests de la Fase 2)

- **T013**: Servicio `auth.py` (`hash_password`, `verificar_password`, `emitir_jwt`), endpoint `POST /auth/login`.
- **T014**: Endpoints `POST /api/v1/admin/usuarios`, `PATCH /api/v1/admin/usuarios/{id}`, `PATCH /api/v1/admin/usuarios/{id}/desactivar`.
- **T015**: Servicio `asignar_rol_y_sucursales` (RN-AD-001, RN-AD-002), endpoint `PATCH /admin/usuarios/{id}/rol-sucursales`.
- **T016**: Endpoint `GET /admin/permisos`.
- **T017**: Servicio `auditoria.py` con la función `registrar_evento(usuario_id, accion, recurso, recurso_id, sucursal_id, detalle, exitoso)`, importable desde los demás módulos (Riesgos de `plan.md`); endpoint `GET /admin/auditoria` con exportación CSV (RNF-AD-004).
- **T018**: Servicio de historial de parámetros (`registrar_parametro`, `consultar_parametro_vigente` vía `DISTINCT ON`); endpoints `POST /admin/parametros`, `GET /admin/parametros/{clave}`.
- **T019**: Endpoints `POST /admin/arco`, `GET /admin/arco`, `PATCH /admin/arco/{id}/resolver`.

## Fase 4 — Integración

- **T020**: Publicar `services/auditoria.registrar_evento` como dependencia importable para que los routers de `001` a `009` la usen en sus propias operaciones críticas (retrofit documentado, sin modificar los contratos OpenAPI ya entregados de esos módulos).
- **T021**: Verificar en un entorno con Docker Compose levantado que el flujo completo de `quickstart.md` pasa de principio a fin, incluyendo el escenario de anomalía de autenticación.

## Fase 5 — Polish

- **T022 [P]** *(actualizado por la constitución v1.3.0)*: Componentes React + TypeScript: `Usuarios.tsx`, `Auditoria.tsx`, `Parametros.tsx`, `SolicitudesArco.tsx`, `MatrizPermisos.tsx`. Estilos con los tokens de Tailwind del Art. 11.1 — ningún color suelto. Animación con Framer Motion, respetando `prefers-reduced-motion` y sin retrasar el acceso a ninguna función (Art. 5.4). Nota del módulo: la matriz de permisos es de solo lectura: la interfaz no debe insinuar que se puede editar.
- **T023 [P]**: Revisar `checklists/requirements.md` de este módulo contra la implementación final antes de marcarlo completo.

## Fase 2b y 3b — Enmienda v1.1 (normalización de catálogos)

- **T024**: Migración de los 5 catálogos **con su seed en la misma revisión**. `rol` con `nivel_jerarquico` 1..4 y `alcance_cadena=true` solo en `dueno` y `encargado_compras`; `recurso_sistema` sembrado con **todos** los recursos que la matriz de permisos y el log usan hoy, cada uno con su `modulo`; `operacion` sin `'eliminar'`; `tipo_solicitud_arco` con el plazo legal de cada derecho. Conversión de los 6 campos a FK (`usuario.rol`, `permiso_rol.rol/recurso/operacion`, `log_auditoria.recurso`, `solicitud_arco.tipo/estado`). *(Fase 1 — prerrequisito de todo lo demás del módulo.)*
- **T025 [P]**: `POST /admin/usuarios` con un `rol` inexistente en el catálogo → `404` (RF-AD-011).
- **T026 [P]**: `INSERT` directo en `log_auditoria` con un `recurso` que no está en `recurso_sistema` → la base lo rechaza (CA-AD-005, RF-AD-012). **Test contra la base, no contra la API.**
- **T027 [P]**: Verificar que `permiso_rol` y `log_auditoria` referencian el **mismo** catálogo: un recurso presente en la matriz de permisos se puede auditar, y uno ausente no.
- **T028 [P]**: `GET /catalogos/roles` → los 4 roles con `nivel_jerarquico` único y `alcance_cadena` correcto (RN-AD-005).
- **T029 [P]**: **Test crítico de RN-AD-004**: insertar por SQL un rol nuevo `'supervisor_zona'` con `alcance_cadena=true`, asignarlo a un usuario y verificar que `scoping.py` le aplica alcance de cadena **sin ningún cambio de código**, y que RN-AD-001 le impide tener filas en `usuario_sucursal` (CA-AD-004).
- **T030 [P]**: Revisión de código de `scoping.py`: **no debe existir ninguna comparación contra `'dueno'` ni `'encargado_compras'` literales** (RN-AD-004). Es el punto donde una lista desactualizada deja un rol viendo toda la red sin lanzar ningún error.
- **T031 [P]**: `GET /catalogos/operaciones` → no incluye `'eliminar'` (Decisión 7D).
- **T032 [P]**: `GET /admin/arco?solo_vencidas=true` con una solicitud `pendiente` creada hace más días que su `plazo_respuesta_dias` → aparece; con una dentro de plazo → no aparece (CA-AD-006, RF-AD-013).
- **T033 [P]**: Verificar que ningún router expone `POST`/`PATCH`/`DELETE` sobre los 5 catálogos (RN-AD-007) — son solo lectura, igual que `permiso_rol`.
- **T034**: Los 5 endpoints `GET /catalogos/...`.
- **T035**: Refactorizar `scoping.py` para resolver el alcance consultando `rol.alcance_cadena`, con caché en memoria del catálogo (son 4 filas que cambian por migración, no en caliente) para no consultar la base en cada request.
- **T036**: Ajustar la validación de RN-AD-001 en el servicio de asignación de sucursales para leer `rol.alcance_cadena` en vez de la lista de dos códigos.
- **T037**: Endpoint `GET /admin/arco` con `solo_vencidas`, derivando la fecha límite de `fecha_solicitud + tipo_solicitud_arco.plazo_respuesta_dias` **sin materializarla como columna**.

## Dependencias entre fases

Fase 1 → Fase 2 → Fase 2b → Fase 3 → Fase 3b → Fase 4 → Fase 5.

*(Enmienda v1.1)* **T024 va en Fase 1 y es el prerrequisito más amplio de todo el proyecto**, no solo de este módulo: al volver `usuario.rol` una FK, ningún test de ningún módulo que cree un usuario pasa hasta que `rol` exista poblado. T035 y T036 dependen de T024 y modifican código compartido por los 11 módulos, así que su regresión se verifica con T029/T030, no solo con los tests de este módulo. T013 es prerrequisito de todos los demás endpoints protegidos (todos dependen del JWT emitido en T013). T017 es prerrequisito de T020.
