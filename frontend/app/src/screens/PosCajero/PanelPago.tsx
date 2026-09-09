import { useEffect, useState } from 'react'
import { ApiError } from '@/api/client'
import { Boton } from '@/components/ui/Boton'
import { MensajeError } from '@/components/ui/MensajeError'
import { listarDatafonosDisponibles, listarMetodosPago } from './api'
import type { DatafonoDisponible, MetodoPago } from './tipos'

/** Decisión del usuario del proyecto (2026-09-06): el POS solo ofrece
 * efectivo y tarjeta — "electronico" existe en el catálogo backend
 * (transferencia/billetera digital) pero se oculta acá a propósito, sin
 * tocar el catálogo ni el contrato de 001. Si el catálogo alguna vez deja
 * de traer "tarjeta" o "efectivo", esta pantalla simplemente no los ofrece
 * — nunca se inventa un método que el backend no devolvió. */
const CODIGOS_METODO_VISIBLES_EN_POS = new Set(['efectivo', 'tarjeta'])

function formatearMoneda(valor: number): string {
  return new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(valor)
}

interface PanelPagoProps {
  sucursalId: number
  total?: number
  metodoPago: string | null
  datafonoId: number | null
  onCambiarMetodo: (codigo: string) => void
  onCambiarDatafono: (id: number | null) => void
  puedeCobrar: boolean
  procesando: boolean
  errorCheckout: string | null
  onCobrar: () => void
}

export function PanelPago({
  sucursalId,
  total = 0,
  metodoPago,
  datafonoId,
  onCambiarMetodo,
  onCambiarDatafono,
  puedeCobrar,
  procesando,
  errorCheckout,
  onCobrar,
}: PanelPagoProps) {
  const [metodos, setMetodos] = useState<MetodoPago[] | null>(null)
  const [errorMetodos, setErrorMetodos] = useState<string | null>(null)
  const [pagaCon, setPagaCon] = useState<string>('')

  const [datafonos, setDatafonos] = useState<DatafonoDisponible[] | null>(null)
  const [errorDatafonos, setErrorDatafonos] = useState<string | null>(null)
  const [cargandoDatafonos, setCargandoDatafonos] = useState(false)

  useEffect(() => {
    listarMetodosPago()
      .then((resultado) => setMetodos(resultado.filter((m) => CODIGOS_METODO_VISIBLES_EN_POS.has(m.codigo))))
      .catch((err) => setErrorMetodos(err instanceof ApiError ? err.mensajeUsuario : 'No se pudieron cargar los métodos de pago.'))
  }, [])

  const requiereDatafono = metodoPago !== null && metodoPago !== 'efectivo'

  useEffect(() => {
    if (!requiereDatafono) {
      setDatafonos(null)
      onCambiarDatafono(null)
      return
    }
    setCargandoDatafonos(true)
    setErrorDatafonos(null)
    listarDatafonosDisponibles(sucursalId)
      .then((resultado) => setDatafonos(resultado))
      .catch((err) => setErrorDatafonos(err instanceof ApiError ? err.mensajeUsuario : 'No se pudieron cargar los datáfonos.'))
      .finally(() => setCargandoDatafonos(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requiereDatafono, sucursalId])

  // RN-CVI-011 (001): si hay datáfonos activos registrados y el pago no es
  // en efectivo, elegir uno es obligatorio antes de poder cobrar.
  const faltaElegirDatafono = requiereDatafono && (datafonos?.length ?? 0) > 0 && datafonoId === null

  const montoRecibidoNumerico = pagaCon.trim() ? Number(pagaCon) : 0
  const totalVenta = total ?? 0
  const esEfectivoInsuficiente =
    metodoPago === 'efectivo' && montoRecibidoNumerico > 0 && montoRecibidoNumerico < totalVenta
  const vuelto = montoRecibidoNumerico >= totalVenta ? montoRecibidoNumerico - totalVenta : 0

  return (
    <div className="space-y-3 border-t border-surface-bg pt-3">
      <p className="text-label uppercase text-text-secondary">Método de pago</p>

      {errorMetodos && <MensajeError mensaje={errorMetodos} />}
      {metodos && (
        <div className="flex gap-2">
          {metodos.map((metodo) => (
            <button
              key={metodo.codigo}
              type="button"
              aria-pressed={metodoPago === metodo.codigo}
              onClick={() => onCambiarMetodo(metodo.codigo)}
              className={`rounded-xl px-4 py-2.5 text-body-sm font-semibold transition-all shadow-2xs ${
                metodoPago === metodo.codigo
                  ? 'border-2 border-brand-primary bg-brand-primary text-white shadow-xs'
                  : 'border-2 border-amber-200/90 bg-white text-brand-deep hover:border-brand-primary hover:bg-amber-50/50'
              }`}
            >
              {metodo.etiqueta}
            </button>
          ))}
        </div>
      )}

      {metodoPago === 'efectivo' && (
        <div className="space-y-2 rounded-2xl border-2 border-amber-200/90 bg-amber-50/40 p-3 shadow-2xs">
          <div className="flex items-center justify-between">
            <label htmlFor="paga-con" className="text-label uppercase text-brand-deep font-bold">
              Paga con (efectivo):
            </label>
            <div className="flex items-center gap-1">
              <span className="text-text-secondary font-mono">$</span>
              <input
                id="paga-con"
                type="number"
                step="0.01"
                min={0}
                value={pagaCon}
                onChange={(e) => setPagaCon(e.target.value)}
                placeholder={totalVenta > 0 ? totalVenta.toFixed(2) : '0.00'}
                className="w-28 rounded-xl border-2 border-amber-300/90 bg-white px-2.5 py-1 text-right font-mono text-body font-bold focus:border-brand-primary focus:outline-none"
              />
            </div>
          </div>

          {/* Botones de billetes comunes */}
          <div className="flex flex-wrap gap-1.5 pt-1">
            <button
              type="button"
              onClick={() => setPagaCon(totalVenta > 0 ? totalVenta.toFixed(2) : '')}
              className="rounded-lg border border-amber-300/80 bg-white px-2 py-1 text-xs font-semibold text-brand-deep hover:bg-amber-100/70"
            >
              Exacto
            </button>
            {[5, 10, 20, 50].map((billete) => (
              <button
                key={billete}
                type="button"
                onClick={() => setPagaCon(billete.toFixed(2))}
                className="rounded-lg border border-amber-300/80 bg-white px-2 py-1 text-xs font-semibold text-brand-deep hover:bg-amber-100/70"
              >
                ${billete}
              </button>
            ))}
          </div>

          {/* Resultado de cambio / vuelto */}
          {montoRecibidoNumerico > 0 && (
            <div className="mt-2">
              {esEfectivoInsuficiente ? (
                <div className="rounded-xl border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-body-sm font-semibold text-status-danger">
                  Monto insuficiente: faltan {formatearMoneda(totalVenta - montoRecibidoNumerico)}
                </div>
              ) : (
                <div className="flex items-center justify-between rounded-xl border border-status-success/40 bg-status-success/15 px-3 py-2 text-status-success">
                  <span className="text-label uppercase font-bold tracking-wider">Vuelto a entregar:</span>
                  <span className="font-display text-title font-bold">
                    {formatearMoneda(vuelto)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {requiereDatafono && cargandoDatafonos && <p className="text-body-sm text-text-secondary">Cargando datáfonos...</p>}
      {requiereDatafono && errorDatafonos && <MensajeError mensaje={errorDatafonos} />}
      {requiereDatafono && datafonos && datafonos.length > 0 && (
        <div>
          <label htmlFor="datafono" className="mb-1 block text-label uppercase text-text-secondary">
            Datáfono usado para cobrar
          </label>
          <select
            id="datafono"
            value={datafonoId ?? ''}
            onChange={(evento) => onCambiarDatafono(evento.target.value ? Number(evento.target.value) : null)}
            className="w-full rounded-xl border-2 border-amber-300/80 bg-white px-3 py-2 text-body focus:border-brand-primary"
          >
            <option value="">Elegí un datáfono...</option>
            {datafonos.map((datafono) => (
              <option key={datafono.id} value={datafono.id}>
                {datafono.codigo_serie}
              </option>
            ))}
          </select>
        </div>
      )}

      {errorCheckout && <MensajeError mensaje={errorCheckout} />}

      <Boton
        onClick={onCobrar}
        disabled={!puedeCobrar || !metodoPago || faltaElegirDatafono || esEfectivoInsuficiente || procesando}
        className="w-full rounded-xl py-3 text-body font-bold shadow-sm"
      >
        {procesando ? 'Procesando venta...' : 'Cobrar'}
      </Boton>
    </div>
  )
}
