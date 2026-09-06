"""
Router del módulo 007-pagos-seguridad — catálogo de datáfonos por
sucursal y su historial append-only de revisiones de seguridad.
Implementa el contrato el-kiosquito-007-pagos-seguridad-contracts-
openapi.yaml.

No comparte tablas con 006-caja-mermas-fraude (Decisión 1 de su
research.md): ese módulo investiga fraude en una transacción puntual,
este vigila que el hardware de cobro esté al día en seguridad,
independientemente de que haya pasado o no un incidente.

RBAC: la matriz real de 007 tiene un solo recurso, `datafono`, que
cubre las tres tablas del módulo (`datafono`, `revision_datafono` y el
catálogo `estado_revision` de solo lectura). El contrato marca los
endpoints con roles ilustrativos (`prevencion_perdidas`,
`encargado_sucursal`, `gerencia`) que no son roles reales del sistema
— se autorizó contra la matriz real: dueño y encargado_sucursal tienen
CRUD completo sobre `datafono` (dan de alta terminales y registran
revisiones), encargado_compras solo lee, cajero no tiene acceso en
absoluto (RNF de seguridad, no es parte de su operación diaria en el
POS). `POST /datafonos/{id}/revisiones` se autorizó contra
`datafono`/`crear` — mismo criterio que los checkpoints de turno en
006: una sub-tabla append-only nueva no tiene su propio recurso en la
matriz sembrada, así que hereda el verbo `crear` de su tabla dueña.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, log_accion, require_permission
from app.database import get_db
from app.models.administracion import Usuario
from app.models.core_ventas import Venta
from app.models.expansion import Sucursal
from app.models.pagos import Datafono, EstadoRevision, RevisionDatafono
from app.schemas.pagos import (
    ConformidadSucursalOut,
    DatafonoCrearIn,
    DatafonoDisponibleOut,
    DatafonoOut,
    EstadoDatafonoOut,
    EstadoRevisionOut,
    RevisionDatafonoCrearIn,
    RevisionDatafonoOut,
    VentaConEstadoRevisionOut,
)
from app.services.scoping import verificar_alcance_sucursal

router = APIRouter()


def _ultima_revision_por_datafono(db: Session, sucursal_id: int) -> dict[int, RevisionDatafono]:
    """Una fila por datáfono con su revisión más reciente (RF-PS-004),
    calculada en el momento de la consulta — nunca cacheada (RNF-PS-001).
    `DISTINCT ON` es específico de PostgreSQL, el motor real del proyecto."""
    ultimas = (
        db.query(RevisionDatafono)
        .join(Datafono, RevisionDatafono.datafono_id == Datafono.id)
        .filter(Datafono.sucursal_id == sucursal_id)
        .order_by(RevisionDatafono.datafono_id, RevisionDatafono.fecha_revision.desc())
        .distinct(RevisionDatafono.datafono_id)
        .all()
    )
    return {r.datafono_id: r for r in ultimas}


@router.post("/datafonos", response_model=DatafonoOut, status_code=status.HTTP_201_CREATED, tags=["pagos-seguridad"])
def registrar_datafono(
    payload: DatafonoCrearIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("datafono", "crear")),
) -> Datafono:
    if db.get(Sucursal, payload.sucursal_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sucursal no encontrada")
    verificar_alcance_sucursal(db, current_user, payload.sucursal_id)

    # RNF-PS-002: único en todo el sistema, no solo dentro de la sucursal
    # — se valida acá para devolver 422 en vez de que el UNIQUE de BD
    # dispare una IntegrityError 500.
    if db.query(Datafono).filter(Datafono.codigo_serie == payload.codigo_serie).first() is not None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"codigo_serie '{payload.codigo_serie}' ya está registrado (RNF-PS-002)",
        )

    datafono = Datafono(sucursal_id=payload.sucursal_id, codigo_serie=payload.codigo_serie, activo=True)
    db.add(datafono)
    db.commit()
    db.refresh(datafono)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="registrar_datafono",
        recurso="datafono",
        recurso_id=datafono.id,
        sucursal_id=payload.sucursal_id,
        exitoso=True,
        request=request,
        detalle={"codigo_serie": payload.codigo_serie},
    )
    return datafono


@router.patch("/datafonos/{id}/baja", response_model=DatafonoOut, tags=["pagos-seguridad"])
def dar_de_baja_datafono(
    id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("datafono", "actualizar")),
) -> Datafono:
    datafono = db.get(Datafono, id)
    if datafono is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Datáfono no encontrado")
    verificar_alcance_sucursal(db, current_user, datafono.sucursal_id)

    if not datafono.activo:
        raise HTTPException(status.HTTP_409_CONFLICT, "El datáfono ya está dado de baja")

    # RF-PS-002: solo cambia `activo` — su historial de revisiones (tabla
    # aparte, append-only) nunca se toca ni se borra.
    datafono.activo = False
    db.commit()
    db.refresh(datafono)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="dar_de_baja_datafono",
        recurso="datafono",
        recurso_id=datafono.id,
        sucursal_id=datafono.sucursal_id,
        exitoso=True,
        request=request,
    )
    return datafono


@router.post(
    "/datafonos/{id}/revisiones",
    response_model=RevisionDatafonoOut,
    status_code=status.HTTP_201_CREATED,
    tags=["pagos-seguridad"],
)
def registrar_revision_datafono(
    id: int,
    payload: RevisionDatafonoCrearIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("datafono", "crear")),
) -> RevisionDatafono:
    datafono = db.get(Datafono, id)
    if datafono is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Datáfono no encontrado")
    verificar_alcance_sucursal(db, current_user, datafono.sucursal_id)

    if db.get(EstadoRevision, payload.estado) is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, f"estado '{payload.estado}' no existe en el catálogo estado_revision"
        )

    # RNF-PS-001: append-only estricto — siempre INSERT, nunca se toca una
    # revisión anterior, ni siquiera para "corregirla".
    revision = RevisionDatafono(
        datafono_id=id,
        estado=payload.estado,
        observaciones=payload.observaciones,
        revisado_por=current_user.id,
    )
    db.add(revision)
    db.commit()
    db.refresh(revision)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="registrar_revision_datafono",
        recurso="datafono",
        recurso_id=id,
        sucursal_id=datafono.sucursal_id,
        exitoso=True,
        request=request,
        detalle={"estado": payload.estado},
    )
    return revision


@router.get("/datafonos/{id}/estado", response_model=EstadoDatafonoOut, tags=["pagos-seguridad"])
def consultar_estado_datafono(
    id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("datafono", "leer")),
) -> EstadoDatafonoOut:
    datafono = db.get(Datafono, id)
    if datafono is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Datáfono no encontrado")
    verificar_alcance_sucursal(db, current_user, datafono.sucursal_id)

    ultima = (
        db.query(RevisionDatafono)
        .filter(RevisionDatafono.datafono_id == id)
        .order_by(RevisionDatafono.fecha_revision.desc())
        .first()
    )
    # RF-PS-005 / RN-PS-001: nunca se asume "actualizado" por defecto — un
    # datáfono sin revisión declara explícitamente `sin_revision=true`.
    return EstadoDatafonoOut(
        datafono_id=datafono.id,
        codigo_serie=datafono.codigo_serie,
        sin_revision=ultima is None,
        estado_vigente=ultima.estado if ultima is not None else None,
        fecha_ultima_revision=ultima.fecha_revision if ultima is not None else None,
    )


@router.get(
    "/datafonos/{id}/ventas",
    response_model=list[VentaConEstadoRevisionOut],
    tags=["pagos-seguridad"],
)
def consultar_ventas_datafono(
    id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("datafono", "leer")),
) -> list[VentaConEstadoRevisionOut]:
    """Enmienda v1.2 (auditoría de riesgos derivados): la trazabilidad
    real que faltaba. Antes de `venta.datafono_id` (001, enmienda v1.5)
    no había forma de responder "¿qué ventas cobró este datáfono, y
    estaba al día en seguridad cuando las cobró?" — exactamente lo que
    hace falta ante una disputa o una investigación de fraude
    (alerta_fraude_pago, 006)."""

    datafono = db.get(Datafono, id)
    if datafono is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Datáfono no encontrado")
    verificar_alcance_sucursal(db, current_user, datafono.sucursal_id)

    ventas = (
        db.query(Venta)
        .filter(Venta.datafono_id == id)
        .order_by(Venta.fecha_hora.desc())
        .all()
    )

    resultado = []
    for venta in ventas:
        # Estado del datáfono VIGENTE EN LA FECHA DE ESA VENTA, nunca el
        # estado actual — mismo criterio que el join lateral de
        # segmento_cliente contra evaluacion_churn en etl/ml/churn.py.
        revision_al_momento = (
            db.query(RevisionDatafono)
            .filter(
                RevisionDatafono.datafono_id == id,
                RevisionDatafono.fecha_revision <= venta.fecha_hora,
            )
            .order_by(RevisionDatafono.fecha_revision.desc())
            .first()
        )
        resultado.append(
            VentaConEstadoRevisionOut(
                venta_id=venta.id,
                numero_documento=venta.numero_documento,
                fecha_hora=venta.fecha_hora,
                total=venta.total,
                sin_revision_al_momento=revision_al_momento is None,
                estado_revision_al_momento=revision_al_momento.estado if revision_al_momento is not None else None,
            )
        )
    return resultado


@router.get(
    "/sucursales/{sucursal_id}/datafonos", response_model=list[EstadoDatafonoOut], tags=["pagos-seguridad"]
)
def listar_datafonos_sucursal(
    sucursal_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("datafono", "leer")),
) -> list[EstadoDatafonoOut]:
    if db.get(Sucursal, sucursal_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sucursal no encontrada")
    verificar_alcance_sucursal(db, current_user, sucursal_id)

    # Solo los terminales activos: uno dado de baja ya no es parte de la
    # infraestructura de cobro vigente que hay que vigilar (su historial
    # sigue disponible directo por /datafonos/{id}/estado).
    datafonos = (
        db.query(Datafono)
        .filter(Datafono.sucursal_id == sucursal_id, Datafono.activo.is_(True))
        .order_by(Datafono.id)
        .all()
    )
    mapa_ultima = _ultima_revision_por_datafono(db, sucursal_id)

    return [
        EstadoDatafonoOut(
            datafono_id=d.id,
            codigo_serie=d.codigo_serie,
            sin_revision=mapa_ultima.get(d.id) is None,
            estado_vigente=mapa_ultima[d.id].estado if d.id in mapa_ultima else None,
            fecha_ultima_revision=mapa_ultima[d.id].fecha_revision if d.id in mapa_ultima else None,
        )
        for d in datafonos
    ]


@router.get(
    "/sucursales/{sucursal_id}/datafonos-disponibles",
    response_model=list[DatafonoDisponibleOut],
    tags=["pagos-seguridad"],
)
def listar_datafonos_disponibles(
    sucursal_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("datafono_venta", "leer")),
) -> list[DatafonoDisponibleOut]:
    """RF-PS-013 (enmienda v1.1, 2026-09-06). Hueco encontrado al construir
    el checkout real del POS del cajero (Tarea #55): `POST /ventas` de
    001-core-ventas-inventario exige `datafono_id` para un pago con tarjeta
    cuando la sucursal tiene terminales activos (RN-CVI-011), pero el rol
    `cajero` nunca tuvo `datafono`/`leer` — decisión explícita de este
    módulo (docstring del router: "el cajero no tiene por qué ver ni tocar
    esto, RNF de seguridad"). Sin poder listar los datáfonos de su propia
    sucursal, el cajero no tenía ninguna forma real de saber qué `id`
    numérico enviar.

    Recurso NUEVO y deliberadamente angosto (`datafono_venta`, no
    `datafono`): esta respuesta NUNCA incluye `sin_revision`,
    `estado_vigente` ni `fecha_ultima_revision` — ese estado de seguridad
    sigue siendo exclusivo de `GET /sucursales/{id}/datafonos`, bajo
    `datafono`/`leer`, que el cajero sigue sin poder leer. Preserva intacta
    la intención original del RNF mientras cierra el hueco real."""
    if db.get(Sucursal, sucursal_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sucursal no encontrada")
    verificar_alcance_sucursal(db, current_user, sucursal_id)

    datafonos = (
        db.query(Datafono)
        .filter(Datafono.sucursal_id == sucursal_id, Datafono.activo.is_(True))
        .order_by(Datafono.id)
        .all()
    )
    return [DatafonoDisponibleOut(id=d.id, codigo_serie=d.codigo_serie) for d in datafonos]


@router.get(
    "/sucursales/{sucursal_id}/datafonos/conformidad",
    response_model=ConformidadSucursalOut,
    tags=["pagos-seguridad"],
)
def consultar_conformidad_sucursal(
    sucursal_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("datafono", "leer")),
) -> ConformidadSucursalOut:
    if db.get(Sucursal, sucursal_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sucursal no encontrada")
    verificar_alcance_sucursal(db, current_user, sucursal_id)

    datafonos = db.query(Datafono).filter(Datafono.sucursal_id == sucursal_id, Datafono.activo.is_(True)).all()
    mapa_ultima = _ultima_revision_por_datafono(db, sucursal_id)

    total = len(datafonos)
    sin_revision = 0
    conformes = 0
    for d in datafonos:
        ultima = mapa_ultima.get(d.id)
        if ultima is None:
            # RN-PS-001 (enmienda v1.1): un terminal sin revisar nunca
            # cuenta como conforme — inflaría el KPI justo en el caso
            # más riesgoso.
            sin_revision += 1
            continue
        estado_cat = db.get(EstadoRevision, ultima.estado)
        # RN-PS-002: el numerador se lee de `cuenta_como_conforme`, nunca
        # de comparar contra el literal 'actualizado'.
        if estado_cat is not None and estado_cat.cuenta_como_conforme:
            conformes += 1

    porcentaje = round((conformes / total) * 100, 2) if total > 0 else 0.0

    return ConformidadSucursalOut(
        terminales_totales=total,
        terminales_conformes=conformes,
        terminales_sin_revision=sin_revision,
        porcentaje_conformes=porcentaje,
    )


# ---------------------------------------------------------------------------
# Catálogos (RF-PS-007, enmienda v1.1) — solo lectura, cualquier usuario autenticado
# ---------------------------------------------------------------------------


@router.get("/catalogos/estados-revision", response_model=list[EstadoRevisionOut], tags=["catalogos"])
def listar_estados_revision(
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(get_current_user),
) -> list[EstadoRevision]:
    return db.query(EstadoRevision).order_by(EstadoRevision.orden).all()
