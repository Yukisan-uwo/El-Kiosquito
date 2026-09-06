import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { apiFetch, ApiError, registrarManejadorNoAutorizado, registrarTokenProvider } from '@/api/client'
import { decodificarClaims, tokenVencido, type ClaimsJwt } from './jwt'
import { esCodigoRolConocido, type CodigoRol } from './roles'

const CLAVE_STORAGE = 'elkiosquito.token'

interface SesionUsuario {
  token: string
  claims: ClaimsJwt
  rol: CodigoRol
}

interface AuthContextValor {
  sesion: SesionUsuario | null
  cargandoSesionInicial: boolean
  iniciarSesion: (email: string, password: string) => Promise<void>
  cerrarSesion: () => void
}

const AuthContext = createContext<AuthContextValor | null>(null)

function construirSesion(token: string): SesionUsuario {
  const claims = decodificarClaims(token)
  if (!esCodigoRolConocido(claims.rol)) {
    throw new Error(`El backend emitió un rol que el frontend no conoce: "${claims.rol}"`)
  }
  return { token, claims, rol: claims.rol }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<SesionUsuario | null>(null)
  const [cargandoSesionInicial, setCargandoSesionInicial] = useState(true)

  const cerrarSesion = useCallback(() => {
    sessionStorage.removeItem(CLAVE_STORAGE)
    setSesion(null)
  }, [])

  // Restaura la sesión al recargar la página (sessionStorage: dura el
  // turno/pestaña, nunca sobrevive a cerrar el navegador — mismo criterio
  // que la cinemática de login, RN de UX, no de seguridad: la seguridad
  // real la sigue validando el backend en cada request).
  useEffect(() => {
    const tokenGuardado = sessionStorage.getItem(CLAVE_STORAGE)
    if (tokenGuardado) {
      try {
        const nuevaSesion = construirSesion(tokenGuardado)
        if (!tokenVencido(nuevaSesion.claims)) {
          setSesion(nuevaSesion)
        } else {
          sessionStorage.removeItem(CLAVE_STORAGE)
        }
      } catch {
        sessionStorage.removeItem(CLAVE_STORAGE)
      }
    }
    setCargandoSesionInicial(false)
  }, [])

  useEffect(() => {
    registrarTokenProvider(() => sesion?.token ?? null)
  }, [sesion])

  useEffect(() => {
    registrarManejadorNoAutorizado(() => cerrarSesion())
  }, [cerrarSesion])

  const iniciarSesion = useCallback(async (email: string, password: string) => {
    const respuesta = await apiFetch<{ access_token: string; token_type: string }>('/auth/login', {
      method: 'POST',
      body: { email, password },
      sinAuth: true,
    })
    const nuevaSesion = construirSesion(respuesta.access_token)
    sessionStorage.setItem(CLAVE_STORAGE, respuesta.access_token)
    setSesion(nuevaSesion)
  }, [])

  const valor = useMemo(
    () => ({ sesion, cargandoSesionInicial, iniciarSesion, cerrarSesion }),
    [sesion, cargandoSesionInicial, iniciarSesion, cerrarSesion],
  )

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValor {
  const contexto = useContext(AuthContext)
  if (!contexto) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return contexto
}

export { ApiError }
