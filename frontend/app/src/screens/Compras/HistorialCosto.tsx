import { useEffect, useRef, useState } from 'react'
import { ApiError } from '@/api/client'
import { EsqueletoCarga } from '@/components/ui/EsqueletoCarga'
import { EstadoVacio } from '@/components/ui/EstadoVacio'
import { MensajeError } from '@/components/ui/MensajeError'
import { buscarProductos, consultarComparativaProveedores, consultarHistorialCosto, listarProveedores, listarSucursales } from './api'
import type { HistorialCostoProducto, ProductoCatalogo, Proveedor, Sucursal } from './tipos'

const RETRASO_DEBOUNCE_MS = 300
const LONGITUD_MINIMA_BUSQUEDA = 2

function formatoMoneda(valor: number): string {
  return new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(valor)
}

function nombreProveedor(mapa: Map<number, string> | undefined, id: number): string {
  return mapa?.get(id) ?? `Proveedor #${id}`
}

function TablaHistorial({ filas, proveedoresMap, titulo }: { filas: HistorialCostoProducto[]; proveedoresMap: Map<number, string> | undefined; titulo: string }) {
  if (filas.length === 0) {
    return <EstadoVacio titulo={titulo} descripcion="Todavía no hay ningún costo registrado para este producto." />
  }
  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] bg-surface-card shadow-[var(--shadow-elevation-1)]">
      <table className="w-full text-body">
        <thead>
          <tr className="border-b border-surface-bg text-left text-label uppercase text-text-secondary">
            <th scope="col" className="px-4 py-3">Proveedor</th>
            <th scope="col" className="px-4 py-3 text-right">Costo</th>
            <th scope="col" className="px-4 py-3">Fecha</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((fila, indice) => (
            <tr key={`${fila.proveedor_id}-${fila.fecha}-${indice}`} className="border-b border-surface-bg last:border-0">
              <td className="px-4 py-3 text-text-primary">{nombreProveedor(proveedoresMap, fila.proveedor_id)}</td>
              <td className="px-4 py-3 text-right">{formatoMoneda(Number(fila.costo))}</td>
              <td className="px-4 py-3 text-text-secondary">{new Date(fila.fecha).toLocaleDateString('es-EC')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * RF-CP-007/008 (008). El costo de un producto no está scopeado por
 * sucursal (`historial_costo_producto` es de toda la cadena), pero
 * `GET /productos` sí exige `sucursal_id` para buscar por nombre — se
 * usa una sucursal cualquiera solo como catálogo de búsqueda, nunca
 * como filtro del resultado de costo en sí.
 */
export function HistorialCosto() {
  const [sucursales, setSucursales] = useState<Sucursal[] | null>(null)
  const [proveedores, setProveedores] = useState<Proveedor[] | null>(null)
  const [sucursalBusqueda, setSucursalBusqueda] = useState<number | null>(null)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)

  const [texto, setTexto] = useState('')
  const [resultados, setResultados] = useState<ProductoCatalogo[] | null>(null)
  const [cargandoBusqueda, setCargandoBusqueda] = useState(false)
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null)
  const idBusquedaVigente = useRef(0)

  const [productoElegido, setProductoElegido] = useState<ProductoCatalogo | null>(null)
  const [historial, setHistorial] = useState<HistorialCostoProducto[] | null>(null)
  const [comparativa, setComparativa] = useState<HistorialCostoProducto[] | null>(null)
  const [cargandoDetalle, setCargandoDetalle] = useState(false)
  const [errorDetalle, setErrorDetalle] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([listarSucursales('operativa'), listarProveedores()])
      .then(([sucursalesRes, proveedoresRes]) => {
        setSucursales(sucursalesRes)
        setProveedores(proveedoresRes)
        if (sucursalesRes.length > 0) setSucursalBusqueda(sucursalesRes[0].id)
      })
      .catch((err: unknown) => setErrorCarga(err instanceof ApiError ? err.mensajeUsuario : 'No se pudieron cargar sucursales/proveedores.'))
  }, [])

  async function ejecutarBusqueda(q: string) {
    if (sucursalBusqueda === null) return
    const idBusqueda = ++idBusquedaVigente.current
    setCargandoBusqueda(true)
    setErrorBusqueda(null)
    try {
      const productos = await buscarProductos(sucursalBusqueda, q)
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
    const consulta = texto.trim()
    if (consulta.length < LONGITUD_MINIMA_BUSQUEDA || sucursalBusqueda === null) {
      setResultados(null)
      return
    }
    const temporizador = setTimeout(() => ejecutarBusqueda(consulta), RETRASO_DEBOUNCE_MS)
    return () => clearTimeout(temporizador)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto, sucursalBusqueda])

  function elegirProducto(producto: ProductoCatalogo) {
    setProductoElegido(producto)
    setTexto('')
    setResultados(null)
    setCargandoDetalle(true)
    setErrorDetalle(null)
    Promise.all([consultarHistorialCosto(producto.id), consultarComparativaProveedores(producto.id)])
      .then(([historialRes, comparativaRes]) => {
        setHistorial(historialRes)
        setComparativa(comparativaRes)
      })
      .catch((err: unknown) => setErrorDetalle(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo consultar el historial de costo.'))
      .finally(() => setCargandoDetalle(false))
  }

  const proveedoresMap = proveedores ? new Map(proveedores.map((p) => [p.id, p.nombre])) : undefined

  if (errorCarga) return <MensajeError mensaje={errorCarga} />
  if (!sucursales || !proveedores) return <EsqueletoCarga filas={3} />

  return (
    <div className="space-y-6">
      <div>
        <label htmlFor="historial-busqueda" className="mb-1 block text-label uppercase text-text-secondary">
          Buscar producto
        </label>
        <input
          id="historial-busqueda"
          type="text"
          value={texto}
          onChange={(evento) => setTexto(evento.target.value)}
          placeholder="Nombre del producto…"
          className="w-full max-w-md rounded-[var(--radius-card)] border border-brand-primary-soft px-3 py-2.5 text-body focus:border-brand-primary"
        />
        {cargandoBusqueda && <EsqueletoCarga filas={2} alturaPx={40} />}
        {!cargandoBusqueda && errorBusqueda && <MensajeError mensaje={errorBusqueda} />}
        {!cargandoBusqueda && resultados !== null && resultados.length > 0 && (
          <ul className="mt-2 max-w-md space-y-1 rounded-[var(--radius-card)] bg-surface-bg p-2">
            {resultados.map((producto) => (
              <li key={producto.id}>
                <button
                  type="button"
                  onClick={() => elegirProducto(producto)}
                  className="w-full rounded-[var(--radius-card)] p-2 text-left text-body text-text-primary hover:bg-brand-primary-soft"
                >
                  {producto.nombre}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {productoElegido && (
        <div className="space-y-6">
          <p className="text-title text-text-primary">{productoElegido.nombre}</p>
          {cargandoDetalle && <EsqueletoCarga filas={3} alturaPx={56} />}
          {!cargandoDetalle && errorDetalle && <MensajeError mensaje={errorDetalle} />}
          {!cargandoDetalle && !errorDetalle && historial !== null && comparativa !== null && (
            <>
              <div>
                <p className="mb-2 text-label uppercase text-text-secondary">
                  Comparativa entre proveedores (último costo de cada uno)
                </p>
                <TablaHistorial filas={comparativa} proveedoresMap={proveedoresMap} titulo="Sin comparativa disponible" />
              </div>
              <div>
                <p className="mb-2 text-label uppercase text-text-secondary">Historial completo de costo</p>
                <TablaHistorial filas={historial} proveedoresMap={proveedoresMap} titulo="Sin historial de costo" />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
