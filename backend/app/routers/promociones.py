"""
Router del módulo 005-promociones-inteligentes — cupón y su ciclo de vida
cerrado (activo → canjeado/expirado). A diferencia de los patrones
append-only de la mayoría de los otros módulos, este SÍ hace `UPDATE`
sobre `estado` — un cupón es un recurso de un solo uso, no una serie
histórica. Implementa el contrato
el-kiosquito-005-promociones-inteligentes-contracts-openapi.yaml.

RBAC: la matriz real de 005 tiene un solo recurso, `cupon`. `crear` es
dueño-exclusivo (mismo criterio que 002/003/004 para los endpoints que el
contrato marca `security:[Sistema]` — en la práctica, un batch de
cumpleaños o el motor de patrón de compra corren con esa cuenta).
`actualizar` (canjear) lo tienen dueño, cajero y encargado_sucursal — no
encargado_compras, coherente con que canjear ocurre en el punto de venta.
`leer` lo tienen los cuatro roles.
"""

import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, log_accion, require_permission
from app.database import get_db
from app.models.administracion import Usuario
from app.models.clientes import Cliente, EvaluacionChurn
from app.models.core_ventas import Venta
from app.models.promociones import (
    Cupon,
    EstadoCupon,
    EstadoSugerenciaPatron,
    SugerenciaPatronCompra,
    TipoDescuento,
    TipoOrigenCupon,
)
from app.schemas.promociones import (
    CuponCanjearIn,
    CuponCrearIn,
    CuponOut,
    EstadoCuponOut,
    EstadoSugerenciaPatronOut,
    SugerenciaPatronOut,
    SugerenciaPatronRecalcularIn,
    SugerenciaPatronRecalcularOut,
    SugerenciaPatronResolverIn,
    TipoDescuentoOut,
    TipoOrigenCuponOut,
)
from app.services.notificaciones import notificar_cupon
from app.services.patron_compra import ParametrosRecalculo, recalcular_sugerencias
from app.services.scoping import verificar_alcance_sucursal

router = APIRouter()


def _generar_codigo_cupon() -> str:
    # RNF-PI-002: único en todo el sistema. No hay clave natural legible
    # que el negocio quiera controlar (a diferencia de `nombre` en
    # fuente_competencia, 003) — un código corto aleatorio alcanza, y el
    # UNIQUE de BD es la garantía real, no esta generación.
    return f"CUP-{secrets.token_hex(4).upper()}"


def _crear_cupon(
    db: Session,
    *,
    cliente_id: int,
    tipo_origen_codigo: str,
    evaluacion_churn_id: int | None,
    descuento_tipo_codigo: str,
    descuento_valor,
    fecha_expiracion,
) -> Cupon:
    """Factorizado de `registrar_cupon` (enmienda v1.2) para que
    `resolver_sugerencia_patron` cree el cupón real de la misma forma
    exacta — mismas validaciones, mismo envío de notificación — en vez de
    reimplementar media función."""

    cliente = db.get(Cliente, cliente_id)
    if cliente is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cliente no encontrado")

    tipo_origen = db.get(TipoOrigenCupon, tipo_origen_codigo)
    if tipo_origen is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"tipo_origen '{tipo_origen_codigo}' no existe en el catálogo")

    tipo_descuento = db.get(TipoDescuento, descuento_tipo_codigo)
    if tipo_descuento is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, f"descuento_tipo '{descuento_tipo_codigo}' no existe en el catálogo"
        )

    # RN-PI-004 (enmienda v1.1): el tope es inclusivo (100% para
    # "porcentaje" se permite, 200% no).
    if descuento_valor > tipo_descuento.valor_maximo_permitido:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"descuento_valor supera el máximo permitido para '{descuento_tipo_codigo}' "
            f"({tipo_descuento.valor_maximo_permitido})",
        )

    # RN-PI-002: un cupón de recuperación de churn siempre debe poder
    # trazarse hasta su evaluación de origen. El CHECK de BD respalda esto
    # además (ck_cupon_churn_requiere_evaluacion) — se valida acá temprano
    # para devolver 422 en vez de una IntegrityError 500.
    if tipo_origen.requiere_evaluacion_churn and evaluacion_churn_id is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"evaluacion_churn_id es obligatorio para tipo_origen '{tipo_origen_codigo}' (RN-PI-002)",
        )
    if evaluacion_churn_id is not None:
        evaluacion = db.get(EvaluacionChurn, evaluacion_churn_id)
        if evaluacion is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "evaluacion_churn_id no encontrada")
        if evaluacion.cliente_id != cliente_id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "La evaluación de churn no pertenece a este cliente"
            )

    cupon = Cupon(
        cliente_id=cliente_id,
        tipo_origen=tipo_origen_codigo,
        evaluacion_churn_id=evaluacion_churn_id,
        codigo=_generar_codigo_cupon(),
        descuento_tipo=descuento_tipo_codigo,
        descuento_valor=descuento_valor,
        fecha_expiracion=fecha_expiracion,
        estado="activo",
    )
    db.add(cupon)
    db.commit()
    db.refresh(cupon)

    # Art. 8.4 — envío real por correo, nunca simulado. Best-effort: una
    # falla acá (SMTP caído, sin config, contacto no es correo) nunca debe
    # deshacer el cupón ya registrado (Art. 8.6) — se persiste el
    # resultado real, incluido el motivo cuando no se pudo enviar.
    try:
        enviado, detalle = notificar_cupon(cliente, cupon)
    except Exception as exc:  # defensivo — notificar_cupon ya atrapa sus propios errores de red
        enviado, detalle = False, f"error inesperado al notificar: {exc}"
    cupon.notificacion_enviada = enviado
    cupon.notificacion_detalle = detalle
    db.commit()
    db.refresh(cupon)
    return cupon


@router.post("/promociones/cupones", response_model=CuponOut, status_code=status.HTTP_201_CREATED, tags=["promociones"])
def registrar_cupon(
    payload: CuponCrearIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("cupon", "crear")),
) -> Cupon:
    cupon = _crear_cupon(
        db,
        cliente_id=payload.cliente_id,
        tipo_origen_codigo=payload.tipo_origen,
        evaluacion_churn_id=payload.evaluacion_churn_id,
        descuento_tipo_codigo=payload.descuento_tipo,
        descuento_valor=payload.descuento_valor,
        fecha_expiracion=payload.fecha_expiracion,
    )
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="registrar_cupon",
        recurso="cupon",
        recurso_id=cupon.id,
        exitoso=True,
        request=request,
        detalle={
            "cliente_id": payload.cliente_id,
            "tipo_origen": payload.tipo_origen,
            "notificacion_enviada": cupon.notificacion_enviada,
        },
    )
    return cupon


@router.patch("/promociones/cupones/{id}/canjear", response_model=CuponOut, tags=["promociones"])
def canjear_cupon(
    id: int,
    payload: CuponCanjearIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("cupon", "actualizar")),
) -> Cupon:
    cupon = db.get(Cupon, id)
    if cupon is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cupón no encontrado")

    venta = db.get(Venta, payload.venta_id)
    if venta is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Venta no encontrada")
    verificar_alcance_sucursal(db, current_user, venta.sucursal_id)

    ahora = datetime.utcnow()

    # Expiración perezosa: nada más transiciona el estado por tiempo (no
    # hay cron de expiración en este módulo), así que un cupón vencido
    # que sigue en 'activo' se corrige a 'expirado' en el momento en que
    # alguien intenta canjearlo — nunca se permite el canje en sí.
    if cupon.estado == "activo" and cupon.fecha_expiracion <= ahora:
        cupon.estado = "expirado"
        db.commit()

    estado_actual = db.get(EstadoCupon, cupon.estado)
    if estado_actual is None or not estado_actual.permite_canje:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Cupón ya canjeado o vencido (RN-PI-001)"
        )
    if cupon.fecha_expiracion <= ahora:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Cupón vencido (RN-PI-001)")

    # RN-PI-001 / nota de integridad de 005: valida estado y expiración,
    # luego actualiza estado + venta_id_canje + fecha_canje en la misma
    # transacción — nunca dos pasos separados.
    cupon.estado = "canjeado"
    cupon.venta_id_canje = payload.venta_id
    cupon.fecha_canje = ahora
    db.commit()
    db.refresh(cupon)
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="canjear_cupon",
        recurso="cupon",
        recurso_id=cupon.id,
        sucursal_id=venta.sucursal_id,
        exitoso=True,
        request=request,
        detalle={"venta_id": payload.venta_id},
    )
    return cupon


@router.get("/clientes/{cliente_id}/cupones", response_model=list[CuponOut], tags=["promociones"])
def consultar_cupones_cliente(
    cliente_id: int,
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(require_permission("cupon", "leer")),
) -> list[Cupon]:
    if db.get(Cliente, cliente_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cliente no encontrado")
    return db.query(Cupon).filter(Cupon.cliente_id == cliente_id).order_by(Cupon.fecha_envio.desc()).all()


@router.get("/promociones/cupones/validar/{codigo}", response_model=CuponOut, tags=["promociones"])
def validar_cupon_por_codigo(
    codigo: str,
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(require_permission("cupon", "leer")),
) -> Cupon:
    """Valida un código de cupón recibido por el cliente (ej. por correo electrónico, Art. 8.4).
    Verifica que exista, que esté activo y que no esté expirado (RN-PI-001)."""
    cod = codigo.strip().upper()
    cupon = db.query(Cupon).filter(func.upper(Cupon.codigo) == cod).first()
    if cupon is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Cupón '{codigo}' no encontrado")

    ahora = datetime.utcnow()
    if cupon.estado == "activo" and cupon.fecha_expiracion <= ahora:
        cupon.estado = "expirado"
        db.commit()

    if cupon.estado == "canjeado":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "El cupón ya fue canjeado en una compra previa")
    if cupon.estado == "expirado" or cupon.fecha_expiracion <= ahora:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "El cupón ya se encuentra expirado")
    if cupon.estado != "activo":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"El cupón no está activo (estado: {cupon.estado})")

    return cupon


# ---------------------------------------------------------------------------
# Motor de patrón de compra (RN-PI-005, enmienda v1.2, auditoría de riesgos
# derivados) — mismo criterio RBAC que "crear cupon": dueño-exclusivo para
# `recalcular` y `resolver` (comprometen presupuesto de descuento real),
# lectura para los cuatro roles.
# ---------------------------------------------------------------------------


@router.post(
    "/promociones/sugerencias-patron/recalcular",
    response_model=SugerenciaPatronRecalcularOut,
    tags=["promociones"],
)
def recalcular_sugerencias_patron(
    payload: SugerenciaPatronRecalcularIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("sugerencia_patron", "crear")),
) -> SugerenciaPatronRecalcularOut:
    resultado = recalcular_sugerencias(
        db,
        ParametrosRecalculo(
            periodo_dias=payload.periodo_dias,
            soporte_minimo=payload.soporte_minimo,
            confianza_minima=payload.confianza_minima,
            lift_minimo=payload.lift_minimo,
            veces_minimas_base=payload.veces_minimas_base,
            limite_por_cliente=payload.limite_por_cliente,
        ),
    )
    log_accion(
        db,
        usuario_id=current_user.id,
        accion="recalcular_sugerencias_patron",
        recurso="sugerencia_patron",
        exitoso=True,
        request=request,
        detalle={
            "periodo_dias": payload.periodo_dias,
            "reglas_evaluadas": resultado.reglas_evaluadas,
            "sugerencias_generadas": resultado.sugerencias_generadas,
        },
    )
    return SugerenciaPatronRecalcularOut(
        periodo_dias=payload.periodo_dias,
        reglas_evaluadas=resultado.reglas_evaluadas,
        sugerencias_generadas=resultado.sugerencias_generadas,
        sugerencias_omitidas_duplicadas=resultado.sugerencias_omitidas_duplicadas,
    )


@router.get(
    "/promociones/sugerencias-patron",
    response_model=list[SugerenciaPatronOut],
    tags=["promociones"],
)
def listar_sugerencias_patron(
    cliente_id: int | None = None,
    estado: str | None = None,
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(require_permission("sugerencia_patron", "leer")),
) -> list[SugerenciaPatronCompra]:
    consulta = db.query(SugerenciaPatronCompra)
    if cliente_id is not None:
        consulta = consulta.filter(SugerenciaPatronCompra.cliente_id == cliente_id)
    if estado is not None:
        consulta = consulta.filter(SugerenciaPatronCompra.estado == estado)
    return consulta.order_by(SugerenciaPatronCompra.generado_en.desc()).all()


@router.patch(
    "/promociones/sugerencias-patron/{id}/resolver",
    response_model=SugerenciaPatronOut,
    tags=["promociones"],
)
def resolver_sugerencia_patron(
    id: int,
    payload: SugerenciaPatronResolverIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("sugerencia_patron", "actualizar")),
) -> SugerenciaPatronCompra:
    sugerencia = db.get(SugerenciaPatronCompra, id)
    if sugerencia is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sugerencia no encontrada")

    estado_actual = db.get(EstadoSugerenciaPatron, sugerencia.estado)
    if estado_actual is not None and estado_actual.es_estado_final:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"La sugerencia ya fue resuelta (estado actual: '{sugerencia.estado}')"
        )

    if payload.aceptar:
        # El motor de asociación decide QUÉ producto sugerir; nunca de
        # cuánto es el descuento — eso lo aporta quien confirma, igual que
        # `registrar_cupon` no lo infiere de ningún dato (RN-PI-005).
        faltantes = [
            campo
            for campo, valor in (
                ("descuento_tipo", payload.descuento_tipo),
                ("descuento_valor", payload.descuento_valor),
                ("fecha_expiracion", payload.fecha_expiracion),
            )
            if valor is None
        ]
        if faltantes:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"Al aceptar una sugerencia son obligatorios: {', '.join(faltantes)} (RN-PI-005)",
            )
        cupon = _crear_cupon(
            db,
            cliente_id=sugerencia.cliente_id,
            tipo_origen_codigo="patron_compra",
            evaluacion_churn_id=None,
            descuento_tipo_codigo=payload.descuento_tipo,
            descuento_valor=payload.descuento_valor,
            fecha_expiracion=payload.fecha_expiracion,
        )
        sugerencia.estado = "aceptada"
        sugerencia.cupon_id = cupon.id
    else:
        sugerencia.estado = "descartada"

    sugerencia.atendida_en = datetime.utcnow()
    sugerencia.atendida_por = current_user.id
    db.commit()
    db.refresh(sugerencia)

    log_accion(
        db,
        usuario_id=current_user.id,
        accion="resolver_sugerencia_patron",
        recurso="sugerencia_patron",
        recurso_id=sugerencia.id,
        exitoso=True,
        request=request,
        detalle={"aceptar": payload.aceptar, "cupon_id": sugerencia.cupon_id},
    )
    return sugerencia


# ---------------------------------------------------------------------------
# Catálogos (RF-PI-007, enmienda v1.1) — solo lectura, cualquier usuario autenticado
# ---------------------------------------------------------------------------


@router.get("/catalogos/tipos-origen-cupon", response_model=list[TipoOrigenCuponOut], tags=["catalogos"])
def listar_tipos_origen_cupon(
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(get_current_user),
) -> list[TipoOrigenCupon]:
    return db.query(TipoOrigenCupon).order_by(TipoOrigenCupon.orden).all()


@router.get("/catalogos/tipos-descuento", response_model=list[TipoDescuentoOut], tags=["catalogos"])
def listar_tipos_descuento(
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(get_current_user),
) -> list[TipoDescuento]:
    return db.query(TipoDescuento).order_by(TipoDescuento.orden).all()


@router.get("/catalogos/estados-cupon", response_model=list[EstadoCuponOut], tags=["catalogos"])
def listar_estados_cupon(
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(get_current_user),
) -> list[EstadoCupon]:
    return db.query(EstadoCupon).order_by(EstadoCupon.orden).all()


@router.get(
    "/catalogos/estados-sugerencia-patron",
    response_model=list[EstadoSugerenciaPatronOut],
    tags=["catalogos"],
)
def listar_estados_sugerencia_patron(
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(get_current_user),
) -> list[EstadoSugerenciaPatron]:
    return db.query(EstadoSugerenciaPatron).order_by(EstadoSugerenciaPatron.orden).all()
