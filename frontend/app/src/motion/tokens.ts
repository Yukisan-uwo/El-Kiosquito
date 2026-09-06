/**
 * Catálogo CERRADO de movimiento (doc de proyecto "Sistema de Diseño
 * Frontend", sección 3). Ningún componente define un `duration`/`ease`
 * suelto — todo sale de acá. Si una situación no está en el catálogo de
 * usos del doc, no se anima.
 */
import type { Variants, Transition } from 'motion/react'

export const duration = { fast: 0.15, base: 0.25, slow: 0.4 } as const

export const ease = {
  standard: [0.4, 0, 0.2, 1],
  enter: [0, 0, 0.2, 1],
  exit: [0.4, 0, 1, 1],
} as const

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: duration.base, ease: ease.enter } as Transition,
  },
}

export const stagger: Variants = {
  visible: { transition: { staggerChildren: 0.04 } },
}

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.97 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: duration.fast, ease: ease.enter } as Transition,
  },
}

/** Overlay de modal/drawer: fade invertido respecto al contenido. */
export const overlayFade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: duration.fast } },
  exit: { opacity: 0, transition: { duration: duration.fast, ease: ease.exit } as Transition },
}

/** Toast: entra desde abajo, nunca bloquea la siguiente acción del usuario. */
export const toastSlideUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: duration.base, ease: ease.enter } as Transition },
  exit: { opacity: 0, transition: { duration: duration.fast, ease: ease.exit } as Transition },
}
