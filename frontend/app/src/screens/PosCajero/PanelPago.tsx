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

interface PanelPagoProps {
  sucursalId: number
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
              className={`rounded-[var(--radius-card)] px-4 py-2 text-body ${
                metodoPago === metodo.codigo ? 'bg-brand-primary text-white' : 'border border-brand-primary-soft text-text-secondary'
              }`}
            >
              {metodo.etiqueta}
            </button>
          ))}
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
            className="w-full rounded-[var(--radius-card)] border border-brand-primary-soft px-3 py-2 text-body"
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
        disabled={!puedeCobrar || !metodoPago || faltaElegirDatafono || procesando}
        className="w-full"
      >
        {procesando ? 'Procesando venta...' : 'Cobrar'}
      </Boton>
    </div>
  )
}
