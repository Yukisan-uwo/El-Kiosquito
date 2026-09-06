# Plan Técnico: Administración

**Feature**: `010-administracion` | **Fecha**: 2026-09-04
**Entrada**: `spec.md`

## Resumen Técnico

Módulo dueño de `usuario`, autenticación (JWT) y gobernanza: RBAC (rol + alcance de sucursal), matriz de permisos de referencia, log de auditoría inmutable, historial de parámetros globales (IVA, moneda) y solicitudes ARCO. Es el único módulo que puede escribir en `usuario` y `usuario_sucursal`; todos los demás módulos (001-009) lo consultan solo por FK o por el JWT que este módulo emite.

## Contexto Técnico

- **Lenguaje/Stack**: Python 3.11, FastAPI, SQLAlchemy, Alembic, PyJWT, bcrypt (Art. 5.1, 5.3).
- **Base de datos**: PostgreSQL (capa operativa, Art. 5.2).
- **Dependencias externas de este módulo**: `sucursal` (`009-expansion-sucursales`), para poblar `usuario_sucursal`.
- **Consumidores de este módulo**: los 9 módulos restantes (001-009), que dependen del JWT emitido aquí para RBAC y referencian `usuario` como FK externa; `011-analitica-reportes`, que puede consultar `log_auditoria` como fuente de eventos para el pipeline ETL.

## Constitution Check

| Artículo | Regla | Mecanismo de cumplimiento en este módulo |
|---|---|---|
| 3.1, 3.3 | Jerarquía de 4 roles con alcance por sucursal | `usuario.rol` + `usuario_sucursal`; el JWT emitido por `POST /auth/login` lleva `rol` y `sucursal_ids` como claims, consumidos por `scoping.py` de cada módulo |
| 5.9 | RBAC vía JWT, ningún endpoint puede omitir validación de alcance | Este módulo es la fuente de verdad de esos claims; `permiso_rol` documenta qué combinación rol×recurso×operación es válida |
| 9.1 | Enmiendas de constitución versionadas, nunca mutación en caliente | `permiso_rol` se siembra por migración, sin endpoint de escritura (Decisión 3) |
| 10.3, 10.4 | Mecanismo ARCO, consentimiento versionado | `solicitud_arco`; el consentimiento de fidelización en sí (fecha/hora/versión de política) es responsabilidad de `002-clientes-fidelizacion` al registrar el cliente, este módulo solo gestiona la resolución de la solicitud ARCO |
| 10.5 | Auditoría inmutable de accesos no autorizados/anomalías | `log_auditoria`, `exitoso=false` para esos casos (Decisión 4) |
| 10.7 | Contraseñas con hash bcrypt, nunca en texto plano en logs | `usuario.password_hash`; `log_auditoria` nunca persiste el valor de la contraseña ingresada |

## Estructura del Proyecto

```
backend/
  app/
    models/administracion.py
    schemas/administracion.py
    services/
      administracion.py       # asignación de rol/sucursales, historial de parámetros
      auth.py                 # login, emisión de JWT, hash de contraseña
      auditoria.py             # helper reutilizado por los demás módulos para registrar eventos críticos
    routers/administracion.py
  alembic/versions/xxxx_administracion.py
frontend/                              # React + Vite (constitución v1.3.0)
  src/features/admin/
    Usuarios.tsx
    Auditoria.tsx
    Parametros.tsx
    SolicitudesArco.tsx
    MatrizPermisos.tsx
  src/api/                             # cliente generado desde el contrato OpenAPI
tests/
  test_administracion_api.py
  test_administracion_negocio.py
```

## Endpoints REST

| Método | Ruta | Descripción | Código |
|---|---|---|---|
| POST | `/api/v1/auth/login` | Autenticar usuario, emitir JWT | RF-AD-010 |
| POST | `/api/v1/admin/usuarios` | Registrar usuario | RF-AD-001 |
| PATCH | `/api/v1/admin/usuarios/{id}` | Actualizar usuario | RF-AD-002 |
| PATCH | `/api/v1/admin/usuarios/{id}/rol-sucursales` | Asignar rol y sucursales | RF-AD-003 |
| PATCH | `/api/v1/admin/usuarios/{id}/desactivar` | Baja lógica de usuario | RF-AD-007 |
| GET | `/api/v1/admin/permisos` | Consultar matriz de permisos | RF-AD-004 |
| GET | `/api/v1/admin/auditoria` | Consultar/exportar log de auditoría | RF-AD-006 |
| POST | `/api/v1/admin/parametros` | Registrar nuevo valor de parámetro global | RF-AD-008 |
| GET | `/api/v1/admin/parametros/{clave}` | Consultar valor vigente de un parámetro | RF-AD-008 |
| POST | `/api/v1/admin/arco` | Registrar solicitud ARCO de un cliente | RF-AD-009 |
| GET | `/api/v1/admin/arco` | Listar solicitudes ARCO (filtrable por estado) | RF-AD-009 |
| PATCH | `/api/v1/admin/arco/{id}/resolver` | Registrar resolución de una solicitud ARCO | RF-AD-009 |

## Modelo de Datos (resumen — ver `data-model.md`)

6 tablas: `usuario`, `usuario_sucursal` (relación N:M), `permiso_rol` (referencia, sembrada por migración), `log_auditoria` (append-only), `historial_parametro_sistema` (append-only), `solicitud_arco`.

*(Enmienda v1.1)* Más 5 catálogos maestros de clave natural: `rol` (con `nivel_jerarquico` único y `alcance_cadena`), `recurso_sistema` (con `modulo` y `es_auditable`), `operacion` (con `es_escritura`), `tipo_solicitud_arco` (con `plazo_respuesta_dias`) y `estado_solicitud_arco`. Los cinco son de **solo lectura desde la API**, igual que `permiso_rol`: un endpoint que creara roles en caliente sería una vía de escalación de privilegios.

**`rol` y `recurso_sistema` son los dos catálogos más transversales del proyecto** — los consumen los 11 módulos vía `scoping.py` y el log de auditoría. Resuelven la peor duplicación de vocabulario que quedaba: el CHECK de 4 roles estaba escrito dos veces (`usuario` y `permiso_rol`) y `recurso` era TEXT libre en dos tablas (`permiso_rol` y `log_auditoria`), sin nada que garantizara que coincidieran.

**RN-AD-001 sigue aplicándose en el servicio**, no en la base: ahora lee `rol.alcance_cadena` en vez de tener la lista de roles quemada, pero mover la regla al motor exigiría una columna redundante y cambiar dónde se aplica una regla ya aprobada (Decisión 7C de `research.md`).

## Fases

- **Fase 0**: Este `plan.md` + `research.md` (decisiones 1-6 ya resueltas).
- **Fase 1**: `data-model.md`, `contracts/administracion.openapi.yaml`, `quickstart.md`.
- **Fase 2**: `tasks.md` con tests de contrato primero, luego implementación.

## Riesgos y Decisiones Técnicas Pendientes

`log_auditoria` recibirá volumen de escritura de los 9 módulos restantes simultáneamente — el `services/auditoria.py` de este módulo se expone como función Python importable (no como llamada HTTP) para los módulos que corren en el mismo proceso FastAPI, evitando la sobrecarga de una llamada de red por cada operación crítica del sistema; solo se documenta como llamada HTTP cuando el módulo consumidor corre en un servicio separado (no es el caso en la arquitectura actual de un solo backend FastAPI).
