import { useEffect, useState } from 'react'
import { ApiError } from '@/api/client'
import { BadgeEstado } from '@/components/ui/BadgeEstado'
import { EsqueletoCarga } from '@/components/ui/EsqueletoCarga'
import { EstadoVacio } from '@/components/ui/EstadoVacio'
import { MensajeError } from '@/components/ui/MensajeError'
import { consultarMatrizPermisos, listarOperaciones, listarRecursosSistema, listarRoles } from './api'
import type { Operacion, PermisoRol, RecursoSistema, Rol } from './tipos'

function nombreDe(mapa: Map<string, string> | undefined, codigo: string): string {
  return mapa?.get(codigo) ?? codigo
}

/**
 * RF-AD-004 / OO-AD03 — solo lectura (Decisión 3 de `research.md` de
 * 010-administracion): `permiso_rol` se siembra por migración, nunca hay
 * un `PATCH`/`POST` acá. Esta pantalla es de consulta, no de edición.
 */
export function Permisos() {
  const [roles, setRoles] = useState<Rol[] | null>(null)
  const [recursos, setRecursos] = useState<RecursoSistema[] | null>(null)
  const [operaciones, setOperaciones] = useState<Operacion[] | null>(null)
  const [errorCatalogos, setErrorCatalogos] = useState<string | null>(null)

  const [filtroRol, setFiltroRol] = useState<string>('')
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

  const rolesMap = roles ? new Map(roles.map((r) => [r.codigo, r.etiqueta])) : undefined
  const recursosMap = recursos ? new Map(recursos.map((r) => [r.codigo, r.etiqueta])) : undefined
  const operacionesMap = operaciones ? new Map(operaciones.map((o) => [o.codigo, o.etiqueta])) : undefined

  if (errorCatalogos) return <MensajeError mensaje={errorCatalogos} />
  if (!roles || !recursos || !operaciones) return <EsqueletoCarga filas={4} />

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="filtro-rol-permisos" className="mb-1 block text-label uppercase text-text-secondary">
          Rol
        </label>
        <select
          id="filtro-rol-permisos"
          value={filtroRol}
          onChange={(evento) => setFiltroRol(evento.target.value)}
          className="rounded-[var(--radius-card)] border border-brand-primary-soft px-3 py-2 text-body"
        >
          <option value="">Todos los roles</option>
          {roles.map((rol) => (
            <option key={rol.codigo} value={rol.codigo}>
              {rol.etiqueta}
            </option>
          ))}
        </select>
      </div>

      {cargando && <EsqueletoCarga filas={5} alturaPx={40} />}
      {!cargando && error && <MensajeError mensaje={error} />}
      {!cargando && !error && permisos !== null && permisos.length === 0 && (
        <EstadoVacio titulo="Sin permisos" descripcion="No hay filas de la matriz para este filtro." />
      )}
      {!cargando && !error && permisos !== null && permisos.length > 0 && (
        <div className="overflow-x-auto rounded-[var(--radius-card)] bg-surface-card shadow-[var(--shadow-elevation-1)]">
          <table className="w-full text-body">
            <thead>
              <tr className="border-b border-surface-bg text-left text-label uppercase text-text-secondary">
                <th scope="col" className="px-4 py-3">Rol</th>
                <th scope="col" className="px-4 py-3">Recurso</th>
                <th scope="col" className="px-4 py-3">Operación</th>
                <th scope="col" className="px-4 py-3">Permitido</th>
              </tr>
            </thead>
            <tbody>
              {permisos.map((permiso) => (
                <tr key={`${permiso.rol}-${permiso.recurso}-${permiso.operacion}`} className="border-b border-surface-bg last:border-0">
                  <td className="px-4 py-3 text-text-primary">{nombreDe(rolesMap, permiso.rol)}</td>
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
      )}
    </div>
  )
}
