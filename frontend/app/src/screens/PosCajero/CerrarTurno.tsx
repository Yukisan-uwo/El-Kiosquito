import { motion } from 'motion/react'
import { useState } from 'react'
import { ApiError } from '@/api/client'
import { Boton } from '@/components/ui/Boton'
import { MensajeError } from '@/components/ui/MensajeError'
import { overlayFade, scaleIn } from '@/motion/tokens'
import { cerrarTurno } from './api'
import type { TurnoCaja } from './tipos'

function formatearMoneda(valor: number): string {
  return new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(valor)
}

interface CerrarTurnoProps {
  turno: TurnoCaja
  onCerrado: (turno: TurnoCaja) => void
  onCancelar: () => void
}

/**
 * RF-CMF-002/003/004: el cuadre real lo calcula el backend (`monto_esperado`
 * y `diferencia` vienen en la respuesta) — esta pantalla nunca calcula ni
 * muestra una diferencia estimada antes de cerrar, solo pide el conteo
 * físico y, si el backend exige motivo (RN-CMF-002), lo solicita.
 */
export function CerrarTurno({ turno, onCerrado, onCancelar }: CerrarTurnoProps) {
  const [montoContado, setMontoContado] = useState('')
  const [motivoDiferencia, setMotivoDiferencia] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function manejarEnvio(evento: React.FormEvent) {
    evento.preventDefault()
    setError(null)
    const monto = Number(montoContado)
    if (!Number.isFinite(monto) || monto < 0) {
      setError('Ingresá el monto contado en caja (0 o más).')
      return
    }
    setEnviando(true)
    try {
      const cerrado = await cerrarTurno(turno.id, monto, motivoDiferencia.trim() || undefined)
      onCerrado(cerrado)
    } catch (err) {
      setError(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo cerrar el turno.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <motion.div
      variants={overlayFade}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4"
    >
      <motion.div
        variants={scaleIn}
        initial="hidden"
        animate="visible"
        className="w-full max-w-sm rounded-[var(--radius-card)] bg-surface-card p-6 shadow-[var(--shadow-elevation-2)]"
      >
        <p className="mb-1 font-display text-title text-brand-deep">Cerrar turno</p>
        <p className="mb-4 text-body-sm text-text-secondary">
          Turno abierto con {formatearMoneda(turno.monto_inicial)} desde el {new Date(turno.hora_apertura).toLocaleString('es-EC')}.
        </p>

        <form onSubmit={manejarEnvio} className="space-y-4">
          <div>
            <label htmlFor="monto-contado" className="mb-1 block text-label uppercase text-text-secondary">
              Monto contado en caja
            </label>
            <input
              id="monto-contado"
              type="number"
              min="0"
              step="0.01"
              required
              value={montoContado}
              onChange={(evento) => setMontoContado(evento.target.value)}
              className="w-full rounded-[var(--radius-card)] border border-brand-primary-soft px-3 py-2.5 text-body focus:border-brand-primary"
            />
          </div>
          <div>
            <label htmlFor="motivo-diferencia" className="mb-1 block text-label uppercase text-text-secondary">
              Motivo de la diferencia (si la hay)
            </label>
            <input
              id="motivo-diferencia"
              type="text"
              value={motivoDiferencia}
              onChange={(evento) => setMotivoDiferencia(evento.target.value)}
              className="w-full rounded-[var(--radius-card)] border border-brand-primary-soft px-3 py-2.5 text-body focus:border-brand-primary"
            />
          </div>

          {error && <MensajeError mensaje={error} />}

          <div className="flex gap-2">
            <Boton variante="ghost" type="button" onClick={onCancelar} className="flex-1">
              Cancelar
            </Boton>
            <Boton type="submit" disabled={enviando} className="flex-1">
              {enviando ? 'Cerrando...' : 'Cerrar turno'}
            </Boton>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}
