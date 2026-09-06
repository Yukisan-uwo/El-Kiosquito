/**
 * Llamadas HTTP reales de la pantalla de Compras y Proveedores (Tarea
 * #57). Cubre 008-compras-proveedores completo (enmienda v1.3, incluye
 * los listados nuevos `GET /proveedores` y `GET /compras/ordenes`) y el
 * único endpoint que se consume de 009-expansion-sucursales
 * (`GET /sucursales`, enmienda v1.2) para el selector de sucursal
 * destino al crear una orden.
 */
import { apiFetch } from '@/api/client'
import type {
  DetalleOrdenCompra,
  EstadoOrdenCompra,
  FormaPago,
  HistorialCostoProducto,
  OrdenCompra,
  PronosticoParaCompra,
  ProductoCatalogo,
  Proveedor,
  Sucursal,
} from './tipos'

// ---------------------------------------------------------------------------
// Proveedores
// ---------------------------------------------------------------------------

export function listarProveedores(activo?: boolean): Promise<Proveedor[]> {
  return apiFetch<Proveedor[]>('/proveedores', { query: { activo } })
}

export interface ProveedorCrearIn {
  nombre: string
  contacto?: string
}

export function crearProveedor(payload: ProveedorCrearIn): Promise<Proveedor> {
  return apiFetch<Proveedor>('/proveedores', { method: 'POST', body: payload })
}

export interface ProveedorActualizarIn {
  nombre?: string
  contacto?: string
}

export function actualizarProveedor(id: number, payload: ProveedorActualizarIn): Promise<Proveedor> {
  return apiFetch<Proveedor>(`/proveedores/${id}`, { method: 'PATCH', body: payload })
}

export function desactivarProveedor(id: number): Promise<Proveedor> {
  return apiFetch<Proveedor>(`/proveedores/${id}/desactivar`, { method: 'PATCH' })
}

// ---------------------------------------------------------------------------
// Sucursales (solo lectura — 009-expansion-sucursales)
// ---------------------------------------------------------------------------

export function listarSucursales(estado?: string): Promise<Sucursal[]> {
  return apiFetch<Sucursal[]>('/sucursales', { query: { estado } })
}

// ---------------------------------------------------------------------------
// Catálogos
// ---------------------------------------------------------------------------

export function listarFormasPago(): Promise<FormaPago[]> {
  return apiFetch<FormaPago[]>('/catalogos/formas-pago')
}

export function listarEstadosOrdenCompra(): Promise<EstadoOrdenCompra[]> {
  return apiFetch<EstadoOrdenCompra[]>('/catalogos/estados-orden-compra')
}

// ---------------------------------------------------------------------------
// Productos (selector de ítems al armar una orden — mismo endpoint que PosCajero)
// ---------------------------------------------------------------------------

export function buscarProductos(sucursalId: number, q?: string): Promise<ProductoCatalogo[]> {
  return apiFetch<ProductoCatalogo[]>('/productos', { query: { sucursal_id: sucursalId, q } })
}

// ---------------------------------------------------------------------------
// Órdenes de compra
// ---------------------------------------------------------------------------

export interface FiltroOrdenes {
  sucursalId?: number
  estado?: string
  proveedorId?: number
}

export function listarOrdenesCompra(filtro: FiltroOrdenes = {}): Promise<OrdenCompra[]> {
  return apiFetch<OrdenCompra[]>('/compras/ordenes', {
    query: { sucursal_id: filtro.sucursalId, estado: filtro.estado, proveedor_id: filtro.proveedorId },
  })
}

export interface ItemOrdenCompraIn {
  producto_id: number
  cantidad_pedida: number
  precio_ofrecido: number
}

export interface OrdenCompraCrearIn {
  proveedor_id: number
  sucursal_id: number
  es_oferta: boolean
  forma_pago: string
  items: ItemOrdenCompraIn[]
}

export function crearOrdenCompra(payload: OrdenCompraCrearIn): Promise<OrdenCompra> {
  return apiFetch<OrdenCompra>('/compras/ordenes', { method: 'POST', body: payload })
}

export interface RecepcionCrearIn {
  cantidad_recibida_evento: number
  numero_documento_proveedor?: string
}

export function registrarRecepcion(detalleId: number, payload: RecepcionCrearIn): Promise<OrdenCompra> {
  return apiFetch<OrdenCompra>(`/compras/ordenes/${detalleId}/recepciones`, { method: 'POST', body: payload })
}

export function consultarPronostico(
  productoId: number,
  sucursalId: number,
  detalleId?: number,
): Promise<PronosticoParaCompra> {
  return apiFetch<PronosticoParaCompra>(`/compras/productos/${productoId}/pronostico`, {
    query: { sucursal_id: sucursalId, detalle_id: detalleId },
  })
}

export function registrarMotivoOferta(detalleId: number, motivo: string): Promise<DetalleOrdenCompra> {
  return apiFetch<DetalleOrdenCompra>(`/compras/ordenes/${detalleId}/motivo-oferta`, {
    method: 'PATCH',
    body: { motivo_no_siguio_pronostico: motivo },
  })
}

export function consultarHistorialCosto(productoId: number): Promise<HistorialCostoProducto[]> {
  return apiFetch<HistorialCostoProducto[]>(`/compras/productos/${productoId}/historial-costo`)
}

export function consultarComparativaProveedores(productoId: number): Promise<HistorialCostoProducto[]> {
  return apiFetch<HistorialCostoProducto[]>(`/compras/productos/${productoId}/comparativa-proveedores`)
}
