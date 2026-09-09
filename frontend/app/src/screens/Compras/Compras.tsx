import { useState } from 'react'
import { motion } from 'motion/react'
import { useSearchParams } from 'react-router-dom'
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

export function Compras() {
  const [searchParams, setSearchParams] = useSearchParams()
  const seccionParam = searchParams.get('seccion') as Seccion | null
  const seccion: Seccion = seccionParam && PESTANAS.some((p) => p.id === seccionParam) ? seccionParam : 'ordenes'

  const [ordenRecienCreada, setOrdenRecienCreada] = useState<number | null>(null)

  function cambiarSeccion(nueva: Seccion) {
    setSearchParams({ seccion: nueva })
  }

  function manejarOrdenCreada(orden: OrdenCompra) {
    setOrdenRecienCreada(orden.id)
    cambiarSeccion('ordenes')
  }

  return (
    <motion.div variants={fadeUp} initial="hidden" animate="visible" className="space-y-6">
      <div>
        <p className="font-display text-display-lg text-brand-deep">Compras y proveedores</p>
        <p className="mt-1 text-body text-text-secondary">
          Proveedores, órdenes de compra, recepciones y costo real por producto — toda la cadena.
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

      {seccion === 'ordenes' && <Ordenes ordenParaResaltar={ordenRecienCreada} />}
      {seccion === 'nueva-orden' && <NuevaOrden onOrdenCreada={manejarOrdenCreada} />}
      {seccion === 'proveedores' && <Proveedores />}
      {seccion === 'historial-costo' && <HistorialCosto />}
    </motion.div>
  )
}
