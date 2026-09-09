import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '@/api/client'
import { BadgeEstado } from '@/components/ui/BadgeEstado'
import { Boton } from '@/components/ui/Boton'
import { CardKpi } from '@/components/ui/CardKpi'
import { EsqueletoCarga } from '@/components/ui/EsqueletoCarga'
import { EstadoVacio } from '@/components/ui/EstadoVacio'
import { MensajeError } from '@/components/ui/MensajeError'
import { BarraBusqueda } from '@/components/ui/BarraBusqueda'
import { Paginacion } from '@/components/ui/Paginacion'
import { usePaginacion } from '@/components/ui/usePaginacion'
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
  const [busqueda, setBusqueda] = useState('')

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

  const proveedoresList = proveedores ?? []
  const proveedoresFiltrados = proveedoresList.filter((proveedor) => {
    if (!busqueda.trim()) return true
    const q = busqueda.toLowerCase()
    return (
      proveedor.nombre.toLowerCase().includes(q) ||
      (proveedor.contacto ?? '').toLowerCase().includes(q)
    )
  })

  const {
    datosPaginados: proveedoresPaginados,
    paginaActual,
    totalPaginas,
    itemsPorPagina,
    totalItems,
    cambiarPagina,
    cambiarItemsPorPagina,
  } = usePaginacion(proveedoresFiltrados, { itemsPorPaginaInicial: 10 })

  const totalProveedores = proveedoresList.length
  const activosCount = proveedoresList.filter((p) => p.activo).length
  const inactivosCount = totalProveedores - activosCount

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <CardKpi etiqueta="Total proveedores" cifra={`${totalProveedores} registrado${totalProveedores === 1 ? '' : 's'}`} />
        <CardKpi etiqueta="Proveedores activos" cifra={`${activosCount} activo${activosCount === 1 ? '' : 's'}`} />
        <CardKpi etiqueta="Inactivos / deshabilitados" cifra={`${inactivosCount} inactivo${inactivosCount === 1 ? '' : 's'}`} />
      </div>

      <form onSubmit={manejarCrear} className="space-y-4 rounded-2xl border-2 border-amber-200/90 bg-white p-6 shadow-2xs">
        <p className="text-title font-bold text-brand-deep">Registrar proveedor</p>
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[240px]">
            <label htmlFor="proveedor-nombre" className="mb-1 block text-label uppercase text-text-secondary font-semibold">
              Nombre
            </label>
            <input
              id="proveedor-nombre"
              type="text"
              required
              value={nombreNuevo}
              onChange={(evento) => setNombreNuevo(evento.target.value)}
              className="w-full rounded-xl border-2 border-amber-200/90 bg-white px-3 py-2 text-body focus:border-brand-primary"
            />
          </div>
          <div className="flex-1 min-w-[240px]">
            <label htmlFor="proveedor-contacto" className="mb-1 block text-label uppercase text-text-secondary font-semibold">
              Contacto (opcional)
            </label>
            <input
              id="proveedor-contacto"
              type="text"
              value={contactoNuevo}
              onChange={(evento) => setContactoNuevo(evento.target.value)}
              className="w-full rounded-xl border-2 border-amber-200/90 bg-white px-3 py-2 text-body focus:border-brand-primary"
            />
          </div>
        </div>
        {errorCreacion && <MensajeError mensaje={errorCreacion} />}
        <Boton type="submit" disabled={creando || !nombreNuevo.trim()}>
          {creando ? 'Registrando…' : 'Registrar proveedor'}
        </Boton>
      </form>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-title font-bold text-brand-deep">Proveedores</p>
        <div className="flex flex-wrap items-center gap-3">
          <BarraBusqueda
            valor={busqueda}
            onChange={setBusqueda}
            placeholder="Buscar por nombre o contacto..."
            totalCoincidencias={busqueda.trim() ? proveedoresFiltrados.length : undefined}
            className="w-full sm:w-64"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setFiltro('activos')}
              aria-pressed={filtro === 'activos'}
              className={`rounded-xl px-4 py-1.5 text-body-sm font-semibold transition-colors ${
                filtro === 'activos'
                  ? 'bg-brand-primary text-white shadow-2xs'
                  : 'border-2 border-amber-200/90 bg-white text-brand-deep hover:bg-amber-50'
              }`}
            >
              Activos
            </button>
            <button
              type="button"
              onClick={() => setFiltro('todos')}
              aria-pressed={filtro === 'todos'}
              className={`rounded-xl px-4 py-1.5 text-body-sm font-semibold transition-colors ${
                filtro === 'todos'
                  ? 'bg-brand-primary text-white shadow-2xs'
                  : 'border-2 border-amber-200/90 bg-white text-brand-deep hover:bg-amber-50'
              }`}
            >
              Todos
            </button>
          </div>
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
      {!cargando && !error && proveedores !== null && proveedores.length > 0 && proveedoresFiltrados.length === 0 && (
        <EstadoVacio
          titulo="Sin coincidencias"
          descripcion={`No se encontraron proveedores que coincidan con "${busqueda}".`}
        />
      )}
      {!cargando && !error && proveedores !== null && proveedoresFiltrados.length > 0 && (
        <div className="space-y-4">
          <ul className="space-y-3">
            {proveedoresPaginados.map((proveedor) => (
              <li
                key={proveedor.id}
                className="rounded-2xl border-2 border-amber-200/90 bg-white p-5 shadow-2xs hover:border-amber-300/90 transition-all"
              >
                {idEditando === proveedor.id ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-3">
                      <input
                        value={nombreEdicion}
                        onChange={(evento) => setNombreEdicion(evento.target.value)}
                        className="flex-1 min-w-[200px] rounded-xl border-2 border-amber-200/90 bg-white px-3 py-2 text-body focus:border-brand-primary"
                      />
                      <input
                        value={contactoEdicion}
                        onChange={(evento) => setContactoEdicion(evento.target.value)}
                        placeholder="Contacto"
                        className="flex-1 min-w-[200px] rounded-xl border-2 border-amber-200/90 bg-white px-3 py-2 text-body focus:border-brand-primary"
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
                      <p className="truncate text-body font-bold text-text-primary">{proveedor.nombre}</p>
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
          <div className="rounded-2xl border-2 border-amber-200/90 bg-white shadow-2xs">
            <Paginacion
              paginaActual={paginaActual}
              totalPaginas={totalPaginas}
              totalItems={totalItems}
              itemsPorPagina={itemsPorPagina}
              onCambiarPagina={cambiarPagina}
              onCambiarItemsPorPagina={cambiarItemsPorPagina}
              etiquetaItems="proveedores"
            />
          </div>
        </div>
      )}
    </div>
  )
}
