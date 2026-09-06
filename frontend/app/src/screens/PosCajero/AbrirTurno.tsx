import { motion } from 'motion/react'
import { useState } from 'react'
import { ApiError } from '@/api/client'
import { Boton } from '@/components/ui/Boton'
import { MensajeError } from '@/components/ui/MensajeError'
import { fadeUp, stagger } from '@/motion/tokens'
import { abrirTurno } from './api'
import type { TurnoCaja } from './tipos'

interface AbrirTurnoProps {
  sucursalId: number
  onTurnoAbierto: (turno: TurnoCaja) => void
}

/**
 * RF-CMF-001: un cajero no puede cobrar nada sin un turno de caja abierto.
 * Es la primera pantalla que ve el cajero al entrar al POS cuando
 * `GET /caja/turnos/actual` respondió 404 — nunca se asume un turno.
 */
export function AbrirTurno({ sucursalId, onTurnoAbierto }: AbrirTurnoProps) {
  const [montoInicial, setMontoInicial] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function manejarEnvio(evento: React.FormEvent) {
    evento.preventDefault()
    setError(null)
    const monto = Number(montoInicial)
    if (!Number.isFinite(monto) || monto < 0) {
      setError('Ingresá un monto inicial válido (0 o más).')
      return
    }
    setEnviando(true)
    try {
      const turno = await abrirTurno(sucursalId, monto)
      onTurnoAbierto(turno)
    } catch (err) {
      setError(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo abrir el turno.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <motion.div
      variants={stagger}
      initial="hidden"
      animate="visible"
      className="mx-auto max-w-sm rounded-[var(--radius-card)] bg-surface-card p-8 shadow-[var(--shadow-elevation-1)]"
    >
      <motion.p variants={fadeUp} className="mb-1 font-display text-title text-brand-deep">
        Abrir turno de caja
      </motion.p>
      <motion.p variants={fadeUp} className="mb-6 text-body text-text-secondary">
        No tenés un turno abierto todavía. Contá el efectivo con el que empezás y abrí el turno para poder cobrar.
      </motion.p>

      <form onSubmit={manejarEnvio} className="space-y-4">
        <motion.div variants={fadeUp}>
          <label htmlFor="monto-inicial" className="mb-1 block text-label uppercase text-text-secondary">
            Monto inicial en caja
          </label>
          <input
            id="monto-inicial"
            type="number"
            min="0"
            step="0.01"
            required
            value={montoInicial}
            onChange={(evento) => setMontoInicial(evento.target.value)}
            className="w-full rounded-[var(--radius-card)] border border-brand-primary-soft px-3 py-2.5 text-body focus:border-brand-primary"
          />
        </motion.div>

        {error && (
          <motion.div variants={fadeUp}>
            <MensajeError mensaje={error} />
          </motion.div>
        )}

        <motion.div variants={fadeUp}>
          <Boton type="submit" disabled={enviando} className="w-full">
            {enviando ? 'Abriendo turno...' : 'Abrir turno'}
          </Boton>
        </motion.div>
      </form>
    </motion.div>
  )
}
