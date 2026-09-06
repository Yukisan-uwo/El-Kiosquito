# Plan Técnico: Promociones Inteligentes

**Feature**: `005-promociones-inteligentes` | **Fecha**: 2026-09-04
**Entrada**: `spec.md`

## Resumen Técnico

Módulo dueño de `cupon` y de todo su ciclo de vida (envío, canje, expiración). No decide cuándo corresponde generar un cupón — esa decisión vive en quien llama al endpoint de creación (un batch de cumpleaños, el motor de patrón de compra, o `002-clientes-fidelizacion` al registrar una campaña de recuperación).

## Contexto Técnico

- **Stack**: Python 3.11, FastAPI, SQLAlchemy, Alembic, PostgreSQL (Art. 5.1/5.2).
- **Dependencias externas**: `cliente`, `evaluacion_churn` (`002-clientes-fidelizacion`, solo lectura), `venta` (`001-core-ventas-inventario`, solo lectura al validar el canje).
- **Consumidores**: `002-clientes-fidelizacion` (`campana_recuperacion.cupon_id` referencia esta tabla); el punto de venta de `001-core-ventas-inventario` consulta este módulo al aplicar un cupón en una venta.

## Constitution Check

| Artículo | Regla | Mecanismo |
|---|---|---|
| 4 (propiedad de datos) | Cada módulo escribe solo sus propias tablas | `cupon` nunca modifica `cliente`, `evaluacion_churn` ni `venta` — solo los referencia por FK |
| 10.5 | Auditoría inmutable de operaciones críticas | Envío y canje de cupones generan entrada en el log de auditoría de Administración |

## Estructura del Proyecto

```
backend/app/{models,schemas,services,routers}/promociones_inteligentes.py
backend/alembic/versions/xxxx_promociones_inteligentes.py
frontend/src/features/promociones/{Cupones.tsx, CanjeCupon.tsx}
tests/{test_promociones_api.py,test_promociones_negocio.py}
```

## Endpoints REST

| Método | Ruta | Descripción | Código |
|---|---|---|---|
| POST | `/api/v1/promociones/cupones` | Registrar el envío de un cupón | RF-PI-001 |
| PATCH | `/api/v1/promociones/cupones/{id}/canjear` | Registrar el canje de un cupón en una venta | RF-PI-002, RN-PI-001 |
| GET | `/api/v1/clientes/{cliente_id}/cupones` | Consultar cupones (activos e históricos) de un cliente | RF-PI-003 |

## Modelo de Datos (resumen — ver `data-model.md`)

1 tabla: `cupon`, con FK externas hacia `cliente`/`evaluacion_churn` (`002-clientes-fidelizacion`) y `venta` (`001-core-ventas-inventario`).

*(Enmienda v1.1)* Más 3 catálogos maestros de clave natural: `tipo_origen_cupon` (con `es_automatico` y `requiere_evaluacion_churn`), `tipo_descuento` (con `valor_maximo_permitido`) y `estado_cupon` (con `permite_canje`). Los tres campos correspondientes de `cupon` pasan de CHECK a FK, y los enums desaparecen del contrato OpenAPI. Se agregan tres endpoints `GET /catalogos/...`; los catálogos son de solo lectura desde la API.

La enmienda cierra además un agujero real: `descuento_valor` solo validaba `>= 0`, así que un cupón de 200% de descuento era creable sin error. `tipo_descuento.valor_maximo_permitido` lo impide (RN-PI-004).

## Fases

- **Fase 0**: `plan.md` + `research.md`.
- **Fase 1**: `data-model.md`, `contracts/promociones-inteligentes.openapi.yaml`, `quickstart.md`.
- **Fase 2**: `tasks.md`.

## Riesgos y Decisiones Técnicas Pendientes

El disparador de `tipo_origen = 'patron_compra'` depende de un motor de reglas que hoy no tiene tabla propia (Decisión 3 de `research.md`) — mientras ese motor no exista formalmente en Analítica y Reportes, se documenta como responsabilidad de quien llame al endpoint `POST /promociones/cupones`, sin bloquear este módulo.
