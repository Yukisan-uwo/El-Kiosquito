import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import { PosCajero } from '../PosCajero'
import type { MetodoPago, ProductoBusqueda, TurnoCaja, VentaOut } from '../tipos'

const sesionMock = {
  token: 'token-de-prueba',
  claims: { sub: '902', rol: 'cajero', sucursal_ids: [901], exp: 9999999999 },
  rol: 'cajero' as const,
}

vi.mock('@/auth/AuthContext', async () => {
  const real = await vi.importActual<typeof import('@/auth/AuthContext')>('@/auth/AuthContext')
  return { ...real, useAuth: () => ({ sesion: sesionMock, cargandoSesionInicial: false, iniciarSesion: vi.fn(), cerrarSesion: vi.fn() }) }
})

const obtenerTurnoActualMock = vi.fn()
const abrirTurnoMock = vi.fn()
const cerrarTurnoMock = vi.fn()
const buscarProductosMock = vi.fn()
const listarMetodosPagoMock = vi.fn()
const listarDatafonosDisponiblesMock = vi.fn()
const consultarPoliticaPrivacidadMock = vi.fn()
const buscarClientesMock = vi.fn()
const crearClienteMock = vi.fn()
const crearVentaMock = vi.fn()
const listarVentasTurnoMock = vi.fn()
const validarCuponMock = vi.fn()
const consultarCuponesClienteMock = vi.fn()
const canjearCuponMock = vi.fn()

vi.mock('../api', () => ({
  obtenerTurnoActual: (...args: unknown[]) => obtenerTurnoActualMock(...args),
  abrirTurno: (...args: unknown[]) => abrirTurnoMock(...args),
  cerrarTurno: (...args: unknown[]) => cerrarTurnoMock(...args),
  buscarProductos: (...args: unknown[]) => buscarProductosMock(...args),
  listarMetodosPago: (...args: unknown[]) => listarMetodosPagoMock(...args),
  listarDatafonosDisponibles: (...args: unknown[]) => listarDatafonosDisponiblesMock(...args),
  consultarPoliticaPrivacidad: (...args: unknown[]) => consultarPoliticaPrivacidadMock(...args),
  buscarClientes: (...args: unknown[]) => buscarClientesMock(...args),
  crearCliente: (...args: unknown[]) => crearClienteMock(...args),
  crearVenta: (...args: unknown[]) => crearVentaMock(...args),
  listarVentasTurno: (...args: unknown[]) => listarVentasTurnoMock(...args),
  validarCupon: (...args: unknown[]) => validarCuponMock(...args),
  consultarCuponesCliente: (...args: unknown[]) => consultarCuponesClienteMock(...args),
  canjearCupon: (...args: unknown[]) => canjearCuponMock(...args),
}))

const TURNO_ABIERTO: TurnoCaja = {
  id: 501,
  sucursal_id: 901,
  cajero_id: 902,
  hora_apertura: '2026-09-06T13:00:00Z',
  monto_inicial: 20,
  hora_cierre: null,
  monto_contado: null,
  monto_esperado: null,
  diferencia: null,
  motivo_diferencia: null,
  estado: 'abierto',
}

const METODOS_PAGO: MetodoPago[] = [
  { codigo: 'efectivo', etiqueta: 'Efectivo', es_electronico: false, orden: 1 },
  { codigo: 'tarjeta', etiqueta: 'Tarjeta', es_electronico: true, orden: 2 },
  { codigo: 'electronico', etiqueta: 'Pago electrónico', es_electronico: true, orden: 3 },
]

const PRODUCTO: ProductoBusqueda = {
  id: 77,
  nombre: 'Leche entera 1L',
  codigo_barras: '7861234500019',
  categoria_id: 3,
  categoria_nombre: 'Lácteos',
  unidad_venta_codigo: 'unidad',
  es_fraccionable: false,
  activo: true,
  precio_venta_vigente: 1.25,
}

beforeEach(() => {
  vi.clearAllMocks()
  listarMetodosPagoMock.mockResolvedValue(METODOS_PAGO)
  listarDatafonosDisponiblesMock.mockResolvedValue([])
  buscarProductosMock.mockResolvedValue([PRODUCTO])
  listarVentasTurnoMock.mockResolvedValue([])
  validarCuponMock.mockResolvedValue(null)
  consultarCuponesClienteMock.mockResolvedValue([])
  canjearCuponMock.mockResolvedValue(null)
})

/** Busca "leche" (dispara el debounce real de BusquedaProductos) y agrega
 * el primer resultado al carrito — evita repetir estos 3 pasos en cada test. */
async function agregarLecheAlCarrito() {
  await userEvent.type(screen.getByLabelText('Buscar producto (nombre o código de barras)'), 'leche')
  await userEvent.click(await screen.findByRole('button', { name: 'Agregar' }))
}

describe('PosCajero — puerta del turno de caja', () => {
  it('muestra "abrir turno" cuando GET /caja/turnos/actual devuelve 404 (RF-CMF-018)', async () => {
    obtenerTurnoActualMock.mockRejectedValue(new ApiError(404, 'No hay turno abierto'))
    render(<PosCajero />)
    expect(await screen.findByText('Abrir turno de caja')).toBeInTheDocument()
  })

  it('muestra directamente el POS cuando ya hay un turno abierto (200)', async () => {
    obtenerTurnoActualMock.mockResolvedValue(TURNO_ABIERTO)
    render(<PosCajero />)
    expect(await screen.findByText('Punto de venta')).toBeInTheDocument()
    expect(screen.getByLabelText('Buscar producto (nombre o código de barras)')).toBeInTheDocument()
  })

  it('muestra un error con reintentar si la consulta del turno falla por algo distinto de 404', async () => {
    obtenerTurnoActualMock.mockRejectedValueOnce(new ApiError(500, 'boom'))
    render(<PosCajero />)
    expect(await screen.findByText('boom')).toBeInTheDocument()

    obtenerTurnoActualMock.mockResolvedValueOnce(TURNO_ABIERTO)
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Punto de venta')).toBeInTheDocument()
  })

  it('abrir turno real llama a POST /caja/turnos con el monto ingresado y pasa al POS', async () => {
    obtenerTurnoActualMock.mockRejectedValue(new ApiError(404, 'No hay turno abierto'))
    abrirTurnoMock.mockResolvedValue(TURNO_ABIERTO)
    render(<PosCajero />)

    await screen.findByText('Abrir turno de caja')
    await userEvent.type(screen.getByLabelText('Monto inicial en caja'), '20')
    await userEvent.click(screen.getByRole('button', { name: 'Abrir turno' }))

    await waitFor(() => expect(abrirTurnoMock).toHaveBeenCalledWith(901, 20))
    expect(await screen.findByText('Punto de venta')).toBeInTheDocument()
  })
})

describe('PosCajero — venta completa con turno abierto', () => {
  beforeEach(() => {
    obtenerTurnoActualMock.mockResolvedValue(TURNO_ABIERTO)
  })

  it('nunca ofrece "Pago electrónico" como opción, aunque el catálogo backend lo incluya', async () => {
    render(<PosCajero />)
    await screen.findByText('Método de pago')
    expect(await screen.findByRole('button', { name: 'Efectivo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tarjeta' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pago electrónico' })).not.toBeInTheDocument()
  })

  it('busca, agrega al carrito y cobra en efectivo con el payload real esperado por POST /ventas', async () => {
    crearVentaMock.mockResolvedValue({
      id: 9001,
      numero_documento: 'FAC-0009001',
      sucursal_id: 901,
      turno_caja_id: 501,
      total: 1.44,
      metodo_pago: 'efectivo',
      estado_venta: 'completada',
      datafono_id: null,
    } satisfies VentaOut)

    render(<PosCajero />)
    await screen.findByText('Punto de venta')

    await userEvent.type(screen.getByLabelText('Buscar producto (nombre o código de barras)'), 'leche')
    await waitFor(() => expect(buscarProductosMock).toHaveBeenCalledWith(901, { q: 'leche', codigoBarras: undefined }))

    await userEvent.click(await screen.findByRole('button', { name: 'Agregar' }))
    // "Leche entera 1L" aparece tanto en el resultado de búsqueda como en el
    // carrito — se verifica el carrito por el input de cantidad, único por ítem.
    expect(await screen.findByLabelText('Cantidad de Leche entera 1L')).toBeInTheDocument()

    await userEvent.click(await screen.findByRole('button', { name: 'Efectivo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cobrar' }))

    await waitFor(() =>
      expect(crearVentaMock).toHaveBeenCalledWith({
        turno_caja_id: 501,
        cliente_id: null,
        items: [{ producto_id: 77, cantidad_venta: 1 }],
        metodo_pago: 'efectivo',
        descuento_aplicado: 0,
        datafono_id: null,
      }),
    )
    expect(await screen.findByText('Venta FAC-0009001 registrada')).toBeInTheDocument()
  })

  it('con método tarjeta y datáfonos activos, exige elegir uno antes de habilitar "Cobrar"', async () => {
    listarDatafonosDisponiblesMock.mockResolvedValue([{ id: 6, codigo_serie: 'DF-001' }])
    render(<PosCajero />)
    await screen.findByText('Punto de venta')

    await agregarLecheAlCarrito()
    await userEvent.click(await screen.findByRole('button', { name: 'Tarjeta' }))

    const selectDatafono = await screen.findByLabelText('Datáfono usado para cobrar')
    expect(screen.getByRole('button', { name: 'Cobrar' })).toBeDisabled()

    await userEvent.selectOptions(selectDatafono, '6')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cobrar' })).toBeEnabled())

    crearVentaMock.mockResolvedValue({
      id: 1, numero_documento: 'F1', sucursal_id: 901, turno_caja_id: 501, total: 1.44,
      metodo_pago: 'tarjeta', estado_venta: 'completada', datafono_id: 6,
    } satisfies VentaOut)
    await userEvent.click(screen.getByRole('button', { name: 'Cobrar' }))
    await waitFor(() => expect(crearVentaMock).toHaveBeenCalledWith(expect.objectContaining({ metodo_pago: 'tarjeta', datafono_id: 6 })))
  })

  it('no cobra un cliente nuevo sin marcar la aceptación de la política de privacidad (Art. 10.4 LOPDP)', async () => {
    consultarPoliticaPrivacidadMock.mockResolvedValue({
      version: '1.0',
      vigente_desde: '2026-09-05',
      contenido: 'Texto real de la política.',
      punto_contacto: 'privacidad@elkiosquito.local',
    })
    render(<PosCajero />)
    await screen.findByText('Punto de venta')

    await agregarLecheAlCarrito()
    await userEvent.click(screen.getByRole('button', { name: 'Registrar cliente nuevo' }))
    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana Pérez')
    await screen.findByText('Texto real de la política.') // se cargó la política real, no un texto estático

    await userEvent.click(await screen.findByRole('button', { name: 'Efectivo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cobrar' }))

    expect(await screen.findByText(/aceptación de la política de privacidad/)).toBeInTheDocument()
    expect(crearClienteMock).not.toHaveBeenCalled()
    expect(crearVentaMock).not.toHaveBeenCalled()
  })

  it('registra el cliente nuevo con el consentimiento real antes de crear la venta', async () => {
    consultarPoliticaPrivacidadMock.mockResolvedValue({
      version: '1.0', vigente_desde: '2026-09-05', contenido: 'Texto real.', punto_contacto: 'privacidad@elkiosquito.local',
    })
    crearClienteMock.mockResolvedValue({
      id: 55, nombre: 'Ana Pérez', contacto: null, fecha_nacimiento: null,
      creado_en: '2026-09-06T00:00:00Z', consentimiento_privacidad_en: '2026-09-06T00:00:00Z', version_politica_privacidad: '1.0',
    })
    crearVentaMock.mockResolvedValue({
      id: 2, numero_documento: 'F2', sucursal_id: 901, turno_caja_id: 501, total: 1.44,
      metodo_pago: 'efectivo', estado_venta: 'completada', datafono_id: null,
    } satisfies VentaOut)

    render(<PosCajero />)
    await screen.findByText('Punto de venta')
    await agregarLecheAlCarrito()
    await userEvent.click(screen.getByRole('button', { name: 'Registrar cliente nuevo' }))
    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana Pérez')
    await screen.findByText('Texto real.')
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(await screen.findByRole('button', { name: 'Efectivo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cobrar' }))

    await waitFor(() =>
      expect(crearClienteMock).toHaveBeenCalledWith(
        expect.objectContaining({ nombre: 'Ana Pérez', acepto_politica_privacidad: true }),
      ),
    )
    await waitFor(() => expect(crearVentaMock).toHaveBeenCalledWith(expect.objectContaining({ cliente_id: 55 })))
  })

  it('no cobra en modo "cliente existente" hasta elegir uno de los resultados de la búsqueda (RF-CF-013)', async () => {
    render(<PosCajero />)
    await screen.findByText('Punto de venta')
    await agregarLecheAlCarrito()
    await userEvent.click(screen.getByRole('button', { name: 'Buscar cliente' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Efectivo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cobrar' }))

    expect(await screen.findByText(/Elegí un cliente de los resultados/)).toBeInTheDocument()
    expect(crearVentaMock).not.toHaveBeenCalled()
  })

  it('busca clientes con debounce (mínimo 2 caracteres) y cobra con el cliente_id real elegido, nunca inventado', async () => {
    buscarClientesMock.mockResolvedValue([
      { id: 70, nombre: 'Maria Fernanda Lopez', contacto: '0991234567', fecha_nacimiento: null, creado_en: '2026-01-01T00:00:00Z', consentimiento_privacidad_en: '2026-01-01T00:00:00Z', version_politica_privacidad: '1.0' },
      { id: 71, nombre: 'Mariana Torres', contacto: null, fecha_nacimiento: null, creado_en: '2026-01-01T00:00:00Z', consentimiento_privacidad_en: '2026-01-01T00:00:00Z', version_politica_privacidad: '1.0' },
    ])
    crearVentaMock.mockResolvedValue({
      id: 3, numero_documento: 'F3', sucursal_id: 901, turno_caja_id: 501, total: 1.44,
      metodo_pago: 'efectivo', estado_venta: 'completada', datafono_id: null,
    } satisfies VentaOut)

    render(<PosCajero />)
    await screen.findByText('Punto de venta')
    await agregarLecheAlCarrito()
    await userEvent.click(screen.getByRole('button', { name: 'Buscar cliente' }))

    await userEvent.type(screen.getByLabelText('Buscar cliente (nombre o contacto)'), 'maria')
    await waitFor(() => expect(buscarClientesMock).toHaveBeenCalledWith('maria'))
    await userEvent.click(await screen.findByRole('button', { name: /Mariana Torres/ }))

    expect(screen.getByText('Mariana Torres')).toBeInTheDocument()
    expect(screen.queryByLabelText('Buscar cliente (nombre o contacto)')).not.toBeInTheDocument()

    await userEvent.click(await screen.findByRole('button', { name: 'Efectivo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cobrar' }))

    expect(crearClienteMock).not.toHaveBeenCalled() // cliente ya existía — nunca se vuelve a crear
    await waitFor(() => expect(crearVentaMock).toHaveBeenCalledWith(expect.objectContaining({ cliente_id: 71 })))
  })

  it('muestra el mensaje real del backend cuando POST /ventas falla, sin fingir que la venta se registró', async () => {
    crearVentaMock.mockRejectedValue(new ApiError(422, 'Stock insuficiente de producto 77 en esta sucursal'))
    render(<PosCajero />)
    await screen.findByText('Punto de venta')
    await agregarLecheAlCarrito()
    await userEvent.click(await screen.findByRole('button', { name: 'Efectivo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cobrar' }))

    expect(await screen.findByText('Stock insuficiente de producto 77 en esta sucursal')).toBeInTheDocument()
    expect(screen.queryByText(/registrada/)).not.toBeInTheDocument()
  })

  it('permite aplicar un cupón recibido por correo y canjearlo al concretar la venta (RN-PI-001)', async () => {
    validarCuponMock.mockResolvedValue({
      id: 99,
      cliente_id: 1,
      tipo_origen: 'churn_recuperacion',
      codigo: 'PROMO10',
      descuento_tipo: 'porcentaje',
      descuento_valor: 10,
      fecha_envio: '2026-09-01T00:00:00Z',
      fecha_expiracion: '2026-12-31T23:59:59Z',
      estado: 'activo',
    })
    canjearCuponMock.mockResolvedValue({ id: 99, estado: 'canjeado' })
    crearVentaMock.mockResolvedValue({
      id: 88,
      numero_documento: 'F88',
      sucursal_id: 901,
      turno_caja_id: 501,
      total: 1.29,
      metodo_pago: 'efectivo',
      estado_venta: 'completada',
      datafono_id: null,
    } satisfies VentaOut)

    render(<PosCajero />)
    await screen.findByText('Punto de venta')
    await agregarLecheAlCarrito() // Leche cuesta $1.25

    // Escribir y aplicar cupón
    const inputCupon = screen.getByLabelText('Código de cupón')
    await userEvent.type(inputCupon, 'promo10')
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }))

    await waitFor(() => expect(validarCuponMock).toHaveBeenCalledWith('PROMO10'))
    expect(await screen.findByText('PROMO10')).toBeInTheDocument()
    expect(screen.getByText(/10% de descuento/)).toBeInTheDocument()

    // Cobrar
    await userEvent.click(await screen.findByRole('button', { name: 'Efectivo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cobrar' }))

    await waitFor(() => expect(crearVentaMock).toHaveBeenCalled())
    await waitFor(() => expect(canjearCuponMock).toHaveBeenCalledWith(99, 88))
  })
})

describe('PosCajero — cerrar turno', () => {
  it('cierra el turno real vía PATCH y vuelve a la pantalla de abrir turno', async () => {
    obtenerTurnoActualMock.mockResolvedValue(TURNO_ABIERTO)
    cerrarTurnoMock.mockResolvedValue({ ...TURNO_ABIERTO, estado: 'cerrado', hora_cierre: '2026-09-06T20:00:00Z', monto_contado: 20, monto_esperado: 20, diferencia: 0 })

    render(<PosCajero />)
    await screen.findByText('Punto de venta')
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar turno' }))

    await screen.findByLabelText('Monto contado en caja')
    await userEvent.type(screen.getByLabelText('Monto contado en caja'), '20')
    // Dos botones "Cerrar turno" en pantalla en este punto (header + modal) —
    // el del modal es el último en agregarse al árbol (AnimatePresence).
    const botonesCerrar = screen.getAllByRole('button', { name: 'Cerrar turno' })
    await userEvent.click(botonesCerrar[botonesCerrar.length - 1])

    await waitFor(() => expect(cerrarTurnoMock).toHaveBeenCalledWith(501, 20, undefined))
    expect(await screen.findByText('Abrir turno de caja')).toBeInTheDocument()
  })
})
