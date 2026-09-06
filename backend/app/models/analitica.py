"""
011-analitica-reportes — ejecuciones del pipeline ETL de Airflow (con su
validación de calidad), versiones de los 5 modelos scikit-learn del
Art. 5.6 (con índice único parcial: una sola activa por modelo), y el
log append-only de preguntas al asistente conversacional (exclusivo del
rol dueño).

Fuente: el-kiosquito-011-analitica-reportes-data-model.md (tras enmienda
v1.1 de catálogos maestros). Cierra el ciclo de migraciones del proyecto.

Cierra la FK diferida de `segmento_cliente.version_modelo_id` (002) ahora
que `version_modelo_ml` existe (ver migración) — último cierre de FK
diferida pendiente en el proyecto.
"""

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    Numeric,
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


class ModeloMl(CatalogMixin, Base):
    """Los 5 códigos del seed son los 5 modelos del Art. 5.6 — el catálogo
    no abre la puerta a un sexto sin enmendar la constitución.
    `tamano_muestra_minimo`: el hallazgo más útil de esta enmienda —
    el umbral por modelo (Decisión 3 de research.md) se mueve del
    diccionario `UMBRAL_MINIMO_POR_MODELO` en services/ al catálogo,
    donde queda auditable junto a la versión que descartó (Art. 5.9)."""

    __tablename__ = "modelo_ml"

    codigo: Mapped[str] = mapped_column(String(40), primary_key=True)
    etiqueta: Mapped[str] = mapped_column(String(80), nullable=False)
    algoritmo: Mapped[str] = mapped_column(String(60), nullable=False)  # 'Isolation Forest', 'K-Means'...
    metrica_principal: Mapped[str] = mapped_column(String(40), nullable=False)  # 'MAE', 'F1', 'silhouette'...
    tamano_muestra_minimo: Mapped[int] = mapped_column(Integer, nullable=False)
    modulo_consumidor: Mapped[str] = mapped_column(String(60), nullable=False)

    __table_args__ = (
        CheckConstraint("tamano_muestra_minimo > 0", name="ck_modelo_ml_muestra_minima_positiva"),
    )


class EstadoEjecucion(CatalogMixin, Base):
    __tablename__ = "estado_ejecucion"

    codigo: Mapped[str] = mapped_column(String(40), primary_key=True)
    etiqueta: Mapped[str] = mapped_column(String(80), nullable=False)
    es_estado_final: Mapped[bool] = mapped_column(Boolean, nullable=False)  # false solo en 'en_progreso'


class EstadoVersionModelo(CatalogMixin, Base):
    __tablename__ = "estado_version_modelo"

    codigo: Mapped[str] = mapped_column(String(60), primary_key=True)
    etiqueta: Mapped[str] = mapped_column(String(80), nullable=False)
    # Solo la activa responde consultas — un 'descartado_datos_insuficientes'
    # es registro de honestidad (Art. 5.9), no algo que sirva predicciones.
    es_version_servible: Mapped[bool] = mapped_column(Boolean, nullable=False)
    exige_motivo: Mapped[bool] = mapped_column(Boolean, nullable=False)  # true solo en descartado_datos_insuficientes


# ---------------------------------------------------------------------------
# Tablas operativas
# ---------------------------------------------------------------------------


class EjecucionPipelineEtl(Base):
    """Append-only en el sentido del proyecto pese a tener dos fases
    (inicio/fin): un único evento de negocio con ciclo de vida corto y
    cerrado por diseño, mismo criterio que orden_compra.estado derivado
    de eventos de recepcion_orden_compra en 008."""

    __tablename__ = "ejecucion_pipeline_etl"

    id: Mapped[int] = mapped_column(primary_key=True)
    dag_run_id: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    fecha_inicio: Mapped[datetime] = mapped_column(nullable=False)
    fecha_fin: Mapped[datetime | None] = mapped_column(nullable=True)  # NULL mientras estado='en_progreso'
    estado: Mapped[str] = mapped_column(String(40), ForeignKey("estado_ejecucion.codigo"), nullable=False)
    sucursales_procesadas: Mapped[int] = mapped_column(nullable=False, default=0, server_default="0")
    filas_cargadas: Mapped[int] = mapped_column(nullable=False, default=0, server_default="0")
    mensaje_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index("ix_ejecucion_etl_fecha_inicio", "fecha_inicio"),
    )


class ValidacionCalidadDatos(Base):
    """Append-only. `regla_validada` sigue TEXT libre a propósito — lo
    escribe el propio DAG y crece con cada regla nueva, mismo argumento
    que `log_auditoria.accion` en 010."""

    __tablename__ = "validacion_calidad_datos"

    id: Mapped[int] = mapped_column(primary_key=True)
    ejecucion_id: Mapped[int] = mapped_column(ForeignKey("ejecucion_pipeline_etl.id"), nullable=False)
    regla_validada: Mapped[str] = mapped_column(Text, nullable=False)  # p.ej. 'sin_producto_id_nulo'
    aprobado: Mapped[bool] = mapped_column(nullable=False)
    detalle: Mapped[str | None] = mapped_column(Text, nullable=True)
    fecha: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())

    __table_args__ = (
        Index("ix_validacion_calidad_ejecucion", "ejecucion_id"),
    )


class VersionModeloMl(Base):
    """RN-AR-001 (índice único parcial): una sola versión activa por
    modelo a la vez — mismo patrón que turno_caja (006) y
    recomendacion_precio (003). Append-only: activar una versión nueva
    marca la anterior 'reemplazado' en la misma transacción."""

    __tablename__ = "version_modelo_ml"

    id: Mapped[int] = mapped_column(primary_key=True)
    modelo: Mapped[str] = mapped_column(String(40), ForeignKey("modelo_ml.codigo"), nullable=False)
    version: Mapped[str] = mapped_column(Text, nullable=False)  # p.ej. '2026.09.04-a'
    estado: Mapped[str] = mapped_column(String(60), ForeignKey("estado_version_modelo.codigo"), nullable=False)
    tamano_muestra: Mapped[int] = mapped_column(nullable=False)  # RNF-AR-002, Art. 5.9
    periodo_inicio: Mapped[date] = mapped_column(Date, nullable=False)
    periodo_fin: Mapped[date] = mapped_column(Date, nullable=False)
    # DEBE coincidir con modelo_ml.metrica_principal del modelo indicado
    # (RN-AR-004) — validado en servicio, no expresable como CHECK de una
    # sola fila (depende del valor de otra tabla).
    nombre_metrica: Mapped[str] = mapped_column(String(40), nullable=False)
    valor_metrica: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)  # NULL si descartado
    motivo: Mapped[str | None] = mapped_column(Text, nullable=True)
    fecha_entrenamiento: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())

    __table_args__ = (
        CheckConstraint(
            "estado != 'descartado_datos_insuficientes' OR motivo IS NOT NULL",
            name="ck_version_modelo_descartado_requiere_motivo",
        ),
        Index(
            "ux_version_modelo_activa",
            "modelo",
            unique=True,
            postgresql_where=text("estado = 'activo'"),
        ),
    )


class PreguntaAsistente(Base):
    """Append-only, mismo criterio de auditoría inmutable que
    log_auditoria (010), con tabla propia porque el contenido en lenguaje
    natural no encaja en la forma genérica accion/recurso/recurso_id.
    RNF-AR-003 (rol dueño exclusivo) se valida en servicio — no es un
    CHECK expresable sin consultar `usuario.rol`."""

    __tablename__ = "pregunta_asistente"

    id: Mapped[int] = mapped_column(primary_key=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuario.id"), nullable=False)
    pregunta_texto: Mapped[str] = mapped_column(Text, nullable=False)
    consulta_generada: Mapped[str] = mapped_column(Text, nullable=False)  # RN-AR-003
    respuesta_texto: Mapped[str] = mapped_column(Text, nullable=False)
    fecha: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())

    __table_args__ = (
        CheckConstraint("consulta_generada != ''", name="ck_pregunta_consulta_no_vacia"),
        Index("ix_pregunta_asistente_usuario_fecha", "usuario_id", "fecha"),
    )
