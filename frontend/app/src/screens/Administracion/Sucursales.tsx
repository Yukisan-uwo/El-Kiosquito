import { useEffect, useMemo, useState } from 'react'
import { ApiError } from '@/api/client'
import { BadgeEstado } from '@/components/ui/BadgeEstado'
import { BarraBusqueda } from '@/components/ui/BarraBusqueda'
import { EsqueletoCarga } from '@/components/ui/EsqueletoCarga'
import { EstadoVacio } from '@/components/ui/EstadoVacio'
import { MensajeError } from '@/components/ui/MensajeError'
import { Paginacion } from '@/components/ui/Paginacion'
import { usePaginacion } from '@/components/ui/usePaginacion'
import {
  activarSucursal,
  cerrarSucursal,
  completarItemChecklist,
  consultarEstadoApertura,
  crearSucursal,
  heredarCatalogo,
  listarItemsChecklistApertura,
  listarSucursales,
} from './api'
import type { EstadoApertura, ItemChecklistCatalogo, Sucursal } from './tipos'

const MAPA_COLOR_ESTADO: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
  operativa: 'success',
  en_apertura: 'warning',
  cerrada: 'danger',
}

const ETIQUETA_ESTADO: Record<string, string> = {
  operativa: 'Operativa',
  en_apertura: 'En apertura',
  cerrada: 'Cerrada',
}

export function Sucursales() {
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [catalogoItems, setCatalogoItems] = useState<ItemChecklistCatalogo[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Búsqueda y filtros
  const [busqueda, setBusqueda] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<string>('todos')

  // Formulario alta nueva sucursal
  const [mostrarFormulario, setMostrarFormulario] = useState(false)
  const [nombreNuevo, setNombreNuevo] = useState('')
  const [direccionNueva, setDireccionNueva] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [errorFormulario, setErrorFormulario] = useState<string | null>(null)

  // Gestión de checklist / apertura
  const [sucursalSeleccionada, setSucursalSeleccionada] = useState<Sucursal | null>(null)
  const [estadoApertura, setEstadoApertura] = useState<EstadoApertura | null>(null)
  const [cargandoChecklist, setCargandoChecklist] = useState(false)
  const [accionEnProgreso, setAccionEnProgreso] = useState<string | null>(null)
  const [mensajeChecklist, setMensajeChecklist] = useState<string | null>(null)
  const [errorChecklist, setErrorChecklist] = useState<string | null>(null)

  function cargarDatos() {
    setCargando(true)
    setError(null)
    Promise.all([listarSucursales(), listarItemsChecklistApertura()])
      .then(([sucursalesRes, catalogoRes]) => {
        setSucursales(sucursalesRes)
        setCatalogoItems(catalogoRes)
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.mensajeUsuario : 'No se pudieron cargar las sucursales.')
      })
      .finally(() => setCargando(false))
  }

  useEffect(() => {
    cargarDatos()
  }, [])

  async function abrirChecklist(suc: Sucursal) {
    setSucursalSeleccionada(suc)
    setCargandoChecklist(true)
    setErrorChecklist(null)
    setMensajeChecklist(null)
    try {
      const data = await consultarEstadoApertura(suc.id)
      setEstadoApertura(data)
    } catch (err: unknown) {
      setErrorChecklist(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo cargar el checklist de apertura.')
    } finally {
      setCargandoChecklist(false)
    }
  }

  async function manejarCrearSucursal(e: React.FormEvent) {
    e.preventDefault()
    if (!nombreNuevo.trim() || !direccionNueva.trim()) {
      setErrorFormulario('El nombre y la dirección son obligatorios.')
      return
    }

    setGuardando(true)
    setErrorFormulario(null)
    try {
      const nueva = await crearSucursal({
        nombre: nombreNuevo.trim(),
        direccion: direccionNueva.trim(),
      })
      setNombreNuevo('')
      setDireccionNueva('')
      setMostrarFormulario(false)
      // Recargar lista y abrir checklist de la nueva sucursal
      await cargarDatos()
      abrirChecklist(nueva)
    } catch (err: unknown) {
      setErrorFormulario(err instanceof ApiError ? err.mensajeUsuario : 'Error al registrar la sucursal.')
    } finally {
      setGuardando(false)
    }
  }

  async function manejarCompletarItem(itemCodigo: string) {
    if (!sucursalSeleccionada) return
    setAccionEnProgreso(`item-${itemCodigo}`)
    setErrorChecklist(null)
    try {
      await completarItemChecklist(sucursalSeleccionada.id, itemCodigo)
      const data = await consultarEstadoApertura(sucursalSeleccionada.id)
      setEstadoApertura(data)
      setMensajeChecklist(`Ítem '${itemCodigo}' completado exitosamente.`)
    } catch (err: unknown) {
      setErrorChecklist(err instanceof ApiError ? err.mensajeUsuario : 'Error al completar el ítem.')
    } finally {
      setAccionEnProgreso(null)
    }
  }

  async function manejarHeredarCatalogo() {
    if (!sucursalSeleccionada) return
    setAccionEnProgreso('heredar')
    setErrorChecklist(null)
    setMensajeChecklist(null)
    try {
      const res = await heredarCatalogo(sucursalSeleccionada.id)
      const data = await consultarEstadoApertura(sucursalSeleccionada.id)
      setEstadoApertura(data)
      setMensajeChecklist(
        `Catálogo heredado: ${res.cantidad_productos_heredados} productos incorporados con precios de la cadena (${res.cantidad_productos_pendientes} pendientes).`
      )
    } catch (err: unknown) {
      setErrorChecklist(err instanceof ApiError ? err.mensajeUsuario : 'Error al heredar el catálogo.')
    } finally {
      setAccionEnProgreso(null)
    }
  }

  async function manejarActivar() {
    if (!sucursalSeleccionada) return
    setAccionEnProgreso('activar')
    setErrorChecklist(null)
    try {
      const sucursalActivada = await activarSucursal(sucursalSeleccionada.id)
      setSucursalSeleccionada(sucursalActivada)
      setMensajeChecklist(`¡Sucursal activada con éxito! Ahora está operativa para ventas e inventario.`)
      cargarDatos()
    } catch (err: unknown) {
      setErrorChecklist(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo activar la sucursal.')
    } finally {
      setAccionEnProgreso(null)
    }
  }

  async function manejarCerrar(suc: Sucursal) {
    const seguro = window.confirm(`¿Estás seguro de que deseas cerrar temporalmente la sucursal "${suc.nombre}"?`)
    if (!seguro) return

    try {
      await cerrarSucursal(suc.id)
      cargarDatos()
      if (sucursalSeleccionada?.id === suc.id) {
        setSucursalSeleccionada(null)
      }
    } catch (err: unknown) {
      alert(err instanceof ApiError ? err.mensajeUsuario : 'Error al cerrar la sucursal.')
    }
  }

  const sucursalesFiltradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return sucursales.filter((s) => {
      if (filtroEstado !== 'todos' && s.estado !== filtroEstado) return false
      if (!q) return true
      return s.nombre.toLowerCase().includes(q) || s.direccion.toLowerCase().includes(q) || String(s.id).includes(q)
    })
  }, [sucursales, busqueda, filtroEstado])

  // Hook incondicional
  const paginacion = usePaginacion(sucursalesFiltradas, { itemsPorPaginaInicial: 10 })

  const conteoOperativas = sucursales.filter((s) => s.estado === 'operativa').length
  const conteoEnApertura = sucursales.filter((s) => s.estado === 'en_apertura').length
  const conteoCerradas = sucursales.filter((s) => s.estado === 'cerrada').length

  const mapaEtiquetasItems = useMemo(() => {
    return new Map(catalogoItems.map((it) => [it.codigo, it.etiqueta]))
  }, [catalogoItems])

  return (
    <div className="space-y-6">
      {/* Cabecera y KPI cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-2xl border-2 border-amber-200/90 bg-white p-5 shadow-2xs hover:border-amber-300/90 transition-all">
          <span className="block text-label text-text-secondary uppercase tracking-wider font-semibold">Total sucursales</span>
          <span className="font-display text-display-md text-brand-deep">{sucursales.length}</span>
        </div>
        <div className="rounded-2xl border-2 border-amber-200/90 bg-white p-5 shadow-2xs hover:border-amber-300/90 transition-all">
          <span className="block text-label text-text-secondary uppercase tracking-wider font-semibold">Operativas</span>
          <span className="font-display text-display-md text-status-success">{conteoOperativas}</span>
        </div>
        <div className="rounded-2xl border-2 border-amber-200/90 bg-white p-5 shadow-2xs hover:border-amber-300/90 transition-all">
          <span className="block text-label text-text-secondary uppercase tracking-wider font-semibold">En apertura</span>
          <span className="font-display text-display-md text-status-warning">{conteoEnApertura}</span>
        </div>
        <div className="rounded-2xl border-2 border-amber-200/90 bg-white p-5 shadow-2xs hover:border-amber-300/90 transition-all">
          <span className="block text-label text-text-secondary uppercase tracking-wider font-semibold">Cerradas</span>
          <span className="font-display text-display-md text-status-danger">{conteoCerradas}</span>
        </div>
      </div>

      {/* Barra de acción: Alta de sucursal */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-title text-brand-deep">Red de Sucursales</h2>
          <p className="text-body-sm text-text-secondary">
            Alta, checklist de apertura, asignación territorial y control de puntos de venta.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setMostrarFormulario((prev) => !prev)}
          className="flex items-center gap-2 rounded-[var(--radius-card)] bg-brand-primary px-4 py-2.5 text-body font-medium text-white shadow-sm hover:bg-brand-deep transition-colors"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={mostrarFormulario ? "M6 18L18 6M6 6l12 12" : "M12 4v16m8-8H4"} />
          </svg>
          <span>{mostrarFormulario ? 'Cancelar alta' : 'Nueva sucursal'}</span>
        </button>
      </div>

      {/* Formulario desplegable de creación */}
      {mostrarFormulario && (
        <form
          onSubmit={manejarCrearSucursal}
          className="rounded-2xl border-2 border-amber-200/90 bg-white p-6 shadow-2xs space-y-4"
        >
          <div className="border-b border-amber-200/80 pb-3">
            <h3 className="font-display text-title text-brand-deep">Registrar Nueva Sucursal</h3>
            <p className="text-body-sm text-text-secondary">
              Se creará en estado <span className="font-semibold text-status-warning">En apertura</span> e inicializará automáticamente los 8 requisitos del checklist obligatorio.
            </p>
          </div>

          {errorFormulario && <MensajeError mensaje={errorFormulario} />}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="nombre-sucursal" className="mb-1 block text-label uppercase text-text-secondary">
                Nombre o Identificador *
              </label>
              <input
                id="nombre-sucursal"
                type="text"
                required
                value={nombreNuevo}
                onChange={(e) => setNombreNuevo(e.target.value)}
                placeholder="Ej. El Kiosquito — Terminal Terrestre"
                className="w-full rounded-xl border-2 border-amber-200/90 px-3 py-2 text-body bg-white focus:outline-none focus:border-brand-primary"
              />
            </div>

            <div>
              <label htmlFor="direccion-sucursal" className="mb-1 block text-label uppercase text-text-secondary">
                Dirección Completa *
              </label>
              <input
                id="direccion-sucursal"
                type="text"
                required
                value={direccionNueva}
                onChange={(e) => setDireccionNueva(e.target.value)}
                placeholder="Ej. Av. Walter Andrade y 5ta Transversal"
                className="w-full rounded-xl border-2 border-amber-200/90 px-3 py-2 text-body bg-white focus:outline-none focus:border-brand-primary"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setMostrarFormulario(false)}
              className="rounded-xl border-2 border-amber-200/90 px-4 py-2 text-body text-text-secondary hover:bg-amber-50/50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="rounded-xl bg-brand-primary px-5 py-2 text-body font-medium text-white shadow-sm hover:bg-brand-deep disabled:opacity-50 transition-colors"
            >
              {guardando ? 'Creando sucursal...' : 'Guardar e Iniciar Apertura'}
            </button>
          </div>
        </form>
      )}

      {/* Filtros y Buscador */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 items-end">
        <div>
          <label htmlFor="filtro-estado-sucursal" className="mb-1 block text-label uppercase text-text-secondary">
            Estado
          </label>
          <select
            id="filtro-estado-sucursal"
            value={filtroEstado}
            onChange={(e) => setFiltroEstado(e.target.value)}
            className="w-full rounded-xl border-2 border-amber-200/90 px-3 py-2 text-body bg-white focus:border-brand-primary"
          >
            <option value="todos">Todos los estados ({sucursales.length})</option>
            <option value="operativa">Operativas ({conteoOperativas})</option>
            <option value="en_apertura">En apertura ({conteoEnApertura})</option>
            <option value="cerrada">Cerradas ({conteoCerradas})</option>
          </select>
        </div>

        <div className="sm:col-span-2">
          <BarraBusqueda
            valor={busqueda}
            onChange={setBusqueda}
            placeholder="Buscar por nombre, dirección o ID..."
            totalCoincidencias={busqueda ? sucursalesFiltradas.length : undefined}
          />
        </div>
      </div>

      {cargando && <EsqueletoCarga filas={5} alturaPx={44} />}
      {!cargando && error && <MensajeError mensaje={error} />}

      {!cargando && !error && sucursalesFiltradas.length === 0 && (
        <EstadoVacio
          titulo="Sin sucursales coincidentes"
          descripcion={busqueda || filtroEstado !== 'todos' ? 'No hay sucursales que coincidan con los filtros aplicados.' : 'Aún no se han registrado sucursales en la red.'}
        />
      )}

      {/* Tabla de sucursales */}
      {!cargando && !error && sucursalesFiltradas.length > 0 && (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-2xl border-2 border-amber-200/90 bg-white shadow-2xs">
            <table className="w-full text-body">
              <thead>
                <tr className="border-b-2 border-amber-200/80 bg-amber-50/70 text-left text-label uppercase text-brand-deep font-bold">
                  <th scope="col" className="px-4 py-3">ID</th>
                  <th scope="col" className="px-4 py-3">Nombre</th>
                  <th scope="col" className="px-4 py-3">Dirección</th>
                  <th scope="col" className="px-4 py-3">Estado</th>
                  <th scope="col" className="px-4 py-3">Registro</th>
                  <th scope="col" className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {paginacion.datosPaginados.map((suc) => {
                  const estaSeleccionada = sucursalSeleccionada?.id === suc.id
                  return (
                    <tr
                      key={suc.id}
                      className={`border-b border-amber-100 last:border-0 hover:bg-amber-50/40 transition-colors ${
                        estaSeleccionada ? 'bg-amber-50/80 font-medium' : ''
                      }`}
                    >
                      <td className="px-4 py-3 text-text-secondary font-mono text-body-sm">#{suc.id}</td>
                      <td className="px-4 py-3 font-medium text-text-primary">{suc.nombre}</td>
                      <td className="px-4 py-3 text-text-secondary text-body-sm">{suc.direccion}</td>
                      <td className="px-4 py-3">
                        <BadgeEstado
                          texto={ETIQUETA_ESTADO[suc.estado] ?? suc.estado}
                          color={MAPA_COLOR_ESTADO[suc.estado] ?? 'info'}
                        />
                      </td>
                      <td className="px-4 py-3 text-text-secondary text-body-sm">
                        {new Date(suc.fecha_registro).toLocaleDateString('es-EC')}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {suc.estado === 'en_apertura' && (
                            <button
                              type="button"
                              onClick={() => abrirChecklist(suc)}
                              className="rounded-xl border border-brand-primary bg-brand-primary-soft px-3 py-1 text-body-sm font-medium text-brand-primary-text hover:bg-brand-primary hover:text-white transition-colors"
                            >
                              Checklist de apertura
                            </button>
                          )}
                          {suc.estado === 'operativa' && (
                            <button
                              type="button"
                              onClick={() => manejarCerrar(suc)}
                              className="rounded-xl border border-status-danger/30 bg-status-danger/10 px-2.5 py-1 text-body-sm text-status-danger hover:bg-status-danger hover:text-white transition-colors"
                            >
                              Cerrar sucursal
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <Paginacion
            paginaActual={paginacion.paginaActual}
            totalPaginas={paginacion.totalPaginas}
            totalItems={paginacion.totalItems}
            itemsPorPagina={paginacion.itemsPorPagina}
            onCambiarPagina={paginacion.cambiarPagina}
            onCambiarItemsPorPagina={paginacion.cambiarItemsPorPagina}
            opcionesItemsPorPagina={[5, 10, 20]}
          />
        </div>
      )}

      {/* Modal / Panel de Checklist de Apertura */}
      {sucursalSeleccionada && sucursalSeleccionada.estado === 'en_apertura' && (
        <div className="rounded-2xl border-2 border-amber-300 bg-white p-6 shadow-md space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-amber-200/80 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-status-warning/20 px-2.5 py-0.5 text-label font-medium text-status-warning uppercase">
                  Proceso de Apertura
                </span>
                <span className="text-body-sm text-text-secondary font-mono">ID #{sucursalSeleccionada.id}</span>
              </div>
              <h3 className="mt-1 font-display text-display-sm text-brand-deep">
                {sucursalSeleccionada.nombre}
              </h3>
              <p className="text-body-sm text-text-secondary">{sucursalSeleccionada.direccion}</p>
            </div>

            <button
              type="button"
              onClick={() => setSucursalSeleccionada(null)}
              className="rounded-xl border-2 border-amber-200/90 p-1.5 text-text-secondary hover:bg-amber-50/50"
              aria-label="Cerrar panel de apertura"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {cargandoChecklist && <EsqueletoCarga filas={4} alturaPx={36} />}
          {errorChecklist && <MensajeError mensaje={errorChecklist} />}
          {mensajeChecklist && (
            <div className="rounded-xl bg-status-success/15 border border-status-success/30 p-3 text-body-sm text-status-success">
              {mensajeChecklist}
            </div>
          )}

          {!cargandoChecklist && estadoApertura && (
            <div className="space-y-4">
              {/* Barra de progreso de requisitos */}
              {(() => {
                const completados = estadoApertura.checklist.filter((it) => it.completado).length
                const total = estadoApertura.checklist.length
                const porcentaje = total > 0 ? Math.round((completados / total) * 100) : 0
                const todosCompletos = total > 0 && completados === total

                return (
                  <div className="rounded-xl bg-amber-50/40 p-4 border-2 border-amber-200/90 space-y-3">
                    <div className="flex items-center justify-between text-body-sm">
                      <span className="font-medium text-text-primary">
                        Progreso del Checklist: {completados} de {total} requisitos completados
                      </span>
                      <span className="font-semibold text-brand-primary">{porcentaje}%</span>
                    </div>

                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-white border border-amber-200">
                      <div
                        className="h-full bg-brand-primary transition-all duration-500"
                        style={{ width: `${porcentaje}%` }}
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                      <button
                        type="button"
                        disabled={accionEnProgreso !== null}
                        onClick={manejarHeredarCatalogo}
                        className="flex items-center gap-2 rounded-xl border border-brand-primary bg-white px-3 py-1.5 text-body-sm font-medium text-brand-primary hover:bg-brand-primary hover:text-white transition-colors disabled:opacity-50"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                        </svg>
                        <span>Heredar catálogo y precios de cadena</span>
                      </button>

                      <button
                        type="button"
                        disabled={!todosCompletos || accionEnProgreso !== null}
                        onClick={manejarActivar}
                        className="flex items-center gap-2 rounded-xl bg-status-success px-5 py-2 text-body font-medium text-white shadow-sm hover:bg-status-success/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span>{todosCompletos ? 'Activar Sucursal (Pasar a Operativa)' : 'Completar requisitos para activar'}</span>
                      </button>
                    </div>
                  </div>
                )
              })()}

              {/* Lista de ítems del checklist */}
              <div className="overflow-hidden rounded-xl border-2 border-amber-200/90 bg-white">
                <table className="w-full text-body">
                  <thead>
                    <tr className="border-b-2 border-amber-200/80 bg-amber-50/70 text-left text-label uppercase text-brand-deep font-bold">
                      <th scope="col" className="px-4 py-2.5">Requisito</th>
                      <th scope="col" className="px-4 py-2.5">Código</th>
                      <th scope="col" className="px-4 py-2.5">Estado</th>
                      <th scope="col" className="px-4 py-2.5 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {estadoApertura.checklist.map((it) => {
                      const etiqueta = mapaEtiquetasItems.get(it.item) ?? it.item.replace(/_/g, ' ')
                      const enProgreso = accionEnProgreso === `item-${it.item}`

                      return (
                        <tr key={it.item} className="border-b border-amber-100 last:border-0 hover:bg-amber-50/40">
                          <td className="px-4 py-3 font-medium text-text-primary capitalize">{etiqueta}</td>
                          <td className="px-4 py-3 font-mono text-body-sm text-text-secondary">{it.item}</td>
                          <td className="px-4 py-3">
                            <BadgeEstado
                              texto={it.completado ? 'Completado' : 'Pendiente'}
                              color={it.completado ? 'success' : 'warning'}
                            />
                          </td>
                          <td className="px-4 py-3 text-right">
                            {!it.completado ? (
                              <button
                                type="button"
                                disabled={accionEnProgreso !== null}
                                onClick={() => manejarCompletarItem(it.item)}
                                className="rounded-lg border border-brand-primary-soft bg-surface-bg px-2.5 py-1 text-body-sm font-medium text-brand-primary hover:bg-brand-primary hover:text-white transition-colors disabled:opacity-50"
                              >
                                {enProgreso ? 'Guardando...' : 'Marcar listo'}
                              </button>
                            ) : (
                              <span className="text-body-sm text-text-secondary">
                                {it.fecha_completado ? new Date(it.fecha_completado).toLocaleDateString('es-EC') : 'Listo'}
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
