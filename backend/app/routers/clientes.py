"""
Router del módulo 002-clientes-fidelizacion — cliente, la dimensión SCD
tipo 2 de segmento de valor (K-Means), evaluación de riesgo de abandono
(churn) y sus campañas de recuperación. Implementa el contrato
el-kiosquito-002-clientes-fidelizacion-contracts-openapi.yaml.

RBAC: la matriz de 002 solo tiene 2 recursos — `cliente` (alta y consulta
del cliente, su historial de compras y su segmento) y `churn` (evaluación
de riesgo y campañas de recuperación). Los endpoints `POST /fidelizacion/
segmentos` y `POST /fidelizacion/evaluaciones-churn`, que el contrato
marca como `security: [sistema]` (un pipeline batch, no un usuario real),
se autorizan igual contra la matriz real con `require_permission` — el
proyecto no modela un rol "sistema" aparte; en la práctica los dispara
una cuenta con rol `dueno`.
"""

from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, log_accion, require_permission
from app.database import get_db
from app.models.administracion import Usuario
from app.models.analitica import VersionModeloMl
from app.models.clientes import CampanaRecuperacion, Cliente, EvaluacionChurn, Segmento, SegmentoCliente
from app.models.core_ventas import Venta
from app.models.promociones import Cupon
from app.schemas.clientes import (
    CampanaRecuperacionCrearIn,
    CampanaRecuperacionOut,
    CampanaResultadoOut,
    ClienteCrearIn,
    ClienteOut,
    EvaluacionChurnConsultaOut,
    EvaluacionChurnCrearIn,
    EvaluacionChurnOut,
    PoliticaPrivacidadOut,
    SegmentoCatalogoOut,
    SegmentoConsultaOut,
    SegmentoCrearIn,
    SegmentoOut,
    VentaResumenOut,
)
from app.services.notificaciones import notificar_campana_recuperacion

router = APIRouter()

# Art. 10.4/10.9 de la constitución (LOPDP Ecuador): única fuente de
# verdad de la versión y el texto vigentes — el front nunca hardcodea
# esto, siempre lo lee de `GET /clientes/politica-privacidad` (RF-CF-012),
# así que subir la versión acá es lo único que hace falta para que el
# checkbox de alta muestre el texto nuevo y el consentimiento registrado
# quede con la versión correcta desde ese momento en adelante.
_POLITICA_PRIVACIDAD_VIGENTE = PoliticaPrivacidadOut(
    version="1.0",
    vigente_desde="2026-09-05",
    contenido=(
        "El Kiosquito (el negocio, como responsable del tratamiento) recolecta de vos "
        "únicamente nombre, un dato de contacto y fecha de nacimiento para el programa de "
        "fidelización — nunca datos sensibles (Art. 10.6). Estos datos se usan solo para "
        "registrar tus compras, calcular beneficios de fidelización y enviarte cupones o "
        "comunicaciones operativas relacionadas (nunca se venden ni se comparten con "
        "terceros). Se conservan mientras seas cliente activo de la cadena. Tenés derecho "
        "a acceder, rectificar, cancelar tus datos o oponerte a este tratamiento (derechos "
        "ARCO) en cualquier momento, sin costo, a través del punto de contacto de abajo. "
        "Tus datos se transmiten cifrados y se almacenan con acceso restringido por rol."
    ),
    punto_contacto="privacidad@elkiosquito.local",
)


def _get_cliente_o_404(db: Session, cliente_id: int) -> Cliente:
    cliente = db.get(Cliente, cliente_id)
    if cliente is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cliente no encontrado")
    return cliente


# ---------------------------------------------------------------------------
# Cliente (RF-CF-001, 002)
# ---------------------------------------------------------------------------


@router.get("/clientes/politica-privacidad", response_model=PoliticaPrivacidadOut, tags=["clientes"])
def consultar_politica_privacidad(
    _current_user: Usuario = Depends(require_permission("cliente", "leer")),
) -> PoliticaPrivacidadOut:
    """RF-CF-012 (Art. 10.4/10.9): el frontend muestra este texto y esta
    versión ANTES de dejar marcar la casilla de `POST /clientes` — nunca
    un texto estático embebido en el bundle, para que subir la versión
    acá sea lo único necesario en el día que cambie la política."""

    return _POLITICA_PRIVACIDAD_VIGENTE


@router.get("/clientes", response_model=list[ClienteOut], tags=["clientes"])
def buscar_clientes(
    q: str = Query("", description="Búsqueda parcial e insensible a mayúsculas sobre nombre o contacto. Si está vacío, devuelve la lista inicial."),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("cliente", "leer")),
) -> list[Cliente]:
    query = db.query(Cliente)
    if q and q.strip():
        termino = f"%{q.strip().lower()}%"
        query = query.filter(
            or_(
                func.lower(Cliente.nombre).like(termino),
                func.lower(Cliente.contacto).like(termino),
            )
        )
    return (
        query
        .order_by(Cliente.nombre)
        .limit(50)
        .all()
    )


@router.post("/clientes", response_model=ClienteOut, status_code=status.HTTP_201_CREATED, tags=["clientes"])
def crear_cliente(
    payload: ClienteCrearIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("cliente", "crear")),
) -> Cliente:
    # RN-CF-005 (Art. 10.4): sin la casilla marcada, el alta ni siquiera
    # se intenta — la política exige el consentimiento "previo al envío
    # del formulario", no un aviso posterior.
    if not payload.acepto_politica_privacidad:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Debe aceptar la política de privacidad para registrar un cliente en el programa de fidelización (Art. 10.4 LOPDP)",
        )

    cliente = Cliente(
        nombre=payload.nombre,
        contacto=payload.contacto,
        fecha_nacimiento=payload.fecha_nacimiento,
        consentimiento_privacidad_en=datetime.utcnow(),
        version_politica_privacidad=_POLITICA_PRIVACIDAD_VIGENTE.version,
    )
    db.add(cliente)
    db.commit()
    db.refresh(cliente)
    log_accion(
        db, usuario_id=current_user.id, accion="crear_cliente", recurso="cliente", recurso_id=cliente.id, exitoso=True, request=request
    )
    return cliente


@router.get("/clientes/{cliente_id}/historial-compras", response_model=list[VentaResumenOut], tags=["clientes"])
def consultar_historial_compras(
    cliente_id: int,
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(require_permission("cliente", "leer")),
) -> list[Venta]:
    """Proyección de solo lectura sobre `venta` (001) — este módulo nunca
    escribe ahí, solo consulta (mismo principio que RNF-CVI-003)."""

    _get_cliente_o_404(db, cliente_id)
    return db.query(Venta).filter(Venta.cliente_id == cliente_id).order_by(Venta.fecha_hora.desc()).all()


# ---------------------------------------------------------------------------
# Segmentación de valor — SCD2 sin tabla aparte (RF-CF-003, 007 a 011)
# ---------------------------------------------------------------------------


@router.get("/clientes/{cliente_id}/segmento", response_model=SegmentoConsultaOut, tags=["fidelizacion"])
def consultar_segmento_actual(
    cliente_id: int,
    db: Session = Depends(get_db),
    # 'churn' (no 'cliente'): datos analíticos calculados por el modelo,
    # mismo nivel de acceso que el resto de este bloque — no todo el que
    # puede registrar un cliente en el POS debe poder ver su segmentación.
    _current_user: Usuario = Depends(require_permission("churn", "leer")),
) -> SegmentoConsultaOut:
    _get_cliente_o_404(db, cliente_id)
    vigente = (
        db.query(SegmentoCliente)
        .filter(SegmentoCliente.cliente_id == cliente_id, SegmentoCliente.vigente_hasta.is_(None))
        .first()
    )
    if vigente is None:
        return SegmentoConsultaOut(datos_suficientes=False, segmento=None)
    return SegmentoConsultaOut(datos_suficientes=True, segmento=SegmentoOut.model_validate(vigente))


@router.post("/fidelizacion/segmentos", response_model=SegmentoOut, status_code=status.HTTP_201_CREATED, tags=["fidelizacion"])
def registrar_segmento(
    payload: SegmentoCrearIn,
    request: Request,
    db: Session = Depends(get_db),
    # 'churn': el contrato marca este endpoint security:[sistema] (lo
    # dispara el pipeline batch de K-Means, no un cajero) — 'churn' es el
    # único recurso de este módulo donde solo dueño puede crear.
    current_user: Usuario = Depends(require_permission("churn", "crear")),
) -> SegmentoCliente:
    _get_cliente_o_404(db, payload.cliente_id)

    segmento_catalogo = db.get(Segmento, payload.segmento_codigo)
    if segmento_catalogo is None or not segmento_catalogo.activo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Segmento '{payload.segmento_codigo}' no existe en el catálogo")

    if db.get(VersionModeloMl, payload.version_modelo_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "version_modelo_id no existe en 011-analitica-reportes")

    if payload.periodo_inicio > payload.periodo_fin:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "periodo_inicio no puede ser posterior a periodo_fin")

    # SCD2 (ver docstring de clientes.py): cierra la fila vigente en la
    # misma transacción que inserta la nueva — el índice único parcial
    # ux_segmento_cliente_vigente respalda esto a nivel de BD.
    ahora = datetime.utcnow()
    vigente_actual = (
        db.query(SegmentoCliente)
        .filter(SegmentoCliente.cliente_id == payload.cliente_id, SegmentoCliente.vigente_hasta.is_(None))
        .first()
    )
    if vigente_actual is not None:
        vigente_actual.vigente_hasta = ahora
        db.flush()

    nuevo = SegmentoCliente(
        cliente_id=payload.cliente_id,
        segmento_codigo=payload.segmento_codigo,
        version_modelo_id=payload.version_modelo_id,
        frecuencia_snapshot=payload.frecuencia_snapshot,
        margen_snapshot=payload.margen_snapshot,
        recencia_dias_snapshot=payload.recencia_dias_snapshot,
        tamano_muestra=payload.tamano_muestra,
        periodo_inicio=payload.periodo_inicio,
        periodo_fin=payload.periodo_fin,
        fecha_calculo=ahora,
    )
    db.add(nuevo)
    db.commit()
    db.refresh(nuevo)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="registrar_segmento",
        recurso="cliente",
        recurso_id=payload.cliente_id,
        exitoso=True,
        request=request,
        detalle={"segmento_codigo": payload.segmento_codigo, "version_modelo_id": payload.version_modelo_id},
    )
    return nuevo


@router.get("/clientes/{cliente_id}/segmento/historial", response_model=list[SegmentoOut], tags=["fidelizacion"])
def consultar_historial_segmento(
    cliente_id: int,
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(require_permission("churn", "leer")),
) -> list[SegmentoCliente]:
    _get_cliente_o_404(db, cliente_id)
    return (
        db.query(SegmentoCliente)
        .filter(SegmentoCliente.cliente_id == cliente_id)
        .order_by(SegmentoCliente.fecha_calculo.asc())
        .all()
    )


@router.get("/catalogos/segmentos", response_model=list[SegmentoCatalogoOut], tags=["catalogos"])
def listar_segmentos(
    solo_activos: bool = Query(True),
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(get_current_user),
) -> list[Segmento]:
    query = db.query(Segmento)
    if solo_activos:
        query = query.filter(Segmento.activo.is_(True))
    return query.order_by(Segmento.prioridad_comercial).all()


# ---------------------------------------------------------------------------
# Riesgo de abandono (churn) y campañas de recuperación (RF-CF-004 a 006)
# ---------------------------------------------------------------------------


@router.get("/clientes/{cliente_id}/riesgo-abandono", response_model=EvaluacionChurnConsultaOut, tags=["fidelizacion"])
def consultar_riesgo_abandono(
    cliente_id: int,
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(require_permission("churn", "leer")),
) -> EvaluacionChurnConsultaOut:
    _get_cliente_o_404(db, cliente_id)
    ultima = (
        db.query(EvaluacionChurn)
        .filter(EvaluacionChurn.cliente_id == cliente_id)
        .order_by(EvaluacionChurn.fecha_evaluacion.desc())
        .first()
    )
    if ultima is None:
        return EvaluacionChurnConsultaOut(datos_suficientes=False, evaluacion=None)
    return EvaluacionChurnConsultaOut(datos_suficientes=True, evaluacion=EvaluacionChurnOut.model_validate(ultima))


@router.post(
    "/fidelizacion/evaluaciones-churn",
    response_model=EvaluacionChurnOut,
    status_code=status.HTTP_201_CREATED,
    tags=["fidelizacion"],
)
def registrar_evaluacion_churn(
    payload: EvaluacionChurnCrearIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("churn", "crear")),
) -> EvaluacionChurn:
    _get_cliente_o_404(db, payload.cliente_id)

    evaluacion = EvaluacionChurn(
        cliente_id=payload.cliente_id,
        es_riesgo_real=payload.es_riesgo_real,
        dias_sin_compra_al_momento=payload.dias_sin_compra_al_momento,
        frecuencia_historica_dias=payload.frecuencia_historica_dias,
        justificacion=payload.justificacion,
        tamano_muestra=payload.tamano_muestra,
    )
    db.add(evaluacion)
    db.commit()
    db.refresh(evaluacion)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="registrar_evaluacion_churn",
        recurso="churn",
        recurso_id=evaluacion.id,
        exitoso=True,
        request=request,
    )
    return evaluacion


@router.post(
    "/fidelizacion/campanas-recuperacion",
    response_model=CampanaRecuperacionOut,
    status_code=status.HTTP_201_CREATED,
    tags=["fidelizacion"],
)
def registrar_campana_recuperacion(
    payload: CampanaRecuperacionCrearIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("churn", "crear")),
) -> CampanaRecuperacion:
    cliente = _get_cliente_o_404(db, payload.cliente_id)

    evaluacion = db.get(EvaluacionChurn, payload.evaluacion_churn_id)
    if evaluacion is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Evaluación de churn no encontrada")
    if evaluacion.cliente_id != payload.cliente_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "La evaluación de churn no pertenece a este cliente"
        )

    if payload.cupon_id is not None and db.get(Cupon, payload.cupon_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cupón no encontrado en 005-promociones-inteligentes")

    # RN-CF-005 (enmienda v1.2): una campaña de recuperación solo tiene sentido
    # contra un riesgo real — OO-FC08 del documento de objetivos define esta
    # operación explícitamente como "a un cliente en riesgo real", y OT2.5 pide
    # recuperar "sin descuentos innecesarios". Sin este guard, una evaluación
    # con es_riesgo_real=false (cliente en su ciclo normal) igual podía disparar
    # una campaña con cupón y correo real — exactamente el gasto de margen
    # contraproducente que el enunciado original advierte.
    if not evaluacion.es_riesgo_real:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "La evaluación de churn no marca riesgo real (es_riesgo_real=false) — "
            "no corresponde una campaña de recuperación (RN-CF-005)",
        )

    # RN-CF-001: si el cliente ya volvió a comprar solo desde la evaluación,
    # no hace falta campaña — se valida en servicio, no es un CHECK de fila.
    compra_posterior = (
        db.query(Venta)
        .filter(Venta.cliente_id == payload.cliente_id, Venta.fecha_hora > evaluacion.fecha_evaluacion)
        .first()
    )
    if compra_posterior is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "El cliente ya volvió a comprar desde su última evaluación de riesgo (RN-CF-001)"
        )

    campana = CampanaRecuperacion(
        cliente_id=payload.cliente_id,
        evaluacion_churn_id=payload.evaluacion_churn_id,
        cupon_id=payload.cupon_id,
        usuario_id=current_user.id,
    )
    db.add(campana)
    db.commit()
    db.refresh(campana)

    # Art. 8.4 — tercera alerta del artículo (además de las dos de
    # cupón, ver app/routers/promociones.py::registrar_cupon), envío real
    # nunca simulado, best-effort igual que ahí (Art. 8.6).
    try:
        enviado, detalle = notificar_campana_recuperacion(cliente, campana)
    except Exception as exc:
        enviado, detalle = False, f"error inesperado al notificar: {exc}"
    campana.notificacion_enviada = enviado
    campana.notificacion_detalle = detalle
    db.commit()
    db.refresh(campana)

    log_accion(
        db,
        usuario_id=current_user.id,
        accion="registrar_campana_recuperacion",
        recurso="churn",
        recurso_id=campana.id,
        exitoso=True,
        request=request,
        detalle={"notificacion_enviada": enviado},
    )
    return campana


@router.get(
    "/fidelizacion/campanas-recuperacion/{campana_id}/resultado",
    response_model=CampanaResultadoOut,
    tags=["fidelizacion"],
)
def consultar_resultado_campana(
    campana_id: int,
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(require_permission("churn", "leer")),
) -> CampanaResultadoOut:
    campana = db.get(CampanaRecuperacion, campana_id)
    if campana is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Campaña no encontrada")

    compra_posterior = (
        db.query(Venta)
        .filter(Venta.cliente_id == campana.cliente_id, Venta.fecha_hora > campana.fecha_envio)
        .order_by(Venta.fecha_hora.asc())
        .first()
    )
    return CampanaResultadoOut(
        campana_id=campana.id,
        recupero_actividad=compra_posterior is not None,
        fecha_compra_posterior=compra_posterior.fecha_hora if compra_posterior is not None else None,
    )
