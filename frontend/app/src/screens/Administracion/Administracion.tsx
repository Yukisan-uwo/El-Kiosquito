import { useState } from 'react'
import { motion } from 'motion/react'
import { fadeUp } from '@/motion/tokens'
import { Auditoria } from './Auditoria'
import { Parametros } from './Parametros'
import { Permisos } from './Permisos'
import { SolicitudesArco } from './SolicitudesArco'
import { Usuarios } from './Usuarios'

type Seccion = 'usuarios' | 'permisos' | 'auditoria' | 'parametros' | 'arco'

const PESTANAS: { id: Seccion; etiqueta: string }[] = [
  { id: 'usuarios', etiqueta: 'Usuarios' },
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
 *
 * Dos huecos reales de backend encontrados y resueltos ANTES de escribir
 * esta pantalla:
 * - `GET /admin/usuarios` (010, enmienda v1.2, RF-AD-015) — sin él, la
 *   pestaña de Usuarios habría sido solo un formulario de alta sin ningún
 *   listado. Verificado contra la matriz RBAC real antes de escribir
 *   código: `usuario/leer` ya estaba concedido a los roles que lo
 *   necesitan, no hizo falta migración (quinto caso consecutivo de este
 *   patrón en la sesión). El mismo cambio agregó `sucursal_ids` a
 *   `UsuarioOut` (Decisión 8 de `research.md`) para que el formulario de
 *   rol/sucursales de cada fila arranque siempre con el alcance real del
 *   usuario, nunca vacío — `PATCH .../rol-sucursales` reemplaza el
 *   conjunto completo.
 * - `SolicitudArcoOut` incompleto (010, enmienda v1.2, Decisión 9) — le
 *   faltaban `detalle`, `fecha_resolucion`, `atendida_por` y `respuesta`.
 *   A diferencia del punto anterior, esto no fue una decisión de alcance
 *   sino un mapeo de esquema incompleto (mismo tipo de arreglo que el bug
 *   de Decimal-como-string de DashboardSucursal), así que no requirió
 *   aprobación previa del usuario.
 */
export function Administracion() {
  const [seccion, setSeccion] = useState<Seccion>('usuarios')

  return (
    <motion.div variants={fadeUp} initial="hidden" animate="visible" className="space-y-6">
      <div>
        <p className="font-display text-display-lg text-brand-deep">Administración</p>
        <p className="mt-1 text-body text-text-secondary">
          Usuarios, permisos, auditoría, parámetros del sistema y solicitudes ARCO — alcance de toda la cadena.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-surface-bg pb-2">
        {PESTANAS.map((pestana) => (
          <button
            key={pestana.id}
            type="button"
            onClick={() => setSeccion(pestana.id)}
            aria-pressed={seccion === pestana.id}
            className={`rounded-[var(--radius-card)] px-3 py-2 text-body ${
              seccion === pestana.id ? 'bg-brand-primary text-white' : 'text-text-secondary hover:bg-surface-bg'
            }`}
          >
            {pestana.etiqueta}
          </button>
        ))}
      </div>

      {seccion === 'usuarios' && <Usuarios />}
      {seccion === 'permisos' && <Permisos />}
      {seccion === 'auditoria' && <Auditoria />}
      {seccion === 'parametros' && <Parametros />}
      {seccion === 'arco' && <SolicitudesArco />}
    </motion.div>
  )
}
