import { EstadoVacio } from '@/components/ui/EstadoVacio'
import type { ItemCarrito } from './tipos'

const IVA_TASA = 0.15 // Art. 4.1 — misma tasa que aplica POST /ventas en el backend

function formatearMoneda(valor: number): string {
  return new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(valor)
}

/** Redondeo a 2 decimales igual que `_money()` del backend — evita que el
 * total mostrado en pantalla difiera en centavos del que calcula la API. */
function redondear(valor: number): number {
  return Math.round(valor * 100) / 100
}

export interface TotalesVenta {
  subtotal: number
  descuento: number
  iva: number
  total: number
}

export function calcularTotales(items: ItemCarrito[], descuentoIngresado: number): TotalesVenta {
  const subtotal = redondear(items.reduce((acumulado, item) => acumulado + item.cantidad * (item.producto.precio_venta_vigente ?? 0), 0))
  const descuento = redondear(Math.min(Math.max(descuentoIngresado, 0), subtotal))
  const iva = redondear((subtotal - descuento) * IVA_TASA)
  const total = redondear(subtotal - descuento + iva)
  return { subtotal, descuento, iva, total }
}

interface CarritoProps {
  items: ItemCarrito[]
  descuento: number
  onCambiarCantidad: (productoId: number, cantidad: number) => void
  onQuitar: (productoId: number) => void
  onCambiarDescuento: (descuento: number) => void
}

export function Carrito({ items, descuento, onCambiarCantidad, onQuitar, onCambiarDescuento }: CarritoProps) {
  const totales = calcularTotales(items, descuento)

  return (
    <div className="flex h-full flex-col gap-3">
      <p className="text-label uppercase text-text-secondary">Carrito</p>

      {items.length === 0 ? (
        <EstadoVacio titulo="Carrito vacío" descripcion="Buscá un producto y agregalo para empezar la venta." />
      ) : (
        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {items.map((item) => {
            const permiteDecimales = item.producto.es_fraccionable
            const subtotalItem = redondear(item.cantidad * (item.producto.precio_venta_vigente ?? 0))
            return (
              <li
                key={item.producto.id}
                className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] bg-surface-card p-3 shadow-[var(--shadow-elevation-1)]"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium text-text-primary">{item.producto.nombre}</p>
                  <p className="text-body-sm text-text-secondary">
                    {formatearMoneda(item.producto.precio_venta_vigente ?? 0)} · {item.producto.unidad_venta_codigo}
                  </p>
                </div>
                <input
                  type="number"
                  aria-label={`Cantidad de ${item.producto.nombre}`}
                  min={permiteDecimales ? 0.01 : 1}
                  step={permiteDecimales ? 0.01 : 1}
                  value={item.cantidad}
                  onChange={(evento) => {
                    const valor = Number(evento.target.value)
                    if (Number.isFinite(valor) && valor > 0) onCambiarCantidad(item.producto.id, valor)
                  }}
                  className="w-20 rounded-[var(--radius-card)] border border-brand-primary-soft px-2 py-1.5 text-body"
                />
                <span className="w-20 shrink-0 text-right text-body font-medium text-text-primary">
                  {formatearMoneda(subtotalItem)}
                </span>
                <button
                  type="button"
                  aria-label={`Quitar ${item.producto.nombre} del carrito`}
                  onClick={() => onQuitar(item.producto.id)}
                  className="shrink-0 text-body text-status-danger hover:underline"
                >
                  Quitar
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="space-y-1 border-t border-surface-bg pt-3">
        <div className="flex items-center justify-between text-body text-text-secondary">
          <span>Subtotal</span>
          <span>{formatearMoneda(totales.subtotal)}</span>
        </div>
        <div className="flex items-center justify-between text-body text-text-secondary">
          <label htmlFor="descuento-venta">Descuento</label>
          <input
            id="descuento-venta"
            type="number"
            min={0}
            step="0.01"
            value={descuento}
            onChange={(evento) => onCambiarDescuento(Math.max(0, Number(evento.target.value) || 0))}
            className="w-24 rounded-[var(--radius-card)] border border-brand-primary-soft px-2 py-1 text-right text-body"
          />
        </div>
        <div className="flex items-center justify-between text-body text-text-secondary">
          <span>IVA (15%)</span>
          <span>{formatearMoneda(totales.iva)}</span>
        </div>
        <div className="flex items-center justify-between text-title font-medium text-text-primary">
          <span>Total</span>
          <span>{formatearMoneda(totales.total)}</span>
        </div>
      </div>
    </div>
  )
}
