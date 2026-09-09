/**
 * Dashboard Sucursal — Panel del encargado de sucursal (Tarea #56). A
 * diferencia de `DashboardDueno` (reportes agregados de RED completa
 * contra ClickHouse), este panel es enteramente operativo y scopeado a
 * la sucursal del usuario, contra PostgreSQL en vivo — mermas, stock bajo
 * el mínimo, lotes próximos a caducar y productos sin rotación.
 *
 * Alcance decidido con el usuario al planear esta pantalla: el backend
 * NO tiene (ni se agregó acá) un endpoint de "ventas de hoy" ni un
 * listado de alertas de fraude pendientes por sucursal — `GET
 * /caja/turnos/actual` solo resuelve el turno del cajero autenticado
 * (nunca "todos los turnos abiertos de esta sucursal"), y `alerta_fraude`
 * solo tiene `POST` (crear) y `PATCH .../atender`, nunca un `GET` de
 * listado. Agregar esos dos widgets hubiera significado inventar
 * endpoints nuevos en el backend fuera de esta tarea — el usuario eligió
 * explícitamente armar el panel solo con lo que ya existe (Art. 5.9:
 * nunca se inventa un dato ni una fuente). `demanda_insatisfecha` tampoco
 * entra: su único `GET` exige `producto_id` como parámetro obligatorio
 * (es una consulta por producto, no un listado de quiebres de la
 * sucursal), así que no sirve como widget de panorama general.
 *
 * Bug real encontrado y corregido después de la primera entrega (al
 * armar la pantalla de Compras, Tarea #57, y volver a revisar cómo
 * viajan los campos `Decimal` en el resto del backend): los campos
 * `cantidad`, `valor_estimado`, `cantidad_disponible`, `stock_minimo`,
 * `cantidad_lote` y `cantidad_restante` son `Decimal` en los esquemas
 * Pydantic reales, y Pydantic los serializa como STRING en el JSON —
 * nunca como number. La primera versión los tipaba `number` y sumaba
 * varias filas con `+` directo (`reduce((suma, fila) => suma +
 * fila.valor_estimado, 0)`), que en JavaScript es concatenación de texto
 * cuando el operando es un string, no suma numérica: con 2+ filas el
 * total quedaba corrupto (`"03.501.50"` en vez de `5.00`) y
 * `Intl.NumberFormat` lo mostraba como `$NaN`. Los tests originales no lo
 * detectaron porque sus mocks usaban literales `number` en vez de
 * strings reales — se corrigieron para reflejar el contrato real
 * (`cantidad_disponible: '2.000'`, no `2`), y ahí sí el bug se hacía
 * visible. Fix: los campos quedan tipados `string` y se convierten con
 * `Number(...)` en el único punto donde hace falta operar con ellos.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch, ApiError } from '@/api/client'
import { useAuth } from '@/auth/AuthContext'
import { BadgeEstado } from '@/components/ui/BadgeEstado'
import { BarraBusqueda } from '@/components/ui/BarraBusqueda'
import { Boton } from '@/components/ui/Boton'
import { BotonExportarReporte } from '@/components/ui/BotonExportarReporte'
import { CardKpi } from '@/components/ui/CardKpi'
import { EncabezadoReporteImpresion } from '@/components/ui/EncabezadoReporteImpresion'
import { EsqueletoCarga } from '@/components/ui/EsqueletoCarga'
import { EstadoVacio } from '@/components/ui/EstadoVacio'
import { GraficoBarras } from '@/components/ui/GraficoBarras'
import { MensajeError } from '@/components/ui/MensajeError'
import { Paginacion } from '@/components/ui/Paginacion'
import { usePaginacion } from '@/components/ui/usePaginacion'
import { fadeUp, stagger } from '@/motion/tokens'
import { formatearFecha, formatearFechaHora, formatearHora } from '@/utils/fechas'
import {
  actualizarStockMinimo,
  asignarCausaMerma,
  cerrarInvestigacionMerma,
  listarCausasMerma,
  listarResultadosInvestigacion,
  listarTurnosSucursal,
  registrarAjusteInventario,
  registrarArqueoParcial,
  registrarIngresoStock,
  registrarMerma,
  registrarRetiroLote,
  type CatalogoItem,
  type LoteProximoACaducar,
  type Merma,
  type ProductoCatalogo,
  type StockBajo,
  type StockSinRotacion,
  type TurnoSupervision,
} from './api'

const formatoMoneda = new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' })

function haceDias(dias: number): string {
  const fecha = new Date()
  fecha.setDate(fecha.getDate() - dias)
  return fecha.toISOString().slice(0, 10)
}

const HOY = new Date().toISOString().slice(0, 10)

/** Nunca inventa un nombre: si el catálogo todavía no cargó o el producto
 * no está en él (por ejemplo, fue dado de baja), muestra el id real en
 * vez de un nombre inventado (Art. 5.9). */
function nombreProducto(mapa: Map<number, string> | null, productoId: number): string {
  return mapa?.get(productoId) ?? `Producto #${productoId}`
}

/** Déficit real bajo el mínimo, nunca negativo — un solo lugar para el
 * cálculo que se usa tanto en el KPI agregado como en cada fila. */
function deficitStock(fila: StockBajo): number {
  return Math.max(0, Number(fila.stock_minimo) - Number(fila.cantidad_disponible))
}

function diasHasta(fechaIso: string): number {
  const hoy = new Date(HOY)
  const fecha = new Date(fechaIso)
  return Math.round((fecha.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24))
}

type EstadoCarga<T> =
  | { estado: 'cargando' }
  | { estado: 'error'; error: string }
  | { estado: 'listo'; datos: T }

function useCatalogoProductos(sucursalId: number) {
  const [estado, setEstado] = useState<EstadoCarga<Map<number, string>>>({ estado: 'cargando' })

  const cargar = useCallback(() => {
    setEstado({ estado: 'cargando' })
    apiFetch<ProductoCatalogo[]>('/productos', { query: { sucursal_id: sucursalId } })
      .then((productos) => setEstado({ estado: 'listo', datos: new Map(productos.map((p) => [p.id, p.nombre])) }))
      .catch((error: unknown) => {
        const mensaje = error instanceof ApiError ? error.mensajeUsuario : 'Ocurrió un error inesperado.'
        setEstado({ estado: 'error', error: mensaje })
      })
  }, [sucursalId])

  useEffect(() => {
    cargar()
  }, [cargar])

  return { ...estado, reintentar: cargar }
}

function useMermas(sucursalId: number, desde: string, hasta: string) {
  const [estado, setEstado] = useState<EstadoCarga<Merma[]>>({ estado: 'cargando' })

  const cargar = useCallback(() => {
    setEstado({ estado: 'cargando' })
    apiFetch<Merma[]>('/mermas', { query: { sucursal_id: sucursalId, desde, hasta } })
      .then((datos) => setEstado({ estado: 'listo', datos }))
      .catch((error: unknown) => {
        const mensaje = error instanceof ApiError ? error.mensajeUsuario : 'Ocurrió un error inesperado.'
        setEstado({ estado: 'error', error: mensaje })
      })
  }, [sucursalId, desde, hasta])

  useEffect(() => {
    cargar()
  }, [cargar])

  return { ...estado, reintentar: cargar }
}

function useStockBajo(sucursalId: number) {
  const [estado, setEstado] = useState<EstadoCarga<StockBajo[]>>({ estado: 'cargando' })

  const cargar = useCallback(() => {
    setEstado({ estado: 'cargando' })
    apiFetch<StockBajo[]>('/inventario/stock-bajo', { query: { sucursal_id: sucursalId } })
      .then((datos) => setEstado({ estado: 'listo', datos }))
      .catch((error: unknown) => {
        const mensaje = error instanceof ApiError ? error.mensajeUsuario : 'Ocurrió un error inesperado.'
        setEstado({ estado: 'error', error: mensaje })
      })
  }, [sucursalId])

  useEffect(() => {
    cargar()
  }, [cargar])

  return { ...estado, reintentar: cargar }
}

function useProximosACaducar(sucursalId: number) {
  const [estado, setEstado] = useState<EstadoCarga<LoteProximoACaducar[]>>({ estado: 'cargando' })

  const cargar = useCallback(() => {
    setEstado({ estado: 'cargando' })
    apiFetch<LoteProximoACaducar[]>('/inventario/proximos-a-caducar', { query: { sucursal_id: sucursalId } })
      .then((datos) => setEstado({ estado: 'listo', datos }))
      .catch((error: unknown) => {
        const mensaje = error instanceof ApiError ? error.mensajeUsuario : 'Ocurrió un error inesperado.'
        setEstado({ estado: 'error', error: mensaje })
      })
  }, [sucursalId])

  useEffect(() => {
    cargar()
  }, [cargar])

  return { ...estado, reintentar: cargar }
}

function useSinRotacion(sucursalId: number) {
  const [estado, setEstado] = useState<EstadoCarga<StockSinRotacion[]>>({ estado: 'cargando' })

  const cargar = useCallback(() => {
    setEstado({ estado: 'cargando' })
    apiFetch<StockSinRotacion[]>('/inventario/sin-rotacion', { query: { sucursal_id: sucursalId } })
      .then((datos) => setEstado({ estado: 'listo', datos }))
      .catch((error: unknown) => {
        const mensaje = error instanceof ApiError ? error.mensajeUsuario : 'Ocurrió un error inesperado.'
        setEstado({ estado: 'error', error: mensaje })
      })
  }, [sucursalId])

  useEffect(() => {
    cargar()
  }, [cargar])

  return { ...estado, reintentar: cargar }
}

interface SeccionProps {
  sucursalId: number
  mapaProductos: Map<number, string> | null
}

function ModalNuevaMerma({
  sucursalId,
  mapaProductos,
  onCerrar,
  onCreado,
}: {
  sucursalId: number
  mapaProductos: Map<number, string> | null
  onCerrar: () => void
  onCreado: () => void
}) {
  const [productoId, setProductoId] = useState<number>(mapaProductos?.keys().next().value || 1)
  const [cantidad, setCantidad] = useState<string>('1')
  const [valorEstimado, setValorEstimado] = useState<string>('1.00')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function manejarGuardar(e: React.FormEvent) {
    e.preventDefault()
    const cantNum = Number(cantidad)
    const valNum = Number(valorEstimado)
    if (!Number.isFinite(cantNum) || cantNum <= 0) {
      setError('La cantidad de merma debe ser un número mayor a 0.')
      return
    }
    if (!Number.isFinite(valNum) || valNum < 0) {
      setError('El valor estimado debe ser mayor o igual a 0.')
      return
    }
    setGuardando(true)
    setError(null)
    try {
      await registrarMerma({
        producto_id: Number(productoId),
        sucursal_id: sucursalId,
        cantidad: cantNum,
        valor_estimado: valNum,
      })
      onCreado()
      onCerrar()
    } catch (err) {
      setError(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo registrar la merma.')
    } finally {
      setGuardando(false)
    }
  }

  const productos = Array.from(mapaProductos?.entries() || [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="w-full max-w-md rounded-2xl border-2 border-amber-200/90 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-title font-bold text-brand-deep">Registrar merma operativa</h3>
          <button type="button" onClick={onCerrar} className="text-text-secondary hover:text-text-primary">✕</button>
        </div>
        {error && <div className="mb-3"><MensajeError mensaje={error} /></div>}
        <form onSubmit={manejarGuardar} noValidate className="space-y-4">
          <div>
            <label className="block text-label uppercase text-text-secondary mb-1">Producto afectado</label>
            <select
              value={productoId}
              onChange={(e) => setProductoId(Number(e.target.value))}
              className="w-full rounded-xl border-2 border-amber-200/90 bg-white p-2.5 text-body focus:border-brand-primary"
            >
              {productos.map(([id, nombre]) => (
                <option key={id} value={id}>{nombre}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-label uppercase text-text-secondary mb-1">Cantidad</label>
              <input
                type="number"
                step="0.001"
                min="0.001"
                required
                value={cantidad}
                onKeyDown={(e) => { if (['-', '+', 'e', 'E'].includes(e.key)) e.preventDefault() }}
                onChange={(e) => setCantidad(e.target.value)}
                className={`w-full rounded-xl border-2 bg-white p-2 text-body focus:outline-none ${
                  cantidad !== '' && Number(cantidad) <= 0
                    ? 'border-status-danger bg-red-50/30 text-status-danger'
                    : 'border-amber-200/90 focus:border-brand-primary'
                }`}
              />
              {cantidad !== '' && Number(cantidad) <= 0 && (
                <p className="mt-1 text-[11px] font-semibold text-status-danger">Debe ser mayor a 0</p>
              )}
            </div>
            <div>
              <label className="block text-label uppercase text-text-secondary mb-1">Valor estimado ($)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={valorEstimado}
                onKeyDown={(e) => { if (['-', '+', 'e', 'E'].includes(e.key)) e.preventDefault() }}
                onChange={(e) => setValorEstimado(e.target.value)}
                className={`w-full rounded-xl border-2 bg-white p-2 text-body focus:outline-none ${
                  valorEstimado !== '' && Number(valorEstimado) < 0
                    ? 'border-status-danger bg-red-50/30 text-status-danger'
                    : 'border-amber-200/90 focus:border-brand-primary'
                }`}
              />
              {valorEstimado !== '' && Number(valorEstimado) < 0 && (
                <p className="mt-1 text-[11px] font-semibold text-status-danger">No puede ser negativo</p>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Boton type="button" variante="secundario" onClick={onCerrar}>Cancelar</Boton>
            <Boton
              type="submit"
              disabled={guardando || !cantidad || Number(cantidad) <= 0 || !valorEstimado || Number(valorEstimado) < 0}
            >
              {guardando ? 'Guardando...' : 'Registrar merma'}
            </Boton>
          </div>
        </form>
      </div>
    </div>
  )
}

function ModalGestionarMerma({
  merma,
  nombreProducto,
  onCerrar,
  onActualizado,
}: {
  merma: Merma
  nombreProducto: string
  onCerrar: () => void
  onActualizado: () => void
}) {
  const [causas, setCausas] = useState<CatalogoItem[]>([])
  const [resultados, setResultados] = useState<CatalogoItem[]>([])
  const [causaSeleccionada, setCausaSeleccionada] = useState(merma.causa || '')
  const [resultadoSeleccionado, setResultadoSeleccionado] = useState(merma.resultado_investigacion || '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listarCausasMerma().then(setCausas).catch(() => {
      setCausas([
        { codigo: 'vencimiento', etiqueta: 'Vencimiento' },
        { codigo: 'rotura', etiqueta: 'Rotura o daño físico' },
        { codigo: 'descomposicion', etiqueta: 'Descomposición' },
        { codigo: 'defecto_fabrica', etiqueta: 'Defecto de fábrica' },
        { codigo: 'hurto', etiqueta: 'Hurto detectado' },
        { codigo: 'error_operativo', etiqueta: 'Error operativo' },
      ])
    })
    listarResultadosInvestigacion().then(setResultados).catch(() => {
      setResultados([
        { codigo: 'baja_definitiva', etiqueta: 'Baja definitiva del stock' },
        { codigo: 'recuperado_parcial', etiqueta: 'Recuperado parcialmente' },
        { codigo: 'reclamo_proveedor', etiqueta: 'Reclamo admitido por proveedor' },
        { codigo: 'responsabilidad_personal', etiqueta: 'Responsabilidad atribuida' },
      ])
    })
  }, [])

  async function manejarGuardar(e: React.FormEvent) {
    e.preventDefault()
    setGuardando(true)
    setError(null)
    try {
      if (causaSeleccionada && causaSeleccionada !== merma.causa) {
        await asignarCausaMerma(merma.id, causaSeleccionada)
      }
      if (resultadoSeleccionado && resultadoSeleccionado !== merma.resultado_investigacion) {
        await cerrarInvestigacionMerma(merma.id, resultadoSeleccionado)
      }
      onActualizado()
      onCerrar()
    } catch (err) {
      setError(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo actualizar la investigación.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="w-full max-w-md rounded-2xl border-2 border-amber-200/90 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-title font-bold text-brand-deep">Investigación de merma</h3>
          <button type="button" onClick={onCerrar} className="text-text-secondary hover:text-text-primary">✕</button>
        </div>
        <p className="text-body-sm text-text-secondary mb-3">
          Producto: <span className="font-medium text-text-primary">{nombreProducto}</span> · Cantidad: {Number(merma.cantidad)}
        </p>
        {error && <div className="mb-3"><MensajeError mensaje={error} /></div>}
        <form onSubmit={manejarGuardar} className="space-y-4">
          <div>
            <label className="block text-label uppercase text-text-secondary mb-1">Causa atribuible</label>
            <select
              value={causaSeleccionada}
              onChange={(e) => setCausaSeleccionada(e.target.value)}
              className="w-full rounded-xl border-2 border-amber-200/90 bg-white p-2.5 text-body focus:border-brand-primary"
            >
              <option value="">Seleccionar causa...</option>
              {causas.map((c) => (
                <option key={c.codigo} value={c.codigo}>{c.etiqueta}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-label uppercase text-text-secondary mb-1">
              Resultado de investigación {!causaSeleccionada && '(requiere causa previa)'}
            </label>
            <select
              disabled={!causaSeleccionada}
              value={resultadoSeleccionado}
              onChange={(e) => setResultadoSeleccionado(e.target.value)}
              className="w-full rounded-xl border-2 border-amber-200/90 bg-white p-2.5 text-body disabled:opacity-50 focus:border-brand-primary"
            >
              <option value="">Seleccionar resultado para cerrar investigación...</option>
              {resultados.map((r) => (
                <option key={r.codigo} value={r.codigo}>{r.etiqueta}</option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Boton type="button" variante="secundario" onClick={onCerrar}>Cancelar</Boton>
            <Boton type="submit" disabled={guardando || (!causaSeleccionada && !resultadoSeleccionado)}>
              {guardando ? 'Guardando...' : 'Guardar investigación'}
            </Boton>
          </div>
        </form>
      </div>
    </div>
  )
}

function ModalArqueoParcial({
  turno,
  onCerrar,
  onCompletado,
}: {
  turno: TurnoSupervision
  onCerrar: () => void
  onCompletado: () => void
}) {
  const [montoContado, setMontoContado] = useState<string>('')
  const [motivoDiferencia, setMotivoDiferencia] = useState<string>('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function manejarGuardar(e: React.FormEvent) {
    e.preventDefault()
    const monto = Number(montoContado)
    if (!Number.isFinite(monto) || monto < 0) {
      setError('Ingresá un monto contado válido (0 o más).')
      return
    }
    setGuardando(true)
    setError(null)
    try {
      await registrarArqueoParcial(turno.id, {
        monto_contado: monto,
        motivo_diferencia: motivoDiferencia.trim() || undefined,
      })
      onCompletado()
      onCerrar()
    } catch (err) {
      setError(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo registrar el arqueo parcial.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="w-full max-w-md rounded-2xl border-2 border-amber-200/90 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="font-display text-title font-bold text-brand-deep">Arqueo sorpresa de caja</h3>
            <p className="text-body-sm text-text-secondary">Turno #{turno.id} · Cajero #{turno.cajero_id}</p>
          </div>
          <button type="button" onClick={onCerrar} className="text-text-secondary hover:text-text-primary">✕</button>
        </div>
        {error && <div className="mb-3"><MensajeError mensaje={error} /></div>}
        <form onSubmit={manejarGuardar} className="space-y-4">
          <div>
            <label className="block text-label uppercase text-text-secondary mb-1">
              Efectivo físico contado en gaveta ($)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              required
              autoFocus
              placeholder="0.00"
              value={montoContado}
              onKeyDown={(e) => { if (['-', '+', 'e', 'E'].includes(e.key)) e.preventDefault() }}
              onChange={(e) => setMontoContado(e.target.value)}
              className="w-full rounded-xl border-2 border-amber-200/90 bg-white p-2.5 text-title font-bold font-mono focus:border-brand-primary"
            />
          </div>

          <div>
            <label className="block text-label uppercase text-text-secondary mb-1">
              Justificación de diferencia (obligatorio si hay sobrante o faltante)
            </label>
            <textarea
              rows={2}
              value={motivoDiferencia}
              onChange={(e) => setMotivoDiferencia(e.target.value)}
              placeholder="Ej: Faltante de cambio por redondeo en monedas..."
              className="w-full rounded-xl border-2 border-amber-200/90 bg-white p-2.5 text-body focus:border-brand-primary"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Boton type="button" variante="secundario" onClick={onCerrar}>Cancelar</Boton>
            <Boton type="submit" disabled={guardando || !montoContado}>
              {guardando ? 'Verificando...' : 'Registrar arqueo'}
            </Boton>
          </div>
        </form>
      </div>
    </div>
  )
}

function ModalAjusteInventario({
  sucursalId,
  mapaProductos,
  productoInicialId,
  onCerrar,
  onAjustado,
}: {
  sucursalId: number
  mapaProductos: Map<number, string> | null
  productoInicialId?: number
  onCerrar: () => void
  onAjustado: () => void
}) {
  const [productoId, setProductoId] = useState<number>(productoInicialId || mapaProductos?.keys().next().value || 1)
  const [cantidadAjuste, setCantidadAjuste] = useState<string>('1')
  const [tipoAjuste, setTipoAjuste] = useState<'suma' | 'resta'>('suma')
  const [motivo, setMotivo] = useState<string>('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const productos = Array.from(mapaProductos?.entries() || [])

  async function manejarGuardar(e: React.FormEvent) {
    e.preventDefault()
    const cant = Number(cantidadAjuste)
    if (!Number.isFinite(cant) || cant <= 0) {
      setError('La cantidad a ajustar debe ser mayor a 0.')
      return
    }
    if (motivo.trim().length < 3) {
      setError('El motivo debe tener al menos 3 caracteres.')
      return
    }
    setGuardando(true)
    setError(null)
    try {
      const delta = tipoAjuste === 'suma' ? Math.abs(cant) : -Math.abs(cant)
      await registrarAjusteInventario({
        producto_id: Number(productoId),
        sucursal_id: sucursalId,
        cantidad_ajuste: delta,
        motivo: motivo.trim(),
      })
      onAjustado()
      onCerrar()
    } catch (err) {
      setError(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo registrar el ajuste.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="w-full max-w-md rounded-2xl border-2 border-amber-200/90 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-title font-bold text-brand-deep">Ajuste físico de stock</h3>
          <button type="button" onClick={onCerrar} className="text-text-secondary hover:text-text-primary">✕</button>
        </div>
        {error && <div className="mb-3"><MensajeError mensaje={error} /></div>}
        <form onSubmit={manejarGuardar} className="space-y-4">
          <div>
            <label className="block text-label uppercase text-text-secondary mb-1">Producto</label>
            <select
              value={productoId}
              onChange={(e) => setProductoId(Number(e.target.value))}
              className="w-full rounded-xl border-2 border-amber-200/90 bg-white p-2.5 text-body focus:border-brand-primary"
            >
              {productos.map(([id, nombre]) => (
                <option key={id} value={id}>{nombre}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-label uppercase text-text-secondary mb-1">Sentido</label>
              <select
                value={tipoAjuste}
                onChange={(e) => setTipoAjuste(e.target.value as 'suma' | 'resta')}
                className="w-full rounded-xl border-2 border-amber-200/90 bg-white p-2.5 text-body focus:border-brand-primary"
              >
                <option value="suma">+ Entrada / Sobrante</option>
                <option value="resta">- Salida / Corrección</option>
              </select>
            </div>
            <div>
              <label className="block text-label uppercase text-text-secondary mb-1">Cantidad</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={cantidadAjuste}
                onKeyDown={(e) => { if (['-', '+', 'e', 'E'].includes(e.key)) e.preventDefault() }}
                onChange={(e) => setCantidadAjuste(e.target.value)}
                className="w-full rounded-xl border-2 border-amber-200/90 bg-white p-2 text-body focus:border-brand-primary"
              />
            </div>
          </div>

          <div>
            <label className="block text-label uppercase text-text-secondary mb-1">Motivo auditado (mín. 3 caracteres)</label>
            <input
              type="text"
              required
              placeholder="Ej: Recuento físico fin de semana..."
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="w-full rounded-xl border-2 border-amber-200/90 bg-white p-2.5 text-body focus:border-brand-primary"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Boton type="button" variante="secundario" onClick={onCerrar}>Cancelar</Boton>
            <Boton type="submit" disabled={guardando}>{guardando ? 'Aplicando...' : 'Aplicar ajuste'}</Boton>
          </div>
        </form>
      </div>
    </div>
  )
}

function ModalStockMinimo({
  sucursalId,
  stockItem,
  nombreProducto,
  onCerrar,
  onActualizado,
}: {
  sucursalId: number
  stockItem: StockBajo
  nombreProducto: string
  onCerrar: () => void
  onActualizado: () => void
}) {
  const [minimo, setMinimo] = useState<string>(String(Number(stockItem.stock_minimo)))
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function manejarGuardar(e: React.FormEvent) {
    e.preventDefault()
    const minVal = Number(minimo)
    if (!Number.isFinite(minVal) || minVal < 0) {
      setError('El stock mínimo debe ser un número válido mayor o igual a 0.')
      return
    }
    setGuardando(true)
    setError(null)
    try {
      await actualizarStockMinimo(stockItem.producto_id, sucursalId, minVal)
      onActualizado()
      onCerrar()
    } catch (err) {
      setError(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo actualizar el umbral.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="w-full max-w-md rounded-2xl border-2 border-amber-200/90 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-title font-bold text-brand-deep">Modificar umbral de stock mínimo</h3>
          <button type="button" onClick={onCerrar} className="text-text-secondary hover:text-text-primary">✕</button>
        </div>
        <p className="text-body-sm text-text-secondary mb-3">
          Producto: <span className="font-medium text-text-primary">{nombreProducto}</span>
        </p>
        {error && <div className="mb-3"><MensajeError mensaje={error} /></div>}
        <form onSubmit={manejarGuardar} className="space-y-4">
          <div>
            <label className="block text-label uppercase text-text-secondary mb-1">Nuevo stock mínimo de seguridad</label>
            <input
              type="number"
              step="0.01"
              min="0"
              required
              value={minimo}
              onKeyDown={(e) => { if (['-', '+', 'e', 'E'].includes(e.key)) e.preventDefault() }}
              onChange={(e) => setMinimo(e.target.value)}
              className="w-full rounded-xl border-2 border-amber-200/90 bg-white p-2.5 text-body font-mono focus:border-brand-primary"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Boton type="button" variante="secundario" onClick={onCerrar}>Cancelar</Boton>
            <Boton type="submit" disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar umbral'}</Boton>
          </div>
        </form>
      </div>
    </div>
  )
}

function ModalRetirarLote({
  lote,
  nombreProducto,
  onCerrar,
  onRetirado,
}: {
  lote: LoteProximoACaducar
  nombreProducto: string
  onCerrar: () => void
  onRetirado: () => void
}) {
  const [cantidad, setCantidad] = useState<string>(String(Number(lote.cantidad_restante)))
  const [motivo, setMotivo] = useState<string>('Retiro preventivo por caducidad')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function manejarGuardar(e: React.FormEvent) {
    e.preventDefault()
    setGuardando(true)
    setError(null)
    try {
      await registrarRetiroLote(lote.id, {
        cantidad_retirada: Number(cantidad),
        motivo_retiro: motivo.trim(),
      })
      onRetirado()
      onCerrar()
    } catch (err) {
      setError(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo retirar el lote.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="w-full max-w-md rounded-2xl border-2 border-amber-200/90 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-title font-bold text-brand-deep">Retirar lote de anaquel</h3>
          <button type="button" onClick={onCerrar} className="text-text-secondary hover:text-text-primary">✕</button>
        </div>
        <p className="text-body-sm text-text-secondary mb-3">
          Producto: <span className="font-medium text-text-primary">{nombreProducto}</span> · Lote #{lote.id} · Caducidad: {lote.fecha_caducidad}
        </p>
        {error && <div className="mb-3"><MensajeError mensaje={error} /></div>}
        <form onSubmit={manejarGuardar} className="space-y-4">
          <div>
            <label className="block text-label uppercase text-text-secondary mb-1">
              Cantidad a retirar (máx. {Number(lote.cantidad_restante)})
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              max={Number(lote.cantidad_restante)}
              required
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              className="w-full rounded-xl border-2 border-amber-200/90 bg-white p-2.5 text-body font-mono focus:border-brand-primary"
            />
          </div>

          <div>
            <label className="block text-label uppercase text-text-secondary mb-1">Motivo de retiro</label>
            <input
              type="text"
              required
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="w-full rounded-xl border-2 border-amber-200/90 bg-white p-2.5 text-body focus:border-brand-primary"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Boton type="button" variante="secundario" onClick={onCerrar}>Cancelar</Boton>
            <Boton type="submit" disabled={guardando}>{guardando ? 'Retirando...' : 'Confirmar retiro'}</Boton>
          </div>
        </form>
      </div>
    </div>
  )
}

function ModalIngresoStockLote({
  sucursalId,
  mapaProductos,
  onCerrar,
  onIngresado,
}: {
  sucursalId: number
  mapaProductos: Map<number, string> | null
  onCerrar: () => void
  onIngresado: () => void
}) {
  const [productos, setProductos] = useState<ProductoCatalogo[]>([])
  const [cargandoProductos, setCargandoProductos] = useState(true)
  const [productoId, setProductoId] = useState<number>(0)
  const [cantidad, setCantidad] = useState<string>('10')

  // Fecha de caducidad por defecto: hoy + 15 días
  const fechaDefault = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + 15)
    return d.toISOString().slice(0, 10)
  }, [])
  const hoyIso = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const [fechaCaducidad, setFechaCaducidad] = useState<string>(fechaDefault)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setCargandoProductos(true)
    apiFetch<ProductoCatalogo[]>('/productos', { query: { sucursal_id: sucursalId } })
      .then((items) => {
        setProductos(items)
        if (items.length > 0) {
          const perecedero = items.find((p) => p.es_perecedero)
          setProductoId(perecedero ? perecedero.id : items[0].id)
        }
      })
      .catch(() => {
        if (mapaProductos && mapaProductos.size > 0) {
          const fallback = Array.from(mapaProductos.entries()).map(([id, nombre]) => ({
            id,
            nombre,
            es_perecedero: true,
          }))
          setProductos(fallback)
          setProductoId(fallback[0].id)
        }
      })
      .finally(() => setCargandoProductos(false))
  }, [sucursalId, mapaProductos])

  const productoSeleccionado = productos.find((p) => p.id === productoId)

  async function manejarGuardar(e: React.FormEvent) {
    e.preventDefault()
    const cantNum = Number(cantidad)
    if (!Number.isFinite(cantNum) || cantNum <= 0) {
      setError('La cantidad debe ser un número mayor a 0.')
      return
    }
    if (!fechaCaducidad) {
      setError('Debes especificar la fecha de caducidad del lote.')
      return
    }
    setGuardando(true)
    setError(null)
    try {
      await registrarIngresoStock({
        producto_id: productoId,
        sucursal_id: sucursalId,
        cantidad: cantNum,
        fecha_caducidad: fechaCaducidad,
      })
      onIngresado()
      onCerrar()
    } catch (err) {
      setError(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo registrar el ingreso de stock.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="w-full max-w-md rounded-2xl border-2 border-amber-200/90 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-title font-bold text-brand-deep">Registrar ingreso de stock / Lote</h3>
          <button type="button" onClick={onCerrar} className="text-text-secondary hover:text-text-primary">✕</button>
        </div>
        {error && <div className="mb-3"><MensajeError mensaje={error} /></div>}
        <form onSubmit={manejarGuardar} noValidate className="space-y-4">
          <div>
            <label className="block text-label uppercase text-text-secondary mb-1">Producto</label>
            {cargandoProductos ? (
              <p className="text-body-sm text-text-secondary">Cargando productos...</p>
            ) : (
              <select
                value={productoId}
                onChange={(e) => setProductoId(Number(e.target.value))}
                className="w-full rounded-xl border-2 border-amber-200/90 bg-white p-2.5 text-body focus:border-brand-primary"
              >
                {productos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} {p.es_perecedero ? '(Perecedero - genera lote)' : ''}
                  </option>
                ))}
              </select>
            )}
            {productoSeleccionado && (
              <p className={`mt-1.5 text-xs ${productoSeleccionado.es_perecedero ? 'text-status-success font-medium' : 'text-amber-700'}`}>
                {productoSeleccionado.es_perecedero
                  ? '✓ Producto perecedero: se registrará un lote con seguimiento y semáforo de vencimiento.'
                  : 'ℹ Nota: Si el producto no es perecedero, incrementará el stock general pero no creará lote con vencimiento.'}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-label uppercase text-text-secondary mb-1">Cantidad a ingresar</label>
              <input
                type="number"
                step="1"
                min="0.01"
                required
                value={cantidad}
                onKeyDown={(e) => { if (['-', '+', 'e', 'E'].includes(e.key)) e.preventDefault() }}
                onChange={(e) => setCantidad(e.target.value)}
                className={`w-full rounded-xl border-2 bg-white p-2 text-body focus:outline-none ${
                  cantidad !== '' && Number(cantidad) <= 0
                    ? 'border-status-danger bg-red-50/30 text-status-danger'
                    : 'border-amber-200/90 focus:border-brand-primary'
                }`}
              />
              {cantidad !== '' && Number(cantidad) <= 0 && (
                <p className="mt-1 text-[11px] font-semibold text-status-danger">Debe ser mayor a 0</p>
              )}
            </div>

            <div>
              <label className="block text-label uppercase text-text-secondary mb-1">Fecha de caducidad</label>
              <input
                type="date"
                required
                min={hoyIso}
                value={fechaCaducidad}
                onChange={(e) => setFechaCaducidad(e.target.value)}
                className="w-full rounded-xl border-2 border-amber-200/90 bg-white p-2 text-body focus:border-brand-primary"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Boton type="button" variante="secundario" onClick={onCerrar}>Cancelar</Boton>
            <Boton
              type="submit"
              disabled={guardando || !cantidad || Number(cantidad) <= 0 || !fechaCaducidad || productoId === 0}
            >
              {guardando ? 'Guardando...' : 'Registrar ingreso'}
            </Boton>
          </div>
        </form>
      </div>
    </div>
  )
}

function SeccionMermas({ sucursalId, desde, hasta, mapaProductos }: SeccionProps & { desde: string; hasta: string }) {
  const reporte = useMermas(sucursalId, desde, hasta)
  const [busqueda, setBusqueda] = useState('')
  const [mostrarModalNueva, setMostrarModalNueva] = useState(false)
  const [mermaParaGestionar, setMermaParaGestionar] = useState<Merma | null>(null)

  const datosMermas = reporte.estado === 'listo' ? reporte.datos : []
  const mermasFiltradas = datosMermas.filter((fila) => {
    if (!busqueda.trim()) return true
    const nombre = nombreProducto(mapaProductos, fila.producto_id).toLowerCase()
    const causa = (fila.causa ?? 'sin investigar').toLowerCase()
    const q = busqueda.toLowerCase()
    return nombre.includes(q) || causa.includes(q)
  })

  const {
    datosPaginados,
    paginaActual,
    totalPaginas,
    itemsPorPagina,
    totalItems,
    cambiarPagina,
    cambiarItemsPorPagina,
  } = usePaginacion(mermasFiltradas, { itemsPorPaginaInicial: 5 })

  const datosGraficoMermas = useMemo(() => {
    if (reporte.estado !== 'listo') return []
    const causasMap: Record<string, number> = {}
    for (const m of reporte.datos) {
      const causa = m.causa ? m.causa.replace(/_/g, ' ') : 'Sin investigar'
      causasMap[causa] = (causasMap[causa] || 0) + Number(m.valor_estimado)
    }
    return Object.entries(causasMap).map(([causa, total]) => ({
      causa,
      'Pérdida ($)': Number(total.toFixed(2)),
    }))
  }, [reporte])

  if (reporte.estado === 'cargando') return <EsqueletoCarga filas={2} alturaPx={96} />
  if (reporte.estado === 'error') return <MensajeError mensaje={reporte.error} onReintentar={reporte.reintentar} />
  if (reporte.datos.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <Boton onClick={() => setMostrarModalNueva(true)} className="h-8 text-body-sm">
            + Registrar merma
          </Boton>
        </div>
        <EstadoVacio
          titulo="Sin mermas en el rango"
          descripcion="No se registraron eventos de merma en tu sucursal para el periodo seleccionado — buena señal, no un dato faltante."
        />
        {mostrarModalNueva && (
          <ModalNuevaMerma
            sucursalId={sucursalId}
            mapaProductos={mapaProductos}
            onCerrar={() => setMostrarModalNueva(false)}
            onCreado={() => reporte.reintentar()}
          />
        )}
      </div>
    )
  }

  const valorTotal = reporte.datos.reduce((suma, fila) => suma + Number(fila.valor_estimado), 0)
  const sinInvestigar = reporte.datos.filter((fila) => !fila.causa).length

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <CardKpi etiqueta="Valor perdido en el periodo" cifra={formatoMoneda.format(valorTotal)} />
        <CardKpi etiqueta="Eventos registrados" cifra={String(reporte.datos.length)} />
        <CardKpi
          etiqueta="Sin causa asignada"
          cifra={String(sinInvestigar)}
          comparacion={sinInvestigar > 0 ? { texto: 'Pendientes de investigar', favorable: false } : undefined}
        />
      </div>

      {datosGraficoMermas.length > 0 && (
        <div className="mt-4 rounded-2xl border-2 border-amber-200/90 bg-white p-5 shadow-2xs">
          <GraficoBarras
            titulo="Pérdidas acumuladas por causa ($)"
            datos={datosGraficoMermas}
            claveEjeX="causa"
            barras={[{ clave: 'Pérdida ($)', nombre: 'Pérdida estimada ($)', color: '#A32E1F' }]}
            altura={220}
          />
        </div>
      )}

      <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <BarraBusqueda
          valor={busqueda}
          onChange={setBusqueda}
          placeholder="Filtrar por producto o causa..."
          totalCoincidencias={mermasFiltradas.length}
          className="max-w-sm"
        />
        <Boton onClick={() => setMostrarModalNueva(true)} className="h-9 shrink-0 text-body-sm">
          + Registrar merma
        </Boton>
      </div>

      <div className="mt-3 overflow-x-auto rounded-2xl border-2 border-amber-200/90 bg-white shadow-2xs">
        <table className="w-full text-body">
          <thead>
            <tr className="border-b-2 border-amber-200/80 bg-amber-50/70 text-left text-label uppercase text-brand-deep font-bold">
              <th scope="col" className="px-4 py-3">Producto</th>
              <th scope="col" className="px-4 py-3 text-right">Cantidad</th>
              <th scope="col" className="px-4 py-3 text-right">Valor estimado</th>
              <th scope="col" className="px-4 py-3">Causa</th>
              <th scope="col" className="px-4 py-3">Detectado</th>
              <th scope="col" className="px-4 py-3 text-right">Acción</th>
            </tr>
          </thead>
          <tbody>
            {datosPaginados.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-text-secondary">
                  No se encontraron mermas que coincidan con la búsqueda.
                </td>
              </tr>
            ) : (
              datosPaginados.map((fila) => (
                <tr key={fila.id} className="border-b border-amber-100 last:border-0 hover:bg-amber-50/40 transition-colors">
                  <td className="px-4 py-3 font-medium text-text-primary">{nombreProducto(mapaProductos, fila.producto_id)}</td>
                  <td className="px-4 py-3 text-right">{Number(fila.cantidad)}</td>
                  <td className="px-4 py-3 text-right font-medium text-status-danger">{formatoMoneda.format(Number(fila.valor_estimado))}</td>
                  <td className="px-4 py-3">
                    {fila.causa ?? <BadgeEstado texto="Sin investigar" color="warning" />}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {new Date(fila.fecha_deteccion).toLocaleDateString('es-EC')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!fila.causa ? (
                      <Boton
                        variante="secundario"
                        onClick={() => setMermaParaGestionar(fila)}
                        className="h-7 text-xs px-2.5"
                      >
                        Asignar causa
                      </Boton>
                    ) : !fila.resultado_investigacion ? (
                      <Boton
                        variante="secundario"
                        onClick={() => setMermaParaGestionar(fila)}
                        className="h-7 text-xs px-2.5"
                      >
                        Cerrar investig.
                      </Boton>
                    ) : (
                      <BadgeEstado texto="Cerrada" color="info" />
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <Paginacion
          paginaActual={paginaActual}
          totalPaginas={totalPaginas}
          totalItems={totalItems}
          itemsPorPagina={itemsPorPagina}
          onCambiarPagina={cambiarPagina}
          onCambiarItemsPorPagina={cambiarItemsPorPagina}
          etiquetaItems="mermas"
        />
      </div>

      {mostrarModalNueva && (
        <ModalNuevaMerma
          sucursalId={sucursalId}
          mapaProductos={mapaProductos}
          onCerrar={() => setMostrarModalNueva(false)}
          onCreado={() => reporte.reintentar()}
        />
      )}

      {mermaParaGestionar && (
        <ModalGestionarMerma
          merma={mermaParaGestionar}
          nombreProducto={nombreProducto(mapaProductos, mermaParaGestionar.producto_id)}
          onCerrar={() => setMermaParaGestionar(null)}
          onActualizado={() => reporte.reintentar()}
        />
      )}
    </div>
  )
}

function SeccionStockBajo({ sucursalId, mapaProductos }: SeccionProps) {
  const reporte = useStockBajo(sucursalId)
  const [busqueda, setBusqueda] = useState('')
  const [mostrarAjuste, setMostrarAjuste] = useState(false)
  const [productoParaMinimo, setProductoParaMinimo] = useState<StockBajo | null>(null)

  const datosStockBajo = reporte.estado === 'listo' ? reporte.datos : []
  const itemsFiltrados = datosStockBajo.filter((fila) => {
    if (!busqueda.trim()) return true
    const nombre = nombreProducto(mapaProductos, fila.producto_id).toLowerCase()
    return nombre.includes(busqueda.toLowerCase())
  })

  const {
    datosPaginados,
    paginaActual,
    totalPaginas,
    itemsPorPagina,
    totalItems,
    cambiarPagina,
    cambiarItemsPorPagina,
  } = usePaginacion(itemsFiltrados, { itemsPorPaginaInicial: 5 })

  const datosGraficoStock = useMemo(() => {
    if (reporte.estado !== 'listo') return []
    return reporte.datos.slice(0, 6).map((item) => ({
      producto: nombreProducto(mapaProductos, item.producto_id).slice(0, 18),
      Disponible: Number(item.cantidad_disponible),
      'Mínimo': Number(item.stock_minimo),
    }))
  }, [reporte, mapaProductos])

  if (reporte.estado === 'cargando') return <EsqueletoCarga filas={2} alturaPx={96} />
  if (reporte.estado === 'error') return <MensajeError mensaje={reporte.error} onReintentar={reporte.reintentar} />
  if (reporte.datos.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <Boton onClick={() => setMostrarAjuste(true)} className="h-8 text-body-sm">
            + Ajuste físico de inventario
          </Boton>
        </div>
        <EstadoVacio
          titulo="Sin productos bajo el mínimo"
          descripcion="Todo el inventario de tu sucursal está sobre su stock mínimo — buena señal, no un dato faltante."
        />
        {mostrarAjuste && (
          <ModalAjusteInventario
            sucursalId={sucursalId}
            mapaProductos={mapaProductos}
            onCerrar={() => setMostrarAjuste(false)}
            onAjustado={() => reporte.reintentar()}
          />
        )}
      </div>
    )
  }

  const deficitTotal = reporte.datos.reduce((suma, fila) => suma + deficitStock(fila), 0)

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <CardKpi
          etiqueta="Productos bajo el mínimo"
          cifra={String(reporte.datos.length)}
          comparacion={{ texto: 'Requieren reposición', favorable: false }}
        />
        <CardKpi etiqueta="Déficit total de unidades" cifra={deficitTotal.toFixed(2)} />
      </div>

      {datosGraficoStock.length > 0 && (
        <div className="mt-4 rounded-2xl border-2 border-amber-200/90 bg-white p-5 shadow-2xs">
          <GraficoBarras
            titulo="Comparativa: Stock disponible vs Umbral mínimo"
            datos={datosGraficoStock}
            claveEjeX="producto"
            barras={[
              { clave: 'Disponible', nombre: 'Stock Disponible', color: '#D4A017' },
              { clave: 'Mínimo', nombre: 'Umbral Mínimo', color: '#946F00' },
            ]}
            altura={220}
          />
        </div>
      )}

      <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <BarraBusqueda
          valor={busqueda}
          onChange={setBusqueda}
          placeholder="Buscar producto por nombre..."
          totalCoincidencias={itemsFiltrados.length}
          className="max-w-sm"
        />
        <Boton onClick={() => setMostrarAjuste(true)} className="h-9 shrink-0 text-body-sm">
          + Ajuste físico de stock
        </Boton>
      </div>

      <div className="mt-3 overflow-x-auto rounded-2xl border-2 border-amber-200/90 bg-white shadow-2xs">
        <table className="w-full text-body">
          <thead>
            <tr className="border-b-2 border-amber-200/80 bg-amber-50/70 text-left text-label uppercase text-brand-deep font-bold">
              <th scope="col" className="px-4 py-3">Producto</th>
              <th scope="col" className="px-4 py-3 text-right">Disponible</th>
              <th scope="col" className="px-4 py-3 text-right">Mínimo</th>
              <th scope="col" className="px-4 py-3 text-right">Déficit</th>
              <th scope="col" className="px-4 py-3 text-right">Acción</th>
            </tr>
          </thead>
          <tbody>
            {datosPaginados.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-text-secondary">
                  No se encontraron productos bajo el mínimo que coincidan con la búsqueda.
                </td>
              </tr>
            ) : (
              datosPaginados.map((fila) => (
                <tr key={fila.producto_id} className="border-b border-amber-100 last:border-0 hover:bg-amber-50/40 transition-colors">
                  <td className="px-4 py-3 font-medium text-text-primary">{nombreProducto(mapaProductos, fila.producto_id)}</td>
                  <td className="px-4 py-3 text-right font-medium">{Number(fila.cantidad_disponible)}</td>
                  <td className="px-4 py-3 text-right text-text-secondary">{Number(fila.stock_minimo)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-status-danger">
                    {deficitStock(fila)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Boton
                      variante="secundario"
                      onClick={() => setProductoParaMinimo(fila)}
                      className="h-7 text-xs px-2.5"
                    >
                      Ajustar mín.
                    </Boton>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <Paginacion
          paginaActual={paginaActual}
          totalPaginas={totalPaginas}
          totalItems={totalItems}
          itemsPorPagina={itemsPorPagina}
          onCambiarPagina={cambiarPagina}
          onCambiarItemsPorPagina={cambiarItemsPorPagina}
          etiquetaItems="productos"
        />
      </div>

      {mostrarAjuste && (
        <ModalAjusteInventario
          sucursalId={sucursalId}
          mapaProductos={mapaProductos}
          onCerrar={() => setMostrarAjuste(false)}
          onAjustado={() => reporte.reintentar()}
        />
      )}

      {productoParaMinimo && (
        <ModalStockMinimo
          sucursalId={sucursalId}
          stockItem={productoParaMinimo}
          nombreProducto={nombreProducto(mapaProductos, productoParaMinimo.producto_id)}
          onCerrar={() => setProductoParaMinimo(null)}
          onActualizado={() => reporte.reintentar()}
        />
      )}
    </div>
  )
}

function SeccionProximosACaducar({ sucursalId, mapaProductos }: SeccionProps) {
  const reporte = useProximosACaducar(sucursalId)
  const [busqueda, setBusqueda] = useState('')
  const [loteParaRetiro, setLoteParaRetiro] = useState<LoteProximoACaducar | null>(null)
  const [mostrarIngreso, setMostrarIngreso] = useState(false)

  const datosCaducar = reporte.estado === 'listo' ? reporte.datos : []
  const itemsFiltrados = datosCaducar.filter((fila) => {
    if (!busqueda.trim()) return true
    const nombre = nombreProducto(mapaProductos, fila.producto_id).toLowerCase()
    return nombre.includes(busqueda.toLowerCase())
  })

  const {
    datosPaginados,
    paginaActual,
    totalPaginas,
    itemsPorPagina,
    totalItems,
    cambiarPagina,
    cambiarItemsPorPagina,
  } = usePaginacion(itemsFiltrados, { itemsPorPaginaInicial: 5 })

  if (reporte.estado === 'cargando') return <EsqueletoCarga filas={2} alturaPx={96} />
  if (reporte.estado === 'error') return <MensajeError mensaje={reporte.error} onReintentar={reporte.reintentar} />
  if (reporte.datos.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <Boton onClick={() => setMostrarIngreso(true)} className="h-8 text-body-sm">
            + Ingreso de stock / Lote
          </Boton>
        </div>
        <EstadoVacio
          titulo="Sin lotes por caducar pronto"
          descripcion="No hay lotes activos venciendo en el horizonte de alerta configurado — buena señal, no un dato faltante."
        />
        {mostrarIngreso && (
          <ModalIngresoStockLote
            sucursalId={sucursalId}
            mapaProductos={mapaProductos}
            onCerrar={() => setMostrarIngreso(false)}
            onIngresado={() => reporte.reintentar()}
          />
        )}
      </div>
    )
  }

  const cantidadTotal = reporte.datos.reduce((suma, fila) => suma + Number(fila.cantidad_restante), 0)

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <CardKpi
          etiqueta="Lotes por caducar"
          cifra={String(reporte.datos.length)}
          comparacion={{ texto: 'Priorizar salida o retiro', favorable: false }}
        />
        <CardKpi etiqueta="Cantidad restante total" cifra={cantidadTotal.toFixed(2)} />
      </div>

      <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <BarraBusqueda
          valor={busqueda}
          onChange={setBusqueda}
          placeholder="Buscar producto por nombre..."
          totalCoincidencias={itemsFiltrados.length}
          className="max-w-sm"
        />
        <Boton onClick={() => setMostrarIngreso(true)} className="h-9 shrink-0 text-body-sm">
          + Ingreso de stock / Lote
        </Boton>
      </div>

      <div className="mt-3 overflow-x-auto rounded-2xl border-2 border-amber-200/90 bg-white shadow-2xs">
        <table className="w-full text-body">
          <thead>
            <tr className="border-b-2 border-amber-200/80 bg-amber-50/70 text-left text-label uppercase text-brand-deep font-bold">
              <th scope="col" className="px-4 py-3">Producto</th>
              <th scope="col" className="px-4 py-3 text-right">Lote #</th>
              <th scope="col" className="px-4 py-3 text-right">Cantidad restante</th>
              <th scope="col" className="px-4 py-3">Caducidad</th>
              <th scope="col" className="px-4 py-3">Estado</th>
              <th scope="col" className="px-4 py-3 text-right">Acción</th>
            </tr>
          </thead>
          <tbody>
            {datosPaginados.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-text-secondary">
                  No se encontraron lotes por caducar que coincidan con la búsqueda.
                </td>
              </tr>
            ) : (
              datosPaginados.map((fila) => {
                const dias = diasHasta(fila.fecha_caducidad)
                const vencido = dias < 0
                return (
                  <tr key={fila.id} className="border-b border-amber-100 last:border-0 hover:bg-amber-50/40 transition-colors">
                    <td className="px-4 py-3 font-medium text-text-primary">{nombreProducto(mapaProductos, fila.producto_id)}</td>
                    <td className="px-4 py-3 text-right text-text-secondary">{fila.id}</td>
                    <td className="px-4 py-3 text-right font-medium">{Number(fila.cantidad_restante)}</td>
                    <td className="px-4 py-3 text-text-secondary">{fila.fecha_caducidad}</td>
                    <td className="px-4 py-3">
                      {vencido ? (
                        <BadgeEstado texto="Vencido" color="danger" />
                      ) : dias === 0 ? (
                        <BadgeEstado texto="Vence hoy" color="warning" />
                      ) : (
                        <BadgeEstado texto={`En ${dias}d`} color="info" />
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Boton
                        variante="secundario"
                        onClick={() => setLoteParaRetiro(fila)}
                        className="h-7 text-xs px-2.5 text-status-danger border-status-danger/40 hover:bg-status-danger/10"
                      >
                        Retirar lote
                      </Boton>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
        <Paginacion
          paginaActual={paginaActual}
          totalPaginas={totalPaginas}
          totalItems={totalItems}
          itemsPorPagina={itemsPorPagina}
          onCambiarPagina={cambiarPagina}
          onCambiarItemsPorPagina={cambiarItemsPorPagina}
          etiquetaItems="lotes"
        />
      </div>

      {loteParaRetiro && (
        <ModalRetirarLote
          lote={loteParaRetiro}
          nombreProducto={nombreProducto(mapaProductos, loteParaRetiro.producto_id)}
          onCerrar={() => setLoteParaRetiro(null)}
          onRetirado={() => reporte.reintentar()}
        />
      )}

      {mostrarIngreso && (
        <ModalIngresoStockLote
          sucursalId={sucursalId}
          mapaProductos={mapaProductos}
          onCerrar={() => setMostrarIngreso(false)}
          onIngresado={() => reporte.reintentar()}
        />
      )}
    </div>
  )
}

function SeccionSinRotacion({ sucursalId, mapaProductos }: SeccionProps) {
  const reporte = useSinRotacion(sucursalId)
  const [busqueda, setBusqueda] = useState('')

  const datosSinRotacion = reporte.estado === 'listo' ? reporte.datos : []
  const itemsFiltrados = datosSinRotacion.filter((fila) => {
    if (!busqueda.trim()) return true
    const nombre = nombreProducto(mapaProductos, fila.producto_id).toLowerCase()
    return nombre.includes(busqueda.toLowerCase())
  })

  const {
    datosPaginados,
    paginaActual,
    totalPaginas,
    itemsPorPagina,
    totalItems,
    cambiarPagina,
    cambiarItemsPorPagina,
  } = usePaginacion(itemsFiltrados, { itemsPorPaginaInicial: 5 })

  if (reporte.estado === 'cargando') return <EsqueletoCarga filas={2} alturaPx={96} />
  if (reporte.estado === 'error') return <MensajeError mensaje={reporte.error} onReintentar={reporte.reintentar} />
  if (reporte.datos.length === 0) {
    return (
      <EstadoVacio
        titulo="Sin productos marcados sin rotación"
        descripcion="Ningún producto en tu sucursal supera el umbral de días sin ventas — inventario en movimiento."
      />
    )
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <CardKpi
          etiqueta="Productos sin rotación"
          cifra={String(reporte.datos.length)}
          comparacion={{ texto: 'Revisar exhibición o descuento', favorable: false }}
        />
        <CardKpi
          etiqueta="Unidades inmovilizadas"
          cifra={reporte.datos.reduce((suma, fila) => suma + Number(fila.cantidad_disponible), 0).toFixed(2)}
        />
      </div>

      <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <BarraBusqueda
          valor={busqueda}
          onChange={setBusqueda}
          placeholder="Buscar producto por nombre..."
          totalCoincidencias={itemsFiltrados.length}
          className="max-w-sm"
        />
      </div>

      <div className="mt-3 overflow-x-auto rounded-2xl border-2 border-amber-200/90 bg-white shadow-2xs">
        <table className="w-full text-body">
          <thead>
            <tr className="border-b-2 border-amber-200/80 bg-amber-50/70 text-left text-label uppercase text-brand-deep font-bold">
              <th scope="col" className="px-4 py-3">Producto</th>
              <th scope="col" className="px-4 py-3 text-right">Disponible</th>
              <th scope="col" className="px-4 py-3 text-right">Mínimo</th>
              <th scope="col" className="px-4 py-3 text-right">Días sin venta</th>
            </tr>
          </thead>
          <tbody>
            {datosPaginados.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-text-secondary">
                  No se encontraron productos sin rotación que coincidan con la búsqueda.
                </td>
              </tr>
            ) : (
              datosPaginados.map((fila) => (
                <tr key={fila.producto_id} className="border-b border-amber-100 last:border-0 hover:bg-amber-50/40 transition-colors">
                  <td className="px-4 py-3 font-medium text-text-primary">{nombreProducto(mapaProductos, fila.producto_id)}</td>
                  <td className="px-4 py-3 text-right">{Number(fila.cantidad_disponible)}</td>
                  <td className="px-4 py-3 text-right text-text-secondary">{Number(fila.stock_minimo)}</td>
                  <td className="px-4 py-3 text-right font-medium text-brand-primary">{fila.dias_sin_venta}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <Paginacion
          paginaActual={paginaActual}
          totalPaginas={totalPaginas}
          totalItems={totalItems}
          itemsPorPagina={itemsPorPagina}
          onCambiarPagina={cambiarPagina}
          onCambiarItemsPorPagina={cambiarItemsPorPagina}
          etiquetaItems="productos"
        />
      </div>
    </div>
  )
}

function SeccionCajaArqueos({ sucursalId }: { sucursalId: number }) {
  const [turnos, setTurnos] = useState<TurnoSupervision[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [turnoParaArqueo, setTurnoParaArqueo] = useState<TurnoSupervision | null>(null)
  const [mensajeExito, setMensajeExito] = useState<string | null>(null)

  const cargarTurnos = useCallback(() => {
    setCargando(true)
    setError(null)
    listarTurnosSucursal(sucursalId, 20)
      .then((datos) => setTurnos(datos))
      .catch((err) => {
        setError(err instanceof ApiError ? err.mensajeUsuario : 'No se pudieron cargar los turnos de caja.')
      })
      .finally(() => setCargando(false))
  }, [sucursalId])

  useEffect(() => {
    cargarTurnos()
  }, [cargarTurnos])

  const turnosAbiertos = turnos.filter((t) => t.estado === 'abierto')
  const turnosCerrados = turnos.filter((t) => t.estado === 'cerrado')

  if (cargando) return <EsqueletoCarga filas={3} alturaPx={64} />
  if (error) return <MensajeError mensaje={error} onReintentar={cargarTurnos} />

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <CardKpi
          etiqueta="Turnos actualmente abiertos"
          cifra={String(turnosAbiertos.length)}
          comparacion={turnosAbiertos.length > 0 ? { texto: 'Cajas activas', favorable: true } : { texto: 'Sin cajas activas', favorable: false }}
        />
        <CardKpi
          etiqueta="Fondo total en gavetas activas"
          cifra={formatoMoneda.format(turnosAbiertos.reduce((sum, t) => sum + Number(t.monto_inicial), 0))}
        />
        <CardKpi
          etiqueta="Turnos cerrados supervisados"
          cifra={String(turnosCerrados.length)}
        />
      </div>

      {mensajeExito && (
        <div className="rounded-[var(--radius-card)] bg-status-success/15 border border-status-success/30 p-3 text-body-sm text-status-success flex items-center justify-between">
          <span>✓ {mensajeExito}</span>
          <button type="button" onClick={() => setMensajeExito(null)} className="font-bold">✕</button>
        </div>
      )}

      <div className="rounded-2xl border-2 border-amber-200/90 bg-white p-5 shadow-2xs">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="font-display text-title font-semibold text-brand-deep">
              Cajas activas en sucursal
            </h3>
            <p className="text-body-sm text-text-secondary">
              Realizá arqueos parciales de supervisión sin interrumpir el turno del cajero.
            </p>
          </div>
          <Boton variante="secundario" onClick={cargarTurnos} className="h-8 text-xs">
            Actualizar estado
          </Boton>
        </div>

        {turnosAbiertos.length === 0 ? (
          <EstadoVacio
            titulo="No hay cajas abiertas"
            descripcion="En este momento ningún cajero tiene un turno activo en esta sucursal."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {turnosAbiertos.map((t) => (
              <div
                key={t.id}
                className="flex flex-col justify-between rounded-xl border-2 border-amber-200/90 bg-amber-50/30 p-4 transition-all hover:border-amber-300 hover:shadow-xs"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full bg-status-success animate-pulse" />
                      <span className="font-bold text-text-primary">Turno #{t.id} · Cajero #{t.cajero_id}</span>
                    </div>
                    <p className="mt-1 text-body-sm text-text-secondary">
                      Apertura: {formatearHora(t.hora_apertura)} ({formatearFecha(t.hora_apertura)})
                    </p>
                  </div>
                  <BadgeEstado texto="Abierto" color="success" />
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-amber-200/60 pt-3">
                  <div>
                    <span className="block text-[11px] uppercase tracking-wider text-text-secondary">Fondo inicial</span>
                    <span className="font-mono font-bold text-brand-deep">{formatoMoneda.format(t.monto_inicial)}</span>
                  </div>

                  <Boton
                    variante="primario"
                    onClick={() => setTurnoParaArqueo(t)}
                    className="h-8 text-body-sm"
                  >
                    Realizar arqueo sorpresa
                  </Boton>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {turnosCerrados.length > 0 && (
        <div className="rounded-2xl border-2 border-amber-200/90 bg-white p-5 shadow-2xs">
          <h3 className="mb-3 font-display text-body font-bold text-brand-deep">
            Historial de cierres supervisados
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b-2 border-amber-200/80 bg-amber-50/70 text-left text-label uppercase text-brand-deep font-bold">
                  <th className="py-2.5 px-3">Turno</th>
                  <th className="py-2.5 px-3">Cajero</th>
                  <th className="py-2.5 px-3">Cierre</th>
                  <th className="py-2.5 px-3 text-right">Esperado</th>
                  <th className="py-2.5 px-3 text-right">Contado</th>
                  <th className="py-2.5 px-3 text-right">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {turnosCerrados.slice(0, 5).map((tc) => {
                  const dif = Number(tc.diferencia ?? 0)
                  return (
                    <tr key={tc.id} className="border-b border-amber-100 last:border-0 hover:bg-amber-50/40 transition-colors">
                      <td className="py-2.5 px-3 font-mono font-medium">#{tc.id}</td>
                      <td className="py-2.5 px-3 text-text-secondary">Usuario #{tc.cajero_id}</td>
                      <td className="py-2.5 px-3 text-text-secondary">
                        {formatearFechaHora(tc.hora_cierre)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">{formatoMoneda.format(Number(tc.monto_esperado ?? 0))}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{formatoMoneda.format(Number(tc.monto_contado ?? 0))}</td>
                      <td className={`py-2.5 px-3 text-right font-mono font-bold ${dif === 0 ? 'text-status-success' : dif > 0 ? 'text-blue-600' : 'text-status-danger'}`}>
                        {dif > 0 ? `+${formatoMoneda.format(dif)}` : formatoMoneda.format(dif)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {turnoParaArqueo && (
        <ModalArqueoParcial
          turno={turnoParaArqueo}
          onCerrar={() => setTurnoParaArqueo(null)}
          onCompletado={() => {
            setMensajeExito(`Arqueo sorpresa en Turno #${turnoParaArqueo.id} registrado y auditado correctamente.`)
            cargarTurnos()
          }}
        />
      )}
    </div>
  )
}

export type SeccionSucursal = 'resumen' | 'caja-arqueos' | 'mermas' | 'stock-bajo' | 'lotes' | 'sin-rotacion'

const PESTANAS_SUCURSAL: { id: SeccionSucursal; etiqueta: string }[] = [
  { id: 'resumen', etiqueta: 'Resumen General' },
  { id: 'caja-arqueos', etiqueta: 'Caja y Arqueos' },
  { id: 'mermas', etiqueta: 'Mermas' },
  { id: 'stock-bajo', etiqueta: 'Stock Bajo' },
  { id: 'lotes', etiqueta: 'Lotes' },
  { id: 'sin-rotacion', etiqueta: 'Sin Rotación' },
]

function PanelSucursal({ sucursalId }: { sucursalId: number }) {
  const [desde, setDesde] = useState(haceDias(30))
  const [hasta, setHasta] = useState(HOY)
  const [rangoAplicado, setRangoAplicado] = useState({ desde, hasta })
  const catalogo = useCatalogoProductos(sucursalId)
  const mapaProductos = catalogo.estado === 'listo' ? catalogo.datos : null

  const [searchParams, setSearchParams] = useSearchParams()
  const seccionParam = searchParams.get('seccion') as SeccionSucursal | null
  const tabActiva: SeccionSucursal =
    seccionParam && PESTANAS_SUCURSAL.some((p) => p.id === seccionParam) ? seccionParam : 'resumen'

  function cambiarTab(t: SeccionSucursal) {
    if (t === 'resumen') {
      const nuevos = new URLSearchParams(searchParams)
      nuevos.delete('seccion')
      setSearchParams(nuevos)
    } else {
      setSearchParams({ seccion: t })
    }
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } catch {
        // Ignorar si el entorno (ej: test jsdom) no implementa scrollTo con opciones
      }
    }
  }

  const { sesion } = useAuth()
  const mostrarTodas = tabActiva === 'resumen'
  const etiquetaSeccion = PESTANAS_SUCURSAL.find((p) => p.id === tabActiva)?.etiqueta ?? 'Resumen'

  return (
    <motion.div variants={stagger} initial="hidden" animate="visible" className="space-y-8">
      {/* Encabezado formal visible únicamente en impresión o PDF */}
      <EncabezadoReporteImpresion
        titulo={`Reporte Operativo — ${etiquetaSeccion}`}
        subtitulo="Supervisión integral de mermas, existencias críticas, vencimiento de lotes y arqueos de caja"
        rangoFechas={{ desde: rangoAplicado.desde, hasta: rangoAplicado.hasta }}
        sucursalNombre={`Sucursal #${sucursalId}`}
        usuarioNombre={sesion?.claims.sub ?? 'Encargado de Sucursal'}
      />

      <motion.div variants={fadeUp} className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-display text-display-lg text-brand-deep">Centro de Operaciones de Sucursal</p>
          <p className="mt-1 text-body text-text-secondary">
            Supervisión integral: arqueos de caja, mermas, reposición y control de caducidad.
          </p>
        </div>

        <div className="no-print flex flex-wrap items-center gap-3">
          {/* Pestañas de control operativo */}
          <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border-2 border-amber-200/90 bg-white p-1.5 shadow-2xs">
            {PESTANAS_SUCURSAL.map((pestana) => (
              <button
                key={pestana.id}
                type="button"
                onClick={() => cambiarTab(pestana.id)}
                aria-pressed={tabActiva === pestana.id}
                className={`rounded-xl px-3.5 py-2 text-body-sm font-semibold transition-all ${
                  tabActiva === pestana.id
                    ? 'bg-brand-primary text-white shadow-2xs'
                    : 'text-brand-deep hover:bg-amber-50 hover:text-brand-primary'
                }`}
              >
                {pestana.etiqueta}
              </button>
            ))}
          </div>

          <BotonExportarReporte
            etiqueta="Exportar reporte (PDF)"
            tituloReporte={`Reporte Operativo — ${etiquetaSeccion}`}
            variante="primario"
          />
        </div>
      </motion.div>

      {/* Sección Caja y Arqueos */}
      {(tabActiva === 'caja-arqueos') && (
        <motion.section id="seccion-caja-arqueos" variants={fadeUp}>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-title text-text-primary">Supervisión de Turnos y Arqueos de Caja</p>
          </div>
          <SeccionCajaArqueos sucursalId={sucursalId} />
        </motion.section>
      )}

      {/* Sección Mermas */}
      {(mostrarTodas || tabActiva === 'mermas') && (
        <motion.section id="seccion-mermas" variants={fadeUp}>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-4">
            <p className="text-title text-text-primary">Mermas recientes</p>
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(evento) => {
                evento.preventDefault()
                setRangoAplicado({ desde, hasta })
              }}
            >
              <label className="flex flex-col text-body-sm text-text-secondary">
                Desde
                <input
                  type="date"
                  value={desde}
                  max={hasta}
                  onChange={(evento) => setDesde(evento.target.value)}
                  className="rounded-xl border-2 border-amber-200/90 bg-white px-3 py-1.5 text-body focus:border-brand-primary"
                />
              </label>
              <label className="flex flex-col text-body-sm text-text-secondary">
                Hasta
                <input
                  type="date"
                  value={hasta}
                  min={desde}
                  max={HOY}
                  onChange={(evento) => setHasta(evento.target.value)}
                  className="rounded-xl border-2 border-amber-200/90 bg-white px-3 py-1.5 text-body focus:border-brand-primary"
                />
              </label>
              <Boton type="submit" variante="secundario">
                Aplicar
              </Boton>
            </form>
          </div>
          <SeccionMermas sucursalId={sucursalId} desde={rangoAplicado.desde} hasta={rangoAplicado.hasta} mapaProductos={mapaProductos} />
        </motion.section>
      )}

      {/* Sección Stock Bajo */}
      {(mostrarTodas || tabActiva === 'stock-bajo') && (
        <motion.section id="seccion-stock-bajo" variants={fadeUp}>
          <p className="mb-3 text-title text-text-primary">Stock bajo el mínimo</p>
          <SeccionStockBajo sucursalId={sucursalId} mapaProductos={mapaProductos} />
        </motion.section>
      )}

      {/* Sección Próximos a Caducar */}
      {(mostrarTodas || tabActiva === 'lotes') && (
        <motion.section id="seccion-lotes" variants={fadeUp}>
          <p className="mb-3 text-title text-text-primary">Próximos a caducar</p>
          <SeccionProximosACaducar sucursalId={sucursalId} mapaProductos={mapaProductos} />
        </motion.section>
      )}

      {/* Sección Sin Rotación */}
      {(mostrarTodas || tabActiva === 'sin-rotacion') && (
        <motion.section id="seccion-sin-rotacion" variants={fadeUp}>
          <p className="mb-3 text-title text-text-primary">Sin rotación</p>
          <SeccionSinRotacion sucursalId={sucursalId} mapaProductos={mapaProductos} />
        </motion.section>
      )}
    </motion.div>
  )
}

export function DashboardSucursal() {
  const { sesion } = useAuth()
  const sucursalId = sesion?.claims.sucursal_ids[0] ?? null

  if (sucursalId === null) {
    return (
      <EstadoVacio
        titulo="Tu usuario no tiene sucursal asignada"
        descripcion="No podés ver el panel de sucursal hasta que Administración te asigne al menos una sucursal."
      />
    )
  }

  return <PanelSucursal sucursalId={sucursalId} />
}
