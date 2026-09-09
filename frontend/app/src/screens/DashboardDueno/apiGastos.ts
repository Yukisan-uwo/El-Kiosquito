import { apiFetch } from '@/api/client'

export interface GastoSucursal {
  id: number
  sucursal_id: number
  concepto: string
  categoria_gasto: string
  monto_mensual: string | number
  activo: boolean
  creado_en: string
  actualizado_en: string
}

export interface GastoSucursalPayload {
  sucursal_id: number
  concepto: string
  categoria_gasto: string
  monto_mensual: number
}

export interface SimulacionGastosPayload {
  sucursal_id: number
  meta_utilidad_neta_pct?: number
  variacion_gastos_pct?: number
}

export interface ProductoSimulado {
  producto_id: number
  nombre: string
  clasificacion: string
  es_perecedero: boolean
  costo_vigente: string | number | null
  precio_actual: string | number | null
  margen_actual_pct: string | number | null
  margen_sugerido_pct: string | number
  precio_sugerido: string | number
  cuota_gasto_absorbida: string | number
  justificacion: string
}

export interface SimulacionGastosRespuesta {
  sucursal_id: number
  gastos_totales_mensuales: string | number
  variacion_aplicada_pct: string | number
  punto_equilibrio_ventas: string | number
  margen_promedio_necesario_pct: string | number
  utilidad_neta_proyectada: string | number
  total_unidades_proyectadas: number
  productos: ProductoSimulado[]
  explicacion_ia: string
}

export interface ItemPrecioAplicar {
  producto_id: number
  precio_sugerido: number
  justificacion: string
}

export interface AplicarPreciosPayload {
  sucursal_id: number
  items: ItemPrecioAplicar[]
}

export interface AplicarPreciosRespuesta {
  sucursal_id: number
  total_precios_aplicados: number
  mensaje: string
}

export function listarGastosSucursal(sucursalId: number): Promise<GastoSucursal[]> {
  return apiFetch<GastoSucursal[]>('/gastos-sucursal', { query: { sucursal_id: sucursalId } })
}

export function crearGastoSucursal(payload: GastoSucursalPayload): Promise<GastoSucursal> {
  return apiFetch<GastoSucursal>('/gastos-sucursal', { method: 'POST', body: payload })
}

export function actualizarGastoSucursal(
  gastoId: number,
  payload: Partial<GastoSucursalPayload> & { activo?: boolean },
): Promise<GastoSucursal> {
  return apiFetch<GastoSucursal>(`/gastos-sucursal/${gastoId}`, { method: 'PATCH', body: payload })
}

export function eliminarGastoSucursal(gastoId: number): Promise<{ id: number; eliminado: boolean }> {
  return apiFetch<{ id: number; eliminado: boolean }>(`/gastos-sucursal/${gastoId}`, { method: 'DELETE' })
}

export function ejecutarSimulacionGastosIa(
  payload: SimulacionGastosPayload,
): Promise<SimulacionGastosRespuesta> {
  return apiFetch<SimulacionGastosRespuesta>('/gastos-sucursal/simulacion-ia', {
    method: 'POST',
    body: payload,
  })
}

export function aplicarPreciosSimulados(payload: AplicarPreciosPayload): Promise<AplicarPreciosRespuesta> {
  return apiFetch<AplicarPreciosRespuesta>('/gastos-sucursal/aplicar-simulacion', {
    method: 'POST',
    body: payload,
  })
}
