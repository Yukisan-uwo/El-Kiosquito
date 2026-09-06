import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '@/api/client'
import { BadgeEstado } from '@/components/ui/BadgeEstado'
import { Boton } from '@/components/ui/Boton'
import { EsqueletoCarga } from '@/components/ui/EsqueletoCarga'
import { EstadoVacio } from '@/components/ui/EstadoVacio'
import { MensajeError } from '@/components/ui/MensajeError'
import { actualizarProveedor, crearProveedor, desactivarProveedor, listarProveedores } from './api'
import type { Proveedor } from './tipos'

type FiltroActivo = 'activos' | 'todos'

/**
 * RF-CP-017 (008, enmienda v1.3). Antes de esta enmienda no existía
 * ningún listado de proveedores — el usuario elegido con AskUserQuestion
 * fue agregar el GET mínimo para que esta pantalla pudiera existir de
 * verdad. Alta, edición (nombre/contacto) y baja lógica en un solo lugar
 * — no hay reactivación porque el backend tampoco la expone (RF-CP-011:
 * la baja es deliberadamente irreversible desde la API, solo bloquea
 * nuevas órdenes).
 */
export function Proveedores() {
  const [filtro, setFiltro] = useState<FiltroActivo>('activos')
  const [proveedores, setProveedores] = useState<Proveedor[] | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [nombreNuevo, setNombreNuevo] = useState('')
  const [contactoNuevo, setContactoNuevo] = useState('')
  const [creando, setCreando] = useState(false)
  const [errorCreacion, setErrorCreacion] = useState<string | null>(null)

  const [idEditando, setIdEditando] = useState<number | null>(null)
  const [nombreEdicion, setNombreEdicion] = useState('')
  const [contactoEdicion, setContactoEdicion] = useState('')
  const [guardandoEdicion, setGuardandoEdicion] = useState(false)
  const [errorEdicion, setErrorEdicion] = useState<string | null>(null)

  const [desactivandoId, setDesactivandoId] = useState<number | null>(null)

  const cargar = useCallback(() => {
    setCargando(true)
    setError(null)
    listarProveedores(filtro === 'activos' ? true : undefined)
      .then(setProveedores)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo cargar proveedores.'))
      .finally(() => setCargando(false))
  }, [filtro])

  useEffect(() => {
    cargar()
  }, [cargar])

  async function manejarCrear(evento: React.FormEvent) {
    evento.preventDefault()
    if (!nombreNuevo.trim()) return
    setCreando(true)
    setErrorCreacion(null)
    try {
      await crearProveedor({ nombre: nombreNuevo.trim(), contacto: contactoNuevo.trim() || undefined })
      setNombreNuevo('')
      setContactoNuevo('')
      cargar()
    } catch (err) {
      setErrorCreacion(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo registrar el proveedor.')
    } finally {
      setCreando(false)
    }
  }

  function iniciarEdicion(proveedor: Proveedor) {
    setIdEditando(proveedor.id)
    setNombreEdicion(proveedor.nombre)
    setContactoEdicion(proveedor.contacto ?? '')
    setErrorEdicion(null)
  }

  async function guardarEdicion(id: number) {
    setGuardandoEdicion(true)
    setErrorEdicion(null)
    try {
      await actualizarProveedor(id, { nombre: nombreEdicion.trim(), contacto: contactoEdicion.trim() || undefined })
      setIdEditando(null)
      cargar()
    } catch (err) {
      setErrorEdicion(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo actualizar el proveedor.')
    } finally {
      setGuardandoEdicion(false)
    }
  }

  async function manejarDesactivar(id: number) {
    setDesactivandoId(id)
    try {
      await desactivarProveedor(id)
      cargar()
    } catch (err) {
      setError(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo desactivar el proveedor.')
    } finally {
      setDesactivandoId(null)
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={manejarCrear} className="space-y-3 rounded-[var(--radius-card)] bg-surface-card p-4">
        <p className="text-title text-text-primary">Registrar proveedor</p>
        <div className="flex flex-wrap gap-3">
          <div className="flex-1">
            <label htmlFor="proveedor-nombre" className="mb-1 block text-label uppercase text-text-secondary">
              Nombre
            </label>
            <input
              id="proveedor-nombre"
              type="text"
              required
              value={nombreNuevo}
              onChange={(evento) => setNombreNuevo(evento.target.value)}
              className="w-full rounded-[var(--radius-card)] border border-brand-primary-soft px-3 py-2 text-body"
            />
          </div>
          <div className="flex-1">
            <label htmlFor="proveedor-contacto" className="mb-1 block text-label uppercase text-text-secondary">
              Contacto (opcional)
            </label>
            <input
              id="proveedor-contacto"
              type="text"
              value={contactoNuevo}
              onChange={(evento) => setContactoNuevo(evento.target.value)}
              className="w-full rounded-[var(--radius-card)] border border-brand-primary-soft px-3 py-2 text-body"
            />
          </div>
        </div>
        {errorCreacion && <MensajeError mensaje={errorCreacion} />}
        <Boton type="submit" disabled={creando || !nombreNuevo.trim()}>
          {creando ? 'Registrando…' : 'Registrar proveedor'}
        </Boton>
      </form>

      <div className="flex items-center justify-between">
        <p className="text-title text-text-primary">Proveedores</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setFiltro('activos')}
            aria-pressed={filtro === 'activos'}
            className={`rounded-[var(--radius-card)] px-3 py-1.5 text-body-sm ${
              filtro === 'activos' ? 'bg-brand-primary text-white' : 'border border-brand-primary-soft text-text-secondary'
            }`}
          >
            Activos
          </button>
          <button
            type="button"
            onClick={() => setFiltro('todos')}
            aria-pressed={filtro === 'todos'}
            className={`rounded-[var(--radius-card)] px-3 py-1.5 text-body-sm ${
              filtro === 'todos' ? 'bg-brand-primary text-white' : 'border border-brand-primary-soft text-text-secondary'
            }`}
          >
            Todos
          </button>
        </div>
      </div>

      {cargando && <EsqueletoCarga filas={3} alturaPx={56} />}
      {!cargando && error && <MensajeError mensaje={error} onReintentar={cargar} />}
      {!cargando && !error && proveedores !== null && proveedores.length === 0 && (
        <EstadoVacio
          titulo={filtro === 'activos' ? 'Sin proveedores activos' : 'Todavía no hay proveedores registrados'}
          descripcion="Registrá el primero con el formulario de arriba."
        />
      )}
      {!cargando && !error && proveedores !== null && proveedores.length > 0 && (
        <ul className="space-y-2">
          {proveedores.map((proveedor) => (
            <li key={proveedor.id} className="rounded-[var(--radius-card)] bg-surface-card p-4 shadow-[var(--shadow-elevation-1)]">
              {idEditando === proveedor.id ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <input
                      value={nombreEdicion}
                      onChange={(evento) => setNombreEdicion(evento.target.value)}
                      className="flex-1 rounded-[var(--radius-card)] border border-brand-primary-soft px-3 py-2 text-body"
                    />
                    <input
                      value={contactoEdicion}
                      onChange={(evento) => setContactoEdicion(evento.target.value)}
                      placeholder="Contacto"
                      className="flex-1 rounded-[var(--radius-card)] border border-brand-primary-soft px-3 py-2 text-body"
                    />
                  </div>
                  {errorEdicion && <MensajeError mensaje={errorEdicion} />}
                  <div className="flex gap-2">
                    <Boton disabled={guardandoEdicion} onClick={() => guardarEdicion(proveedor.id)}>
                      {guardandoEdicion ? 'Guardando…' : 'Guardar'}
                    </Boton>
                    <Boton variante="ghost" onClick={() => setIdEditando(null)}>
                      Cancelar
                    </Boton>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-body font-medium text-text-primary">{proveedor.nombre}</p>
                    <p className="text-body-sm text-text-secondary">{proveedor.contacto ?? 'Sin contacto registrado'}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <BadgeEstado texto={proveedor.activo ? 'Activo' : 'Inactivo'} color={proveedor.activo ? 'success' : 'danger'} />
                    <Boton variante="ghost" onClick={() => iniciarEdicion(proveedor)}>
                      Editar
                    </Boton>
                    {proveedor.activo && (
                      <Boton
                        variante="peligro"
                        disabled={desactivandoId === proveedor.id}
                        onClick={() => manejarDesactivar(proveedor.id)}
                      >
                        {desactivandoId === proveedor.id ? 'Desactivando…' : 'Desactivar'}
                      </Boton>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
