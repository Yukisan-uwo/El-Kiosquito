import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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

function recuperarTokenDeStorage(): string | null {
  try {
    const token = localStorage.getItem(CLAVE_STORAGE) || sessionStorage.getItem(CLAVE_STORAGE)
    if (token && !localStorage.getItem(CLAVE_STORAGE)) {
      localStorage.setItem(CLAVE_STORAGE, token)
    }
    return token
  } catch {
    return null
  }
}

function limpiarTokenDeStorage(): void {
  try {
    localStorage.removeItem(CLAVE_STORAGE)
    sessionStorage.removeItem(CLAVE_STORAGE)
  } catch {
    // Ignorar si el storage no está accesible
  }
}

function guardarTokenEnStorage(token: string): void {
  try {
    localStorage.setItem(CLAVE_STORAGE, token)
    sessionStorage.setItem(CLAVE_STORAGE, token)
  } catch {
    // Ignorar si el storage no está accesible
  }
}

function recuperarSesionGuardada(): SesionUsuario | null {
  const tokenGuardado = recuperarTokenDeStorage()
  if (!tokenGuardado) return null
  try {
    const sesionRestaurada = construirSesion(tokenGuardado)
    if (!tokenVencido(sesionRestaurada.claims)) {
      return sesionRestaurada
    }
    limpiarTokenDeStorage()
    return null
  } catch {
    limpiarTokenDeStorage()
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Restaura la sesión sincrónicamente al recargar la página:
  // Como el JWT dura 8 horas (ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 8 en el backend),
  // el usuario no debe ser deslogueado al refrescar la pantalla.
  // La inicialización sincrónica previene la condición de carrera donde los
  // componentes hijos montados en la ruta protegida lanzaban peticiones a la API
  // antes de que el efecto restaurara el token, recibiendo 401 y provocando un logout no deseado.
  const [sesion, setSesion] = useState<SesionUsuario | null>(() => recuperarSesionGuardada())
  const [cargandoSesionInicial] = useState(false)

  const sesionRef = useRef<SesionUsuario | null>(sesion)
  sesionRef.current = sesion

  // Garantizar que el cliente API tenga acceso al token de inmediato
  registrarTokenProvider(() => sesionRef.current?.token ?? recuperarTokenDeStorage())

  const cerrarSesion = useCallback(() => {
    limpiarTokenDeStorage()
    sesionRef.current = null
    setSesion(null)
  }, [])

  useEffect(() => {
    registrarTokenProvider(() => sesionRef.current?.token ?? recuperarTokenDeStorage())
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
    guardarTokenEnStorage(respuesta.access_token)
    sesionRef.current = nuevaSesion
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
