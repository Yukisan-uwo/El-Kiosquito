import { motion } from 'motion/react'
import { useSearchParams } from 'react-router-dom'
import { fadeUp } from '@/motion/tokens'
import { Auditoria } from './Auditoria'
import { Parametros } from './Parametros'
import { Permisos } from './Permisos'
import { SolicitudesArco } from './SolicitudesArco'
import { Sucursales } from './Sucursales'
import { Usuarios } from './Usuarios'

type Seccion = 'usuarios' | 'sucursales' | 'permisos' | 'auditoria' | 'parametros' | 'arco'

const PESTANAS: { id: Seccion; etiqueta: string }[] = [
  { id: 'usuarios', etiqueta: 'Usuarios' },
  { id: 'sucursales', etiqueta: 'Sucursales' },
  { id: 'permisos', etiqueta: 'Permisos' },
  { id: 'auditoria', etiqueta: 'Auditoría' },
  { id: 'parametros', etiqueta: 'Parámetros del sistema' },
  { id: 'arco', etiqueta: 'Solicitudes ARCO' },
]

/**
 * Pantalla de Administración (Tarea #58), rol Dueño exclusivo — el único
 * con `administracion` en su navegación (`auth/roles.ts`, MODULOS_POR_ROL),
 * aunque cada endpoint del backend sigue validando su propio RBAC de forma
 * independiente (no solo la navegación del frontend).
 */
export function Administracion() {
  const [searchParams, setSearchParams] = useSearchParams()
  const seccionParam = searchParams.get('seccion') as Seccion | null
  const seccion: Seccion = seccionParam && PESTANAS.some((p) => p.id === seccionParam) ? seccionParam : 'usuarios'

  function cambiarSeccion(nueva: Seccion) {
    setSearchParams({ seccion: nueva })
  }

  return (
    <motion.div variants={fadeUp} initial="hidden" animate="visible" className="space-y-6">
      <div>
        <p className="font-display text-display-lg text-brand-deep">Administración</p>
        <p className="mt-1 text-body text-text-secondary">
          Usuarios, sucursales, permisos, auditoría, parámetros del sistema y solicitudes ARCO — alcance de toda la cadena.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b-2 border-amber-200/80 pb-3">
        {PESTANAS.map((pestana) => (
          <button
            key={pestana.id}
            type="button"
            onClick={() => cambiarSeccion(pestana.id)}
            aria-pressed={seccion === pestana.id}
            className={`rounded-xl px-4 py-2 text-body font-semibold transition-all ${
              seccion === pestana.id
                ? 'bg-brand-primary text-white shadow-2xs'
                : 'border-2 border-amber-200/80 bg-white text-brand-deep hover:bg-amber-50 hover:border-amber-300'
            }`}
          >
            {pestana.etiqueta}
          </button>
        ))}
      </div>

      {seccion === 'usuarios' && <Usuarios />}
      {seccion === 'sucursales' && <Sucursales />}
      {seccion === 'permisos' && <Permisos />}
      {seccion === 'auditoria' && <Auditoria />}
      {seccion === 'parametros' && <Parametros />}
      {seccion === 'arco' && <SolicitudesArco />}
    </motion.div>
  )
}
