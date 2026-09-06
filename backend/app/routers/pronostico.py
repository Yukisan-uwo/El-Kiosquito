"""
Router del módulo 004-pronostico-demanda — demanda insatisfecha (quiebre
de stock capturado en el POS), ciclos de pronóstico calculados por el
modelo de series de tiempo, y el catálogo de eventos locales usado como
feature al entrenarlo. Implementa el contrato
el-kiosquito-004-pronostico-demanda-contracts-openapi.yaml.

RBAC: la matriz real de 004 solo tiene 2 recursos — `demanda` (cubre a la
vez `demanda_insatisfecha` y `pronostico_demanda`: ambas son append-only,
ningún rol tiene `actualizar`) y `evento_local`. El contrato marca
`POST /pronostico/ciclos` como `security:[sistema]` (el pipeline batch del
modelo, no una persona) — igual que en 002/003, se autoriza contra la
matriz real (`demanda`/`crear`); a diferencia de esos módulos, acá
`crear` sobre `demanda` también lo tienen cajero y encargado_sucursal
(quienes registran quiebres de stock en el POS), así que en la práctica
cualquiera de esos dos roles también podría invocar este endpoint por la
API — es una consecuencia de que la matriz sembrada modela `demanda` como
un solo recurso para las dos tablas, no una restricción adicional que
este router deba inventar por su cuenta (RN-AD-004: nunca hardcodear
un código de rol en el router).
"""

from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, log_accion, require_permission
from app.database import get_db
from app.models.administracion import Usuario
from app.models.core_ventas import Producto
from app.models.expansion import Sucursal
from app.models.pronostico import DemandaInsatisfecha, EventoLocal, PronosticoDemanda, TipoEventoLocal
from app.schemas.pronostico import (
    DemandaInsatisfechaCrearIn,
    DemandaInsatisfechaOut,
    EventoLocalCrearIn,
    EventoLocalOut,
    PronosticoConsultaOut,
    PronosticoCrearIn,
    PronosticoOut,
    TipoEventoLocalOut,
)
from app.services.scoping import verificar_alcance_sucursal

router = APIRouter()


# ---------------------------------------------------------------------------
# Demanda insatisfecha (RF-PD-001 a 003, 006)
# ---------------------------------------------------------------------------


@router.post(
    "/pronostico/demanda-insatisfecha",
    response_model=DemandaInsatisfechaOut,
    status_code=status.HTTP_201_CREATED,
    tags=["pronostico"],
)
def registrar_demanda_insatisfecha(
    payload: DemandaInsatisfechaCrearIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("demanda", "crear")),
) -> DemandaInsatisfecha:
    if db.get(Producto, payload.producto_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Producto no encontrado")
    if db.get(Sucursal, payload.sucursal_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sucursal no encontrada")
    verificar_alcance_sucursal(db, current_user, payload.sucursal_id)

    if payload.sustituto_ofrecido_id is not None and db.get(Producto, payload.sustituto_ofrecido_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "sustituto_ofrecido_id no encontrado")

    evento = DemandaInsatisfecha(
        producto_id=payload.producto_id,
        sucursal_id=payload.sucursal_id,
        cajero_id=current_user.id,
        hora_evento=payload.hora_evento,
        sustituto_ofrecido_id=payload.sustituto_ofrecido_id,
        sustituto_aceptado=payload.sustituto_aceptado,
    )
    db.add(evento)
    db.commit()
    db.refresh(evento)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="registrar_demanda_insatisfecha",
        recurso="demanda",
        recurso_id=evento.id,
        sucursal_id=payload.sucursal_id,
        exitoso=True,
        request=request,
    )
    return evento


@router.get(
    "/pronostico/demanda-insatisfecha",
    response_model=list[DemandaInsatisfechaOut],
    tags=["pronostico"],
)
def consultar_demanda_insatisfecha(
    producto_id: int = Query(...),
    sucursal_id: int = Query(...),
    desde: date = Query(...),
    hasta: date = Query(...),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("demanda", "leer")),
) -> list[DemandaInsatisfecha]:
    if db.get(Producto, producto_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Producto no encontrado")
    verificar_alcance_sucursal(db, current_user, sucursal_id)

    inicio = datetime.combine(desde, datetime.min.time())
    fin = datetime.combine(hasta, datetime.max.time())
    return (
        db.query(DemandaInsatisfecha)
        .filter(
            DemandaInsatisfecha.producto_id == producto_id,
            DemandaInsatisfecha.sucursal_id == sucursal_id,
            DemandaInsatisfecha.hora_evento >= inicio,
            DemandaInsatisfecha.hora_evento <= fin,
        )
        .order_by(DemandaInsatisfecha.hora_evento.asc())
        .all()
    )


# ---------------------------------------------------------------------------
# Pronóstico de demanda — append-only (RF-PD-004, 005, RNF-PD-002)
# ---------------------------------------------------------------------------


@router.post(
    "/pronostico/ciclos",
    response_model=PronosticoOut,
    status_code=status.HTTP_201_CREATED,
    tags=["pronostico"],
)
def registrar_ciclo_pronostico(
    payload: PronosticoCrearIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("demanda", "crear")),
) -> PronosticoDemanda:
    if db.get(Producto, payload.producto_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Producto no encontrado")
    if db.get(Sucursal, payload.sucursal_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sucursal no encontrada")
    if payload.periodo_inicio > payload.periodo_fin:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "periodo_inicio no puede ser posterior a periodo_fin")

    ciclo = PronosticoDemanda(
        producto_id=payload.producto_id,
        sucursal_id=payload.sucursal_id,
        cantidad_recomendada=payload.cantidad_recomendada,
        tamano_muestra=payload.tamano_muestra,
        periodo_inicio=payload.periodo_inicio,
        periodo_fin=payload.periodo_fin,
    )
    db.add(ciclo)
    db.commit()
    db.refresh(ciclo)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="registrar_ciclo_pronostico",
        recurso="demanda",
        recurso_id=ciclo.id,
        sucursal_id=payload.sucursal_id,
        exitoso=True,
        request=request,
    )
    return ciclo


# ---------------------------------------------------------------------------
# Eventos locales (RF-PD-007 a 010, enmienda v1.1/v1.2)
#
# Registradas ANTES de `GET /pronostico/{producto_id}` a propósito: Starlette
# resuelve las rutas en el orden en que se agregan al router, y un segmento
# literal ("eventos-locales") nunca debe quedar detrás de un parámetro de
# ruta ({producto_id}) del mismo prefijo — si no, el parámetro lo captura
# primero y "eventos-locales" llega como si fuera un producto_id (fallaba
# con 422 de int_parsing al probar esto contra Postgres real).
# ---------------------------------------------------------------------------


@router.post(
    "/pronostico/eventos-locales",
    response_model=EventoLocalOut,
    status_code=status.HTTP_201_CREATED,
    tags=["pronostico"],
)
def registrar_evento_local(
    payload: EventoLocalCrearIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("evento_local", "crear")),
) -> EventoLocal:
    if db.get(TipoEventoLocal, payload.tipo) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"tipo '{payload.tipo}' no existe en el catálogo")

    if payload.sucursal_id is not None:
        if db.get(Sucursal, payload.sucursal_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Sucursal no encontrada")
        verificar_alcance_sucursal(db, current_user, payload.sucursal_id)
    # sucursal_id None = afecta a toda la cadena (feriado nacional); no
    # requiere scoping porque no restringe a ninguna sucursal en particular.

    evento = EventoLocal(
        sucursal_id=payload.sucursal_id,
        fecha_inicio=payload.fecha_inicio,
        fecha_fin=payload.fecha_fin,
        tipo=payload.tipo,
        descripcion=payload.descripcion,
        registrado_por=current_user.id,
    )
    db.add(evento)
    db.commit()
    db.refresh(evento)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="registrar_evento_local",
        recurso="evento_local",
        recurso_id=evento.id,
        sucursal_id=payload.sucursal_id,
        exitoso=True,
        request=request,
    )
    return evento


@router.get("/pronostico/eventos-locales", response_model=list[EventoLocalOut], tags=["pronostico"])
def consultar_eventos_locales(
    desde: date = Query(...),
    hasta: date = Query(...),
    sucursal_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("evento_local", "leer")),
) -> list[EventoLocal]:
    # Solapamiento de rango: el evento se solapa con [desde, hasta] si
    # empieza antes de que termine la ventana y termina después de que
    # empiece — no exige que quede completamente contenido en ella.
    query = db.query(EventoLocal).filter(EventoLocal.fecha_inicio <= hasta, EventoLocal.fecha_fin >= desde)

    if sucursal_id is not None:
        if db.get(Sucursal, sucursal_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Sucursal no encontrada")
        verificar_alcance_sucursal(db, current_user, sucursal_id)
        # Si se filtra por sucursal: los propios de esa sucursal + los de
        # toda la cadena (sucursal_id NULL) — un evento de cadena aplica
        # igual a cualquier sucursal.
        query = query.filter((EventoLocal.sucursal_id == sucursal_id) | (EventoLocal.sucursal_id.is_(None)))

    return query.order_by(EventoLocal.fecha_inicio.asc()).all()


@router.get("/catalogos/tipos-evento-local", response_model=list[TipoEventoLocalOut], tags=["catalogos"])
def listar_tipos_evento_local(
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(get_current_user),
) -> list[TipoEventoLocal]:
    return db.query(TipoEventoLocal).order_by(TipoEventoLocal.orden).all()


@router.get("/pronostico/{producto_id}", response_model=PronosticoConsultaOut, tags=["pronostico"])
def consultar_pronostico_reciente(
    producto_id: int,
    sucursal_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("demanda", "leer")),
) -> PronosticoConsultaOut:
    if db.get(Producto, producto_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Producto no encontrado")
    verificar_alcance_sucursal(db, current_user, sucursal_id)

    # RN-PD-001: siempre el más reciente por fecha_calculo, nunca un
    # promedio ni una interpolación entre ciclos.
    reciente = (
        db.query(PronosticoDemanda)
        .filter(PronosticoDemanda.producto_id == producto_id, PronosticoDemanda.sucursal_id == sucursal_id)
        .order_by(PronosticoDemanda.fecha_calculo.desc())
        .first()
    )
    if reciente is None:
        return PronosticoConsultaOut(datos_suficientes=False, pronostico=None)
    return PronosticoConsultaOut(datos_suficientes=True, pronostico=PronosticoOut.model_validate(reciente))
