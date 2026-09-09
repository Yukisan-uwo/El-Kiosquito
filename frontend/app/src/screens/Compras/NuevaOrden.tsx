import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '@/api/client'
import { Boton } from '@/components/ui/Boton'
import { EsqueletoCarga } from '@/components/ui/EsqueletoCarga'
import { MensajeError } from '@/components/ui/MensajeError'
import {
  buscarProductos,
  crearOrdenCompra,
  listarFormasPago,
  listarProveedores,
  listarSucursales,
} from './api'
import type { FormaPago, OrdenCompra, ProductoCatalogo, Proveedor, Sucursal } from './tipos'

const RETRASO_DEBOUNCE_MS = 300

interface ItemEnConstruccion {
  producto: ProductoCatalogo
  cantidadPedida: string
  precioOfrecido: string
}

interface NuevaOrdenProps {
  onOrdenCreada: (orden: OrdenCompra) => void
}

function esCantidadValida(valor: string): boolean {
  if (!valor || valor.trim() === '') return false
  const n = Number(valor)
  return Number.isFinite(n) && n > 0
}

function esPrecioValido(valor: string): boolean {
  if (!valor || valor.trim() === '') return false
  const n = Number(valor)
  return Number.isFinite(n) && n > 0
}

function prevenirCaracteresInvalidos(e: React.KeyboardEvent) {
  if (['-', '+', 'e', 'E'].includes(e.key)) {
    e.preventDefault()
  }
}

function formatoMoneda(valor: number): string {
  return new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(valor)
}

/**
 * RF-CP-002/012 (008). El proveedor y la sucursal se eligen de listados
 * reales (RF-CP-017 y RF-ES-013, ambos de la enmienda v1.3/v1.2
 * encontrados y resueltos al construir esta misma pantalla) — nunca se
 * le pide al usuario escribir un id de memoria. `forma_pago` sale del
 * catálogo real (enmienda v1.2 de 008), nunca un enum fijo del frontend.
 */
export function NuevaOrden({ onOrdenCreada }: NuevaOrdenProps) {
  const [proveedores, setProveedores] = useState<Proveedor[] | null>(null)
  const [sucursales, setSucursales] = useState<Sucursal[] | null>(null)
  const [formasPago, setFormasPago] = useState<FormaPago[] | null>(null)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)

  const [proveedorId, setProveedorId] = useState<number | null>(null)
  const [sucursalId, setSucursalId] = useState<number | null>(null)
  const [esOferta, setEsOferta] = useState(false)
  const [formaPago, setFormaPago] = useState('contado')
  const [items, setItems] = useState<ItemEnConstruccion[]>([])
  const [enviando, setEnviando] = useState(false)
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null)

  const [textoBusqueda, setTextoBusqueda] = useState('')
  const [resultados, setResultados] = useState<ProductoCatalogo[] | null>(null)
  const [cargandoBusqueda, setCargandoBusqueda] = useState(false)
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null)
  const [desplegado, setDesplegado] = useState(false)
  const contenedorBusquedaRef = useRef<HTMLDivElement>(null)
  const idBusquedaVigente = useRef(0)

  useEffect(() => {
    function clickAfuera(evento: MouseEvent) {
      if (contenedorBusquedaRef.current && !contenedorBusquedaRef.current.contains(evento.target as Node)) {
        setDesplegado(false)
      }
    }
    document.addEventListener('mousedown', clickAfuera)
    return () => document.removeEventListener('mousedown', clickAfuera)
  }, [])

  useEffect(() => {
    Promise.all([listarProveedores(true), listarSucursales('operativa'), listarFormasPago()])
      .then(([p, s, fp]) => {
        setProveedores(p)
        setSucursales(s)
        setFormasPago(fp)
      })
      .catch((err) => setErrorCarga(err instanceof ApiError ? err.mensajeUsuario : 'No se pudieron cargar los catálogos.'))
  }, [])

  function abrirBusqueda() {
    if (sucursalId === null) return
    setDesplegado(true)
    if (resultados === null && !cargandoBusqueda) {
      ejecutarBusqueda(textoBusqueda.trim())
    }
  }

  const ejecutarBusqueda = useCallback(
    async (termino: string) => {
      if (sucursalId === null) return
      const idBusqueda = ++idBusquedaVigente.current
      setCargandoBusqueda(true)
      setErrorBusqueda(null)
      try {
        const productos = await buscarProductos(sucursalId, termino || undefined)
        if (idBusqueda !== idBusquedaVigente.current) return
        setResultados(productos)
      } catch (err) {
        if (idBusqueda !== idBusquedaVigente.current) return
        setErrorBusqueda(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo buscar productos.')
      } finally {
        if (idBusqueda === idBusquedaVigente.current) setCargandoBusqueda(false)
      }
    },
    [sucursalId],
  )

  useEffect(() => {
    if (sucursalId === null) {
      setResultados(null)
      return
    }
    const timer = setTimeout(() => {
      ejecutarBusqueda(textoBusqueda.trim())
    }, RETRASO_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [textoBusqueda, sucursalId, ejecutarBusqueda])

  function agregarItem(producto: ProductoCatalogo) {
    if (items.some((item) => item.producto.id === producto.id)) return
    setItems((actual) => [...actual, { producto, cantidadPedida: '1', precioOfrecido: '0' }])
    setTextoBusqueda('')
    setDesplegado(false)
  }

  function quitarItem(productoId: number) {
    setItems((actual) => actual.filter((item) => item.producto.id !== productoId))
  }

  function cambiarItem(productoId: number, campo: 'cantidadPedida' | 'precioOfrecido', valor: string) {
    const valorLimpio = valor.replace(/[^0-9.]/g, '').replace(/(\..*?)\..*/g, '$1')
    setItems((actual) => actual.map((item) => (item.producto.id === productoId ? { ...item, [campo]: valorLimpio } : item)))
  }

  const totalOrden = items.reduce((suma, it) => {
    const c = esCantidadValida(it.cantidadPedida) ? Number(it.cantidadPedida) : 0
    const p = esPrecioValido(it.precioOfrecido) ? Number(it.precioOfrecido) : 0
    return suma + c * p
  }, 0)

  const itemsValidos =
    items.length > 0 &&
    items.every((item) => esCantidadValida(item.cantidadPedida) && esPrecioValido(item.precioOfrecido))
  const puedeEnviar = proveedorId !== null && sucursalId !== null && formaPago !== '' && itemsValidos

  async function manejarEnviar(evento: React.FormEvent) {
    evento.preventDefault()
    if (!puedeEnviar || proveedorId === null || sucursalId === null) return
    setEnviando(true)
    setErrorEnvio(null)
    try {
      const orden = await crearOrdenCompra({
        proveedor_id: proveedorId,
        sucursal_id: sucursalId,
        es_oferta: esOferta,
        forma_pago: formaPago,
        items: items.map((item) => ({
          producto_id: item.producto.id,
          cantidad_pedida: Number(item.cantidadPedida),
          precio_ofrecido: Number(item.precioOfrecido),
        })),
      })
      setItems([])
      setEsOferta(false)
      onOrdenCreada(orden)
    } catch (err) {
      setErrorEnvio(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo registrar la orden de compra.')
    } finally {
      setEnviando(false)
    }
  }

  if (errorCarga) return <MensajeError mensaje={errorCarga} />
  if (proveedores === null || sucursales === null || formasPago === null) return <EsqueletoCarga filas={4} />

  return (
    <form onSubmit={manejarEnviar} className="space-y-6 rounded-2xl border-2 border-amber-200/90 bg-white p-6 shadow-2xs">
      <p className="text-title font-bold text-brand-deep">Nueva orden de compra</p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="orden-proveedor" className="mb-1 block text-label uppercase text-text-secondary font-semibold">
            Proveedor
          </label>
          <select
            id="orden-proveedor"
            value={proveedorId ?? ''}
            onChange={(evento) => setProveedorId(evento.target.value ? Number(evento.target.value) : null)}
            className="w-full rounded-xl border-2 border-amber-200/90 bg-white px-3 py-2 text-body shadow-2xs focus:border-brand-primary"
          >
            <option value="">Elegí un proveedor…</option>
            {proveedores.map((proveedor) => (
              <option key={proveedor.id} value={proveedor.id}>
                {proveedor.nombre}
              </option>
            ))}
          </select>
          {proveedores.length === 0 && (
            <p className="mt-1 text-body-sm text-status-warning">No hay proveedores activos — registrá uno primero.</p>
          )}
        </div>

        <div>
          <label htmlFor="orden-sucursal" className="mb-1 block text-label uppercase text-text-secondary font-semibold">
            Sucursal destino
          </label>
          <select
            id="orden-sucursal"
            value={sucursalId ?? ''}
            onChange={(evento) => {
              setSucursalId(evento.target.value ? Number(evento.target.value) : null)
              setItems([])
              setTextoBusqueda('')
              setResultados(null)
            }}
            className="w-full rounded-xl border-2 border-amber-200/90 bg-white px-3 py-2 text-body shadow-2xs focus:border-brand-primary"
          >
            <option value="">Elegí una sucursal…</option>
            {sucursales.map((sucursal) => (
              <option key={sucursal.id} value={sucursal.id}>
                {sucursal.nombre}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="orden-forma-pago" className="mb-1 block text-label uppercase text-text-secondary font-semibold">
            Forma de pago
          </label>
          <select
            id="orden-forma-pago"
            value={formaPago}
            onChange={(evento) => setFormaPago(evento.target.value)}
            className="w-full rounded-xl border-2 border-amber-200/90 bg-white px-3 py-2 text-body shadow-2xs focus:border-brand-primary"
          >
            {formasPago.map((forma) => (
              <option key={forma.codigo} value={forma.codigo}>
                {forma.etiqueta}
                {forma.dias_plazo_default > 0 ? ` (${forma.dias_plazo_default} días)` : ''}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 self-end rounded-xl border-2 border-amber-200/80 bg-amber-50/50 p-3 text-body font-medium text-text-primary">
          <input
            type="checkbox"
            checked={esOferta}
            onChange={(evento) => setEsOferta(evento.target.checked)}
            className="h-4 w-4 rounded border-amber-300 text-brand-primary focus:ring-brand-primary"
          />
          <span>Es una compra por oferta (requiere pronóstico de demanda)</span>
        </label>
      </div>

      <div className="space-y-3">
        <p className="text-label uppercase text-brand-deep font-bold">Productos</p>
        {sucursalId === null ? (
          <p className="text-body-sm text-text-secondary">Elegí primero la sucursal destino para buscar productos.</p>
        ) : (
          <div ref={contenedorBusquedaRef} className="relative">
            <input
              type="text"
              value={textoBusqueda}
              onFocus={abrirBusqueda}
              onClick={abrirBusqueda}
              onChange={(evento) => {
                setTextoBusqueda(evento.target.value)
                setDesplegado(true)
              }}
              placeholder="Buscar producto por nombre…"
              className="w-full rounded-xl border-2 border-amber-200/90 bg-white px-3 py-2.5 text-body focus:border-brand-primary"
            />
            {cargandoBusqueda && <EsqueletoCarga filas={2} alturaPx={40} />}
            {!cargandoBusqueda && errorBusqueda && <MensajeError mensaje={errorBusqueda} />}
            {(desplegado || textoBusqueda.trim().length > 0) && !cargandoBusqueda && !errorBusqueda && resultados !== null && resultados.length === 0 && (
              <p className="mt-1 text-body-sm text-text-secondary">Sin resultados para "{textoBusqueda}".</p>
            )}
            {(desplegado || textoBusqueda.trim().length > 0) && !cargandoBusqueda && resultados !== null && resultados.length > 0 && (
              <ul className="mt-2 max-h-60 overflow-y-auto space-y-1 rounded-xl border-2 border-amber-200/90 bg-amber-50/70 p-2 shadow-2xs">
                {resultados.map((producto) => (
                  <li key={producto.id}>
                    <button
                      type="button"
                      onClick={() => agregarItem(producto)}
                      className="w-full rounded-lg p-2.5 text-left text-body text-text-primary hover:bg-amber-100 transition-colors"
                    >
                      <span className="font-semibold">{producto.nombre}</span>{' '}
                      <span className="text-body-sm text-text-secondary">({producto.categoria_nombre})</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {items.length > 0 && (
          <div className="space-y-3">
            <div className="overflow-x-auto rounded-xl border-2 border-amber-200/90 bg-white shadow-2xs">
              <table className="w-full text-body">
                <thead>
                  <tr className="border-b-2 border-amber-200/80 bg-amber-50/70 text-left text-label uppercase text-brand-deep font-bold">
                    <th scope="col" className="px-4 py-2.5">Producto</th>
                    <th scope="col" className="px-4 py-2.5">Cantidad pedida</th>
                    <th scope="col" className="px-4 py-2.5">Precio ofrecido (unitario)</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Subtotal</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const cantValida = esCantidadValida(item.cantidadPedida)
                    const precioValido = esPrecioValido(item.precioOfrecido)
                    const subtotal = cantValida && precioValido ? Number(item.cantidadPedida) * Number(item.precioOfrecido) : 0

                    return (
                      <tr key={item.producto.id} className="border-b border-amber-100 last:border-0 hover:bg-amber-50/40 transition-colors">
                        <td className="px-4 py-2.5 font-medium text-text-primary">
                          <p className="font-semibold">{item.producto.nombre}</p>
                          <p className="text-body-sm text-text-secondary">{item.producto.categoria_nombre}</p>
                        </td>
                        <td className="px-4 py-2.5 align-top">
                          <input
                            type="number"
                            min="0.001"
                            step="0.001"
                            value={item.cantidadPedida}
                            onKeyDown={prevenirCaracteresInvalidos}
                            onChange={(evento) => cambiarItem(item.producto.id, 'cantidadPedida', evento.target.value)}
                            className={`w-28 rounded-xl border-2 bg-white px-2.5 py-1 text-body focus:outline-none ${
                              cantValida
                                ? 'border-amber-200/90 focus:border-brand-primary'
                                : 'border-status-danger bg-red-50/30 text-status-danger ring-1 ring-status-danger/30'
                            }`}
                          />
                          {!cantValida && (
                            <p className="mt-1 text-[11px] font-semibold text-status-danger">
                              {item.cantidadPedida.trim() === '' ? 'Requerido' : 'Debe ser > 0'}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-2.5 align-top">
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={item.precioOfrecido}
                            onKeyDown={prevenirCaracteresInvalidos}
                            onChange={(evento) => cambiarItem(item.producto.id, 'precioOfrecido', evento.target.value)}
                            className={`w-28 rounded-xl border-2 bg-white px-2.5 py-1 text-body focus:outline-none ${
                              precioValido
                                ? 'border-amber-200/90 focus:border-brand-primary'
                                : 'border-status-danger bg-red-50/30 text-status-danger ring-1 ring-status-danger/30'
                            }`}
                          />
                          {!precioValido && (
                            <p className="mt-1 text-[11px] font-semibold text-status-danger">
                              {item.precioOfrecido.trim() === '' || Number(item.precioOfrecido) === 0
                                ? 'Debe ser mayor a $0.00'
                                : 'Precio inválido'}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-brand-deep align-middle">
                          {cantValida && precioValido ? formatoMoneda(subtotal) : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right align-middle">
                          <Boton variante="ghost" type="button" onClick={() => quitarItem(item.producto.id)}>
                            Quitar
                          </Boton>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Resumen de totales de la orden */}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border-2 border-amber-200/90 bg-amber-50/60 p-4">
              <div className="text-body-sm text-text-secondary">
                Líneas en orden: <strong className="text-brand-deep">{items.length}</strong> · Unidades pedidas:{' '}
                <strong className="text-brand-deep">
                  {items.reduce((sum, it) => sum + (esCantidadValida(it.cantidadPedida) ? Number(it.cantidadPedida) : 0), 0)}
                </strong>
              </div>
              <div className="text-right">
                <span className="mr-2 text-label uppercase text-text-secondary font-semibold">Total orden estimada:</span>
                <span className="font-display text-title font-bold text-brand-deep">{formatoMoneda(totalOrden)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Alerta de validación cuando el formulario tiene campos incompletos */}
      {!puedeEnviar && items.length > 0 && !itemsValidos && (
        <div className="rounded-xl border-2 border-status-danger/40 bg-red-50/60 p-3.5 text-body-sm text-status-danger flex items-center gap-2.5">
          <span className="text-base">⚠️</span>
          <span className="font-medium">
            Hay productos con cantidad 0 o precios vacíos/inválidos. Ambos deben ser mayores a $0.00 para poder registrar la orden.
          </span>
        </div>
      )}

      {errorEnvio && <MensajeError mensaje={errorEnvio} />}

      <Boton type="submit" disabled={!puedeEnviar || enviando}>
        {enviando ? 'Registrando orden…' : 'Registrar orden de compra'}
      </Boton>
    </form>
  )
}
