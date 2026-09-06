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
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { apiFetch, ApiError } from '@/api/client'
import { useAuth } from '@/auth/AuthContext'
import { BadgeEstado } from '@/components/ui/BadgeEstado'
import { Boton } from '@/components/ui/Boton'
import { CardKpi } from '@/components/ui/CardKpi'
import { EsqueletoCarga } from '@/components/ui/EsqueletoCarga'
import { EstadoVacio } from '@/components/ui/EstadoVacio'
import { MensajeError } from '@/components/ui/MensajeError'
import { fadeUp, stagger } from '@/motion/tokens'

/** Los campos `Decimal` de Pydantic viajan como STRING en el JSON real
 * (verificado con HTTP real contra el backend: `"cantidad": "5.000"`, no
 * `5`) — nunca como number. Tratarlos como number en el tipo (como hacía
 * la primera versión de esta pantalla) deja pasar sumas que en realidad
 * son concatenación de texto en JS (`0 + "3.75"` es la cadena `"03.75"`,
 * no el número 3.75) y con 2+ filas termina en un total corrupto que
 * `Intl.NumberFormat` no puede formatear. Se tipan como `string` para
 * reflejar el contrato real y se convierten con `Number(...)` en el
 * único punto donde hace falta operar con ellos — nunca antes. */
interface Merma {
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

interface StockBajo {
  producto_id: number
  cantidad_disponible: string
  stock_minimo: string
}

interface LoteProximoACaducar {
  id: number
  producto_id: number
  sucursal_id: number
  fecha_caducidad: string
  cantidad_lote: string
  cantidad_restante: string
}

interface StockSinRotacion {
  producto_id: number
  sucursal_id: number
  cantidad_disponible: string
  stock_minimo: string
  dias_sin_venta: number
  marcado_sin_rotacion: boolean
}

interface ProductoCatalogo {
  id: number
  nombre: string
}

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

function SeccionMermas({ sucursalId, desde, hasta, mapaProductos }: SeccionProps & { desde: string; hasta: string }) {
  const reporte = useMermas(sucursalId, desde, hasta)

  if (reporte.estado === 'cargando') return <EsqueletoCarga filas={2} alturaPx={96} />
  if (reporte.estado === 'error') return <MensajeError mensaje={reporte.error} onReintentar={reporte.reintentar} />
  if (reporte.datos.length === 0) {
    return (
      <EstadoVacio
        titulo="Sin mermas en el rango"
        descripcion="No se registraron eventos de merma en tu sucursal para el periodo seleccionado — buena señal, no un dato faltante."
      />
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
      <div className="mt-4 overflow-x-auto rounded-[var(--radius-card)] bg-surface-card shadow-[var(--shadow-elevation-1)]">
        <table className="w-full text-body">
          <thead>
            <tr className="border-b border-surface-bg text-left text-label uppercase text-text-secondary">
              <th scope="col" className="px-4 py-3">Producto</th>
              <th scope="col" className="px-4 py-3 text-right">Cantidad</th>
              <th scope="col" className="px-4 py-3 text-right">Valor estimado</th>
              <th scope="col" className="px-4 py-3">Causa</th>
              <th scope="col" className="px-4 py-3">Detectado</th>
            </tr>
          </thead>
          <tbody>
            {reporte.datos.map((fila) => (
              <tr key={fila.id} className="border-b border-surface-bg last:border-0">
                <td className="px-4 py-3 text-text-primary">{nombreProducto(mapaProductos, fila.producto_id)}</td>
                <td className="px-4 py-3 text-right">{Number(fila.cantidad)}</td>
                <td className="px-4 py-3 text-right">{formatoMoneda.format(Number(fila.valor_estimado))}</td>
                <td className="px-4 py-3">
                  {fila.causa ?? <BadgeEstado texto="Sin investigar" color="warning" />}
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {new Date(fila.fecha_deteccion).toLocaleDateString('es-EC')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SeccionStockBajo({ sucursalId, mapaProductos }: SeccionProps) {
  const reporte = useStockBajo(sucursalId)

  if (reporte.estado === 'cargando') return <EsqueletoCarga filas={2} alturaPx={96} />
  if (reporte.estado === 'error') return <MensajeError mensaje={reporte.error} onReintentar={reporte.reintentar} />
  if (reporte.datos.length === 0) {
    return (
      <EstadoVacio
        titulo="Sin productos bajo el mínimo"
        descripcion="Todo el inventario de tu sucursal está sobre su stock mínimo — buena señal, no un dato faltante."
      />
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
      <div className="mt-4 overflow-x-auto rounded-[var(--radius-card)] bg-surface-card shadow-[var(--shadow-elevation-1)]">
        <table className="w-full text-body">
          <thead>
            <tr className="border-b border-surface-bg text-left text-label uppercase text-text-secondary">
              <th scope="col" className="px-4 py-3">Producto</th>
              <th scope="col" className="px-4 py-3 text-right">Disponible</th>
              <th scope="col" className="px-4 py-3 text-right">Mínimo</th>
              <th scope="col" className="px-4 py-3 text-right">Déficit</th>
            </tr>
          </thead>
          <tbody>
            {reporte.datos.map((fila) => (
              <tr key={fila.producto_id} className="border-b border-surface-bg last:border-0">
                <td className="px-4 py-3 text-text-primary">{nombreProducto(mapaProductos, fila.producto_id)}</td>
                <td className="px-4 py-3 text-right">{Number(fila.cantidad_disponible)}</td>
                <td className="px-4 py-3 text-right">{Number(fila.stock_minimo)}</td>
                <td className="px-4 py-3 text-right text-status-danger">{deficitStock(fila)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SeccionProximosACaducar({ sucursalId, mapaProductos }: SeccionProps) {
  const reporte = useProximosACaducar(sucursalId)

  if (reporte.estado === 'cargando') return <EsqueletoCarga filas={2} alturaPx={96} />
  if (reporte.estado === 'error') return <MensajeError mensaje={reporte.error} onReintentar={reporte.reintentar} />
  if (reporte.datos.length === 0) {
    return (
      <EstadoVacio
        titulo="Sin lotes por caducar pronto"
        descripcion="No hay lotes activos venciendo en el horizonte de alerta configurado — buena señal, no un dato faltante."
      />
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
      <div className="mt-4 overflow-x-auto rounded-[var(--radius-card)] bg-surface-card shadow-[var(--shadow-elevation-1)]">
        <table className="w-full text-body">
          <thead>
            <tr className="border-b border-surface-bg text-left text-label uppercase text-text-secondary">
              <th scope="col" className="px-4 py-3">Producto</th>
              <th scope="col" className="px-4 py-3 text-right">Cantidad restante</th>
              <th scope="col" className="px-4 py-3">Caduca</th>
              <th scope="col" className="px-4 py-3 text-right">Días</th>
            </tr>
          </thead>
          <tbody>
            {reporte.datos.map((fila) => {
              const dias = diasHasta(fila.fecha_caducidad)
              return (
                <tr key={fila.id} className="border-b border-surface-bg last:border-0">
                  <td className="px-4 py-3 text-text-primary">{nombreProducto(mapaProductos, fila.producto_id)}</td>
                  <td className="px-4 py-3 text-right">{Number(fila.cantidad_restante)}</td>
                  <td className="px-4 py-3 text-text-secondary">
                    {new Date(fila.fecha_caducidad).toLocaleDateString('es-EC')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {dias <= 0 ? (
                      <BadgeEstado texto="Vencido" color="danger" />
                    ) : (
                      <span className={dias <= 3 ? 'text-status-danger' : 'text-text-secondary'}>{dias}</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SeccionSinRotacion({ sucursalId, mapaProductos }: SeccionProps) {
  const reporte = useSinRotacion(sucursalId)

  if (reporte.estado === 'cargando') return <EsqueletoCarga filas={2} alturaPx={96} />
  if (reporte.estado === 'error') return <MensajeError mensaje={reporte.error} onReintentar={reporte.reintentar} />
  if (reporte.datos.length === 0) {
    return (
      <EstadoVacio
        titulo="Sin productos marcados sin rotación"
        descripcion="No hay productos que superen el umbral de días sin venta en tu sucursal."
      />
    )
  }

  const promedioDias = reporte.datos.reduce((suma, fila) => suma + fila.dias_sin_venta, 0) / reporte.datos.length

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <CardKpi etiqueta="Productos sin rotación" cifra={String(reporte.datos.length)} />
        <CardKpi etiqueta="Promedio de días sin venta" cifra={promedioDias.toFixed(0)} />
      </div>
      <div className="mt-4 overflow-x-auto rounded-[var(--radius-card)] bg-surface-card shadow-[var(--shadow-elevation-1)]">
        <table className="w-full text-body">
          <thead>
            <tr className="border-b border-surface-bg text-left text-label uppercase text-text-secondary">
              <th scope="col" className="px-4 py-3">Producto</th>
              <th scope="col" className="px-4 py-3 text-right">Disponible</th>
              <th scope="col" className="px-4 py-3 text-right">Mínimo</th>
              <th scope="col" className="px-4 py-3 text-right">Días sin venta</th>
            </tr>
          </thead>
          <tbody>
            {reporte.datos.map((fila) => (
              <tr key={fila.producto_id} className="border-b border-surface-bg last:border-0">
                <td className="px-4 py-3 text-text-primary">{nombreProducto(mapaProductos, fila.producto_id)}</td>
                <td className="px-4 py-3 text-right">{Number(fila.cantidad_disponible)}</td>
                <td className="px-4 py-3 text-right">{Number(fila.stock_minimo)}</td>
                <td className="px-4 py-3 text-right">{fila.dias_sin_venta}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PanelSucursal({ sucursalId }: { sucursalId: number }) {
  const [desde, setDesde] = useState(haceDias(30))
  const [hasta, setHasta] = useState(HOY)
  const [rangoAplicado, setRangoAplicado] = useState({ desde, hasta })
  const catalogo = useCatalogoProductos(sucursalId)
  const mapaProductos = catalogo.estado === 'listo' ? catalogo.datos : null

  return (
    <motion.div variants={stagger} initial="hidden" animate="visible" className="space-y-8">
      <motion.div variants={fadeUp}>
        <p className="font-display text-display-lg text-brand-deep">Panel de sucursal</p>
        <p className="mt-1 text-body text-text-secondary">
          Estado operativo de tu local: mermas, stock e inventario en riesgo.
        </p>
      </motion.div>

      <motion.section variants={fadeUp}>
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
            <Boton type="submit" variante="secundario">
              Aplicar
            </Boton>
          </form>
        </div>
        <SeccionMermas sucursalId={sucursalId} desde={rangoAplicado.desde} hasta={rangoAplicado.hasta} mapaProductos={mapaProductos} />
      </motion.section>

      <motion.section variants={fadeUp}>
        <p className="mb-3 text-title text-text-primary">Stock bajo el mínimo</p>
        <SeccionStockBajo sucursalId={sucursalId} mapaProductos={mapaProductos} />
      </motion.section>

      <motion.section variants={fadeUp}>
        <p className="mb-3 text-title text-text-primary">Próximos a caducar</p>
        <SeccionProximosACaducar sucursalId={sucursalId} mapaProductos={mapaProductos} />
      </motion.section>

      <motion.section variants={fadeUp}>
        <p className="mb-3 text-title text-text-primary">Sin rotación</p>
        <SeccionSinRotacion sucursalId={sucursalId} mapaProductos={mapaProductos} />
      </motion.section>
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
