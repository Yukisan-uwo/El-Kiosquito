import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import { NuevaOrden } from '../NuevaOrden'

const apiFetchMock = vi.fn()

vi.mock('@/api/client', async () => {
  const real = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...real, apiFetch: (...args: unknown[]) => apiFetchMock(...args) }
})

const PROVEEDORES = [{ id: 1, nombre: 'Distribuidora Andina', contacto: null, activo: true }]
const SUCURSALES = [{ id: 901, nombre: 'Sucursal Centro', direccion: '', responsable_id: null, estado: 'operativa', fecha_registro: '2026-01-01', fecha_activacion: null }]
const FORMAS_PAGO = [
  { codigo: 'contado', etiqueta: 'Contado', dias_plazo_default: 0, activo: true },
  { codigo: 'credito', etiqueta: 'Crédito', dias_plazo_default: 30, activo: true },
]

// Los valores de `extra` son FÁBRICAS de promesa (no promesas ya creadas):
// una promesa rechazada creada de forma anticipada, antes de que algo la
// consuma, dispara un "Unhandled Rejection" real en vitest aunque el
// componente termine capturándola — se crea recién dentro del mock, en el
// mismo tick en que `apiFetch` la devuelve y el código ya la está esperando.
function mockRutasBase(extra: Record<string, () => Promise<unknown>> = {}) {
  apiFetchMock.mockImplementation((ruta: string, opciones?: { query?: Record<string, unknown>; method?: string; body?: unknown }) => {
    if (ruta === '/proveedores') return Promise.resolve(PROVEEDORES)
    if (ruta === '/sucursales') return Promise.resolve(SUCURSALES)
    if (ruta === '/catalogos/formas-pago') return Promise.resolve(FORMAS_PAGO)
    if (ruta === '/productos' && (!opciones?.method || opciones.method === 'GET')) {
      return Promise.resolve([{ id: 5, nombre: 'Leche entera 1L', codigo_barras: null, categoria_nombre: 'Lácteos' }])
    }
    if (ruta === '/compras/ordenes' && opciones?.method === 'POST') {
      if (extra['/compras/ordenes:post']) return extra['/compras/ordenes:post']()
      return Promise.resolve({ id: 55, proveedor_id: 1, sucursal_id: 901, fecha_pedido: '2026-09-06T10:00:00', es_oferta: false, forma_pago: 'contado', estado: 'pendiente', items: [] })
    }
    if (ruta in extra) return extra[ruta]()
    return Promise.reject(new Error(`Ruta no mockeada en el test: ${ruta}`))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('NuevaOrden', () => {
  it('carga proveedores activos, sucursales operativas y formas de pago reales antes de habilitar el formulario', async () => {
    mockRutasBase()
    render(<NuevaOrden onOrdenCreada={vi.fn()} />)
    expect(await screen.findByText('Distribuidora Andina')).toBeInTheDocument()
    expect(screen.getByText('Sucursal Centro')).toBeInTheDocument()
    expect(screen.getByText('Crédito (30 días)')).toBeInTheDocument()
    expect(apiFetchMock).toHaveBeenCalledWith('/sucursales', { query: { estado: 'operativa' } })
  })

  it('no deja buscar productos hasta elegir la sucursal destino', async () => {
    mockRutasBase()
    render(<NuevaOrden onOrdenCreada={vi.fn()} />)
    await screen.findByText('Distribuidora Andina')
    expect(screen.getByText('Elegí primero la sucursal destino para buscar productos.')).toBeInTheDocument()
  })

  it('busca productos por sucursal, agrega un ítem y envía cantidad/precio como NÚMEROS reales, nunca strings ni inventados', async () => {
    mockRutasBase()
    const onOrdenCreada = vi.fn()
    render(<NuevaOrden onOrdenCreada={onOrdenCreada} />)
    await screen.findByText('Distribuidora Andina')

    await userEvent.selectOptions(screen.getByLabelText('Proveedor'), '1')
    await userEvent.selectOptions(screen.getByLabelText('Sucursal destino'), '901')
    await userEvent.type(screen.getByPlaceholderText('Buscar producto por nombre…'), 'leche')

    const resultado = await screen.findByRole('button', { name: /Leche entera 1L/ })
    await userEvent.click(resultado)

    const inputCantidad = screen.getByDisplayValue('1')
    await userEvent.clear(inputCantidad)
    await userEvent.type(inputCantidad, '50')
    const inputPrecio = screen.getByDisplayValue('0')
    await userEvent.clear(inputPrecio)
    await userEvent.type(inputPrecio, '0.35')

    await userEvent.click(screen.getByRole('button', { name: 'Registrar orden de compra' }))

    const llamadaCrear = apiFetchMock.mock.calls.find(([ruta, opciones]) => ruta === '/compras/ordenes' && (opciones as { method?: string })?.method === 'POST')
    expect(llamadaCrear).toBeDefined()
    if (!llamadaCrear) throw new Error('no debería llegar acá: ya se verificó toBeDefined()')
    const body = (llamadaCrear[1] as { body: { items: { producto_id: number; cantidad_pedida: unknown; precio_ofrecido: unknown }[] } }).body
    expect(body.items).toEqual([{ producto_id: 5, cantidad_pedida: 50, precio_ofrecido: 0.35 }])
    expect(typeof body.items[0].cantidad_pedida).toBe('number')
    expect(typeof body.items[0].precio_ofrecido).toBe('number')
    expect(onOrdenCreada).toHaveBeenCalledWith(expect.objectContaining({ id: 55 }))
  })

  it('no deja enviar sin al menos un ítem con cantidad y precio válidos', async () => {
    mockRutasBase()
    render(<NuevaOrden onOrdenCreada={vi.fn()} />)
    await screen.findByText('Distribuidora Andina')
    await userEvent.selectOptions(screen.getByLabelText('Proveedor'), '1')
    await userEvent.selectOptions(screen.getByLabelText('Sucursal destino'), '901')

    expect(screen.getByRole('button', { name: 'Registrar orden de compra' })).toBeDisabled()
  })

  it('muestra el mensaje real del backend si la creación de la orden falla (ej. proveedor desactivado, RF-CP-011)', async () => {
    mockRutasBase({
      '/compras/ordenes:post': () =>
        Promise.reject(new ApiError(400, 'El proveedor está dado de baja — no se pueden crear nuevas órdenes con él (RF-CP-011)')),
    })
    render(<NuevaOrden onOrdenCreada={vi.fn()} />)
    await screen.findByText('Distribuidora Andina')
    await userEvent.selectOptions(screen.getByLabelText('Proveedor'), '1')
    await userEvent.selectOptions(screen.getByLabelText('Sucursal destino'), '901')
    await userEvent.type(screen.getByPlaceholderText('Buscar producto por nombre…'), 'leche')
    await userEvent.click(await screen.findByRole('button', { name: /Leche entera 1L/ }))
    const inputPrecio = screen.getByDisplayValue('0')
    await userEvent.clear(inputPrecio)
    await userEvent.type(inputPrecio, '0.35')

    await userEvent.click(screen.getByRole('button', { name: 'Registrar orden de compra' }))
    expect(await screen.findByText(/dado de baja/)).toBeInTheDocument()
  })
})
