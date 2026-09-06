import type { ReactNode } from 'react'

interface EstadoVacioProps {
  /** Qué significa este vacío — nunca "no hay datos" a secas (doc de
   * diseño, sección 4.5). */
  titulo: string
  descripcion: string
  accion?: ReactNode
}

export function EstadoVacio({ titulo, descripcion, accion }: EstadoVacioProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-brand-primary-soft bg-surface-card p-12 text-center">
      <p className="text-title text-text-primary">{titulo}</p>
      <p className="max-w-sm text-body text-text-secondary">{descripcion}</p>
      {accion && <div className="mt-3">{accion}</div>}
    </div>
  )
}
