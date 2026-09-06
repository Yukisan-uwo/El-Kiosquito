/**
 * Llamadas HTTP reales de la pantalla de Administración (Tarea #58).
 * Cubre 010-administracion completo (enmienda v1.2, incluye el listado
 * nuevo `GET /admin/usuarios` y los campos nuevos de `SolicitudArco`) y
 * reutiliza `GET /clientes?q=` de 002-clientes-fidelizacion (mismo
 * endpoint que `ClienteVenta.tsx` de PosCajero) para el buscador de
 * cliente al registrar una solicitud ARCO.
 */
import { apiFetch, ApiError } from '@/api/client'
import type {
  ClienteBusqueda,
  EstadoSolicitudArco,
  LogAuditoria,
  Operacion,
  ParametroSistema,
  PermisoRol,
  RecursoSistema,
  Rol,
  SolicitudArco,
  Sucursal,
  TipoSolicitudArco,
  Usuario,
} from './tipos'

// ---------------------------------------------------------------------------
// Usuarios
// ---------------------------------------------------------------------------

export interface FiltroUsuarios {
  rol?: string
  activo?: boolean
}

export function listarUsuarios(filtro: FiltroUsuarios = {}): Promise<Usuario[]> {
  return apiFetch<Usuario[]>('/admin/usuarios', { query: { rol: filtro.rol, activo: filtro.activo } })
}

export interface UsuarioCrearIn {
  nombre: string
  email: string
  password: string
  rol: string
}

export function crearUsuario(payload: UsuarioCrearIn): Promise<Usuario> {
  return apiFetch<Usuario>('/admin/usuarios', { method: 'POST', body: payload })
}

export interface UsuarioActualizarIn {
  nombre?: string
  email?: string
}

export function actualizarUsuario(id: number, payload: UsuarioActualizarIn): Promise<Usuario> {
  return apiFetch<Usuario>(`/admin/usuarios/${id}`, { method: 'PATCH', body: payload })
}

export interface RolSucursalesIn {
  rol: string
  sucursal_ids?: number[]
}

export function asignarRolYSucursales(id: number, payload: RolSucursalesIn): Promise<Usuario> {
  return apiFetch<Usuario>(`/admin/usuarios/${id}/rol-sucursales`, { method: 'PATCH', body: payload })
}

export function desactivarUsuario(id: number): Promise<Usuario> {
  return apiFetch<Usuario>(`/admin/usuarios/${id}/desactivar`, { method: 'PATCH' })
}

// ---------------------------------------------------------------------------
// Catálogos
// ---------------------------------------------------------------------------

export function listarRoles(): Promise<Rol[]> {
  return apiFetch<Rol[]>('/catalogos/roles')
}

export function listarSucursales(estado?: string): Promise<Sucursal[]> {
  return apiFetch<Sucursal[]>('/sucursales', { query: { estado } })
}

export function listarRecursosSistema(): Promise<RecursoSistema[]> {
  return apiFetch<RecursoSistema[]>('/catalogos/recursos-sistema')
}

export function listarOperaciones(): Promise<Operacion[]> {
  return apiFetch<Operacion[]>('/catalogos/operaciones')
}

export function listarTiposSolicitudArco(): Promise<TipoSolicitudArco[]> {
  return apiFetch<TipoSolicitudArco[]>('/catalogos/tipos-solicitud-arco')
}

export function listarEstadosSolicitudArco(): Promise<EstadoSolicitudArco[]> {
  return apiFetch<EstadoSolicitudArco[]>('/catalogos/estados-solicitud-arco')
}

export function buscarClientes(q: string): Promise<ClienteBusqueda[]> {
  return apiFetch<ClienteBusqueda[]>('/clientes', { query: { q } })
}

// ---------------------------------------------------------------------------
// Matriz de permisos
// ---------------------------------------------------------------------------

export function consultarMatrizPermisos(rol?: string): Promise<PermisoRol[]> {
  return apiFetch<PermisoRol[]>('/admin/permisos', { query: { rol } })
}

// ---------------------------------------------------------------------------
// Auditoría
// ---------------------------------------------------------------------------

export interface FiltroAuditoria {
  usuarioId?: number
  sucursalId?: number
  desde?: string
  hasta?: string
  soloAnomalias?: boolean
}

export function consultarAuditoria(filtro: FiltroAuditoria = {}): Promise<LogAuditoria[]> {
  return apiFetch<LogAuditoria[]>('/admin/auditoria', {
    query: {
      usuario_id: filtro.usuarioId,
      sucursal_id: filtro.sucursalId,
      desde: filtro.desde,
      hasta: filtro.hasta,
      solo_anomalias: filtro.soloAnomalias,
    },
  })
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1'
const CLAVE_STORAGE_TOKEN = 'elkiosquito.token'

/**
 * `apiFetch` siempre intenta `JSON.parse` la respuesta (ver `api/client.ts`)
 * — no sirve para `formato=csv`, que devuelve texto CSV real con
 * `Content-Disposition: attachment`. Se arma un fetch aparte, con el mismo
 * token real de sesión (nunca uno de prueba ni un header inventado), y se
 * dispara la descarga con un enlace temporal — patrón estándar del
 * navegador, no hay ninguna librería de por medio.
 */
export async function descargarAuditoriaCsv(filtro: FiltroAuditoria = {}): Promise<void> {
  const params = new URLSearchParams()
  if (filtro.usuarioId !== undefined) params.set('usuario_id', String(filtro.usuarioId))
  if (filtro.sucursalId !== undefined) params.set('sucursal_id', String(filtro.sucursalId))
  if (filtro.desde !== undefined) params.set('desde', filtro.desde)
  if (filtro.hasta !== undefined) params.set('hasta', filtro.hasta)
  if (filtro.soloAnomalias !== undefined) params.set('solo_anomalias', String(filtro.soloAnomalias))
  params.set('formato', 'csv')

  const token = sessionStorage.getItem(CLAVE_STORAGE_TOKEN)
  const respuesta = await fetch(`${BASE_URL}/admin/auditoria?${params.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!respuesta.ok) {
    const texto = await respuesta.text()
    throw new ApiError(respuesta.status, texto || undefined)
  }
  const blob = await respuesta.blob()
  const url = URL.createObjectURL(blob)
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = 'auditoria.csv'
  document.body.appendChild(enlace)
  enlace.click()
  document.body.removeChild(enlace)
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Parámetros globales (IVA, moneda)
// ---------------------------------------------------------------------------

export function consultarParametroVigente(clave: string): Promise<ParametroSistema> {
  return apiFetch<ParametroSistema>(`/admin/parametros/${clave}`)
}

export interface ParametroCrearIn {
  clave: string
  valor: string
}

export function registrarParametroSistema(payload: ParametroCrearIn): Promise<ParametroSistema> {
  return apiFetch<ParametroSistema>('/admin/parametros', { method: 'POST', body: payload })
}

// ---------------------------------------------------------------------------
// Solicitudes ARCO
// ---------------------------------------------------------------------------

export interface FiltroSolicitudesArco {
  estado?: string
  soloVencidas?: boolean
}

export function listarSolicitudesArco(filtro: FiltroSolicitudesArco = {}): Promise<SolicitudArco[]> {
  return apiFetch<SolicitudArco[]>('/admin/arco', {
    query: { estado: filtro.estado, solo_vencidas: filtro.soloVencidas },
  })
}

export interface SolicitudArcoCrearIn {
  cliente_id: number
  tipo: string
  detalle: string
}

export function crearSolicitudArco(payload: SolicitudArcoCrearIn): Promise<SolicitudArco> {
  return apiFetch<SolicitudArco>('/admin/arco', { method: 'POST', body: payload })
}

export interface SolicitudArcoResolverIn {
  estado: string
  respuesta: string
}

export function resolverSolicitudArco(id: number, payload: SolicitudArcoResolverIn): Promise<SolicitudArco> {
  return apiFetch<SolicitudArco>(`/admin/arco/${id}/resolver`, { method: 'PATCH', body: payload })
}
