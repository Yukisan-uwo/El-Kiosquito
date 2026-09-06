import { useEffect, useRef, useState } from 'react'
import { ApiError } from '@/api/client'
import { Boton } from '@/components/ui/Boton'
import { EsqueletoCarga } from '@/components/ui/EsqueletoCarga'
import { EstadoVacio } from '@/components/ui/EstadoVacio'
import { MensajeError } from '@/components/ui/MensajeError'
import { buscarProductos } from './api'
import type { ProductoBusqueda } from './tipos'

const RETRASO_DEBOUNCE_MS = 300
/** Un lector de código de barras escribe muy rápido y termina con Enter —
 * lo distinguimos de una búsqueda por nombre por longitud + solo dígitos,
 * nunca porque el cajero tenga que activar un modo aparte. */
const PARECE_CODIGO_BARRAS = /^\d{8,}$/

function formatearMoneda(valor: number): string {
  return new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(valor)
}

interface BusquedaProductosProps {
  sucursalId: number
  onAgregarAlCarrito: (producto: ProductoBusqueda) => void
}

export function BusquedaProductos({ sucursalId, onAgregarAlCarrito }: BusquedaProductosProps) {
  const [texto, setTexto] = useState('')
  const [resultados, setResultados] = useState<ProductoBusqueda[] | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const idBusquedaVigente = useRef(0)

  async function ejecutarBusqueda(filtro: { q?: string; codigoBarras?: string }) {
    const idBusqueda = ++idBusquedaVigente.current
    setCargando(true)
    setError(null)
    try {
      const productos = await buscarProductos(sucursalId, filtro)
      if (idBusqueda !== idBusquedaVigente.current) return // respuesta obsoleta, se descarta
      setResultados(productos)
    } catch (err) {
      if (idBusqueda !== idBusquedaVigente.current) return
      setError(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo buscar productos.')
    } finally {
      if (idBusqueda === idBusquedaVigente.current) setCargando(false)
    }
  }

  useEffect(() => {
    const consulta = texto.trim()
    if (consulta.length < 1) {
      setResultados(null)
      setError(null)
      return
    }
    // Un código de barras completo (lector físico) no espera el debounce —
    // se busca de inmediato por coincidencia exacta.
    if (PARECE_CODIGO_BARRAS.test(consulta)) {
      ejecutarBusqueda({ codigoBarras: consulta })
      return
    }
    const temporizador = setTimeout(() => ejecutarBusqueda({ q: consulta }), RETRASO_DEBOUNCE_MS)
    return () => clearTimeout(temporizador)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto, sucursalId])

  return (
    <div className="flex h-full flex-col gap-3">
      <div>
        <label htmlFor="busqueda-producto" className="mb-1 block text-label uppercase text-text-secondary">
          Buscar producto (nombre o código de barras)
        </label>
        <input
          id="busqueda-producto"
          type="text"
          autoFocus
          autoComplete="off"
          value={texto}
          onChange={(evento) => setTexto(evento.target.value)}
          placeholder="Ej. leche, o escaneá el código de barras"
          className="w-full rounded-[var(--radius-card)] border border-brand-primary-soft px-3 py-2.5 text-body focus:border-brand-primary"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {cargando && <EsqueletoCarga filas={3} />}

        {!cargando && error && <MensajeError mensaje={error} onReintentar={() => ejecutarBusqueda({ q: texto.trim() })} />}

        {!cargando && !error && resultados !== null && resultados.length === 0 && (
          <EstadoVacio
            titulo="Sin resultados"
            descripcion={`No se encontró ningún producto activo que coincida con "${texto.trim()}" en esta sucursal.`}
          />
        )}

        {!cargando && !error && resultados !== null && resultados.length > 0 && (
          <ul className="space-y-2">
            {resultados.map((producto) => {
              const sinPrecio = producto.precio_venta_vigente === null
              return (
                <li
                  key={producto.id}
                  className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] bg-surface-card p-3 shadow-[var(--shadow-elevation-1)]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-body font-medium text-text-primary">{producto.nombre}</p>
                    <p className="text-body-sm text-text-secondary">{producto.categoria_nombre}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className={`text-body font-medium ${sinPrecio ? 'text-status-danger' : 'text-text-primary'}`}>
                      {sinPrecio ? 'Sin precio en esta sucursal' : formatearMoneda(producto.precio_venta_vigente!)}
                    </span>
                    <Boton
                      variante="secundario"
                      disabled={sinPrecio}
                      onClick={() => onAgregarAlCarrito(producto)}
                    >
                      Agregar
                    </Boton>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
