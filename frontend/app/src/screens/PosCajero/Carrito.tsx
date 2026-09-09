import { useState } from 'react'
import { EstadoVacio } from '@/components/ui/EstadoVacio'
import { ImagenProducto } from './productoImagen'
import type { CuponOut, ItemCarrito } from './tipos'

const IVA_TASA = 0.15

function formatearMoneda(valor: number): string {
  return new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(valor)
}

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
  const subtotal = redondear(
    items.reduce(
      (acumulado, item) =>
        acumulado + item.cantidad * (item.producto.precio_venta_vigente ?? 0),
      0,
    ),
  )
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
  onLimpiar?: () => void
  cuponAplicado?: CuponOut | null
  cuponesCliente?: CuponOut[]
  errorCupon?: string | null
  validandoCupon?: boolean
  onAplicarCupon?: (codigo: string) => Promise<void> | void
  onRemoverCupon?: () => void
}

export function Carrito({
  items,
  descuento,
  onCambiarCantidad,
  onQuitar,
  onCambiarDescuento,
  onLimpiar,
  cuponAplicado,
  cuponesCliente = [],
  errorCupon,
  validandoCupon = false,
  onAplicarCupon,
  onRemoverCupon,
}: CarritoProps) {
  const [codigoInput, setCodigoInput] = useState('')
  const totales = calcularTotales(items, descuento)
  const cantidadTotalArticulos = items.reduce((suma, it) => suma + it.cantidad, 0)

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Encabezado del ticket */}
      <div className="flex items-center justify-between border-b border-surface-bg pb-2.5">
        <div className="flex items-center gap-2">
          <p className="font-display text-title font-semibold text-brand-deep">Ticket actual</p>
          <span className="rounded-full bg-brand-primary-soft/60 px-2 py-0.5 text-label font-bold text-brand-deep">
            {items.length} {items.length === 1 ? 'ítem' : 'ítems'} ({cantidadTotalArticulos})
          </span>
        </div>
        {items.length > 0 && onLimpiar && (
          <button
            type="button"
            onClick={onLimpiar}
            className="flex items-center gap-1 text-body-sm text-text-secondary hover:text-status-danger transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            <span>Limpiar</span>
          </button>
        )}
      </div>

      {/* Lista de productos en el carrito */}
      {items.length === 0 ? (
        <div className="py-6">
          <EstadoVacio
            titulo="Carrito vacío"
            descripcion="Seleccioná un producto del catálogo para empezar la venta."
          />
        </div>
      ) : (
        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {items.map((item) => {
            const permiteDecimales = item.producto.es_fraccionable
            const precioUnitario = item.producto.precio_venta_vigente ?? 0
            const subtotalItem = redondear(item.cantidad * precioUnitario)
            const stockMaximo =
              item.producto.stock_actual !== undefined && item.producto.stock_actual !== null
                ? Number(item.producto.stock_actual)
                : null
            const puedeAumentar = stockMaximo === null || item.cantidad < stockMaximo

            return (
              <li
                key={item.producto.id}
                className="flex items-center justify-between gap-2.5 rounded-xl bg-white p-2.5 shadow-2xs border-2 border-amber-200/80 transition-all hover:border-brand-primary/60"
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-amber-50/70 border border-amber-200/60 p-1 flex items-center justify-center">
                    <ImagenProducto producto={item.producto} tamano="sm" className="h-full w-full" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body-sm font-medium text-text-primary">
                      {item.producto.nombre}
                    </p>
                    <p className="text-label text-text-secondary">
                      {formatearMoneda(precioUnitario)} · {item.producto.unidad_venta_codigo}
                      {stockMaximo !== null && (
                        <span className="ml-1 text-text-secondary/70">
                          (máx: {stockMaximo})
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                {/* Steppers [-] [qty] [+] */}
                <div className="flex items-center rounded-lg border border-amber-300/80 bg-amber-50/50 p-0.5">
                  <button
                    type="button"
                    aria-label={`Disminuir cantidad de ${item.producto.nombre}`}
                    onClick={() => {
                      if (item.cantidad > (permiteDecimales ? 0.05 : 1)) {
                        onCambiarCantidad(item.producto.id, redondear(item.cantidad - (permiteDecimales ? 0.1 : 1)))
                      } else {
                        onQuitar(item.producto.id)
                      }
                    }}
                    className="flex h-6 w-6 items-center justify-center rounded text-body-sm font-bold text-text-secondary hover:bg-white hover:text-text-primary"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={permiteDecimales ? 0.01 : 1}
                    max={stockMaximo ?? undefined}
                    step={permiteDecimales ? '0.1' : '1'}
                    aria-label={`Cantidad de ${item.producto.nombre}`}
                    value={item.cantidad}
                    onChange={(evento) => {
                      const valor = Number(evento.target.value)
                      if (Number.isFinite(valor) && valor > 0) {
                        const valorFinal = stockMaximo !== null ? Math.min(valor, stockMaximo) : valor
                        onCambiarCantidad(item.producto.id, valorFinal)
                      }
                    }}
                    className="w-11 bg-transparent text-center font-mono text-body-sm font-semibold text-text-primary focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <button
                    type="button"
                    aria-label={`Aumentar cantidad de ${item.producto.nombre}`}
                    disabled={!puedeAumentar}
                    onClick={() => {
                      if (puedeAumentar) {
                        const nuevoValor = redondear(item.cantidad + (permiteDecimales ? 0.1 : 1))
                        onCambiarCantidad(
                          item.producto.id,
                          stockMaximo !== null ? Math.min(nuevoValor, stockMaximo) : nuevoValor,
                        )
                      }
                    }}
                    className={`flex h-6 w-6 items-center justify-center rounded text-body-sm font-bold ${
                      puedeAumentar
                        ? 'text-text-secondary hover:bg-white hover:text-text-primary'
                        : 'text-text-secondary/30 cursor-not-allowed'
                    }`}
                  >
                    +
                  </button>
                </div>

                <span className="w-16 shrink-0 text-right font-display text-body-sm font-bold text-brand-deep">
                  {formatearMoneda(subtotalItem)}
                </span>

                <button
                  type="button"
                  aria-label={`Quitar ${item.producto.nombre} del carrito`}
                  onClick={() => onQuitar(item.producto.id)}
                  className="shrink-0 p-1 text-text-secondary hover:text-status-danger transition-colors"
                  title="Quitar"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {/* Sección Cupón de Descuento (Enviado al correo al cliente, Art. 8.4 / RN-PI-001) */}
      <div className="rounded-xl border border-amber-200/90 bg-amber-50/40 p-2.5 space-y-2">
        <div className="flex items-center justify-between gap-1">
          <span className="text-body-xs font-semibold text-brand-deep flex items-center gap-1.5">
            <svg className="h-3.5 w-3.5 text-brand-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
            Cupón de descuento (Correo)
          </span>
          {cuponAplicado && (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
              ACTIVO
            </span>
          )}
        </div>

        {cuponAplicado ? (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-white p-2 border border-emerald-300 shadow-2xs">
            <div className="min-w-0">
              <p className="font-mono text-body-sm font-bold text-emerald-700 truncate">
                {cuponAplicado.codigo}
              </p>
              <p className="text-[11px] text-text-secondary">
                {cuponAplicado.descuento_tipo === 'porcentaje'
                  ? `${cuponAplicado.descuento_valor}% de descuento`
                  : `${formatearMoneda(cuponAplicado.descuento_valor)} de descuento`}
              </p>
            </div>
            {onRemoverCupon && (
              <button
                type="button"
                onClick={onRemoverCupon}
                className="shrink-0 rounded px-2 py-1 text-body-xs font-semibold text-text-secondary hover:bg-red-50 hover:text-status-danger transition-colors"
                title="Quitar cupón"
              >
                ✕ Quitar
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                aria-label="Código de cupón"
                value={codigoInput}
                onChange={(e) => setCodigoInput(e.target.value.toUpperCase())}
                placeholder="Código recibido por correo"
                disabled={validandoCupon}
                className="min-w-0 flex-1 rounded-lg border border-amber-200/90 bg-white px-2.5 py-1 text-body-sm uppercase font-mono tracking-wider text-text-primary placeholder:text-text-secondary/60 placeholder:normal-case placeholder:font-sans focus:border-brand-primary focus:outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    if (onAplicarCupon && codigoInput.trim()) {
                      onAplicarCupon(codigoInput.trim())
                    }
                  }
                }}
              />
              <button
                type="button"
                onClick={() => {
                  if (onAplicarCupon && codigoInput.trim()) {
                    onAplicarCupon(codigoInput.trim())
                  }
                }}
                disabled={validandoCupon || !codigoInput.trim()}
                className="shrink-0 rounded-lg bg-brand-deep px-3 py-1 text-body-sm font-semibold text-white hover:bg-brand-deep/90 disabled:opacity-40 transition-colors"
              >
                {validandoCupon ? '...' : 'Aplicar'}
              </button>
            </div>

            {errorCupon && (
              <p className="text-[11px] text-status-danger font-medium">{errorCupon}</p>
            )}

            {cuponesCliente && cuponesCliente.length > 0 && (
              <div className="pt-1">
                <span className="block text-[11px] font-medium text-text-secondary mb-1">
                  Cupones vigentes del cliente:
                </span>
                <div className="flex flex-wrap gap-1">
                  {cuponesCliente.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onAplicarCupon && onAplicarCupon(c.codigo)}
                      className="rounded-md border border-brand-primary/40 bg-brand-primary-soft/30 px-2 py-0.5 text-body-xs font-mono font-bold text-brand-deep hover:bg-brand-primary-soft/70 transition-colors"
                      title={`Aplicar ${c.codigo}`}
                    >
                      {c.codigo} ({c.descuento_tipo === 'porcentaje' ? `-${c.descuento_valor}%` : `-$${c.descuento_valor}`})
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Desglose financiero y Banner de Total */}
      <div className="space-y-2 border-t border-surface-bg pt-3">
        <div className="flex items-center justify-between text-body-sm text-text-secondary">
          <span>Subtotal</span>
          <span className="font-medium text-text-primary">{formatearMoneda(totales.subtotal)}</span>
        </div>

        <div className="flex items-center justify-between text-body-sm text-text-secondary">
          <label htmlFor="descuento-venta" className="flex items-center gap-1.5">
            <span>Descuento</span>
            {cuponAplicado ? (
              <span className="rounded bg-emerald-100 px-1.5 py-0.2 text-[10px] font-bold text-emerald-800">
                CUPÓN {cuponAplicado.codigo}
              </span>
            ) : descuento > 0 ? (
              <span className="rounded bg-status-success/15 px-1.5 py-0.2 text-[10px] font-bold text-status-success">
                APLICADO
              </span>
            ) : null}
          </label>
          <div className="flex items-center gap-1">
            <span className="text-text-secondary">$</span>
            <input
              id="descuento-venta"
              type="number"
              min={0}
              step="0.01"
              value={descuento || ''}
              placeholder="0.00"
              disabled={Boolean(cuponAplicado)}
              onChange={(evento) =>
                onCambiarDescuento(Math.max(0, Number(evento.target.value) || 0))
              }
              className={`w-20 rounded-xl border-2 border-amber-200/90 bg-white px-2.5 py-1 text-right font-mono text-body-sm shadow-2xs focus:border-brand-primary focus:outline-none ${
                cuponAplicado ? 'bg-amber-50/50 text-text-secondary cursor-not-allowed' : ''
              }`}
            />
          </div>
        </div>

        <div className="flex items-center justify-between text-body-sm text-text-secondary">
          <span>IVA (15%)</span>
          <span className="font-medium text-text-primary">{formatearMoneda(totales.iva)}</span>
        </div>

        {/* Banner destacado TOTAL A COBRAR */}
        <div className="mt-2 flex items-center justify-between rounded-2xl bg-brand-deep px-4 py-3.5 text-white shadow-md border-2 border-brand-deep/90">
          <div>
            <span className="block text-[11px] font-bold uppercase tracking-wider text-white/70">
              TOTAL A COBRAR
            </span>
            <span className="text-body-sm text-white/80">Incluye impuestos</span>
          </div>
          <span className="font-display text-display-sm font-bold tracking-tight text-white">
            {formatearMoneda(totales.total)}
          </span>
        </div>
      </div>
    </div>
  )
}

