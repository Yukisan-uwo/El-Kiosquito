type ColorSemantico = 'success' | 'danger' | 'warning' | 'info'

interface BadgeEstadoProps {
  /** Texto que viene SIEMPRE de un catálogo de datos real (estado_venta,
   * estado_orden_compra, etc.) — este componente nunca decide el texto,
   * solo el mapeo color <-> significado (doc de diseño, sección 4.2). */
  texto: string
  color: ColorSemantico
}

const CLASES_POR_COLOR: Record<ColorSemantico, string> = {
  success: 'bg-status-success-soft text-status-success',
  danger: 'bg-status-danger-soft text-status-danger',
  warning: 'bg-status-warning-soft text-status-warning',
  info: 'bg-status-info-soft text-status-info',
}

export function BadgeEstado({ texto, color }: BadgeEstadoProps) {
  return (
    <span
      className={`inline-flex items-center rounded-[var(--radius-pill)] px-2.5 py-1 text-label ${CLASES_POR_COLOR[color]}`}
    >
      {texto}
    </span>
  )
}
