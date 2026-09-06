# Checklist de Requisitos: Administración

**Feature**: `010-administracion` | **Fecha**: 2026-09-04

## Trazabilidad

- [ ] Todo RF-AD-XXX de `spec.md` tiene al menos un endpoint en `contracts/administracion.openapi.yaml`
- [ ] Todo endpoint del contrato tiene al menos un test de contrato en `tasks.md` (Fase 2)
- [ ] Todo RF/RNF/RN tiene código único y es trazable a un OO/OT de `ElKiosquito_Documento_Empresa_y_Objetivos.md` o a un artículo constitucional explícito (Art. 7.4 + Decisión 5 de `research.md` para el caso de `solicitud_arco`)

## Cumplimiento de constitución

- [ ] `log_auditoria` es estrictamente de solo inserción (RNF-AD-001) — ningún router expone `PATCH`/`DELETE` sobre esa tabla
- [ ] Ninguna contraseña se persiste ni se registra en texto plano, ni siquiera en `log_auditoria` (RNF-AD-002, Art. 10.7)
- [ ] `permiso_rol` no tiene ningún endpoint de escritura — cambiarla requiere una migración nueva, no una llamada a la API (RNF-AD-003, Art. 9.1)
- [ ] Un usuario `dueno` o `encargado_compras` nunca tiene filas en `usuario_sucursal` (RN-AD-001) — ver T007
- [ ] Un usuario `encargado_sucursal` o `cajero` no puede quedar sin al menos una sucursal asignada (RN-AD-002) — ver T006
- [ ] `solicitud_arco` no puede marcarse `atendida`/`rechazada` sin `fecha_resolucion`, `atendida_por` y `respuesta` (Art. 10.3) — ver T011/T012

## Casos límite cubiertos (de `spec.md`)

- [ ] Login con contraseña incorrecta queda auditado como anomalía, sin exponer la contraseña ingresada
- [ ] Cambio de IVA no afecta el cálculo de ventas ya registradas antes del cambio (CA-AD-002)
- [ ] Cambio de rol de un usuario no borra silenciosamente su historial de `usuario_sucursal` previo (RN-AD-003)
- [ ] Consulta de auditoría con `solo_anomalias=true` excluye las operaciones críticas normales

## Enmienda v1.1 (normalización de catálogos)

- [ ] `usuario.rol` y `permiso_rol.rol` referencian el **mismo** catálogo; el CHECK ya no está duplicado (RF-AD-011) — ver T025
- [ ] `permiso_rol.recurso` y `log_auditoria.recurso` referencian el **mismo** catálogo (RF-AD-012) — ver T026/T027
- [ ] Un `INSERT` en el log con un recurso desconocido es rechazado por la base (CA-AD-005) — ver T026
- [ ] **`scoping.py` no contiene ninguna comparación contra `'dueno'` ni `'encargado_compras'` literales** (RN-AD-004) — ver T030. Es el punto donde una lista desactualizada deja un rol viendo toda la red **sin lanzar ningún error**
- [ ] Un rol nuevo con `alcance_cadena=true` funciona sin cambios de código (CA-AD-004) — ver T029
- [ ] `rol.nivel_jerarquico` es único (RN-AD-005) — ver T028
- [ ] `operacion` no incluye `'eliminar'` (Decisión 7D) — ver T031
- [ ] Ningún router expone escritura sobre los 5 catálogos (RN-AD-007) — ver T033. Un endpoint de creación de roles sería una vía de escalación de privilegios
- [ ] `GET /admin/arco?solo_vencidas=true` deriva la fecha límite del catálogo, sin materializarla como columna (RF-AD-013) — ver T032/T037
- [ ] Los 5 catálogos tienen seed dentro de su propia migración Alembic (T024)
- [ ] **T024 se ejecuta antes que los tests de todos los demás módulos**: al volver `usuario.rol` una FK, ningún test que cree un usuario pasa sin el catálogo `rol` poblado
- [ ] RN-AD-001 sigue aplicándose en el servicio, ahora leyendo `rol.alcance_cadena` (Decisión 7C) — la alternativa de FK compuesta queda documentada, no aplicada

## Fuera de alcance (documentado, no pendiente)

- [ ] El motor de reglas que aplica la matriz de permisos endpoint por endpoint en cada módulo (`scoping.py` de cada módulo) — este módulo solo expone la matriz como referencia consultable
- [ ] Recuperación de contraseña por correo ("olvidé mi contraseña") — no forma parte del enunciado del examen ni de la cascada de objetivos
