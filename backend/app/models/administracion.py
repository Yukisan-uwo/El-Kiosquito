"""
010-administracion — usuario/auth (JWT), RBAC, auditoría inmutable,
parámetros globales versionados y solicitudes ARCO.

Fuente: specs-v2/010-administracion/data-model.md (tras enmienda v1.1 de
catálogos maestros). `rol` y `recurso_sistema` son los dos catálogos más
transversales del proyecto — los consumen los 11 módulos vía scoping.py.
"""

from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.common import CatalogMixin

# ---------------------------------------------------------------------------
# Catálogos maestros (enmienda v1.1) — clave natural, seed en la migración
# ---------------------------------------------------------------------------


class Rol(CatalogMixin, Base):
    """Antes: CHECK de 4 roles escrito dos veces (usuario.rol y permiso_rol.rol)."""

    __tablename__ = "rol"

    codigo: Mapped[str] = mapped_column(String(40), primary_key=True)
    etiqueta: Mapped[str] = mapped_column(String(80), nullable=False)
    nivel_jerarquico: Mapped[int] = mapped_column(SmallInteger, nullable=False, unique=True)
    alcance_cadena: Mapped[bool] = mapped_column(Boolean, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "nivel_jerarquico BETWEEN 1 AND 99", name="ck_rol_nivel_jerarquico_rango"
        ),
    )


class RecursoSistema(CatalogMixin, Base):
    """Antes: TEXT libre duplicado en permiso_rol.recurso y log_auditoria.recurso."""

    __tablename__ = "recurso_sistema"

    codigo: Mapped[str] = mapped_column(String(60), primary_key=True)
    etiqueta: Mapped[str] = mapped_column(String(120), nullable=False)
    modulo: Mapped[str] = mapped_column(String(60), nullable=False)
    es_auditable: Mapped[bool] = mapped_column(Boolean, nullable=False)


class Operacion(CatalogMixin, Base):
    """No incluye 'eliminar' a propósito — Art. 2.4, borrado prohibido desde la app."""

    __tablename__ = "operacion"

    codigo: Mapped[str] = mapped_column(String(40), primary_key=True)
    etiqueta: Mapped[str] = mapped_column(String(80), nullable=False)
    es_escritura: Mapped[bool] = mapped_column(Boolean, nullable=False)


class TipoSolicitudArco(CatalogMixin, Base):
    codigo: Mapped[str] = mapped_column(String(40), primary_key=True)
    etiqueta: Mapped[str] = mapped_column(String(80), nullable=False)
    plazo_respuesta_dias: Mapped[int] = mapped_column(SmallInteger, nullable=False)

    __tablename__ = "tipo_solicitud_arco"
    __table_args__ = (
        CheckConstraint("plazo_respuesta_dias > 0", name="ck_tipo_arco_plazo_positivo"),
    )


class EstadoSolicitudArco(CatalogMixin, Base):
    __tablename__ = "estado_solicitud_arco"

    codigo: Mapped[str] = mapped_column(String(40), primary_key=True)
    etiqueta: Mapped[str] = mapped_column(String(80), nullable=False)
    es_estado_final: Mapped[bool] = mapped_column(Boolean, nullable=False)


# ---------------------------------------------------------------------------
# Tablas operativas
# ---------------------------------------------------------------------------


class Usuario(Base):
    __tablename__ = "usuario"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(Text, nullable=False)
    email: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    rol: Mapped[str] = mapped_column(String(40), ForeignKey("rol.codigo"), nullable=False)
    activo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    creado_en: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())


class UsuarioSucursal(Base):
    """RN-AD-001 (en servicio, no en CHECK: depende del valor de otra tabla) —
    nunca se inserta una fila aquí para un usuario cuyo rol tenga alcance_cadena."""

    __tablename__ = "usuario_sucursal"

    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuario.id"), primary_key=True)
    # FK externa a 009-expansion-sucursales — mismo Base compartido, se resuelve
    # por nombre de tabla sin importar el módulo Python que la declara.
    sucursal_id: Mapped[int] = mapped_column(ForeignKey("sucursal.id"), primary_key=True)
    asignado_en: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())


class PermisoRol(Base):
    """Sembrada por migración (Decisión 3) — sin endpoint de escritura."""

    __tablename__ = "permiso_rol"

    id: Mapped[int] = mapped_column(primary_key=True)
    rol: Mapped[str] = mapped_column(String(40), ForeignKey("rol.codigo"), nullable=False)
    recurso: Mapped[str] = mapped_column(String(60), ForeignKey("recurso_sistema.codigo"), nullable=False)
    operacion: Mapped[str] = mapped_column(String(40), ForeignKey("operacion.codigo"), nullable=False)
    permitido: Mapped[bool] = mapped_column(Boolean, nullable=False)

    __table_args__ = (
        UniqueConstraint("rol", "recurso", "operacion", name="ux_permiso_rol_recurso_operacion"),
    )


class LogAuditoria(Base):
    """Append-only, estrictamente (RNF-AD-001) — Art. 10.5."""

    __tablename__ = "log_auditoria"

    id: Mapped[int] = mapped_column(primary_key=True)
    usuario_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"), nullable=True)
    accion: Mapped[str] = mapped_column(Text, nullable=False)  # TEXT libre a propósito, ver enmienda §4
    recurso: Mapped[str] = mapped_column(String(60), ForeignKey("recurso_sistema.codigo"), nullable=False)
    recurso_id: Mapped[int | None] = mapped_column(nullable=True)
    sucursal_id: Mapped[int | None] = mapped_column(ForeignKey("sucursal.id"), nullable=True)
    detalle: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    exitoso: Mapped[bool] = mapped_column(Boolean, nullable=False)
    ip_origen: Mapped[str | None] = mapped_column(Text, nullable=True)
    creado_en: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())

    __table_args__ = (
        Index("ix_log_auditoria_usuario_creado", "usuario_id", "creado_en"),
        Index("ix_log_auditoria_sucursal_creado", "sucursal_id", "creado_en"),
        Index("ix_log_auditoria_exitoso_creado", "exitoso", "creado_en"),
    )


class HistorialParametroSistema(Base):
    """Append-only, mismo patrón que historial_costo_producto (008) e
    historial_precio_producto (003). Valor vigente: DISTINCT ON (clave)
    ORDER BY vigente_desde DESC."""

    __tablename__ = "historial_parametro_sistema"

    id: Mapped[int] = mapped_column(primary_key=True)
    clave: Mapped[str] = mapped_column(Text, nullable=False)
    valor: Mapped[str] = mapped_column(Text, nullable=False)
    vigente_desde: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    registrado_por: Mapped[int] = mapped_column(ForeignKey("usuario.id"), nullable=False)

    __table_args__ = (
        Index("ix_historial_parametro_clave_vigente", "clave", "vigente_desde"),
    )


class SolicitudArco(Base):
    """
    cliente_id referencia `cliente` (002-clientes-fidelizacion). La columna
    se creó sin FK en la migración de 010 porque `cliente` no existía
    todavía; la migración de 002 agrega la FK real con
    `ALTER TABLE solicitud_arco ADD CONSTRAINT ...` en cuanto esa tabla
    existe — el modelo ya la declara así porque 002 ya está construido.
    """

    __tablename__ = "solicitud_arco"

    id: Mapped[int] = mapped_column(primary_key=True)
    cliente_id: Mapped[int] = mapped_column(ForeignKey("cliente.id"), nullable=False)
    tipo: Mapped[str] = mapped_column(String(40), ForeignKey("tipo_solicitud_arco.codigo"), nullable=False)
    detalle: Mapped[str] = mapped_column(Text, nullable=False)
    estado: Mapped[str] = mapped_column(
        String(40), ForeignKey("estado_solicitud_arco.codigo"), nullable=False, default="pendiente", server_default="pendiente"
    )
    fecha_solicitud: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    fecha_resolucion: Mapped[datetime | None] = mapped_column(nullable=True)
    atendida_por: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"), nullable=True)
    respuesta: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        CheckConstraint(
            "estado = 'pendiente' OR (fecha_resolucion IS NOT NULL AND atendida_por IS NOT NULL)",
            name="ck_solicitud_arco_resuelta_completa",
        ),
    )
