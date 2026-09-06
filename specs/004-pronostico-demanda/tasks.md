# Tareas de Implementación: Pronóstico de Demanda

**Feature**: `004-pronostico-demanda` | **Fecha**: 2026-09-04
**Entrada**: `plan.md`, `data-model.md`, `contracts/pronostico-demanda.openapi.yaml`

`[P]` = paralelizable dentro de su bloque.

## Fase 1 — Setup

- **T001**: Migración Alembic de las 3 tablas (`demanda_insatisfecha` con `sustituto_ofrecido_id`/`sustituto_aceptado`, `pronostico_demanda`, `evento_local`), con CHECK e índices.
- **T002 [P]**: Modelos SQLAlchemy en `backend/app/models/pronostico_demanda.py`.
- **T003 [P]**: Esquemas Pydantic en `backend/app/schemas/pronostico_demanda.py`.

## Fase 2 — Tests de contrato primero

- **T004 [P]**: `POST /pronostico/demanda-insatisfecha` con `hora_evento` distinta a la actual (registro diferido) → `201`.
- **T005 [P]**: `POST /pronostico/demanda-insatisfecha` con token de sucursal distinta a la del cuerpo → `403` (Art. 3.3).
- **T006 [P]**: `GET /pronostico/demanda-insatisfecha` con rango de fechas → devuelve solo los eventos dentro del rango.
- **T007 [P]**: `POST /pronostico/ciclos` sin `tamano_muestra` o sin `periodo_inicio`/`periodo_fin` → `422` (Art. 5.9).
- **T008 [P]**: `GET /pronostico/{producto_id}` de un producto/sucursal sin ciclo registrado → `datos_suficientes: false`, nunca una cantidad recomendada inventada (RN-PD-001).
- **T009 [P]**: `GET /pronostico/{producto_id}` de un producto/sucursal con dos ciclos registrados → devuelve el de `fecha_calculo` más reciente.
- **T009b [P]** *(enmienda v1.1)*: `POST /pronostico/demanda-insatisfecha` sin `sustituto_ofrecido_id` ni `sustituto_aceptado` → `201` (siguen siendo opcionales, no rompe el flujo existente).
- **T009c [P]** *(enmienda v1.1)*: `POST /pronostico/demanda-insatisfecha` con `sustituto_ofrecido_id` informado pero sin `sustituto_aceptado` → `422` (RF-PD-006).
- **T009d [P]** *(enmienda v1.1)*: `POST /pronostico/eventos-locales` con `fecha_fin` anterior a `fecha_inicio` → `422`.
- **T009e [P]** *(enmienda v1.1)*: `GET /pronostico/eventos-locales?desde=...&hasta=...` sin `sucursal_id` → devuelve tanto los eventos de toda la cadena (`sucursal_id NULL`) como los de sucursales específicas dentro del rango; con `sucursal_id` → filtra solo esa sucursal más los de toda la cadena.

## Fase 3 — Implementación core

- **T010**: Endpoint `POST /pronostico/demanda-insatisfecha`, con scoping de sucursal.
- **T011**: Endpoint `GET /pronostico/demanda-insatisfecha`.
- **T012**: Servicio `obtener_pronostico_reciente` (DISTINCT ON / ORDER BY fecha_calculo DESC LIMIT 1, o `datos_suficientes: false` si no hay fila); endpoint `POST /pronostico/ciclos`, `GET /pronostico/{producto_id}`.
- **T012b** *(enmienda v1.1)*: Endpoints `POST /pronostico/eventos-locales` y `GET /pronostico/eventos-locales` (filtro por rango de fechas y, opcionalmente, sucursal — incluyendo siempre los eventos de alcance de cadena).

## Fase 4 — Integración

- **T013**: Conectar el formulario de POS de `001-core-ventas-inventario` (pantalla de venta) al endpoint `POST /pronostico/demanda-insatisfecha` de este módulo, como llamada HTTP entre módulos (nunca tabla compartida) — incluyendo, cuando aplique, los campos `sustituto_ofrecido_id`/`sustituto_aceptado` (enmienda v1.1, consultando el catálogo `producto_sustituto` de `001-core-ventas-inventario` para ofrecer la sugerencia en la pantalla).
- **T014**: Dejar documentado en el `plan.md` de `008-compras-proveedores` (al reconstruirlo) que su stub de pronóstico debe reemplazarse por `GET /pronostico/{producto_id}` de este módulo.

## Fase 2b y 3b — Enmienda v1.2 (normalización de catálogos)

- **T017**: Migración del catálogo `tipo_evento_local` **con su seed en la misma revisión**, y conversión de `evento_local.tipo` de CHECK a FK. *(Fase 1 — prerrequisito: sin catálogo poblado ningún `POST /pronostico/eventos-locales` funciona.)*
- **T018 [P]**: `POST /pronostico/eventos-locales` con un `tipo` que no existe en el catálogo → `404` (RF-PD-009).
- **T019 [P]**: `GET /catalogos/tipos-evento-local` → los cinco tipos con su `afecta_demanda_al_alza`; verificar que `feriado`, `fiesta_patronal` y `evento_comunitario` vienen en `true`, y `clima_extremo` y `corte_servicios` en `false` (RF-PD-010).
- **T020 [P]**: Insertar un tipo nuevo en el catálogo por SQL y registrar un evento con él → `201`, **sin migración de esquema** (antes exigía modificar el CHECK).
- **T021 [P]**: Verificar que ningún router expone `DELETE` sobre `tipo_evento_local` (RN-PD-002).
- **T022**: Endpoint `GET /catalogos/tipos-evento-local`.
- **T023**: Al preparar el dataset de entrenamiento del modelo, tomar el signo del efecto de `tipo_evento_local.afecta_demanda_al_alza` y **no** inferirlo de los datos históricos (RN-PD-003). Documentarlo como comentario en el servicio: es la regla más fácil de romper sin darse cuenta al escribir la ingeniería de features.

## Fase 5 — Polish

- **T015 [P]** *(actualizado por la constitución v1.3.0)*: Componentes React + TypeScript: `DemandaInsatisfecha.tsx` (formulario rápido para el cajero, con el bloque opcional de sustituto) y `EventosLocales.tsx`. Estilos con los tokens de Tailwind del Art. 11.1 — ningún color suelto. Animación con Framer Motion, respetando `prefers-reduced-motion` y sin retrasar el acceso a ninguna función (Art. 5.4). Nota del módulo: el formulario del cajero debe ser el componente más rápido de todos: sin animación de entrada.

- **T016 [P]**: Revisar `checklists/requirements.md` contra la implementación final.

## Dependencias entre fases

Fase 1 → Fase 2 → Fase 2b → Fase 3 → Fase 3b → Fase 4 → Fase 5. T012 es prerrequisito de T014. T012b no tiene dependencias fuera de su propia fase.

*(Enmienda v1.2)* **T017 va en Fase 1**, antes que cualquier test: al volver `evento_local.tipo` una FK, ningún test que registre un evento pasa hasta que el catálogo exista poblado. T023 no es un test sino una regla de implementación del pipeline de features — se verifica revisando el código, no con una llamada a la API.
