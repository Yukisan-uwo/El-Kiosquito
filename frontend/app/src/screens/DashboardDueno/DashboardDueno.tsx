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
import { useSearchParams } from 'react-router-dom'
import { apiFetch, ApiError } from '@/api/client'
import { useAuth } from '@/auth/AuthContext'
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
import { SeccionGastosSimulador } from './SeccionGastosSimulador'

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

  const datosMargen = reporte.estado === 'listo' ? reporte.datos : []
  const {
    datosPaginados,
    paginaActual,
    totalPaginas,
    itemsPorPagina,
    totalItems,
    cambiarPagina,
    cambiarItemsPorPagina,
  } = usePaginacion(datosMargen, { itemsPorPaginaInicial: 5 })

  if (reporte.estado === 'cargando') return <EsqueletoCarga filas={2} alturaPx={96} />
  if (reporte.estado === 'error') return <MensajeError mensaje={reporte.error} onReintentar={reporte.reintentar} />
  if (reporte.datos.length === 0) {
    return <EstadoVacio titulo="Sin ventas en el rango" descripcion="No hay líneas de venta registradas para el periodo seleccionado." />
  }

  const margenTotal = reporte.datos.reduce((suma, fila) => suma + fila.margen_total, 0)
  const ingresosTotal = reporte.datos.reduce((suma, fila) => suma + fila.ingresos_total, 0)
  const margenPct = ingresosTotal > 0 ? margenTotal / ingresosTotal : 0
  const mejorSucursal = [...reporte.datos].sort((a, b) => b.margen_total - a.margen_total)[0]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <CardKpi etiqueta="Margen real de la red" cifra={formatoMoneda.format(margenTotal)} />
        <CardKpi etiqueta="Margen sobre ingresos" cifra={formatoPorcentaje.format(margenPct)} />
        <CardKpi etiqueta="Sucursal con mayor margen" cifra={mejorSucursal.sucursal_nombre} />
      </div>

      <GraficoBarras
        titulo="Comparativa de Margen e Ingresos por Sucursal"
        subtitulo="Relación entre facturación bruta y margen neto en cada punto de venta"
        datos={reporte.datos.map((fila) => ({
          sucursal: fila.sucursal_nombre.replace('El Kiosquito — ', ''),
          ingresos: fila.ingresos_total,
          margen: fila.margen_total,
        }))}
        claveEjeX="sucursal"
        barras={[
          { clave: 'ingresos', nombre: 'Ingresos ($)', color: '#D4A017' },
          { clave: 'margen', nombre: 'Margen ($)', color: '#946F00' },
        ]}
        formatearValor={(val) => formatoMoneda.format(val)}
        altura={250}
      />

      <div className="overflow-x-auto rounded-2xl border-2 border-amber-200/90 bg-white shadow-2xs">
        <table className="w-full text-body">
          <thead>
            <tr className="border-b-2 border-amber-200/80 bg-amber-50/70 text-left text-label uppercase text-brand-deep font-bold">
              <th scope="col" className="px-4 py-3">Sucursal</th>
              <th scope="col" className="px-4 py-3 text-right">Margen</th>
              <th scope="col" className="px-4 py-3 text-right">Ingresos</th>
              <th scope="col" className="px-4 py-3 text-right">Líneas de venta</th>
            </tr>
          </thead>
          <tbody className="print:hidden">
            {datosPaginados.map((fila) => (
              <tr key={fila.sucursal_id} className="border-b border-amber-100 last:border-0 hover:bg-amber-50/40 transition-colors">
                <td className="px-4 py-3 font-semibold text-brand-deep">{fila.sucursal_nombre}</td>
                <td className="px-4 py-3 text-right font-bold text-brand-primary">{formatoMoneda.format(fila.margen_total)}</td>
                <td className="px-4 py-3 text-right font-medium text-text-primary">{formatoMoneda.format(fila.ingresos_total)}</td>
                <td className="px-4 py-3 text-right text-text-secondary">{fila.lineas_de_venta}</td>
              </tr>
            ))}
          </tbody>
          <tbody className="hidden print:table-row-group">
            {reporte.datos.map((fila) => (
              <tr key={`print-${fila.sucursal_id}`} className="border-b border-amber-100 last:border-0">
                <td className="px-4 py-2.5 font-semibold text-brand-deep">{fila.sucursal_nombre}</td>
                <td className="px-4 py-2.5 text-right font-bold text-brand-primary">{formatoMoneda.format(fila.margen_total)}</td>
                <td className="px-4 py-2.5 text-right font-medium text-text-primary">{formatoMoneda.format(fila.ingresos_total)}</td>
                <td className="px-4 py-2.5 text-right text-text-secondary">{fila.lineas_de_venta}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="no-print">
        <Paginacion
          paginaActual={paginaActual}
          totalPaginas={totalPaginas}
          totalItems={totalItems}
          itemsPorPagina={itemsPorPagina}
          onCambiarPagina={cambiarPagina}
          onCambiarItemsPorPagina={cambiarItemsPorPagina}
          etiquetaItems="sucursales"
        />
      </div>
    </div>
  )
}

function SeccionMerma({ desde, hasta }: { desde: string; hasta: string }) {
  const reporte = useReporte<MermaPorSucursal>('/analitica/reportes/merma-por-sucursal', desde, hasta)

  const datosMerma = reporte.estado === 'listo' ? reporte.datos : []
  const {
    datosPaginados,
    paginaActual,
    totalPaginas,
    itemsPorPagina,
    totalItems,
    cambiarPagina,
    cambiarItemsPorPagina,
  } = usePaginacion(datosMerma, { itemsPorPaginaInicial: 5 })

  if (reporte.estado === 'cargando') return <EsqueletoCarga filas={2} alturaPx={96} />
  if (reporte.estado === 'error') return <MensajeError mensaje={reporte.error} onReintentar={reporte.reintentar} />
  if (reporte.datos.length === 0) {
    return <EstadoVacio titulo="Sin mermas registradas" descripcion="No hay eventos de merma registrados para el periodo seleccionado — excelente indicador operativo." />
  }

  const valorPerdidoTotal = reporte.datos.reduce((suma, fila) => suma + fila.valor_perdido_total, 0)
  const peorSucursal = [...reporte.datos].sort((a, b) => b.valor_perdido_total - a.valor_perdido_total)[0]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <CardKpi etiqueta="Valor perdido por merma en la red" cifra={formatoMoneda.format(valorPerdidoTotal)} />
        <CardKpi
          etiqueta="Sucursal con más pérdida"
          cifra={peorSucursal.sucursal_nombre}
          comparacion={{ texto: formatoMoneda.format(peorSucursal.valor_perdido_total), favorable: false }}
        />
      </div>

      <GraficoBarras
        titulo="Pérdida por Merma según Sucursal"
        subtitulo="Impacto financiero acumulado de productos vencidos, dañados o mermados"
        datos={reporte.datos.map((fila) => ({
          sucursal: fila.sucursal_nombre.replace('El Kiosquito — ', ''),
          merma: fila.valor_perdido_total,
        }))}
        claveEjeX="sucursal"
        barras={[
          { clave: 'merma', nombre: 'Valor perdido ($)', color: '#A32E1F' },
        ]}
        formatearValor={(val) => formatoMoneda.format(val)}
        altura={230}
      />

      <div className="overflow-x-auto rounded-2xl border-2 border-amber-200/90 bg-white shadow-2xs">
        <table className="w-full text-body">
          <thead>
            <tr className="border-b-2 border-amber-200/80 bg-amber-50/70 text-left text-label uppercase text-brand-deep font-bold">
              <th scope="col" className="px-4 py-3">Sucursal</th>
              <th scope="col" className="px-4 py-3 text-right">Valor perdido</th>
              <th scope="col" className="px-4 py-3 text-right">Cantidad</th>
              <th scope="col" className="px-4 py-3 text-right">Eventos</th>
            </tr>
          </thead>
          <tbody className="print:hidden">
            {datosPaginados.map((fila) => (
              <tr key={fila.sucursal_id} className="border-b border-amber-100 last:border-0 hover:bg-amber-50/40 transition-colors">
                <td className="px-4 py-3 font-semibold text-brand-deep">{fila.sucursal_nombre}</td>
                <td className="px-4 py-3 text-right font-bold text-status-danger">{formatoMoneda.format(fila.valor_perdido_total)}</td>
                <td className="px-4 py-3 text-right font-medium text-text-primary">{fila.cantidad_total}</td>
                <td className="px-4 py-3 text-right text-text-secondary">{fila.eventos}</td>
              </tr>
            ))}
          </tbody>
          <tbody className="hidden print:table-row-group">
            {reporte.datos.map((fila) => (
              <tr key={`print-${fila.sucursal_id}`} className="border-b border-amber-100 last:border-0">
                <td className="px-4 py-2.5 font-semibold text-brand-deep">{fila.sucursal_nombre}</td>
                <td className="px-4 py-2.5 text-right font-bold text-status-danger">{formatoMoneda.format(fila.valor_perdido_total)}</td>
                <td className="px-4 py-2.5 text-right font-medium text-text-primary">{fila.cantidad_total}</td>
                <td className="px-4 py-2.5 text-right text-text-secondary">{fila.eventos}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="no-print">
        <Paginacion
          paginaActual={paginaActual}
          totalPaginas={totalPaginas}
          totalItems={totalItems}
          itemsPorPagina={itemsPorPagina}
          onCambiarPagina={cambiarPagina}
          onCambiarItemsPorPagina={cambiarItemsPorPagina}
          etiquetaItems="sucursales"
        />
      </div>
    </div>
  )
}

function SeccionTicketPromedio({ desde, hasta }: { desde: string; hasta: string }) {
  const reporte = useReporte<TicketPromedioPorSucursal>('/analitica/reportes/ticket-promedio-por-sucursal', desde, hasta)

  const datosTicket = reporte.estado === 'listo' ? reporte.datos : []
  const {
    datosPaginados,
    paginaActual,
    totalPaginas,
    itemsPorPagina,
    totalItems,
    cambiarPagina,
    cambiarItemsPorPagina,
  } = usePaginacion(datosTicket, { itemsPorPaginaInicial: 5 })

  if (reporte.estado === 'cargando') return <EsqueletoCarga filas={2} alturaPx={96} />
  if (reporte.estado === 'error') return <MensajeError mensaje={reporte.error} onReintentar={reporte.reintentar} />
  if (reporte.datos.length === 0) {
    return <EstadoVacio titulo="Sin ventas en el rango" descripcion="No hay ventas registradas para el periodo seleccionado." />
  }

  const numeroVentasTotal = reporte.datos.reduce((suma, fila) => suma + fila.numero_ventas, 0)
  const gastoTotal = reporte.datos.reduce((suma, fila) => suma + fila.ticket_promedio * fila.numero_ventas, 0)
  const ticketPromedioRed = numeroVentasTotal > 0 ? gastoTotal / numeroVentasTotal : 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <CardKpi etiqueta="Ticket promedio de la red" cifra={formatoMoneda.format(ticketPromedioRed)} />
        <CardKpi etiqueta="Ventas totales en el periodo" cifra={String(numeroVentasTotal)} />
      </div>

      <GraficoBarras
        titulo="Ticket Promedio por Sucursal"
        subtitulo="Consumo promedio por transacción de compra en cada tienda"
        datos={reporte.datos.map((fila) => ({
          sucursal: fila.sucursal_nombre.replace('El Kiosquito — ', ''),
          ticket: fila.ticket_promedio,
        }))}
        claveEjeX="sucursal"
        barras={[
          { clave: 'ticket', nombre: 'Ticket promedio ($)', color: '#2F6B8C' },
        ]}
        formatearValor={(val) => formatoMoneda.format(val)}
        altura={230}
      />

      <div className="overflow-x-auto rounded-2xl border-2 border-amber-200/90 bg-white shadow-2xs">
        <table className="w-full text-body">
          <thead>
            <tr className="border-b-2 border-amber-200/80 bg-amber-50/70 text-left text-label uppercase text-brand-deep font-bold">
              <th scope="col" className="px-4 py-3">Sucursal</th>
              <th scope="col" className="px-4 py-3 text-right">Ticket promedio</th>
              <th scope="col" className="px-4 py-3 text-right">N.º de ventas</th>
            </tr>
          </thead>
          <tbody className="print:hidden">
            {datosPaginados.map((fila) => (
              <tr key={fila.sucursal_id} className="border-b border-amber-100 last:border-0 hover:bg-amber-50/40 transition-colors">
                <td className="px-4 py-3 font-semibold text-brand-deep">{fila.sucursal_nombre}</td>
                <td className="px-4 py-3 text-right font-bold text-brand-primary">{formatoMoneda.format(fila.ticket_promedio)}</td>
                <td className="px-4 py-3 text-right text-text-secondary">{fila.numero_ventas}</td>
              </tr>
            ))}
          </tbody>
          <tbody className="hidden print:table-row-group">
            {reporte.datos.map((fila) => (
              <tr key={`print-${fila.sucursal_id}`} className="border-b border-amber-100 last:border-0">
                <td className="px-4 py-2.5 font-semibold text-brand-deep">{fila.sucursal_nombre}</td>
                <td className="px-4 py-2.5 text-right font-bold text-brand-primary">{formatoMoneda.format(fila.ticket_promedio)}</td>
                <td className="px-4 py-2.5 text-right text-text-secondary">{fila.numero_ventas}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="no-print">
        <Paginacion
          paginaActual={paginaActual}
          totalPaginas={totalPaginas}
          totalItems={totalItems}
          itemsPorPagina={itemsPorPagina}
          onCambiarPagina={cambiarPagina}
          onCambiarItemsPorPagina={cambiarItemsPorPagina}
          etiquetaItems="sucursales"
        />
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
  const [historial, setHistorial] = useState<PreguntaAsistente[]>([])

  const {
    datosPaginados: historialPaginado,
    paginaActual,
    totalPaginas,
    itemsPorPagina,
    totalItems,
    cambiarPagina,
  } = usePaginacion(historial, { itemsPorPaginaInicial: 3 })

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
      setHistorial((prev) => [resultado, ...prev])
      setPregunta('')
    } catch (err) {
      setError(err instanceof ApiError ? err.mensajeUsuario : 'Ocurrió un error inesperado.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="rounded-2xl border-2 border-amber-200/90 bg-white p-6 shadow-2xs space-y-4">
      <div className="flex items-center gap-2 text-brand-deep">
        <svg className="h-5 w-5 text-brand-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
        <p className="font-display text-title font-bold">Asistente de Consultas Analíticas</p>
      </div>
      <p className="text-body-sm text-text-secondary">
        Realizá preguntas en lenguaje natural sobre las ventas y operaciones de la red completa.
      </p>

      <form onSubmit={preguntar} className="flex gap-2">
        <input
          type="text"
          value={pregunta}
          onChange={(e) => setPregunta(e.target.value)}
          placeholder="Ej: ¿Qué producto tuvo más ventas la semana pasada?"
          className="flex-1 rounded-xl border-2 border-amber-200/90 bg-white px-3.5 py-2 text-body focus:border-brand-primary focus:outline-none"
        />
        <Boton type="submit" disabled={enviando || !pregunta.trim()}>
          {enviando ? 'Consultando…' : 'Preguntar'}
        </Boton>
      </form>

      {error && <MensajeError mensaje={error} />}

      {historial.length > 0 && (
        <div className="space-y-3 pt-2">
          <p className="text-label uppercase text-text-secondary font-semibold">Consultas recientes</p>
          <div className="space-y-3">
            {historialPaginado.map((item) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-2 rounded-xl border-2 border-amber-200/80 bg-amber-50/40 p-4 shadow-2xs"
              >
                <div className="flex items-center justify-between text-body-sm">
                  <span className="font-bold text-brand-deep">«{item.pregunta_texto}»</span>
                  {item.fecha && (
                    <span className="text-text-secondary text-xs">{new Date(item.fecha).toLocaleTimeString('es-EC')}</span>
                  )}
                </div>
                <p className="text-body text-text-primary">{item.respuesta_texto}</p>
                <p className="text-body-sm text-text-secondary">
                  Consulta ejecutada:{' '}
                  <code className="rounded-lg bg-white border border-amber-200 px-2 py-0.5 font-mono text-xs text-text-primary">
                    {item.consulta_generada}
                  </code>
                </p>
              </motion.div>
            ))}
          </div>
          <Paginacion
            paginaActual={paginaActual}
            totalPaginas={totalPaginas}
            totalItems={totalItems}
            itemsPorPagina={itemsPorPagina}
            onCambiarPagina={cambiarPagina}
            etiquetaItems="preguntas"
          />
        </div>
      )}
    </div>
  )
}

export function DashboardDueno() {
  const { sesion } = useAuth()
  const [desde, setDesde] = useState(haceDias(30))
  const [hasta, setHasta] = useState(HOY)
  const [rangoAplicado, setRangoAplicado] = useState({ desde, hasta })

  const [searchParams, setSearchParams] = useSearchParams()
  const tabActiva = searchParams.get('tab') === 'simulador' ? 'simulador' : 'resumen'

  function cambiarTab(tab: 'resumen' | 'simulador') {
    if (tab === 'resumen') {
      const nuevos = new URLSearchParams(searchParams)
      nuevos.delete('tab')
      setSearchParams(nuevos)
    } else {
      setSearchParams({ tab: 'simulador' })
    }
  }

  return (
    <motion.div variants={stagger} initial="hidden" animate="visible" className="space-y-8">
      {/* Encabezado formal visible únicamente en impresión o PDF */}
      <EncabezadoReporteImpresion
        titulo="Informe Ejecutivo Consolidado de Red"
        subtitulo="Comparación consolidada de ventas, rentabilidad, márgenes y mermas de toda la red"
        rangoFechas={{ desde: rangoAplicado.desde, hasta: rangoAplicado.hasta }}
        sucursalNombre="Toda la Red (Nivel Corporativo)"
        usuarioNombre={sesion?.claims.sub ?? 'Dirección General'}
      />

      {/* Selector de Pestañas del Dueño */}
      <div className="no-print flex flex-wrap items-center gap-2 rounded-2xl border-2 border-amber-200/90 bg-white p-1.5 shadow-2xs w-fit">
        <button
          type="button"
          onClick={() => cambiarTab('resumen')}
          aria-pressed={tabActiva === 'resumen'}
          className={`rounded-xl px-4 py-2 text-body-sm font-bold transition-all ${
            tabActiva === 'resumen'
              ? 'bg-brand-primary text-white shadow-2xs'
              : 'text-brand-deep hover:bg-amber-50 hover:text-brand-primary'
          }`}
        >
          📊 Resumen Ejecutivo de Red
        </button>
        <button
          type="button"
          onClick={() => cambiarTab('simulador')}
          aria-pressed={tabActiva === 'simulador'}
          className={`rounded-xl px-4 py-2 text-body-sm font-bold transition-all ${
            tabActiva === 'simulador'
              ? 'bg-brand-primary text-white shadow-2xs'
              : 'text-brand-deep hover:bg-amber-50 hover:text-brand-primary'
          }`}
        >
          ✨ Gastos del Local y Simulador de Precios con IA
        </button>
      </div>

      {tabActiva === 'simulador' ? (
        <motion.section variants={fadeUp}>
          <SeccionGastosSimulador />
        </motion.section>
      ) : (
        <>
          <motion.div variants={fadeUp} className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="font-display text-display-lg text-brand-deep font-bold">Panel general</p>
              <p className="mt-1 text-body text-text-secondary">
                Comparación consolidada de ventas, rentabilidad y pérdidas de toda la red.
              </p>
            </div>
            <div className="no-print flex flex-wrap items-end gap-3">
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(evento) => {
                  evento.preventDefault()
                  setRangoAplicado({ desde, hasta })
                }}
              >
                <label className="flex flex-col text-body-sm text-text-secondary font-medium">
                  Desde
                  <input
                    type="date"
                    value={desde}
                    max={hasta}
                    onChange={(evento) => setDesde(evento.target.value)}
                    className="rounded-xl border-2 border-amber-200/90 bg-white px-3 py-2 text-body shadow-2xs focus:border-brand-primary"
                  />
                </label>
                <label className="flex flex-col text-body-sm text-text-secondary font-medium">
                  Hasta
                  <input
                    type="date"
                    value={hasta}
                    min={desde}
                    max={HOY}
                    onChange={(evento) => setHasta(evento.target.value)}
                    className="rounded-xl border-2 border-amber-200/90 bg-white px-3 py-2 text-body shadow-2xs focus:border-brand-primary"
                  />
                </label>
                <Boton type="submit" variante="secundario">Aplicar</Boton>
              </form>

              <BotonExportarReporte
                etiqueta="Exportar informe (PDF)"
                tituloReporte="Informe Ejecutivo Consolidado de Red"
                variante="primario"
              />
            </div>
          </motion.div>

          <motion.section variants={fadeUp} className="print-break-inside-avoid">
            <p className="mb-3 text-title text-text-primary font-bold">Margen comercial por sucursal</p>
            <SeccionMargen desde={rangoAplicado.desde} hasta={rangoAplicado.hasta} />
          </motion.section>

          <motion.section variants={fadeUp} className="print-break-inside-avoid">
            <p className="mb-3 text-title text-text-primary font-bold">Merma por sucursal</p>
            <SeccionMerma desde={rangoAplicado.desde} hasta={rangoAplicado.hasta} />
          </motion.section>

          <motion.section variants={fadeUp} className="print-break-inside-avoid">
            <p className="mb-3 text-title text-text-primary font-bold">Ticket promedio por sucursal</p>
            <SeccionTicketPromedio desde={rangoAplicado.desde} hasta={rangoAplicado.hasta} />
          </motion.section>

          {/* Asistente conversacional: interactivo, se excluye de la exportación impresa */}
          <motion.section variants={fadeUp} className="no-print">
            <PanelAsistente />
          </motion.section>
        </>
      )}
    </motion.div>
  )
}
