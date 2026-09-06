import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '@/api/client'
import { BadgeEstado } from '@/components/ui/BadgeEstado'
import { Boton } from '@/components/ui/Boton'
import { EsqueletoCarga } from '@/components/ui/EsqueletoCarga'
import { EstadoVacio } from '@/components/ui/EstadoVacio'
import { MensajeError } from '@/components/ui/MensajeError'
import {
  buscarProductos,
  consultarPronostico,
  listarEstadosOrdenCompra,
  listarOrdenesCompra,
  listarProveedores,
  listarSucursales,
  registrarMotivoOferta,
  registrarRecepcion,
} from './api'
import type { DetalleOrdenCompra, EstadoOrdenCompra, OrdenCompra, PronosticoParaCompra, Proveedor, Sucursal } from './tipos'

function formatoMoneda(valor: number): string {
  return new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(valor)
}

const COLOR_POR_ESTADO: Record<string, 'success' | 'danger' | 'warning' | 'info'> = {
  pendiente: 'info',
  recibida_parcial: 'warning',
  recibida_completa: 'success',
  cancelada: 'danger',
}

/** Nunca inventa un nombre: si el mapa todavía no cargó o el id no está
 * en él, muestra el id real en vez de un nombre inventado (Art. 5.9),
 * mismo criterio que `nombreProducto` de DashboardSucursal. */
function nombreDe(mapa: Map<number, string> | undefined, id: number, prefijo: string): string {
  return mapa?.get(id) ?? `${prefijo} #${id}`
}

interface FilaItemProps {
  orden: OrdenCompra
  item: DetalleOrdenCompra
  nombreProducto: string
  permiteRecepcion: boolean
  onOrdenActualizada: (orden: OrdenCompra) => void
}

function FilaItem({ orden, item, nombreProducto, permiteRecepcion, onOrdenActualizada }: FilaItemProps) {
  const [mostrarRecepcion, setMostrarRecepcion] = useState(false)
  const [cantidadRecibida, setCantidadRecibida] = useState('')
  const [numeroDocumento, setNumeroDocumento] = useState('')
  const [enviandoRecepcion, setEnviandoRecepcion] = useState(false)
  const [errorRecepcion, setErrorRecepcion] = useState<string | null>(null)

  const [pronostico, setPronostico] = useState<PronosticoParaCompra | null>(null)
  const [consultandoPronostico, setConsultandoPronostico] = useState(false)
  const [errorPronostico, setErrorPronostico] = useState<string | null>(null)

  const [motivo, setMotivo] = useState(item.motivo_no_siguio_pronostico ?? '')
  const [guardandoMotivo, setGuardandoMotivo] = useState(false)
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null)

  const completa = Number(item.cantidad_recibida) >= Number(item.cantidad_pedida)

  async function manejarConsultarPronostico() {
    setConsultandoPronostico(true)
    setErrorPronostico(null)
    try {
      const resultado = await consultarPronostico(item.producto_id, orden.sucursal_id, item.id)
      setPronostico(resultado)
    } catch (err) {
      setErrorPronostico(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo consultar el pronóstico.')
    } finally {
      setConsultandoPronostico(false)
    }
  }

  async function manejarGuardarMotivo() {
    if (!motivo.trim()) return
    setGuardandoMotivo(true)
    setErrorMotivo(null)
    try {
      await registrarMotivoOferta(item.id, motivo.trim())
    } catch (err) {
      setErrorMotivo(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo registrar el motivo.')
    } finally {
      setGuardandoMotivo(false)
    }
  }

  async function manejarRegistrarRecepcion(evento: React.FormEvent) {
    evento.preventDefault()
    const cantidad = Number(cantidadRecibida)
    if (!(cantidad > 0)) return
    setEnviandoRecepcion(true)
    setErrorRecepcion(null)
    try {
      const ordenActualizada = await registrarRecepcion(item.id, {
        cantidad_recibida_evento: cantidad,
        numero_documento_proveedor: numeroDocumento.trim() || undefined,
      })
      onOrdenActualizada(ordenActualizada)
      setCantidadRecibida('')
      setNumeroDocumento('')
      setMostrarRecepcion(false)
    } catch (err) {
      // RN-CP-001 (compra por oferta sin pronóstico consultado, o sin
      // motivo cuando excede la recomendación) llega acá como un 422 real
      // del backend — nunca se duplica esa regla en el frontend, se
      // muestra el mensaje real y el usuario consulta el pronóstico o
      // registra el motivo desde los controles de esta misma fila.
      setErrorRecepcion(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo registrar la recepción.')
    } finally {
      setEnviandoRecepcion(false)
    }
  }

  return (
    <tr className="border-b border-surface-bg last:border-0 align-top">
      <td className="px-3 py-2 text-text-primary">{nombreProducto}</td>
      <td className="px-3 py-2 text-right">{Number(item.cantidad_pedida)}</td>
      <td className="px-3 py-2 text-right">
        <span className={completa ? 'text-status-success' : 'text-status-warning'}>{Number(item.cantidad_recibida)}</span>
      </td>
      <td className="px-3 py-2 text-right">{formatoMoneda(Number(item.precio_ofrecido))}</td>
      <td className="px-3 py-2 space-y-2">
        {orden.es_oferta && (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <BadgeEstado
                texto={item.pronostico_consultado ? 'Pronóstico consultado' : 'Pronóstico sin consultar'}
                color={item.pronostico_consultado ? 'success' : 'warning'}
              />
              <Boton variante="ghost" type="button" disabled={consultandoPronostico} onClick={manejarConsultarPronostico}>
                {consultandoPronostico ? 'Consultando…' : 'Consultar pronóstico'}
              </Boton>
            </div>
            {errorPronostico && <MensajeError mensaje={errorPronostico} />}
            {pronostico && (
              <p className="text-body-sm text-text-secondary">
                {pronostico.datos_suficientes
                  ? `Recomendado: ${Number(pronostico.cantidad_recomendada)} unidades`
                  : 'Sin datos suficientes para recomendar una cantidad todavía'}
              </p>
            )}
            <div className="flex items-center gap-2">
              <input
                value={motivo}
                onChange={(evento) => setMotivo(evento.target.value)}
                placeholder="Motivo si no siguió el pronóstico (mínimo 3 caracteres)"
                className="w-56 rounded-[var(--radius-card)] border border-brand-primary-soft px-2 py-1 text-body-sm"
              />
              <Boton
                variante="ghost"
                type="button"
                disabled={guardandoMotivo || motivo.trim().length < 3}
                onClick={manejarGuardarMotivo}
              >
                {guardandoMotivo ? 'Guardando…' : 'Guardar motivo'}
              </Boton>
            </div>
            {errorMotivo && <MensajeError mensaje={errorMotivo} />}
          </div>
        )}

        {permiteRecepcion && !completa && (
          <div>
            {!mostrarRecepcion ? (
              <Boton variante="secundario" type="button" onClick={() => setMostrarRecepcion(true)}>
                Registrar recepción
              </Boton>
            ) : (
              <form onSubmit={manejarRegistrarRecepcion} className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  required
                  value={cantidadRecibida}
                  onChange={(evento) => setCantidadRecibida(evento.target.value)}
                  placeholder="Cantidad recibida"
                  className="w-32 rounded-[var(--radius-card)] border border-brand-primary-soft px-2 py-1 text-body-sm"
                />
                <input
                  type="text"
                  value={numeroDocumento}
                  onChange={(evento) => setNumeroDocumento(evento.target.value)}
                  placeholder="N° factura/guía (opcional)"
                  className="w-48 rounded-[var(--radius-card)] border border-brand-primary-soft px-2 py-1 text-body-sm"
                />
                <Boton type="submit" disabled={enviandoRecepcion}>
                  {enviandoRecepcion ? 'Registrando…' : 'Confirmar'}
                </Boton>
                <Boton variante="ghost" type="button" onClick={() => setMostrarRecepcion(false)}>
                  Cancelar
                </Boton>
              </form>
            )}
            {errorRecepcion && <MensajeError mensaje={errorRecepcion} />}
          </div>
        )}
      </td>
    </tr>
  )
}

interface OrdenesProps {
  ordenParaResaltar?: number | null
}

/**
 * RF-CP-018 (008, enmienda v1.3). Lista real de órdenes — antes de esta
 * enmienda no había forma de volver a encontrar una orden creada en otra
 * sesión para registrarle una recepción; el único rastro era la
 * respuesta original de `POST /compras/ordenes`, perdida en cuanto se
 * cerraba. `encargado_compras` tiene alcance de cadena completa (Art.
 * 3.3), así que el filtro de sucursal es opcional acá, no obligatorio.
 */
export function Ordenes({ ordenParaResaltar }: OrdenesProps) {
  const [sucursales, setSucursales] = useState<Sucursal[] | null>(null)
  const [proveedores, setProveedores] = useState<Proveedor[] | null>(null)
  const [estadosCatalogo, setEstadosCatalogo] = useState<EstadoOrdenCompra[] | null>(null)
  const [errorCatalogos, setErrorCatalogos] = useState<string | null>(null)

  const [filtroSucursal, setFiltroSucursal] = useState<number | null>(null)
  const [filtroEstado, setFiltroEstado] = useState<string>('')

  const [ordenes, setOrdenes] = useState<OrdenCompra[] | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [catalogosPorSucursal, setCatalogosPorSucursal] = useState<Record<number, Map<number, string>>>({})

  useEffect(() => {
    Promise.all([listarSucursales(), listarProveedores(), listarEstadosOrdenCompra()])
      .then(([sucursalesRes, proveedoresRes, estadosRes]) => {
        setSucursales(sucursalesRes)
        setProveedores(proveedoresRes)
        setEstadosCatalogo(estadosRes)
      })
      .catch((err: unknown) =>
        setErrorCatalogos(err instanceof ApiError ? err.mensajeUsuario : 'No se pudieron cargar los catálogos de apoyo.'),
      )
  }, [])

  const cargarOrdenes = useCallback(() => {
    setCargando(true)
    setError(null)
    listarOrdenesCompra({
      sucursalId: filtroSucursal ?? undefined,
      estado: filtroEstado || undefined,
    })
      .then(setOrdenes)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.mensajeUsuario : 'No se pudieron cargar las órdenes.'))
      .finally(() => setCargando(false))
  }, [filtroSucursal, filtroEstado])

  useEffect(() => {
    cargarOrdenes()
  }, [cargarOrdenes])

  // Resuelve el catálogo de productos de cada sucursal distinta que
  // aparece entre las órdenes cargadas — una sola vez por sucursal,
  // nunca inventa un nombre mientras carga (nombreDe cae al id real).
  useEffect(() => {
    if (!ordenes) return
    const sucursalesFaltantes = [...new Set(ordenes.map((orden) => orden.sucursal_id))].filter(
      (id) => !(id in catalogosPorSucursal),
    )
    sucursalesFaltantes.forEach((sucursalId) => {
      buscarProductos(sucursalId)
        .then((productos) => {
          setCatalogosPorSucursal((actual) => ({
            ...actual,
            [sucursalId]: new Map(productos.map((p) => [p.id, p.nombre])),
          }))
        })
        .catch(() => {
          // Si el catálogo de esa sucursal falla, las filas de esa orden
          // simplemente muestran "Producto #<id>" — nunca un nombre inventado.
        })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordenes])

  function actualizarOrdenEnLista(ordenActualizada: OrdenCompra) {
    setOrdenes((actual) => actual?.map((orden) => (orden.id === ordenActualizada.id ? ordenActualizada : orden)) ?? actual)
  }

  const proveedoresMap = proveedores ? new Map(proveedores.map((p) => [p.id, p.nombre])) : undefined
  const sucursalesMap = sucursales ? new Map(sucursales.map((s) => [s.id, s.nombre])) : undefined
  const estadosMap = estadosCatalogo ? new Map(estadosCatalogo.map((e) => [e.codigo, e])) : undefined

  if (errorCatalogos) return <MensajeError mensaje={errorCatalogos} />
  if (!sucursales || !proveedores || !estadosCatalogo) return <EsqueletoCarga filas={4} />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="filtro-sucursal" className="mb-1 block text-label uppercase text-text-secondary">
            Sucursal
          </label>
          <select
            id="filtro-sucursal"
            value={filtroSucursal ?? ''}
            onChange={(evento) => setFiltroSucursal(evento.target.value ? Number(evento.target.value) : null)}
            className="rounded-[var(--radius-card)] border border-brand-primary-soft px-3 py-2 text-body"
          >
            <option value="">Toda la cadena</option>
            {sucursales.map((sucursal) => (
              <option key={sucursal.id} value={sucursal.id}>
                {sucursal.nombre}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="filtro-estado" className="mb-1 block text-label uppercase text-text-secondary">
            Estado
          </label>
          <select
            id="filtro-estado"
            value={filtroEstado}
            onChange={(evento) => setFiltroEstado(evento.target.value)}
            className="rounded-[var(--radius-card)] border border-brand-primary-soft px-3 py-2 text-body"
          >
            <option value="">Todos los estados</option>
            {estadosCatalogo.map((estado) => (
              <option key={estado.codigo} value={estado.codigo}>
                {estado.etiqueta}
              </option>
            ))}
          </select>
        </div>
      </div>

      {cargando && <EsqueletoCarga filas={3} alturaPx={140} />}
      {!cargando && error && <MensajeError mensaje={error} onReintentar={cargarOrdenes} />}
      {!cargando && !error && ordenes !== null && ordenes.length === 0 && (
        <EstadoVacio
          titulo="Sin órdenes de compra"
          descripcion="No hay órdenes que coincidan con este filtro — registrá una nueva desde la pestaña correspondiente."
        />
      )}
      {!cargando && !error && ordenes !== null && ordenes.length > 0 && (
        <ul className="space-y-4">
          {ordenes.map((orden) => {
            const estadoInfo = estadosMap?.get(orden.estado)
            const catalogoProductos = catalogosPorSucursal[orden.sucursal_id]
            return (
              <li
                key={orden.id}
                className={`rounded-[var(--radius-card)] bg-surface-card p-4 shadow-[var(--shadow-elevation-1)] ${
                  ordenParaResaltar === orden.id ? 'ring-2 ring-brand-primary' : ''
                }`}
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-body font-medium text-text-primary">
                      Orden #{orden.id} · {nombreDe(proveedoresMap, orden.proveedor_id, 'Proveedor')}
                    </p>
                    <p className="text-body-sm text-text-secondary">
                      {nombreDe(sucursalesMap, orden.sucursal_id, 'Sucursal')} · {new Date(orden.fecha_pedido).toLocaleDateString('es-EC')} ·{' '}
                      {orden.forma_pago}
                      {orden.es_oferta ? ' · Compra por oferta' : ''}
                    </p>
                  </div>
                  <BadgeEstado texto={estadoInfo?.etiqueta ?? orden.estado} color={COLOR_POR_ESTADO[orden.estado] ?? 'info'} />
                </div>
                <div className="overflow-x-auto rounded-[var(--radius-card)] bg-surface-bg">
                  <table className="w-full text-body">
                    <thead>
                      <tr className="border-b border-surface-card text-left text-label uppercase text-text-secondary">
                        <th scope="col" className="px-3 py-2">Producto</th>
                        <th scope="col" className="px-3 py-2 text-right">Pedido</th>
                        <th scope="col" className="px-3 py-2 text-right">Recibido</th>
                        <th scope="col" className="px-3 py-2 text-right">Precio</th>
                        <th scope="col" className="px-3 py-2">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orden.items.map((item) => (
                        <FilaItem
                          key={item.id}
                          orden={orden}
                          item={item}
                          nombreProducto={nombreDe(catalogoProductos, item.producto_id, 'Producto')}
                          permiteRecepcion={estadoInfo?.permite_recepcion ?? false}
                          onOrdenActualizada={actualizarOrdenEnLista}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
