import type { ButtonHTMLAttributes, ReactNode } from 'react'

type VarianteBoton = 'primario' | 'secundario' | 'ghost' | 'peligro'

interface BotonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBoton
  children: ReactNode
}

const CLASES_BASE =
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-card)] px-4 py-2.5 text-body font-medium ' +
  'transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed'

// Doc de diseño, sección 4.1 — 4 variantes cerradas, nada de una quinta
// "outline azul" genérica. Peligro nunca comparte color con un badge de
// estado (ver Badge.tsx) para no confundir "botón que anula" con "fila
// anulada".
const CLASES_POR_VARIANTE: Record<VarianteBoton, string> = {
  primario: 'bg-brand-primary text-white hover:bg-brand-primary-text',
  secundario: 'border border-brand-primary text-brand-primary-text bg-transparent hover:bg-brand-primary-soft',
  ghost: 'text-text-secondary hover:bg-surface-bg',
  peligro: 'bg-status-danger text-white hover:brightness-95',
}

export function Boton({ variante = 'primario', className = '', children, ...resto }: BotonProps) {
  return (
    <button className={`${CLASES_BASE} ${CLASES_POR_VARIANTE[variante]} ${className}`} {...resto}>
      {children}
    </button>
  )
}
