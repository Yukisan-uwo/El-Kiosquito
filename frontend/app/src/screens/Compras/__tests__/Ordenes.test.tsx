import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import { Ordenes } from '../Ordenes'
import type { OrdenCompra } from '../tipos'

const apiFetchMock = vi.fn()
const formatoMonedaTest = new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' })

vi.mock('@/api/client', async () => {
  const real = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...real, apiFetch: (...args: unknown[]) => apiFetchMock(...args) }
})

const SUCURSALES = [{ id: 901, nombre: 'Sucursal Centro', direccion: '', responsable_id: null, estado: 'operativa', fecha_registro: '2026-01-01', fecha_activacion: null }]
const PROVEEDORES = [{ id: 1, nombre: 'Distribuidora Andina', contacto: null, activo: true }]
const ESTADOS = [
  { codigo: 'pendiente', etiqueta: 'Pendiente', permite_recepcion: true, es_estado_final: false, activo: true },
  { codigo: 'recibida_completa', etiqueta: 'Recibida completa', permite_recepcion: false, es_estado_final: true, activo: true },
]
const PRODUCTOS_SUCURSAL_901 = [
  { id: 5, nombre: 'Leche entera 1L', codigo_barras: null, categoria_nombre: 'Lácteos' },
  { id: 6, nombre: 'Pan integral', codigo_barras: null, categoria_nombre: 'Panadería' },
  { id: 7, nombre: 'Aceite de girasol 1L', codigo_barras: null, categoria_nombre: 'Abarrotes' },
]

// Ítem 501 ya viene "recibido de más" (recibida > pedida) usando cadenas
// Decimal reales que, comparadas como texto, dan el resultado contrario:
// Number('10.000') >= Number('9.000') es true (completa), pero
// '10.000' >= '9.000' como string es false (el '1' pierde contra el '9').
// Si el código volviera a comparar sin `Number(...)`, este ítem mostraría
// incorrectamente el botón "Registrar recepción" pese a estar completo.
const ITEM_COMPLETO_POR_CONVERSION_NUMERICA = {
  id: 501,
  producto_id: 5,
  cantidad_pedida: '9.000',
  cantidad_recibida: '10.000',
  precio_ofrecido: '2.500',
  pronostico_consultado: false,
  motivo_no_siguio_pronostico: null,
}
const ITEM_PENDIENTE_DE_RECEPCION = {
  id: 502,
  producto_id: 6,
  cantidad_pedida: '20.000',
  cantidad_recibida: '0.000',
  precio_ofrecido: '1.750',
  pronostico_consultado: false,
  motivo_no_siguio_pronostico: null,
}

const ORDEN_BASE: OrdenCompra = {
  id: 77,
  proveedor_id: 1,
  sucursal_id: 901,
  fecha_pedido: '2026-09-01T10:00:00',
  es_oferta: false,
  forma_pago: 'contado',
  estado: 'pendiente',
  items: [ITEM_COMPLETO_POR_CONVERSION_NUMERICA, ITEM_PENDIENTE_DE_RECEPCION],
}

const ORDEN_OFERTA: OrdenCompra = {
  id: 88,
  proveedor_id: 1,
  sucursal_id: 901,
  fecha_pedido: '2026-09-02T10:00:00',
  es_oferta: true,
  forma_pago: 'contado',
  estado: 'pendiente',
  items: [
    {
      id: 601,
      producto_id: 7,
      cantidad_pedida: '15.000',
      cantidad_recibida: '0.000',
      precio_ofrecido: '3.000',
      pronostico_consultado: false,
      motivo_no_siguio_pronostico: null,
    },
  ],
}

function mockRutas(ordenes: OrdenCompra[], extra: Record<string, unknown> = {}) {
  apiFetchMock.mockImplementation((ruta: string, opciones?: { method?: string; body?: unknown }) => {
    if (ruta === '/sucursales') return Promise.resolve(SUCURSALES)
    if (ruta === '/proveedores') return Promise.resolve(PROVEEDORES)
    if (ruta === '/catalogos/estados-orden-compra') return Promise.resolve(ESTADOS)
    if (ruta === '/compras/ordenes' && (!opciones?.method || opciones.method === 'GET')) return Promise.resolve(ordenes)
    if (ruta === '/productos') return Promise.resolve(PRODUCTOS_SUCURSAL_901)
    if (ruta in extra) {
      const valor = extra[ruta]
      return valor instanceof Error ? Promise.reject(valor) : Promise.resolve(valor)
    }
    return Promise.reject(new Error(`Ruta no mockeada en el test: ${ruta}`))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Ordenes', () => {
  it('muestra cantidades y precios Decimal reales convertidos con Number(...), y calcula "completa" comparando números, nunca texto', async () => {
    mockRutas([ORDEN_BASE])
    render(<Ordenes />)

    expect(await screen.findByText('Leche entera 1L')).toBeInTheDocument()
    expect(screen.getByText('Pan integral')).toBeInTheDocument()
    expect(screen.getByText('9')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('20')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText(formatoMonedaTest.format(2.5))).toBeInTheDocument()
    expect(screen.getByText(formatoMonedaTest.format(1.75))).toBeInTheDocument()

    // El ítem 501 (9 pedidas, 10 recibidas) está completo -> sin botón de
    // recepción. El ítem 502 (20 pedidas, 0 recibidas) no lo está -> con botón.
    const botonesRecepcion = screen.getAllByRole('button', { name: 'Registrar recepción' })
    expect(botonesRecepcion).toHaveLength(1)
  })

  it('registra una recepción real y refleja la orden actualizada en la lista sin volver a pedirla al backend', async () => {
    const ordenActualizada: OrdenCompra = {
      ...ORDEN_BASE,
      items: [
        ITEM_COMPLETO_POR_CONVERSION_NUMERICA,
        { ...ITEM_PENDIENTE_DE_RECEPCION, cantidad_recibida: '20.000' },
      ],
    }
    mockRutas([ORDEN_BASE], { '/compras/ordenes/502/recepciones': ordenActualizada })
    render(<Ordenes />)
    await screen.findByText('Pan integral')

    await userEvent.click(screen.getByRole('button', { name: 'Registrar recepción' }))
    await userEvent.type(screen.getByPlaceholderText('Cantidad recibida'), '20')
    await userEvent.type(screen.getByPlaceholderText('N° factura/guía (opcional)'), 'FAC-001')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    const llamada = apiFetchMock.mock.calls.find(([ruta]) => ruta === '/compras/ordenes/502/recepciones')
    expect(llamada?.[1]).toMatchObject({
      method: 'POST',
      body: { cantidad_recibida_evento: 20, numero_documento_proveedor: 'FAC-001' },
    })
    // Tras actualizar, el ítem 502 ya está completo (20/20) y su botón desaparece.
    expect(await screen.findByText('20', { selector: 'span' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Registrar recepción' })).not.toBeInTheDocument()
  })

  it('muestra el mensaje real del backend si la recepción falla (RN-CP-001, compra por oferta sin pronóstico/motivo)', async () => {
    mockRutas([ORDEN_BASE], {
      '/compras/ordenes/502/recepciones': new ApiError(422, 'No se puede registrar la recepción: consultá el pronóstico o registrá un motivo (RN-CP-001)'),
    })
    render(<Ordenes />)
    await screen.findByText('Pan integral')

    await userEvent.click(screen.getByRole('button', { name: 'Registrar recepción' }))
    await userEvent.type(screen.getByPlaceholderText('Cantidad recibida'), '20')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(await screen.findByText(/RN-CP-001/)).toBeInTheDocument()
  })

  it('consulta el pronóstico real de una compra por oferta y muestra la cantidad recomendada sin inventarla', async () => {
    mockRutas([ORDEN_OFERTA], {
      '/compras/productos/7/pronostico': { producto_id: 7, datos_suficientes: true, cantidad_recomendada: '12.000' },
    })
    render(<Ordenes />)
    await screen.findByText('Aceite de girasol 1L')

    await userEvent.click(screen.getByRole('button', { name: 'Consultar pronóstico' }))

    expect(await screen.findByText('Recomendado: 12 unidades')).toBeInTheDocument()
    const llamada = apiFetchMock.mock.calls.find(([ruta]) => ruta === '/compras/productos/7/pronostico')
    expect(llamada?.[1]).toMatchObject({ query: { sucursal_id: 901, detalle_id: 601 } })
  })

  it('avisa honestamente cuando el pronóstico no tiene datos suficientes, en vez de inventar una cantidad', async () => {
    mockRutas([ORDEN_OFERTA], {
      '/compras/productos/7/pronostico': { producto_id: 7, datos_suficientes: false, cantidad_recomendada: null },
    })
    render(<Ordenes />)
    await screen.findByText('Aceite de girasol 1L')

    await userEvent.click(screen.getByRole('button', { name: 'Consultar pronóstico' }))
    expect(await screen.findByText('Sin datos suficientes para recomendar una cantidad todavía')).toBeInTheDocument()
  })

  it('registra el motivo real cuando la compra por oferta no siguió el pronóstico', async () => {
    const registrarMotivoMock = vi.fn().mockResolvedValue({ ...ORDEN_OFERTA.items[0], motivo_no_siguio_pronostico: 'Oferta por volumen del proveedor' })
    apiFetchMock.mockImplementation((ruta: string, opciones?: { method?: string; body?: unknown }) => {
      if (ruta === '/sucursales') return Promise.resolve(SUCURSALES)
      if (ruta === '/proveedores') return Promise.resolve(PROVEEDORES)
      if (ruta === '/catalogos/estados-orden-compra') return Promise.resolve(ESTADOS)
      if (ruta === '/compras/ordenes' && (!opciones?.method || opciones.method === 'GET')) return Promise.resolve([ORDEN_OFERTA])
      if (ruta === '/productos') return Promise.resolve(PRODUCTOS_SUCURSAL_901)
      if (ruta === '/compras/ordenes/601/motivo-oferta' && opciones?.method === 'PATCH') return registrarMotivoMock(opciones.body)
      return Promise.reject(new Error(`Ruta no mockeada en el test: ${ruta}`))
    })
    render(<Ordenes />)
    await screen.findByText('Aceite de girasol 1L')

    const inputMotivo = screen.getByPlaceholderText('Motivo si no siguió el pronóstico (mínimo 3 caracteres)')
    await userEvent.type(inputMotivo, 'Oferta por volumen del proveedor')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar motivo' }))

    expect(registrarMotivoMock).toHaveBeenCalledWith({ motivo_no_siguio_pronostico: 'Oferta por volumen del proveedor' })
  })
})
