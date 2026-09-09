import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '@/api/client'
import { BadgeEstado } from '@/components/ui/BadgeEstado'
import { Boton } from '@/components/ui/Boton'
import { EsqueletoCarga } from '@/components/ui/EsqueletoCarga'
import { EstadoVacio } from '@/components/ui/EstadoVacio'
import { MensajeError } from '@/components/ui/MensajeError'
import { BarraBusqueda } from '@/components/ui/BarraBusqueda'
import { Paginacion } from '@/components/ui/Paginacion'
import { usePaginacion } from '@/components/ui/usePaginacion'
import {
  asignarRolYSucursales,
  crearUsuario,
  desactivarUsuario,
  listarRoles,
  listarSucursales,
  listarUsuarios,
} from './api'
import type { Rol, Sucursal, Usuario } from './tipos'

function nombreDe(mapa: Map<string, string> | undefined, codigo: string): string {
  return mapa?.get(codigo) ?? codigo
}

interface FilaUsuarioProps {
  usuario: Usuario
  roles: Rol[]
  sucursales: Sucursal[]
  rolesMap: Map<string, string>
  onUsuarioActualizado: (usuario: Usuario) => void
}

/**
 * RN-AD-002/003 (enmienda v1.2). El formulario de rol/sucursales arranca
 * SIEMPRE con el `sucursal_ids` real que trae el usuario (nunca vacío) —
 * `PATCH .../rol-sucursales` reemplaza el conjunto completo, así que
 * partir de una lista vacía sin querer termina vaciando el alcance real
 * de alguien. Ver Decisión 8 de `research.md` de 010-administracion.
 */
function FilaUsuario({ usuario, roles, sucursales, rolesMap, onUsuarioActualizado }: FilaUsuarioProps) {
  const [editandoRol, setEditandoRol] = useState(false)
  const [rolElegido, setRolElegido] = useState(usuario.rol)
  const [sucursalesElegidas, setSucursalesElegidas] = useState<number[]>(usuario.sucursal_ids)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [desactivando, setDesactivando] = useState(false)

  const rolInfo = roles.find((r) => r.codigo === rolElegido)
  const requiereSucursales = rolInfo ? !rolInfo.alcance_cadena : false

  function abrirEdicion() {
    setRolElegido(usuario.rol)
    setSucursalesElegidas(usuario.sucursal_ids)
    setError(null)
    setEditandoRol(true)
  }

  function alternarSucursal(id: number) {
    setSucursalesElegidas((actual) => (actual.includes(id) ? actual.filter((s) => s !== id) : [...actual, id]))
  }

  async function guardarRolYSucursales() {
    setGuardando(true)
    setError(null)
    try {
      const actualizado = await asignarRolYSucursales(usuario.id, {
        rol: rolElegido,
        sucursal_ids: requiereSucursales ? sucursalesElegidas : undefined,
      })
      onUsuarioActualizado(actualizado)
      setEditandoRol(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo actualizar el rol y las sucursales.')
    } finally {
      setGuardando(false)
    }
  }

  async function manejarDesactivar() {
    setDesactivando(true)
    setError(null)
    try {
      const actualizado = await desactivarUsuario(usuario.id)
      onUsuarioActualizado(actualizado)
    } catch (err) {
      setError(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo desactivar el usuario.')
    } finally {
      setDesactivando(false)
    }
  }

  return (
    <li className="rounded-2xl border-2 border-amber-200/90 bg-white p-5 shadow-2xs hover:border-amber-300/90 transition-all">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-body font-semibold text-brand-deep">{usuario.nombre}</p>
          <p className="text-body-sm text-text-secondary">
            {usuario.email} · {nombreDe(rolesMap, usuario.rol)}
            {usuario.sucursal_ids.length > 0 &&
              ` · ${usuario.sucursal_ids.length} sucursal${usuario.sucursal_ids.length > 1 ? 'es' : ''} asignada${usuario.sucursal_ids.length > 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BadgeEstado texto={usuario.activo ? 'Activo' : 'Inactivo'} color={usuario.activo ? 'success' : 'danger'} />
          {!editandoRol && (
            <Boton variante="secundario" type="button" onClick={abrirEdicion}>
              Rol y sucursales
            </Boton>
          )}
          {usuario.activo && (
            <Boton variante="peligro" type="button" disabled={desactivando} onClick={manejarDesactivar}>
              {desactivando ? 'Desactivando…' : 'Desactivar'}
            </Boton>
          )}
        </div>
      </div>

      {editandoRol && (
        <div className="mt-4 space-y-3 border-t border-amber-200/60 pt-4">
          <div>
            <label htmlFor={`rol-${usuario.id}`} className="mb-1 block text-label uppercase text-text-secondary font-semibold">
              Rol
            </label>
            <select
              id={`rol-${usuario.id}`}
              value={rolElegido}
              onChange={(evento) => setRolElegido(evento.target.value)}
              className="rounded-xl border-2 border-amber-200/90 bg-white px-3 py-2 text-body focus:border-brand-primary"
            >
              {roles.map((rol) => (
                <option key={rol.codigo} value={rol.codigo}>
                  {rol.etiqueta}
                </option>
              ))}
            </select>
          </div>

          {requiereSucursales && (
            <div>
              <p className="mb-1 text-label uppercase text-text-secondary font-semibold">Sucursales de alcance</p>
              <div className="flex flex-wrap gap-3">
                {sucursales.map((sucursal) => (
                  <label key={sucursal.id} className="flex items-center gap-2 text-body">
                    <input
                      type="checkbox"
                      checked={sucursalesElegidas.includes(sucursal.id)}
                      onChange={() => alternarSucursal(sucursal.id)}
                    />
                    {sucursal.nombre}
                  </label>
                ))}
              </div>
            </div>
          )}

          {error && <MensajeError mensaje={error} />}

          <div className="flex gap-2">
            <Boton
              type="button"
              disabled={guardando || (requiereSucursales && sucursalesElegidas.length === 0)}
              onClick={guardarRolYSucursales}
            >
              {guardando ? 'Guardando…' : 'Guardar'}
            </Boton>
            <Boton variante="secundario" type="button" onClick={() => setEditandoRol(false)}>
              Cancelar
            </Boton>
          </div>
        </div>
      )}
      {!editandoRol && error && <MensajeError mensaje={error} />}
    </li>
  )
}

/**
 * RF-AD-015 (010-administracion, enmienda v1.2). Sin `GET /admin/usuarios`
 * esta pantalla habría sido solo un formulario de alta — ver Decisión 8
 * de `research.md`. Solo visible para `dueno` en la navegación
 * (`auth/roles.ts`), pero cada endpoint sigue validando su propio RBAC.
 */
export function Usuarios() {
  const [roles, setRoles] = useState<Rol[] | null>(null)
  const [sucursales, setSucursales] = useState<Sucursal[] | null>(null)
  const [errorCatalogos, setErrorCatalogos] = useState<string | null>(null)

  const [filtroRol, setFiltroRol] = useState<string>('')
  const [filtroActivo, setFiltroActivo] = useState<'todos' | 'activos' | 'inactivos'>('activos')

  const [usuarios, setUsuarios] = useState<Usuario[] | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mostrarPassword, setMostrarPassword] = useState(false)
  const [rolNuevo, setRolNuevo] = useState('')
  const [creando, setCreando] = useState(false)
  const [errorCreacion, setErrorCreacion] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([listarRoles(), listarSucursales('operativa')])
      .then(([rolesRes, sucursalesRes]) => {
        setRoles(rolesRes)
        setSucursales(sucursalesRes)
        if (rolesRes.length > 0) setRolNuevo(rolesRes[0].codigo)
      })
      .catch((err: unknown) => setErrorCatalogos(err instanceof ApiError ? err.mensajeUsuario : 'No se pudieron cargar los catálogos.'))
  }, [])

  const cargarUsuarios = useCallback(() => {
    setCargando(true)
    setError(null)
    listarUsuarios({
      rol: filtroRol || undefined,
      activo: filtroActivo === 'todos' ? undefined : filtroActivo === 'activos',
    })
      .then(setUsuarios)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.mensajeUsuario : 'No se pudieron cargar los usuarios.'))
      .finally(() => setCargando(false))
  }, [filtroRol, filtroActivo])

  useEffect(() => {
    cargarUsuarios()
  }, [cargarUsuarios])

  function actualizarUsuarioEnLista(actualizado: Usuario) {
    setUsuarios((actual) => actual?.map((u) => (u.id === actualizado.id ? actualizado : u)) ?? actual)
  }

  async function manejarCrear(evento: React.FormEvent) {
    evento.preventDefault()
    if (!nombre.trim()) {
      setErrorCreacion('El nombre del usuario no puede estar vacío.')
      return
    }
    if (!email.trim() || !email.includes('@')) {
      setErrorCreacion('Ingresá un correo electrónico válido.')
      return
    }
    if (password.length < 8) {
      setErrorCreacion('La contraseña debe tener al menos 8 caracteres.')
      return
    }
    setCreando(true)
    setErrorCreacion(null)
    try {
      const usuario = await crearUsuario({ nombre: nombre.trim(), email: email.trim(), password, rol: rolNuevo })
      setUsuarios((actual) => (actual ? [...actual, usuario].sort((a, b) => a.nombre.localeCompare(b.nombre)) : [usuario]))
      setNombre('')
      setEmail('')
      setPassword('')
    } catch (err) {
      setErrorCreacion(err instanceof ApiError ? err.mensajeUsuario : 'No se pudo registrar el usuario.')
    } finally {
      setCreando(false)
    }
  }

  const [busqueda, setBusqueda] = useState('')

  const usuariosList = usuarios ?? []
  const usuariosFiltrados = usuariosList.filter((u) => {
    if (!busqueda.trim()) return true
    const q = busqueda.toLowerCase()
    return u.nombre.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
  })

  const {
    datosPaginados: usuariosPaginados,
    paginaActual,
    totalPaginas,
    itemsPorPagina,
    totalItems,
    cambiarPagina,
    cambiarItemsPorPagina,
  } = usePaginacion(usuariosFiltrados, { itemsPorPaginaInicial: 8 })

  if (errorCatalogos) return <MensajeError mensaje={errorCatalogos} />
  if (!roles || !sucursales) return <EsqueletoCarga filas={4} />

  const rolesMap = new Map(roles.map((r) => [r.codigo, r.etiqueta]))

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border-2 border-amber-200/90 bg-white p-6 shadow-2xs space-y-4">
        <p className="text-title text-brand-deep font-bold">Registrar usuario</p>
        <form onSubmit={manejarCrear} className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="nuevo-nombre" className="mb-1 block text-label uppercase text-text-secondary font-semibold">
              Nombre
            </label>
            <input
              id="nuevo-nombre"
              value={nombre}
              onChange={(evento) => setNombre(evento.target.value)}
              required
              className="rounded-xl border-2 border-amber-200/90 bg-white px-3 py-2 text-body focus:border-brand-primary"
            />
          </div>
          <div>
            <label htmlFor="nuevo-email" className="mb-1 block text-label uppercase text-text-secondary font-semibold">
              Email
            </label>
            <input
              id="nuevo-email"
              type="email"
              value={email}
              onChange={(evento) => setEmail(evento.target.value)}
              required
              className="rounded-xl border-2 border-amber-200/90 bg-white px-3 py-2 text-body focus:border-brand-primary"
            />
          </div>
          <div>
            <label htmlFor="nuevo-password" className="mb-1 block text-label uppercase text-text-secondary font-semibold">
              Contraseña
            </label>
            <div className="relative">
              <input
                id="nuevo-password"
                type={mostrarPassword ? 'text' : 'password'}
                value={password}
                onChange={(evento) => setPassword(evento.target.value)}
                required
                minLength={8}
                className="w-full rounded-xl border-2 border-amber-200/90 bg-white px-3 py-2 pr-9 text-body focus:border-brand-primary"
              />
              <button
                type="button"
                onClick={() => setMostrarPassword((prev) => !prev)}
                aria-label={mostrarPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-text-secondary hover:text-brand-deep focus:outline-none transition-colors"
              >
                {mostrarPassword ? (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                )}
              </button>
            </div>
          </div>
          <div>
            <label htmlFor="nuevo-rol" className="mb-1 block text-label uppercase text-text-secondary font-semibold">
              Rol
            </label>
            <select
              id="nuevo-rol"
              value={rolNuevo}
              onChange={(evento) => setRolNuevo(evento.target.value)}
              className="rounded-xl border-2 border-amber-200/90 bg-white px-3 py-2 text-body focus:border-brand-primary"
            >
              {roles.map((rol) => (
                <option key={rol.codigo} value={rol.codigo}>
                  {rol.etiqueta}
                </option>
              ))}
            </select>
          </div>
          <Boton type="submit" disabled={creando}>
            {creando ? 'Registrando…' : 'Registrar usuario'}
          </Boton>
        </form>
        {errorCreacion && <MensajeError mensaje={errorCreacion} />}
        <p className="mt-2 text-body-sm text-text-secondary">
          Después de registrarlo, asignale rol y sucursales desde su fila en el listado inferior si el rol lo requiere.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="filtro-rol" className="mb-1 block text-label uppercase text-text-secondary font-semibold">
              Rol
            </label>
            <select
              id="filtro-rol"
              value={filtroRol}
              onChange={(evento) => setFiltroRol(evento.target.value)}
              className="rounded-xl border-2 border-amber-200/90 bg-white px-3 py-2 text-body focus:border-brand-primary"
            >
              <option value="">Todos los roles</option>
              {roles.map((rol) => (
                <option key={rol.codigo} value={rol.codigo}>
                  {rol.etiqueta}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            {(['activos', 'inactivos', 'todos'] as const).map((opcion) => (
              <Boton
                key={opcion}
                variante={filtroActivo === opcion ? 'primario' : 'secundario'}
                type="button"
                onClick={() => setFiltroActivo(opcion)}
              >
                {opcion === 'activos' ? 'Activos' : opcion === 'inactivos' ? 'Inactivos' : 'Todos'}
              </Boton>
            ))}
          </div>
        </div>

        <BarraBusqueda
          valor={busqueda}
          onChange={setBusqueda}
          placeholder="Buscar por nombre o email..."
          totalCoincidencias={busqueda.trim() ? usuariosFiltrados.length : undefined}
          className="w-full sm:w-64"
        />
      </div>

      {cargando && <EsqueletoCarga filas={3} alturaPx={72} />}
      {!cargando && error && <MensajeError mensaje={error} onReintentar={cargarUsuarios} />}
      {!cargando && !error && usuarios !== null && usuarios.length === 0 && (
        <EstadoVacio titulo="Sin usuarios" descripcion="No hay usuarios que coincidan con este filtro." />
      )}
      {!cargando && !error && usuarios !== null && usuarios.length > 0 && usuariosFiltrados.length === 0 && (
        <EstadoVacio
          titulo="Sin coincidencias"
          descripcion={`No se encontraron usuarios que coincidan con "${busqueda}".`}
        />
      )}
      {!cargando && !error && usuarios !== null && usuariosFiltrados.length > 0 && (
        <div className="space-y-4">
          <ul className="space-y-3">
            {usuariosPaginados.map((usuario) => (
              <FilaUsuario
                key={usuario.id}
                usuario={usuario}
                roles={roles}
                sucursales={sucursales}
                rolesMap={rolesMap}
                onUsuarioActualizado={actualizarUsuarioEnLista}
              />
            ))}
          </ul>
          <Paginacion
            paginaActual={paginaActual}
            totalPaginas={totalPaginas}
            totalItems={totalItems}
            itemsPorPagina={itemsPorPagina}
            onCambiarPagina={cambiarPagina}
            onCambiarItemsPorPagina={cambiarItemsPorPagina}
            etiquetaItems="usuarios"
          />
        </div>
      )}
    </div>
  )
}
