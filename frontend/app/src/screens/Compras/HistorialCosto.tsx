import { useEffect, useRef, useState } from 'react'
import { ApiError } from '@/api/client'
import { BotonExportarReporte } from '@/components/ui/BotonExportarReporte'
import { EncabezadoReporteImpresion } from '@/components/ui/EncabezadoReporteImpresion'
import { EsqueletoCarga } from '@/components/ui/EsqueletoCarga'
import { EstadoVacio } from '@/components/ui/EstadoVacio'
import { MensajeError } from '@/components/ui/MensajeError'
import { Paginacion } from '@/components/ui/Paginacion'
import { usePaginacion } from '@/components/ui/usePaginacion'
import { buscarProductos, consultarComparativaProveedores, consultarHistorialCosto, listarProveedores, listarSucursales } from './api'
import type { HistorialCostoProducto, ProductoCatalogo, Proveedor, Sucursal } from './tipos'

const RETRASO_DEBOUNCE_MS = 300

function formatoMoneda(valor: number): string {
  return new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(valor)
}

function nombreProveedor(mapa: Map<number, string> | undefined, id: number): string {
  return mapa?.get(id) ?? `Proveedor #${id}`
}

function TablaHistorial({
  filas,
  proveedoresMap,
  titulo,
  paginar = false,
}: {
  filas: HistorialCostoProducto[]
  proveedoresMap: Map<number, string> | undefined
  titulo: string
  paginar?: boolean
}) {
  const {
    datosPaginados,
    paginaActual,
    totalPaginas,
    itemsPorPagina,
    totalItems,
    cambiarPagina,
    cambiarItemsPorPagina,
  } = usePaginacion(filas, { itemsPorPaginaInicial: 5 })

  if (filas.length === 0) {
    return <EstadoVacio titulo={titulo} descripcion="Todavía no hay ningún costo registrado para este producto." />
  }

  const filasAMostrar = paginar ? datosPaginados : filas

  return (
    <div className="space-y-3 print-break-inside-avoid">
      <div className="overflow-x-auto rounded-2xl border-2 border-amber-200/90 bg-white shadow-2xs">
        <table className="w-full text-body">
          <thead>
            <tr className="border-b-2 border-amber-200/80 bg-amber-50/70 text-left text-label uppercase text-brand-deep font-bold">
              <th scope="col" className="px-4 py-3">Proveedor</th>
              <th scope="col" className="px-4 py-3 text-right">Costo</th>
              <th scope="col" className="px-4 py-3">Fecha</th>
            </tr>
          </thead>
          <tbody className="print:hidden">
            {filasAMostrar.map((fila, indice) => (
              <tr key={`${fila.proveedor_id}-${fila.fecha}-${indice}`} className="border-b border-amber-100 last:border-0 hover:bg-amber-50/40 transition-colors">
                <td className="px-4 py-3 font-semibold text-text-primary">{nombreProveedor(proveedoresMap, fila.proveedor_id)}</td>
                <td className="px-4 py-3 text-right font-bold text-brand-primary">{formatoMoneda(Number(fila.costo))}</td>
                <td className="px-4 py-3 text-text-secondary">{new Date(fila.fecha).toLocaleDateString('es-EC')}</td>
              </tr>
            ))}
          </tbody>
          <tbody className="hidden print:table-row-group">
            {filas.map((fila, indice) => (
              <tr key={`print-${fila.proveedor_id}-${fila.fecha}-${indice}`} className="border-b border-amber-100 last:border-0">
                <td className="px-4 py-2 font-semibold text-text-primary">{nombreProveedor(proveedoresMap, fila.proveedor_id)}</td>
                <td className="px-4 py-2 text-right font-bold text-brand-primary">{formatoMoneda(Number(fila.costo))}</td>
                <td className="px-4 py-2 text-text-secondary">{new Date(fila.fecha).toLocaleDateString('es-EC')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {paginar && (
        <div className="no-print rounded-2xl border-2 border-amber-200/90 bg-white shadow-2xs">
          <Paginacion
            paginaActual={paginaActual}
            totalPaginas={totalPaginas}
            totalItems={totalItems}
            itemsPorPagina={itemsPorPagina}
            onCambiarPagina={cambiarPagina}
            onCambiarItemsPorPagina={cambiarItemsPorPagina}
            etiquetaItems="registros"
          />
        </div>
      )}
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
  const [desplegado, setDesplegado] = useState(false)
  const contenedorBusquedaRef = useRef<HTMLDivElement>(null)

  const [productoElegido, setProductoElegido] = useState<ProductoCatalogo | null>(null)
  const [historial, setHistorial] = useState<HistorialCostoProducto[] | null>(null)
  const [comparativa, setComparativa] = useState<HistorialCostoProducto[] | null>(null)
  const [cargandoDetalle, setCargandoDetalle] = useState(false)
  const [errorDetalle, setErrorDetalle] = useState<string | null>(null)

  useEffect(() => {
    function manejarClickAfuera(evento: MouseEvent) {
      if (contenedorBusquedaRef.current && !contenedorBusquedaRef.current.contains(evento.target as Node)) {
        setDesplegado(false)
      }
    }
    document.addEventListener('mousedown', manejarClickAfuera)
    return () => document.removeEventListener('mousedown', manejarClickAfuera)
  }, [])

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

  function abrirBusqueda() {
    setDesplegado(true)
    if (sucursalBusqueda !== null) {
      ejecutarBusqueda(texto.trim())
    }
  }

  useEffect(() => {
    if (sucursalBusqueda === null) {
      setResultados(null)
      return
    }
    const consulta = texto.trim()
    const temporizador = setTimeout(() => {
      ejecutarBusqueda(consulta)
    }, consulta.length === 0 ? 0 : RETRASO_DEBOUNCE_MS)
    return () => clearTimeout(temporizador)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto, sucursalBusqueda])

  function elegirProducto(producto: ProductoCatalogo) {
    setProductoElegido(producto)
    setTexto('')
    setDesplegado(false)
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
      {productoElegido && (
        <EncabezadoReporteImpresion
          titulo={`Informe Histórico de Costos y Comparativa — ${productoElegido.nombre}`}
          subtitulo="Evolución de costo unitario por producto y comparativa de precios entre distribuidores"
          sucursalNombre="Toda la Red (Nivel Central de Compras)"
          usuarioNombre="Encargado de Compras"
        />
      )}

      <div ref={contenedorBusquedaRef} className="no-print rounded-2xl border-2 border-amber-200/90 bg-white p-6 shadow-2xs">
        <label htmlFor="historial-busqueda" className="mb-2 block text-label uppercase text-brand-deep font-bold">
          Buscar producto en catálogo
        </label>
        <input
          id="historial-busqueda"
          type="text"
          value={texto}
          onFocus={abrirBusqueda}
          onClick={abrirBusqueda}
          onChange={(evento) => {
            setTexto(evento.target.value)
            setDesplegado(true)
          }}
          placeholder="Nombre del producto a consultar…"
          className="w-full max-w-md rounded-xl border-2 border-amber-200/90 bg-white px-3 py-2.5 text-body focus:border-brand-primary"
        />
        {cargandoBusqueda && <EsqueletoCarga filas={2} alturaPx={40} />}
        {!cargandoBusqueda && errorBusqueda && <MensajeError mensaje={errorBusqueda} />}
        {(desplegado || texto.trim().length > 0) && !cargandoBusqueda && !errorBusqueda && resultados !== null && resultados.length === 0 && (
          <p className="mt-2 text-body-sm text-text-secondary">Sin resultados para "{texto}".</p>
        )}
        {(desplegado || texto.trim().length > 0) && !cargandoBusqueda && resultados !== null && resultados.length > 0 && (
          <ul className="mt-3 max-w-md max-h-60 overflow-y-auto space-y-1 rounded-xl border-2 border-amber-200/90 bg-amber-50/60 p-2 shadow-2xs">
            {resultados.map((producto) => (
              <li key={producto.id}>
                <button
                  type="button"
                  onClick={() => elegirProducto(producto)}
                  className="w-full rounded-lg p-2.5 text-left text-body font-medium text-brand-deep hover:bg-amber-100/80 transition-colors"
                >
                  {producto.nombre}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {productoElegido && (
        <div className="space-y-6 rounded-2xl border-2 border-amber-200/90 bg-white p-6 shadow-2xs print-break-inside-avoid">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200/80 pb-3">
            <div>
              <p className="text-title font-bold text-brand-deep">{productoElegido.nombre}</p>
              <p className="text-body-sm text-text-secondary">Categoría: {productoElegido.categoria_nombre}</p>
            </div>
            <BotonExportarReporte
              etiqueta="Exportar comparativa (PDF)"
              tituloReporte={`Costos — ${productoElegido.nombre}`}
              variante="primario"
            />
          </div>
          {cargandoDetalle && <EsqueletoCarga filas={3} alturaPx={56} />}
          {!cargandoDetalle && errorDetalle && <MensajeError mensaje={errorDetalle} />}
          {!cargandoDetalle && !errorDetalle && historial !== null && comparativa !== null && (
            <>
              <div>
                <p className="mb-2 text-label uppercase text-brand-deep font-bold">
                  Comparativa entre proveedores (último costo de cada uno)
                </p>
                <TablaHistorial filas={comparativa} proveedoresMap={proveedoresMap} titulo="Sin comparativa disponible" paginar={comparativa.length > 5} />
              </div>
              <div>
                <p className="mb-2 text-label uppercase text-brand-deep font-bold">Historial completo de costo</p>
                <TablaHistorial filas={historial} proveedoresMap={proveedoresMap} titulo="Sin historial de costo" paginar={true} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
