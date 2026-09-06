# Guía de Arranque: Fidelización y Clientes

**Feature**: `005-fidelizacion-clientes` | **Fecha**: 2026-09-04

## Requisitos previos

- Docker Compose funcionando con `postgres` y `api` (ver `docker-compose.yml` en la raíz de `Proyecto El Kiosquito/`)
- Migraciones de `usuario` y `parametro_sistema` ya aplicadas
- Al menos un cliente con algunas ventas ya registradas en `001-ventas-y-caja` (`venta.cliente_id`), para poder probar el historial de compras y las evaluaciones

## Levantar el entorno

```bash
cd "Proyecto El Kiosquito"
docker compose up -d postgres api
docker compose exec api alembic upgrade head
```

## Flujo de prueba manual (cubre los escenarios de aceptación de `spec.md`)

### 1. Registrar un cliente (RF-FC-001)

```bash
curl -X POST http://localhost:8000/api/v1/clientes \
  -H "Authorization: Bearer $TOKEN_FIDELIZACION" \
  -H "Content-Type: application/json" \
  -d '{"nombre": "María Cevallos", "contacto": "0987654321", "fecha_nacimiento": "1990-09-10"}'
```

### 2. Consultar el historial de compras (RF-FC-002)

```bash
curl "http://localhost:8000/api/v1/clientes/<cliente_id>/historial-compras" \
  -H "Authorization: Bearer $TOKEN_FIDELIZACION"
```

Respuesta esperada: `200`, con las ventas de `001-ventas-y-caja` filtradas por `cliente_id`.

### 3. Registrar un ciclo de segmentación (RF-FC-003)

```bash
curl -X POST http://localhost:8000/api/v1/fidelizacion/segmentos \
  -H "Authorization: Bearer $TOKEN_SISTEMA" \
  -H "Content-Type: application/json" \
  -d '{
    "cliente_id": "<cliente_id>",
    "segmento": "frecuente",
    "frecuencia_snapshot": 4.2,
    "margen_snapshot": 12.50,
    "recencia_dias_snapshot": 3,
    "tamano_muestra": 87,
    "periodo_inicio": "2026-06-01",
    "periodo_fin": "2026-08-31"
  }'

curl "http://localhost:8000/api/v1/clientes/<cliente_id>/segmento" \
  -H "Authorization: Bearer $TOKEN_FIDELIZACION"
```

**Prueba negativa:** consultar el segmento de un `cliente_id` que nunca tuvo un ciclo registrado → debe declarar explícitamente que no hay datos suficientes, no un `404` genérico ni un segmento por defecto.

### 4. Enviar y canjear un cupón (RF-FC-004, RF-FC-005, RN-FC-001)

```bash
curl -X POST http://localhost:8000/api/v1/fidelizacion/cupones \
  -H "Authorization: Bearer $TOKEN_FIDELIZACION" \
  -H "Content-Type: application/json" \
  -d '{
    "cliente_id": "<cliente_id>",
    "tipo_origen": "cumpleanos",
    "descuento_tipo": "porcentaje",
    "descuento_valor": 10,
    "fecha_expiracion": "2026-09-30T23:59:59Z"
  }'

curl -X PATCH http://localhost:8000/api/v1/fidelizacion/cupones/<cupon_id>/canjear \
  -H "Authorization: Bearer $TOKEN_CAJERO" \
  -H "Content-Type: application/json" \
  -d '{"venta_id": "<venta_id>"}'
```

**Prueba negativa:** repetir el canje del mismo `cupon_id` → debe responder `422` (RN-FC-001).

### 5. Evaluación de churn y campaña de recuperación (RF-FC-006, RF-FC-007, RN-FC-002)

```bash
curl -X POST http://localhost:8000/api/v1/fidelizacion/evaluaciones-churn \
  -H "Authorization: Bearer $TOKEN_SISTEMA" \
  -H "Content-Type: application/json" \
  -d '{
    "cliente_id": "<cliente_id>",
    "es_riesgo_real": true,
    "dias_sin_compra_al_momento": 52,
    "frecuencia_historica_dias": 20,
    "justificacion": "52 días sin comprar frente a un ciclo histórico propio de 20 días, fuera de rango normal",
    "tamano_muestra": 87
  }'

curl -X POST http://localhost:8000/api/v1/fidelizacion/campanas-recuperacion \
  -H "Authorization: Bearer $TOKEN_FIDELIZACION" \
  -H "Content-Type: application/json" \
  -d '{"cliente_id": "<cliente_id>", "evaluacion_churn_id": "<evaluacion_id>"}'
```

**Prueba negativa:** si entre la evaluación y el intento de envío el cliente ya registró una venta nueva, este `curl` debe responder `409` (RN-FC-002).

### 6. Consultar si el cliente recuperó actividad (RF-FC-008)

```bash
curl "http://localhost:8000/api/v1/fidelizacion/campanas-recuperacion/<campana_id>/resultado" \
  -H "Authorization: Bearer $TOKEN_FIDELIZACION"
```

## Siguiente paso

Con este flujo pasando, Analítica y Reportes (módulo `009-analitica-reportes`, pendiente) puede reemplazar los `curl` manuales de segmentación y churn por las llamadas reales que hagan los procesos batch de K-Means y del modelo de churn.
