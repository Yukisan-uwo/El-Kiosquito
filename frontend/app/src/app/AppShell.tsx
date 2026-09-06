import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { itemsNavegacionParaRol } from '@/auth/roles'
import { LogoMarca } from '@/components/ui/LogoMarca'
import { fadeUp } from '@/motion/tokens'

const ETIQUETA_ROL: Record<string, string> = {
  dueno: 'Dueño / Gerencia',
  encargado_compras: 'Encargado de Compras',
  encargado_sucursal: 'Encargado de Sucursal',
  cajero: 'Cajero',
}

export function AppShell({ children }: { children: ReactNode }) {
  const { sesion, cerrarSesion } = useAuth()
  if (!sesion) return null

  const items = itemsNavegacionParaRol(sesion.rol)

  return (
    <div className="flex min-h-screen bg-surface-bg">
      <aside className="flex w-64 flex-col bg-brand-deep px-4 py-6 text-white">
        <div className="mb-8 flex items-center gap-2 px-2">
          <LogoMarca tamano={32} />
          <p className="font-display text-title">El Kiosquito</p>
        </div>
        <nav className="flex flex-col gap-1" aria-label="Navegación principal">
          {items.map((item) => (
            <NavLink
              key={item.modulo}
              to={item.ruta}
              className={({ isActive }) =>
                `rounded-[var(--radius-card)] px-3 py-2.5 text-body transition-colors ${
                  isActive
                    ? 'border-l-[3px] border-brand-accent bg-white/10 font-medium'
                    : 'border-l-[3px] border-transparent text-white/80 hover:bg-white/5'
                }`
              }
            >
              {item.etiqueta}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-2 border-t border-white/10 pt-4">
          <p className="px-2 text-body-sm text-white/60">{ETIQUETA_ROL[sesion.rol]}</p>
          <p className="truncate px-2 text-body-sm text-white/60">{sesion.claims.sub}</p>
          <button
            onClick={cerrarSesion}
            className="w-full rounded-[var(--radius-card)] px-3 py-2 text-left text-body text-white/80 hover:bg-white/5"
          >
            Cerrar sesión
          </button>
        </div>
      </aside>
      <motion.main
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        className="flex-1 overflow-y-auto p-8"
      >
        {children}
      </motion.main>
    </div>
  )
}
