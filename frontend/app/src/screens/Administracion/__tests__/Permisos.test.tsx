import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Permisos } from '../Permisos'
import type { Operacion, PermisoRol, RecursoSistema, Rol } from '../tipos'

const apiFetchMock = vi.fn()

vi.mock('@/api/client', async () => {
  const real = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...real, apiFetch: (...args: unknown[]) => apiFetchMock(...args) }
})

const ROLES: Rol[] = [
  { codigo: 'dueno', etiqueta: 'Dueño', nivel_jerarquico: 1, alcance_cadena: true, activo: true },
  { codigo: 'cajero', etiqueta: 'Cajero', nivel_jerarquico: 3, alcance_cadena: false, activo: true },
]

const RECURSOS: RecursoSistema[] = [
  { codigo: 'venta', etiqueta: 'Venta POS', modulo: 'core_ventas', es_auditable: true, activo: true },
  { codigo: 'usuario', etiqueta: 'Usuarios', modulo: 'administracion', es_auditable: true, activo: true },
]

const OPERACIONES: Operacion[] = [
  { codigo: 'leer', etiqueta: 'Consultar', es_escritura: false, activo: true },
  { codigo: 'crear', etiqueta: 'Crear', es_escritura: true, activo: true },
]

const PERMISOS_PRUEBA: PermisoRol[] = [
  { rol: 'dueno', recurso: 'usuario', operacion: 'crear', permitido: true },
  { rol: 'dueno', recurso: 'usuario', operacion: 'leer', permitido: true },
  { rol: 'cajero', recurso: 'venta', operacion: 'crear', permitido: true },
  { rol: 'cajero', recurso: 'usuario', operacion: 'crear', permitido: false },
]

function mockRutas() {
  apiFetchMock.mockImplementation((ruta: string) => {
    if (ruta === '/catalogos/roles') return Promise.resolve(ROLES)
    if (ruta === '/catalogos/recursos-sistema') return Promise.resolve(RECURSOS)
    if (ruta === '/catalogos/operaciones') return Promise.resolve(OPERACIONES)
    if (ruta.startsWith('/admin/permisos')) return Promise.resolve(PERMISOS_PRUEBA)
    return Promise.reject(new Error(`Ruta no mockeada: ${ruta}`))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Permisos', () => {
  it('renderiza la matriz de permisos con conteo y etiquetas legibles', async () => {
    mockRutas()
    render(<Permisos />)

    expect(await screen.findByText('Total permisos')).toBeInTheDocument()
    expect(screen.getByText('Venta POS')).toBeInTheDocument()
    expect(screen.getAllByText('Usuarios').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Permitido').length).toBeGreaterThan(0)
    expect(screen.getByText('Denegado')).toBeInTheDocument()
  })

  it('permite filtrar permisos mediante la barra de búsqueda', async () => {
    mockRutas()
    render(<Permisos />)
    await screen.findByText('Venta POS')

    const input = screen.getByPlaceholderText('Buscar por recurso u operación...')
    await userEvent.type(input, 'Venta POS')

    expect(screen.getByText('Venta POS')).toBeInTheDocument()
    expect(screen.queryByText('Denegado')).not.toBeInTheDocument()
  })

  it('permite filtrar por estado permitido o denegado', async () => {
    mockRutas()
    render(<Permisos />)
    await screen.findByText('Venta POS')

    const selectEstado = screen.getByLabelText('Estado')
    await userEvent.selectOptions(selectEstado, 'denegado')

    expect(screen.getByText('Denegado')).toBeInTheDocument()
    expect(screen.queryByText('Venta POS')).not.toBeInTheDocument()
  })
})
