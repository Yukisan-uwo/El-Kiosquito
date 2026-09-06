import { motion } from 'motion/react'
import { useEffect } from 'react'

interface CinematicaEntradaProps {
  onTerminar: () => void
}

/**
 * Doc de diseño, sección 5. El documento pide un Lottie corto del isotipo
 * dibujándose — como no hay un archivo .json de Lottie real entregado por
 * diseño todavía, se logra el mismo efecto (trazo dibujándose + barrido de
 * degradé) con un SVG animado por `pathLength` de Motion: mismo resultado
 * visual, sin inventar un asset externo que no existe. El día que haya un
 * Lottie real, este componente es el único lugar que hay que reemplazar.
 *
 * 100% omitible con un clic o cualquier tecla — requisito no negociable
 * del Art. 5.4. `prefers-reduced-motion` ya lo maneja MotionProvider, pero
 * acá además saltamos directo (mismo resultado que "ya vio la animación").
 */
export function CinematicaEntrada({ onTerminar }: CinematicaEntradaProps) {
  useEffect(() => {
    const prefiereReducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefiereReducido) {
      onTerminar()
      return
    }
    const manejarOmitir = () => onTerminar()
    window.addEventListener('keydown', manejarOmitir)
    const temporizador = window.setTimeout(onTerminar, 1200)
    return () => {
      window.removeEventListener('keydown', manejarOmitir)
      window.clearTimeout(temporizador)
    }
  }, [onTerminar])

  return (
    <div
      className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-surface-bg"
      onClick={onTerminar}
      role="button"
      tabIndex={0}
      aria-label="Omitir animación de entrada"
    >
      <motion.div
        className="pointer-events-none absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.08, 0] }}
        transition={{ duration: 0.9, times: [0, 0.5, 1], delay: 0.3 }}
        style={{ background: 'linear-gradient(120deg, var(--color-brand-primary), var(--color-brand-accent))' }}
      />
      <svg width="120" height="120" viewBox="0 0 120 120" fill="none" aria-hidden="true">
        {/* Isotipo simplificado: un kiosco de trazo único, no un logo genérico girando. */}
        <motion.path
          d="M20 100 L20 55 L60 25 L100 55 L100 100 M35 100 L35 70 L85 70 L85 100 M50 70 L50 55 L70 55 L70 70"
          stroke="var(--color-brand-primary)"
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.6, ease: [0, 0, 0.2, 1] }}
        />
      </svg>
      <p className="absolute bottom-10 text-body-sm text-text-secondary">
        Clic o cualquier tecla para omitir
      </p>
    </div>
  )
}
