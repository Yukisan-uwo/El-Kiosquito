import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { apiFetch, ApiError } from '@/api/client'
import { BadgeEstado } from '@/components/ui/BadgeEstado'
import { Boton } from '@/components/ui/Boton'
import { CardKpi } from '@/components/ui/CardKpi'
import { EsqueletoCarga } from '@/components/ui/EsqueletoCarga'
import { MensajeError } from '@/components/ui/MensajeError'
import { Paginacion } from '@/components/ui/Paginacion'
import { usePaginacion } from '@/components/ui/usePaginacion'
import { fadeUp } from '@/motion/tokens'
import {
  actualizarGastoSucursal,
  aplicarPreciosSimulados,
  crearGastoSucursal,
  ejecutarSimulacionGastosIa,
  eliminarGastoSucursal,
  listarGastosSucursal,
  type GastoSucursal,
  type SimulacionGastosRespuesta,
} from './apiGastos'

interface SucursalBasica {
  id: number
  nombre: string
}

const formatoMoneda = new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' })
const formatoPorcentaje = new Intl.NumberFormat('es-EC', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 })

function ModalGastoSucursal({
  sucursalId,
  gastoParaEditar,
  onCerrar,
  onGuardado,
}: {
  sucursalId: number
  gastoParaEditar: GastoSucursal | null
  onCerrar: () => void
  onGuardado: () => void
}) {
  const [concepto, setConcepto] = useState(gastoParaEditar?.concepto ?? '')
  const [categoria, setCategoria] = useState(gastoParaEditar?.categoria_gasto ?? 'servicio')
  const [monto, setMonto] = useState(gastoParaEditar ? String(Number(gastoParaEditar.monto_mensual)) : '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function manejarGuardar(e: React.FormEvent) {
    e.preventDefault()
    const montoNum = Number(monto)
    if (!concepto.trim() || concepto.trim().length < 3) {
      setError('El concepto debe tener al menos 3 caracteres.')
      return
    }
    if (!Number.isFinite(montoNum) || montoNum <= 0) {
      setError('El monto mensual debe ser un número mayor a 0.')
      return
    }

    setGuardando(true)
    setError(null)
    try {
      if (gastoParaEditar) {
        await actualizarGastoSucursal(gastoParaEditar.id, {
          concepto: concepto.trim(),
          categoria_gasto: categoria,
          monto_mensual: montoNum,
        })
      } else {
        await crearGastoSucursal({
          sucursal_id: sucursalId,
          concepto: concepto.trim(),
          categoria_gasto: categoria,
          monto_mensual: montoNum,
        })
      }
      onGuardado()
      onCerrar()
    } catch (err) {
      setError(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo guardar el gasto.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="w-full max-w-md rounded-2xl border-2 border-amber-200/90 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-title font-bold text-brand-deep">
            {gastoParaEditar ? 'Editar gasto operativo del local' : 'Registrar gasto del local'}
          </h3>
          <button type="button" onClick={onCerrar} className="text-text-secondary hover:text-text-primary">✕</button>
        </div>
        {error && <div className="mb-3"><MensajeError mensaje={error} /></div>}
        <form onSubmit={manejarGuardar} noValidate className="space-y-4">
          <div>
            <label className="block text-label uppercase text-text-secondary mb-1">Concepto o detalle del gasto</label>
            <input
              type="text"
              required
              placeholder="Ej: Arriendo local, Luz refrigeradores, Sueldo cajero..."
              value={concepto}
              onChange={(e) => setConcepto(e.target.value)}
              className="w-full rounded-xl border-2 border-amber-200/90 bg-white p-2.5 text-body focus:border-brand-primary"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-label uppercase text-text-secondary mb-1">Categoría</label>
              <select
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                className="w-full rounded-xl border-2 border-amber-200/90 bg-white p-2.5 text-body focus:border-brand-primary"
              >
                <option value="arriendo">Arriendo / Local</option>
                <option value="energia">Energía / Refrigeración</option>
                <option value="servicio">Agua / Servicios</option>
                <option value="personal">Sueldos / Nómina</option>
                <option value="mantenimiento">Mantenimiento</option>
                <option value="otro">Otro gasto fijo</option>
              </select>
            </div>

            <div>
              <label className="block text-label uppercase text-text-secondary mb-1">Monto mensual ($)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                placeholder="0.00"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                className="w-full rounded-xl border-2 border-amber-200/90 bg-white p-2.5 text-body font-mono focus:border-brand-primary"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Boton type="button" variante="secundario" onClick={onCerrar}>Cancelar</Boton>
            <Boton type="submit" disabled={guardando || !concepto.trim() || Number(monto) <= 0}>
              {guardando ? 'Guardando...' : gastoParaEditar ? 'Guardar cambios' : 'Registrar gasto'}
            </Boton>
          </div>
        </form>
      </div>
    </div>
  )
}

export function SeccionGastosSimulador() {
  const [sucursales, setSucursales] = useState<SucursalBasica[]>([
    { id: 1, nombre: 'Sucursal #1 - Matriz Centro' },
    { id: 2, nombre: 'Sucursal #2 - Norte' },
  ])
  const [sucursalSeleccionadaId, setSucursalSeleccionadaId] = useState<number>(1)
  const [gastos, setGastos] = useState<GastoSucursal[]>([])
  const [cargandoGastos, setCargandoGastos] = useState(true)
  const [errorGastos, setErrorGastos] = useState<string | null>(null)

  // Modales y formularios
  const [modalGastoAbierto, setModalGastoAbierto] = useState(false)
  const [gastoParaEditar, setGastoParaEditar] = useState<GastoSucursal | null>(null)

  // Parámetros de simulación What-If
  const [metaUtilidad, setMetaUtilidad] = useState<number>(15)
  const [variacionGastos, setVariacionGastos] = useState<number>(0)
  const [simulando, setSimulando] = useState(false)
  const [resultadoSimulacion, setResultadoSimulacion] = useState<SimulacionGastosRespuesta | null>(null)
  const [errorSimulacion, setErrorSimulacion] = useState<string | null>(null)

  // Aplicación de precios
  const [aplicandoPrecios, setAplicandoPrecios] = useState(false)
  const [mensajeExitoAplicacion, setMensajeExitoAplicacion] = useState<string | null>(null)

  // Búsqueda de productos en la tabla de simulación
  const [busquedaProducto, setBusquedaProducto] = useState('')

  // Cargar sucursales reales de la base de datos
  useEffect(() => {
    apiFetch<SucursalBasica[]>('/sucursales')
      .then((data) => {
        if (data && data.length > 0) {
          setSucursales(data)
          setSucursalSeleccionadaId(data[0].id)
        }
      })
      .catch(() => {
        // Fallback a sucursales por defecto
      })
  }, [])

  // Cargar gastos de la sucursal seleccionada
  const cargarGastos = useCallback(() => {
    setCargandoGastos(true)
    setErrorGastos(null)
    listarGastosSucursal(sucursalSeleccionadaId)
      .then((data) => setGastos(data))
      .catch((err) => {
        setErrorGastos(err instanceof ApiError ? err.mensajeUsuario : 'No se pudieron cargar los gastos.')
      })
      .finally(() => setCargandoGastos(false))
  }, [sucursalSeleccionadaId])

  useEffect(() => {
    cargarGastos()
  }, [cargarGastos])

  // Ejecutar simulación con IA
  async function manejarSimular() {
    setSimulando(true)
    setErrorSimulacion(null)
    setMensajeExitoAplicacion(null)
    try {
      const resp = await ejecutarSimulacionGastosIa({
        sucursal_id: sucursalSeleccionadaId,
        meta_utilidad_neta_pct: metaUtilidad,
        variacion_gastos_pct: variacionGastos,
      })
      setResultadoSimulacion(resp)
    } catch (err) {
      setErrorSimulacion(err instanceof ApiError ? err.mensajeUsuario : 'Ocurrió un error al ejecutar la simulación con IA.')
    } finally {
      setSimulando(false)
    }
  }

  // Eliminar gasto
  async function manejarEliminarGasto(gastoId: number) {
    if (!window.confirm('¿Confirmas eliminar este rubro de gasto de la sucursal?')) return
    try {
      await eliminarGastoSucursal(gastoId)
      cargarGastos()
    } catch (err) {
      alert(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo eliminar el gasto.')
    }
  }

  // Aplicar precios sugeridos al sistema oficial
  async function manejarAplicarPrecios() {
    if (!resultadoSimulacion || resultadoSimulacion.productos.length === 0) return
    if (
      !window.confirm(
        `¿Deseas aplicar estos ${resultadoSimulacion.productos.length} precios y márgenes recomendados por la IA como precios vigentes oficiales para la sucursal?`,
      )
    ) {
      return
    }

    setAplicandoPrecios(true)
    setMensajeExitoAplicacion(null)
    try {
      const items = resultadoSimulacion.productos.map((p) => ({
        producto_id: p.producto_id,
        precio_sugerido: Number(p.precio_sugerido),
        justificacion: p.justificacion,
      }))
      const resp = await aplicarPreciosSimulados({
        sucursal_id: sucursalSeleccionadaId,
        items,
      })
      setMensajeExitoAplicacion(resp.mensaje)
    } catch (err) {
      alert(err instanceof ApiError ? err.mensajeUsuario : 'No se pudieron aplicar los precios.')
    } finally {
      setAplicandoPrecios(false)
    }
  }

  // KPIs de gastos actuales
  const totalGastosFijos = useMemo(() => {
    return gastos.reduce((sum, g) => sum + Number(g.monto_mensual), 0)
  }, [gastos])

  const gastoEnergia = useMemo(() => {
    return gastos.filter((g) => g.categoria_gasto === 'energia').reduce((sum, g) => sum + Number(g.monto_mensual), 0)
  }, [gastos])

  const gastoArriendo = useMemo(() => {
    return gastos.filter((g) => g.categoria_gasto === 'arriendo').reduce((sum, g) => sum + Number(g.monto_mensual), 0)
  }, [gastos])

  // Paginación de la tabla de simulación
  const productosFiltrados = useMemo(() => {
    if (!resultadoSimulacion) return []
    return resultadoSimulacion.productos.filter((p) => {
      if (!busquedaProducto.trim()) return true
      return p.nombre.toLowerCase().includes(busquedaProducto.toLowerCase())
    })
  }, [resultadoSimulacion, busquedaProducto])

  const {
    datosPaginados,
    paginaActual,
    totalPaginas,
    itemsPorPagina,
    totalItems,
    cambiarPagina,
  } = usePaginacion(productosFiltrados, { itemsPorPaginaInicial: 6 })

  return (
    <div className="space-y-8">
      {/* Selector de Sucursal y Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border-2 border-amber-200/90 bg-white p-5 shadow-2xs">
        <div>
          <h2 className="font-display text-title font-bold text-brand-deep">
            Gastos Fijos del Local y Simulador de Precios / Márgenes con IA
          </h2>
          <p className="mt-1 text-body-sm text-text-secondary">
            Costeo por absorción y análisis de punto de equilibrio: vincula los costos de arriendo, refrigeración y nómina con el margen de venta de cada producto.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-body-sm font-semibold text-text-secondary">Sucursal evaluada:</label>
          <select
            value={sucursalSeleccionadaId}
            onChange={(e) => {
              setSucursalSeleccionadaId(Number(e.target.value))
              setResultadoSimulacion(null)
              setMensajeExitoAplicacion(null)
            }}
            className="rounded-xl border-2 border-amber-200/90 bg-white px-3 py-2 text-body font-medium focus:border-brand-primary"
          >
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tarjetas KPI de Gastos Fijos */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <CardKpi
          etiqueta="Total Gastos Fijos / Mes"
          cifra={formatoMoneda.format(totalGastosFijos)}
          comparacion={{ texto: 'Costos operativos fijos del local', favorable: true }}
        />
        <CardKpi
          etiqueta="Arriendo de Local"
          cifra={formatoMoneda.format(gastoArriendo)}
          comparacion={{ texto: `${((gastoArriendo / (totalGastosFijos || 1)) * 100).toFixed(0)}% del presupuesto fijo`, favorable: true }}
        />
        <CardKpi
          etiqueta="Energía y Refrigeración"
          cifra={formatoMoneda.format(gastoEnergia)}
          comparacion={{ texto: 'Vitrinas y cadena de frío 24/7', favorable: false }}
        />
        <CardKpi
          etiqueta="Rubros Registrados"
          cifra={String(gastos.length)}
          comparacion={{ texto: 'Conceptos de gasto auditados', favorable: true }}
        />
      </div>

      {/* Tabla de Gastos Fijos de la Sucursal */}
      <div className="rounded-2xl border-2 border-amber-200/90 bg-white p-5 shadow-2xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-title font-bold text-brand-deep">
              Estructura de Gastos Fijos Mensuales del Local
            </h3>
            <p className="text-body-sm text-text-secondary">
              Registra los costos reales de operación (arriendo, planillas de luz, agua, nómina fija, internet) para calcular la absorción de margen.
            </p>
          </div>
          <Boton
            onClick={() => {
              setGastoParaEditar(null)
              setModalGastoAbierto(true)
            }}
            className="h-9 text-body-sm"
          >
            + Registrar gasto al local
          </Boton>
        </div>

        {cargandoGastos ? (
          <EsqueletoCarga filas={3} alturaPx={50} />
        ) : errorGastos ? (
          <MensajeError mensaje={errorGastos} onReintentar={cargarGastos} />
        ) : gastos.length === 0 ? (
          <div className="rounded-xl border border-dashed border-amber-300 p-8 text-center text-text-secondary">
            No hay gastos registrados para esta sucursal. Registra arriendo, luz o agua para iniciar la simulación.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b-2 border-amber-200/80 bg-amber-50/70 text-left text-label uppercase text-brand-deep font-bold">
                  <th className="py-2.5 px-3">Concepto del Gasto</th>
                  <th className="py-2.5 px-3">Categoría</th>
                  <th className="py-2.5 px-3 text-right">Monto Mensual ($)</th>
                  <th className="py-2.5 px-3 text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {gastos.map((g) => (
                  <tr key={g.id} className="border-b border-amber-100 last:border-0 hover:bg-amber-50/40 transition-colors">
                    <td className="py-2.5 px-3 font-medium text-text-primary">{g.concepto}</td>
                    <td className="py-2.5 px-3">
                      <BadgeEstado
                        texto={g.categoria_gasto}
                        color={g.categoria_gasto === 'energia' ? 'warning' : g.categoria_gasto === 'arriendo' ? 'info' : 'success'}
                      />
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-brand-deep">
                      {formatoMoneda.format(Number(g.monto_mensual))}
                    </td>
                    <td className="py-2.5 px-3 text-right space-x-2">
                      <button
                        type="button"
                        onClick={() => {
                          setGastoParaEditar(g)
                          setModalGastoAbierto(true)
                        }}
                        className="text-xs font-semibold text-brand-primary hover:underline"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => manejarEliminarGasto(g.id)}
                        className="text-xs font-semibold text-status-danger hover:underline"
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Controles de Simulación Financiera / What-If con IA */}
      <div className="rounded-2xl border-2 border-amber-300 bg-linear-to-br from-amber-50/80 via-white to-amber-100/30 p-6 shadow-xs space-y-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand-primary text-white font-bold text-sm">
              ✨
            </span>
            <h3 className="font-display text-title font-bold text-brand-deep">
              Simulador de Punto de Equilibrio y Precios con Inteligencia Artificial
            </h3>
          </div>
          <p className="mt-1 text-body-sm text-text-secondary">
            Ajusta los escenarios y deja que el motor de IA evalúe la absorción de costos fijos, el volumen estimado y genere la propuesta de márgenes recomendados.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-white p-5 rounded-xl border border-amber-200">
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-body-sm font-bold text-brand-deep">Meta de Utilidad Neta Deseada:</label>
              <span className="font-mono font-bold text-brand-primary text-base">{metaUtilidad}%</span>
            </div>
            <input
              type="range"
              min="5"
              max="35"
              step="1"
              value={metaUtilidad}
              onChange={(e) => setMetaUtilidad(Number(e.target.value))}
              className="w-full accent-brand-primary cursor-pointer"
            />
            <p className="mt-1 text-[11px] text-text-secondary">
              Porcentaje de ganancia libre de bolsillo tras pagar arriendo, luz, agua y nómina.
            </p>
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-body-sm font-bold text-brand-deep">Sensibilidad de Gastos (What-If):</label>
              <span className={`font-mono font-bold text-base ${variacionGastos > 0 ? 'text-status-danger' : 'text-brand-deep'}`}>
                {variacionGastos > 0 ? `+${variacionGastos}%` : `${variacionGastos}%`}
              </span>
            </div>
            <input
              type="range"
              min="-20"
              max="50"
              step="5"
              value={variacionGastos}
              onChange={(e) => setVariacionGastos(Number(e.target.value))}
              className="w-full accent-brand-primary cursor-pointer"
            />
            <p className="mt-1 text-[11px] text-text-secondary">
              Simula alzas imprevistas (ej. incremento de planilla eléctrica en verano o aumento de alquiler).
            </p>
          </div>
        </div>

        <div className="flex justify-end">
          <Boton
            variante="primario"
            onClick={manejarSimular}
            disabled={simulando}
            className="h-11 px-6 font-bold shadow-md hover:scale-[1.02] transition-transform"
          >
            {simulando ? 'Calculando y consultando IA...' : '✨ Ejecutar simulación de márgenes con IA'}
          </Boton>
        </div>

        {errorSimulacion && <MensajeError mensaje={errorSimulacion} onReintentar={manejarSimular} />}
      </div>

      {/* Resultados de la Simulación y Dictamen de IA */}
      {resultadoSimulacion && (
        <motion.div variants={fadeUp} initial="hidden" animate="visible" className="space-y-6">
          {/* Tarjetas KPI de Resultados del Break-Even */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <CardKpi
              etiqueta="Punto de Equilibrio (Break-Even)"
              cifra={formatoMoneda.format(Number(resultadoSimulacion.punto_equilibrio_ventas))}
              comparacion={{ texto: 'Ventas mínimas mensuales para no quebrar', favorable: true }}
            />
            <CardKpi
              etiqueta="Margen Ponderado Necesario"
              cifra={formatoPorcentaje.format(Number(resultadoSimulacion.margen_promedio_necesario_pct) / 100)}
              comparacion={{ texto: 'Cobertura total de la canasta comercial', favorable: true }}
            />
            <CardKpi
              etiqueta="Utilidad Neta Proyectada / Mes"
              cifra={formatoMoneda.format(Number(resultadoSimulacion.utilidad_neta_proyectada))}
              comparacion={{ texto: `Meta del ${resultadoSimulacion.variacion_aplicada_pct}% garantizada`, favorable: true }}
            />
          </div>

          {/* Dictamen Ejecutivo y Justificación de la IA */}
          <div className="rounded-2xl border-2 border-brand-primary/40 bg-linear-to-br from-amber-50/60 to-white p-6 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">🤖</span>
                <h4 className="font-display text-body font-bold text-brand-deep">
                  Dictamen Estratégico y Justificación de la Inteligencia Artificial
                </h4>
              </div>
              <BadgeEstado texto="Asesoría IA Financiera" color="info" />
            </div>

            <div className="rounded-xl border border-amber-200/90 bg-white p-4.5 text-body-sm leading-relaxed text-text-primary whitespace-pre-line shadow-2xs">
              {resultadoSimulacion.explicacion_ia}
            </div>
          </div>

          {/* Mensaje de éxito al aplicar precios */}
          {mensajeExitoAplicacion && (
            <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4 text-body-sm font-semibold text-emerald-800">
              ✓ {mensajeExitoAplicacion}
            </div>
          )}

          {/* Tabla de Propuesta de Precios y Márgenes */}
          <div className="rounded-2xl border-2 border-amber-200/90 bg-white p-5 shadow-2xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-title font-bold text-brand-deep">
                  Propuesta de Precios y Márgenes Recomendados
                </h3>
                <p className="text-body-sm text-text-secondary">
                  Precios sugeridos calculados para absorber los gastos del local según clasificación y rotación.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="text"
                  placeholder="Buscar producto..."
                  value={busquedaProducto}
                  onChange={(e) => setBusquedaProducto(e.target.value)}
                  className="rounded-xl border-2 border-amber-200/90 bg-white px-3 py-1.5 text-body-sm focus:border-brand-primary"
                />
                <Boton
                  variante="primario"
                  onClick={manejarAplicarPrecios}
                  disabled={aplicandoPrecios}
                  className="h-9 text-body-sm font-bold bg-emerald-600 hover:bg-emerald-700 border-emerald-700"
                >
                  {aplicandoPrecios ? 'Aplicando...' : '✅ Aplicar precios sugeridos'}
                </Boton>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-body-sm">
                <thead>
                  <tr className="border-b-2 border-amber-200/80 bg-amber-50/70 text-left text-label uppercase text-brand-deep font-bold">
                    <th className="py-2.5 px-3">Producto</th>
                    <th className="py-2.5 px-3">Rol Comercial</th>
                    <th className="py-2.5 px-3 text-right">Costo Prov.</th>
                    <th className="py-2.5 px-3 text-right">Precio Actual</th>
                    <th className="py-2.5 px-3 text-right">Margen Sugerido</th>
                    <th className="py-2.5 px-3 text-right">Precio Sugerido</th>
                    <th className="py-2.5 px-3 text-right">Absorbe Gasto</th>
                    <th className="py-2.5 px-3">Justificación del Precio</th>
                  </tr>
                </thead>
                <tbody>
                  {datosPaginados.map((p) => (
                    <tr key={p.producto_id} className="border-b border-amber-100 last:border-0 hover:bg-amber-50/40 transition-colors">
                      <td className="py-2.5 px-3 font-semibold text-text-primary">
                        {p.nombre}
                        {p.es_perecedero && (
                          <span className="ml-1.5 text-[11px] font-normal text-amber-700">❄️ Frío</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <BadgeEstado
                          texto={p.clasificacion === 'gancho' ? 'Gancho (Volumen)' : 'Nicho (Rentable)'}
                          color={p.clasificacion === 'gancho' ? 'info' : 'warning'}
                        />
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-text-secondary">
                        {p.costo_vigente ? formatoMoneda.format(Number(p.costo_vigente)) : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-text-secondary">
                        {p.precio_actual ? formatoMoneda.format(Number(p.precio_actual)) : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-900">
                        {Number(p.margen_sugerido_pct)}%
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700 bg-emerald-50/50">
                        {formatoMoneda.format(Number(p.precio_sugerido))}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-xs text-text-secondary">
                        +{formatoMoneda.format(Number(p.cuota_gasto_absorbida))}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-text-secondary max-w-xs">
                        {p.justificacion}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Paginacion
              paginaActual={paginaActual}
              totalPaginas={totalPaginas}
              totalItems={totalItems}
              itemsPorPagina={itemsPorPagina}
              onCambiarPagina={cambiarPagina}
              etiquetaItems="productos"
            />
          </div>
        </motion.div>
      )}

      {/* Modal para agregar o editar gastos */}
      {modalGastoAbierto && (
        <ModalGastoSucursal
          sucursalId={sucursalSeleccionadaId}
          gastoParaEditar={gastoParaEditar}
          onCerrar={() => {
            setModalGastoAbierto(false)
            setGastoParaEditar(null)
          }}
          onGuardado={cargarGastos}
        />
      )}
    </div>
  )
}
