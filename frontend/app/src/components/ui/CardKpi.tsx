import { motion } from 'motion/react'
import { scaleIn } from '@/motion/tokens'

interface OrigenMl {
  tamanoMuestra: number
  periodoDesde: string
  periodoHasta: string
}

interface CardKpiProps {
  etiqueta: string
  cifra: string
  /** Comparación contra el periodo anterior — principio de Stripe del doc
   * de diseño: "¿esto es bueno?" sin salir de la card. */
  comparacion?: { texto: string; favorable: boolean }
  /** Si el dato viene de un modelo de ML, el pie con tamaño de muestra y
   * periodo es OBLIGATORIO — Art. 5.6/5.9, no es un detalle visual. */
  origenMl?: OrigenMl
}

export function CardKpi({ etiqueta, cifra, comparacion, origenMl }: CardKpiProps) {
  return (
    <motion.div
      variants={scaleIn}
      initial="hidden"
      animate="visible"
      className="rounded-[var(--radius-card)] bg-surface-card p-6 shadow-[var(--shadow-elevation-1)]"
    >
      <p className="text-label uppercase text-text-secondary">{etiqueta}</p>
      <p className="mt-2 font-display text-display-lg text-text-primary">{cifra}</p>
      {comparacion && (
        <p className={`mt-1 text-body-sm ${comparacion.favorable ? 'text-status-success' : 'text-status-danger'}`}>
          {comparacion.texto}
        </p>
      )}
      {origenMl && (
        <p className="mt-3 border-t border-surface-bg pt-2 text-body-sm text-text-secondary">
          Basado en {origenMl.tamanoMuestra} muestras · {origenMl.periodoDesde} a {origenMl.periodoHasta}
        </p>
      )}
    </motion.div>
  )
}
