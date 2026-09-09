import { render as renderOriginal, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import { DashboardSucursal } from '../DashboardSucursal'

function render(ui: React.ReactElement, initialRoute = '/sucursal') {
  return renderOriginal(
    <MemoryRouter initialEntries={[initialRoute]}>
      {ui}
    </MemoryRouter>,
  )
}

const formatoMonedaTest = new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' })

const SESION_CON_SUCURSAL = {
  token: 'token-de-prueba',
  claims: { sub: '910', rol: 'encargado_sucursal', sucursal_ids: [901], exp: 9999999999 },
  rol: 'encargado_sucursal' as const,
}

const SESION_SIN_SUCURSAL = {
  token: 'token-de-prueba',
  claims: { sub: '910', rol: 'encargado_sucursal', sucursal_ids: [] as number[], exp: 9999999999 },
  rol: 'encargado_sucursal' as const,
}

// Mutable a propósito: cada test puede apuntarla a una sesión distinta
// (con o sin sucursal asignada) antes de renderizar — `vi.mock` se
// hoistea, así que no puede leer una variable por test directamente,
// pero sí puede leer un objeto mutable en cada llamada a `useAuth`.
let sesionActual: typeof SESION_CON_SUCURSAL | typeof SESION_SIN_SUCURSAL = SESION_CON_SUCURSAL

vi.mock('@/auth/AuthContext', async () => {
  const real = await vi.importActual<typeof import('@/auth/AuthContext')>('@/auth/AuthContext')
  return {
    ...real,
    useAuth: () => ({ sesion: sesionActual, cargandoSesionInicial: false, iniciarSesion: vi.fn(), cerrarSesion: vi.fn() }),
  }
})

const apiFetchMock = vi.fn()

vi.mock('@/api/client', async () => {
  const real = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...real, apiFetch: (...args: unknown[]) => apiFetchMock(...args) }
})

const CATALOGO = [
  { id: 1, nombre: 'Leche entera 1L' },
  { id: 2, nombre: 'Coca-Cola 500ml' },
]

function mockRutas(respuestas: Record<string, unknown>) {
  apiFetchMock.mockImplementation((ruta: string) => {
    if (ruta in respuestas) {
      const valor = respuestas[ruta]
      return valor instanceof Error ? Promise.reject(valor) : Promise.resolve(valor)
    }
    return Promise.reject(new Error(`Ruta no mockeada en el test: ${ruta}`))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  sesionActual = SESION_CON_SUCURSAL
})

describe('DashboardSucursal — acceso', () => {
  it('muestra un estado vacío si el usuario no tiene sucursal asignada, sin llamar a la API', async () => {
    sesionActual = SESION_SIN_SUCURSAL
    render(<DashboardSucursal />)
    expect(await screen.findByText('Tu usuario no tiene sucursal asignada')).toBeInTheDocument()
    expect(apiFetchMock).not.toHaveBeenCalled()
  })
})

describe('DashboardSucursal — mermas', () => {
  it('muestra el estado vacío honesto cuando no hay mermas en el rango (no es un error)', async () => {
    mockRutas({
      '/productos': CATALOGO,
      '/mermas': [],
      '/inventario/stock-bajo': [],
      '/inventario/proximos-a-caducar': [],
      '/inventario/sin-rotacion': [],
    })
    render(<DashboardSucursal />)
    expect(await screen.findByText('Sin mermas en el rango')).toBeInTheDocument()
  })

  it('resuelve el nombre real del producto desde el catálogo y calcula los KPIs sobre datos reales', async () => {
    mockRutas({
      '/productos': CATALOGO,
      // valor_estimado y cantidad viajan como STRING en la API real
      // (Decimal de Pydantic) — se mockean como string a propósito acá:
      // con literales number, este mismo test pasaba igual aunque el
      // componente sumara mal (0 + "3.5" es concatenación de texto, no
      // 3.5), porque nunca ejercitaba esa conversión. Regresión real de
      // la enmienda que corrigió `valorTotal`/`cantidadTotal` para usar
      // `Number(...)` antes de sumar.
      '/mermas': [
        {
          id: 1,
          producto_id: 1,
          sucursal_id: 901,
          cantidad: '2.000',
          valor_estimado: '3.50',
          causa: null,
          resultado_investigacion: null,
          fecha_deteccion: '2026-09-01T10:00:00Z',
          fecha_resultado: null,
        },
        {
          id: 2,
          producto_id: 2,
          sucursal_id: 901,
          cantidad: '1.000',
          valor_estimado: '1.50',
          causa: 'vencimiento',
          resultado_investigacion: null,
          fecha_deteccion: '2026-09-02T10:00:00Z',
          fecha_resultado: null,
        },
      ],
      '/inventario/stock-bajo': [],
      '/inventario/proximos-a-caducar': [],
      '/inventario/sin-rotacion': [],
    })
    render(<DashboardSucursal />)

    expect(await screen.findByText('Leche entera 1L')).toBeInTheDocument()
    expect(await screen.findByText('Coca-Cola 500ml')).toBeInTheDocument()
    // valor perdido total = 3.50 + 1.50 = 5.00 (formateado con el mismo Intl que usa el componente) —
    // con la suma rota (concatenación de string) esto habría dado "$NaN" en vez de este valor.
    expect(await screen.findByText(formatoMonedaTest.format(5))).toBeInTheDocument()
    // 1 de las 2 mermas no tiene causa asignada todavía
    expect(await screen.findByText('Sin investigar')).toBeInTheDocument()
  })

  it('muestra el id del producto (nunca un nombre inventado) si todavía no está en el catálogo', async () => {
    mockRutas({
      '/productos': [],
      '/mermas': [
        {
          id: 9,
          producto_id: 55,
          sucursal_id: 901,
          cantidad: '1.000',
          valor_estimado: '2.00',
          causa: null,
          resultado_investigacion: null,
          fecha_deteccion: '2026-09-01T10:00:00Z',
          fecha_resultado: null,
        },
      ],
      '/inventario/stock-bajo': [],
      '/inventario/proximos-a-caducar': [],
      '/inventario/sin-rotacion': [],
    })
    render(<DashboardSucursal />)
    expect(await screen.findByText('Producto #55')).toBeInTheDocument()
  })

  it('re-consulta mermas con el nuevo rango cuando el encargado aplica el filtro de fechas', async () => {
    mockRutas({
      '/productos': CATALOGO,
      '/mermas': [],
      '/inventario/stock-bajo': [],
      '/inventario/proximos-a-caducar': [],
      '/inventario/sin-rotacion': [],
    })
    render(<DashboardSucursal />)
    await screen.findByText('Sin mermas en el rango')
    apiFetchMock.mockClear()

    await userEvent.clear(screen.getByLabelText('Desde'))
    await userEvent.type(screen.getByLabelText('Desde'), '2026-08-01')
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }))

    await waitFor(() => {
      const llamadaMermas = apiFetchMock.mock.calls.find(([ruta]) => ruta === '/mermas')
      expect(llamadaMermas?.[1]).toMatchObject({ query: expect.objectContaining({ desde: '2026-08-01' }) })
    })
  })

  it('muestra el mensaje de error real del backend y permite reintentar', async () => {
    mockRutas({
      '/productos': CATALOGO,
      '/mermas': new ApiError(500, 'Error de base de datos'),
      '/inventario/stock-bajo': [],
      '/inventario/proximos-a-caducar': [],
      '/inventario/sin-rotacion': [],
    })
    render(<DashboardSucursal />)
    expect(await screen.findByText('Error de base de datos')).toBeInTheDocument()

    mockRutas({
      '/productos': CATALOGO,
      '/mermas': [],
      '/inventario/stock-bajo': [],
      '/inventario/proximos-a-caducar': [],
      '/inventario/sin-rotacion': [],
    })
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Sin mermas en el rango')).toBeInTheDocument()
  })
})

describe('DashboardSucursal — inventario en riesgo', () => {
  it('calcula el déficit de stock bajo el mínimo sobre datos reales', async () => {
    mockRutas({
      '/productos': CATALOGO,
      '/mermas': [],
      '/inventario/stock-bajo': [{ producto_id: 1, cantidad_disponible: '2.000', stock_minimo: '10.000' }],
      '/inventario/proximos-a-caducar': [],
      '/inventario/sin-rotacion': [],
    })
    render(<DashboardSucursal />)
    expect(await screen.findByText('Leche entera 1L')).toBeInTheDocument()
    // déficit = 10 - 2 = 8
    expect(await screen.findByText('8')).toBeInTheDocument()
  })

  it('marca como "Vencido" un lote cuya fecha de caducidad ya pasó', async () => {
    mockRutas({
      '/productos': CATALOGO,
      '/mermas': [],
      '/inventario/stock-bajo': [],
      '/inventario/proximos-a-caducar': [
        { id: 1, producto_id: 2, sucursal_id: 901, fecha_caducidad: '2020-01-01', cantidad_lote: '10.000', cantidad_restante: '3.000' },
      ],
      '/inventario/sin-rotacion': [],
    })
    render(<DashboardSucursal />)
    expect(await screen.findByText('Vencido')).toBeInTheDocument()
  })

  it('muestra el estado vacío honesto de sin-rotación cuando la lista viene vacía', async () => {
    mockRutas({
      '/productos': CATALOGO,
      '/mermas': [],
      '/inventario/stock-bajo': [],
      '/inventario/proximos-a-caducar': [],
      '/inventario/sin-rotacion': [],
    })
    render(<DashboardSucursal />)
    expect(await screen.findByText('Sin productos marcados sin rotación')).toBeInTheDocument()
  })

  it('muestra productos sin rotación con sus días reales sin venta, cada uno en su propia fila', async () => {
    mockRutas({
      '/productos': CATALOGO,
      '/mermas': [],
      '/inventario/stock-bajo': [],
      '/inventario/proximos-a-caducar': [],
      '/inventario/sin-rotacion': [
        { producto_id: 1, sucursal_id: 901, cantidad_disponible: '8.000', stock_minimo: '5.000', dias_sin_venta: 20, marcado_sin_rotacion: true },
        { producto_id: 2, sucursal_id: 901, cantidad_disponible: '15.000', stock_minimo: '5.000', dias_sin_venta: 45, marcado_sin_rotacion: true },
      ],
    })
    render(<DashboardSucursal />)
    const filaLeche = (await screen.findByText('Leche entera 1L')).closest('tr')
    const filaCoca = (await screen.findByText('Coca-Cola 500ml')).closest('tr')
    expect(filaLeche).not.toBeNull()
    expect(filaCoca).not.toBeNull()
    expect(within(filaLeche as HTMLElement).getByText('20')).toBeInTheDocument()
    expect(within(filaCoca as HTMLElement).getByText('45')).toBeInTheDocument()
  })
})

describe('DashboardSucursal — navegación por secciones y pestañas', () => {
  it('filtra y muestra solo la sección de Stock Bajo cuando la URL tiene ?seccion=stock-bajo', async () => {
    mockRutas({
      '/productos': CATALOGO,
      '/mermas': [],
      '/inventario/stock-bajo': [{ producto_id: 1, cantidad_disponible: '2.000', stock_minimo: '10.000' }],
      '/inventario/proximos-a-caducar': [],
      '/inventario/sin-rotacion': [],
    })
    render(<DashboardSucursal />, '/sucursal?seccion=stock-bajo')
    expect(await screen.findByText('Stock bajo el mínimo')).toBeInTheDocument()
    expect(screen.queryByText('Mermas recientes')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stock Bajo' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('permite cambiar a la sección de Mermas al hacer clic en su pestaña', async () => {
    mockRutas({
      '/productos': CATALOGO,
      '/mermas': [],
      '/inventario/stock-bajo': [],
      '/inventario/proximos-a-caducar': [],
      '/inventario/sin-rotacion': [],
    })
    render(<DashboardSucursal />, '/sucursal?seccion=stock-bajo')
    expect(await screen.findByText('Stock bajo el mínimo')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Mermas' }))
    expect(await screen.findByText('Mermas recientes')).toBeInTheDocument()
    expect(screen.queryByText('Stock bajo el mínimo')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mermas' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('DashboardSucursal — lotes e ingreso de stock', () => {
  it('permite abrir el modal de ingreso de stock con lote y registrar un lote perecedero', async () => {
    let llamadoIngreso: unknown = null
    apiFetchMock.mockImplementation((ruta: string, opciones?: { method?: string; body?: unknown }) => {
      if (ruta === '/productos') return Promise.resolve(CATALOGO)
      if (ruta === '/mermas') return Promise.resolve([])
      if (ruta === '/inventario/stock-bajo') return Promise.resolve([])
      if (ruta === '/inventario/proximos-a-caducar') return Promise.resolve([])
      if (ruta === '/inventario/sin-rotacion') return Promise.resolve([])
      if (ruta === '/inventario/ingresos' && opciones?.method === 'POST') {
        llamadoIngreso = opciones.body
        return Promise.resolve({
          producto_id: 1,
          sucursal_id: 901,
          cantidad_disponible: '10.000',
          lote_id: 101,
        })
      }
      return Promise.reject(new Error(`Ruta no mockeada: ${ruta}`))
    })

    render(<DashboardSucursal />, '/sucursal?seccion=lotes')
    const botonIngreso = await screen.findByRole('button', { name: '+ Ingreso de stock / Lote' })
    await userEvent.click(botonIngreso)

    expect(await screen.findByText('Registrar ingreso de stock / Lote')).toBeInTheDocument()

    // Esperar a que el catálogo cargue y el select tenga seleccionado el producto
    const selectProducto = await screen.findByRole('combobox')
    await waitFor(() => expect(selectProducto).toHaveValue('1'))

    const botonGuardar = screen.getByRole('button', { name: 'Registrar ingreso' })
    await userEvent.click(botonGuardar)

    await waitFor(() => {
      expect(llamadoIngreso).toEqual({
        producto_id: 1,
        sucursal_id: 901,
        cantidad: 10,
        fecha_caducidad: expect.any(String),
      })
    })
  })
})

