"""
Seed de datos de demostración para el módulo de Administración:
1. Parámetros del sistema: moneda USD e IVA.
2. Sucursal en apertura: "El Kiosquito — San Camilo" con ítems de checklist iniciales.
3. Solicitudes ARCO: 15 solicitudes variadas (pendientes normales y vencidas, atendidas y rechazadas con motivos reales).
4. Log de auditoría: ~120 eventos operativos y de seguridad con ~18 anomalías operativas para probar filtros y exportación CSV.

Uso:
  Get-Content seed_administracion_demo.py | docker exec -i proyectoelkiosquito-backend-1 python -
"""

import random
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from app.database import SessionLocal
import app.models  # noqa: F401
from app.models.administracion import (
    EstadoSolicitudArco,
    HistorialParametroSistema,
    LogAuditoria,
    RecursoSistema,
    SolicitudArco,
    TipoSolicitudArco,
    Usuario,
    UsuarioSucursal,
)
from app.models.clientes import Cliente
from app.models.expansion import (
    ChecklistAperturaSucursal,
    ItemChecklistApertura,
    Sucursal,
)

random.seed(1337)
AHORA = datetime.now(timezone.utc)
db = SessionLocal()

print("--- Iniciando seed de datos para Administración ---")

# ===========================================================================
# 1. Parámetros del sistema
# ===========================================================================
param_moneda = db.query(HistorialParametroSistema).filter_by(clave="moneda").first()
dueno = db.query(Usuario).filter_by(rol="dueno").first()
dueno_id = dueno.id if dueno else 2

if not param_moneda:
    p_moneda = HistorialParametroSistema(
        clave="moneda",
        valor="USD",
        vigente_desde=AHORA - timedelta(days=120),
        registrado_por=dueno_id,
    )
    db.add(p_moneda)
    print("✓ Parámetro 'moneda' = 'USD' registrado.")
else:
    print("✓ Parámetro 'moneda' ya existe.")

param_iva = db.query(HistorialParametroSistema).filter_by(clave="iva").first()
if not param_iva:
    p_iva = HistorialParametroSistema(
        clave="iva",
        valor="0.15",
        vigente_desde=AHORA - timedelta(days=120),
        registrado_por=dueno_id,
    )
    db.add(p_iva)
    print("✓ Parámetro 'iva' = '0.15' registrado.")
db.commit()

# ===========================================================================
# 2. Sucursal en apertura y checklist
# ===========================================================================
sucursal_apertura = db.query(Sucursal).filter_by(nombre="El Kiosquito — San Camilo").first()
if not sucursal_apertura:
    encargado = db.query(Usuario).filter_by(rol="encargado_sucursal").first()
    sucursal_apertura = Sucursal(
        nombre="El Kiosquito — San Camilo",
        direccion="Av. Guayaquil y Calle B, San Camilo, Quevedo",
        estado="en_apertura",
        responsable_id=encargado.id if encargado else dueno_id,
        fecha_registro=AHORA - timedelta(days=14),
        fecha_activacion=None,
        fecha_cierre=None,
    )
    db.add(sucursal_apertura)
    db.flush()

    items_catalogo = (
        db.query(ItemChecklistApertura)
        .filter(ItemChecklistApertura.activo.is_(True))
        .order_by(ItemChecklistApertura.orden)
        .all()
    )

    completados_iniciales = {"local_arrendado", "mobiliario_instalado", "pos_instalado"}
    for item in items_catalogo:
        es_comp = item.codigo in completados_iniciales
        dias_atras = 10 if item.codigo == "local_arrendado" else (6 if item.codigo == "mobiliario_instalado" else 3)
        db.add(
            ChecklistAperturaSucursal(
                sucursal_id=sucursal_apertura.id,
                item=item.codigo,
                completado=es_comp,
                fecha_completado=(AHORA - timedelta(days=dias_atras)) if es_comp else None,
                completado_por=dueno_id if es_comp else None,
            )
        )
    db.commit()
    print(f"✓ Sucursal '{sucursal_apertura.nombre}' (id={sucursal_apertura.id}) creada con 3/8 ítems completados.")
else:
    print(f"✓ Sucursal '{sucursal_apertura.nombre}' ya existe.")

# ===========================================================================
# 3. Solicitudes ARCO
# ===========================================================================
solicitudes_existentes = db.query(SolicitudArco).count()
if solicitudes_existentes < 5:
    clientes = db.query(Cliente).order_by(Cliente.id).limit(30).all()
    if not clientes:
        print("⚠ No hay clientes en la base de datos para asociar solicitudes ARCO.")
    else:
        solicitudes_data = [
            # 5 PENDIENTES (2 vencidas > 15 días, 3 recientes)
            {
                "cliente": clientes[0],
                "tipo": "acceso",
                "detalle": "Solicito copia certificada en formato digital de mi historial de compras y registros transaccionales.",
                "estado": "pendiente",
                "fecha_solicitud": AHORA - timedelta(days=26),
                "fecha_resolucion": None,
                "atendida_por": None,
                "respuesta": None,
            },
            {
                "cliente": clientes[1],
                "tipo": "cancelacion",
                "detalle": "Solicito la revocatoria de mi consentimiento y eliminación de datos de contacto de las bases de fidelización.",
                "estado": "pendiente",
                "fecha_solicitud": AHORA - timedelta(days=19),
                "fecha_resolucion": None,
                "atendida_por": None,
                "respuesta": None,
            },
            {
                "cliente": clientes[2],
                "tipo": "rectificacion",
                "detalle": "Deseo actualizar mi número de teléfono y correo electrónico de contacto por cambio de domicilio.",
                "estado": "pendiente",
                "fecha_solicitud": AHORA - timedelta(days=7),
                "fecha_resolucion": None,
                "atendida_por": None,
                "respuesta": None,
            },
            {
                "cliente": clientes[3],
                "tipo": "oposicion",
                "detalle": "Solicito que no se utilicen mis compras para modelos predictivos ni ofertas personalizadas de temporada.",
                "estado": "pendiente",
                "fecha_solicitud": AHORA - timedelta(days=4),
                "fecha_resolucion": None,
                "atendida_por": None,
                "respuesta": None,
            },
            {
                "cliente": clientes[4],
                "tipo": "acceso",
                "detalle": "Solicito conocer qué sucursales han registrado mis compras y qué proveedores procesan mis pagos.",
                "estado": "pendiente",
                "fecha_solicitud": AHORA - timedelta(days=1),
                "fecha_resolucion": None,
                "atendida_por": None,
                "respuesta": None,
            },
            # 7 ATENDIDAS
            {
                "cliente": clientes[5],
                "tipo": "acceso",
                "detalle": "Requiero reporte consolidado de consumos para declaración tributaria.",
                "estado": "atendida",
                "fecha_solicitud": AHORA - timedelta(days=45),
                "fecha_resolucion": AHORA - timedelta(days=39),
                "atendida_por": dueno_id,
                "respuesta": "Se envió informe consolidado en formato PDF al correo electrónico registrado del titular.",
            },
            {
                "cliente": clientes[6],
                "tipo": "rectificacion",
                "detalle": "Corrección de error tipográfico en mi apellido paterno en el padrón de clientes.",
                "estado": "atendida",
                "fecha_solicitud": AHORA - timedelta(days=40),
                "fecha_resolucion": AHORA - timedelta(days=35),
                "atendida_por": dueno_id,
                "respuesta": "Se verificó cédula de identidad y se corrigió el apellido en el perfil maestro del cliente.",
            },
            {
                "cliente": clientes[7],
                "tipo": "oposicion",
                "detalle": "Oposición formal a la recepción de mensajes comerciales vía WhatsApp o SMS.",
                "estado": "atendida",
                "fecha_solicitud": AHORA - timedelta(days=32),
                "fecha_resolucion": AHORA - timedelta(days=25),
                "atendida_por": dueno_id,
                "respuesta": "Se desactivó la casilla de suscripción promocional en el módulo de fidelización.",
            },
            {
                "cliente": clientes[8],
                "tipo": "cancelacion",
                "detalle": "Solicito darme de baja del registro de clientes frecuentes de la tienda.",
                "estado": "atendida",
                "fecha_solicitud": AHORA - timedelta(days=28),
                "fecha_resolucion": AHORA - timedelta(days=22),
                "atendida_por": dueno_id,
                "respuesta": "Se procedió con la anonimización de datos de contacto y baja del programa de fidelización.",
            },
            {
                "cliente": clientes[9],
                "tipo": "rectificacion",
                "detalle": "Actualización de correo de trabajo para el envío automatizado de notas de crédito y comprobantes.",
                "estado": "atendida",
                "fecha_solicitud": AHORA - timedelta(days=21),
                "fecha_resolucion": AHORA - timedelta(days=16),
                "atendida_por": dueno_id,
                "respuesta": "Correo electrónico actualizado satisfactoriamente en el registro central.",
            },
            {
                "cliente": clientes[10 % len(clientes)],
                "tipo": "acceso",
                "detalle": "Consulta sobre los términos y fecha de consentimiento de la política de privacidad aplicable a mis datos.",
                "estado": "atendida",
                "fecha_solicitud": AHORA - timedelta(days=18),
                "fecha_resolucion": AHORA - timedelta(days=14),
                "atendida_por": dueno_id,
                "respuesta": "Se remitió copia de la Política de Privacidad vigente v1.0 y fecha de registro de consentimiento.",
            },
            {
                "cliente": clientes[11 % len(clientes)],
                "tipo": "oposicion",
                "detalle": "Solicito no ser incluido en campañas de reactivación de clientes inactivos o churn.",
                "estado": "atendida",
                "fecha_solicitud": AHORA - timedelta(days=14),
                "fecha_resolucion": AHORA - timedelta(days=10),
                "atendida_por": dueno_id,
                "respuesta": "Se excluyó al cliente de la lista de segmentación y campañas automáticas de retención.",
            },
            # 3 RECHAZADAS
            {
                "cliente": clientes[12 % len(clientes)],
                "tipo": "cancelacion",
                "detalle": "Exijo la supresión y borrado inmediato de todas las facturas emitidas a mi nombre en los últimos 3 años.",
                "estado": "rechazada",
                "fecha_solicitud": AHORA - timedelta(days=35),
                "fecha_resolucion": AHORA - timedelta(days=30),
                "atendida_por": dueno_id,
                "respuesta": "Petición improcedente: la Ley de Régimen Tributario Interno del SRI exige la conservación inmutable de comprobantes de venta por 7 años.",
            },
            {
                "cliente": clientes[13 % len(clientes)],
                "tipo": "rectificacion",
                "detalle": "Solicitud de modificación de datos de titularidad presentada por un tercero sin poder notarial.",
                "estado": "rechazada",
                "fecha_solicitud": AHORA - timedelta(days=25),
                "fecha_resolucion": AHORA - timedelta(days=20),
                "atendida_por": dueno_id,
                "respuesta": "Rechazada por falta de legitimación activa: los derechos ARCO son personalísimos y no se acreditó representación legal válida.",
            },
            {
                "cliente": clientes[14 % len(clientes)],
                "tipo": "cancelacion",
                "detalle": "Solicitud de eliminación de historial comercial enviada sin documento de identificación para cotejar firma.",
                "estado": "rechazada",
                "fecha_solicitud": AHORA - timedelta(days=15),
                "fecha_resolucion": AHORA - timedelta(days=12),
                "atendida_por": dueno_id,
                "respuesta": "Rechazada: no se adjuntó la cédula o pasaporte indispensable para validar la identidad del titular requirente.",
            },
        ]

        for s in solicitudes_data:
            nueva_solicitud = SolicitudArco(
                cliente_id=s["cliente"].id,
                tipo=s["tipo"],
                detalle=s["detalle"],
                estado=s["estado"],
                fecha_solicitud=s["fecha_solicitud"],
                fecha_resolucion=s["fecha_resolucion"],
                atendida_por=s["atendida_por"],
                respuesta=s["respuesta"],
            )
            db.add(nueva_solicitud)
        db.commit()
        print(f"✓ {len(solicitudes_data)} solicitudes ARCO sembradas con éxito (5 pendientes, 7 atendidas, 3 rechazadas).")
else:
    print(f"✓ Solicitudes ARCO ya existen ({solicitudes_existentes} registros).")

# ===========================================================================
# 4. Log de auditoría (~120 eventos variados, con ~18 anomalías)
# ===========================================================================
total_auditoria = db.query(LogAuditoria).count()
if total_auditoria < 80:
    usuarios = db.query(Usuario).all()
    sucursales_activas = db.query(Sucursal).filter(Sucursal.estado == "operativa").all()
    suc_ids = [s.id for s in sucursales_activas] or [1, 2, 3]

    eventos_auditoria = []

    # Plantillas de eventos normales (exitoso=True)
    plantillas_exitosas = [
        ("login", "usuario", lambda: (random.choice(usuarios).id, random.choice(suc_ids), {"metodo": "password"})),
        ("abrir_turno", "turno_caja", lambda: (random.choice(usuarios).id, random.choice(suc_ids), {"monto_inicial": 50.00})),
        ("cerrar_turno", "turno_caja", lambda: (random.choice(usuarios).id, random.choice(suc_ids), {"monto_declarado": 234.50, "diferencia": 0.00})),
        ("crear_venta", "venta", lambda: (random.choice(usuarios).id, random.choice(suc_ids), {"total": round(random.uniform(3.5, 45.0), 2), "lineas": random.randint(1, 6)})),
        ("registrar_merma", "merma", lambda: (random.choice(usuarios).id, random.choice(suc_ids), {"motivo": "caducado", "costo_total": round(random.uniform(2.0, 15.0), 2)})),
        ("crear_orden_compra", "orden_compra", lambda: (3, random.choice(suc_ids), {"items": random.randint(3, 10), "total_estimado": round(random.uniform(150, 800), 2)})),
        ("recibir_orden_compra", "orden_compra", lambda: (3, random.choice(suc_ids), {"unidades_recibidas": random.randint(50, 300)})),
        ("ajuste_inventario", "inventario", lambda: (random.choice([2, 4]), random.choice(suc_ids), {"tipo": "recuento_ciclico"})),
        ("asignar_rol_y_sucursales", "usuario", lambda: (dueno_id, None, {"usuario_afectado": random.choice(usuarios).id})),
        ("registrar_parametro_sistema", "parametro_sistema", lambda: (dueno_id, None, {"parametro": "iva", "valor": "0.15"})),
        ("crear_solicitud_arco", "solicitud_arco", lambda: (dueno_id, None, {"tipo": "acceso"})),
        ("resolver_solicitud_arco", "solicitud_arco", lambda: (dueno_id, None, {"estado": "atendida"})),
        ("consultar_estado_apertura", "checklist_apertura", lambda: (dueno_id, sucursal_apertura.id if sucursal_apertura else 4, {})),
        ("completar_item_checklist", "checklist_apertura", lambda: (dueno_id, sucursal_apertura.id if sucursal_apertura else 4, {"item": "pos_instalado"})),
        ("recomendar_precios", "recomendacion_precio", lambda: (dueno_id, random.choice(suc_ids), {"algoritmo": "elasticidad_v1"})),
        ("evaluar_churn", "churn", lambda: (dueno_id, None, {"clientes_evaluados": 180, "en_riesgo": 14})),
    ]

    # Plantillas de anomalías (exitoso=False)
    plantillas_anomalias = [
        ("login", "usuario", None, None, {"error": "Credenciales inválidas", "email_intentado": "desconocido@elkiosquito.test"}),
        ("login", "usuario", None, None, {"error": "Contraseña incorrecta", "email_intentado": "cajero1@elkiosquito.test"}),
        ("login", "usuario", None, None, {"error": "Usuario desactivado temporalmente por política interna", "email_intentado": "ex_empleado@elkiosquito.test"}),
        ("abrir_turno", "turno_caja", 9, 1, {"error": "El cajero ya tiene un turno abierto activo en esta sucursal"}),
        ("cerrar_turno", "turno_caja", 11, 2, {"error": "Discrepancia de efectivo no justificada: faltante de $18.50"}),
        ("crear_venta", "venta", 10, 1, {"error": "Intento de registro de cobro sin turno de caja operativo abierto"}),
        ("crear_orden_compra", "orden_compra", 3, 2, {"error": "El proveedor seleccionado se encuentra dado de baja (inactivo)"}),
        ("recibir_orden_compra", "orden_compra", 3, 1, {"error": "Compra promocional por oferta sin consulta previa de pronóstico de demanda"}),
        ("ajuste_inventario", "inventario", 4, 3, {"error": "Intento de ajuste con cantidad negativa superior al stock disponible registrado"}),
        ("crear_sucursal", "sucursal", 4, None, {"error": "Acceso denegado: el rol encargado_sucursal no tiene permisos para crear sucursales"}),
        ("desactivar_usuario", "usuario", 5, None, {"error": "Acceso denegado: operación restringida a dueños y administradores"}),
        ("consultar_auditoria", "parametro_sistema", 3, None, {"error": "Intento de consulta de auditoría global sin credenciales de dueño"}),
        ("aplicar_descuento", "venta", 12, 2, {"error": "Cupón de descuento vencido o código de promoción inválido"}),
        ("heredar_catalogo", "sucursal", 4, 1, {"error": "Conflicto: la herencia de catálogo ya fue ejecutada previamente para esta sucursal"}),
        ("cobro_datafono", "datafono", 13, 3, {"error": "Transacción rechazada por el procesador del datáfono: timeout de red bancaria"}),
        ("cambiar_precio", "precio", 7, 2, {"error": "Acceso denegado: fijación de precios centralizados no autorizada para este usuario"}),
        ("login", "usuario", None, None, {"error": "Múltiples intentos fallidos de autenticación desde IP externa no reconocida"}),
        ("anular_comprobante", "venta", 14, 3, {"error": "Intento de eliminación física prohibido por la constitución del sistema (Art. 2.4)"}),
    ]

    # Generar ~110 eventos exitosos
    for i in range(110):
        dias = random.uniform(0.1, 29.5)
        momento = AHORA - timedelta(days=dias)
        accion, recurso, fn_params = random.choice(plantillas_exitosas)
        u_id, s_id, detalle = fn_params()
        ip = f"192.168.1.{random.randint(10, 80)}"
        eventos_auditoria.append(
            LogAuditoria(
                usuario_id=u_id,
                accion=accion,
                recurso=recurso,
                recurso_id=random.randint(1, 500),
                sucursal_id=s_id,
                detalle=detalle,
                exitoso=True,
                ip_origen=ip,
                creado_en=momento,
            )
        )

    # Generar las anomalías (exitoso=False)
    for anomalia in plantillas_anomalias:
        dias = random.uniform(0.2, 28.0)
        momento = AHORA - timedelta(days=dias)
        accion, recurso, u_id, s_id, detalle = anomalia
        ip = f"192.168.1.{random.randint(90, 150)}" if u_id else f"10.0.0.{random.randint(2, 50)}"
        eventos_auditoria.append(
            LogAuditoria(
                usuario_id=u_id,
                accion=accion,
                recurso=recurso,
                recurso_id=random.randint(1, 200) if u_id else None,
                sucursal_id=s_id,
                detalle=detalle,
                exitoso=False,
                ip_origen=ip,
                creado_en=momento,
            )
        )

    # Ordenar por fecha cronológica y persistir
    eventos_auditoria.sort(key=lambda e: e.creado_en)
    db.add_all(eventos_auditoria)
    db.commit()
    print(f"✓ {len(eventos_auditoria)} eventos de auditoría registrados ({len(plantillas_anomalias)} anomalías).")
else:
    print(f"✓ Auditoría ya tiene suficiente volumen ({total_auditoria} registros).")

db.close()
print("--- Seed de Administración completado exitosamente ---")
