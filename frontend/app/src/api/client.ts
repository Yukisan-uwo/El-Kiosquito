/**
 * Cliente HTTP tipado contra la API real de El Kiosquito (FastAPI,
 * `/api/v1`). Nunca inventa datos ante un error — todo error de red o de
 * negocio se propaga como `ApiError` con el `detail` real del backend
 * (Art. 5.9: la honestidad de los datos empieza por no disfrazar un
 * fallo como un estado vacío legítimo).
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1'

export class ApiError extends Error {
  readonly status: number
  readonly detail: unknown

  constructor(status: number, detail: unknown) {
    super(typeof detail === 'string' ? detail : `Error HTTP ${status}`)
    this.status = status
    this.detail = detail
  }

  /** Mensaje pensado para mostrar al usuario — nunca un stack técnico crudo. */
  get mensajeUsuario(): string {
    if (typeof this.detail === 'string') return this.detail
    if (Array.isArray(this.detail)) {
      // Forma de error de validación de Pydantic (422): [{loc, msg, type}, ...]
      const primero = this.detail[0] as { msg?: string; loc?: unknown[] } | undefined
      if (primero?.msg) {
        const campo = Array.isArray(primero.loc) ? primero.loc.at(-1) : undefined
        return campo ? `${campo}: ${primero.msg}` : primero.msg
      }
    }
    if (this.status === 401) return 'Tu sesión venció o las credenciales no son válidas.'
    if (this.status === 403) return 'No tenés permiso para esta acción.'
    if (this.status === 404) return 'No se encontró el recurso solicitado.'
    return 'Ocurrió un error inesperado. Intentá de nuevo.'
  }
}

export type TokenProvider = () => string | null

let obtenerToken: TokenProvider = () => {
  try {
    return localStorage.getItem('elkiosquito.token') || sessionStorage.getItem('elkiosquito.token')
  } catch {
    return null
  }
}

/** Lo llama AuthProvider para proveer el token activo en cada petición. */
export function registrarTokenProvider(provider: TokenProvider): void {
  obtenerToken = provider
}

let manejadorNoAutorizado: (() => void) | null = null
export function registrarManejadorNoAutorizado(fn: () => void): void {
  manejadorNoAutorizado = fn
}

interface OpcionesRequest {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | boolean | undefined>
  /** true para POST /auth/login, el único endpoint sin Bearer. */
  sinAuth?: boolean
}

function construirQueryString(query?: OpcionesRequest['query']): string {
  if (!query) return ''
  const params = new URLSearchParams()
  for (const [clave, valor] of Object.entries(query)) {
    if (valor !== undefined) params.set(clave, String(valor))
  }
  const texto = params.toString()
  return texto ? `?${texto}` : ''
}

export async function apiFetch<T>(ruta: string, opciones: OpcionesRequest = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (!opciones.sinAuth) {
    const token = obtenerToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  let respuesta: Response
  try {
    respuesta = await fetch(`${BASE_URL}${ruta}${construirQueryString(opciones.query)}`, {
      method: opciones.method ?? 'GET',
      headers,
      body: opciones.body !== undefined ? JSON.stringify(opciones.body) : undefined,
    })
  } catch (error) {
    throw new ApiError(0, `No se pudo conectar con el servidor: ${error}`)
  }

  if (respuesta.status === 401 && !opciones.sinAuth) {
    manejadorNoAutorizado?.()
  }

  if (respuesta.status === 204) return undefined as T

  const texto = await respuesta.text()
  const cuerpo = texto ? JSON.parse(texto) : undefined

  if (!respuesta.ok) {
    throw new ApiError(respuesta.status, cuerpo?.detail ?? cuerpo)
  }
  return cuerpo as T
}
