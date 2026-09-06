import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// @testing-library/react solo registra su limpieza automática vía el
// `afterEach` global cuando `test.globals: true` está activo en
// vite.config.ts — acá no lo está, así que hay que registrarla a mano.
// Sin esto, el DOM de un test queda montado para el siguiente test del
// mismo archivo ("Found multiple elements..." fue exactamente ese síntoma
// en AuthContext.test.tsx, Login.test.tsx y componentes.test.tsx).
afterEach(() => {
  cleanup()
})

// jsdom no implementa matchMedia — MotionProvider (`reducedMotion="user"`)
// y CinematicaEntrada.tsx lo llaman directamente para leer
// prefers-reduced-motion. Sin este polyfill, cualquier test que monte esos
// componentes explota con "window.matchMedia is not a function" (nunca
// ocurre en un navegador real, donde sí existe).
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}
