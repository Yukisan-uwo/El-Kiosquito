import { motion } from 'motion/react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, useAuth } from '@/auth/AuthContext'
import { rutaInicialParaRol } from '@/auth/roles'
import { Boton } from '@/components/ui/Boton'
import { LogoMarca } from '@/components/ui/LogoMarca'
import { MensajeError } from '@/components/ui/MensajeError'
import { fadeUp, stagger } from '@/motion/tokens'
import { CinematicaEntrada } from './CinematicaEntrada'

const CLAVE_INTRO_VISTA = 'elkiosquito.intro-vista'

export function Login() {
  const [mostrarIntro, setMostrarIntro] = useState(() => !sessionStorage.getItem(CLAVE_INTRO_VISTA))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mostrarPassword, setMostrarPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const { iniciarSesion, sesion } = useAuth()
  const navigate = useNavigate()

  if (sesion) {
    navigate(rutaInicialParaRol(sesion.rol), { replace: true })
    return null
  }

  function terminarIntro() {
    sessionStorage.setItem(CLAVE_INTRO_VISTA, '1')
    setMostrarIntro(false)
  }

  async function manejarEnvio(evento: React.FormEvent) {
    evento.preventDefault()
    setError(null)
    setEnviando(true)
    try {
      await iniciarSesion(email, password)
    } catch (err) {
      setError(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo iniciar sesión.')
    } finally {
      setEnviando(false)
    }
  }

  if (mostrarIntro) {
    return <CinematicaEntrada onTerminar={terminarIntro} />
  }

  return (
    <div className="flex min-h-screen bg-surface-bg">
      {/* Panel de marca (Tarea de diseño, 2026-09-06) — antes el login era
          una sola card flotando en un fondo vacío, sin nada que comunicara
          de qué sistema se trata antes de leer el formulario. Este panel
          solo aparece en pantallas grandes (lg+): en mobile el login sigue
          siendo la misma card centrada de siempre, sin recortar nada. Todo
          el color sale de los tokens del tema (Art. 11.2) — ningún hex
          suelto nuevo, mismo patrón de motivo repetido en trazo único que
          ya usa CinematicaEntrada, acá estático (decorativo, no movimiento
          sin propósito — Principio 3 del doc de diseño). */}
      <div className="relative hidden overflow-hidden bg-brand-deep lg:flex lg:w-[42%] lg:flex-col lg:justify-between lg:p-12">
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.07]"
          aria-hidden="true"
        >
          <defs>
            <pattern id="patron-kiosco" width="96" height="96" patternUnits="userSpaceOnUse">
              <path
                d="M12 76 L12 46 L34 28 L56 46 L56 76 M20 76 L20 58 L48 58 L48 76 M28 58 L28 46 L40 46 L40 58"
                stroke="var(--color-brand-primary-soft)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#patron-kiosco)" />
        </svg>

        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0, 0, 0.2, 1] }}
          className="relative flex items-center gap-2.5"
        >
          <LogoMarca tamano={40} />
          <p className="font-display text-display-lg text-white">El Kiosquito</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1, ease: [0, 0, 0.2, 1] }}
          className="relative max-w-sm"
        >
          <p className="font-display text-display-xl text-white">
            Gestión completa de tu kiosco, en un solo lugar.
          </p>
          <p className="mt-3 text-body text-brand-primary-soft/80">
            Ventas, inventario, caja, compras y sucursales — todo lo que necesitás
            para operar, con los datos reales de cada turno.
          </p>
        </motion.div>

        <p className="relative text-body-sm text-brand-primary-soft/60">
          El Kiosquito — Construcción de Software, UTEQ
        </p>
      </div>

      <div className="flex w-full items-center justify-center px-4 py-12 lg:w-[58%]">
        <motion.div
          variants={stagger}
          initial="hidden"
          animate="visible"
          className="w-full max-w-sm rounded-2xl border-2 border-amber-200/90 bg-white p-8 shadow-sm"
        >
          <motion.div variants={fadeUp} className="mb-1 flex items-center gap-2 lg:hidden">
            <LogoMarca tamano={36} />
            <p className="font-display text-display-lg text-brand-deep">El Kiosquito</p>
          </motion.div>
          <motion.p variants={fadeUp} className="mb-6 text-body text-text-secondary">
            Iniciá sesión para continuar
          </motion.p>

          <form onSubmit={manejarEnvio} className="space-y-4">
            <motion.div variants={fadeUp}>
              <label htmlFor="email" className="mb-1 block text-label uppercase text-text-secondary">
                Correo
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(evento) => setEmail(evento.target.value)}
                className="w-full rounded-xl border-2 border-amber-200/90 bg-white px-3 py-2.5 text-body focus:border-brand-primary"
              />
            </motion.div>
            <motion.div variants={fadeUp}>
              <label htmlFor="password" className="mb-1 block text-label uppercase text-text-secondary">
                Contraseña
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={mostrarPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(evento) => setPassword(evento.target.value)}
                  className="w-full rounded-xl border-2 border-amber-200/90 bg-white px-3 py-2.5 pr-10 text-body focus:border-brand-primary"
                />
                <button
                  type="button"
                  onClick={() => setMostrarPassword((prev) => !prev)}
                  aria-label={mostrarPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-text-secondary hover:text-brand-deep focus:outline-none transition-colors"
                >
                  {mostrarPassword ? (
                    <svg
                      className="h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                    </svg>
                  )}
                </button>
              </div>
            </motion.div>

            {error && (
              <motion.div variants={fadeUp}>
                <MensajeError mensaje={error} />
              </motion.div>
            )}

            <motion.div variants={fadeUp}>
              <Boton type="submit" disabled={enviando} className="w-full">
                {enviando ? 'Ingresando...' : 'Ingresar'}
              </Boton>
            </motion.div>
          </form>
        </motion.div>
      </div>
    </div>
  )
}
