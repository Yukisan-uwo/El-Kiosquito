import { describe, expect, it } from 'vitest'
import { calcularTotales } from '../Carrito'
import type { ItemCarrito, ProductoBusqueda } from '../tipos'

function producto(overrides: Partial<ProductoBusqueda> = {}): ProductoBusqueda {
  return {
    id: 1,
    nombre: 'Coca-Cola 500ml',
    codigo_barras: '7501055300012',
    categoria_id: 1,
    categoria_nombre: 'Bebidas',
    unidad_venta_codigo: 'unidad',
    es_fraccionable: false,
    activo: true,
    precio_venta_vigente: 1.5,
    ...overrides,
  }
}

describe('calcularTotales', () => {
  it('calcula subtotal, IVA 15% y total con la misma fórmula que el backend (Art. 4.1)', () => {
    const items: ItemCarrito[] = [{ producto: producto({ precio_venta_vigente: 2 }), cantidad: 3 }]
    const totales = calcularTotales(items, 0)
    expect(totales.subtotal).toBe(6)
    expect(totales.descuento).toBe(0)
    expect(totales.iva).toBe(0.9)
    expect(totales.total).toBe(6.9)
  })

  it('nunca deja que el descuento supere el subtotal, aunque el cajero escriba un valor mayor', () => {
    const items: ItemCarrito[] = [{ producto: producto({ precio_venta_vigente: 5 }), cantidad: 1 }]
    const totales = calcularTotales(items, 999)
    expect(totales.descuento).toBe(5)
    expect(totales.subtotal).toBe(5)
    expect(totales.iva).toBe(0)
    expect(totales.total).toBe(0)
  })

  it('nunca deja que un descuento negativo aumente el total', () => {
    const items: ItemCarrito[] = [{ producto: producto({ precio_venta_vigente: 10 }), cantidad: 1 }]
    const totales = calcularTotales(items, -50)
    expect(totales.descuento).toBe(0)
    expect(totales.total).toBeCloseTo(11.5, 2)
  })

  it('trata un producto sin precio vigente como 0, nunca inventa un precio (Art. 5.9)', () => {
    const items: ItemCarrito[] = [{ producto: producto({ precio_venta_vigente: null }), cantidad: 4 }]
    const totales = calcularTotales(items, 0)
    expect(totales.subtotal).toBe(0)
    expect(totales.total).toBe(0)
  })

  it('suma correctamente varios ítems con cantidades fraccionarias', () => {
    const items: ItemCarrito[] = [
      { producto: producto({ id: 1, precio_venta_vigente: 1.5 }), cantidad: 2 },
      { producto: producto({ id: 2, precio_venta_vigente: 3.2, es_fraccionable: true }), cantidad: 0.5 },
    ]
    const totales = calcularTotales(items, 0)
    expect(totales.subtotal).toBe(4.6)
  })

  it('el carrito vacío da todos los totales en cero', () => {
    const totales = calcularTotales([], 0)
    expect(totales).toEqual({ subtotal: 0, descuento: 0, iva: 0, total: 0 })
  })
})
