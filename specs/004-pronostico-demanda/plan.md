# Plan Técnico: Pronóstico de Demanda

**Feature**: `004-pronostico-demanda` | **Fecha**: 2026-09-04
**Entrada**: `spec.md`

## Resumen Técnico

Módulo dueño de `demanda_insatisfecha` (captura cruda desde el POS) y de `pronostico_demanda` (resultado append-only del modelo de pronóstico). No implementa el modelo de pronóstico en sí — ese entrenamiento y esa predicción corren en la capa estratégica (pandas/numpy/scikit-learn, Analítica y Reportes, aún sin construir); este módulo solo persiste sus resultados y expone la consulta que necesitan otros módulos.

## Contexto Técnico

- **Stack**: Python 3.11, FastAPI, SQLAlchemy, Alembic, PostgreSQL (Art. 5.1/5.2).
- **Dependencias externas**: `producto` (`001-core-ventas-inventario`, solo lectura), `sucursal` (Expansión), `usuario` (Administración).
- **Consumidores**: `001-core-ventas-inventario` (pantalla de POS que dispara el registro de `demanda_insatisfecha`, vía llamada a este módulo, no vía tabla compartida), `008-compras-proveedores` (`RN-CP-001`, consulta el pronóstico antes de aceptar una compra por oferta), Analítica y Reportes (entrena el modelo leyendo `demanda_insatisfecha` como serie de tiempo y escribe sus resultados en `pronostico_demanda`).

## Constitution Check

| Artículo | Regla | Mecanismo |
|---|---|---|
| 5.9 | Ninguna cifra sin tamaño de muestra/periodo; sin datos, se declara explícitamente | `pronostico_demanda` con CHECK NOT NULL en `tamano_muestra`/`periodo_inicio`/`periodo_fin`; producto/sucursal sin fila responde `datos_suficientes: false` |
| 4 (propiedad de datos) | Cada módulo escribe solo sus propias tablas | `008-compras-proveedores` nunca escribe en `pronostico_demanda`; este módulo nunca escribe en `detalle_orden_compra` |
| 3.3 | Scoping por sucursal | El registro de `demanda_insatisfecha` respeta el token de sucursal del cajero |

## Estructura del Proyecto

```
backend/app/{models,schemas,services,routers}/pronostico_demanda.py
backend/alembic/versions/xxxx_pronostico_demanda.py
frontend/src/features/pronostico/DemandaInsatisfecha.tsx
tests/{test_pronostico_demanda_api.py,test_pronostico_demanda_negocio.py}
```

## Endpoints REST

| Método | Ruta | Descripción | Código |
|---|---|---|---|
| POST | `/api/v1/pronostico/demanda-insatisfecha` | Registrar evento (Cajero) | RF-PD-001, RF-PD-002 |
| GET | `/api/v1/pronostico/demanda-insatisfecha` | Consultar histórico por producto/sucursal/rango | RF-PD-003 |
| POST | `/api/v1/pronostico/ciclos` | Registrar ciclo de pronóstico calculado (Sistema) | RF-PD-004 |
| GET | `/api/v1/pronostico/{producto_id}` | Consultar pronóstico más reciente | RF-PD-005 |
| POST | `/api/v1/pronostico/eventos-locales` | Registrar evento local (feriado, clima, etc.) | RF-PD-007 *(enmienda v1.1)* |
| GET | `/api/v1/pronostico/eventos-locales` | Consultar eventos locales por rango/sucursal | RF-PD-008 *(enmienda v1.1)* |

*(Enmienda v1.1)* `POST /pronostico/demanda-insatisfecha` y su esquema `DemandaInsatisfechaCrear` ganan los campos opcionales `sustituto_ofrecido_id`/`sustituto_aceptado` — no es un endpoint nuevo, es el mismo endpoint de RF-PD-001/002 con dos campos adicionales (RF-PD-006).

## Modelo de Datos (resumen — ver `data-model.md`)

3 tablas: `demanda_insatisfecha`, `pronostico_demanda` (append-only), `evento_local` *(enmienda v1.1)*.

*(Enmienda v1.2)* Más 1 catálogo maestro: `tipo_evento_local` (clave natural), con `afecta_demanda_al_alza` — el signo esperado del efecto de cada tipo sobre la demanda pasa a ser un dato consultable en vez de algo que el modelo infiera (Decisión 5 de `research.md`). Se agrega el endpoint `GET /catalogos/tipos-evento-local`; el catálogo es de solo lectura desde la API.

## Fases

- **Fase 0**: `plan.md` + `research.md`.
- **Fase 1**: `data-model.md`, `contracts/pronostico-demanda.openapi.yaml`, `quickstart.md`.
- **Fase 2**: `tasks.md`.

## Riesgos y Decisiones Técnicas Pendientes

`POST /pronostico/ciclos` es un endpoint de recepción — la implementación real del modelo de pronóstico de demanda depende de la capa estratégica (Analítica y Reportes, pendiente). Cuando `008-compras-proveedores` se reconstruya bajo esta numeración, su stub `GET /compras/productos/{producto_id}/pronostico` debe reemplazarse por una llamada real a `GET /api/v1/pronostico/{producto_id}` de este módulo — queda documentado como tarea pendiente de esa reconstrucción, no de este módulo.

*(Enmienda v1.1)* `evento_local` es un catálogo editable, no append-only estricto (ver Decisión 4 de `research.md`) — a diferencia de `pronostico_demanda`, sí expone una eventual corrección de fecha mal digitada; queda documentado aquí para que la implementación no asuma por costumbre que toda tabla de este módulo es inmutable.
