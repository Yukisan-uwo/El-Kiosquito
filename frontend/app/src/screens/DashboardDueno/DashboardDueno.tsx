/**
 * Dashboard Dueño — Panel general (Tarea #54). Consume los 3 reportes
 * REST reales de ClickHouse agregados en la enmienda v1.2 de
 * 011-analitica-reportes (`/analitica/reportes/{margen,merma,ticket-
 * promedio}-por-sucursal`) — antes de esa enmienda estos datos solo eran
 * alcanzables preguntándole al asistente conversacional, un vacío de
 * arquitectura documentado en `el-kiosquito-011-analitica-reportes-
 * research.md` (Decisión 7). Los tres reportes son consultas agregadas
 * de RED completa contra ClickHouse — exclusivas del rol dueno, cada rol
 * operativo ya tiene su propia analítica scopeada por sucursal contra
 * PostgreSQL en otros módulos.
 *
 * El asistente conversacional (Art. 5.10) vive en el mismo panel porque
 * complementa, no duplica, estos 3 reportes fijos: cualquier pregunta en
 * lenguaje natural que no sea "margen/merma/ticket promedio por
 * sucursal" solo puede responderse desde ahí.
 */
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { apiFetch, ApiError } from '@/api/client'
import { Boton } from '@/components/ui/Boton'
import { CardKpi } from '@/components/ui/CardKpi'
import { EsqueletoCarga } from '@/components/ui/EsqueletoCarga'
import { EstadoVacio } from '@/components/ui/EstadoVacio'
import { MensajeError } from '@/components/ui/MensajeError'
import { fadeUp, stagger } from '@/motion/tokens'

interface MargenPorSucursal {
  sucursal_id: number
  sucursal_nombre: string
  margen_total: number
  ingresos_total: number
  lineas_de_venta: number
}

interface MermaPorSucursal {
  sucursal_id: number
  sucursal_nombre: string
  valor_perdido_total: number
  cantidad_total: number
  eventos: number
}

interface TicketPromedioPorSucursal {
  sucursal_id: number
  sucursal_nombre: string
  ticket_promedio: number
  numero_ventas: number
}

interface PreguntaAsistente {
  id: number
  pregunta_texto: string
  consulta_generada: string
  respuesta_texto: string
  fecha: string
}

const formatoMoneda = new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' })
const formatoPorcentaje = new Intl.NumberFormat('es-EC', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 })

function haceDias(dias: number): string {
  const fecha = new Date()
  fecha.setDate(fecha.getDate() - dias)
  return fecha.toISOString().slice(0, 10)
}

const HOY = new Date().toISOString().slice(0, 10)

type EstadoCarga<T> =
  | { estado: 'cargando' }
  | { estado: 'error'; error: string }
  | { estado: 'listo'; datos: T[] }

function useReporte<T>(ruta: string, desde: string, hasta: string) {
  const [estado, setEstado] = useState<EstadoCarga<T>>({ estado: 'cargando' })

  const cargar = useCallback(() => {
    setEstado({ estado: 'cargando' })
    apiFetch<T[]>(ruta, { query: { desde, hasta } })
      .then((datos) => setEstado({ estado: 'listo', datos }))
      .catch((error: unknown) => {
        const mensaje = error instanceof ApiError ? error.mensajeUsuario : 'Ocurrió un error inesperado.'
        setEstado({ estado: 'error', error: mensaje })
      })
  }, [ruta, desde, hasta])

  useEffect(() => {
    cargar()
  }, [cargar])

  return { ...estado, reintentar: cargar }
}

function SeccionMargen({ desde, hasta }: { desde: string; hasta: string }) {
  const reporte = useReporte<MargenPorSucursal>('/analitica/reportes/margen-por-sucursal', desde, hasta)

  if (reporte.estado === 'cargando') return <EsqueletoCarga filas={2} alturaPx={96} />
  if (reporte.estado === 'error') return <MensajeError mensaje={reporte.error} onReintentar={reporte.reintentar} />
  if (reporte.datos.length === 0) {
    return <EstadoVacio titulo="Sin ventas en el rango" descripcion="No hay líneas de venta registradas en ClickHouse para el periodo seleccionado." />
  }

  const margenTotal = reporte.datos.reduce((suma, fila) => suma + fila.margen_total, 0)
  const ingresosTotal = reporte.datos.reduce((suma, fila) => suma + fila.ingresos_total, 0)
  const margenPct = ingresosTotal > 0 ? margenTotal / ingresosTotal : 0
  const mejorSucursal = [...reporte.datos].sort((a, b) => b.margen_total - a.margen_total)[0]

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <CardKpi etiqueta="Margen real de la red (OT1.1)" cifra={formatoMoneda.format(margenTotal)} />
        <CardKpi etiqueta="Margen sobre ingresos" cifra={formatoPorcentaje.format(margenPct)} />
        <CardKpi etiqueta="Sucursal con mayor margen" cifra={mejorSucursal.sucursal_nombre} />
      </div>
      <div className="mt-4 overflow-x-auto rounded-[var(--radius-card)] bg-surface-card shadow-[var(--shadow-elevation-1)]">
        <table className="w-full text-body">
          <thead>
            <tr className="border-b border-surface-bg text-left text-label uppercase text-text-secondary">
              <th scope="col" className="px-4 py-3">Sucursal</th>
              <th scope="col" className="px-4 py-3 text-right">Margen</th>
              <th scope="col" className="px-4 py-3 text-right">Ingresos</th>
              <th scope="col" className="px-4 py-3 text-right">Líneas de venta</th>
            </tr>
          </thead>
          <tbody>
            {reporte.datos.map((fila) => (
              <tr key={fila.sucursal_id} className="border-b border-surface-bg last:border-0">
                <td className="px-4 py-3 text-text-primary">{fila.sucursal_nombre}</td>
                <td className="px-4 py-3 text-right">{formatoMoneda.format(fila.margen_total)}</td>
                <td className="px-4 py-3 text-right">{formatoMoneda.format(fila.ingresos_total)}</td>
                <td className="px-4 py-3 text-right">{fila.lineas_de_venta}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SeccionMerma({ desde, hasta }: { desde: string; hasta: string }) {
  const reporte = useReporte<MermaPorSucursal>('/analitica/reportes/merma-por-sucursal', desde, hasta)

  if (reporte.estado === 'cargando') return <EsqueletoCarga filas={2} alturaPx={96} />
  if (reporte.estado === 'error') return <MensajeError mensaje={reporte.error} onReintentar={reporte.reintentar} />
  if (reporte.datos.length === 0) {
    return <EstadoVacio titulo="Sin mermas registradas" descripcion="No hay eventos de merma en ClickHouse para el periodo seleccionado — buena señal, no un dato faltante." />
  }

  const valorPerdidoTotal = reporte.datos.reduce((suma, fila) => suma + fila.valor_perdido_total, 0)
  const peorSucursal = [...reporte.datos].sort((a, b) => b.valor_perdido_total - a.valor_perdido_total)[0]

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <CardKpi etiqueta="Valor perdido por merma en la red (OT1.2)" cifra={formatoMoneda.format(valorPerdidoTotal)} />
        <CardKpi
          etiqueta="Sucursal con más pérdida"
          cifra={peorSucursal.sucursal_nombre}
          comparacion={{ texto: formatoMoneda.format(peorSucursal.valor_perdido_total), favorable: false }}
        />
      </div>
      <div className="mt-4 overflow-x-auto rounded-[var(--radius-card)] bg-surface-card shadow-[var(--shadow-elevation-1)]">
        <table className="w-full text-body">
          <thead>
            <tr className="border-b border-surface-bg text-left text-label uppercase text-text-secondary">
              <th scope="col" className="px-4 py-3">Sucursal</th>
              <th scope="col" className="px-4 py-3 text-right">Valor perdido</th>
              <th scope="col" className="px-4 py-3 text-right">Cantidad</th>
              <th scope="col" className="px-4 py-3 text-right">Eventos</th>
            </tr>
          </thead>
          <tbody>
            {reporte.datos.map((fila) => (
              <tr key={fila.sucursal_id} className="border-b border-surface-bg last:border-0">
                <td className="px-4 py-3 text-text-primary">{fila.sucursal_nombre}</td>
                <td className="px-4 py-3 text-right">{formatoMoneda.format(fila.valor_perdido_total)}</td>
                <td className="px-4 py-3 text-right">{fila.cantidad_total}</td>
                <td className="px-4 py-3 text-right">{fila.eventos}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SeccionTicketPromedio({ desde, hasta }: { desde: string; hasta: string }) {
  const reporte = useReporte<TicketPromedioPorSucursal>('/analitica/reportes/ticket-promedio-por-sucursal', desde, hasta)

  if (reporte.estado === 'cargando') return <EsqueletoCarga filas={2} alturaPx={96} />
  if (reporte.estado === 'error') return <MensajeError mensaje={reporte.error} onReintentar={reporte.reintentar} />
  if (reporte.datos.length === 0) {
    return <EstadoVacio titulo="Sin ventas en el rango" descripcion="No hay ventas registradas en ClickHouse para el periodo seleccionado." />
  }

  const numeroVentasTotal = reporte.datos.reduce((suma, fila) => suma + fila.numero_ventas, 0)
  const gastoTotal = reporte.datos.reduce((suma, fila) => suma + fila.ticket_promedio * fila.numero_ventas, 0)
  const ticketPromedioRed = numeroVentasTotal > 0 ? gastoTotal / numeroVentasTotal : 0

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <CardKpi etiqueta="Ticket promedio de la red (OT1.4)" cifra={formatoMoneda.format(ticketPromedioRed)} />
        <CardKpi etiqueta="Ventas totales en el periodo" cifra={String(numeroVentasTotal)} />
      </div>
      <div className="mt-4 overflow-x-auto rounded-[var(--radius-card)] bg-surface-card shadow-[var(--shadow-elevation-1)]">
        <table className="w-full text-body">
          <thead>
            <tr className="border-b border-surface-bg text-left text-label uppercase text-text-secondary">
              <th scope="col" className="px-4 py-3">Sucursal</th>
              <th scope="col" className="px-4 py-3 text-right">Ticket promedio</th>
              <th scope="col" className="px-4 py-3 text-right">N.º de ventas</th>
            </tr>
          </thead>
          <tbody>
            {reporte.datos.map((fila) => (
              <tr key={fila.sucursal_id} className="border-b border-surface-bg last:border-0">
                <td className="px-4 py-3 text-text-primary">{fila.sucursal_nombre}</td>
                <td className="px-4 py-3 text-right">{formatoMoneda.format(fila.ticket_promedio)}</td>
                <td className="px-4 py-3 text-right">{fila.numero_ventas}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Panel del asistente conversacional (Art. 5.10) — `POST
 * /analitica/asistente/preguntar`. Complementa, nunca reemplaza, los 3
 * reportes fijos de arriba: cualquier pregunta que no sea exactamente
 * margen/merma/ticket promedio por sucursal solo puede responderse acá.
 * `consulta_generada` se muestra siempre — es la prueba de que la
 * respuesta vino de una consulta real, nunca de una alucinación
 * (RN-AR-003). */
function PanelAsistente() {
  const [pregunta, setPregunta] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [respuesta, setRespuesta] = useState<PreguntaAsistente | null>(null)

  async function preguntar(evento: React.FormEvent) {
    evento.preventDefault()
    if (!pregunta.trim() || enviando) return
    setEnviando(true)
    setError(null)
    try {
      const resultado = await apiFetch<PreguntaAsistente>('/analitica/asistente/preguntar', {
        method: 'POST',
        body: { pregunta_texto: pregunta.trim() },
      })
      setRespuesta(resultado)
      setPregunta('')
    } catch (err) {
      setError(err instanceof ApiError ? err.mensajeUsuario : 'Ocurrió un error inesperado.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="rounded-[var(--radius-card)] bg-surface-card p-6 shadow-[var(--shadow-elevation-1)]">
      <p className="text-title text-text-primary">Preguntarle al asistente</p>
      <p className="mt-1 text-body-sm text-text-secondary">
        Responde solo con datos de una consulta real — nunca inventa una cifra (Art. 5.10).
      </p>
      <form onSubmit={preguntar} className="mt-4 flex gap-2">
        <input
          type="text"
          value={pregunta}
          onChange={(evento) => setPregunta(evento.target.value)}
          placeholder="¿Qué sucursal tuvo más merma esta semana?"
          className="flex-1 rounded-[var(--radius-card)] border border-brand-primary-soft px-3 py-2.5 text-body"
          disabled={enviando}
        />
        <Boton type="submit" disabled={enviando || !pregunta.trim()}>
          {enviando ? 'Consultando…' : 'Preguntar'}
        </Boton>
      </form>
      {error && <div className="mt-4"><MensajeError mensaje={error} /></div>}
      {respuesta && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 space-y-2 rounded-[var(--radius-card)] bg-surface-bg p-4"
        >
          <p className="text-body text-text-primary">{respuesta.respuesta_texto}</p>
          <p className="text-body-sm text-text-secondary">
            Consulta ejecutada: <code className="rounded bg-white/60 px-1 py-0.5">{respuesta.consulta_generada}</code>
          </p>
        </motion.div>
      )}
    </div>
  )
}

export function DashboardDueno() {
  const [desde, setDesde] = useState(haceDias(30))
  const [hasta, setHasta] = useState(HOY)
  const [rangoAplicado, setRangoAplicado] = useState({ desde, hasta })

  return (
    <motion.div variants={stagger} initial="hidden" animate="visible" className="space-y-8">
      <motion.div variants={fadeUp} className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-display text-display-lg text-brand-deep">Panel general</p>
          <p className="mt-1 text-body text-text-secondary">
            Comparación consolidada de toda la red, servida desde ClickHouse.
          </p>
        </div>
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
              className="rounded-[var(--radius-card)] border border-brand-primary-soft px-3 py-2"
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
              className="rounded-[var(--radius-card)] border border-brand-primary-soft px-3 py-2"
            />
          </label>
          <Boton type="submit" variante="secundario">Aplicar</Boton>
        </form>
      </motion.div>

      <motion.section variants={fadeUp}>
        <p className="mb-3 text-title text-text-primary">Margen por sucursal</p>
        <SeccionMargen desde={rangoAplicado.desde} hasta={rangoAplicado.hasta} />
      </motion.section>

      <motion.section variants={fadeUp}>
        <p className="mb-3 text-title text-text-primary">Merma por sucursal</p>
        <SeccionMerma desde={rangoAplicado.desde} hasta={rangoAplicado.hasta} />
      </motion.section>

      <motion.section variants={fadeUp}>
        <p className="mb-3 text-title text-text-primary">Ticket promedio por sucursal</p>
        <SeccionTicketPromedio desde={rangoAplicado.desde} hasta={rangoAplicado.hasta} />
      </motion.section>

      <motion.section variants={fadeUp}>
        <PanelAsistente />
      </motion.section>
    </motion.div>
  )
}
