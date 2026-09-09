import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '@/api/client'
import { Boton } from '@/components/ui/Boton'
import { EsqueletoCarga } from '@/components/ui/EsqueletoCarga'
import { EstadoVacio } from '@/components/ui/EstadoVacio'
import { MensajeError } from '@/components/ui/MensajeError'
import { Paginacion } from '@/components/ui/Paginacion'
import { usePaginacion } from '@/components/ui/usePaginacion'
import { buscarProductos } from './api'
import { ImagenProducto } from './productoImagen'
import type { ItemCarrito, ProductoBusqueda } from './tipos'

const RETRASO_DEBOUNCE_MS = 300
const PARECE_CODIGO_BARRAS = /^\d{8,}$/

function formatearMoneda(valor: number): string {
  return new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(valor)
}

interface BusquedaProductosProps {
  sucursalId: number
  carritoItems?: ItemCarrito[]
  onAgregarAlCarrito: (producto: ProductoBusqueda) => void
}

export function BusquedaProductos({
  sucursalId,
  carritoItems = [],
  onAgregarAlCarrito,
}: BusquedaProductosProps) {
  const [texto, setTexto] = useState('')
  const [categoriaActiva, setCategoriaActiva] = useState<string>('todos')
  const [todosLosProductos, setTodosLosProductos] = useState<ProductoBusqueda[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const idBusquedaVigente = useRef(0)

  useEffect(() => {
    function manejarAtajo(e: KeyboardEvent) {
      if (e.key === 'F2') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', manejarAtajo)
    return () => window.removeEventListener('keydown', manejarAtajo)
  }, [])

  async function ejecutarBusqueda(filtro: { q?: string; codigoBarras?: string }) {
    const idBusqueda = ++idBusquedaVigente.current
    setCargando(true)
    setError(null)
    try {
      const productos = await buscarProductos(sucursalId, filtro)
      if (idBusqueda !== idBusquedaVigente.current) return
      setTodosLosProductos(productos)
    } catch (err) {
      if (idBusqueda !== idBusquedaVigente.current) return
      setError(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo cargar el catálogo de productos.')
    } finally {
      if (idBusqueda === idBusquedaVigente.current) setCargando(false)
    }
  }

  useEffect(() => {
    ejecutarBusqueda({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sucursalId])

  useEffect(() => {
    const consulta = texto.trim()
    if (consulta.length === 0) {
      ejecutarBusqueda({})
      return
    }
    if (PARECE_CODIGO_BARRAS.test(consulta)) {
      ejecutarBusqueda({ codigoBarras: consulta })
      return
    }
    const temporizador = setTimeout(() => {
      ejecutarBusqueda({ q: consulta })
    }, RETRASO_DEBOUNCE_MS)
    return () => clearTimeout(temporizador)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto, sucursalId])

  const categorias = useMemo(() => {
    const mapa = new Map<string, number>()
    todosLosProductos.forEach((p) => {
      if (p.categoria_nombre) {
        mapa.set(p.categoria_nombre, (mapa.get(p.categoria_nombre) || 0) + 1)
      }
    })
    return Array.from(mapa.entries()).map(([nombre, cantidad]) => ({ nombre, cantidad }))
  }, [todosLosProductos])

  const productosFiltrados = useMemo(() => {
    if (categoriaActiva === 'todos') return todosLosProductos
    return todosLosProductos.filter(
      (p) => p.categoria_nombre?.toLowerCase() === categoriaActiva.toLowerCase(),
    )
  }, [todosLosProductos, categoriaActiva])

  const {
    datosPaginados: productosPaginados,
    paginaActual,
    totalPaginas,
    itemsPorPagina,
    totalItems,
    cambiarPagina,
  } = usePaginacion(productosFiltrados, { itemsPorPaginaInicial: 12 })

  const cantidadesEnCarrito = useMemo(() => {
    const m = new Map<number, number>()
    carritoItems.forEach((it) => m.set(it.producto.id, it.cantidad))
    return m
  }, [carritoItems])

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="relative">
        <label htmlFor="busqueda-producto" className="sr-only">
          Buscar producto (nombre o código de barras)
        </label>
        <div className="relative flex items-center rounded-2xl border-2 border-amber-300/80 bg-white shadow-xs transition-all focus-within:border-brand-primary focus-within:ring-4 focus-within:ring-brand-primary/20">
          <span className="pointer-events-none absolute left-3.5 text-amber-700/60">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </span>
          <input
            id="busqueda-producto"
            ref={inputRef}
            type="text"
            autoFocus
            autoComplete="off"
            value={texto}
            onChange={(evento) => setTexto(evento.target.value)}
            placeholder="Buscar por nombre, código de barras o presiona [F2]..."
            className="w-full rounded-2xl bg-transparent py-2.5 pl-11 pr-14 text-body text-text-primary placeholder:text-text-secondary/70 focus:outline-none"
          />
          <span className="pointer-events-none absolute right-3 rounded-lg border border-amber-300/80 bg-amber-50 px-2 py-0.5 font-mono text-xs font-bold text-brand-deep shadow-2xs">
            F2
          </span>
        </div>
      </div>

      {categorias.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1.5 pt-0.5 text-body-sm scrollbar-none">
          <button
            type="button"
            onClick={() => setCategoriaActiva('todos')}
            className={`shrink-0 rounded-full px-4 py-1.5 font-semibold transition-all shadow-xs ${
              categoriaActiva === 'todos'
                ? 'border-2 border-brand-deep bg-brand-deep text-white shadow-sm'
                : 'border-2 border-amber-200/90 bg-white text-brand-deep hover:border-brand-primary hover:bg-amber-50/60'
            }`}
          >
            Todos ({todosLosProductos.length})
          </button>
          {categorias.map((cat) => {
            const esActiva = categoriaActiva.toLowerCase() === cat.nombre.toLowerCase()
            return (
              <button
                key={cat.nombre}
                type="button"
                onClick={() => setCategoriaActiva(cat.nombre)}
                className={`shrink-0 rounded-full px-4 py-1.5 font-semibold transition-all shadow-xs ${
                  esActiva
                    ? 'border-2 border-brand-deep bg-brand-deep text-white shadow-sm'
                    : 'border-2 border-amber-200/90 bg-white text-brand-deep hover:border-brand-primary hover:bg-amber-50/60'
                }`}
              >
                {cat.nombre} ({cat.cantidad})
              </button>
            )
          })}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {cargando && <EsqueletoCarga filas={3} alturaPx={80} />}

        {!cargando && error && (
          <MensajeError mensaje={error} onReintentar={() => ejecutarBusqueda({ q: texto.trim() })} />
        )}

        {!cargando && !error && productosFiltrados.length === 0 && (
          <EstadoVacio
            titulo="Sin resultados"
            descripcion={
              texto.trim()
                ? `No se encontró ningún producto activo que coincida con "${texto.trim()}" en esta sucursal.`
                : 'No hay productos disponibles en esta categoría.'
            }
          />
        )}

        {!cargando && !error && productosFiltrados.length > 0 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 gap-3.5">
              {productosPaginados.map((producto) => {
                const sinPrecio = producto.precio_venta_vigente === null
                const cantidadEnCarrito = cantidadesEnCarrito.get(producto.id) || 0
                const tieneDatoStock = producto.stock_actual !== undefined && producto.stock_actual !== null
                const stockDisponible = tieneDatoStock ? Number(producto.stock_actual) : null
                const esAgotado = stockDisponible !== null && stockDisponible <= 0
                const esBajoStock =
                  !esAgotado &&
                  stockDisponible !== null &&
                  producto.stock_minimo !== undefined &&
                  producto.stock_minimo !== null &&
                  stockDisponible <= Number(producto.stock_minimo)
                const topeAlcanzado = stockDisponible !== null && cantidadEnCarrito >= stockDisponible
                const botonDeshabilitado = sinPrecio || esAgotado || topeAlcanzado

                return (
                  <div
                    key={producto.id}
                    className={`group relative flex flex-col justify-between rounded-2xl border-2 p-3.5 transition-all duration-150 shadow-sm ${
                      cantidadEnCarrito > 0
                        ? 'border-brand-primary ring-2 ring-brand-primary/25 bg-amber-50/30'
                        : 'border-amber-200/90 bg-white hover:border-brand-primary hover:shadow-md hover:ring-2 hover:ring-brand-primary/20'
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="rounded-lg bg-amber-100/80 border border-amber-200/70 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-brand-deep">
                        {producto.categoria_nombre || 'General'}
                      </span>
                      {esAgotado ? (
                        <span className="flex items-center gap-1 rounded-lg bg-status-danger/10 px-2 py-0.5 text-[11px] font-bold text-status-danger border border-status-danger/30">
                          ● Agotado (0 disp.)
                        </span>
                      ) : esBajoStock ? (
                        <span className="flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900 border border-amber-300">
                          ⚠️ Stock bajo: {stockDisponible} disp.
                        </span>
                      ) : stockDisponible !== null ? (
                        <span className="flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 border border-emerald-200">
                          ● {stockDisponible} disp.
                        </span>
                      ) : null}
                    </div>

                    {/* Imagen o ilustración representativa del producto */}
                    <div className="relative mb-2.5 flex h-28 w-full items-center justify-center overflow-hidden rounded-xl bg-gradient-to-b from-amber-50/50 to-amber-100/20 border border-amber-100/70 p-2">
                      <ImagenProducto producto={producto} tamano="lg" className="h-full w-full" />
                    </div>

                    <div className="min-h-[44px]">
                      <p className="line-clamp-2 font-medium leading-snug text-text-primary group-hover:text-brand-deep">
                        {producto.nombre}
                      </p>
                      <p className="mt-0.5 text-body-sm text-text-secondary capitalize">
                        {producto.unidad_venta_codigo}
                      </p>
                    </div>

                    <div className="mt-3 flex items-end justify-between border-t border-amber-100 pt-2.5">
                      <div>
                        <span className="block text-[11px] uppercase tracking-wider text-text-secondary">
                          Precio
                        </span>
                        <span
                          className={`font-display text-title font-bold ${
                            sinPrecio ? 'text-status-danger text-body' : 'text-brand-deep'
                          }`}
                        >
                          {sinPrecio
                            ? 'Sin precio'
                            : formatearMoneda(producto.precio_venta_vigente!)}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {cantidadEnCarrito > 0 && (
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-primary font-mono text-xs font-bold text-white shadow-2xs">
                            {cantidadEnCarrito}
                          </span>
                        )}
                        <Boton
                          variante={cantidadEnCarrito > 0 ? 'primario' : 'secundario'}
                          disabled={botonDeshabilitado}
                          onClick={() => onAgregarAlCarrito(producto)}
                          className="h-8 rounded-xl px-3 text-body-sm font-medium shadow-2xs"
                        >
                          {esAgotado ? 'Agotado' : topeAlcanzado ? 'Tope stock' : 'Agregar'}
                        </Boton>
                      </div>
                    </div>
                  </div>
                )
              })}
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
        )}
      </div>
    </div>
  )
}

