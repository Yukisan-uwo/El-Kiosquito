"""
Router del módulo 006-caja-mermas-fraude — turno de caja con cuadre,
mermas (con causa e investigación opcionales), incidencias de cuadre
detectadas por el modelo de anomalías, alertas de fraude en pago (única
tabla del proyecto escrita por dos módulos — ver docstring de
`app/models/caja.py`), y los puntos de control horario de un turno
abierto. Implementa el contrato
el-kiosquito-006-caja-mermas-fraude-contracts-openapi.yaml.

RBAC: la matriz real de 006 tiene 4 recursos — `turno_caja`, `merma`,
`incidencia_cuadre`, `alerta_fraude`. Dos particularidades frente al
contrato:
- `turno_caja.crear`/`actualizar` **solo** los tiene `cajero` (ni
  siquiera `encargado_sucursal`, que el contrato sí lista) — se autoriza
  contra la matriz real de todos modos (RN-AD-004). El mismo recurso
  cubre `POST /caja/turnos/{id}/checkpoints` (el contrato lo marca
  `security:[Sistema]`): en la matriz sembrada no hay un recurso propio
  para "punto de control", así que reutiliza `turno_caja`/`crear` —
  documentado, no inventado por este router.
- `incidencia_cuadre.crear` y `alerta_fraude.crear` están en `false`
  para los 4 roles reales — a diferencia de los endpoints `[Sistema]` de
  otros módulos (002/003/004/005), donde algún rol humano sí terminaba
  cubriendo la cuenta de servicio, acá NINGÚN rol puede crearlas por la
  API. Es coherente con lo que son: `incidencia_cuadre` la genera
  exclusivamente el modelo de detección de anomalías, y
  `alerta_fraude_pago` la inserta el propio proceso de 001 al procesar
  un pago (no un humano vía HTTP) — ambos endpoints quedan modelados
  igual que el resto (nunca un código de rol hardcodeado), simplemente
  no hay hoy una cuenta humana que los pueda invocar.
"""

from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, log_accion, require_permission
from app.database import get_db
from app.models.administracion import Usuario
from app.models.caja import (
    AlertaFraudePago,
    ArqueoParcialTurno,
    CausaMerma,
    EstadoAlerta,
    EstadoIncidencia,
    EstadoTurno,
    IncidenciaCuadreCaja,
    Merma,
    PuntoControlHorarioTurno,
    ResultadoInvestigacion,
    TurnoCaja,
)
from app.models.core_ventas import EstadoVenta, Producto, Venta
from app.models.expansion import Sucursal
from app.schemas.caja import (
    AlertaFraudeCrearIn,
    AlertaFraudeOut,
    ArqueoParcialCrearIn,
    ArqueoParcialOut,
    CausaMermaOut,
    EstadoAlertaOut,
    EstadoIncidenciaOut,
    EstadoTurnoOut,
    IncidenciaCuadreCrearIn,
    IncidenciaCuadreOut,
    MermaCausaIn,
    MermaCrearIn,
    MermaOut,
    MermaResultadoIn,
    PuntoControlOut,
    ResultadoInvestigacionOut,
    TurnoCajaCerrarIn,
    TurnoCajaCrearIn,
    TurnoCajaOut,
)
from app.services.scoping import verificar_alcance_sucursal

router = APIRouter()


def _money(x) -> Decimal:
    return Decimal(str(x)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _monto_esperado_actual(db: Session, turno: TurnoCaja) -> Decimal:
    """`monto_inicial` + ventas en efectivo del turno que cuentan para
    ingresos (una anulada no debe sumar) — mismo cálculo tanto al cerrar
    el turno como al generar un punto de control a mitad de turno."""

    total_efectivo = (
        db.query(func.coalesce(func.sum(Venta.total), 0))
        .join(EstadoVenta, Venta.estado_venta == EstadoVenta.codigo)
        .filter(
            Venta.turno_caja_id == turno.id,
            Venta.metodo_pago == "efectivo",
            EstadoVenta.cuenta_para_ingresos.is_(True),
        )
        .scalar()
    )
    return _money(Decimal(str(turno.monto_inicial)) + Decimal(str(total_efectivo)))


# ---------------------------------------------------------------------------
# Turno de caja (RF-CMF-001 a 004, RN-CMF-001, RN-CMF-002)
# ---------------------------------------------------------------------------


@router.post("/caja/turnos", response_model=TurnoCajaOut, status_code=status.HTTP_201_CREATED, tags=["caja"])
def abrir_turno(
    payload: TurnoCajaCrearIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("turno_caja", "crear")),
) -> TurnoCaja:
    if db.get(Sucursal, payload.sucursal_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sucursal no encontrada")
    verificar_alcance_sucursal(db, current_user, payload.sucursal_id)

    turno = TurnoCaja(
        sucursal_id=payload.sucursal_id,
        cajero_id=current_user.id,
        monto_inicial=payload.monto_inicial,
        estado="abierto",
    )
    db.add(turno)
    try:
        db.commit()
    except IntegrityError:
        # RN-CMF-001, respaldado por ux_turno_cajero_abierto.
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "El cajero ya tiene un turno abierto (RN-CMF-001)")
    db.refresh(turno)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="abrir_turno",
        recurso="turno_caja",
        recurso_id=turno.id,
        sucursal_id=payload.sucursal_id,
        exitoso=True,
        request=request,
    )
    return turno


@router.get("/caja/turnos/actual", response_model=TurnoCajaOut, tags=["caja"])
def consultar_turno_actual(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("turno_caja", "leer")),
) -> TurnoCaja:
    """RF-CMF-018 (enmienda v1.3, 2026-09-06). Hueco real encontrado al
    construir el POS del cajero: antes de esto, 006 solo exponía
    POST /caja/turnos (abrir, 409 si ya hay uno abierto — pero el cuerpo
    del 409 es un `Error{detail: string}`, nunca el `id` del turno
    existente) y PATCH .../cerrar (requiere ya saber el `id`). No había
    ninguna forma de que el POS supiera, al cargar o recargar la página,
    si el cajero ya tenía un turno abierto ni cuál era su `id` —
    imprescindible porque `POST /ventas` de 001 exige `turno_caja_id`.
    Devuelve el turno `abierto` del propio cajero autenticado (nunca el
    de otro usuario — no acepta parámetros, se resuelve por el `sub` del
    JWT), o 404 si no tiene ninguno abierto en este momento."""
    turno = (
        db.query(TurnoCaja)
        .filter(TurnoCaja.cajero_id == current_user.id, TurnoCaja.estado == "abierto")
        .order_by(TurnoCaja.hora_apertura.desc())
        .first()
    )
    if turno is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No tenés un turno de caja abierto")
    return turno


@router.patch("/caja/turnos/{id}/cerrar", response_model=TurnoCajaOut, tags=["caja"])
def cerrar_turno(
    id: int,
    payload: TurnoCajaCerrarIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("turno_caja", "actualizar")),
) -> TurnoCaja:
    turno = db.get(TurnoCaja, id)
    if turno is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Turno no encontrado")
    if turno.estado == "cerrado":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "El turno ya está cerrado")
    verificar_alcance_sucursal(db, current_user, turno.sucursal_id)

    monto_esperado = _monto_esperado_actual(db, turno)
    monto_contado = _money(payload.monto_contado)
    diferencia_prevista = monto_contado - monto_esperado

    # RN-CMF-002: si va a quedar una diferencia, motivo_diferencia es
    # obligatorio — se valida antes de tocar la fila (el CHECK de BD
    # ck_turno_diferencia_requiere_motivo respalda esto igual, pero acá
    # se anticipa para devolver 422 con mensaje claro en vez de una
    # IntegrityError).
    if diferencia_prevista != 0 and not payload.motivo_diferencia:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "motivo_diferencia es obligatorio cuando monto_contado no coincide con el monto esperado (RN-CMF-002)",
        )

    turno.monto_contado = monto_contado
    turno.monto_esperado = monto_esperado
    turno.motivo_diferencia = payload.motivo_diferencia
    turno.estado = "cerrado"
    turno.hora_cierre = datetime.utcnow()
    db.commit()
    db.refresh(turno)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="cerrar_turno",
        recurso="turno_caja",
        recurso_id=turno.id,
        sucursal_id=turno.sucursal_id,
        exitoso=True,
        request=request,
        detalle={"monto_contado": str(monto_contado), "diferencia": str(diferencia_prevista)},
    )
    return turno


# ---------------------------------------------------------------------------
# Puntos de control horario (RF-CMF-012/013, enmienda v1.1, RN-CMF-006)
#
# Rutas literales bajo /caja/turnos/{id}/... no colisionan con
# /caja/turnos/{id}/cerrar (sufijos distintos) — a diferencia del bug de
# 004, acá no hay ambigüedad de segmento, así que el orden no importa. Se
# agrupan aquí solo por cercanía temática con turno_caja.
# ---------------------------------------------------------------------------


@router.post(
    "/caja/turnos/{turno_id}/checkpoints",
    response_model=PuntoControlOut,
    status_code=status.HTTP_201_CREATED,
    tags=["caja"],
)
def generar_checkpoint(
    turno_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("turno_caja", "crear")),
) -> PuntoControlHorarioTurno:
    turno = db.get(TurnoCaja, turno_id)
    if turno is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Turno no encontrado")
    if turno.estado != "abierto":
        raise HTTPException(
            status.HTTP_409_CONFLICT, "El turno ya no está abierto (no se generan checkpoints de turnos cerrados)"
        )

    checkpoint = PuntoControlHorarioTurno(
        turno_caja_id=turno_id,
        monto_esperado_acumulado=_monto_esperado_actual(db, turno),
    )
    db.add(checkpoint)
    db.commit()
    db.refresh(checkpoint)
    return checkpoint


@router.get(
    "/caja/turnos/{turno_id}/checkpoints",
    response_model=list[PuntoControlOut],
    tags=["caja"],
)
def consultar_checkpoints(
    turno_id: int,
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(require_permission("turno_caja", "leer")),
) -> list[PuntoControlHorarioTurno]:
    if db.get(TurnoCaja, turno_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Turno no encontrado")
    return (
        db.query(PuntoControlHorarioTurno)
        .filter(PuntoControlHorarioTurno.turno_caja_id == turno_id)
        .order_by(PuntoControlHorarioTurno.hora_checkpoint.asc())
        .all()
    )


# ---------------------------------------------------------------------------
# Arqueo parcial de turno — cuadre de caja realmente horario (enmienda
# 2026-09-05, auditoría de riesgos derivados). A diferencia de los
# checkpoints automáticos (solo monto esperado, sin conteo físico), esto
# registra un conteo real, voluntario — nunca un job obligatorio (la
# justificación de Decisión 5 de research.md sobre no imponer un conteo
# cada hora sigue vigente; esto agrega la posibilidad de hacerlo, no la
# obligación). Recurso RBAC propio (`arqueo_parcial`) porque, a diferencia
# de `turno_caja` (solo el cajero lo crea/cierra), acá tanto el cajero
# (contar su propia caja) como el encargado de sucursal (spot-check de
# supervisión) deben poder registrar uno.
# ---------------------------------------------------------------------------


@router.post(
    "/caja/turnos/{turno_id}/arqueos-parciales",
    response_model=ArqueoParcialOut,
    status_code=status.HTTP_201_CREATED,
    tags=["caja"],
)
def registrar_arqueo_parcial(
    turno_id: int,
    payload: ArqueoParcialCrearIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("arqueo_parcial", "crear")),
) -> ArqueoParcialTurno:
    turno = db.get(TurnoCaja, turno_id)
    if turno is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Turno no encontrado")
    if turno.estado != "abierto":
        raise HTTPException(status.HTTP_409_CONFLICT, "El turno ya no está abierto — un arqueo parcial solo tiene sentido a mitad de turno")
    verificar_alcance_sucursal(db, current_user, turno.sucursal_id)

    monto_esperado = _monto_esperado_actual(db, turno)
    monto_contado = _money(payload.monto_contado)
    diferencia_prevista = monto_contado - monto_esperado
    if diferencia_prevista != 0 and not payload.motivo_diferencia:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "motivo_diferencia es obligatorio cuando monto_contado no coincide con el monto esperado acumulado",
        )

    arqueo = ArqueoParcialTurno(
        turno_caja_id=turno_id,
        monto_esperado_acumulado=monto_esperado,
        monto_contado=monto_contado,
        motivo_diferencia=payload.motivo_diferencia,
        registrado_por=current_user.id,
    )
    db.add(arqueo)
    db.commit()
    db.refresh(arqueo)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="registrar_arqueo_parcial",
        recurso="arqueo_parcial",
        recurso_id=arqueo.id,
        sucursal_id=turno.sucursal_id,
        exitoso=True,
        request=request,
        detalle={"turno_caja_id": turno_id, "diferencia": str(diferencia_prevista)},
    )
    return arqueo


@router.get(
    "/caja/turnos/{turno_id}/arqueos-parciales",
    response_model=list[ArqueoParcialOut],
    tags=["caja"],
)
def consultar_arqueos_parciales(
    turno_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("arqueo_parcial", "leer")),
) -> list[ArqueoParcialTurno]:
    turno = db.get(TurnoCaja, turno_id)
    if turno is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Turno no encontrado")
    verificar_alcance_sucursal(db, current_user, turno.sucursal_id)
    return (
        db.query(ArqueoParcialTurno)
        .filter(ArqueoParcialTurno.turno_caja_id == turno_id)
        .order_by(ArqueoParcialTurno.hora_arqueo.asc())
        .all()
    )


# ---------------------------------------------------------------------------
# Mermas (RF-CMF-005 a 008, RN-CMF-003)
# ---------------------------------------------------------------------------


@router.post("/mermas", response_model=MermaOut, status_code=status.HTTP_201_CREATED, tags=["mermas"])
def registrar_merma(
    payload: MermaCrearIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("merma", "crear")),
) -> Merma:
    if db.get(Producto, payload.producto_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Producto no encontrado")
    if db.get(Sucursal, payload.sucursal_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sucursal no encontrada")
    verificar_alcance_sucursal(db, current_user, payload.sucursal_id)

    # RF-CMF-005: se registra sin exigir causa — quien la detecta no
    # siempre sabe todavía por qué ocurrió.
    merma = Merma(
        producto_id=payload.producto_id,
        sucursal_id=payload.sucursal_id,
        cantidad=payload.cantidad,
        valor_estimado=payload.valor_estimado,
        registrado_por=current_user.id,
    )
    db.add(merma)
    db.commit()
    db.refresh(merma)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="registrar_merma",
        recurso="merma",
        recurso_id=merma.id,
        sucursal_id=payload.sucursal_id,
        exitoso=True,
        request=request,
    )
    return merma


@router.get("/mermas", response_model=list[MermaOut], tags=["mermas"])
def consultar_mermas(
    sucursal_id: int | None = Query(default=None),
    desde: date | None = Query(default=None),
    hasta: date | None = Query(default=None),
    causa: str | None = Query(default=None),
    atribuible_a_persona: bool | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("merma", "leer")),
) -> list[Merma]:
    query = db.query(Merma)

    if sucursal_id is not None:
        if db.get(Sucursal, sucursal_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Sucursal no encontrada")
        verificar_alcance_sucursal(db, current_user, sucursal_id)
        query = query.filter(Merma.sucursal_id == sucursal_id)
    if desde is not None:
        query = query.filter(Merma.fecha_deteccion >= datetime.combine(desde, datetime.min.time()))
    if hasta is not None:
        query = query.filter(Merma.fecha_deteccion <= datetime.combine(hasta, datetime.max.time()))
    if causa is not None:
        query = query.filter(Merma.causa == causa)
    if atribuible_a_persona is not None:
        # RF-CMF-016: filtra por el atributo del catálogo, no por una
        # lista de códigos de causa enumerada a mano en el consumidor.
        query = query.join(CausaMerma, Merma.causa == CausaMerma.codigo).filter(
            CausaMerma.es_atribuible_a_persona.is_(atribuible_a_persona)
        )

    return query.order_by(Merma.fecha_deteccion.desc()).all()


@router.patch("/mermas/{id}/causa", response_model=MermaOut, tags=["mermas"])
def asignar_causa_merma(
    id: int,
    payload: MermaCausaIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("merma", "actualizar")),
) -> Merma:
    merma = db.get(Merma, id)
    if merma is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Merma no encontrada")
    if db.get(CausaMerma, payload.causa) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"causa '{payload.causa}' no existe en el catálogo")

    merma.causa = payload.causa
    db.commit()
    db.refresh(merma)
    log_accion(
        db, usuario_id=current_user.id, accion="asignar_causa_merma", recurso="merma",
        recurso_id=merma.id, exitoso=True, request=request, detalle={"causa": payload.causa},
    )
    return merma


@router.patch("/mermas/{id}/resultado", response_model=MermaOut, tags=["mermas"])
def registrar_resultado_investigacion(
    id: int,
    payload: MermaResultadoIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("merma", "actualizar")),
) -> Merma:
    merma = db.get(Merma, id)
    if merma is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Merma no encontrada")
    if db.get(ResultadoInvestigacion, payload.resultado_investigacion) is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, f"resultado_investigacion '{payload.resultado_investigacion}' no existe en el catálogo"
        )
    # RN-CMF-003: no se puede cerrar una investigación de una causa que
    # todavía no se asignó — respaldado por el CHECK ck_merma_resultado_
    # requiere_causa, validado acá primero para un 422 claro.
    if merma.causa is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "La merma no tiene causa asignada todavía (RN-CMF-003)"
        )

    merma.resultado_investigacion = payload.resultado_investigacion
    merma.fecha_resultado = datetime.utcnow()
    merma.investigado_por = current_user.id
    db.commit()
    db.refresh(merma)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="registrar_resultado_investigacion",
        recurso="merma",
        recurso_id=merma.id,
        exitoso=True,
        request=request,
        detalle={"resultado_investigacion": payload.resultado_investigacion},
    )
    return merma


# ---------------------------------------------------------------------------
# Incidencias de cuadre de caja (RF-CMF-009, RN-CMF-005)
# ---------------------------------------------------------------------------


@router.post(
    "/caja/incidencias-cuadre",
    response_model=IncidenciaCuadreOut,
    status_code=status.HTTP_201_CREATED,
    tags=["caja"],
)
def registrar_incidencia_cuadre(
    payload: IncidenciaCuadreCrearIn,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("incidencia_cuadre", "crear")),
) -> IncidenciaCuadreCaja:
    if db.get(TurnoCaja, payload.turno_caja_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Turno no encontrado")

    incidencia = IncidenciaCuadreCaja(
        turno_caja_id=payload.turno_caja_id,
        score_anomalia=payload.score_anomalia,
        justificacion=payload.justificacion,
        estado="pendiente",
    )
    db.add(incidencia)
    try:
        db.commit()
    except IntegrityError:
        # RN-CMF-005, respaldado por ux_incidencia_turno_pendiente.
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Ya existe una incidencia pendiente para este turno (RN-CMF-005)"
        )
    db.refresh(incidencia)
    return incidencia


# ---------------------------------------------------------------------------
# Alertas de fraude en pago (RF-CMF-010/011, RN-CMF-004)
# ---------------------------------------------------------------------------


@router.post(
    "/caja/alertas-fraude",
    response_model=AlertaFraudeOut,
    status_code=status.HTTP_201_CREATED,
    tags=["caja"],
)
def registrar_alerta_fraude(
    payload: AlertaFraudeCrearIn,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("alerta_fraude", "crear")),
) -> AlertaFraudePago:
    if db.get(Venta, payload.venta_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Venta no encontrada")

    alerta = AlertaFraudePago(
        venta_id=payload.venta_id,
        motivo=payload.motivo,
        ultimos_4_digitos=payload.ultimos_4_digitos,
        codigo_respuesta_proveedor=payload.codigo_respuesta_proveedor,
        estado="abierta",
    )
    db.add(alerta)
    db.commit()
    db.refresh(alerta)
    return alerta


@router.patch("/caja/alertas-fraude/{id}/atender", response_model=AlertaFraudeOut, tags=["caja"])
def atender_alerta_fraude(
    id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("alerta_fraude", "actualizar")),
) -> AlertaFraudePago:
    alerta = db.get(AlertaFraudePago, id)
    if alerta is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alerta no encontrada")
    if alerta.estado == "atendida":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "La alerta ya estaba atendida (RN-CMF-004)")

    alerta.estado = "atendida"
    alerta.atendida_en = datetime.utcnow()
    alerta.atendida_por = current_user.id
    db.commit()
    db.refresh(alerta)
    log_accion(
        db, usuario_id=current_user.id, accion="atender_alerta_fraude", recurso="alerta_fraude",
        recurso_id=alerta.id, exitoso=True, request=request,
    )
    return alerta


# ---------------------------------------------------------------------------
# Catálogos (RF-CMF-017, enmienda v1.2) — solo lectura, cualquier usuario autenticado
# ---------------------------------------------------------------------------


@router.get("/catalogos/causas-merma", response_model=list[CausaMermaOut], tags=["catalogos"])
def listar_causas_merma(
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(get_current_user),
) -> list[CausaMerma]:
    return db.query(CausaMerma).order_by(CausaMerma.orden).all()


@router.get("/catalogos/estados-turno", response_model=list[EstadoTurnoOut], tags=["catalogos"])
def listar_estados_turno(
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(get_current_user),
) -> list[EstadoTurno]:
    return db.query(EstadoTurno).order_by(EstadoTurno.orden).all()


@router.get("/catalogos/estados-incidencia", response_model=list[EstadoIncidenciaOut], tags=["catalogos"])
def listar_estados_incidencia(
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(get_current_user),
) -> list[EstadoIncidencia]:
    return db.query(EstadoIncidencia).order_by(EstadoIncidencia.orden).all()


@router.get("/catalogos/estados-alerta", response_model=list[EstadoAlertaOut], tags=["catalogos"])
def listar_estados_alerta(
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(get_current_user),
) -> list[EstadoAlerta]:
    return db.query(EstadoAlerta).order_by(EstadoAlerta.orden).all()


@router.get("/catalogos/resultados-investigacion", response_model=list[ResultadoInvestigacionOut], tags=["catalogos"])
def listar_resultados_investigacion(
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(get_current_user),
) -> list[ResultadoInvestigacion]:
    return db.query(ResultadoInvestigacion).order_by(ResultadoInvestigacion.orden).all()
