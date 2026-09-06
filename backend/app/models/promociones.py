"""
005-promociones-inteligentes — cupón (único, con ciclo de vida cerrado:
activo → canjeado/expirado). A diferencia de los patrones append-only de
otros módulos, `cupon` sí usa UPDATE sobre `estado` — es un recurso de un
solo uso, no una serie histórica.

Fuente: el-kiosquito-005-promociones-inteligentes-data-model.md (tras
enmienda v1.1 de catálogos maestros).

Cierra la FK diferida de `campana_recuperacion.cupon_id` (002) ahora que
`cupon` existe (ver migración) — mismo patrón que 002 cerró las FKs de
`cliente_id` en 010 y 001.
"""

from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Numeric,
    SmallInteger,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.common import CatalogMixin

# ---------------------------------------------------------------------------
# Catálogos maestros (enmienda v1.1)
# ---------------------------------------------------------------------------


class TipoOrigenCupon(CatalogMixin, Base):
    __tablename__ = "tipo_origen_cupon"

    codigo: Mapped[str] = mapped_column(String(40), primary_key=True)
    etiqueta: Mapped[str] = mapped_column(String(80), nullable=False)
    # Denominador de OT2.3 (% de cupones bien segmentados): solo los
    # automáticos los segmenta el modelo, mezclar con manuales no serviría.
    es_automatico: Mapped[bool] = mapped_column(Boolean, nullable=False)
    # RN-PI-002 como dato consultable — el CHECK en `cupon` sigue existiendo
    # además (ver docstring de Cupon), esto es para que un formulario sepa
    # si debe pedir el campo sin tenerlo quemado.
    requiere_evaluacion_churn: Mapped[bool] = mapped_column(Boolean, nullable=False)


class TipoDescuento(CatalogMixin, Base):
    __tablename__ = "tipo_descuento"

    codigo: Mapped[str] = mapped_column(String(40), primary_key=True)
    etiqueta: Mapped[str] = mapped_column(String(80), nullable=False)
    # Tope de seguridad (RN-PI-004): sin esto, un cupón "porcentaje" con
    # descuento_valor=200 se podía crear y regalaba el producto pagando.
    valor_maximo_permitido: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)

    __table_args__ = (
        CheckConstraint("valor_maximo_permitido > 0", name="ck_tipo_descuento_maximo_positivo"),
    )


class EstadoCupon(CatalogMixin, Base):
    __tablename__ = "estado_cupon"

    codigo: Mapped[str] = mapped_column(String(40), primary_key=True)
    etiqueta: Mapped[str] = mapped_column(String(80), nullable=False)
    es_estado_final: Mapped[bool] = mapped_column(Boolean, nullable=False)  # 'activo' es el único false
    permite_canje: Mapped[bool] = mapped_column(Boolean, nullable=False)  # solo 'activo' es true


class EstadoSugerenciaPatron(CatalogMixin, Base):
    """Enmienda v1.2 (auditoría de riesgos derivados). Mismo criterio que
    `estado_cupon`/`estado_alerta`/`estado_incidencia` (006): catálogo en
    vez de CHECK IN (...) fijo, para no repetir el error que la enmienda
    v1.2 de 006 tuvo que corregir después."""

    __tablename__ = "estado_sugerencia_patron"

    codigo: Mapped[str] = mapped_column(String(40), primary_key=True)
    etiqueta: Mapped[str] = mapped_column(String(80), nullable=False)
    es_estado_final: Mapped[bool] = mapped_column(Boolean, nullable=False)  # 'pendiente' es el único false


# ---------------------------------------------------------------------------
# Tabla operativa
# ---------------------------------------------------------------------------


class Cupon(Base):
    """El CHECK de RN-PI-002 se mantiene aunque `tipo_origen_cupon.
    requiere_evaluacion_churn` exprese la misma regla como dato: el CHECK
    la impone fila por fila sin depender de que nadie lea el catálogo."""

    __tablename__ = "cupon"

    id: Mapped[int] = mapped_column(primary_key=True)
    cliente_id: Mapped[int] = mapped_column(ForeignKey("cliente.id"), nullable=False)
    tipo_origen: Mapped[str] = mapped_column(String(40), ForeignKey("tipo_origen_cupon.codigo"), nullable=False)
    # Solo si tipo_origen = 'recuperacion_churn' (ver CHECK abajo).
    evaluacion_churn_id: Mapped[int | None] = mapped_column(ForeignKey("evaluacion_churn.id"), nullable=True)
    codigo: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    descuento_tipo: Mapped[str] = mapped_column(String(40), ForeignKey("tipo_descuento.codigo"), nullable=False)
    descuento_valor: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    fecha_envio: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    fecha_expiracion: Mapped[datetime] = mapped_column(nullable=False)
    estado: Mapped[str] = mapped_column(
        String(40), ForeignKey("estado_cupon.codigo"), nullable=False, default="activo", server_default="activo"
    )
    # Se llenan al canjear, en la misma transacción que actualiza `estado`
    # (RF-PI-002) — ver nota de integridad transversal del módulo.
    venta_id_canje: Mapped[int | None] = mapped_column(ForeignKey("venta.id"), nullable=True)
    fecha_canje: Mapped[datetime | None] = mapped_column(nullable=True)
    # Art. 8.4 — resultado REAL del envío por correo, no
    # solo el hecho de haberse registrado (`fecha_envio` ya existía pero
    # solo marca cuándo se creó la fila, nunca implicó una entrega real).
    # `notificacion_enviada=False` con `notificacion_detalle` poblado es un
    # estado válido y esperado (SMTP no configurado, contacto sin forma de
    # correo, rechazo del servidor) — nunca se asume entrega.
    notificacion_enviada: Mapped[bool] = mapped_column(nullable=False, default=False, server_default="false")
    notificacion_detalle: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        CheckConstraint("descuento_valor >= 0", name="ck_cupon_descuento_no_negativo"),
        CheckConstraint(
            "tipo_origen <> 'recuperacion_churn' OR evaluacion_churn_id IS NOT NULL",
            name="ck_cupon_churn_requiere_evaluacion",
        ),
        Index("ix_cupon_cliente_estado", "cliente_id", "estado"),
    )


class SugerenciaPatronCompra(Base):
    """Enmienda v1.2 (auditoría de riesgos derivados, 2026-09-05). Cierra el
    hueco que la Decisión 3 de `research.md` había dejado documentado a
    propósito, pero que en la práctica significaba que `tipo_origen =
    'patron_compra'` nunca se disparaba solo: alguien tenía que decidir a
    mano, sin ningún dato de soporte, que "este cliente tiene un patrón".

    Esta tabla es la salida de un cálculo real de asociación de mercado
    (soporte/confianza/lift) sobre `detalle_venta`/`venta`, hecho por
    `POST /promociones/sugerencias-patron/recalcular` — nunca sobre datos
    inventados. Sigue el mismo principio "sistema sugiere, humano
    confirma" que `recomendacion_precio` (003, RN-PM-002): una fila acá NO
    crea un cupón por sí sola. Solo cuando alguien la resuelve con
    `aceptar=true` (y aporta el descuento, que el motor de asociación no
    decide) se crea el `Cupon` con `tipo_origen='patron_compra'`."""

    __tablename__ = "sugerencia_patron_compra"

    id: Mapped[int] = mapped_column(primary_key=True)
    cliente_id: Mapped[int] = mapped_column(ForeignKey("cliente.id"), nullable=False)
    # Producto que el cliente ya compra con frecuencia (la mitad "conocida"
    # de la regla) y producto que la regla sugiere, que este cliente en
    # particular no ha comprado en el período analizado (la oportunidad).
    producto_base_id: Mapped[int] = mapped_column(ForeignKey("producto.id"), nullable=False)
    producto_sugerido_id: Mapped[int] = mapped_column(ForeignKey("producto.id"), nullable=False)
    veces_comprado_base: Mapped[int] = mapped_column(nullable=False)
    # Métricas estándar de reglas de asociación (market-basket), calculadas
    # sobre canastas = venta.id: soporte = P(base y sugerido juntos en toda
    # la base de clientes); confianza = P(sugerido | base); lift =
    # confianza / P(sugerido) — lift > 1 es lo que separa una asociación
    # real de una coincidencia con un producto simplemente popular.
    soporte: Mapped[float] = mapped_column(Numeric(6, 4), nullable=False)
    confianza: Mapped[float] = mapped_column(Numeric(6, 4), nullable=False)
    lift: Mapped[float] = mapped_column(Numeric(8, 4), nullable=False)
    periodo_dias: Mapped[int] = mapped_column(nullable=False)
    estado: Mapped[str] = mapped_column(
        String(40), ForeignKey("estado_sugerencia_patron.codigo"), nullable=False,
        default="pendiente", server_default="pendiente",
    )
    generado_en: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    atendida_en: Mapped[datetime | None] = mapped_column(nullable=True)
    atendida_por: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"), nullable=True)
    # Se llena solo si se aceptó y se creó un cupón real (RF nuevo,
    # espejo de `campana_recuperacion.cupon_id` en 002).
    cupon_id: Mapped[int | None] = mapped_column(ForeignKey("cupon.id"), nullable=True)

    __table_args__ = (
        CheckConstraint("producto_base_id <> producto_sugerido_id", name="ck_sugerencia_patron_productos_distintos"),
        CheckConstraint("veces_comprado_base > 0", name="ck_sugerencia_patron_veces_positivo"),
        CheckConstraint("soporte >= 0 AND soporte <= 1", name="ck_sugerencia_patron_soporte_rango"),
        CheckConstraint("confianza >= 0 AND confianza <= 1", name="ck_sugerencia_patron_confianza_rango"),
        CheckConstraint("lift >= 0", name="ck_sugerencia_patron_lift_no_negativo"),
        CheckConstraint("periodo_dias > 0", name="ck_sugerencia_patron_periodo_positivo"),
        # No se vuelve a sugerir el mismo par cliente/producto mientras la
        # sugerencia anterior siga pendiente de resolución (evita que un
        # recalculo diario duplique filas sobre lo que ya está esperando
        # una decisión humana).
        Index(
            "ux_sugerencia_patron_pendiente",
            "cliente_id", "producto_sugerido_id",
            unique=True,
            postgresql_where=text("estado = 'pendiente'"),
        ),
        Index("ix_sugerencia_patron_cliente_estado", "cliente_id", "estado"),
    )
