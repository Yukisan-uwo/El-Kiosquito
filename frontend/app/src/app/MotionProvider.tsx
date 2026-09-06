import { MotionConfig } from 'motion/react'
import type { ReactNode } from 'react'

/**
 * Único lugar que lee `prefers-reduced-motion` (doc de diseño, sección 3 —
 * "un solo lugar que lee el media query, ningún componente lo consulta por
 * su cuenta"). `MotionConfig reducedMotion="user"` hace que Motion respete
 * la preferencia del SO automáticamente en todas las animaciones de
 * `motion.*` de la app.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}
