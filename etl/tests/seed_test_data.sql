-- Datos de prueba para ejercitar el ETL de la capa táctica.
-- Cubre los 9 hechos y las 10 dimensiones copiadas desde PostgreSQL,
-- con filas en dos meses distintos (2026-08 y 2026-09) para poder
-- probar partición mensual e idempotencia al reprocesar.
-- Password hash reutilizado del resto del proyecto: Test1234!
BEGIN;

-- --- usuarios -----------------------------------------------------------
INSERT INTO usuario (id, nombre, email, password_hash, rol, activo) VALUES
    (901, 'Dueno ETL', 'test.dueno.etl@elkiosquito.test', '$2b$12$CUNoaa4ebFu3URrKyhFcDeBYRjA3/axY87V.w4ZiGVad/TKaFIQA2', 'dueno', true),
    (902, 'Cajero Uno ETL', 'test.cajero1.etl@elkiosquito.test', '$2b$12$CUNoaa4ebFu3URrKyhFcDeBYRjA3/axY87V.w4ZiGVad/TKaFIQA2', 'cajero', true),
    (903, 'Cajero Dos ETL', 'test.cajero2.etl@elkiosquito.test', '$2b$12$CUNoaa4ebFu3URrKyhFcDeBYRjA3/axY87V.w4ZiGVad/TKaFIQA2', 'cajero', true),
    (904, 'Encargado Sucursal ETL', 'test.sucursal.etl@elkiosquito.test', '$2b$12$CUNoaa4ebFu3URrKyhFcDeBYRjA3/axY87V.w4ZiGVad/TKaFIQA2', 'encargado_sucursal', true),
    (905, 'Encargado Compras ETL', 'test.compras.etl@elkiosquito.test', '$2b$12$CUNoaa4ebFu3URrKyhFcDeBYRjA3/axY87V.w4ZiGVad/TKaFIQA2', 'encargado_compras', true)
ON CONFLICT (id) DO NOTHING;
SELECT setval('usuario_id_seq', GREATEST((SELECT max(id) FROM usuario), (SELECT last_value FROM usuario_id_seq)));

-- --- sucursales -----------------------------------------------------------
INSERT INTO sucursal (id, nombre, direccion, responsable_id, estado, fecha_activacion) VALUES
    (901, 'Sucursal Centro ETL', 'Av. Siete de Octubre 123', 904, 'operativa', '2026-01-15 08:00:00'),
    (902, 'Sucursal Norte ETL', 'Km 2.5 vía Quevedo', 904, 'operativa', '2026-03-01 08:00:00')
ON CONFLICT (id) DO NOTHING;
SELECT setval('sucursal_id_seq', GREATEST((SELECT max(id) FROM sucursal), (SELECT last_value FROM sucursal_id_seq)));

-- --- categorías (una con padre, para dim_categoria.categoria_padre) -------
INSERT INTO categoria (id, nombre, categoria_padre_id, es_perecedero) VALUES
    (901, 'Bebidas ETL', NULL, false),
    (902, 'Gaseosas ETL', 901, false),
    (903, 'Lácteos ETL', NULL, true)
ON CONFLICT (id) DO NOTHING;
SELECT setval('categoria_id_seq', GREATEST((SELECT max(id) FROM categoria), (SELECT last_value FROM categoria_id_seq)));

-- --- productos (uno fraccionable, uno perecedero) -------------------------
INSERT INTO producto (id, nombre, categoria_id, unidad_venta_codigo, unidad_inventario_codigo, es_fraccionable, factor_conversion, es_perecedero) VALUES
    (901, 'Gaseosa Cola 500ml ETL', 902, 'unidad', 'unidad', false, NULL, false),
    (902, 'Queso Fresco ETL', 903, 'libra', 'libra', true, 1, true)
ON CONFLICT (id) DO NOTHING;
SELECT setval('producto_id_seq', GREATEST((SELECT max(id) FROM producto), (SELECT last_value FROM producto_id_seq)));

-- --- clasificación comercial con historial SCD2 (producto 901) -----------
-- producto 902 también necesita su fila (aunque sea de una sola versión,
-- sin transición): cargar_dim_producto hace INNER JOIN contra esta tabla
-- (todo producto vendible debe tener clasificación vigente desde su alta),
-- así que un producto sin fila acá queda fuera de dim_producto aunque
-- tenga ventas reales en fact_venta_linea — bug real encontrado al validar
-- "dimensiones_referenciadas" (productos huérfanos) contra datos sembrados.
INSERT INTO producto_clasificacion_historial (id, producto_id, clasificacion, fecha_desde, fecha_hasta, motivo_cambio, usuario_id) VALUES
    (901, 901, 'nicho', '2026-06-01 00:00:00', '2026-08-01 00:00:00', 'Clasificación inicial de catálogo ETL', 901),
    (902, 901, 'gancho', '2026-08-01 00:00:00', NULL, 'Bajó de margen tras promoción de agosto ETL', 901),
    (903, 902, 'gancho', '2026-06-01 00:00:00', NULL, 'Clasificación inicial de catálogo ETL', 901)
ON CONFLICT (id) DO NOTHING;
SELECT setval('producto_clasificacion_historial_id_seq', GREATEST((SELECT max(id) FROM producto_clasificacion_historial), (SELECT last_value FROM producto_clasificacion_historial_id_seq)));
INSERT INTO clasificacion_producto (producto_id, clasificacion, actualizado_por) VALUES
    (901, 'gancho', 901),
    (902, 'gancho', 901)
ON CONFLICT (producto_id) DO NOTHING;

-- --- proveedor + orden de compra + recepción + historial de costo --------
INSERT INTO proveedor (id, nombre, activo) VALUES (901, 'Distribuidora ETL', true)
ON CONFLICT (id) DO NOTHING;
SELECT setval('proveedor_id_seq', GREATEST((SELECT max(id) FROM proveedor), (SELECT last_value FROM proveedor_id_seq)));

INSERT INTO orden_compra (id, proveedor_id, sucursal_id, creado_por, fecha_pedido, es_oferta, forma_pago, estado) VALUES
    (901, 901, 901, 905, '2026-08-03 09:00:00', false, 'contado', 'recibida_completa')
ON CONFLICT (id) DO NOTHING;
SELECT setval('orden_compra_id_seq', GREATEST((SELECT max(id) FROM orden_compra), (SELECT last_value FROM orden_compra_id_seq)));

INSERT INTO detalle_orden_compra (id, orden_compra_id, producto_id, cantidad_pedida, precio_ofrecido, pronostico_consultado) VALUES
    (901, 901, 901, 100, 0.35, false),
    (902, 901, 902, 40, 2.10, false)
ON CONFLICT (id) DO NOTHING;
SELECT setval('detalle_orden_compra_id_seq', GREATEST((SELECT max(id) FROM detalle_orden_compra), (SELECT last_value FROM detalle_orden_compra_id_seq)));

INSERT INTO recepcion_orden_compra (id, detalle_orden_compra_id, cantidad_recibida_evento, numero_documento_proveedor, fecha_recepcion, usuario_id) VALUES
    (901, 901, 100, 'FAC-ETL-001', '2026-08-05 10:00:00', 905),
    (902, 902, 40, 'FAC-ETL-001', '2026-08-05 10:00:00', 905)
ON CONFLICT (id) DO NOTHING;
SELECT setval('recepcion_orden_compra_id_seq', GREATEST((SELECT max(id) FROM recepcion_orden_compra), (SELECT last_value FROM recepcion_orden_compra_id_seq)));

INSERT INTO historial_costo_producto (id, producto_id, proveedor_id, costo, orden_compra_id, fecha) VALUES
    (901, 901, 901, 0.35, 901, '2026-08-05 10:00:00'),
    (902, 902, 901, 2.10, 901, '2026-08-05 10:00:00')
ON CONFLICT (id) DO NOTHING;
SELECT setval('historial_costo_producto_id_seq', GREATEST((SELECT max(id) FROM historial_costo_producto), (SELECT last_value FROM historial_costo_producto_id_seq)));

-- Precio de venta manual vigente (para fact_venta_linea.precio_unitario y
-- fact_precio_competencia.precio_propio) — 003-precios-margenes.
INSERT INTO historial_precio_producto (id, producto_id, sucursal_id, precio_venta, fuente, vigente_desde, registrado_por) VALUES
    (901, 901, 901, 0.75, 'manual', '2026-07-01 00:00:00', 901),
    (902, 902, 901, 4.50, 'manual', '2026-07-01 00:00:00', 901)
ON CONFLICT (id) DO NOTHING;
SELECT setval('historial_precio_producto_id_seq', GREATEST((SELECT max(id) FROM historial_precio_producto), (SELECT last_value FROM historial_precio_producto_id_seq)));

-- --- clientes + segmentación con historial SCD2 (cliente 901) -------------
-- creado_en se fija explícitamente y ANTES del fecha_calculo más antiguo de
-- segmento_cliente (2026-08-01): dejarlo en el default now() rompe
-- antiguedad_meses en dim_cliente (edad negativa -> overflow de UInt16 en
-- ClickHouse) cuando el seed se corre el mismo día que se procesa el rango.
INSERT INTO cliente (id, nombre, contacto, creado_en) VALUES
    (901, 'Cliente Frecuente ETL', '0990000001', '2025-01-15 00:00:00'),
    (902, 'Cliente Ocasional ETL', '0990000002', '2025-06-01 00:00:00')
ON CONFLICT (id) DO NOTHING;
SELECT setval('cliente_id_seq', GREATEST((SELECT max(id) FROM cliente), (SELECT last_value FROM cliente_id_seq)));

INSERT INTO version_modelo_ml (id, modelo, version, estado, tamano_muestra, periodo_inicio, periodo_fin, nombre_metrica, valor_metrica, fecha_entrenamiento) VALUES
    (901, 'churn', '2026.08-etl', 'activo', 120, '2026-05-01', '2026-07-31', 'F1', 0.81, '2026-08-01 00:00:00')
ON CONFLICT (id) DO NOTHING;
SELECT setval('version_modelo_ml_id_seq', GREATEST((SELECT max(id) FROM version_modelo_ml), (SELECT last_value FROM version_modelo_ml_id_seq)));

INSERT INTO segmento_cliente (id, cliente_id, segmento_codigo, frecuencia_snapshot, margen_snapshot, recencia_dias_snapshot, tamano_muestra, periodo_inicio, periodo_fin, version_modelo_id, fecha_calculo, vigente_hasta) VALUES
    (901, 901, 'ocasional', 2.0, 8.50, 40, 120, '2026-05-01', '2026-07-31', 901, '2026-08-01 00:00:00', '2026-08-15 00:00:00'),
    (902, 901, 'leal_alto_margen', 5.0, 18.20, 5, 120, '2026-05-01', '2026-08-15', 901, '2026-08-15 00:00:00', NULL)
ON CONFLICT (id) DO NOTHING;
SELECT setval('segmento_cliente_id_seq', GREATEST((SELECT max(id) FROM segmento_cliente), (SELECT last_value FROM segmento_cliente_id_seq)));

-- --- competencia -----------------------------------------------------------
INSERT INTO fuente_competencia (id, nombre, canal_codigo, activo) VALUES
    (901, 'Tienda La Esquina ETL', 'tienda_fisica', true)
ON CONFLICT (id) DO NOTHING;
SELECT setval('fuente_competencia_id_seq', GREATEST((SELECT max(id) FROM fuente_competencia), (SELECT last_value FROM fuente_competencia_id_seq)));

INSERT INTO precio_competencia (id, producto_id, fuente_competencia_id, precio_referencia, fecha_registro, registrado_por) VALUES
    (901, 901, 901, 0.80, '2026-08-10 12:00:00', 905),
    (902, 901, 901, 0.70, '2026-09-02 12:00:00', 905)
ON CONFLICT (id) DO NOTHING;
SELECT setval('precio_competencia_id_seq', GREATEST((SELECT max(id) FROM precio_competencia), (SELECT last_value FROM precio_competencia_id_seq)));

-- --- evento local (feriado, para dim_tiempo.es_feriado) --------------------
INSERT INTO evento_local (id, sucursal_id, fecha_inicio, fecha_fin, tipo, descripcion, registrado_por) VALUES
    (901, NULL, '2026-08-10', '2026-08-10', 'feriado', 'Feriado nacional de prueba ETL', 901)
ON CONFLICT (id) DO NOTHING;
SELECT setval('evento_local_id_seq', GREATEST((SELECT max(id) FROM evento_local), (SELECT last_value FROM evento_local_id_seq)));

-- --- turnos de caja + checkpoints ------------------------------------------
INSERT INTO turno_caja (id, sucursal_id, cajero_id, hora_apertura, monto_inicial, hora_cierre, monto_contado, monto_esperado, motivo_diferencia, estado) VALUES
    (901, 901, 902, '2026-08-10 08:00:00', 20.00, '2026-08-10 16:00:00', 45.30, 45.00, 'Vuelto de más entregado por error ETL', 'cerrado'),
    (902, 901, 902, '2026-09-01 08:00:00', 20.00, '2026-09-01 16:00:00', 32.00, 32.00, NULL, 'cerrado')
ON CONFLICT (id) DO NOTHING;
SELECT setval('turno_caja_id_seq', GREATEST((SELECT max(id) FROM turno_caja), (SELECT last_value FROM turno_caja_id_seq)));

INSERT INTO punto_control_horario_turno (id, turno_caja_id, hora_checkpoint, monto_esperado_acumulado) VALUES
    (901, 901, '2026-08-10 12:00:00', 32.50)
ON CONFLICT (id) DO NOTHING;
SELECT setval('punto_control_horario_turno_id_seq', GREATEST((SELECT max(id) FROM punto_control_horario_turno), (SELECT last_value FROM punto_control_horario_turno_id_seq)));

-- --- ventas (agosto: 3 completadas + 1 anulada; septiembre: 2) -----------
INSERT INTO venta (id, sucursal_id, turno_caja_id, cajero_id, cliente_id, hora_inicio_cobro, fecha_hora, subtotal, descuento_aplicado, iva, total, metodo_pago, estado_pago, estado_venta, motivo_anulacion, anulada_en) VALUES
    (901, 901, 901, 902, 901, '2026-08-10 09:00:00', '2026-08-10 09:00:30', 1.50, 0, 0.18, 1.68, 'efectivo', 'aprobado', 'completada', NULL, NULL),
    (902, 901, 901, 902, NULL, '2026-08-10 10:30:00', '2026-08-10 10:30:20', 4.50, 0, 0.54, 5.04, 'tarjeta', 'aprobado', 'completada', NULL, NULL),
    (903, 901, 901, 902, 902, '2026-08-10 14:00:00', '2026-08-10 14:00:15', 0.75, 0, 0.09, 0.84, 'efectivo', 'aprobado', 'anulada', 'Cliente se arrepintió ETL', '2026-08-10 14:05:00'),
    (904, 901, 902, 902, 901, '2026-09-01 09:15:00', '2026-09-01 09:15:25', 2.25, 0, 0.27, 2.52, 'electronico', 'aprobado', 'completada', NULL, NULL),
    (905, 901, 902, 902, NULL, '2026-09-01 11:00:00', '2026-09-01 11:00:10', 0.75, 0, 0.09, 0.84, 'efectivo', 'aprobado', 'completada', NULL, NULL)
ON CONFLICT (id) DO NOTHING;
SELECT setval('venta_id_seq', GREATEST((SELECT max(id) FROM venta), (SELECT last_value FROM venta_id_seq)));

INSERT INTO detalle_venta (id, venta_id, producto_id, cantidad_venta, unidad_venta_codigo, cantidad_inventario, precio_unitario_aplicado, subtotal_item) VALUES
    (901, 901, 901, 2, 'unidad', 2, 0.75, 1.50),
    (902, 902, 902, 1, 'libra', 1, 4.50, 4.50),
    (903, 903, 901, 1, 'unidad', 1, 0.75, 0.75),
    (904, 904, 901, 3, 'unidad', 3, 0.75, 2.25),
    (905, 905, 901, 1, 'unidad', 1, 0.75, 0.75)
ON CONFLICT (id) DO NOTHING;
SELECT setval('detalle_venta_id_seq', GREATEST((SELECT max(id) FROM detalle_venta), (SELECT last_value FROM detalle_venta_id_seq)));

-- --- mermas (una atribuible, una no) ---------------------------------------
INSERT INTO merma (id, producto_id, sucursal_id, cantidad, valor_estimado, causa, resultado_investigacion, fecha_deteccion, fecha_resultado, registrado_por, investigado_por) VALUES
    (901, 902, 901, 1.5, 6.75, 'caducidad', NULL, '2026-08-12 08:00:00', NULL, 904, NULL),
    (902, 901, 901, 5, 3.75, 'error_humano', 'confirmada', '2026-09-02 08:00:00', '2026-09-02 10:00:00', 902, 904)
ON CONFLICT (id) DO NOTHING;
SELECT setval('merma_id_seq', GREATEST((SELECT max(id) FROM merma), (SELECT last_value FROM merma_id_seq)));

-- --- cupones (uno canjeado contra la venta 901, uno activo) ---------------
INSERT INTO cupon (id, cliente_id, tipo_origen, codigo, descuento_tipo, descuento_valor, fecha_envio, fecha_expiracion, estado, venta_id_canje, fecha_canje) VALUES
    (901, 901, 'patron_compra', 'CUP-ETL-0001', 'porcentaje', 10.00, '2026-08-05 00:00:00', '2026-08-31 23:59:59', 'canjeado', 901, '2026-08-10 09:00:30'),
    (902, 902, 'cumpleanos', 'CUP-ETL-0002', 'monto_fijo', 1.00, '2026-08-20 00:00:00', '2026-09-30 23:59:59', 'activo', NULL, NULL)
ON CONFLICT (id) DO NOTHING;
SELECT setval('cupon_id_seq', GREATEST((SELECT max(id) FROM cupon), (SELECT last_value FROM cupon_id_seq)));

-- --- demanda insatisfecha ---------------------------------------------------
INSERT INTO demanda_insatisfecha (id, sucursal_id, producto_id, cajero_id, hora_evento, sustituto_ofrecido_id, sustituto_aceptado) VALUES
    (901, 901, 902, 902, '2026-08-15 17:00:00', 901, false),
    (902, 901, 901, 902, '2026-09-02 18:00:00', NULL, NULL)
ON CONFLICT (id) DO NOTHING;
SELECT setval('demanda_insatisfecha_id_seq', GREATEST((SELECT max(id) FROM demanda_insatisfecha), (SELECT last_value FROM demanda_insatisfecha_id_seq)));

-- --- stock y ajustes (para el snapshot fact_stock_diario) ------------------
INSERT INTO stock_sucursal (id, producto_id, sucursal_id, cantidad_disponible, dias_sin_venta, marcado_sin_rotacion, stock_minimo) VALUES
    (901, 901, 901, 250, 0, false, 50),
    (902, 902, 901, 12, 3, false, 10)
ON CONFLICT (id) DO NOTHING;
SELECT setval('stock_sucursal_id_seq', GREATEST((SELECT max(id) FROM stock_sucursal), (SELECT last_value FROM stock_sucursal_id_seq)));

INSERT INTO lote_producto (id, producto_id, sucursal_id, fecha_caducidad, cantidad_lote, cantidad_restante, fecha_ingreso) VALUES
    (901, 902, 901, CURRENT_DATE + 3, 20, 12, '2026-08-05 10:00:00')
ON CONFLICT (id) DO NOTHING;
SELECT setval('lote_producto_id_seq', GREATEST((SELECT max(id) FROM lote_producto), (SELECT last_value FROM lote_producto_id_seq)));

-- --- auditoría (una fila sin usuario_id: intento de login fallido) --------
INSERT INTO log_auditoria (id, usuario_id, accion, recurso, recurso_id, sucursal_id, exitoso, ip_origen, creado_en) VALUES
    (901, 902, 'crear_venta', 'venta', 901, 901, true, '10.0.0.5', '2026-08-10 09:00:30'),
    (902, NULL, 'login', 'usuario', NULL, NULL, false, '10.0.0.9', '2026-09-01 07:55:00')
ON CONFLICT (id) DO NOTHING;
SELECT setval('log_auditoria_id_seq', GREATEST((SELECT max(id) FROM log_auditoria), (SELECT last_value FROM log_auditoria_id_seq)));

COMMIT;
