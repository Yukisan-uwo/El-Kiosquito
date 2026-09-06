import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { rolPuedeVerModulo, type CodigoModulo } from '@/auth/roles'

interface RutaProtegidaProps {
  modulo: CodigoModulo
  children: ReactNode
}

/**
 * Enforcement real de scoping por rol en el router: si el rol no puede ver
 * el módulo, la ruta NUNCA se renderiza (ni siquiera de forma deshabilitada)
 * — redirige. La autorización real la sigue validando cada endpoint del
 * backend; esto es la capa de navegación (frontend/prompt-interfaces-ia.md,
 * sección 1: "un cajero nunca ve un menú... porque no se renderiza").
 */
export function RutaProtegida({ modulo, children }: RutaProtegidaProps) {
  const { sesion, cargandoSesionInicial } = useAuth()

  if (cargandoSesionInicial) return null
  if (!sesion) return <Navigate to="/login" replace />
  if (!rolPuedeVerModulo(sesion.rol, modulo)) return <Navigate to="/" replace />

  return <>{children}</>
}
