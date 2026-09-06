import { useEffect, useRef, useState } from 'react'
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
const LONGITUD_MINIMA_BUSQUEDA = 2

interface ItemEnConstruccion {
  producto: ProductoCatalogo
  cantidadPedida: string
  precioOfrecido: string
}

interface NuevaOrdenProps {
  onOrdenCreada: (orden: OrdenCompra) => void
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
  const [formaPago, setFormaPago] = useState('')
  const [items, setItems] = useState<ItemEnConstruccion[]>([])

  const [textoBusqueda, setTextoBusqueda] = useState('')
  const [resultados, setResultados] = useState<ProductoCatalogo[] | null>(null)
  const [cargandoBusqueda, setCargandoBusqueda] = useState(false)
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null)
  const idBusquedaVigente = useRef(0)

  const [enviando, setEnviando] = useState(false)
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([listarProveedores(true), listarSucursales('operativa'), listarFormasPago()])
      .then(([proveedoresRes, sucursalesRes, formasPagoRes]) => {
        setProveedores(proveedoresRes)
        setSucursales(sucursalesRes)
        setFormasPago(formasPagoRes)
        if (formasPagoRes.length > 0) setFormaPago(formasPagoRes[0].codigo)
      })
      .catch((err: unknown) =>
        setErrorCarga(err instanceof ApiError ? err.mensajeUsuario : 'No se pudieron cargar proveedores/sucursales/formas de pago.'),
      )
  }, [])

  async function ejecutarBusqueda(q: string) {
    if (sucursalId === null) return
    const idBusqueda = ++idBusquedaVigente.current
    setCargandoBusqueda(true)
    setErrorBusqueda(null)
    try {
      const productos = await buscarProductos(sucursalId, q)
      if (idBusqueda !== idBusquedaVigente.current) return
      setResultados(productos)
    } catch (err) {
      if (idBusqueda !== idBusquedaVigente.current) return
      setErrorBusqueda(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo buscar productos.')
    } finally {
      if (idBusqueda === idBusquedaVigente.current) setCargandoBusqueda(false)
    }
  }

  useEffect(() => {
    const consulta = textoBusqueda.trim()
    if (consulta.length < LONGITUD_MINIMA_BUSQUEDA || sucursalId === null) {
      setResultados(null)
      return
    }
    const temporizador = setTimeout(() => ejecutarBusqueda(consulta), RETRASO_DEBOUNCE_MS)
    return () => clearTimeout(temporizador)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textoBusqueda, sucursalId])

  function agregarItem(producto: ProductoCatalogo) {
    if (items.some((item) => item.producto.id === producto.id)) return // ya está en la orden, no se duplica
    setItems((actual) => [...actual, { producto, cantidadPedida: '1', precioOfrecido: '0' }])
    setTextoBusqueda('')
    setResultados(null)
  }

  function quitarItem(productoId: number) {
    setItems((actual) => actual.filter((item) => item.producto.id !== productoId))
  }

  function cambiarItem(productoId: number, campo: 'cantidadPedida' | 'precioOfrecido', valor: string) {
    setItems((actual) => actual.map((item) => (item.producto.id === productoId ? { ...item, [campo]: valor } : item)))
  }

  const itemsValidos =
    items.length > 0 && items.every((item) => Number(item.cantidadPedida) > 0 && Number(item.precioOfrecido) >= 0)
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
    <form onSubmit={manejarEnviar} className="space-y-4 rounded-[var(--radius-card)] bg-surface-card p-4">
      <p className="text-title text-text-primary">Nueva orden de compra</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="orden-proveedor" className="mb-1 block text-label uppercase text-text-secondary">
            Proveedor
          </label>
          <select
            id="orden-proveedor"
            value={proveedorId ?? ''}
            onChange={(evento) => setProveedorId(evento.target.value ? Number(evento.target.value) : null)}
            className="w-full rounded-[var(--radius-card)] border border-brand-primary-soft px-3 py-2 text-body"
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
          <label htmlFor="orden-sucursal" className="mb-1 block text-label uppercase text-text-secondary">
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
            className="w-full rounded-[var(--radius-card)] border border-brand-primary-soft px-3 py-2 text-body"
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
          <label htmlFor="orden-forma-pago" className="mb-1 block text-label uppercase text-text-secondary">
            Forma de pago
          </label>
          <select
            id="orden-forma-pago"
            value={formaPago}
            onChange={(evento) => setFormaPago(evento.target.value)}
            className="w-full rounded-[var(--radius-card)] border border-brand-primary-soft px-3 py-2 text-body"
          >
            {formasPago.map((forma) => (
              <option key={forma.codigo} value={forma.codigo}>
                {forma.etiqueta}
                {forma.dias_plazo_default > 0 ? ` (${forma.dias_plazo_default} días)` : ''}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 self-end pb-2 text-body text-text-primary">
          <input type="checkbox" checked={esOferta} onChange={(evento) => setEsOferta(evento.target.checked)} />
          Es una compra por oferta (exige consultar el pronóstico antes de recibirla — RN-CP-001)
        </label>
      </div>

      <div className="space-y-2">
        <p className="text-label uppercase text-text-secondary">Productos</p>
        {sucursalId === null ? (
          <p className="text-body-sm text-text-secondary">Elegí primero la sucursal destino para buscar productos.</p>
        ) : (
          <div className="relative">
            <input
              type="text"
              value={textoBusqueda}
              onChange={(evento) => setTextoBusqueda(evento.target.value)}
              placeholder="Buscar producto por nombre…"
              className="w-full rounded-[var(--radius-card)] border border-brand-primary-soft px-3 py-2.5 text-body focus:border-brand-primary"
            />
            {cargandoBusqueda && <EsqueletoCarga filas={2} alturaPx={40} />}
            {!cargandoBusqueda && errorBusqueda && <MensajeError mensaje={errorBusqueda} />}
            {!cargandoBusqueda && !errorBusqueda && resultados !== null && resultados.length === 0 && (
              <p className="mt-1 text-body-sm text-text-secondary">Sin resultados.</p>
            )}
            {!cargandoBusqueda && resultados !== null && resultados.length > 0 && (
              <ul className="mt-1 space-y-1 rounded-[var(--radius-card)] bg-surface-bg p-2">
                {resultados.map((producto) => (
                  <li key={producto.id}>
                    <button
                      type="button"
                      onClick={() => agregarItem(producto)}
                      className="w-full rounded-[var(--radius-card)] p-2 text-left text-body text-text-primary hover:bg-brand-primary-soft"
                    >
                      {producto.nombre} <span className="text-body-sm text-text-secondary">({producto.categoria_nombre})</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {items.length > 0 && (
          <div className="overflow-x-auto rounded-[var(--radius-card)] bg-surface-bg">
            <table className="w-full text-body">
              <thead>
                <tr className="border-b border-surface-card text-left text-label uppercase text-text-secondary">
                  <th scope="col" className="px-3 py-2">Producto</th>
                  <th scope="col" className="px-3 py-2">Cantidad pedida</th>
                  <th scope="col" className="px-3 py-2">Precio ofrecido (unitario)</th>
                  <th scope="col" className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.producto.id} className="border-b border-surface-card last:border-0">
                    <td className="px-3 py-2 text-text-primary">{item.producto.nombre}</td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={item.cantidadPedida}
                        onChange={(evento) => cambiarItem(item.producto.id, 'cantidadPedida', evento.target.value)}
                        className="w-28 rounded-[var(--radius-card)] border border-brand-primary-soft px-2 py-1"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.precioOfrecido}
                        onChange={(evento) => cambiarItem(item.producto.id, 'precioOfrecido', evento.target.value)}
                        className="w-28 rounded-[var(--radius-card)] border border-brand-primary-soft px-2 py-1"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Boton variante="ghost" type="button" onClick={() => quitarItem(item.producto.id)}>
                        Quitar
                      </Boton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {errorEnvio && <MensajeError mensaje={errorEnvio} />}

      <Boton type="submit" disabled={!puedeEnviar || enviando}>
        {enviando ? 'Registrando orden…' : 'Registrar orden de compra'}
      </Boton>
    </form>
  )
}
