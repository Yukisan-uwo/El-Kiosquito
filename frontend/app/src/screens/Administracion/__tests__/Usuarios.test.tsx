import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import { Usuarios } from '../Usuarios'
import type { Usuario } from '../tipos'

const apiFetchMock = vi.fn()

vi.mock('@/api/client', async () => {
  const real = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...real, apiFetch: (...args: unknown[]) => apiFetchMock(...args) }
})

const ROLES = [
  { codigo: 'cajero', etiqueta: 'Cajero', nivel_jerarquico: 3, alcance_cadena: false, activo: true },
  { codigo: 'dueno', etiqueta: 'Dueño', nivel_jerarquico: 1, alcance_cadena: true, activo: true },
]
const SUCURSALES = [
  {
    id: 901,
    nombre: 'Sucursal Centro',
    direccion: '',
    responsable_id: null,
    estado: 'operativa',
    fecha_registro: '2026-01-01',
    fecha_activacion: null,
  },
  {
    id: 902,
    nombre: 'Sucursal Norte',
    direccion: '',
    responsable_id: null,
    estado: 'operativa',
    fecha_registro: '2026-01-01',
    fecha_activacion: null,
  },
]
const USUARIO_JUAN: Usuario = { id: 10, nombre: 'Juan Pérez', email: 'juan@test.com', rol: 'cajero', activo: true, sucursal_ids: [901] }

// `extra` guarda FÁBRICAS de promesa (nunca promesas ya creadas) — mismo
// motivo que en `NuevaOrden.test.tsx` de Compras: evita el falso positivo
// "Unhandled Rejection" de vitest cuando el mock rechaza.
function mockRutas(usuarios: Usuario[], extra: Record<string, () => Promise<unknown>> = {}) {
  apiFetchMock.mockImplementation((ruta: string, opciones?: { query?: Record<string, unknown>; method?: string; body?: unknown }) => {
    if (ruta === '/catalogos/roles') return Promise.resolve(ROLES)
    if (ruta === '/sucursales') return Promise.resolve(SUCURSALES)
    if (ruta === '/admin/usuarios' && (!opciones?.method || opciones.method === 'GET')) return Promise.resolve(usuarios)
    if (ruta === '/admin/usuarios' && opciones?.method === 'POST') {
      if (extra['/admin/usuarios:post']) return extra['/admin/usuarios:post']()
      return Promise.resolve({ id: 20, nombre: 'Nueva Persona', email: 'nueva@test.com', rol: 'cajero', activo: true, sucursal_ids: [] })
    }
    if (ruta in extra) return extra[ruta]()
    return Promise.reject(new Error(`Ruta no mockeada en el test: ${ruta}`))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Usuarios', () => {
  it('abre el formulario de rol y sucursales con el sucursal_ids REAL del usuario ya marcado, nunca vacío (RN-AD-002/003)', async () => {
    mockRutas([USUARIO_JUAN])
    render(<Usuarios />)
    const fila = (await screen.findByText('Juan Pérez')).closest('li')
    if (!fila) throw new Error('no debería llegar acá: la fila del usuario debe existir')

    await userEvent.click(within(fila).getByRole('button', { name: 'Rol y sucursales' }))

    expect(within(fila).getByRole('checkbox', { name: 'Sucursal Centro' })).toBeChecked()
    expect(within(fila).getByRole('checkbox', { name: 'Sucursal Norte' })).not.toBeChecked()
  })

  it('guarda el rol y sucursales reemplazando el conjunto completo (PATCH .../rol-sucursales), nunca agregando por separado', async () => {
    const usuarioActualizado: Usuario = { ...USUARIO_JUAN, sucursal_ids: [901, 902] }
    mockRutas([USUARIO_JUAN], { '/admin/usuarios/10/rol-sucursales': () => Promise.resolve(usuarioActualizado) })
    render(<Usuarios />)
    const fila = (await screen.findByText('Juan Pérez')).closest('li')
    if (!fila) throw new Error('no debería llegar acá: la fila del usuario debe existir')

    await userEvent.click(within(fila).getByRole('button', { name: 'Rol y sucursales' }))
    await userEvent.click(within(fila).getByRole('checkbox', { name: 'Sucursal Norte' }))
    await userEvent.click(within(fila).getByRole('button', { name: 'Guardar' }))

    const llamada = apiFetchMock.mock.calls.find(([ruta]) => ruta === '/admin/usuarios/10/rol-sucursales')
    expect(llamada?.[1]).toMatchObject({ method: 'PATCH', body: { rol: 'cajero', sucursal_ids: [901, 902] } })
    expect(await screen.findByText(/2 sucursales asignadas/)).toBeInTheDocument()
  })

  it('oculta las casillas de sucursales cuando el rol elegido tiene alcance de cadena (dueño no necesita sucursales)', async () => {
    mockRutas([USUARIO_JUAN])
    render(<Usuarios />)
    const fila = (await screen.findByText('Juan Pérez')).closest('li')
    if (!fila) throw new Error('no debería llegar acá: la fila del usuario debe existir')

    await userEvent.click(within(fila).getByRole('button', { name: 'Rol y sucursales' }))
    expect(within(fila).getByRole('checkbox', { name: 'Sucursal Centro' })).toBeInTheDocument()

    await userEvent.selectOptions(within(fila).getByLabelText('Rol'), 'dueno')
    expect(within(fila).queryByRole('checkbox', { name: 'Sucursal Centro' })).not.toBeInTheDocument()
  })

  it('registra un usuario nuevo y lo agrega al listado sin volver a pedirlo completo al backend', async () => {
    mockRutas([USUARIO_JUAN])
    render(<Usuarios />)
    await screen.findByText('Juan Pérez')

    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana Torres')
    await userEvent.type(screen.getByLabelText('Email'), 'ana@test.com')
    await userEvent.type(screen.getByLabelText('Contraseña'), 'clave1234')
    await userEvent.click(screen.getByRole('button', { name: 'Registrar usuario' }))

    expect(await screen.findByText('Nueva Persona')).toBeInTheDocument()
  })

  it('desactiva un usuario real y refleja el estado sin volver a pedir la lista completa', async () => {
    mockRutas([USUARIO_JUAN], { '/admin/usuarios/10/desactivar': () => Promise.resolve({ ...USUARIO_JUAN, activo: false }) })
    render(<Usuarios />)
    const fila = (await screen.findByText('Juan Pérez')).closest('li')
    if (!fila) throw new Error('no debería llegar acá: la fila del usuario debe existir')

    await userEvent.click(within(fila).getByRole('button', { name: 'Desactivar' }))
    expect(await within(fila).findByText('Inactivo')).toBeInTheDocument()
  })

  it('muestra el mensaje real del backend si falla la asignación de rol y sucursales', async () => {
    mockRutas([USUARIO_JUAN], {
      '/admin/usuarios/10/rol-sucursales': () => Promise.reject(new ApiError(422, 'Debés asignar al menos una sucursal para este rol')),
    })
    render(<Usuarios />)
    const fila = (await screen.findByText('Juan Pérez')).closest('li')
    if (!fila) throw new Error('no debería llegar acá: la fila del usuario debe existir')

    await userEvent.click(within(fila).getByRole('button', { name: 'Rol y sucursales' }))
    await userEvent.click(within(fila).getByRole('button', { name: 'Guardar' }))
    expect(await within(fila).findByText(/al menos una sucursal/)).toBeInTheDocument()
  })
})
