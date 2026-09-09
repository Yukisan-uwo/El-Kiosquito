/**
 * Llamadas HTTP reales de la pantalla del POS del cajero (Tarea #55). Cada
 * función es un envoltorio delgado sobre `apiFetch` — vive acá aparte para
 * que `PosCajero.tsx` y sus subcomponentes no repitan la ruta/forma de cada
 * endpoint, y para poder mockear `@/api/client` una sola vez en los tests.
 */
import { apiFetch } from '@/api/client'
import type {
  ClienteOut,
  CuponOut,
  DatafonoDisponible,
  MetodoPago,
  PoliticaPrivacidad,
  ProductoBusqueda,
  TurnoCaja,
  VentaOut,
} from './tipos'

/** RF-CF-013 (002, enmienda v1.3). `q` es obligatorio (mínimo 2 caracteres
 * en el backend, RN-CF-006) — este endpoint es un buscador, nunca un
 * listado completo de la clientela (Art. 10 LOPDP). */
export function buscarClientes(q: string): Promise<ClienteOut[]> {
  return apiFetch<ClienteOut[]>('/clientes', { query: { q } })
}

export function buscarProductos(
  sucursalId: number,
  filtro?: { q?: string; codigoBarras?: string },
): Promise<ProductoBusqueda[]> {
  return apiFetch<ProductoBusqueda[]>('/productos', {
    query: {
      sucursal_id: sucursalId,
      q: filtro?.q ? filtro.q : undefined,
      codigo_barras: filtro?.codigoBarras ? filtro.codigoBarras : undefined,
    },
  })
}

export function listarVentasTurno(turnoId: number, limite: number = 10): Promise<VentaOut[]> {
  return apiFetch<VentaOut[]>('/ventas', { query: { turno_caja_id: turnoId, limite } })
}

/** 404 (sin turno abierto) se propaga como ApiError — el llamador decide
 * qué pantalla mostrar, nunca se traduce acá a un valor por defecto. */
export function obtenerTurnoActual(): Promise<TurnoCaja> {
  return apiFetch<TurnoCaja>('/caja/turnos/actual')
}

export function abrirTurno(sucursalId: number, montoInicial: number): Promise<TurnoCaja> {
  return apiFetch<TurnoCaja>('/caja/turnos', {
    method: 'POST',
    body: { sucursal_id: sucursalId, monto_inicial: montoInicial },
  })
}

export function cerrarTurno(turnoId: number, montoContado: number, motivoDiferencia?: string): Promise<TurnoCaja> {
  return apiFetch<TurnoCaja>(`/caja/turnos/${turnoId}/cerrar`, {
    method: 'PATCH',
    body: { monto_contado: montoContado, motivo_diferencia: motivoDiferencia || null },
  })
}

export function listarMetodosPago(): Promise<MetodoPago[]> {
  return apiFetch<MetodoPago[]>('/catalogos/metodos-pago')
}

/** RF-PS-013 (007, enmienda v1.2) — solo id y código de serie, nunca estado
 * de seguridad: es lo único que el rol cajero puede leer sobre datáfonos. */
export function listarDatafonosDisponibles(sucursalId: number): Promise<DatafonoDisponible[]> {
  return apiFetch<DatafonoDisponible[]>(`/sucursales/${sucursalId}/datafonos-disponibles`)
}

export function consultarPoliticaPrivacidad(): Promise<PoliticaPrivacidad> {
  return apiFetch<PoliticaPrivacidad>('/clientes/politica-privacidad')
}

export interface ClienteNuevoIn {
  nombre: string
  contacto?: string
  fecha_nacimiento?: string
  acepto_politica_privacidad: boolean
}

export function crearCliente(payload: ClienteNuevoIn): Promise<ClienteOut> {
  return apiFetch<ClienteOut>('/clientes', { method: 'POST', body: payload })
}

export interface ItemVentaIn {
  producto_id: number
  cantidad_venta: number
}

export interface VentaCrearIn {
  turno_caja_id: number
  cliente_id?: number | null
  items: ItemVentaIn[]
  metodo_pago: string
  descuento_aplicado?: number
  datafono_id?: number | null
}

export function crearVenta(payload: VentaCrearIn): Promise<VentaOut> {
  return apiFetch<VentaOut>('/ventas', { method: 'POST', body: payload })
}

export function validarCupon(codigo: string): Promise<CuponOut> {
  return apiFetch<CuponOut>(`/promociones/cupones/validar/${encodeURIComponent(codigo)}`)
}

export function consultarCuponesCliente(clienteId: number): Promise<CuponOut[]> {
  return apiFetch<CuponOut[]>(`/clientes/${clienteId}/cupones`)
}

export function canjearCupon(cuponId: number, ventaId: number): Promise<CuponOut> {
  return apiFetch<CuponOut>(`/promociones/cupones/${cuponId}/canjear`, {
    method: 'PATCH',
    body: { venta_id: ventaId },
  })
}
