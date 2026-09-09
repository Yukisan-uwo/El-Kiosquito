import { useEffect, useMemo, useState } from 'react'
import { ApiError } from '@/api/client'
import { BadgeEstado } from '@/components/ui/BadgeEstado'
import { BarraBusqueda } from '@/components/ui/BarraBusqueda'
import { EsqueletoCarga } from '@/components/ui/EsqueletoCarga'
import { EstadoVacio } from '@/components/ui/EstadoVacio'
import { MensajeError } from '@/components/ui/MensajeError'
import { Paginacion } from '@/components/ui/Paginacion'
import { usePaginacion } from '@/components/ui/usePaginacion'
import { consultarMatrizPermisos, listarOperaciones, listarRecursosSistema, listarRoles } from './api'
import type { Operacion, PermisoRol, RecursoSistema, Rol } from './tipos'

function nombreDe(mapa: Map<string, string> | undefined, codigo: string): string {
  return mapa?.get(codigo) ?? codigo
}

/**
 * RF-AD-004 / OO-AD03 — solo lectura (Decisión 3 de `research.md` de
 * 010-administracion): `permiso_rol` se siembra por migración, nunca hay
 * un `PATCH`/`POST` acá. Esta pantalla es de consulta con búsqueda y
 * paginación para facilitar la navegación de toda la matriz.
 */
export function Permisos() {
  const [roles, setRoles] = useState<Rol[] | null>(null)
  const [recursos, setRecursos] = useState<RecursoSistema[] | null>(null)
  const [operaciones, setOperaciones] = useState<Operacion[] | null>(null)
  const [errorCatalogos, setErrorCatalogos] = useState<string | null>(null)

  const [filtroRol, setFiltroRol] = useState<string>('')
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'permitido' | 'denegado'>('todos')
  const [busqueda, setBusqueda] = useState<string>('')
  const [permisos, setPermisos] = useState<PermisoRol[] | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([listarRoles(), listarRecursosSistema(), listarOperaciones()])
      .then(([rolesRes, recursosRes, operacionesRes]) => {
        setRoles(rolesRes)
        setRecursos(recursosRes)
        setOperaciones(operacionesRes)
      })
      .catch((err: unknown) => setErrorCatalogos(err instanceof ApiError ? err.mensajeUsuario : 'No se pudieron cargar los catálogos.'))
  }, [])

  useEffect(() => {
    setCargando(true)
    setError(null)
    consultarMatrizPermisos(filtroRol || undefined)
      .then(setPermisos)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo consultar la matriz de permisos.'))
      .finally(() => setCargando(false))
  }, [filtroRol])

  const rolesMap = useMemo(() => (roles ? new Map(roles.map((r) => [r.codigo, r.etiqueta])) : undefined), [roles])
  const recursosMap = useMemo(() => (recursos ? new Map(recursos.map((r) => [r.codigo, r.etiqueta])) : undefined), [recursos])
  const operacionesMap = useMemo(() => (operaciones ? new Map(operaciones.map((o) => [o.codigo, o.etiqueta])) : undefined), [operaciones])

  const permisosFiltrados = useMemo(() => {
    if (!permisos) return []
    const q = busqueda.trim().toLowerCase()

    return permisos.filter((p) => {
      if (filtroEstado === 'permitido' && !p.permitido) return false
      if (filtroEstado === 'denegado' && p.permitido) return false

      if (!q) return true
      const rolNom = nombreDe(rolesMap, p.rol).toLowerCase()
      const recNom = nombreDe(recursosMap, p.recurso).toLowerCase()
      const opNom = nombreDe(operacionesMap, p.operacion).toLowerCase()
      const estadoNom = p.permitido ? 'permitido' : 'denegado'

      return (
        rolNom.includes(q) ||
        p.rol.toLowerCase().includes(q) ||
        recNom.includes(q) ||
        p.recurso.toLowerCase().includes(q) ||
        opNom.includes(q) ||
        p.operacion.toLowerCase().includes(q) ||
        estadoNom.includes(q)
      )
    })
  }, [permisos, busqueda, filtroEstado, rolesMap, recursosMap, operacionesMap])

  // Hook incondicional antes de cualquier return (React Rules of Hooks)
  const paginacion = usePaginacion(permisosFiltrados, { itemsPorPaginaInicial: 15 })

  if (errorCatalogos) return <MensajeError mensaje={errorCatalogos} />
  if (!roles || !recursos || !operaciones) return <EsqueletoCarga filas={4} />

  const totalPermitidos = permisos?.filter((p) => p.permitido).length ?? 0
  const totalDenegados = permisos ? permisos.length - totalPermitidos : 0

  return (
    <div className="space-y-4">
      {/* Resumen métrico de la matriz */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-2xl border-2 border-amber-200/90 bg-white p-4 shadow-2xs hover:border-amber-300/90 transition-all">
          <span className="block text-label text-text-secondary uppercase font-semibold">Total permisos</span>
          <span className="font-display text-display-sm text-brand-deep">{permisos?.length ?? 0}</span>
        </div>
        <div className="rounded-2xl border-2 border-amber-200/90 bg-white p-4 shadow-2xs hover:border-amber-300/90 transition-all">
          <span className="block text-label text-text-secondary uppercase font-semibold">Permitidos</span>
          <span className="font-display text-display-sm text-status-success">{totalPermitidos}</span>
        </div>
        <div className="rounded-2xl border-2 border-amber-200/90 bg-white p-4 shadow-2xs hover:border-amber-300/90 transition-all">
          <span className="block text-label text-text-secondary uppercase font-semibold">Denegados</span>
          <span className="font-display text-display-sm text-status-danger">{totalDenegados}</span>
        </div>
        <div className="rounded-2xl border-2 border-amber-200/90 bg-white p-4 shadow-2xs hover:border-amber-300/90 transition-all">
          <span className="block text-label text-text-secondary uppercase font-semibold">Coincidencias</span>
          <span className="font-display text-display-sm text-brand-primary">{permisosFiltrados.length}</span>
        </div>
      </div>

      {/* Barra de filtros */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 items-end">
        <div>
          <label htmlFor="filtro-rol-permisos" className="mb-1 block text-label uppercase text-text-secondary">
            Rol
          </label>
          <select
            id="filtro-rol-permisos"
            value={filtroRol}
            onChange={(evento) => setFiltroRol(evento.target.value)}
            className="w-full rounded-xl border-2 border-amber-200/90 px-3 py-2 text-body bg-white focus:border-brand-primary"
          >
            <option value="">Todos los roles</option>
            {roles.map((rol) => (
              <option key={rol.codigo} value={rol.codigo}>
                {rol.etiqueta}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="filtro-estado-permisos" className="mb-1 block text-label uppercase text-text-secondary">
            Estado
          </label>
          <select
            id="filtro-estado-permisos"
            value={filtroEstado}
            onChange={(evento) => setFiltroEstado(evento.target.value as 'todos' | 'permitido' | 'denegado')}
            className="w-full rounded-xl border-2 border-amber-200/90 px-3 py-2 text-body bg-white focus:border-brand-primary"
          >
            <option value="todos">Todos los estados</option>
            <option value="permitido">Solo permitidos</option>
            <option value="denegado">Solo denegados</option>
          </select>
        </div>

        <div>
          <BarraBusqueda
            valor={busqueda}
            onChange={setBusqueda}
            placeholder="Buscar por recurso u operación..."
            totalCoincidencias={busqueda ? permisosFiltrados.length : undefined}
          />
        </div>
      </div>

      {cargando && <EsqueletoCarga filas={5} alturaPx={40} />}
      {!cargando && error && <MensajeError mensaje={error} />}
      {!cargando && !error && permisos !== null && permisosFiltrados.length === 0 && (
        <EstadoVacio
          titulo="Sin permisos coincidentes"
          descripcion={busqueda || filtroRol || filtroEstado !== 'todos' ? 'No hay permisos que coincidan con los criterios seleccionados.' : 'No hay filas de la matriz disponibles.'}
        />
      )}
      {!cargando && !error && permisos !== null && permisosFiltrados.length > 0 && (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-2xl border-2 border-amber-200/90 bg-white shadow-2xs">
            <table className="w-full text-body">
              <thead>
                <tr className="border-b-2 border-amber-200/80 bg-amber-50/70 text-left text-label uppercase text-brand-deep font-bold">
                  <th scope="col" className="px-4 py-3">Rol</th>
                  <th scope="col" className="px-4 py-3">Recurso</th>
                  <th scope="col" className="px-4 py-3">Operación</th>
                  <th scope="col" className="px-4 py-3">Estado</th>
                </tr>
              </thead>
              <tbody>
                {paginacion.datosPaginados.map((permiso) => (
                  <tr key={`${permiso.rol}-${permiso.recurso}-${permiso.operacion}`} className="border-b border-amber-100 last:border-0 hover:bg-amber-50/40 transition-colors">
                    <td className="px-4 py-3 text-text-primary font-medium">{nombreDe(rolesMap, permiso.rol)}</td>
                    <td className="px-4 py-3 text-text-primary">{nombreDe(recursosMap, permiso.recurso)}</td>
                    <td className="px-4 py-3 text-text-secondary">{nombreDe(operacionesMap, permiso.operacion)}</td>
                    <td className="px-4 py-3">
                      <BadgeEstado texto={permiso.permitido ? 'Permitido' : 'Denegado'} color={permiso.permitido ? 'success' : 'danger'} />
                    </td>
                  </tr>
                ))}
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
            opcionesItemsPorPagina={[10, 15, 25, 50]}
          />
        </div>
      )}
    </div>
  )
}
