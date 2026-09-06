# Tareas de Implementación: Core de Ventas e Inventario

**Feature**: `001-core-ventas-inventario` | **Fecha**: 2026-09-04
**Entrada**: `plan.md`, `data-model.md`, `contracts/core-ventas-inventario.openapi.yaml`

`[P]` = paralelizable dentro de su bloque.

## Fase 1 — Setup

- **T001**: Migración Alembic de las 6 tablas (`producto`, `stock_sucursal`, `lote_producto`, `ajuste_inventario`, `venta`, `detalle_venta`), con todos los CHECK e índices.
- **T002 [P]**: Modelos SQLAlchemy en `backend/app/models/core_ventas_inventario.py`.
- **T003 [P]**: Esquemas Pydantic en `backend/app/schemas/core_ventas_inventario.py`.

## Fase 2 — Tests de contrato primero

- **T004 [P]**: `POST /ventas` con producto fraccionado y conversión correcta.
- **T005 [P]**: `POST /ventas` con producto fraccionable sin `factor_conversion` → `422`.
- **T006 [P]**: `PATCH /ventas/{id}/anular` sin motivo → `422`.
- **T007 [P]**: `POST /productos` con `es_fraccionable=true` sin `factor_conversion` → `422`.
- **T008 [P]**: `POST /inventario/ingresos` de perecedero con fecha → verifica creación de lote.
- **T009 [P]**: `POST /inventario/ingresos` de NO perecedero con fecha enviada por error → no crea lote.
- **T010 [P]**: `PATCH /inventario/lotes/{id}/retiro` con cantidad mayor a la restante → `422`.
- **T011 [P]**: `POST /inventario/ajustes` que dejaría stock negativo → `422`.
- **T012 [P]**: `POST /inventario/rotacion/evaluar` → marca y desmarca correctamente.
- **T013 [P]**: Test de scoping: token de sucursal A contra `turno_caja_id`/`sucursal_id` de sucursal B → `403`.

## Fase 3 — Implementación core

- **T014**: Servicio `calcular_totales_venta` (IVA 15%, total).
- **T015**: Servicio `convertir_a_unidad_inventario` (valida `factor_conversion`, RN-CVI-001).
- **T016**: Dependencia de scoping `backend/app/services/scoping.py`.
- **T017**: Endpoint `POST /ventas`, usando T014/T015/T016.
- **T018**: Endpoints `PATCH /ventas/{id}/pago`, `/descuento`, `/anular`.
- **T019**: Endpoints `POST/PATCH /productos`, con T015 aplicado a la validación de creación.
- **T020**: Servicio `registrar_ingreso` (stock + lote condicional); endpoint `POST /inventario/ingresos`.
- **T021**: Endpoints `GET /inventario/proximos-a-caducar`, `PATCH /inventario/lotes/{id}/retiro`.
- **T022**: Endpoint `GET /inventario/stock/{producto_id}`.
- **T023**: Servicio `aplicar_ajuste_inventario` (RF-CVI-014); endpoint `POST /inventario/ajustes`.
- **T024**: Servicio y endpoint del batch de rotación; endpoint `GET /inventario/sin-rotacion`.
- **T024b** *(enmienda v1.1)*: Servicio `registrar_producto_sustituto` (aplica RN-CVI-004, inserta par simétrico si corresponde); endpoints `POST`/`GET /productos/{id}/sustitutos`.
- **T024c** *(enmienda v1.2)*: Endpoint `PATCH /inventario/stock/{producto_id}/minimo`; endpoint `GET /inventario/stock-bajo` (`WHERE cantidad_disponible < stock_minimo`, sin tabla ni servicio adicional). `numero_documento` no requiere tarea de implementación propia — es una columna `GENERATED` resuelta en T001.

## Fase 2b — Tests de contrato de la enmienda v1.1 (nuevas, `[P]`)

- **T029 [P]**: `POST /ventas` con `hora_inicio_cobro` presente → la respuesta permite calcular `fecha_hora - hora_inicio_cobro`; con `hora_inicio_cobro` ausente → `201` igual (opcional, no bloquea).
- **T030 [P]**: `POST /productos/{id}/sustitutos` con `producto_sustituto_id = id` → `422` (RN-CVI-004).
- **T031 [P]**: `POST /productos/{id}/sustitutos` con `simetrico=true` → verifica que se crearon las dos filas `(A,B)` y `(B,A)`.
- **T032 [P]**: `GET /productos/{id}/sustitutos` → devuelve solo los `activo=true`.

## Fase 2c — Tests de contrato de la enmienda v1.2 (nuevas, `[P]`)

- **T033 [P]**: `POST /ventas` → la respuesta incluye `numero_documento` con formato `V-00000001`, y dos ventas seguidas nunca repiten el mismo valor.
- **T034 [P]**: `PATCH /inventario/stock/{producto_id}/minimo` con `stock_minimo` negativo → `422` (RN-CVI-005).
- **T035 [P]**: `PATCH /inventario/stock/{producto_id}/minimo` seguido de una venta que deja `cantidad_disponible` por debajo del umbral → `GET /inventario/stock-bajo` incluye ese producto.
- **T036 [P]**: `GET /inventario/stock-bajo` de una sucursal sin ningún producto bajo su `stock_minimo` → devuelve lista vacía, nunca un error.

## Fase 2d — Tests de contrato de la enmienda v1.3 (nuevas, `[P]`)

- **T037 [P]**: Migración de los 5 catálogos **con su seed en la misma revisión Alembic** (`categoria`, `unidad_medida`, `metodo_pago`, `estado_pago`, `estado_venta`), más el cambio de `producto.categoria`/`unidad_venta`/`unidad_inventario` a FK y la sustitución de los 3 CHECK de `venta` por FK. El seed va dentro de la migración: un catálogo vacío rompe la FK de la tabla que lo usa y el sistema no arranca. *(Esta es de Fase 1, se ejecuta antes que el resto de la fase 2d.)*
- **T038 [P]**: `POST /productos` con `categoria_id` inexistente → `404`; con `unidad_venta_codigo` inexistente → `404` (RF-CVI-023, RF-CVI-025).
- **T039 [P]**: `POST /productos` con `es_fraccionable=true` y una `unidad_venta_codigo` cuyo `permite_decimales=false` → `422` (RN-CVI-006).
- **T040 [P]**: `POST /productos` sin `es_perecedero` y con una `categoria_id` cuyo `es_perecedero=true` → el producto se crea con `es_perecedero=true` heredado; enviarlo explícitamente en `false` con esa misma categoría → se respeta el `false` (el producto manda sobre la categoría).
- **T041 [P]**: `POST /catalogos/categorias` con `categoria_padre_id` que ya tiene padre → `422` (RN-CVI-008, jerarquía de dos niveles).
- **T042 [P]**: `PATCH /catalogos/categorias/{id}` con `activo=false` sobre una categoría con productos activos → `409` (no deja productos apuntando a un catálogo inactivo).
- **T043 [P]**: `GET /catalogos/categorias?como_arbol=true` → las subcategorías vienen anidadas dentro de su padre, no como lista plana.
- **T044 [P]**: `GET /catalogos/metodos-pago` → cada fila trae `es_electronico`; verificar que el % de adopción de OT2.2 se puede calcular filtrando por ese campo sin enumerar códigos.
- **T045 [P]**: Verificar que ningún router expone `DELETE` sobre los 5 catálogos (RN-CVI-009) — la baja es `activo=false`.
- **T046 [P]**: `POST /ventas` con un `metodo_pago` que no existe en el catálogo → `404`, y tras insertar ese método en el catálogo, la misma petición → `201` **sin ninguna migración de esquema** (demuestra la ventaja de haber sacado el vocabulario del CHECK).

## Fase 3b — Implementación de la enmienda v1.3

- **T047**: Router `backend/app/routers/catalogos.py` con los 5 endpoints de consulta y el CRUD de `categoria` (los otros 4 catálogos son solo lectura desde la API: se modifican por migración, no por endpoint).
- **T048**: Servicio `backend/app/services/catalogos.py` — validación de jerarquía de dos niveles (RN-CVI-007, RN-CVI-008), baja con productos activos (`409`), y armado del árbol para `como_arbol=true`.
- **T049**: Validación de RN-CVI-006 dentro del servicio de productos: al crear o actualizar, si `es_fraccionable=true` se consulta `unidad_medida.permite_decimales` de la unidad de venta elegida.
- **T050**: Herencia de `es_perecedero` desde `categoria` al crear un producto cuando el campo no viene en la petición.

## Fase 4 — Integración

- **T025**: Conectar ventas, anulaciones, ingresos y ajustes al log de auditoría de Administración.
- **T025b** *(enmienda v1.3)*: Auditar también las altas, bajas y modificaciones de `categoria` en el log de `010-administracion`. Los catálogos no llevan columnas propias de auditoría precisamente porque esa responsabilidad es del log inmutable (Art. 10.5).
- **T026**: Verificar en Docker Compose que el flujo completo de `quickstart.md` pasa de principio a fin, incluyendo la creación previa de un `turno_caja_id` en `006`.

## Fase 5 — Polish

- **T027 [P]** *(actualizado por la constitución v1.3.0)*: Componentes React + TypeScript: `PuntoDeVenta.tsx`, `CatalogoProductos.tsx`, `IngresoStock.tsx`, `ProximosACaducar.tsx`, `AbmCategorias.tsx`. Estilos con los tokens de Tailwind del Art. 11.1 — ningún color suelto. Animación con Framer Motion, respetando `prefers-reduced-motion` y sin retrasar el acceso a ninguna función (Art. 5.4). Nota del módulo: El POS es la pantalla más usada del sistema: la animación no puede retrasar el registro de una venta (Art. 5.4).
- **T028 [P]**: Revisar `checklists/requirements.md` contra la implementación final.

## Dependencias entre fases

Fase 1 → Fase 2 → Fase 2b → Fase 2c → Fase 2d → Fase 3 → Fase 3b → Fase 4 → Fase 5. T014/T015/T016 son prerrequisito de T017. T024b y T024c son independientes del resto de la Fase 3 (no dependen de ningún otro servicio de este módulo).

*(Enmienda v1.3)* **T037 es prerrequisito de todo lo demás del módulo**, incluidas las tareas ya existentes: al cambiar `producto.categoria` y las unidades a FK, ningún test que cree un producto puede pasar hasta que los catálogos existan y estén poblados. Por eso T037 se ejecuta en Fase 1 aunque su numeración sea posterior — es la única tarea de la enmienda que no es `[P]` respecto del resto del módulo. T049 y T050 dependen de T037; T047 y T048 son independientes entre sí una vez hecha T037.
