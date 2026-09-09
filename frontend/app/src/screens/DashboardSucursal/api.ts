import { apiFetch } from '@/api/client'

export interface Merma {
  id: number
  producto_id: number
  sucursal_id: number
  cantidad: string
  valor_estimado: string
  causa: string | null
  resultado_investigacion: string | null
  fecha_deteccion: string
  fecha_resultado: string | null
}

export interface StockBajo {
  producto_id: number
  cantidad_disponible: string
  stock_minimo: string
}

export interface LoteProximoACaducar {
  id: number
  producto_id: number
  sucursal_id: number
  fecha_caducidad: string
  cantidad_lote: string
  cantidad_restante: string
}

export interface StockSinRotacion {
  producto_id: number
  sucursal_id: number
  cantidad_disponible: string
  stock_minimo: string
  dias_sin_venta: number
  marcado_sin_rotacion: boolean
}

export interface ProductoCatalogo {
  id: number
  nombre: string
  precio_venta_vigente?: number | null
}

export interface TurnoSupervision {
  id: number
  sucursal_id: number
  cajero_id: number
  hora_apertura: string
  monto_inicial: number
  hora_cierre: string | null
  monto_contado: number | null
  monto_esperado: number | null
  diferencia: number | null
  motivo_diferencia: string | null
  estado: string
}

export interface ArqueoParcialOut {
  id: number
  turno_caja_id: number
  hora_arqueo: string
  monto_esperado_acumulado: number
  monto_contado: number
  diferencia: number
  motivo_diferencia: string | null
}

export interface CatalogoItem {
  codigo: string
  etiqueta: string
}

// Operaciones de Mermas
export function registrarMerma(payload: {
  producto_id: number
  sucursal_id: number
  cantidad: number
  valor_estimado: number
}): Promise<Merma> {
  return apiFetch<Merma>('/mermas', { method: 'POST', body: payload })
}

export function asignarCausaMerma(mermaId: number, causa: string): Promise<Merma> {
  return apiFetch<Merma>(`/mermas/${mermaId}/causa`, { method: 'PATCH', body: { causa } })
}

export function cerrarInvestigacionMerma(mermaId: number, resultado: string): Promise<Merma> {
  return apiFetch<Merma>(`/mermas/${mermaId}/resultado`, {
    method: 'PATCH',
    body: { resultado_investigacion: resultado },
  })
}

export function listarCausasMerma(): Promise<CatalogoItem[]> {
  return apiFetch<CatalogoItem[]>('/catalogos/causas-merma')
}

export function listarResultadosInvestigacion(): Promise<CatalogoItem[]> {
  return apiFetch<CatalogoItem[]>('/catalogos/resultados-investigacion')
}

// Operaciones de Turnos y Arqueos de Caja
export function listarTurnosSucursal(sucursalId: number, limite: number = 10): Promise<TurnoSupervision[]> {
  return apiFetch<TurnoSupervision[]>('/caja/turnos', { query: { sucursal_id: sucursalId, limite } })
}

export function registrarArqueoParcial(
  turnoId: number,
  payload: { monto_contado: number; motivo_diferencia?: string | null },
): Promise<ArqueoParcialOut> {
  return apiFetch<ArqueoParcialOut>(`/caja/turnos/${turnoId}/arqueos-parciales`, {
    method: 'POST',
    body: payload,
  })
}

// Operaciones de Inventario
export function registrarAjusteInventario(payload: {
  producto_id: number
  sucursal_id: number
  cantidad_ajuste: number
  motivo: string
}): Promise<unknown> {
  return apiFetch('/inventario/ajustes', { method: 'POST', body: payload })
}

export function actualizarStockMinimo(
  productoId: number,
  sucursalId: number,
  stockMinimo: number,
): Promise<unknown> {
  return apiFetch(`/inventario/stock/${productoId}/minimo`, {
    method: 'PATCH',
    body: { sucursal_id: sucursalId, stock_minimo: stockMinimo },
  })
}

export function registrarRetiroLote(
  loteId: number,
  payload: { cantidad_retirada: number; motivo_retiro: string },
): Promise<unknown> {
  return apiFetch(`/inventario/lotes/${loteId}/retiro`, {
    method: 'PATCH',
    body: payload,
  })
}
