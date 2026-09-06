import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import { Proveedores } from '../Proveedores'

const apiFetchMock = vi.fn()

vi.mock('@/api/client', async () => {
  const real = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...real, apiFetch: (...args: unknown[]) => apiFetchMock(...args) }
})

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
})

describe('Proveedores', () => {
  it('lista los proveedores activos por defecto (filtro RF-CP-017)', async () => {
    mockRutas({ '/proveedores': [{ id: 1, nombre: 'Distribuidora Andina', contacto: '0991234567', activo: true }] })
    render(<Proveedores />)
    expect(await screen.findByText('Distribuidora Andina')).toBeInTheDocument()
    expect(apiFetchMock).toHaveBeenCalledWith('/proveedores', { query: { activo: true } })
  })

  it('muestra un estado vacío honesto cuando no hay proveedores activos', async () => {
    mockRutas({ '/proveedores': [] })
    render(<Proveedores />)
    expect(await screen.findByText('Sin proveedores activos')).toBeInTheDocument()
  })

  it('cambia a "Todos" y vuelve a pedir el listado sin el filtro activo=true', async () => {
    mockRutas({ '/proveedores': [{ id: 1, nombre: 'Distribuidora Andina', contacto: null, activo: false }] })
    render(<Proveedores />)
    await screen.findByText(/Sin proveedores activos|Distribuidora Andina/)
    apiFetchMock.mockClear()
    mockRutas({ '/proveedores': [{ id: 1, nombre: 'Distribuidora Andina', contacto: null, activo: false }] })

    await userEvent.click(screen.getByRole('button', { name: 'Todos' }))
    expect(await screen.findByText('Distribuidora Andina')).toBeInTheDocument()
    expect(apiFetchMock).toHaveBeenCalledWith('/proveedores', { query: { activo: undefined } })
    expect(await screen.findByText('Inactivo')).toBeInTheDocument()
  })

  it('registra un proveedor nuevo y recarga el listado', async () => {
    const crearMock = vi.fn().mockResolvedValue({ id: 2, nombre: 'Comercial Quevedo', contacto: null, activo: true })
    apiFetchMock.mockImplementation((ruta: string, opciones?: { method?: string }) => {
      if (ruta === '/proveedores' && opciones?.method === 'POST') return crearMock()
      if (ruta === '/proveedores') return Promise.resolve([{ id: 2, nombre: 'Comercial Quevedo', contacto: null, activo: true }])
      return Promise.reject(new Error(`Ruta no mockeada: ${ruta}`))
    })
    render(<Proveedores />)
    await screen.findByText('Sin proveedores activos').catch(() => {})

    await userEvent.type(screen.getByLabelText('Nombre'), 'Comercial Quevedo')
    await userEvent.click(screen.getByRole('button', { name: 'Registrar proveedor' }))

    expect(await screen.findByText('Comercial Quevedo')).toBeInTheDocument()
    expect(crearMock).toHaveBeenCalled()
  })

  it('desactiva un proveedor y refleja el cambio real del backend (nunca lo asume localmente)', async () => {
    let activo = true
    apiFetchMock.mockImplementation((ruta: string, opciones?: { method?: string }) => {
      if (ruta === '/proveedores/1/desactivar' && opciones?.method === 'PATCH') {
        activo = false
        return Promise.resolve({ id: 1, nombre: 'Distribuidora Andina', contacto: null, activo: false })
      }
      if (ruta === '/proveedores') {
        return Promise.resolve([{ id: 1, nombre: 'Distribuidora Andina', contacto: null, activo }])
      }
      return Promise.reject(new Error(`Ruta no mockeada: ${ruta}`))
    })
    render(<Proveedores />)
    await screen.findByText('Activo')

    await userEvent.click(screen.getByRole('button', { name: 'Desactivar' }))
    expect(await screen.findByText('Inactivo')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Desactivar' })).not.toBeInTheDocument()
  })

  it('muestra el mensaje real del backend si falla la carga, con reintento', async () => {
    mockRutas({ '/proveedores': new ApiError(500, 'Error de base de datos') })
    render(<Proveedores />)
    expect(await screen.findByText('Error de base de datos')).toBeInTheDocument()

    mockRutas({ '/proveedores': [{ id: 1, nombre: 'Distribuidora Andina', contacto: null, activo: true }] })
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Distribuidora Andina')).toBeInTheDocument()
  })
})
