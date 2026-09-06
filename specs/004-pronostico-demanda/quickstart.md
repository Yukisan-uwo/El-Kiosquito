# Guía de Arranque: Pronóstico de Demanda

**Feature**: `004-pronostico-demanda` | **Fecha**: 2026-09-04

## Requisitos previos

- Docker Compose con `postgres`/`api` levantados, migraciones de `usuario`, `sucursal` y `producto` (`001-core-ventas-inventario`) aplicadas

## Levantar el entorno

```bash
docker compose up -d postgres api
docker compose exec api alembic upgrade head
```

## Flujo de prueba manual

### 1. Registrar demanda insatisfecha (RF-PD-001, RF-PD-002)

```bash
curl -X POST http://localhost:8000/api/v1/pronostico/demanda-insatisfecha \
  -H "Authorization: Bearer $TOKEN_CAJERO" -H "Content-Type: application/json" \
  -d '{"producto_id": "<producto_id>", "sucursal_id": "<sucursal_id>", "hora_evento": "2026-09-04T15:20:00Z"}'
```

**Registro diferido:** repetir con `hora_evento` de varios minutos antes de la hora actual → se acepta igual (caso de uso de un cajero ocupado).

### 2. Consultar histórico de demanda insatisfecha (RF-PD-003)

```bash
curl "http://localhost:8000/api/v1/pronostico/demanda-insatisfecha?producto_id=<producto_id>&sucursal_id=<sucursal_id>&desde=2026-08-01&hasta=2026-09-04" \
  -H "Authorization: Bearer $TOKEN_PRONOSTICO"
```

### 3. Registrar un ciclo de pronóstico (RF-PD-004)

```bash
curl -X POST http://localhost:8000/api/v1/pronostico/ciclos \
  -H "Authorization: Bearer $TOKEN_SISTEMA" -H "Content-Type: application/json" \
  -d '{"producto_id": "<producto_id>", "sucursal_id": "<sucursal_id>", "cantidad_recomendada": 48, "tamano_muestra": 62, "periodo_inicio": "2026-06-01", "periodo_fin": "2026-08-31"}'
```

### 4. Consultar el pronóstico vigente (RF-PD-005, RN-PD-001)

```bash
curl "http://localhost:8000/api/v1/pronostico/<producto_id>?sucursal_id=<sucursal_id>" \
  -H "Authorization: Bearer $TOKEN_COMPRAS"
```

**Prueba negativa:** consultar el pronóstico de un producto/sucursal sin ningún ciclo registrado → responde `datos_suficientes: false`, nunca una cantidad recomendada inventada.

### 5. Registrar demanda insatisfecha con sustituto ofrecido (RF-PD-006, enmienda v1.1)

```bash
curl -X POST http://localhost:8000/api/v1/pronostico/demanda-insatisfecha \
  -H "Authorization: Bearer $TOKEN_CAJERO" -H "Content-Type: application/json" \
  -d '{
    "producto_id": "<producto_id>",
    "sucursal_id": "<sucursal_id>",
    "hora_evento": "2026-09-04T16:05:00Z",
    "sustituto_ofrecido_id": "<producto_sustituto_id>",
    "sustituto_aceptado": true
  }'
```

**Prueba negativa:** repetir con `sustituto_ofrecido_id` pero sin `sustituto_aceptado` → `422`.

### 6. Registrar y consultar eventos locales (RF-PD-007, RF-PD-008, enmienda v1.1)

```bash
curl -X POST http://localhost:8000/api/v1/pronostico/eventos-locales \
  -H "Authorization: Bearer $TOKEN_ENCARGADO" -H "Content-Type: application/json" \
  -d '{
    "sucursal_id": null,
    "fecha_inicio": "2026-12-24",
    "fecha_fin": "2026-12-25",
    "tipo": "feriado",
    "descripcion": "Navidad — aumento esperado de demanda de golosinas y bebidas"
  }'

curl "http://localhost:8000/api/v1/pronostico/eventos-locales?desde=2026-12-01&hasta=2026-12-31" \
  -H "Authorization: Bearer $TOKEN_SISTEMA"
```

Respuesta esperada: el evento de alcance de cadena (`sucursal_id: null`) aparece en la consulta sin importar qué `sucursal_id` se filtre, junto con cualquier evento propio de esa sucursal dentro del rango.

**Prueba negativa:** registrar un evento con `fecha_fin` anterior a `fecha_inicio` → `422`.

### 7. Consultar el catálogo de tipos de evento (RF-PD-009/010, enmienda v1.2)

```bash
curl "http://localhost:8000/api/v1/catalogos/tipos-evento-local" \
  -H "Authorization: Bearer $TOKEN_ANALITICA"
```

Respuesta esperada: los cinco tipos, con `feriado`, `fiesta_patronal` y `evento_comunitario` en `afecta_demanda_al_alza: true`, y `clima_extremo` y `corte_servicios` en `false`.

Ese campo es el que evita que el modelo tenga que **adivinar** si un corte de luz sube o baja las ventas. Con tres o cuatro ocurrencias al año de cada tipo, inferirlo de los datos sería ruido; el Art. 5.6 pide descontar confusores con información conocida, y esta lo es.

**Pruebas negativas:**

- Registrar un evento con `"tipo": "paro_nacional"` (no está en el catálogo) → `404` (RF-PD-009).
- Insertar ese tipo en el catálogo por SQL y repetir el registro → `201`, sin ningún `ALTER TABLE`:

```bash
docker compose exec postgres psql -U kiosquito -c \
  "INSERT INTO tipo_evento_local (codigo, etiqueta, afecta_demanda_al_alza, orden) VALUES ('paro_nacional','Paro nacional',false,6);"
```

## Siguiente paso

`008-compras-proveedores` reemplaza su stub `GET /compras/productos/{producto_id}/pronostico` por una llamada real a `GET /api/v1/pronostico/{producto_id}` de este módulo para resolver `RN-CP-001`.
