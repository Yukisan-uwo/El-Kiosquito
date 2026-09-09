import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Sucursales } from '../Sucursales'
import type { EstadoApertura, ItemChecklistCatalogo, Sucursal } from '../tipos'

const apiFetchMock = vi.fn()

vi.mock('@/api/client', async () => {
  const real = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...real, apiFetch: (...args: unknown[]) => apiFetchMock(...args) }
})

const SUCURSALES_PRUEBA: Sucursal[] = [
  {
    id: 1,
    nombre: 'El Kiosquito — Centro',
    direccion: 'Av. 7 de Octubre',
    responsable_id: null,
    estado: 'operativa',
    fecha_registro: '2026-01-01T00:00:00Z',
    fecha_activacion: '2026-01-02T00:00:00Z',
  },
  {
    id: 2,
    nombre: 'El Kiosquito — Terminal',
    direccion: 'Av. Walter Andrade',
    responsable_id: null,
    estado: 'en_apertura',
    fecha_registro: '2026-02-01T00:00:00Z',
    fecha_activacion: null,
  },
]

const CATALOGO_ITEMS: ItemChecklistCatalogo[] = [
  { codigo: 'local_fisico', etiqueta: 'Local físico habilitado', orden: 1, es_bloqueante: true, activo: true },
  { codigo: 'catalogo_heredado', etiqueta: 'Catálogo de productos heredado', orden: 2, es_bloqueante: true, activo: true },
]

const ESTADO_APERTURA_TERMINAL: EstadoApertura = {
  sucursal: SUCURSALES_PRUEBA[1],
  checklist: [
    { item: 'local_fisico', completado: false, fecha_completado: null },
    { item: 'catalogo_heredado', completado: true, fecha_completado: '2026-02-02T10:00:00Z' },
  ],
}

function mockRutas(extra: Record<string, () => Promise<unknown>> = {}) {
  apiFetchMock.mockImplementation((ruta: string, opciones?: { method?: string; body?: unknown }) => {
    if (ruta === '/sucursales' && (!opciones?.method || opciones.method === 'GET')) {
      return Promise.resolve(SUCURSALES_PRUEBA)
    }
    if (ruta === '/catalogos/items-checklist-apertura') {
      return Promise.resolve(CATALOGO_ITEMS)
    }
    if (ruta === '/sucursales/2/estado-apertura') {
      return Promise.resolve(ESTADO_APERTURA_TERMINAL)
    }
    if (ruta in extra) return extra[ruta]()
    return Promise.reject(new Error(`Ruta no mockeada: ${ruta}`))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Sucursales', () => {
  it('renderiza la lista de sucursales y sus métricas en cabecera', async () => {
    mockRutas()
    render(<Sucursales />)

    expect(await screen.findByText('El Kiosquito — Centro')).toBeInTheDocument()
    expect(screen.getByText('El Kiosquito — Terminal')).toBeInTheDocument()
    expect(screen.getByText('Av. 7 de Octubre')).toBeInTheDocument()
    expect(screen.getByText('Av. Walter Andrade')).toBeInTheDocument()
  })

  it('permite filtrar sucursales por nombre o dirección usando la barra de búsqueda', async () => {
    mockRutas()
    render(<Sucursales />)
    await screen.findByText('El Kiosquito — Centro')

    const input = screen.getByPlaceholderText('Buscar por nombre, dirección o ID...')
    await userEvent.type(input, 'Terminal')

    expect(screen.getByText('El Kiosquito — Terminal')).toBeInTheDocument()
    expect(screen.queryByText('El Kiosquito — Centro')).not.toBeInTheDocument()
  })

  it('abre el panel de checklist de apertura para una sucursal en_apertura', async () => {
    mockRutas()
    render(<Sucursales />)
    await screen.findByText('El Kiosquito — Terminal')

    const botonChecklist = screen.getByRole('button', { name: 'Checklist de apertura' })
    await userEvent.click(botonChecklist)

    expect(await screen.findByText('Proceso de Apertura')).toBeInTheDocument()
    expect(screen.getByText('Local físico habilitado')).toBeInTheDocument()
  })

  it('permite abrir el formulario de nueva sucursal y registrarla', async () => {
    const nuevaSucursal: Sucursal = {
      id: 3,
      nombre: 'El Kiosquito — La María',
      direccion: 'Calle San Rafael',
      responsable_id: null,
      estado: 'en_apertura',
      fecha_registro: '2026-03-01T00:00:00Z',
      fecha_activacion: null,
    }

    mockRutas({
      '/sucursales': () => Promise.resolve([...SUCURSALES_PRUEBA, nuevaSucursal]),
      '/sucursales/3/estado-apertura': () =>
        Promise.resolve({
          sucursal: nuevaSucursal,
          checklist: [{ item: 'local_fisico', completado: false, fecha_completado: null }],
        }),
    })

    render(<Sucursales />)
    await screen.findByText('El Kiosquito — Centro')

    await userEvent.click(screen.getByRole('button', { name: 'Nueva sucursal' }))

    await userEvent.type(screen.getByLabelText(/Nombre o Identificador/i), 'El Kiosquito — La María')
    await userEvent.type(screen.getByLabelText(/Dirección Completa/i), 'Calle San Rafael')

    apiFetchMock.mockImplementationOnce((ruta, opciones) => {
      if (ruta === '/sucursales' && opciones?.method === 'POST') {
        return Promise.resolve(nuevaSucursal)
      }
      return Promise.reject(new Error(`Unexpected: ${ruta}`))
    })

    await userEvent.click(screen.getByRole('button', { name: 'Guardar e Iniciar Apertura' }))

    const llamada = apiFetchMock.mock.calls.find(([ruta, opts]) => ruta === '/sucursales' && opts?.method === 'POST')
    expect(llamada?.[1]).toMatchObject({
      method: 'POST',
      body: { nombre: 'El Kiosquito — La María', direccion: 'Calle San Rafael' },
    })
  })
})
