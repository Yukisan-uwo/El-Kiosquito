# Tareas de Implementación: Promociones Inteligentes

**Feature**: `005-promociones-inteligentes` | **Fecha**: 2026-09-04
**Entrada**: `plan.md`, `data-model.md`, `contracts/promociones-inteligentes.openapi.yaml`

`[P]` = paralelizable dentro de su bloque.

## Fase 1 — Setup

- **T001**: Migración Alembic de la tabla `cupon`, con el CHECK de RN-PI-002 y los índices.
- **T002 [P]**: Modelos SQLAlchemy en `backend/app/models/promociones_inteligentes.py`.
- **T003 [P]**: Esquemas Pydantic en `backend/app/schemas/promociones_inteligentes.py`.

## Fase 2 — Tests de contrato primero

- **T004 [P]**: `POST /promociones/cupones` con `tipo_origen=cumpleanos` → `201`.
- **T005 [P]**: `POST /promociones/cupones` con `tipo_origen=recuperacion_churn` sin `evaluacion_churn_id` → `422` (RN-PI-002).
- **T006 [P]**: `PATCH /promociones/cupones/{id}/canjear` de un cupón activo y vigente → `200`, `estado` pasa a `canjeado`.
- **T007 [P]**: `PATCH /promociones/cupones/{id}/canjear` repetido sobre el mismo cupón → `422` (RN-PI-001).
- **T008 [P]**: `PATCH /promociones/cupones/{id}/canjear` de un cupón con `fecha_expiracion` pasada → `422` (RN-PI-001).
- **T009 [P]**: `GET /clientes/{cliente_id}/cupones` de un cliente con cupones activos e históricos → devuelve ambos.

## Fase 3 — Implementación core

- **T010**: Endpoint `POST /promociones/cupones`, con generación de `codigo` único y la validación de RN-PI-002.
- **T011**: Servicio `canjear_cupon` (transacción atómica: valida `estado`/`fecha_expiracion`, luego actualiza `estado`, `venta_id_canje`, `fecha_canje`); endpoint `PATCH /promociones/cupones/{id}/canjear`.
- **T012**: Endpoint `GET /clientes/{cliente_id}/cupones`.

## Fase 4 — Integración

- **T013**: Conectar el flujo de canje al log de auditoría inmutable de Administración (Art. 10.5).
- **T014**: Verificar en Docker Compose que `002-clientes-fidelizacion` puede vincular `cupon_id` en `campana_recuperacion` contra un cupón creado en este módulo.

## Fase 5 — Polish

- **T015 [P]** *(actualizado por la constitución v1.3.0)*: Componentes React + TypeScript: `Cupones.tsx`, `CanjeCupon.tsx`. Estilos con los tokens de Tailwind del Art. 11.1 — ningún color suelto. Animación con Framer Motion, respetando `prefers-reduced-motion` y sin retrasar el acceso a ninguna función (Art. 5.4). Nota del módulo: el canje es una acción de mostrador: confirmación inmediata, animación mínima.
- **T016 [P]**: Revisar `checklists/requirements.md` contra la implementación final.

## Fase 2b y 3b — Enmienda v1.1 (normalización de catálogos)

- **T017**: Migración de los 3 catálogos **con su seed en la misma revisión** (`tipo_origen_cupon`, `tipo_descuento`, `estado_cupon`) y conversión de los 3 CHECK de `cupon` a FK. El CHECK de RN-PI-002 **no se toca** (Decisión 4A). *(Fase 1 — prerrequisito de todo lo demás.)*
- **T018 [P]**: `POST /promociones/cupones` con `tipo_origen` inexistente en el catálogo → `404` (RF-PI-005).
- **T019 [P]**: `POST /promociones/cupones` con `descuento_tipo: "porcentaje"` y `descuento_valor: 200` → `422` (RN-PI-004). **Este test falla contra el diseño anterior**: antes de la enmienda ese cupón se creaba sin error.
- **T020 [P]**: `POST /promociones/cupones` con `descuento_tipo: "porcentaje"` y `descuento_valor: 100` → `201` (el tope es inclusivo).
- **T021 [P]**: `POST /promociones/cupones` con `tipo_origen: "recuperacion_churn"` sin `evaluacion_churn_id` → sigue rechazándose por el CHECK de base de datos, no por el catálogo (RN-PI-002, Decisión 4A).
- **T022 [P]**: `GET /catalogos/tipos-origen-cupon` → `cumpleanos` y `patron_compra` con `es_automatico: true`; verificar que el indicador de OT2.3 se puede calcular filtrando por ese campo sin enumerar códigos (RF-PI-007).
- **T023 [P]**: `GET /catalogos/tipos-descuento` y `GET /catalogos/estados-cupon` → traen `valor_maximo_permitido` y `permite_canje` respectivamente.
- **T024 [P]**: Verificar que ningún router expone `DELETE` sobre los 3 catálogos (RN-PI-003); dar de baja `cumpleanos` con `activo=false` y comprobar que los cupones de cumpleaños ya emitidos se siguen consultando y canjeando.
- **T025**: Los 3 endpoints `GET /catalogos/...` en `routers/catalogos.py` de este módulo.
- **T026**: Validación de RN-PI-004 en el servicio de creación de cupón: consultar `tipo_descuento.valor_maximo_permitido` del tipo enviado antes de insertar.
- **T027**: Ajustar la validación de canje (RF-PI-002) para consultar `estado_cupon.permite_canje` en vez de comparar contra el literal `'activo'`.

## Dependencias entre fases

Fase 1 → Fase 2 → Fase 2b → Fase 3 → Fase 3b → Fase 4 → Fase 5. T011 es prerrequisito de T013.

*(Enmienda v1.1)* **T017 va en Fase 1**, antes que cualquier test: al volver los tres campos FK, ningún test que cree un cupón pasa hasta que los catálogos existan poblados. T027 modifica lógica de una tarea ya existente, así que va después de ella.
