"""
006-caja-mermas-fraude — turno de caja (con cuadre), alertas de fraude en
pago (escritura cruzada con 001), mermas (con causa atribuible o no a una
persona) e incidencias de cuadre detectadas por Isolation Forest.

Fuente: el-kiosquito-006-caja-mermas-fraude-data-model.md (tras enmienda
v1.2 de catálogos maestros).

Cierra la FK diferida de `venta.turno_caja_id` (001) ahora que
`turno_caja` existe (ver migración) — mismo patrón que 002 y 005 antes.

Escritura cruzada documentada (Decisión 3 del data-model): el único
`INSERT` en `alerta_fraude_pago` lo hace el servicio de ventas de
001-core-ventas-inventario al procesar el pago; el `UPDATE` de atención
(estado/atendida_en/atendida_por) lo hace exclusivamente este módulo. Es
la única tabla de todo el proyecto escrita por dos módulos distintos.
"""

from datetime import datetime

from sqlalchemy import (
    CHAR,
    Boolean,
    CheckConstraint,
    Computed,
    ForeignKey,
    Index,
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
# Catálogos maestros (enmienda v1.2)
# ---------------------------------------------------------------------------


class CausaMerma(CatalogMixin, Base):
    """`es_atribuible_a_persona` es el atributo más importante de toda la
    enmienda transversal: separa robo externo/caducidad (sin responsable
    interno) de error humano/fraude interno (sí lo hay) — sin esta
    columna, el cruce merma × cuadre de caja de OT3.4 enumera códigos a
    mano en cada consulta."""

    __tablename__ = "causa_merma"

    codigo: Mapped[str] = mapped_column(String(40), primary_key=True)
    etiqueta: Mapped[str] = mapped_column(String(80), nullable=False)
    es_atribuible_a_persona: Mapped[bool] = mapped_column(Boolean, nullable=False)
    # RN-CMF-003: 'caducidad' es la única causa que normalmente no exige
    # investigación — la explicación ya está en la fecha del lote.
    requiere_investigacion: Mapped[bool] = mapped_column(Boolean, nullable=False)


class ResultadoInvestigacion(CatalogMixin, Base):
    """Tabla y columna `merma.resultado_investigacion` comparten nombre a
    propósito — válido en Postgres (namespaces distintos), mantiene el
    contrato ya publicado sin romper consultas existentes."""

    __tablename__ = "resultado_investigacion"

    codigo: Mapped[str] = mapped_column(String(40), primary_key=True)
    etiqueta: Mapped[str] = mapped_column(String(80), nullable=False)
    cierra_investigacion: Mapped[bool] = mapped_column(Boolean, nullable=False)


class EstadoTurno(CatalogMixin, Base):
    __tablename__ = "estado_turno"

    codigo: Mapped[str] = mapped_column(String(40), primary_key=True)
    etiqueta: Mapped[str] = mapped_column(String(80), nullable=False)
    es_estado_final: Mapped[bool] = mapped_column(Boolean, nullable=False)
    # Saca del código la condición que 001 valida al registrar una venta
    # contra un turno_caja_id — solo 'abierto' es true.
    admite_ventas: Mapped[bool] = mapped_column(Boolean, nullable=False)


class EstadoAlerta(CatalogMixin, Base):
    __tablename__ = "estado_alerta"

    codigo: Mapped[str] = mapped_column(String(40), primary_key=True)
    etiqueta: Mapped[str] = mapped_column(String(80), nullable=False)
    es_estado_final: Mapped[bool] = mapped_column(Boolean, nullable=False)


class EstadoIncidencia(CatalogMixin, Base):
    """Deliberadamente separado de `estado_alerta` aunque hoy los valores
    sean equivalentes: son procesos distintos (fraude en pago vs. cuadre
    de caja) — unificarlos filtraría un estado nuevo de uno hacia el otro
    el día que alguno lo necesite."""

    __tablename__ = "estado_incidencia"

    codigo: Mapped[str] = mapped_column(String(40), primary_key=True)
    etiqueta: Mapped[str] = mapped_column(String(80), nullable=False)
    es_estado_final: Mapped[bool] = mapped_column(Boolean, nullable=False)


# ---------------------------------------------------------------------------
# Tablas operativas
# ---------------------------------------------------------------------------


class TurnoCaja(Base):
    """Append-only una vez cerrado (RNF-CMF-001): ningún endpoint permite
    reabrir ni editar un turno con estado='cerrado'. `diferencia` es
    GENERATED, igual que `venta.numero_documento` en 001."""

    __tablename__ = "turno_caja"

    id: Mapped[int] = mapped_column(primary_key=True)
    sucursal_id: Mapped[int] = mapped_column(ForeignKey("sucursal.id"), nullable=False)
    cajero_id: Mapped[int] = mapped_column(ForeignKey("usuario.id"), nullable=False)
    hora_apertura: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    monto_inicial: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    hora_cierre: Mapped[datetime | None] = mapped_column(nullable=True)
    monto_contado: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)  # obligatorio al cerrar
    # Calculado y guardado SOLO al cerrar, sumando las ventas en efectivo
    # del turno (consultadas en 001) — no es un valor derivable en la BD.
    monto_esperado: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    diferencia: Mapped[float | None] = mapped_column(
        Numeric(10, 2), Computed("monto_contado - monto_esperado", persisted=True), nullable=True
    )
    motivo_diferencia: Mapped[str | None] = mapped_column(Text, nullable=True)  # RN-CMF-002
    estado: Mapped[str] = mapped_column(
        String(40), ForeignKey("estado_turno.codigo"), nullable=False, default="abierto", server_default="abierto"
    )

    __table_args__ = (
        CheckConstraint("monto_inicial >= 0", name="ck_turno_monto_inicial_no_negativo"),
        CheckConstraint("monto_contado IS NULL OR monto_contado >= 0", name="ck_turno_monto_contado_no_negativo"),
        CheckConstraint(
            "estado <> 'cerrado' OR diferencia = 0 OR motivo_diferencia IS NOT NULL",
            name="ck_turno_diferencia_requiere_motivo",
        ),
        Index("ix_turno_sucursal_estado", "sucursal_id", "estado"),
        # RN-CMF-001 — un cajero no puede tener dos turnos abiertos a la vez.
        Index(
            "ux_turno_cajero_abierto",
            "cajero_id",
            unique=True,
            postgresql_where=text("estado = 'abierto'"),
        ),
    )


class AlertaFraudePago(Base):
    """Ver docstring del módulo: única tabla del proyecto escrita por dos
    módulos (001 hace el INSERT, este módulo hace el UPDATE de atención)."""

    __tablename__ = "alerta_fraude_pago"

    id: Mapped[int] = mapped_column(primary_key=True)
    venta_id: Mapped[int] = mapped_column(ForeignKey("venta.id"), nullable=False)
    motivo: Mapped[str] = mapped_column(Text, nullable=False)
    estado: Mapped[str] = mapped_column(
        String(40), ForeignKey("estado_alerta.codigo"), nullable=False, default="abierta", server_default="abierta"
    )
    # NUNCA el número completo de tarjeta (Art. 10.8, RNF-CMF-003).
    ultimos_4_digitos: Mapped[str | None] = mapped_column(CHAR(4), nullable=True)
    # Respuesta del proveedor sandbox (Art. 8.2) — no es un dato bancario real.
    codigo_respuesta_proveedor: Mapped[str | None] = mapped_column(Text, nullable=True)
    creada_en: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    atendida_en: Mapped[datetime | None] = mapped_column(nullable=True)
    atendida_por: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"), nullable=True)

    __table_args__ = (
        Index("ix_alerta_fraude_estado", "estado"),
        Index("ix_alerta_fraude_venta", "venta_id"),
    )


class Merma(Base):
    __tablename__ = "merma"

    id: Mapped[int] = mapped_column(primary_key=True)
    producto_id: Mapped[int] = mapped_column(ForeignKey("producto.id"), nullable=False)
    sucursal_id: Mapped[int] = mapped_column(ForeignKey("sucursal.id"), nullable=False)
    cantidad: Mapped[float] = mapped_column(Numeric(10, 3), nullable=False)
    valor_estimado: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    causa: Mapped[str | None] = mapped_column(String(40), ForeignKey("causa_merma.codigo"), nullable=True)  # RF-CMF-006
    resultado_investigacion: Mapped[str | None] = mapped_column(
        String(40), ForeignKey("resultado_investigacion.codigo"), nullable=True
    )
    fecha_deteccion: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    fecha_resultado: Mapped[datetime | None] = mapped_column(nullable=True)
    registrado_por: Mapped[int] = mapped_column(ForeignKey("usuario.id"), nullable=False)
    investigado_por: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"), nullable=True)

    __table_args__ = (
        CheckConstraint("cantidad > 0", name="ck_merma_cantidad_positiva"),
        CheckConstraint("valor_estimado > 0", name="ck_merma_valor_positivo"),
        CheckConstraint(
            "resultado_investigacion IS NULL OR causa IS NOT NULL", name="ck_merma_resultado_requiere_causa"
        ),
        Index("ix_merma_sucursal_causa_fecha", "sucursal_id", "causa", "fecha_deteccion"),
    )


class IncidenciaCuadreCaja(Base):
    """Nunca modifica `turno_caja` (RNF-CMF-002, Decisión 2) — es la única
    forma en que el modelo de detección de anomalías interactúa con los
    cuadres de caja."""

    __tablename__ = "incidencia_cuadre_caja"

    id: Mapped[int] = mapped_column(primary_key=True)
    turno_caja_id: Mapped[int] = mapped_column(ForeignKey("turno_caja.id"), nullable=False)
    score_anomalia: Mapped[float] = mapped_column(Numeric(5, 4), nullable=False)  # score de Isolation Forest
    justificacion: Mapped[str] = mapped_column(Text, nullable=False)  # Art. 5.9
    estado: Mapped[str] = mapped_column(
        String(40), ForeignKey("estado_incidencia.codigo"), nullable=False,
        default="pendiente", server_default="pendiente",
    )
    fecha_deteccion: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    atendida_por: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"), nullable=True)
    fecha_atencion: Mapped[datetime | None] = mapped_column(nullable=True)

    __table_args__ = (
        CheckConstraint("length(justificacion) >= 10", name="ck_incidencia_justificacion_minima"),
        Index("ix_incidencia_estado", "estado"),
        # RN-CMF-005 — nunca dos incidencias pendientes del mismo turno.
        Index(
            "ux_incidencia_turno_pendiente",
            "turno_caja_id",
            unique=True,
            postgresql_where=text("estado = 'pendiente'"),
        ),
    )


class PuntoControlHorarioTurno(Base):
    """Estrictamente append-only y de generación exclusivamente automática
    (RN-CMF-006, enmienda v1.1): sin PATCH/DELETE ni POST accesible por un
    rol humano — el único INSERT lo hace el job programado (research.md,
    Decisión 5). No modifica turno_caja, igual que IncidenciaCuadreCaja."""

    __tablename__ = "punto_control_horario_turno"

    id: Mapped[int] = mapped_column(primary_key=True)
    turno_caja_id: Mapped[int] = mapped_column(ForeignKey("turno_caja.id"), nullable=False)
    hora_checkpoint: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    # Mismo cálculo que turno_caja.monto_esperado, tomado a mitad de turno.
    monto_esperado_acumulado: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    generado_en: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())

    __table_args__ = (
        CheckConstraint("monto_esperado_acumulado >= 0", name="ck_punto_control_monto_no_negativo"),
        Index("ix_punto_control_turno_hora", "turno_caja_id", "hora_checkpoint"),
    )


class ArqueoParcialTurno(Base):
    """Cuadre de caja realmente horario (enmienda 2026-09-05, auditoría de
    riesgos derivados) — a diferencia de `punto_control_horario_turno`
    (Decisión 5 de research.md, exclusivamente automático, sin conteo
    físico), esta tabla SÍ registra un conteo real de efectivo a mitad de
    turno. No es un job obligatorio ni una carga operativa nueva por hora:
    es una herramienta que un cajero (contar su propia caja) o un
    encargado de sucursal (spot-check de supervisión, sin previo aviso)
    puede usar cuando quiera durante un turno abierto — la decisión
    original de no obligar un conteo cada hora sigue vigente, esto agrega
    la posibilidad real de hacerlo, no la obligación.

    Append-only, igual que `punto_control_horario_turno` — nunca modifica
    `turno_caja`. `diferencia` es GENERATED, mismo patrón que `turno_caja.
    diferencia`."""

    __tablename__ = "arqueo_parcial_turno"

    id: Mapped[int] = mapped_column(primary_key=True)
    turno_caja_id: Mapped[int] = mapped_column(ForeignKey("turno_caja.id"), nullable=False)
    monto_esperado_acumulado: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    monto_contado: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    diferencia: Mapped[float] = mapped_column(
        Numeric(10, 2), Computed("monto_contado - monto_esperado_acumulado", persisted=True), nullable=False
    )
    motivo_diferencia: Mapped[str | None] = mapped_column(Text, nullable=True)
    registrado_por: Mapped[int] = mapped_column(ForeignKey("usuario.id"), nullable=False)
    hora_arqueo: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())

    __table_args__ = (
        CheckConstraint("monto_contado >= 0", name="ck_arqueo_parcial_monto_no_negativo"),
        CheckConstraint("diferencia = 0 OR motivo_diferencia IS NOT NULL", name="ck_arqueo_parcial_diferencia_requiere_motivo"),
        Index("ix_arqueo_parcial_turno_hora", "turno_caja_id", "hora_arqueo"),
    )
