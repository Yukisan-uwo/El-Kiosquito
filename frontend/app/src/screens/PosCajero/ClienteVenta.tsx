import { useEffect, useRef, useState } from 'react'
import { ApiError } from '@/api/client'
import { Boton } from '@/components/ui/Boton'
import { EsqueletoCarga } from '@/components/ui/EsqueletoCarga'
import { EstadoVacio } from '@/components/ui/EstadoVacio'
import { MensajeError } from '@/components/ui/MensajeError'
import { buscarClientes, consultarPoliticaPrivacidad } from './api'
import type { ClienteExistenteSeleccionado, PoliticaPrivacidad } from './tipos'

export type ModoCliente = 'sin_cliente' | 'existente' | 'nuevo'

export interface DatosClienteNuevo {
  nombre: string
  contacto: string
  fechaNacimiento: string
  aceptoPolitica: boolean
}

export const DATOS_CLIENTE_NUEVO_VACIOS: DatosClienteNuevo = {
  nombre: '',
  contacto: '',
  fechaNacimiento: '',
  aceptoPolitica: false,
}

const RETRASO_DEBOUNCE_MS = 300

interface ClienteVentaProps {
  modo: ModoCliente
  datos: DatosClienteNuevo
  clienteExistente: ClienteExistenteSeleccionado | null
  onCambiarModo: (modo: ModoCliente) => void
  onCambiarDatos: (datos: DatosClienteNuevo) => void
  onCambiarClienteExistente: (cliente: ClienteExistenteSeleccionado | null) => void
}

/**
 * RF-CF-013 (002, enmienda v1.3). Hasta esta enmienda, 002-clientes-
 * fidelizacion no tenía forma de buscar un cliente ya existente por
 * nombre/contacto — solo alta por POST y consultas por id ya conocido —
 * así que el POS solo podía ofrecer "sin cliente" o "cliente nuevo". Con
 * `GET /clientes?q=` ya real, este componente agrega el tercer modo
 * "cliente existente": busca con el mismo patrón de debounce que
 * `BusquedaProductos` (300ms, mínimo 2 caracteres, descarta respuestas
 * obsoletas) y deja elegir uno de los resultados.
 */
export function ClienteVenta({
  modo,
  datos,
  clienteExistente,
  onCambiarModo,
  onCambiarDatos,
  onCambiarClienteExistente,
}: ClienteVentaProps) {
  const [politica, setPolitica] = useState<PoliticaPrivacidad | null>(null)
  const [cargandoPolitica, setCargandoPolitica] = useState(false)
  const [errorPolitica, setErrorPolitica] = useState<string | null>(null)

  const [textoBusqueda, setTextoBusqueda] = useState('')
  const [resultados, setResultados] = useState<ClienteExistenteSeleccionado[] | null>(null)
  const [cargandoBusqueda, setCargandoBusqueda] = useState(false)
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null)
  const idBusquedaVigente = useRef(0)

  useEffect(() => {
    if (modo !== 'nuevo' || politica !== null) return
    let cancelado = false
    setCargandoPolitica(true)
    setErrorPolitica(null)
    consultarPoliticaPrivacidad()
      .then((resultado) => {
        if (!cancelado) setPolitica(resultado)
      })
      .catch((err) => {
        if (!cancelado) setErrorPolitica(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo cargar la política de privacidad.')
      })
      .finally(() => {
        if (!cancelado) setCargandoPolitica(false)
      })
    return () => {
      cancelado = true
    }
  }, [modo, politica])

  async function ejecutarBusquedaCliente(q: string) {
    const idBusqueda = ++idBusquedaVigente.current
    setCargandoBusqueda(true)
    setErrorBusqueda(null)
    try {
      const clientes = await buscarClientes(q)
      if (idBusqueda !== idBusquedaVigente.current) return // respuesta obsoleta, se descarta
      setResultados(clientes.map((c) => ({ id: c.id, nombre: c.nombre })))
    } catch (err) {
      if (idBusqueda !== idBusquedaVigente.current) return
      setErrorBusqueda(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo buscar clientes.')
    } finally {
      if (idBusqueda === idBusquedaVigente.current) setCargandoBusqueda(false)
    }
  }

  function abrirBusquedaClientes() {
    if (clienteExistente !== null) return
    if (resultados === null && !cargandoBusqueda) {
      ejecutarBusquedaCliente(textoBusqueda.trim())
    }
  }

  useEffect(() => {
    if (modo !== 'existente' || clienteExistente !== null) return
    const consulta = textoBusqueda.trim()
    const temporizador = setTimeout(() => {
      ejecutarBusquedaCliente(consulta)
    }, RETRASO_DEBOUNCE_MS)
    return () => clearTimeout(temporizador)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textoBusqueda, modo, clienteExistente])

  function cambiarModo(nuevoModo: ModoCliente) {
    onCambiarModo(nuevoModo)
    if (nuevoModo !== 'existente') {
      setTextoBusqueda('')
      setResultados(null)
      setErrorBusqueda(null)
    } else {
      ejecutarBusquedaCliente('')
    }
  }

  function quitarClienteExistente() {
    onCambiarClienteExistente(null)
    setTextoBusqueda('')
    ejecutarBusquedaCliente('')
  }

  return (
    <div className="space-y-3">
      <p className="text-label uppercase text-text-secondary">Cliente</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => cambiarModo('sin_cliente')}
          aria-pressed={modo === 'sin_cliente'}
          className={`rounded-xl px-3 py-2 text-body-sm font-semibold transition-all shadow-2xs ${
            modo === 'sin_cliente'
              ? 'border-2 border-brand-primary bg-brand-primary text-white shadow-xs'
              : 'border-2 border-amber-200/90 bg-white text-brand-deep hover:border-brand-primary hover:bg-amber-50/50'
          }`}
        >
          Sin cliente
        </button>
        <button
          type="button"
          onClick={() => cambiarModo('existente')}
          aria-pressed={modo === 'existente'}
          className={`rounded-xl px-3 py-2 text-body-sm font-semibold transition-all shadow-2xs ${
            modo === 'existente'
              ? 'border-2 border-brand-primary bg-brand-primary text-white shadow-xs'
              : 'border-2 border-amber-200/90 bg-white text-brand-deep hover:border-brand-primary hover:bg-amber-50/50'
          }`}
        >
          Buscar cliente
        </button>
        <button
          type="button"
          onClick={() => cambiarModo('nuevo')}
          aria-pressed={modo === 'nuevo'}
          className={`rounded-xl px-3 py-2 text-body-sm font-semibold transition-all shadow-2xs ${
            modo === 'nuevo'
              ? 'border-2 border-brand-primary bg-brand-primary text-white shadow-xs'
              : 'border-2 border-amber-200/90 bg-white text-brand-deep hover:border-brand-primary hover:bg-amber-50/50'
          }`}
        >
          Registrar cliente nuevo
        </button>
      </div>

      {modo === 'existente' && (
        <div className="space-y-3 rounded-2xl border-2 border-amber-200/80 bg-white p-4 shadow-2xs">
          {clienteExistente ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-body text-text-primary">
                Cliente: <span className="font-medium text-brand-deep font-display">{clienteExistente.nombre}</span>
              </p>
              <Boton variante="ghost" onClick={quitarClienteExistente}>
                Cambiar
              </Boton>
            </div>
          ) : (
            <>
              <div>
                <label htmlFor="busqueda-cliente" className="mb-1 block text-label uppercase text-text-secondary">
                  Buscar cliente (nombre o contacto)
                </label>
                <input
                  id="busqueda-cliente"
                  type="text"
                  autoComplete="off"
                  value={textoBusqueda}
                  onFocus={abrirBusquedaClientes}
                  onClick={abrirBusquedaClientes}
                  onChange={(evento) => setTextoBusqueda(evento.target.value)}
                  placeholder="Presiona para ver clientes o escribe para filtrar..."
                  className="w-full rounded-xl border-2 border-amber-200/90 bg-white px-3 py-2 text-body focus:border-brand-primary"
                />
              </div>

              {cargandoBusqueda && <EsqueletoCarga filas={2} alturaPx={44} />}

              {!cargandoBusqueda && errorBusqueda && (
                <MensajeError mensaje={errorBusqueda} onReintentar={() => ejecutarBusquedaCliente(textoBusqueda.trim())} />
              )}

              {!cargandoBusqueda && !errorBusqueda && resultados !== null && resultados.length === 0 && (
                <EstadoVacio
                  titulo="Sin coincidencias"
                  descripcion={`Ningún cliente registrado coincide con "${textoBusqueda.trim()}".`}
                />
              )}

              {!cargandoBusqueda && !errorBusqueda && resultados !== null && resultados.length > 0 && (
                <ul className="max-h-60 overflow-y-auto space-y-1.5 rounded-xl border-2 border-amber-200/90 bg-amber-50/40 p-2 shadow-2xs">
                  {resultados.map((cliente) => (
                    <li key={cliente.id}>
                      <button
                        type="button"
                        onClick={() => onCambiarClienteExistente(cliente)}
                        className="w-full rounded-xl border border-amber-200/60 bg-white p-2.5 text-left text-body text-text-primary hover:bg-amber-100/70 hover:border-brand-primary transition-all flex items-center justify-between"
                      >
                        <span className="font-medium">{cliente.nombre}</span>
                        <span className="text-label font-mono text-text-secondary">ID #{cliente.id}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      {modo === 'nuevo' && (
        <div className="space-y-3 rounded-2xl border-2 border-amber-200/80 bg-white p-4 shadow-2xs">
          <div>
            <label htmlFor="cliente-nombre" className="mb-1 block text-label uppercase text-text-secondary">
              Nombre
            </label>
            <input
              id="cliente-nombre"
              type="text"
              required
              value={datos.nombre}
              onChange={(evento) => onCambiarDatos({ ...datos, nombre: evento.target.value })}
              className="w-full rounded-xl border-2 border-amber-200/90 bg-white px-3 py-2 text-body focus:border-brand-primary"
            />
          </div>
          <div>
            <label htmlFor="cliente-contacto" className="mb-1 block text-label uppercase text-text-secondary">
              Contacto (teléfono o correo, opcional)
            </label>
            <input
              id="cliente-contacto"
              type="text"
              value={datos.contacto}
              onChange={(evento) => onCambiarDatos({ ...datos, contacto: evento.target.value })}
              className="w-full rounded-xl border-2 border-amber-200/90 bg-white px-3 py-2 text-body focus:border-brand-primary"
            />
          </div>
          <div>
            <label htmlFor="cliente-nacimiento" className="mb-1 block text-label uppercase text-text-secondary">
              Fecha de nacimiento (opcional)
            </label>
            <input
              id="cliente-nacimiento"
              type="date"
              value={datos.fechaNacimiento}
              onChange={(evento) => onCambiarDatos({ ...datos, fechaNacimiento: evento.target.value })}
              className="w-full rounded-xl border-2 border-amber-200/90 bg-white px-3 py-2 text-body focus:border-brand-primary"
            />
          </div>

          {cargandoPolitica && <EsqueletoCarga filas={2} alturaPx={16} />}
          {errorPolitica && <MensajeError mensaje={errorPolitica} />}
          {politica && (
            <div className="space-y-2">
              <p className="max-h-32 overflow-y-auto rounded-[var(--radius-card)] border border-brand-primary-soft bg-surface-bg p-3 text-body-sm text-text-secondary">
                {politica.contenido}
              </p>
              <label className="flex items-start gap-2 text-body text-text-primary">
                <input
                  type="checkbox"
                  checked={datos.aceptoPolitica}
                  onChange={(evento) => onCambiarDatos({ ...datos, aceptoPolitica: evento.target.checked })}
                  className="mt-1"
                />
                <span>
                  El cliente acepta la política de tratamiento de datos personales (versión {politica.version}, vigente desde{' '}
                  {politica.vigente_desde}).
                </span>
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
