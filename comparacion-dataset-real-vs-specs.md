# Ingeniería Inversa: El Kiosquito vs. un POS real de producción

**Fecha**: 2026-09-04 | **Fase**: previa a diseño físico de base de datos (antes de la parte táctica/ETL)

## 1. Qué se comparó y por qué

En vez de un CSV suelto de Kaggle (la mayoría son una sola tabla plana de ventas, sin relaciones ni tablas maestras — poco útil para ingeniería inversa de un esquema relacional completo), se buscó y comparó contra **[opensourcepos](https://github.com/opensourcepos/opensourcepos)**: un sistema POS open-source real, en producción activa desde hace más de 15 años, usado por tiendas pequeñas, minimarkets y negocios de barrio — el caso de uso más parecido a "El Kiosquito" que se pudo encontrar con un esquema relacional completo y documentado (`app/Database/Migrations/sqlscripts/initial_schema.sql`, 27 tablas, más extensiones posteriores de atributos/impuestos).

Esto no es para copiar campos sin pensar — es exactamente lo que pediste: comparar campo por campo, ver qué nos falta, qué ya tenemos mejor resuelto, y qué del dataset NO nos conviene adoptar.

## 2. Comparación por dominio

### Productos e Inventario (`ospos_items`, `ospos_item_quantities`, `ospos_inventory`, `ospos_stock_locations` vs. `001-core-ventas-inventario`)

| Campo/tabla del POS real | ¿Lo tenemos? | Dónde | Nota |
|---|---|---|---|
| `name`, `category` (texto libre), `item_number`, `description` | ✅ | `producto.nombre/categoria` | Su `category` también es texto libre, no una tabla normalizada aparte — confirma que nuestra decisión de no crear una tabla `categoria` separada es razonable para este tamaño de negocio, no una omisión |
| `cost_price`, `unit_price` | ✅ | `historial_costo_producto` (008) / `historial_precio_producto` (003) | Nuestra versión es superior: la suya es un valor único mutable en `items`, la nuestra es histórica append-only auditable (Art. 5.9) |
| `reorder_level` (nivel de reorden) | ❌ | — | **Gap real.** No tenemos un umbral de stock mínimo por producto que dispare una alerta de reposición — solo `dias_sin_venta`/`marcado_sin_rotacion` (que detecta lo opuesto: exceso, no escasez) |
| `receiving_quantity` (cantidad estándar de reposición) | ❌ | — | Relacionado al gap anterior — cuánto pedir por defecto al reponer |
| Multi-sucursal (`stock_locations` + `item_quantities`) | ✅ | `sucursal` + `stock_sucursal` | Ya cubierto, incluso con más detalle (`dias_sin_venta`) |
| `is_serialized` / número de serie por unidad | ✅ (deliberadamente no adoptado) | — | Rastreo de número de serie por unidad — no aplica a productos de kiosko (golosinas, bebidas, abarrotes), lo dejamos fuera a propósito |
| Fecha de caducidad / lotes | ❌ en el POS real | `lote_producto` (001) | Aquí **nosotros superamos al dataset real** — un POS genérico no modela caducidad; nosotros sí, porque es un problema real del negocio (OT3.2) |
| Atributos flexibles tipo EAV (`attribute_definitions/values/links`) | ❌ (deliberadamente no adoptado) | — | Patrón genérico de atributos polimórficos — típico de un producto de software genérico que debe servir a cualquier rubro; para un kiosko con catálogo acotado, un esquema fijo es más simple y más fácil de defender ante el ingeniero que un EAV |
| `item_kits` / `item_kit_items` (combos de productos) | ❌ (candidato, no crítico) | — | Ej. "combo empanada + jugo" como paquete vendido a un precio. No deriva de ningún OT de la cascada de objetivos — candidato a descartar explícitamente, no a construir |

### Ventas (`ospos_sales`, `ospos_sales_items`, `ospos_sales_payments`, `ospos_sales_suspended*` vs. `venta`/`detalle_venta`)

| Campo/tabla del POS real | ¿Lo tenemos? | Dónde | Nota |
|---|---|---|---|
| `invoice_number` (número de factura/comprobante) | ❌ | — | **Gap real y relevante**: el `id` autoincremental no es lo mismo que un número de comprobante secuencial de venta — el criterio de evaluación exige "documentos de negocio reales", y una venta sin número de documento propio es más difícil de defender como tal |
| `sale_id`, `customer_id`, `employee_id`, `sale_time` | ✅ | `venta` | Cubierto, con más campos (IVA desglosado, estado_pago, motivo_anulación) |
| Múltiples pagos por venta (`sales_payments`, pago dividido efectivo+tarjeta) | ✅ (deliberadamente no adoptado) | `metodo_pago` (un solo método) | Ya lo habíamos descartado explícitamente en el checklist de `006-caja-mermas-fraude` — el POS real lo soporta, pero confirma que fue una decisión consciente, no un descuido |
| `sales_suspended*` (venta en espera/pausada) | ❌ (candidato) | — | Permite al cajero pausar una venta (cliente que va por su billetera) y retomarla después sin perder el carrito — funcionalidad real de POS, bajo costo de implementación (un estado más en `venta`) |
| Descuento por línea (`discount_percent` en item de venta) | ⚠️ parcial | `venta.descuento_aplicado` (a nivel de venta completa) | No tenemos descuento por línea individual, solo por venta total — probablemente suficiente para un kiosko, no es un gap crítico |
| Impuestos múltiples por línea (`sales_items_taxes`) | ✅ (deliberadamente simplificado) | `venta.iva` (15% fijo) | Ecuador tiene una tasa de IVA nacional única (Art. 4.1) — el esquema flexible del POS real existe para soportar múltiples jurisdicciones fiscales, que no aplica aquí |

### Compras y Proveedores (`ospos_receivings`, `ospos_receivings_items`, `ospos_suppliers` vs. `008-compras-proveedores`)

| Campo/tabla del POS real | ¿Lo tenemos? | Dónde | Nota |
|---|---|---|---|
| `payment_type` en la recepción (cómo se pagó la compra) | ❌ | — | **Gap real**: no registramos si una orden de compra se pagó de contado o a crédito con el proveedor — dato real de negocio (afecta flujo de caja, OT1.3) |
| `reference` (número de factura/guía del proveedor) | ❌ | — | **Gap real, mismo argumento que `invoice_number` de ventas**: sin este campo, `recepcion_orden_compra` no es trazable contra el documento físico real que entrega el proveedor |
| `supplier_id`, `company_name`, `account_number` | ✅ | `proveedor` | Cubierto (sin `account_number`, que es de bajo valor para este tamaño de negocio) |
| Historial de costo por proveedor | ✅ | `historial_costo_producto` | Ya cubierto, con más rigor (append-only auditable) |
| Pronóstico de demanda antes de comprar por oferta | ✅ (superior) | `detalle_orden_compra.pronostico_consultado` | El POS real no tiene nada equivalente — aquí superamos ampliamente al dataset real, es nuestro diferenciador de IA (OT1.5) |

### Clientes, RBAC y Sucursales

| Campo/tabla del POS real | ¿Lo tenemos? | Dónde | Nota |
|---|---|---|---|
| `customers`, `discount_percent` fijo por cliente | ✅ (superior) | `cliente` + `cupon` personalizado (005) | El descuento fijo por cliente del POS real es más simple que nuestra fidelización basada en comportamiento/churn (OT1.4/OT2.5) — no es un gap, vamos más avanzados |
| `giftcards` | ❌ (deliberadamente no adoptado) | — | Sin ningún OT que lo respalde en la cascada de objetivos — correcto dejarlo fuera |
| Permisos por persona (`permissions` + `grants`, per-usuario) | ✅ (diseño distinto, deliberado) | `permiso_rol` (por rol, no por persona) | El POS real da permisos a cada empleado individualmente; nosotros los definimos por rol (Art. 3.1) — más simple de auditar y consistente con la jerarquía de 4 roles de la constitución |
| Multi-sucursal / `stock_locations` | ✅ (superior) | `sucursal` (009) con checklist de apertura, herencia de catálogo | El POS real solo modela "ubicaciones de stock" sueltas; nosotros tenemos todo un ciclo de vida de apertura de sucursal — vamos más allá |
| Cuadre de caja por turno / detección de fraude | ❌ en el POS real | `turno_caja`, `punto_control_horario_turno` (006) | El POS real no tiene nada parecido — otro diferenciador nuestro claro |

## 3. Gaps reales identificados (candidatos a decisión, no ejecutados todavía)

1. **`venta.numero_documento`** — número de comprobante de venta secuencial, distinto del `id` interno. Justificación fuerte: el criterio de evaluación exige documentos de negocio reales, no solo columnas sueltas.
2. **`stock_sucursal.stock_minimo`** — umbral de reorden por producto/sucursal, para poder generar una alerta real de "stock bajo" (útil también como *informe simple* candidato para el paso 1 pendiente).
3. **`orden_compra.forma_pago`** (contado/crédito) y **`recepcion_orden_compra.numero_documento_proveedor`** — trazabilidad real de cómo se pagó cada compra y contra qué factura del proveedor.
4. **`venta.estado_venta` con un valor `en_espera`** — permitir pausar una venta y retomarla (candidato de menor prioridad, funcionalidad real de cajero pero no deriva de ningún OT explícito).

## 4. Candidatos del dataset real que se recomienda NO adoptar

- **Combos/kits de productos** (`item_kits`) — no deriva de ningún OT, agregaría complejidad sin respaldo en la cascada de objetivos.
- **Atributos flexibles tipo EAV** — patrón de software genérico, no aporta a un catálogo de kiosko acotado, y complica la explicación ante el ingeniero.
- **Tarjetas de regalo** — sin ningún objetivo que lo respalde.
- **Impuestos múltiples por línea de venta** — Ecuador tiene una tasa de IVA nacional única, el campo flexible del POS real resuelve un problema que no tenemos.
- **Número de serie por unidad vendida** — no aplica a los productos típicos de un kiosko.

## 5. Siguiente paso

Con esto ya tenemos el insumo de comparación pedido. Falta decidir, gap por gap del punto 3, si se agregan (y a qué módulo/enmienda) o se documentan explícitamente fuera de alcance — y luego seguir con la tabla Departamento | Objetivo Táctico | ¿Informe simple? | ¿Informe compuesto? que pediste, que es la que nos va a decir qué tablas maestras/dimensión (tiempo, categoría, etc.) hacen falta para la BD columnar.
