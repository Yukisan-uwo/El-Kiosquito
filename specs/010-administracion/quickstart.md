# Guía de Arranque: Administración

**Feature**: `010-administracion` | **Fecha**: 2026-09-04

## Requisitos previos

- Docker Compose funcionando con `postgres` y `api`
- Ninguna dependencia de otro módulo para el arranque en frío de `usuario` — este módulo es la base de la que dependen los demás para autenticación

## Levantar el entorno

```bash
cd "Proyecto El Kiosquito"
docker compose up -d postgres api
docker compose exec api alembic upgrade head
```

La migración de este módulo siembra `permiso_rol` (Decisión 3) y un primer usuario `dueno` (`admin@elkiosquito.ec` / contraseña temporal) para poder autenticarse antes de crear el resto de usuarios.

## Flujo de prueba manual (cubre los escenarios de aceptación de `spec.md`)

### 1. Iniciar sesión como Dueño (RF-AD-010)

```bash
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@elkiosquito.ec", "password": "<contraseña temporal de la migración>"}'
```

Guarda `access_token` como `$TOKEN_DUENO` para los siguientes pasos.

### 2. Registrar un Encargado de Sucursal (RF-AD-001)

```bash
curl -X POST http://localhost:8000/api/v1/admin/usuarios \
  -H "Authorization: Bearer $TOKEN_DUENO" \
  -H "Content-Type: application/json" \
  -d '{"nombre": "Ana Torres", "email": "ana.torres@elkiosquito.ec", "password": "temporal123", "rol": "encargado_sucursal"}'
```

### 3. Asignar su sucursal (RF-AD-003, RN-AD-002)

```bash
curl -X PATCH http://localhost:8000/api/v1/admin/usuarios/<usuario_id>/rol-sucursales \
  -H "Authorization: Bearer $TOKEN_DUENO" \
  -H "Content-Type: application/json" \
  -d '{"rol": "encargado_sucursal", "sucursal_ids": [<sucursal_id>]}'
```

**Prueba negativa:** repetir el paso 3 con `"sucursal_ids": []` debe responder `422` (RN-AD-002).

### 4. Consultar la matriz de permisos (RF-AD-004)

```bash
curl "http://localhost:8000/api/v1/admin/permisos?rol=cajero" \
  -H "Authorization: Bearer $TOKEN_DUENO"
```

### 5. Registrar un cambio de IVA y verificar el historial (RF-AD-008, CA-AD-002)

```bash
curl -X POST http://localhost:8000/api/v1/admin/parametros \
  -H "Authorization: Bearer $TOKEN_DUENO" \
  -H "Content-Type: application/json" \
  -d '{"clave": "iva", "valor": "0.15"}'

curl "http://localhost:8000/api/v1/admin/parametros/iva" \
  -H "Authorization: Bearer $TOKEN_DUENO"
```

### 6. Consultar auditoría con anomalías (RF-AD-006, Art. 10.5)

```bash
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@elkiosquito.ec", "password": "clave-incorrecta"}'

curl "http://localhost:8000/api/v1/admin/auditoria?solo_anomalias=true" \
  -H "Authorization: Bearer $TOKEN_DUENO"
```

El intento de login fallido del primer `curl` debe aparecer en el listado del segundo, con `exitoso=false` y sin el valor de la contraseña ingresada (RNF-AD-002).

### 7. Registrar y resolver una solicitud ARCO (RF-AD-009)

```bash
curl -X POST http://localhost:8000/api/v1/admin/arco \
  -H "Authorization: Bearer $TOKEN_DUENO" \
  -H "Content-Type: application/json" \
  -d '{"cliente_id": "<cliente_id>", "tipo": "acceso", "detalle": "Solicita copia de su historial de compras"}'

curl -X PATCH http://localhost:8000/api/v1/admin/arco/<solicitud_id>/resolver \
  -H "Authorization: Bearer $TOKEN_DUENO" \
  -H "Content-Type: application/json" \
  -d '{"estado": "atendida", "respuesta": "Historial enviado por correo el 04/09/2026"}'
```

### 8. Catálogos de gobernanza (RF-AD-011 a RF-AD-014, enmienda v1.1)

```bash
curl "http://localhost:8000/api/v1/catalogos/roles" -H "Authorization: Bearer $TOKEN_DUENO"
curl "http://localhost:8000/api/v1/catalogos/recursos-sistema?modulo=008-compras-proveedores" -H "Authorization: Bearer $TOKEN_DUENO"
curl "http://localhost:8000/api/v1/catalogos/operaciones" -H "Authorization: Bearer $TOKEN_DUENO"
```

En roles: `dueno` y `encargado_compras` con `alcance_cadena: true`; los otros dos en `false`. Los cuatro `nivel_jerarquico` deben ser distintos (RN-AD-005). En operaciones: **no debe aparecer `eliminar`** — el Art. 2.4 prohíbe el borrado desde la aplicación, así que el catálogo no ofrece un permiso que el sistema nunca debe conceder.

**La prueba más importante de esta enmienda** (RN-AD-004, CA-AD-004):

```bash
docker compose exec postgres psql -U kiosquito -c \
  "INSERT INTO rol (codigo, etiqueta, nivel_jerarquico, alcance_cadena, orden)
   VALUES ('supervisor_zona','Supervisor de zona',2,true,5);"
```

Crea un usuario con `"rol": "supervisor_zona"` y llama con su token a cualquier endpoint con alcance por sucursal. Debe ver **toda la red**, sin haber tocado una línea de `scoping.py`. Y al intentar asignarle una sucursal → se rechaza (RN-AD-001, porque su rol tiene alcance de cadena).

Eso es lo que antes fallaba en silencio: con la lista `('dueno','encargado_compras')` escrita a mano, un rol nuevo quedaba **sin scoping aplicado** — no lanzaba ningún error, simplemente entregaba datos de toda la cadena a quien no debía. Es el único fallo de esta enmienda que no se nota hasta que ya pasó.

**Otras verificaciones:**

```bash
# El log no puede auditar un recurso que la matriz de permisos no conoce (CA-AD-005)
docker compose exec postgres psql -U kiosquito -c \
  "INSERT INTO log_auditoria (accion, recurso, exitoso) VALUES ('prueba','recurso_inventado',true);"
```

Debe fallar por violación de FK. Antes de la enmienda ese `INSERT` pasaba, y la consulta de auditoría por recurso devolvía resultados incompletos sin ningún error visible — el peor tipo de fallo en un log que existe para ser confiable (Art. 10.5).

```bash
# Solicitudes ARCO vencidas (RF-AD-013, CA-AD-006)
curl "http://localhost:8000/api/v1/admin/arco?solo_vencidas=true" -H "Authorization: Bearer $TOKEN_DUENO"
```

La fecha límite se deriva de `fecha_solicitud + tipo_solicitud_arco.plazo_respuesta_dias`; no está guardada como columna, para que no quede desactualizada si cambia el plazo legal de un tipo de derecho.

**Prueba negativa:** buscar un `POST` o `PATCH` sobre cualquiera de los cinco catálogos → la ruta no existe (RN-AD-007). Crear roles en caliente sería, literalmente, una vía de escalación de privilegios.

## Siguiente paso

Con `usuario`/`usuario_sucursal` funcionando, `009-expansion-sucursales` puede asignar `responsable_id` a una sucursal nueva (OO-ES04) referenciando usuarios ya creados aquí.
