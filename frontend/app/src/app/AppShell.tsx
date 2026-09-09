import { motion } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { apiFetch } from '@/api/client'
import { useAuth } from '@/auth/AuthContext'
import { itemsNavegacionParaRol } from '@/auth/roles'
import { LogoMarca } from '@/components/ui/LogoMarca'
import { fadeUp } from '@/motion/tokens'
import { obtenerTurnoActual } from '@/screens/PosCajero/api'

const ETIQUETA_ROL: Record<string, string> = {
  dueno: 'Dueño / Gerencia',
  encargado_compras: 'Encargado de Compras',
  encargado_sucursal: 'Encargado de Sucursal',
  cajero: 'Cajero / Ventas',
}

interface SubItemNavegacion {
  id: string
  etiqueta: string
  ruta: string
}

const SUB_ITEMS_POR_MODULO: Record<string, SubItemNavegacion[]> = {
  pos_cajero: [
    { id: 'pos', etiqueta: 'Punto de Venta', ruta: '/pos' },
    { id: 'ventas', etiqueta: 'Mis ventas del turno', ruta: '/pos?seccion=ventas' },
  ],
  dashboard_sucursal: [
    { id: 'resumen', etiqueta: 'Resumen operativo', ruta: '/sucursal' },
    { id: 'caja-arqueos', etiqueta: 'Control de Caja y Arqueos', ruta: '/sucursal?seccion=caja-arqueos' },
    { id: 'mermas', etiqueta: 'Control de Mermas', ruta: '/sucursal?seccion=mermas' },
    { id: 'stock-bajo', etiqueta: 'Stock Bajo Mínimo', ruta: '/sucursal?seccion=stock-bajo' },
    { id: 'lotes', etiqueta: 'Lotes por Caducar', ruta: '/sucursal?seccion=lotes' },
    { id: 'sin-rotacion', etiqueta: 'Stock Sin Rotación', ruta: '/sucursal?seccion=sin-rotacion' },
  ],
  compras_proveedores: [
    { id: 'ordenes', etiqueta: 'Órdenes de compra', ruta: '/compras?seccion=ordenes' },
    { id: 'nueva-orden', etiqueta: 'Nueva orden', ruta: '/compras?seccion=nueva-orden' },
    { id: 'proveedores', etiqueta: 'Proveedores', ruta: '/compras?seccion=proveedores' },
    { id: 'historial-costo', etiqueta: 'Historial de costo', ruta: '/compras?seccion=historial-costo' },
  ],
  administracion: [
    { id: 'usuarios', etiqueta: 'Usuarios', ruta: '/admin?seccion=usuarios' },
    { id: 'sucursales', etiqueta: 'Sucursales', ruta: '/admin?seccion=sucursales' },
    { id: 'permisos', etiqueta: 'Permisos', ruta: '/admin?seccion=permisos' },
    { id: 'auditoria', etiqueta: 'Auditoría', ruta: '/admin?seccion=auditoria' },
    { id: 'parametros', etiqueta: 'Parámetros del sistema', ruta: '/admin?seccion=parametros' },
    { id: 'arco', etiqueta: 'Solicitudes ARCO', ruta: '/admin?seccion=arco' },
  ],
}

function IconoModulo({ modulo }: { modulo: string }) {
  switch (modulo) {
    case 'dashboard_dueno':
      return (
        <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      )
    case 'pos_cajero':
      return (
        <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      )
    case 'dashboard_sucursal':
      return (
        <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      )
    case 'compras_proveedores':
      return (
        <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M8 4H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-2m-4-1v8m0 0l3-3m-3 3L9 8m-5 5h2.586a1 1 0 01.707.293l2.414 2.414a1 1 0 00.707.293h6.586a1 1 0 00.707-.293l2.414-2.414a1 1 0 01.707-.293H20" />
        </svg>
      )
    case 'administracion':
      return (
        <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      )
    default:
      return (
        <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      )
  }
}

const NOMBRES_SUCURSALES_BASE: Record<number, string> = {
  1: 'El Kiosquito — Centro',
  2: 'El Kiosquito — La María',
  3: 'El Kiosquito — 24 de Mayo',
  4: 'El Kiosquito — San Camilo',
}

export function AppShell({ children }: { children: ReactNode }) {
  const { sesion, cerrarSesion } = useAuth()
  const location = useLocation()
  const [mapaSucursales, setMapaSucursales] = useState<Record<number, string>>(NOMBRES_SUCURSALES_BASE)
  const [turnoActivo, setTurnoActivo] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelado = false
    apiFetch<Array<{ id: number; nombre: string }>>('/sucursales')
      .then((datos) => {
        if (!cancelado && Array.isArray(datos)) {
          const mapa: Record<number, string> = {}
          datos.forEach((s) => {
            if (s.id && s.nombre) mapa[s.id] = s.nombre
          })
          setMapaSucursales((prev) => ({ ...prev, ...mapa }))
        }
      })
      .catch(() => {
        // Silencioso: se preservan los nombres base
      })
    return () => {
      cancelado = true
    }
  }, [])

  useEffect(() => {
    if (sesion?.rol !== 'cajero') return

    let cancelado = false
    const consultarTurno = () => {
      obtenerTurnoActual()
        .then((turno) => {
          if (!cancelado) {
            setTurnoActivo(turno.estado === 'abierto')
          }
        })
        .catch(() => {
          if (!cancelado) {
            setTurnoActivo(false)
          }
        })
    }

    consultarTurno()

    window.addEventListener('turno-caja-actualizado', consultarTurno)
    return () => {
      cancelado = true
      window.removeEventListener('turno-caja-actualizado', consultarTurno)
    }
  }, [sesion?.rol, location.pathname])

  if (!sesion) return null

  const items = itemsNavegacionParaRol(sesion.rol)
  const itemActual = items.find((it) => it.ruta === location.pathname) || items[0]

  const seccionParam = new URLSearchParams(location.search).get('seccion')
  const subItemsActuales = SUB_ITEMS_POR_MODULO[itemActual?.modulo ?? '']
  const subActual = subItemsActuales?.find((s) => s.id === seccionParam) ?? (subItemsActuales ? subItemsActuales[0] : null)

  const sucursales = sesion.claims.sucursal_ids ?? []
  const nombreSucursal = sucursales.length === 1 ? (mapaSucursales[sucursales[0]] || `Sucursal #${sucursales[0]}`) : null
  const alcanceTexto =
    sucursales.length === 0
      ? 'Red completa'
      : sucursales.length === 1
        ? nombreSucursal!
        : `${sucursales.length} sucursales`

  const fechaHoy = new Intl.DateTimeFormat('es-EC', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date())

  const iniciales = (sesion.claims.sub || 'U').slice(0, 2).toUpperCase()

  return (
    <div className="flex min-h-screen bg-surface-bg text-text-primary">
      {/* Sidebar fijo */}
      <aside className="flex w-64 shrink-0 flex-col bg-brand-deep px-4 py-6 text-white shadow-md">
        <div className="mb-6 flex items-center gap-3 px-2">
          <LogoMarca tamano={34} />
          <div>
            <p className="font-display text-title leading-tight tracking-tight text-white">El Kiosquito</p>
            <div className="mt-0.5 flex items-center gap-1.5 text-body-sm text-brand-primary-soft/70">
              <span className="inline-block h-2 w-2 rounded-full bg-status-success animate-pulse" />
              <span>Punto operativo</span>
            </div>
          </div>
        </div>

        {/* Alcance de negocio chip */}
        <div className="mb-6 rounded-[var(--radius-card)] bg-white/5 px-3 py-2 text-body-sm border border-white/10">
          <span className="block text-label uppercase text-brand-primary-soft/60">Alcance de datos</span>
          <span className="font-medium text-white">{alcanceTexto}</span>
        </div>

        {/* Navegación por rol y sub-opciones */}
        <nav className="flex flex-1 flex-col gap-2 overflow-y-auto" aria-label="Navegación principal">
          <span className="px-2 mb-0.5 text-label uppercase tracking-wider text-white/50">Módulos</span>
          {items.map((item) => {
            const subItems = SUB_ITEMS_POR_MODULO[item.modulo] ?? []
            const tieneSubItems = subItems.length > 0
            const estaEnModulo = location.pathname === item.ruta
            // Si es rol de módulo único (ej: Compras) o si está activo el módulo, mostramos las sub-opciones
            const mostrarSubItems = tieneSubItems && (items.length === 1 || estaEnModulo)

            return (
              <div key={item.modulo} className="flex flex-col gap-1">
                <NavLink
                  to={item.ruta}
                  className={({ isActive }) =>
                    `group flex items-center justify-between rounded-[var(--radius-card)] px-3 py-2.5 text-body transition-all ${
                      isActive
                        ? 'border-l-[3px] border-brand-accent bg-white/15 font-medium text-white shadow-2xs'
                        : 'border-l-[3px] border-transparent text-white/80 hover:bg-white/10 hover:text-white'
                    }`
                  }
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-white/80 group-hover:text-white transition-colors">
                      <IconoModulo modulo={item.modulo} />
                    </span>
                    <span className="truncate">{item.etiqueta}</span>
                  </div>
                  {tieneSubItems && (
                    <span className="text-white/40 text-label font-mono px-1">
                      {subItems.length}
                    </span>
                  )}
                </NavLink>

                {mostrarSubItems && (
                  <div className="ml-5 flex flex-col gap-1 border-l border-white/15 pl-2.5 py-1">
                    {subItems.map((sub) => {
                      const esActivo = estaEnModulo && (seccionParam ? seccionParam === sub.id : sub.id === subItems[0].id)
                      return (
                        <Link
                          key={sub.id}
                          to={sub.ruta}
                          className={`flex items-center gap-2 rounded-[var(--radius-card)] px-2.5 py-1.5 text-body-sm transition-colors ${
                            esActivo
                              ? 'bg-white/20 font-medium text-white shadow-2xs'
                              : 'text-white/65 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${esActivo ? 'bg-brand-accent' : 'bg-white/30'}`} />
                          <span className="truncate">{sub.etiqueta}</span>
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </nav>

        {/* Tarjeta de usuario al pie */}
        <div className="mt-auto pt-4 border-t border-white/10">
          {sesion.rol === 'cajero' && (
            <div
              className={`mb-3 rounded-[var(--radius-card)] bg-white/5 border ${
                turnoActivo ? 'border-status-success/30' : 'border-white/15'
              } p-3 text-white shadow-2xs transition-colors`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`h-2 w-2 rounded-full ${
                    turnoActivo ? 'bg-status-success animate-pulse' : 'bg-white/40'
                  }`}
                />
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider ${
                    turnoActivo ? 'text-status-success' : 'text-white/60'
                  }`}
                >
                  {turnoActivo ? 'TURNO ABIERTO' : 'TURNO CERRADO'}
                </span>
              </div>
              <p className="text-body-sm font-semibold text-white truncate">Caja 01 · {alcanceTexto}</p>
            </div>
          )}

          <div className="mb-3 flex items-center gap-3 rounded-xl bg-white/5 p-2.5 border border-white/10 hover:bg-white/10 transition-colors">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-primary font-display font-semibold text-white shadow-2xs">
              {iniciales}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-body-sm font-semibold text-white">{ETIQUETA_ROL[sesion.rol] ?? 'Usuario'}</p>
              <div className="mt-0.5 flex items-center gap-1.5 text-label text-brand-primary-soft/70">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-status-success animate-pulse" />
                <span>Sesión activa</span>
              </div>
            </div>
          </div>

          <button
            onClick={cerrarSesion}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 px-3 py-2 text-body-sm font-medium text-white/80 transition-colors hover:bg-status-danger/20 hover:border-status-danger hover:text-white"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span>Cerrar sesión</span>
          </button>
        </div>
      </aside>

      {/* Contenido principal con Header superior */}
      <div className="flex flex-1 flex-col min-w-0">
        <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center justify-between border-b-2 border-amber-200/80 bg-white/95 px-8 backdrop-blur-md shadow-2xs">
          <div className="flex items-center gap-2 text-body-sm">
            <span className="text-text-secondary">El Kiosquito</span>
            <span className="text-text-secondary">/</span>
            <span className={subActual && location.pathname === itemActual?.ruta ? "text-text-secondary" : "font-semibold text-brand-deep"}>
              {itemActual?.etiqueta}
            </span>
            {subActual && location.pathname === itemActual?.ruta && (
              <>
                <span className="text-text-secondary">/</span>
                <span className="font-semibold text-brand-deep">{subActual.etiqueta}</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1 text-body-sm text-text-secondary border-2 border-amber-200/80 shadow-2xs">
              <svg className="h-4 w-4 text-brand-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="capitalize font-medium">{fechaHoy}</span>
            </div>

            <div className="flex items-center gap-1.5 rounded-full bg-amber-50 px-3.5 py-1 text-body-sm font-semibold text-brand-deep border-2 border-amber-200/90 shadow-2xs">
              <span className="h-2 w-2 rounded-full bg-brand-primary" />
              <span>{alcanceTexto}</span>
            </div>
          </div>
        </header>

        <motion.main
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          className="flex-1 overflow-y-auto p-6 lg:p-8"
        >
          {children}
        </motion.main>
      </div>
    </div>
  )
}
