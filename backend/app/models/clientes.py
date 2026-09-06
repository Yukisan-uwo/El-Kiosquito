"""
002-clientes-fidelizacion — cliente, segmentación (K-Means) y evaluación de
churn con sus campañas de recuperación.

Fuente: el-kiosquito-002-clientes-fidelizacion-data-model.md (tras
enmienda v1.1 de catálogos maestros).

Decisión documentada en el propio data-model.md: `segmento_cliente` ES la
dimensión SCD tipo 2 de cliente (append-only desde el diseño original, con
`fecha_calculo` como `fecha_desde` y `vigente_hasta` como `fecha_hasta`
explícito) — **no** se crea una tabla `cliente_segmento_historial` aparte,
porque duplicaría exactamente esta información. Este módulo cierra la
FK diferida de `solicitud_arco.cliente_id` (010) y `venta.cliente_id`
(001) ahora que `cliente` existe (ver migración).

FK externa aún diferida en este propio módulo:
- `segmento_cliente.version_modelo_id` → `version_modelo_ml` (011-analitica-reportes)
- `campana_recuperacion.cupon_id`      → `cupon` (005-promociones-inteligentes), nullable
"""

from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Date,
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
# Catálogo maestro (enmienda v1.1)
# ---------------------------------------------------------------------------


class Segmento(CatalogMixin, Base):
    """Los 5 códigos del seed son los nombres de negocio de los clusters,
    no los números 0..k-1 que devuelve el K-Means — 011-analitica-reportes
    es quien traduce al publicar una versión del modelo."""

    __tablename__ = "segmento"

    codigo: Mapped[str] = mapped_column(String(40), primary_key=True)
    etiqueta: Mapped[str] = mapped_column(String(80), nullable=False)
    descripcion: Mapped[str] = mapped_column(Text, nullable=False)
    # A qué segmento se le envía cupón primero cuando el presupuesto de
    # 005-promociones-inteligentes es limitado (OT2.3).
    prioridad_comercial: Mapped[int] = mapped_column(SmallInteger, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "prioridad_comercial BETWEEN 1 AND 10", name="ck_segmento_prioridad_rango"
        ),
    )


# ---------------------------------------------------------------------------
# Tablas operativas
# ---------------------------------------------------------------------------


class Cliente(Base):
    __tablename__ = "cliente"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(Text, nullable=False)
    contacto: Mapped[str | None] = mapped_column(Text, nullable=True)
    fecha_nacimiento: Mapped[date | None] = mapped_column(Date, nullable=True)
    creado_en: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    # Art. 10.4 de la constitución (LOPDP Ecuador): todo alta de cliente en
    # el programa de fidelización exige casilla de aceptación de la
    # política de privacidad, registrada con fecha, hora y versión —
    # nunca implícita. `version_politica_privacidad` es la versión VIGENTE
    # en el momento del consentimiento (la sirve el backend, RF-CF-012 —
    # ver `_POLITICA_PRIVACIDAD_VIGENTE` en `routers/clientes.py`), no un
    # valor que el cliente/cajero pueda escribir libremente.
    consentimiento_privacidad_en: Mapped[datetime] = mapped_column(nullable=False)
    version_politica_privacidad: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (
        # Usado por 005-promociones-inteligentes para cupones de cumpleaños.
        Index("ix_cliente_fecha_nacimiento", "fecha_nacimiento"),
    )


class SegmentoCliente(Base):
    """ES la dimensión SCD tipo 2 de cliente (ver docstring del módulo).
    Único `UPDATE` admitido: cerrar `vigente_hasta` de la fila anterior en
    la misma transacción que inserta la nueva (RNF-CF-001) — no altera
    ningún dato del cálculo ya registrado."""

    __tablename__ = "segmento_cliente"

    id: Mapped[int] = mapped_column(primary_key=True)
    cliente_id: Mapped[int] = mapped_column(ForeignKey("cliente.id"), nullable=False)
    segmento_codigo: Mapped[str] = mapped_column(String(40), ForeignKey("segmento.codigo"), nullable=False)
    frecuencia_snapshot: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    margen_snapshot: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    recencia_dias_snapshot: Mapped[int | None] = mapped_column(nullable=True)
    tamano_muestra: Mapped[int] = mapped_column(nullable=False)
    periodo_inicio: Mapped[date] = mapped_column(Date, nullable=False)
    periodo_fin: Mapped[date] = mapped_column(Date, nullable=False)
    # FK a version_modelo_ml(id) — 011-analitica-reportes ya está
    # construido; su migración la cierra con ALTER TABLE. Obligatoria:
    # sin ella no se puede distinguir si una reclasificación masiva la
    # causó el modelo nuevo o el cliente.
    version_modelo_id: Mapped[int] = mapped_column(ForeignKey("version_modelo_ml.id"), nullable=False)
    fecha_calculo: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    vigente_hasta: Mapped[datetime | None] = mapped_column(nullable=True)  # NULL = vigente

    __table_args__ = (
        CheckConstraint("tamano_muestra > 0", name="ck_segmento_cliente_muestra_positiva"),
        Index("ix_segmento_cliente_cliente_fecha", "cliente_id", "fecha_calculo"),
        # Un cliente no puede tener dos segmentos vigentes a la vez — mismo
        # patrón que recomendacion_precio (003) y turno_caja (006).
        Index(
            "ux_segmento_cliente_vigente",
            "cliente_id",
            unique=True,
            postgresql_where=text("vigente_hasta IS NULL"),
        ),
    )


class EvaluacionChurn(Base):
    __tablename__ = "evaluacion_churn"

    id: Mapped[int] = mapped_column(primary_key=True)
    cliente_id: Mapped[int] = mapped_column(ForeignKey("cliente.id"), nullable=False)
    es_riesgo_real: Mapped[bool] = mapped_column(nullable=False)
    dias_sin_compra_al_momento: Mapped[int] = mapped_column(nullable=False)
    frecuencia_historica_dias: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    justificacion: Mapped[str] = mapped_column(Text, nullable=False)
    tamano_muestra: Mapped[int] = mapped_column(nullable=False)
    fecha_evaluacion: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())

    __table_args__ = (
        CheckConstraint("dias_sin_compra_al_momento >= 0", name="ck_churn_dias_no_negativo"),
        CheckConstraint("length(justificacion) >= 10", name="ck_churn_justificacion_minima"),
        CheckConstraint("tamano_muestra > 0", name="ck_churn_muestra_positiva"),
        Index("ix_churn_cliente_fecha", "cliente_id", "fecha_evaluacion"),
    )


class CampanaRecuperacion(Base):
    """RN-CF-001 (en servicio, no expresable como CHECK): antes de insertar,
    el servicio consulta `venta` buscando alguna compra con
    `fecha_hora > evaluacion_churn.fecha_evaluacion` — si existe, rechaza
    con 409 (el cliente ya volvió a comprar solo, no hace falta campaña)."""

    __tablename__ = "campana_recuperacion"

    id: Mapped[int] = mapped_column(primary_key=True)
    cliente_id: Mapped[int] = mapped_column(ForeignKey("cliente.id"), nullable=False)
    evaluacion_churn_id: Mapped[int] = mapped_column(ForeignKey("evaluacion_churn.id"), nullable=False)
    # FK a cupon(id) — 005-promociones-inteligentes ya está construido; la
    # migración de 005 la cierra con ALTER TABLE. Nullable: una campaña
    # puede ser solo un contacto, sin cupón asociado.
    cupon_id: Mapped[int | None] = mapped_column(ForeignKey("cupon.id"), nullable=True)
    fecha_envio: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuario.id"), nullable=False)
    # Art. 8.4 — mismo patrón que `cupon.notificacion_*`
    # (ver docstring de `app/services/notificaciones.py`): resultado real
    # del envío del aviso de campaña, nunca asumido por el solo hecho de
    # haberse registrado la fila.
    notificacion_enviada: Mapped[bool] = mapped_column(nullable=False, default=False, server_default="false")
    notificacion_detalle: Mapped[str | None] = mapped_column(Text, nullable=True)
