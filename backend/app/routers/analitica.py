"""
Router del módulo 011-analitica-reportes — ejecuciones del pipeline ETL
de Airflow (con su validación de calidad), versiones de los 5 modelos
de ML del Art. 5.6, y el log append-only de preguntas al asistente
conversacional (exclusivo del rol dueño). Implementa el contrato
el-kiosquito-011-analitica-reportes-contracts-openapi.yaml. Cierra el
ciclo de implementación de los 11 módulos.

RBAC: la matriz real tiene 3 recursos (`modelo_ml`, `pipeline_etl`,
`asistente`) — el contrato no declara `security:` por rol (solo
`bearerAuth`), así que se autorizó contra la matriz real: dueño tiene
`crear`+`leer` en los tres; encargado_compras/encargado_sucursal solo
`leer` en `modelo_ml`/`pipeline_etl` (analítica de dirección que les
sirve para decidir, pero no la disparan ni ven el asistente); cajero
sin acceso a ninguno (Art. 5.10 y RNF-AR-003 lo hacen, además,
dueño-exclusivo en `asistente` desde la propia matriz — no hay que
codificar el rol a mano, RN-AD-004). Ningún endpoint de este módulo usa
`verificar_alcance_sucursal`: a diferencia de los otros diez, no hay
una columna `sucursal_id` que scopear — es el primer módulo puramente
de cadena (analítica agregada, no operación de un local).

Sin `relationship()`, como el resto del proyecto — el único JOIN real
(estado de una versión de modelo) resuelve con `db.get()` sobre el
catálogo, no con navegación de atributo.
"""

from datetime import datetime

from clickhouse_driver.errors import Error as ErrorClickHouse
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.clickhouse import clickhouse_client_solo_lectura
from app.core.deps import get_current_user, log_accion, require_permission
from app.database import get_db
from app.models.administracion import Usuario
from app.models.analitica import (
    EjecucionPipelineEtl,
    EstadoEjecucion,
    EstadoVersionModelo,
    ModeloMl,
    PreguntaAsistente,
    ValidacionCalidadDatos,
    VersionModeloMl,
)
from app.schemas.analitica import (
    EjecucionPipelineIn,
    EjecucionPipelineOut,
    EstadoEjecucionOut,
    EstadoVersionModeloOut,
    MargenPorSucursalOut,
    MermaPorSucursalOut,
    ModeloMlOut,
    PreguntaAsistenteIn,
    PreguntaAsistenteOut,
    PreguntaAsistentePreguntarIn,
    TicketPromedioPorSucursalOut,
    ValidacionCalidadIn,
    ValidacionCalidadOut,
    VersionModeloIn,
    VersionModeloOut,
)
from app.services import asistente as servicio_asistente
from app.services import reportes_dashboard as servicio_reportes_dashboard
from app.services.asistente import ErrorAsistente

router = APIRouter()


# ---------------------------------------------------------------------------
# Pipeline ETL (OO-AR01, OO-AR02, OO-AR05)
# ---------------------------------------------------------------------------


@router.post(
    "/analitica/pipeline/ejecuciones",
    response_model=EjecucionPipelineOut,
    status_code=status.HTTP_201_CREATED,
    tags=["analitica-reportes"],
)
def registrar_ejecucion_pipeline(
    payload: EjecucionPipelineIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("pipeline_etl", "crear")),
) -> EjecucionPipelineEtl:
    if db.get(EstadoEjecucion, payload.estado) is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, f"estado '{payload.estado}' no existe en el catálogo estado_ejecucion"
        )

    # El DAG llama este mismo endpoint dos veces por corrida (al iniciar
    # y al finalizar, ver docstring de EjecucionPipelineEtl en el
    # modelo) — se distingue por `dag_run_id`, UNIQUE en la tabla.
    ejecucion = db.query(EjecucionPipelineEtl).filter(EjecucionPipelineEtl.dag_run_id == payload.dag_run_id).first()
    estado_cat = db.get(EstadoEjecucion, payload.estado)

    if ejecucion is None:
        ejecucion = EjecucionPipelineEtl(
            dag_run_id=payload.dag_run_id,
            fecha_inicio=datetime.utcnow(),
            fecha_fin=datetime.utcnow() if estado_cat.es_estado_final else None,
            estado=payload.estado,
            sucursales_procesadas=payload.sucursales_procesadas or 0,
            filas_cargadas=payload.filas_cargadas or 0,
            mensaje_error=payload.mensaje_error,
        )
        db.add(ejecucion)
    else:
        # Segunda llamada de la misma corrida: actualiza el mismo evento
        # de negocio, nunca crea una fila nueva (ver docstring del
        # modelo — no rompe el patrón append-only del resto del
        # proyecto: es un único evento con ciclo de vida corto y
        # cerrado por diseño, igual que orden_compra.estado en 008).
        ejecucion.estado = payload.estado
        if estado_cat.es_estado_final:
            ejecucion.fecha_fin = datetime.utcnow()
        if payload.sucursales_procesadas is not None:
            ejecucion.sucursales_procesadas = payload.sucursales_procesadas
        if payload.filas_cargadas is not None:
            ejecucion.filas_cargadas = payload.filas_cargadas
        if payload.mensaje_error is not None:
            ejecucion.mensaje_error = payload.mensaje_error

    db.commit()
    db.refresh(ejecucion)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="registrar_ejecucion_pipeline",
        recurso="pipeline_etl",
        recurso_id=ejecucion.id,
        exitoso=True,
        request=request,
        detalle={"dag_run_id": payload.dag_run_id, "estado": payload.estado},
    )
    return ejecucion


@router.get("/analitica/pipeline/estado", response_model=EjecucionPipelineOut, tags=["analitica-reportes"])
def consultar_estado_pipeline(
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(require_permission("pipeline_etl", "leer")),
) -> EjecucionPipelineEtl:
    ejecucion = db.query(EjecucionPipelineEtl).order_by(EjecucionPipelineEtl.fecha_inicio.desc()).first()
    if ejecucion is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Todavía no se registró ninguna ejecución del pipeline")
    return ejecucion


@router.post(
    "/analitica/pipeline/validaciones",
    response_model=ValidacionCalidadOut,
    status_code=status.HTTP_201_CREATED,
    tags=["analitica-reportes"],
)
def registrar_validacion_calidad(
    payload: ValidacionCalidadIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("pipeline_etl", "crear")),
) -> ValidacionCalidadDatos:
    if db.get(EjecucionPipelineEtl, payload.ejecucion_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ejecución de pipeline no encontrada")

    # Append-only estricto — siempre INSERT, nunca se corrige una
    # validación anterior.
    validacion = ValidacionCalidadDatos(
        ejecucion_id=payload.ejecucion_id,
        regla_validada=payload.regla_validada,
        aprobado=payload.aprobado,
        detalle=payload.detalle,
    )
    db.add(validacion)
    db.commit()
    db.refresh(validacion)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="registrar_validacion_calidad",
        recurso="pipeline_etl",
        recurso_id=validacion.id,
        exitoso=True,
        request=request,
        detalle={"ejecucion_id": payload.ejecucion_id, "regla_validada": payload.regla_validada},
    )
    return validacion


# ---------------------------------------------------------------------------
# Modelos de ML (OO-AR03, OO-AR04, Art. 5.6, Art. 5.9)
# ---------------------------------------------------------------------------


@router.post(
    "/analitica/modelos/versiones",
    response_model=VersionModeloOut,
    status_code=status.HTTP_201_CREATED,
    tags=["analitica-reportes"],
)
def registrar_version_modelo(
    payload: VersionModeloIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("modelo_ml", "crear")),
) -> VersionModeloMl:
    modelo_cat = db.get(ModeloMl, payload.modelo)
    if modelo_cat is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"modelo '{payload.modelo}' no existe en el catálogo modelo_ml")

    # RN-AR-004 (enmienda v1.1): la métrica reportada debe ser la
    # métrica principal de ESE modelo — nada impide, sin esto, registrar
    # el modelo de churn con una métrica de silueta que es de clustering.
    if payload.nombre_metrica != modelo_cat.metrica_principal:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"nombre_metrica '{payload.nombre_metrica}' no coincide con la métrica principal "
            f"del modelo '{payload.modelo}' ('{modelo_cat.metrica_principal}') — RN-AR-004",
        )

    # RN-AR-002: el umbral es por modelo (modelo_ml.tamano_muestra_minimo,
    # enmienda v1.1 — antes vivía en un diccionario en services/). Si no
    # se alcanza, la versión se descarta y Art. 5.9 exige documentar por
    # qué — el motivo se genera acá porque el contrato no lo recibe como
    # campo de entrada.
    datos_suficientes = payload.tamano_muestra >= modelo_cat.tamano_muestra_minimo
    if datos_suficientes:
        nuevo_estado = "activo"
        motivo = None
        valor_metrica = payload.valor_metrica
    else:
        nuevo_estado = "descartado_datos_insuficientes"
        motivo = (
            f"tamano_muestra={payload.tamano_muestra} inferior al mínimo exigido "
            f"({modelo_cat.tamano_muestra_minimo}) para el modelo '{payload.modelo}'"
        )
        valor_metrica = None  # RNF-AR-002: nunca se informa una métrica de un modelo que no se entrenó de verdad

    if nuevo_estado == "activo":
        # RN-AR-001 (índice único parcial `ux_version_modelo_activa`):
        # una sola versión activa por modelo — activar la nueva marca la
        # anterior 'reemplazado' en la MISMA transacción, nunca se borra.
        anterior_activa = (
            db.query(VersionModeloMl)
            .filter(VersionModeloMl.modelo == payload.modelo, VersionModeloMl.estado == "activo")
            .first()
        )
        if anterior_activa is not None:
            anterior_activa.estado = "reemplazado"

    version = VersionModeloMl(
        modelo=payload.modelo,
        version=payload.version,
        estado=nuevo_estado,
        tamano_muestra=payload.tamano_muestra,
        periodo_inicio=payload.periodo_inicio,
        periodo_fin=payload.periodo_fin,
        nombre_metrica=payload.nombre_metrica,
        valor_metrica=valor_metrica,
        motivo=motivo,
    )
    db.add(version)
    db.commit()
    db.refresh(version)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="registrar_version_modelo",
        recurso="modelo_ml",
        recurso_id=version.id,
        exitoso=True,
        request=request,
        detalle={"modelo": payload.modelo, "estado": nuevo_estado, "tamano_muestra": payload.tamano_muestra},
    )
    return version


@router.get(
    "/analitica/modelos/{modelo}/metricas",
    response_model=VersionModeloOut,
    tags=["analitica-reportes"],
)
def consultar_metricas_modelo_activo(
    modelo: str,
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(require_permission("modelo_ml", "leer")),
) -> VersionModeloMl:
    if db.get(ModeloMl, modelo) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"modelo '{modelo}' no existe en el catálogo modelo_ml")

    # `es_version_servible`: solo la 'activo' responde consultas — una
    # 'descartado_datos_insuficientes' es registro de honestidad
    # (Art. 5.9), no algo que sirva predicciones (RN-AR-001/data-model).
    version = (
        db.query(VersionModeloMl)
        .filter(VersionModeloMl.modelo == modelo, VersionModeloMl.estado == "activo")
        .first()
    )
    if version is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"Ningún modelo activo para '{modelo}' todavía (descartado por datos insuficientes o nunca entrenado)",
        )
    return version


# ---------------------------------------------------------------------------
# Asistente conversacional (OO-AR06, OO-AR07, Art. 5.10) — dueño-exclusivo
# ---------------------------------------------------------------------------


def _persistir_pregunta(
    db: Session,
    request: Request,
    current_user: Usuario,
    *,
    pregunta_texto: str,
    consulta_generada: str,
    respuesta_texto: str,
    accion: str,
) -> PreguntaAsistente:
    """Compartido por los dos endpoints POST de este bloque — RN-AR-003
    (consulta_generada nunca vacía) se valida acá una sola vez, con el
    mismo mensaje de 422 tanto si llega vacía desde el cliente
    (`registrar_pregunta_asistente`, auditoría externa) como si —cosa que
    no debería pasar nunca— la orquestación interna del asistente
    (`preguntar_asistente`) devolviera una cadena vacía."""

    if not consulta_generada.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "consulta_generada no puede estar vacía (RN-AR-003)")

    pregunta = PreguntaAsistente(
        usuario_id=current_user.id,
        pregunta_texto=pregunta_texto,
        consulta_generada=consulta_generada,
        respuesta_texto=respuesta_texto,
    )
    db.add(pregunta)
    db.commit()
    db.refresh(pregunta)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion=accion,
        recurso="asistente",
        recurso_id=pregunta.id,
        exitoso=True,
        request=request,
    )
    return pregunta


@router.post(
    "/analitica/asistente/preguntas",
    response_model=PreguntaAsistenteOut,
    status_code=status.HTTP_201_CREATED,
    tags=["analitica-reportes"],
)
def registrar_pregunta_asistente(
    payload: PreguntaAsistenteIn,
    request: Request,
    db: Session = Depends(get_db),
    # RNF-AR-003: exclusivo del rol dueño. Se resuelve contra la matriz
    # real de permiso_rol (solo dueño tiene crear/leer en `asistente`),
    # nunca comparando `current_user.rol == 'dueno'` a mano (RN-AD-004).
    current_user: Usuario = Depends(require_permission("asistente", "crear")),
) -> PreguntaAsistente:
    """Registro de auditoría 'externo': recibe pregunta/consulta/respuesta
    ya computadas por quien llama (uso previsto: pruebas, migraciones de
    otro canal). El flujo real del Dueño es el endpoint interactivo de
    abajo, que llama a esta misma persistencia internamente."""
    return _persistir_pregunta(
        db,
        request,
        current_user,
        pregunta_texto=payload.pregunta_texto,
        consulta_generada=payload.consulta_generada,
        respuesta_texto=payload.respuesta_texto,
        accion="registrar_pregunta_asistente",
    )


@router.post(
    "/analitica/asistente/preguntar",
    response_model=PreguntaAsistenteOut,
    status_code=status.HTTP_201_CREATED,
    tags=["analitica-reportes"],
)
def preguntar_asistente(
    payload: PreguntaAsistentePreguntarIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("asistente", "crear")),
) -> PreguntaAsistente:
    """Endpoint interactivo real del asistente (Art. 5.10, enmienda
    v1.4.0) — el que consume el frontend. Orquesta OpenRouter con el
    catálogo de tools de `services/asistente_tools.py`
    (`services/asistente.py`), y persiste el resultado con la MISMA
    función que el registro externo — ninguna pregunta del Dueño queda
    sin auditar, sea cual sea el canal."""
    try:
        resultado = servicio_asistente.preguntar(payload.pregunta_texto, db)
    except ErrorAsistente as exc:
        # 502: la falla es de un proveedor externo (OpenRouter) o de la
        # configuración de su acceso, no del propio backend — no es un
        # 500 genérico ni un 4xx de responsabilidad del cliente.
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc

    return _persistir_pregunta(
        db,
        request,
        current_user,
        pregunta_texto=payload.pregunta_texto,
        consulta_generada=resultado["consulta_generada"],
        respuesta_texto=resultado["respuesta_texto"],
        accion="preguntar_asistente",
    )


@router.get(
    "/analitica/asistente/preguntas",
    response_model=list[PreguntaAsistenteOut],
    tags=["analitica-reportes"],
)
def consultar_historial_asistente(
    desde: datetime | None = Query(None),
    hasta: datetime | None = Query(None),
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(require_permission("asistente", "leer")),
) -> list[PreguntaAsistente]:
    # No se filtra por usuario_id: el contrato no lo pide como parámetro
    # y, al ser `asistente` dueño-exclusivo en la matriz real (RNF-AR-003),
    # es el historial del asistente de la cadena, no "mis preguntas" —
    # importa si algún día existiera más de una cuenta con rol dueño.
    query = db.query(PreguntaAsistente)
    if desde is not None:
        query = query.filter(PreguntaAsistente.fecha >= desde)
    if hasta is not None:
        query = query.filter(PreguntaAsistente.fecha <= hasta)
    return query.order_by(PreguntaAsistente.fecha.desc()).all()


# ---------------------------------------------------------------------------
# Reportes del Dashboard Dueño (OT1.1, OT1.2, OT1.4, enmienda v1.2.0) —
# dueño-exclusivo, mismo criterio de RBAC que /analitica/asistente: recurso
# `reportes_dashboard` nuevo en la matriz real (ver migración de esta
# enmienda), nunca se compara current_user.rol == 'dueno' a mano.
#
# RN-AR-004 (enmienda v1.2): una falla de ClickHouse nunca debe llegar al
# frontend como 500 genérico — mismo criterio que ya usa
# /analitica/asistente/preguntar con ErrorAsistente/502 para OpenRouter:
# es una falla de infraestructura externa, no un error del propio backend
# ni responsabilidad del cliente que llama.
# ---------------------------------------------------------------------------


def _ejecutar_reporte_clickhouse(fn, *args):
    try:
        return fn(*args)
    except ErrorClickHouse as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"ClickHouse no disponible: {exc}") from exc


@router.get(
    "/analitica/reportes/margen-por-sucursal",
    response_model=list[MargenPorSucursalOut],
    tags=["analitica-reportes"],
)
def consultar_margen_por_sucursal(
    desde: str = Query(..., description="Fecha inicial, YYYY-MM-DD"),
    hasta: str = Query(..., description="Fecha final, YYYY-MM-DD"),
    _current_user: Usuario = Depends(require_permission("reportes_dashboard", "leer")),
) -> list[dict]:
    ch = clickhouse_client_solo_lectura()
    return _ejecutar_reporte_clickhouse(servicio_reportes_dashboard.margen_por_sucursal, ch, desde, hasta)


@router.get(
    "/analitica/reportes/merma-por-sucursal",
    response_model=list[MermaPorSucursalOut],
    tags=["analitica-reportes"],
)
def consultar_merma_por_sucursal(
    desde: str = Query(..., description="Fecha inicial, YYYY-MM-DD"),
    hasta: str = Query(..., description="Fecha final, YYYY-MM-DD"),
    _current_user: Usuario = Depends(require_permission("reportes_dashboard", "leer")),
) -> list[dict]:
    ch = clickhouse_client_solo_lectura()
    return _ejecutar_reporte_clickhouse(servicio_reportes_dashboard.merma_por_sucursal, ch, desde, hasta)


@router.get(
    "/analitica/reportes/ticket-promedio-por-sucursal",
    response_model=list[TicketPromedioPorSucursalOut],
    tags=["analitica-reportes"],
)
def consultar_ticket_promedio_por_sucursal(
    desde: str = Query(..., description="Fecha inicial, YYYY-MM-DD"),
    hasta: str = Query(..., description="Fecha final, YYYY-MM-DD"),
    _current_user: Usuario = Depends(require_permission("reportes_dashboard", "leer")),
) -> list[dict]:
    ch = clickhouse_client_solo_lectura()
    return _ejecutar_reporte_clickhouse(servicio_reportes_dashboard.ticket_promedio_por_sucursal, ch, desde, hasta)


# ---------------------------------------------------------------------------
# Catálogos (RF-AR-008/009, enmienda v1.1) — solo lectura, cualquier usuario autenticado
# ---------------------------------------------------------------------------


@router.get("/catalogos/modelos-ml", response_model=list[ModeloMlOut], tags=["catalogos"])
def listar_modelos_ml(
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(get_current_user),
) -> list[ModeloMl]:
    return db.query(ModeloMl).order_by(ModeloMl.orden).all()


@router.get("/catalogos/estados-version-modelo", response_model=list[EstadoVersionModeloOut], tags=["catalogos"])
def listar_estados_version_modelo(
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(get_current_user),
) -> list[EstadoVersionModelo]:
    return db.query(EstadoVersionModelo).order_by(EstadoVersionModelo.orden).all()


@router.get("/catalogos/estados-ejecucion", response_model=list[EstadoEjecucionOut], tags=["catalogos"])
def listar_estados_ejecucion(
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(get_current_user),
) -> list[EstadoEjecucion]:
    return db.query(EstadoEjecucion).order_by(EstadoEjecucion.orden).all()
