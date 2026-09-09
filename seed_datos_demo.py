"""
Seed de datos de demostración para El Kiosquito — volumen real para poder
visualizar reportes, encontrar errores de UI/lógica, y tener suficiente
historia para que los 5 modelos de ML (Art. 5.6) tengan algo que entrenar
(cada uno pide tamano_muestra_minimo=30 en el catálogo modelo_ml).

Cubre: 3 sucursales operativas, ~70 productos en las 8 categorías reales,
10 proveedores, ~10 usuarios operativos (además de los 4 de
seed_usuarios_prueba.py), ~180 clientes, stock y lotes por sucursal,
historial de precios, ~90 días de turnos de caja + ventas + detalle,
órdenes de compra con recepciones e historial de costo, mermas,
clasificación comercial de productos, versiones "activas" de los 5
modelos con una asignación de segmento por cliente, evaluaciones de
churn, recomendaciones de precio, pronóstico de demanda, demanda
insatisfecha y alertas de fraude/incidencias de cuadre.

Idempotente a nivel de corrida completa: si ya existen sucursales con los
nombres de este seed, el script se detiene sin duplicar nada (correlo una
sola vez sobre una base vacía; para repetir, primero hay que limpiar).

Uso (desde la carpeta del proyecto, con el stack levantado):
  Get-Content seed_datos_demo.py | docker compose exec -T backend python -
"""
import random
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select, func

from app.database import SessionLocal
import app.models  # noqa: F401 — registra todas las tablas en Base.metadata
from app.core.security import hash_password

from app.models.administracion import Usuario
from app.models.expansion import Sucursal
from app.models.core_ventas import (
    Categoria, Producto, StockSucursal, LoteProducto, Venta, DetalleVenta,
)
from app.models.clientes import Cliente, Segmento, SegmentoCliente, EvaluacionChurn
from app.models.compras import (
    Proveedor, OrdenCompra, DetalleOrdenCompra, RecepcionOrdenCompra, HistorialCostoProducto,
)
from app.models.caja import TurnoCaja, Merma
from app.models.precios import (
    HistorialPrecioProducto, ClasificacionProducto, ProductoClasificacionHistorial, RecomendacionPrecio,
)
from app.models.pronostico import DemandaInsatisfecha, PronosticoDemanda
from app.models.analitica import VersionModeloMl
from app.models.caja import AlertaFraudePago, IncidenciaCuadreCaja

random.seed(42)  # reproducible — mismo dataset si hay que repetir en otra máquina
AHORA = datetime.now(timezone.utc)
HOY = AHORA.date()

db = SessionLocal()

# ---------------------------------------------------------------------------
# Guard de idempotencia
# ---------------------------------------------------------------------------
if db.query(Sucursal).filter(Sucursal.nombre.like("El Kiosquito%")).first():
    print("Ya existen sucursales de este seed — no se repite. Si querés regenerar, limpiá antes.")
    raise SystemExit(0)

# ---------------------------------------------------------------------------
# 1. Sucursales
# ---------------------------------------------------------------------------
NOMBRES_SUCURSAL = [
    ("El Kiosquito — Centro", "Av. 7 de Octubre y Bolívar, Quevedo"),
    ("El Kiosquito — La María", "Vía a La María km 2, Quevedo"),
    ("El Kiosquito — 24 de Mayo", "Calle 24 de Mayo y Malecón, Quevedo"),
]
sucursales = []
for nombre, direccion in NOMBRES_SUCURSAL:
    s = Sucursal(
        nombre=nombre, direccion=direccion, estado="operativa",
        fecha_registro=AHORA - timedelta(days=200),
        fecha_activacion=AHORA - timedelta(days=190),
    )
    db.add(s)
    sucursales.append(s)
db.flush()
print(f"sucursales: {len(sucursales)}")

# ---------------------------------------------------------------------------
# 2. Usuarios operativos adicionales (además del seed de login por rol)
# ---------------------------------------------------------------------------
dueno = db.execute(select(Usuario).where(Usuario.rol == "dueno")).scalars().first()
if dueno is None:
    dueno = Usuario(
        nombre="Mario (Dueño)", email="lzambranop6@uteq.edu.ec",
        password_hash=hash_password("MiPasswordReal123"), rol="dueno", activo=True,
    )
    db.add(dueno)
    db.flush()

encargados_sucursal = []
for i, s in enumerate(sucursales, start=1):
    u = Usuario(
        nombre=f"Encargado {s.nombre.split('—')[-1].strip()}",
        email=f"encargado{i}@elkiosquito.test",
        password_hash=hash_password("Prueba123!"), rol="encargado_sucursal", activo=True,
    )
    db.add(u)
    encargados_sucursal.append(u)

cajeros = []
NOMBRES_CAJERO = ["Ana", "Luis", "Carla", "Jhon", "Mayra", "Kevin"]
for i, nombre in enumerate(NOMBRES_CAJERO, start=1):
    u = Usuario(
        nombre=f"{nombre} (Cajero)", email=f"cajero{i}@elkiosquito.test",
        password_hash=hash_password("Prueba123!"), rol="cajero", activo=True,
    )
    db.add(u)
    cajeros.append(u)

encargado_compras = db.execute(
    select(Usuario).where(Usuario.rol == "encargado_compras")
).scalars().first()
if encargado_compras is None:
    encargado_compras = Usuario(
        nombre="Encargado de Compras", email="compras@elkiosquito.test",
        password_hash=hash_password("Prueba123!"), rol="encargado_compras", activo=True,
    )
    db.add(encargado_compras)

db.flush()
print(f"usuarios operativos: {len(encargados_sucursal)} encargados de sucursal, {len(cajeros)} cajeros")

# usuario_sucursal — 1 encargado + 2 cajeros por sucursal
from app.models.administracion import UsuarioSucursal
for i, s in enumerate(sucursales):
    db.add(UsuarioSucursal(usuario_id=encargados_sucursal[i].id, sucursal_id=s.id))
    for cajero in cajeros[i * 2 : i * 2 + 2]:
        db.add(UsuarioSucursal(usuario_id=cajero.id, sucursal_id=s.id))
db.flush()

# ---------------------------------------------------------------------------
# 3. Productos (8 categorías reales, ya sembradas por la migración 001)
# ---------------------------------------------------------------------------
categorias = {c.nombre: c for c in db.query(Categoria).all()}

CATALOGO_PRODUCTOS = {
    "Bebidas": [
        ("Coca-Cola 500ml", "unidad", "unidad", 0.75, 0.55),
        ("Coca-Cola 1L", "unidad", "unidad", 1.25, 0.90),
        ("Pilsener lata", "unidad", "unidad", 1.10, 0.80),
        ("Agua Manantial 600ml", "unidad", "unidad", 0.50, 0.30),
        ("Jugo Del Valle 1L", "unidad", "unidad", 1.60, 1.15),
        ("Gatorade 500ml", "unidad", "unidad", 1.20, 0.85),
        ("Café Nescafé sobre", "unidad", "unidad", 0.35, 0.20),
        ("Tesalia Twist 500ml", "unidad", "unidad", 0.70, 0.48),
        ("Red Bull lata", "unidad", "unidad", 2.20, 1.60),
        ("Leche de soya Ades 1L", "unidad", "unidad", 1.80, 1.30),
    ],
    "Snacks": [
        ("Papas Ruffles funda", "funda", "funda", 0.85, 0.55),
        ("Doritos funda", "funda", "funda", 0.90, 0.58),
        ("Chifles Platanitos", "funda", "funda", 0.60, 0.38),
        ("Maní Manicero funda", "funda", "funda", 0.50, 0.30),
        ("Cheetos funda", "funda", "funda", 0.80, 0.52),
        ("Tortrix funda", "funda", "funda", 0.75, 0.48),
        ("Galletas Ritz", "unidad", "unidad", 1.10, 0.75),
        ("Chocolate Manicho", "unidad", "unidad", 0.45, 0.28),
        ("Chicles Trident", "unidad", "unidad", 0.30, 0.15),
        ("Cereal barra Nestlé", "unidad", "unidad", 0.65, 0.40),
    ],
    "Lácteos": [
        ("Leche Toni 1L", "unidad", "unidad", 1.15, 0.85),
        ("Yogurt Toni 1L", "unidad", "unidad", 2.10, 1.55),
        ("Queso fresco libra", "libra", "libra", 2.50, 1.80),
        ("Mantequilla Toni 250g", "unidad", "unidad", 2.00, 1.45),
        ("Yogurt individual Vital", "unidad", "unidad", 0.65, 0.42),
        ("Crema de leche Toni", "unidad", "unidad", 1.30, 0.95),
    ],
    "Abarrotes": [
        ("Arroz Gustadina libra", "libra", "libra", 0.60, 0.42),
        ("Azúcar Valdez libra", "libra", "libra", 0.55, 0.38),
        ("Aceite La Favorita 1L", "unidad", "unidad", 2.80, 2.10),
        ("Atún Real lata", "unidad", "unidad", 1.40, 1.00),
        ("Sal Bella Sal funda", "funda", "funda", 0.40, 0.22),
        ("Fideos Oriental funda", "funda", "funda", 0.85, 0.55),
        ("Sardina Isabel lata", "unidad", "unidad", 1.20, 0.85),
        ("Salsa de tomate Los Andes", "unidad", "unidad", 1.15, 0.80),
        ("Mayonesa Ali", "unidad", "unidad", 1.90, 1.35),
        ("Café soluble Buendía", "unidad", "unidad", 2.30, 1.65),
        ("Huevos cubeta x30", "caja", "caja", 4.50, 3.60),
        ("Menestra fréjol libra", "libra", "libra", 1.10, 0.78),
    ],
    "Limpieza": [
        ("Detergente Deja 1kg", "kilo", "kilo", 3.20, 2.35),
        ("Cloro Klory 1L", "unidad", "unidad", 1.30, 0.90),
        ("Jabón de lavar Lavanda", "unidad", "unidad", 0.70, 0.45),
        ("Esponja Scotch Brite", "unidad", "unidad", 0.90, 0.55),
        ("Ambiental Glade aerosol", "unidad", "unidad", 3.50, 2.60),
        ("Fundas de basura rollo", "unidad", "unidad", 1.20, 0.80),
        ("Limpiavidrios Sapolio", "unidad", "unidad", 2.10, 1.50),
    ],
    "Cuidado Personal": [
        ("Jabón Palmolive", "unidad", "unidad", 0.65, 0.42),
        ("Shampoo Sedal 350ml", "unidad", "unidad", 3.10, 2.30),
        ("Papel higiénico Scott x4", "unidad", "unidad", 2.40, 1.75),
        ("Pasta dental Colgate", "unidad", "unidad", 1.85, 1.30),
        ("Desodorante Rexona", "unidad", "unidad", 2.60, 1.90),
        ("Toallas higiénicas Nosotras", "unidad", "unidad", 1.90, 1.35),
        ("Rastrillo Gillette", "unidad", "unidad", 1.40, 0.95),
        ("Crema dental infantil", "unidad", "unidad", 2.00, 1.40),
    ],
    "Panadería": [
        ("Pan de sal (unidad)", "unidad", "unidad", 0.15, 0.08),
        ("Pan integral funda", "funda", "funda", 1.60, 1.10),
        ("Galletas María", "unidad", "unidad", 0.70, 0.45),
        ("Tortas individuales", "unidad", "unidad", 1.20, 0.75),
        ("Pan de yuca funda", "funda", "funda", 1.80, 1.20),
    ],
    "Congelados": [
        ("Helado Pingüino 1L", "unidad", "unidad", 3.80, 2.70),
        ("Nuggets de pollo 400g", "unidad", "unidad", 3.20, 2.30),
        ("Papas fritas congeladas", "unidad", "unidad", 2.40, 1.70),
        ("Hamburguesas x4 congeladas", "unidad", "unidad", 3.60, 2.60),
        ("Paleta de helado", "unidad", "unidad", 0.75, 0.45),
    ],
}

productos = []
for cat_nombre, items in CATALOGO_PRODUCTOS.items():
    cat = categorias[cat_nombre]
    for nombre, u_venta, u_inv, precio, costo in items:
        p = Producto(
            nombre=nombre, categoria_id=cat.id,
            codigo_barras=f"75{random.randint(10**10, 10**11 - 1)}",
            unidad_venta_codigo=u_venta, unidad_inventario_codigo=u_inv,
            es_fraccionable=False, es_perecedero=cat.es_perecedero, activo=True,
        )
        p._precio_base = float(precio)  # atributo temporal, no persistido
        p._costo_base = float(costo)
        db.add(p)
        productos.append(p)
db.flush()
print(f"productos: {len(productos)}")

# ---------------------------------------------------------------------------
# 4. Proveedores
# ---------------------------------------------------------------------------
NOMBRES_PROVEEDOR = [
    "Distribuidora La Favorita", "Ecuacomercio Cía. Ltda.", "Nestlé Ecuador S.A.",
    "PRONACA Distribución", "Tesalia Springs Company", "Industrias Lácteas Toni",
    "Confiteca Ecuador", "Panificadora San José", "Distribuidora del Pacífico",
    "AJECUADOR (Tesalia/Big Cola)",
]
proveedores = [Proveedor(nombre=n, contacto=f"contacto{i}@proveedor.ec") for i, n in enumerate(NOMBRES_PROVEEDOR)]
db.add_all(proveedores)
db.flush()
print(f"proveedores: {len(proveedores)}")

# ---------------------------------------------------------------------------
# 5. Stock, lotes y precio vigente por sucursal
# ---------------------------------------------------------------------------
for s in sucursales:
    for p in productos:
        stock_ini = round(random.uniform(15, 200), 0)
        db.add(StockSucursal(
            producto_id=p.id, sucursal_id=s.id,
            cantidad_disponible=stock_ini,
            stock_minimo=round(stock_ini * 0.15, 0),
            dias_sin_venta=random.choice([0, 0, 0, 1, 2, 5]),
        ))
        # Variación de precio +/-5% por sucursal, redondeado a centavo.
        precio_sucursal = round(p._precio_base * random.uniform(0.97, 1.05), 2)
        db.add(HistorialPrecioProducto(
            producto_id=p.id, sucursal_id=s.id, precio_venta=precio_sucursal,
            fuente="manual", registrado_por=dueno.id,
            vigente_desde=AHORA - timedelta(days=180),
        ))
        p._precio_sucursal = getattr(p, "_precio_sucursal", {})
        p._precio_sucursal[s.id] = precio_sucursal

        if p.es_perecedero:
            for _ in range(random.randint(1, 2)):
                cant = round(random.uniform(10, 40), 0)
                db.add(LoteProducto(
                    producto_id=p.id, sucursal_id=s.id,
                    fecha_caducidad=HOY + timedelta(days=random.randint(-3, 45)),
                    cantidad_lote=cant, cantidad_restante=round(cant * random.uniform(0.2, 1.0), 0),
                    fecha_ingreso=AHORA - timedelta(days=random.randint(1, 30)),
                ))
db.flush()
print("stock, lotes y precios por sucursal listos")

# ---------------------------------------------------------------------------
# 6. Clientes
# ---------------------------------------------------------------------------
NOMBRES = ["María", "José", "Carmen", "Luis", "Ana", "Carlos", "Rosa", "Jorge", "Elena", "Pedro",
           "Gabriela", "Fernando", "Patricia", "Diego", "Sandra", "Andrés", "Verónica", "Marco",
           "Daniela", "Ricardo", "Johanna", "Freddy", "Katherine", "Vicente", "Priscila"]
APELLIDOS = ["Zambrano", "Mendoza", "Cedeño", "Alcívar", "Vera", "Muñoz", "Bravo", "García",
             "Sánchez", "Loor", "Intriago", "Pico", "Delgado", "Zapata", "Chávez", "Ponce"]

clientes = []
for i in range(180):
    nombre = f"{random.choice(NOMBRES)} {random.choice(APELLIDOS)}"
    edad_dias = random.randint(18 * 365, 70 * 365)
    c = Cliente(
        nombre=nombre,
        contacto=f"cliente{i+1}@gmail.com" if random.random() > 0.2 else None,
        fecha_nacimiento=HOY - timedelta(days=edad_dias),
        consentimiento_privacidad_en=AHORA - timedelta(days=random.randint(1, 180)),
        version_politica_privacidad="1.0",
        creado_en=AHORA - timedelta(days=random.randint(1, 180)),
    )
    db.add(c)
    clientes.append(c)
db.flush()
print(f"clientes: {len(clientes)}")

# ---------------------------------------------------------------------------
# 7. Turnos de caja + ventas + detalle (los últimos 90 días)
# ---------------------------------------------------------------------------
DIAS_HISTORIA = 90
METODOS = ["efectivo", "efectivo", "efectivo", "tarjeta", "electronico"]  # efectivo pesa más, realista en un kiosco

total_ventas = 0
total_detalle = 0
ventas_tarjeta_para_alerta = []

for dia_offset in range(DIAS_HISTORIA, 0, -1):
    fecha_dia = HOY - timedelta(days=dia_offset)
    es_finde = fecha_dia.weekday() >= 5  # sábado/domingo — más tráfico real de kiosco

    for si, s in enumerate(sucursales):
        cajeros_sucursal = cajeros[si * 2 : si * 2 + 2]
        for cajero in cajeros_sucursal:
            if random.random() < 0.08:
                continue  # el cajero libró ese día — no todo turno se abre siempre

            hora_apertura = datetime.combine(fecha_dia, datetime.min.time(), tzinfo=timezone.utc) + timedelta(hours=7, minutes=random.randint(0, 20))
            monto_inicial = round(random.uniform(20, 40), 2)

            turno = TurnoCaja(
                sucursal_id=s.id, cajero_id=cajero.id,
                hora_apertura=hora_apertura, monto_inicial=monto_inicial,
                estado="abierto",
            )
            db.add(turno)
            db.flush()

            n_ventas = random.randint(12, 28)
            if es_finde:
                n_ventas = int(n_ventas * 1.4)

            total_efectivo_turno = 0.0
            for _ in range(n_ventas):
                minutos_desde_apertura = random.randint(0, 12 * 60)
                fecha_hora = hora_apertura + timedelta(minutes=minutos_desde_apertura)
                n_items = random.choices([1, 2, 3, 4], weights=[45, 30, 18, 7])[0]
                productos_venta = random.sample(productos, k=n_items)

                metodo = random.choice(METODOS)
                cliente_id = random.choice(clientes).id if random.random() < 0.35 else None

                subtotal = 0.0
                lineas = []
                for prod in productos_venta:
                    cantidad = float(random.randint(1, 4))
                    precio = prod._precio_sucursal[s.id]
                    subtotal_item = round(cantidad * precio, 2)
                    subtotal += subtotal_item
                    lineas.append((prod, cantidad, precio, subtotal_item))
                subtotal = round(subtotal, 2)
                iva = round(subtotal * 0.15, 2)
                total = round(subtotal + iva, 2)

                venta = Venta(
                    sucursal_id=s.id, turno_caja_id=turno.id, cajero_id=cajero.id,
                    cliente_id=cliente_id, fecha_hora=fecha_hora,
                    subtotal=subtotal, descuento_aplicado=0, iva=iva, total=total,
                    metodo_pago=metodo, estado_pago="aprobado", estado_venta="completada",
                )
                db.add(venta)
                db.flush()

                for prod, cantidad, precio, subtotal_item in lineas:
                    db.add(DetalleVenta(
                        venta_id=venta.id, producto_id=prod.id, cantidad_venta=cantidad,
                        unidad_venta_codigo=prod.unidad_venta_codigo,
                        cantidad_inventario=cantidad, precio_unitario_aplicado=precio,
                        subtotal_item=subtotal_item,
                    ))
                    total_detalle += 1

                if metodo == "efectivo":
                    total_efectivo_turno += total
                elif metodo == "tarjeta" and random.random() < 0.03:
                    ventas_tarjeta_para_alerta.append(venta)

                total_ventas += 1

            # Cierre del turno — la mayoría cuadra, algunos con diferencia real
            hora_cierre = hora_apertura + timedelta(hours=random.randint(8, 10))
            monto_esperado = round(monto_inicial + total_efectivo_turno, 2)
            tiene_diferencia = random.random() < 0.12
            diferencia_monto = round(random.uniform(-5, 5), 2) if tiene_diferencia else 0.0
            monto_contado = round(monto_esperado + diferencia_monto, 2)

            turno.hora_cierre = hora_cierre
            turno.monto_contado = monto_contado
            turno.monto_esperado = monto_esperado
            turno.estado = "cerrado"
            if diferencia_monto != 0:
                turno.motivo_diferencia = random.choice([
                    "Vuelto mal dado en una venta de la tarde",
                    "Billete falso detectado, retirado de caja",
                    "Diferencia no identificada, se investigó y no se encontró causa puntual",
                ])
                if abs(diferencia_monto) > 3:
                    db.add(IncidenciaCuadreCaja(
                        turno_caja_id=turno.id,
                        score_anomalia=round(random.uniform(0.75, 0.98), 4),
                        justificacion="Diferencia de cuadre fuera del rango esperado para el historial de este cajero/turno.",
                        estado="pendiente",
                    ))
    if dia_offset % 15 == 0:
        db.flush()
        print(f"  ... {DIAS_HISTORIA - dia_offset}/{DIAS_HISTORIA} días generados, {total_ventas} ventas hasta ahora")

db.flush()
print(f"ventas: {total_ventas}, líneas de detalle: {total_detalle}")

# Alertas de fraude sobre algunas ventas con tarjeta (escritura cruzada real: 001 inserta, 006 a veces ya la atiende)
for venta in ventas_tarjeta_para_alerta[:25]:
    atendida = random.random() < 0.4
    db.add(AlertaFraudePago(
        venta_id=venta.id,
        motivo=random.choice([
            "Monto inusualmente alto para el historial del datáfono",
            "Múltiples intentos de cobro en corto tiempo",
            "Patrón de compra atípico para el horario",
        ]),
        estado="atendida" if atendida else "abierta",
        ultimos_4_digitos=f"{random.randint(1000,9999)}",
        atendida_en=AHORA - timedelta(days=random.randint(0, 5)) if atendida else None,
        atendida_por=encargados_sucursal[0].id if atendida else None,
    ))
db.flush()
print(f"alertas de fraude: {len(ventas_tarjeta_para_alerta[:25])}")

# ---------------------------------------------------------------------------
# 8. Órdenes de compra + recepciones + historial de costo
# ---------------------------------------------------------------------------
n_ordenes = 45
for i in range(n_ordenes):
    proveedor = random.choice(proveedores)
    sucursal = random.choice(sucursales)
    fecha_pedido = AHORA - timedelta(days=random.randint(5, DIAS_HISTORIA))
    oc = OrdenCompra(
        proveedor_id=proveedor.id, sucursal_id=sucursal.id, creado_por=encargado_compras.id,
        fecha_pedido=fecha_pedido, forma_pago=random.choice(["contado", "credito"]),
        estado="recibida_completa",
    )
    db.add(oc)
    db.flush()

    n_lineas = random.randint(2, 6)
    for prod in random.sample(productos, k=n_lineas):
        cantidad = float(random.randint(20, 150))
        precio_ofrecido = round(prod._costo_base * random.uniform(0.95, 1.03), 2)
        detalle = DetalleOrdenCompra(
            orden_compra_id=oc.id, producto_id=prod.id,
            cantidad_pedida=cantidad, precio_ofrecido=precio_ofrecido,
            pronostico_consultado=random.random() < 0.5,
        )
        db.add(detalle)
        db.flush()

        fecha_recepcion = fecha_pedido + timedelta(days=random.randint(1, 4))
        db.add(RecepcionOrdenCompra(
            detalle_orden_compra_id=detalle.id, cantidad_recibida_evento=cantidad,
            numero_documento_proveedor=f"FAC-{random.randint(10000,99999)}",
            fecha_recepcion=fecha_recepcion, usuario_id=encargado_compras.id,
        ))
        db.add(HistorialCostoProducto(
            producto_id=prod.id, proveedor_id=proveedor.id, costo=precio_ofrecido,
            orden_compra_id=oc.id, fecha=fecha_recepcion,
        ))
db.flush()
print(f"órdenes de compra: {n_ordenes} (con detalle, recepción e historial de costo)")

# ---------------------------------------------------------------------------
# 9. Mermas
# ---------------------------------------------------------------------------
CAUSAS = ["robo_externo", "error_humano", "fraude_interno", "caducidad"]
for _ in range(50):
    prod = random.choice(productos)
    s = random.choice(sucursales)
    causa = random.choices(CAUSAS, weights=[25, 30, 10, 35])[0]
    cantidad = round(random.uniform(1, 15), 0)
    precio = prod._precio_sucursal[s.id]
    m = Merma(
        producto_id=prod.id, sucursal_id=s.id, cantidad=cantidad,
        valor_estimado=round(cantidad * precio, 2), causa=causa,
        fecha_deteccion=AHORA - timedelta(days=random.randint(0, DIAS_HISTORIA)),
        registrado_por=random.choice(cajeros).id,
    )
    if causa in ("error_humano", "fraude_interno"):
        investigada = random.random() < 0.6
        if investigada:
            m.resultado_investigacion = random.choice(["confirmada", "descartada"])
            m.fecha_resultado = m.fecha_deteccion + timedelta(days=random.randint(1, 5))
            m.investigado_por = random.choice(encargados_sucursal).id
    db.add(m)
db.flush()
print("mermas: 50")

# ---------------------------------------------------------------------------
# 10. Clasificación comercial de productos (gancho/nicho)
# ---------------------------------------------------------------------------
for p in productos:
    clasif = random.choices(["gancho", "nicho"], weights=[35, 65])[0]
    fecha_desde = AHORA - timedelta(days=170)
    db.add(ClasificacionProducto(producto_id=p.id, clasificacion=clasif, actualizado_en=fecha_desde, actualizado_por=dueno.id))
    db.add(ProductoClasificacionHistorial(
        producto_id=p.id, clasificacion=clasif, fecha_desde=fecha_desde,
        motivo_cambio="Clasificación inicial de catálogo (seed de demostración)",
        usuario_id=dueno.id,
    ))
db.flush()
print(f"clasificación comercial: {len(productos)} productos")

# ---------------------------------------------------------------------------
# 11. Recomendaciones de precio pendientes (para la pantalla de pricing)
# ---------------------------------------------------------------------------
for p, s in random.sample([(p, s) for p in productos for s in sucursales], k=15):
    precio_actual = p._precio_sucursal[s.id]
    nuevo = round(precio_actual * random.uniform(0.92, 1.12), 2)
    db.add(RecomendacionPrecio(
        producto_id=p.id, sucursal_id=s.id, precio_actual_snapshot=precio_actual,
        precio_recomendado=nuevo,
        justificacion="Ajuste sugerido por el motor de pricing según margen objetivo de su clasificación comercial y precios de competencia observados.",
        estado="pendiente",
    ))
db.flush()
print("recomendaciones de precio: 15")

# ---------------------------------------------------------------------------
# 12. Pronóstico de demanda + demanda insatisfecha
# ---------------------------------------------------------------------------
for p, s in random.sample([(p, s) for p in productos for s in sucursales], k=40):
    db.add(PronosticoDemanda(
        producto_id=p.id, sucursal_id=s.id,
        cantidad_recomendada=round(random.uniform(10, 80), 0),
        tamano_muestra=DIAS_HISTORIA,
        periodo_inicio=HOY - timedelta(days=DIAS_HISTORIA), periodo_fin=HOY,
    ))
for _ in range(20):
    prod = random.choice(productos)
    s = random.choice(sucursales)
    db.add(DemandaInsatisfecha(
        sucursal_id=s.id, producto_id=prod.id, cajero_id=random.choice(cajeros).id,
        hora_evento=AHORA - timedelta(days=random.randint(0, DIAS_HISTORIA), hours=random.randint(0, 12)),
    ))
db.flush()
print("pronóstico de demanda: 40, demanda insatisfecha: 20")

# ---------------------------------------------------------------------------
# 13. Versiones "activas" de los 5 modelos + segmentación de clientes + churn
# ---------------------------------------------------------------------------
METRICAS = {
    "demanda": ("MAE", 4.2), "pricing": ("MAE", 0.85), "churn": ("F1", 0.78),
    "anomalias_caja": ("F1", 0.71), "segmentacion_clientes": ("silhouette", 0.62),
}
for modelo, (metrica, valor) in METRICAS.items():
    db.add(VersionModeloMl(
        modelo=modelo, version="2026.09.06-seed", estado="activo",
        tamano_muestra=max(total_ventas, 180), nombre_metrica=metrica, valor_metrica=valor,
        periodo_inicio=HOY - timedelta(days=DIAS_HISTORIA), periodo_fin=HOY,
    ))
db.flush()
version_segmentacion = db.query(VersionModeloMl).filter_by(modelo="segmentacion_clientes").first()

SEGMENTOS = ["leal_alto_margen", "frecuente_bajo_margen", "ocasional", "nuevo", "en_riesgo"]
for c in clientes:
    seg = random.choices(SEGMENTOS, weights=[15, 20, 35, 20, 10])[0]
    db.add(SegmentoCliente(
        cliente_id=c.id, segmento_codigo=seg,
        frecuencia_snapshot=round(random.uniform(0.5, 8), 2),
        margen_snapshot=round(random.uniform(1, 15), 2),
        recencia_dias_snapshot=random.randint(0, 120),
        tamano_muestra=len(clientes), version_modelo_id=version_segmentacion.id,
        periodo_inicio=HOY - timedelta(days=DIAS_HISTORIA), periodo_fin=HOY,
    ))
    if seg == "en_riesgo" and random.random() < 0.6:
        db.add(EvaluacionChurn(
            cliente_id=c.id, es_riesgo_real=random.random() < 0.7,
            dias_sin_compra_al_momento=random.randint(30, 90),
            frecuencia_historica_dias=round(random.uniform(5, 20), 2),
            justificacion="Cliente sin compras registradas en un período muy superior a su frecuencia histórica habitual.",
            tamano_muestra=len(clientes),
        ))
db.flush()
print(f"versiones de modelo: {len(METRICAS)}, segmentación de clientes: {len(clientes)}, evaluaciones de churn generadas")

db.commit()
print("OK — seed de demostración completo")
