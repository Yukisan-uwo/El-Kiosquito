import { useState } from 'react'
import { motion } from 'motion/react'
import { fadeUp } from '@/motion/tokens'
import { HistorialCosto } from './HistorialCosto'
import { NuevaOrden } from './NuevaOrden'
import { Ordenes } from './Ordenes'
import { Proveedores } from './Proveedores'
import type { OrdenCompra } from './tipos'

type Seccion = 'ordenes' | 'nueva-orden' | 'proveedores' | 'historial-costo'

const PESTANAS: { id: Seccion; etiqueta: string }[] = [
  { id: 'ordenes', etiqueta: 'Órdenes de compra' },
  { id: 'nueva-orden', etiqueta: 'Nueva orden' },
  { id: 'proveedores', etiqueta: 'Proveedores' },
  { id: 'historial-costo', etiqueta: 'Historial de costo' },
]

/**
 * Pantalla de Compras y Proveedores (Tarea #57), rol Encargado de
 * Compras — el único con `compras_proveedores` en su navegación
 * (`auth/roles.ts`), con alcance de cadena completa (Art. 3.3).
 *
 * Tres huecos reales de backend encontrados y resueltos ANTES de
 * escribir esta pantalla (sin ellos habría sido un formulario de alta
 * sin ningún listado, inutilizable en la práctica): `GET /proveedores`
 * y `GET /compras/ordenes` (008, enmienda v1.3, RF-CP-017/018) y
 * `GET /sucursales` (009, enmienda v1.2, RF-ES-013) — los tres
 * verificados contra la matriz RBAC real antes de escribir código: en
 * los tres casos `leer` ya estaba concedido, ninguno necesitó
 * migración. Mismo patrón ya aplicado en esta sesión a la búsqueda de
 * clientes de 002 (RF-CF-013).
 */
export function Compras() {
  const [seccion, setSeccion] = useState<Seccion>('ordenes')
  const [ordenRecienCreada, setOrdenRecienCreada] = useState<number | null>(null)

  function manejarOrdenCreada(orden: OrdenCompra) {
    setOrdenRecienCreada(orden.id)
    setSeccion('ordenes')
  }

  return (
    <motion.div variants={fadeUp} initial="hidden" animate="visible" className="space-y-6">
      <div>
        <p className="font-display text-display-lg text-brand-deep">Compras y proveedores</p>
        <p className="mt-1 text-body text-text-secondary">
          Proveedores, órdenes de compra, recepciones y costo real por producto — toda la cadena.
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

      {seccion === 'ordenes' && <Ordenes ordenParaResaltar={ordenRecienCreada} />}
      {seccion === 'nueva-orden' && <NuevaOrden onOrdenCreada={manejarOrdenCreada} />}
      {seccion === 'proveedores' && <Proveedores />}
      {seccion === 'historial-costo' && <HistorialCosto />}
    </motion.div>
  )
}
