import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import { SolicitudesArco } from '../SolicitudesArco'
import type { SolicitudArco } from '../tipos'

const apiFetchMock = vi.fn()

vi.mock('@/api/client', async () => {
  const real = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...real, apiFetch: (...args: unknown[]) => apiFetchMock(...args) }
})

const TIPOS = [{ codigo: 'acceso', etiqueta: 'Acceso', plazo_respuesta_dias: 15, activo: true }]
const ESTADOS = [
  { codigo: 'pendiente', etiqueta: 'Pendiente', es_estado_final: false, activo: true },
  { codigo: 'atendida', etiqueta: 'Atendida', es_estado_final: true, activo: true },
  { codigo: 'rechazada', etiqueta: 'Rechazada', es_estado_final: true, activo: true },
]

// `detalle` y los tres campos de resolución solo existen en la respuesta
// real del backend desde la Decisión 9 (enmienda v1.2) — antes de eso
// `SolicitudArcoOut` no los exponía y esta pantalla no podría mostrarlos.
const SOLICITUD_PENDIENTE: SolicitudArco = {
  id: 1,
  cliente_id: 55,
  tipo: 'acceso',
  detalle: 'Quiero saber qué datos personales tienen registrados de mí',
  estado: 'pendiente',
  fecha_solicitud: '2026-09-01T10:00:00',
  fecha_resolucion: null,
  atendida_por: null,
  respuesta: null,
}

function mockRutas(solicitudes: SolicitudArco[], extra: Record<string, () => Promise<unknown>> = {}) {
  apiFetchMock.mockImplementation((ruta: string, opciones?: { query?: Record<string, unknown>; method?: string; body?: unknown }) => {
    if (ruta === '/catalogos/tipos-solicitud-arco') return Promise.resolve(TIPOS)
    if (ruta === '/catalogos/estados-solicitud-arco') return Promise.resolve(ESTADOS)
    if (ruta === '/admin/arco' && (!opciones?.method || opciones.method === 'GET')) return Promise.resolve(solicitudes)
    if (ruta === '/admin/arco' && opciones?.method === 'POST') {
      if (extra['/admin/arco:post']) return extra['/admin/arco:post']()
      return Promise.resolve({ ...SOLICITUD_PENDIENTE, id: 2 })
    }
    if (ruta === '/clientes') {
      if (extra['/clientes']) return extra['/clientes']()
      return Promise.resolve([{ id: 55, nombre: 'María Gómez', contacto: 'maria@test.com' }])
    }
    if (ruta in extra) return extra[ruta]()
    return Promise.reject(new Error(`Ruta no mockeada en el test: ${ruta}`))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SolicitudesArco', () => {
  it('muestra el detalle real de la solicitud, expuesto recién desde la enmienda v1.2 de SolicitudArcoOut', async () => {
    mockRutas([SOLICITUD_PENDIENTE])
    render(<SolicitudesArco />)
    expect(await screen.findByText('Quiero saber qué datos personales tienen registrados de mí')).toBeInTheDocument()
  })

  it('resuelve una solicitud real, exigiendo respuesta, y muestra los tres campos de resolución que devuelve el backend', async () => {
    const solicitudResuelta: SolicitudArco = {
      ...SOLICITUD_PENDIENTE,
      estado: 'atendida',
      fecha_resolucion: '2026-09-05T12:00:00',
      atendida_por: 3,
      respuesta: 'Te enviamos el detalle por correo',
    }
    mockRutas([SOLICITUD_PENDIENTE], { '/admin/arco/1/resolver': () => Promise.resolve(solicitudResuelta) })
    render(<SolicitudesArco />)
    await screen.findByText(/Quiero saber qué datos/)

    await userEvent.click(screen.getByRole('button', { name: 'Resolver solicitud' }))
    // El selector de resolución (el último combobox — el primero es el
    // filtro "Estado" de arriba) solo debe ofrecer estados finales, nunca
    // "Pendiente".
    const combos = screen.getAllByRole('combobox')
    const selectorResolucion = combos[combos.length - 1]
    expect(within(selectorResolucion).queryByRole('option', { name: 'Pendiente' })).not.toBeInTheDocument()
    await userEvent.selectOptions(selectorResolucion, 'atendida')
    await userEvent.type(screen.getByPlaceholderText('Respuesta para el cliente (obligatoria, Art. 10.3)'), 'Te enviamos el detalle por correo')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar resolución' }))

    const llamada = apiFetchMock.mock.calls.find(([ruta]) => ruta === '/admin/arco/1/resolver')
    expect(llamada?.[1]).toMatchObject({ method: 'PATCH', body: { estado: 'atendida', respuesta: 'Te enviamos el detalle por correo' } })
    expect(await screen.findByText(/usuario #3/)).toBeInTheDocument()
    expect(screen.getByText('Te enviamos el detalle por correo')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resolver solicitud' })).not.toBeInTheDocument()
  })

  it('muestra el mensaje real del backend si falla la resolución', async () => {
    mockRutas([SOLICITUD_PENDIENTE], {
      '/admin/arco/1/resolver': () => Promise.reject(new ApiError(422, 'La respuesta es obligatoria para resolver una solicitud (Art. 10.3)')),
    })
    render(<SolicitudesArco />)
    await screen.findByText(/Quiero saber qué datos/)
    await userEvent.click(screen.getByRole('button', { name: 'Resolver solicitud' }))
    await userEvent.type(screen.getByPlaceholderText('Respuesta para el cliente (obligatoria, Art. 10.3)'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar resolución' }))
    expect(await screen.findByText(/obligatoria para resolver/)).toBeInTheDocument()
  })

  it('busca cliente real con debounce (mínimo 2 caracteres) y registra la solicitud con su cliente_id real, nunca inventado', async () => {
    const crearMock = vi.fn().mockResolvedValue({ ...SOLICITUD_PENDIENTE, id: 9, cliente_id: 55, detalle: 'Quiero que borren mis datos' })
    mockRutas([], {
      '/admin/arco:post': () => crearMock(),
      '/clientes': () => Promise.resolve([{ id: 55, nombre: 'María Gómez', contacto: 'maria@test.com' }]),
    })
    render(<SolicitudesArco />)
    await screen.findByText('Sin solicitudes')

    await userEvent.type(screen.getByPlaceholderText('Buscar cliente por nombre o contacto…'), 'm')
    expect(apiFetchMock).not.toHaveBeenCalledWith('/clientes', expect.anything())

    await userEvent.type(screen.getByPlaceholderText('Buscar cliente por nombre o contacto…'), 'aria')
    const botonCliente = await screen.findByRole('button', { name: 'María Gómez' })
    await userEvent.click(botonCliente)

    await userEvent.type(screen.getByLabelText('Detalle'), 'Quiero que borren mis datos')
    await userEvent.click(screen.getByRole('button', { name: 'Registrar solicitud' }))

    await waitFor(() => expect(crearMock).toHaveBeenCalled())
    const llamada = apiFetchMock.mock.calls.find(([ruta, opciones]) => ruta === '/admin/arco' && (opciones as { method?: string })?.method === 'POST')
    expect(llamada?.[1]).toMatchObject({ body: { cliente_id: 55, tipo: 'acceso', detalle: 'Quiero que borren mis datos' } })
  })
})
