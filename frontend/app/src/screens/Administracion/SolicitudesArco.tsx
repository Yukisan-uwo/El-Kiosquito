import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '@/api/client'
import { BadgeEstado } from '@/components/ui/BadgeEstado'
import { Boton } from '@/components/ui/Boton'
import { EsqueletoCarga } from '@/components/ui/EsqueletoCarga'
import { EstadoVacio } from '@/components/ui/EstadoVacio'
import { MensajeError } from '@/components/ui/MensajeError'
import {
  buscarClientes,
  crearSolicitudArco,
  listarEstadosSolicitudArco,
  listarSolicitudesArco,
  listarTiposSolicitudArco,
  resolverSolicitudArco,
} from './api'
import type { ClienteBusqueda, EstadoSolicitudArco, SolicitudArco, TipoSolicitudArco } from './tipos'

const RETRASO_DEBOUNCE_MS = 300
const LONGITUD_MINIMA_BUSQUEDA = 2

function nombreDe(mapa: Map<string, string> | undefined, codigo: string): string {
  return mapa?.get(codigo) ?? codigo
}

interface FilaSolicitudProps {
  solicitud: SolicitudArco
  estados: EstadoSolicitudArco[]
  tiposMap: Map<string, string> | undefined
  estadosMap: Map<string, string> | undefined
  onResuelta: (solicitud: SolicitudArco) => void
}

/**
 * Art. 10.3 (enmienda v1.2, ver Decisión 9 de `research.md` de
 * 010-administracion). `detalle` (lo que pidió el cliente) y los tres
 * campos de resolución YA vienen en la respuesta real del backend — antes
 * de esta enmienda `SolicitudArcoOut` no los exponía, y esta pantalla no
 * habría podido mostrar ni lo uno ni lo otro sin inventarlo.
 */
function FilaSolicitud({ solicitud, estados, tiposMap, estadosMap, onResuelta }: FilaSolicitudProps) {
  const estadosFinales = estados.filter((e) => e.es_estado_final)
  const [resolviendo, setResolviendo] = useState(false)
  const [estadoElegido, setEstadoElegido] = useState(estadosFinales[0]?.codigo ?? '')
  const [respuesta, setRespuesta] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const yaResuelta = solicitud.fecha_resolucion !== null

  async function manejarResolver(evento: React.FormEvent) {
    evento.preventDefault()
    setGuardando(true)
    setError(null)
    try {
      const actualizada = await resolverSolicitudArco(solicitud.id, { estado: estadoElegido, respuesta })
      onResuelta(actualizada)
      setResolviendo(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo registrar la resolución.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <li className="rounded-[var(--radius-card)] bg-surface-card p-4 shadow-[var(--shadow-elevation-1)]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-body font-medium text-text-primary">
            Solicitud #{solicitud.id} · Cliente #{solicitud.cliente_id} · {nombreDe(tiposMap, solicitud.tipo)}
          </p>
          <p className="mt-1 text-body-sm text-text-secondary">{solicitud.detalle}</p>
          <p className="mt-1 text-body-sm text-text-secondary">
            Solicitada el {new Date(solicitud.fecha_solicitud).toLocaleString('es-EC')}
          </p>
          {yaResuelta && (
            <p className="mt-1 text-body-sm text-text-secondary">
              Resuelta el {new Date(solicitud.fecha_resolucion as string).toLocaleString('es-EC')} por usuario #
              {solicitud.atendida_por}: <span className="text-text-primary">{solicitud.respuesta}</span>
            </p>
          )}
        </div>
        <BadgeEstado
          texto={nombreDe(estadosMap, solicitud.estado)}
          color={solicitud.estado === 'pendiente' ? 'warning' : yaResuelta ? 'success' : 'info'}
        />
      </div>

      {!yaResuelta && (
        <div className="mt-3 border-t border-surface-bg pt-3">
          {!resolviendo ? (
            <Boton variante="secundario" type="button" onClick={() => setResolviendo(true)}>
              Resolver solicitud
            </Boton>
          ) : (
            <form onSubmit={manejarResolver} className="space-y-2">
              <select
                value={estadoElegido}
                onChange={(evento) => setEstadoElegido(evento.target.value)}
                className="rounded-[var(--radius-card)] border border-brand-primary-soft px-3 py-2 text-body"
              >
                {estadosFinales.map((estado) => (
                  <option key={estado.codigo} value={estado.codigo}>
                    {estado.etiqueta}
                  </option>
                ))}
              </select>
              <textarea
                value={respuesta}
                onChange={(evento) => setRespuesta(evento.target.value)}
                placeholder="Respuesta para el cliente (obligatoria, Art. 10.3)"
                required
                rows={2}
                className="w-full rounded-[var(--radius-card)] border border-brand-primary-soft px-3 py-2 text-body"
              />
              <div className="flex gap-2">
                <Boton type="submit" disabled={guardando}>
                  {guardando ? 'Guardando…' : 'Confirmar resolución'}
                </Boton>
                <Boton variante="ghost" type="button" onClick={() => setResolviendo(false)}>
                  Cancelar
                </Boton>
              </div>
            </form>
          )}
          {error && <MensajeError mensaje={error} />}
        </div>
      )}
    </li>
  )
}

/** RF-AD-009 (Art. 10.3). RF-AD-013 (`solo_vencidas`, enmienda v1.1). */
export function SolicitudesArco() {
  const [tipos, setTipos] = useState<TipoSolicitudArco[] | null>(null)
  const [estados, setEstados] = useState<EstadoSolicitudArco[] | null>(null)
  const [errorCatalogos, setErrorCatalogos] = useState<string | null>(null)

  const [filtroEstado, setFiltroEstado] = useState('')
  const [soloVencidas, setSoloVencidas] = useState(false)

  const [solicitudes, setSolicitudes] = useState<SolicitudArco[] | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [clienteTexto, setClienteTexto] = useState('')
  const [resultadosCliente, setResultadosCliente] = useState<ClienteBusqueda[] | null>(null)
  const [clienteElegido, setClienteElegido] = useState<ClienteBusqueda | null>(null)
  const [tipoNuevo, setTipoNuevo] = useState('')
  const [detalleNuevo, setDetalleNuevo] = useState('')
  const [creando, setCreando] = useState(false)
  const [errorCreacion, setErrorCreacion] = useState<string | null>(null)
  const idBusquedaVigente = useRef(0)

  useEffect(() => {
    Promise.all([listarTiposSolicitudArco(), listarEstadosSolicitudArco()])
      .then(([tiposRes, estadosRes]) => {
        setTipos(tiposRes)
        setEstados(estadosRes)
        if (tiposRes.length > 0) setTipoNuevo(tiposRes[0].codigo)
      })
      .catch((err: unknown) => setErrorCatalogos(err instanceof ApiError ? err.mensajeUsuario : 'No se pudieron cargar los catálogos.'))
  }, [])

  const cargarSolicitudes = useCallback(() => {
    setCargando(true)
    setError(null)
    listarSolicitudesArco({ estado: filtroEstado || undefined, soloVencidas })
      .then(setSolicitudes)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.mensajeUsuario : 'No se pudieron cargar las solicitudes.'))
      .finally(() => setCargando(false))
  }, [filtroEstado, soloVencidas])

  useEffect(() => {
    cargarSolicitudes()
  }, [cargarSolicitudes])

  useEffect(() => {
    const consulta = clienteTexto.trim()
    if (consulta.length < LONGITUD_MINIMA_BUSQUEDA) {
      setResultadosCliente(null)
      return
    }
    const idBusqueda = ++idBusquedaVigente.current
    const temporizador = setTimeout(() => {
      buscarClientes(consulta)
        .then((res) => {
          if (idBusqueda === idBusquedaVigente.current) setResultadosCliente(res)
        })
        .catch(() => {
          if (idBusqueda === idBusquedaVigente.current) setResultadosCliente([])
        })
    }, RETRASO_DEBOUNCE_MS)
    return () => clearTimeout(temporizador)
  }, [clienteTexto])

  function actualizarSolicitudEnLista(actualizada: SolicitudArco) {
    setSolicitudes((actual) => actual?.map((s) => (s.id === actualizada.id ? actualizada : s)) ?? actual)
  }

  async function manejarCrear(evento: React.FormEvent) {
    evento.preventDefault()
    if (!clienteElegido) return
    setCreando(true)
    setErrorCreacion(null)
    try {
      const solicitud = await crearSolicitudArco({ cliente_id: clienteElegido.id, tipo: tipoNuevo, detalle: detalleNuevo })
      setSolicitudes((actual) => (actual ? [solicitud, ...actual] : [solicitud]))
      setClienteElegido(null)
      setClienteTexto('')
      setDetalleNuevo('')
    } catch (err) {
      setErrorCreacion(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo registrar la solicitud.')
    } finally {
      setCreando(false)
    }
  }

  const tiposMap = tipos ? new Map(tipos.map((t) => [t.codigo, t.etiqueta])) : undefined
  const estadosMap = estados ? new Map(estados.map((e) => [e.codigo, e.etiqueta])) : undefined

  if (errorCatalogos) return <MensajeError mensaje={errorCatalogos} />
  if (!tipos || !estados) return <EsqueletoCarga filas={4} />

  return (
    <div className="space-y-6">
      <div className="rounded-[var(--radius-card)] bg-surface-card p-4 shadow-[var(--shadow-elevation-1)]">
        <p className="mb-3 text-title text-text-primary">Registrar solicitud ARCO</p>
        <form onSubmit={manejarCrear} className="space-y-3">
          <div>
            <label htmlFor="arco-cliente" className="mb-1 block text-label uppercase text-text-secondary">
              Cliente
            </label>
            {clienteElegido ? (
              <p className="text-body text-text-primary">
                {clienteElegido.nombre}{' '}
                <button type="button" className="text-body-sm text-brand-primary-text underline" onClick={() => setClienteElegido(null)}>
                  Cambiar
                </button>
              </p>
            ) : (
              <>
                <input
                  id="arco-cliente"
                  value={clienteTexto}
                  onChange={(evento) => setClienteTexto(evento.target.value)}
                  placeholder="Buscar cliente por nombre o contacto…"
                  className="w-full max-w-md rounded-[var(--radius-card)] border border-brand-primary-soft px-3 py-2 text-body"
                />
                {resultadosCliente !== null && resultadosCliente.length > 0 && (
                  <ul className="mt-1 max-w-md space-y-1 rounded-[var(--radius-card)] bg-surface-bg p-2">
                    {resultadosCliente.map((cliente) => (
                      <li key={cliente.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setClienteElegido(cliente)
                            setResultadosCliente(null)
                          }}
                          className="w-full rounded-[var(--radius-card)] p-2 text-left text-body hover:bg-brand-primary-soft"
                        >
                          {cliente.nombre}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
          <div>
            <label htmlFor="arco-tipo" className="mb-1 block text-label uppercase text-text-secondary">
              Tipo de derecho
            </label>
            <select
              id="arco-tipo"
              value={tipoNuevo}
              onChange={(evento) => setTipoNuevo(evento.target.value)}
              className="rounded-[var(--radius-card)] border border-brand-primary-soft px-3 py-2 text-body"
            >
              {tipos.map((tipo) => (
                <option key={tipo.codigo} value={tipo.codigo}>
                  {tipo.etiqueta} (plazo: {tipo.plazo_respuesta_dias} días)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="arco-detalle" className="mb-1 block text-label uppercase text-text-secondary">
              Detalle
            </label>
            <textarea
              id="arco-detalle"
              value={detalleNuevo}
              onChange={(evento) => setDetalleNuevo(evento.target.value)}
              required
              rows={2}
              className="w-full max-w-md rounded-[var(--radius-card)] border border-brand-primary-soft px-3 py-2 text-body"
            />
          </div>
          <Boton type="submit" disabled={creando || !clienteElegido}>
            {creando ? 'Registrando…' : 'Registrar solicitud'}
          </Boton>
        </form>
        {errorCreacion && <MensajeError mensaje={errorCreacion} />}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="filtro-estado-arco" className="mb-1 block text-label uppercase text-text-secondary">
            Estado
          </label>
          <select
            id="filtro-estado-arco"
            value={filtroEstado}
            onChange={(evento) => setFiltroEstado(evento.target.value)}
            className="rounded-[var(--radius-card)] border border-brand-primary-soft px-3 py-2 text-body"
          >
            <option value="">Todos los estados</option>
            {estados.map((estado) => (
              <option key={estado.codigo} value={estado.codigo}>
                {estado.etiqueta}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-body">
          <input type="checkbox" checked={soloVencidas} onChange={(evento) => setSoloVencidas(evento.target.checked)} />
          Solo vencidas (RF-AD-013)
        </label>
      </div>

      {cargando && <EsqueletoCarga filas={3} alturaPx={100} />}
      {!cargando && error && <MensajeError mensaje={error} onReintentar={cargarSolicitudes} />}
      {!cargando && !error && solicitudes !== null && solicitudes.length === 0 && (
        <EstadoVacio titulo="Sin solicitudes" descripcion="No hay solicitudes ARCO que coincidan con este filtro." />
      )}
      {!cargando && !error && solicitudes !== null && solicitudes.length > 0 && (
        <ul className="space-y-3">
          {solicitudes.map((solicitud) => (
            <FilaSolicitud
              key={solicitud.id}
              solicitud={solicitud}
              estados={estados}
              tiposMap={tiposMap}
              estadosMap={estadosMap}
              onResuelta={actualizarSolicitudEnLista}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
