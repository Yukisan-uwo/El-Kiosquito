import { render as renderOriginal, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardDueno } from '../DashboardDueno'

function render(ui: React.ReactElement, initialRoute = '/') {
  return renderOriginal(
    <MemoryRouter initialEntries={[initialRoute]}>
      {ui}
    </MemoryRouter>,
  )
}

const SESION_DUENO = {
  token: 'token-dueno',
  claims: { sub: '1', rol: 'dueno', sucursal_ids: [1, 2], exp: 9999999999 },
  rol: 'dueno' as const,
}

vi.mock('@/auth/AuthContext', async () => {
  const real = await vi.importActual<typeof import('@/auth/AuthContext')>('@/auth/AuthContext')
  return {
    ...real,
    useAuth: () => ({ sesion: SESION_DUENO, cargandoSesionInicial: false, iniciarSesion: vi.fn(), cerrarSesion: vi.fn() }),
  }
})

const apiFetchMock = vi.fn()

vi.mock('@/api/client', async () => {
  const real = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...real, apiFetch: (...args: unknown[]) => apiFetchMock(...args) }
})

const GASTOS_EJEMPLO = [
  {
    id: 1,
    sucursal_id: 1,
    concepto: 'Arriendo local comercial',
    categoria_gasto: 'arriendo',
    monto_mensual: '450.00',
    activo: true,
    creado_en: '2026-09-01T10:00:00Z',
    actualizado_en: '2026-09-01T10:00:00Z',
  },
  {
    id: 2,
    sucursal_id: 1,
    concepto: 'Energía y refrigeración 24/7',
    categoria_gasto: 'energia',
    monto_mensual: '160.00',
    activo: true,
    creado_en: '2026-09-01T10:00:00Z',
    actualizado_en: '2026-09-01T10:00:00Z',
  },
]

const SUCURSALES_EJEMPLO = [
  { id: 1, nombre: 'Sucursal Matriz Centro' },
  { id: 2, nombre: 'Sucursal Norte' },
]

const SIMULACION_RESPUESTA = {
  sucursal_id: 1,
  gastos_totales_mensuales: '610.00',
  variacion_aplicada_pct: '0.0',
  punto_equilibrio_ventas: '2440.00',
  margen_promedio_necesario_pct: '25.0',
  utilidad_neta_proyectada: '350.00',
  total_unidades_proyectadas: 1200,
  productos: [
    {
      producto_id: 10,
      nombre: 'Leche Entera 1L',
      clasificacion: 'gancho',
      es_perecedero: true,
      costo_vigente: '0.80',
      precio_actual: '0.95',
      margen_actual_pct: '15.8',
      margen_sugerido_pct: '20.0',
      precio_sugerido: '1.00',
      cuota_gasto_absorbida: '0.13',
      justificacion: 'Producto Gancho perecedero: absorbe costo eléctrico de refrigeración.',
    },
    {
      producto_id: 20,
      nombre: 'Snack Papas 150g',
      clasificacion: 'nicho',
      es_perecedero: false,
      costo_vigente: '0.65',
      precio_actual: '1.00',
      margen_actual_pct: '35.0',
      margen_sugerido_pct: '35.0',
      precio_sugerido: '1.00',
      cuota_gasto_absorbida: '0.23',
      justificacion: 'Producto de Nicho: alta contribución al pago del arriendo.',
    },
  ],
  explicacion_ia: 'Para cubrir los $610.00 de gastos fijos, la sucursal necesita facturar un mínimo de $2440.00.',
}

beforeEach(() => {
  vi.clearAllMocks()
  window.confirm = vi.fn(() => true)
  apiFetchMock.mockImplementation((ruta: string, opciones?: { method?: string; body?: unknown }) => {
    if (ruta === '/sucursales') return Promise.resolve(SUCURSALES_EJEMPLO)
    if (ruta === '/gastos-sucursal') return Promise.resolve(GASTOS_EJEMPLO)
    if (ruta === '/analitica/reportes/margen-por-sucursal') return Promise.resolve([])
    if (ruta === '/analitica/reportes/merma-por-sucursal') return Promise.resolve([])
    if (ruta === '/analitica/reportes/ticket-promedio-por-sucursal') return Promise.resolve([])
    if (ruta === '/gastos-sucursal/simulacion-ia' && opciones?.method === 'POST') {
      return Promise.resolve(SIMULACION_RESPUESTA)
    }
    if (ruta === '/gastos-sucursal/aplicar-simulacion' && opciones?.method === 'POST') {
      return Promise.resolve({ sucursal_id: 1, total_precios_aplicados: 2, mensaje: 'Precios actualizados' })
    }
    return Promise.resolve([])
  })
})

describe('DashboardDueno — Navegación y Pestañas', () => {
  it('inicia en el Resumen Ejecutivo de Red por defecto y muestra los botones de pestañas', async () => {
    render(<DashboardDueno />)
    expect(screen.getByRole('button', { name: /Resumen Ejecutivo de Red/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Gastos del Local y Simulador/i })).toBeInTheDocument()
    expect(await screen.findByText('Margen comercial por sucursal')).toBeInTheDocument()
  })

  it('cambia a la pestaña de Gastos y Simulador de Precios al hacer clic', async () => {
    render(<DashboardDueno />)
    const botonTab = screen.getByRole('button', { name: /Gastos del Local y Simulador/i })
    await userEvent.click(botonTab)

    expect(
      await screen.findByText(/Gastos Fijos del Local y Simulador de Precios \/ Márgenes con IA/i),
    ).toBeInTheDocument()
    expect(screen.queryByText('Margen comercial por sucursal')).not.toBeInTheDocument()
  })
})

describe('DashboardDueno — Sección de Gastos y Simulador de Márgenes con IA', () => {
  it('carga y muestra los gastos fijos del local con sus rubros y montos', async () => {
    render(<DashboardDueno />, '/?tab=simulador')

    expect(await screen.findByText('Arriendo local comercial')).toBeInTheDocument()
    expect(screen.getByText('Energía y refrigeración 24/7')).toBeInTheDocument()
    // Total gastos: 450 + 160 = $610.00
    expect(screen.getByText('$610,00')).toBeInTheDocument()
  })

  it('ejecuta la simulación con IA, muestra el punto de equilibrio y el dictamen explicativo', async () => {
    render(<DashboardDueno />, '/?tab=simulador')

    const botonSimular = await screen.findByRole('button', { name: /Ejecutar simulación de márgenes con IA/i })
    await userEvent.click(botonSimular)

    // Verifica que se calculó el punto de equilibrio ($2440.00)
    expect(await screen.findByText('$2.440,00')).toBeInTheDocument()

    // Verifica el dictamen de IA
    expect(screen.getByText(/Para cubrir los \$610\.00 de gastos fijos/i)).toBeInTheDocument()

    // Verifica la tabla de productos recomendados y justificaciones
    expect(screen.getByText('Leche Entera 1L')).toBeInTheDocument()
    expect(screen.getByText('Snack Papas 150g')).toBeInTheDocument()
    expect(
      screen.getByText(/Producto Gancho perecedero: absorbe costo eléctrico de refrigeración\./i),
    ).toBeInTheDocument()
  })

  it('permite aplicar los precios simulados y muestra el mensaje de confirmación', async () => {
    render(<DashboardDueno />, '/?tab=simulador')

    const botonSimular = await screen.findByRole('button', { name: /Ejecutar simulación de márgenes con IA/i })
    await userEvent.click(botonSimular)

    const botonAplicar = await screen.findByRole('button', { name: /Aplicar precios sugeridos/i })
    await userEvent.click(botonAplicar)

    expect(await screen.findByText(/Precios actualizados/i)).toBeInTheDocument()
  })
})
