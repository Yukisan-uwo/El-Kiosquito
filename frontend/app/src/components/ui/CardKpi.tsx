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
      className="rounded-2xl border-2 border-amber-200/90 bg-white p-5 shadow-2xs transition-all hover:border-amber-300/90 hover:shadow-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-label uppercase tracking-wider text-text-secondary font-semibold">{etiqueta}</p>
        <span className="h-2 w-2 rounded-full bg-brand-primary/60" />
      </div>
      <p className="mt-2 font-display text-display-lg text-brand-deep font-bold">{cifra}</p>
      {comparacion && (
        <p className={`mt-2 inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-body-sm font-medium ${
          comparacion.favorable
            ? 'bg-emerald-50 text-status-success border border-emerald-200/60'
            : 'bg-rose-50 text-status-danger border border-rose-200/60'
        }`}>
          {comparacion.texto}
        </p>
      )}
      {origenMl && (
        <p className="mt-3 border-t border-amber-100 pt-2 text-body-sm text-text-secondary">
          Basado en {origenMl.tamanoMuestra} muestras · {origenMl.periodoDesde} a {origenMl.periodoHasta}
        </p>
      )}
    </motion.div>
  )
}
