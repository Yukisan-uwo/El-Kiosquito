import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, ApiError, registrarManejadorNoAutorizado, registrarTokenProvider } from '../client'

function mockRespuesta(status: number, cuerpo: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => (cuerpo === undefined ? '' : JSON.stringify(cuerpo)),
  } as Response
}

describe('apiFetch', () => {
  beforeEach(() => {
    registrarTokenProvider(() => null)
    registrarManejadorNoAutorizado(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('agrega el header Authorization cuando hay token', async () => {
    registrarTokenProvider(() => 'token-real-123')
    const fetchMock = vi.fn().mockResolvedValue(mockRespuesta(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await apiFetch('/clientes/politica-privacidad')

    const [, opciones] = fetchMock.mock.calls[0]
    expect((opciones.headers as Record<string, string>).Authorization).toBe('Bearer token-real-123')
  })

  it('no agrega Authorization cuando sinAuth=true (login)', async () => {
    registrarTokenProvider(() => 'no-deberia-usarse')
    const fetchMock = vi.fn().mockResolvedValue(mockRespuesta(200, { access_token: 'x' }))
    vi.stubGlobal('fetch', fetchMock)

    await apiFetch('/auth/login', { method: 'POST', body: { email: 'a', password: 'b' }, sinAuth: true })

    const [, opciones] = fetchMock.mock.calls[0]
    expect((opciones.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('propaga un 422 de Pydantic como ApiError con detail real, nunca inventado', async () => {
    const cuerpoError = { detail: [{ type: 'missing', loc: ['body', 'acepto_politica_privacidad'], msg: 'Field required' }] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockRespuesta(422, cuerpoError)))

    await expect(apiFetch('/clientes', { method: 'POST', body: {} })).rejects.toMatchObject({
      status: 422,
      detail: cuerpoError.detail,
    })
  })

  it('mensajeUsuario extrae el campo y el mensaje de un 422 de Pydantic', async () => {
    const cuerpoError = { detail: [{ type: 'missing', loc: ['body', 'acepto_politica_privacidad'], msg: 'Field required' }] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockRespuesta(422, cuerpoError)))
    try {
      await apiFetch('/clientes', { method: 'POST', body: {} })
      expect.unreachable('debía lanzar ApiError')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      expect((error as ApiError).mensajeUsuario).toBe('acepto_politica_privacidad: Field required')
    }
  })

  it('un 409 con detail de texto simple (RN-CF-001) se propaga tal cual, no genérico', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockRespuesta(409, { detail: 'El cliente ya volvió a comprar' })))
    try {
      await apiFetch('/fidelizacion/campanas-recuperacion', { method: 'POST', body: {} })
      expect.unreachable('debía lanzar ApiError')
    } catch (error) {
      expect((error as ApiError).mensajeUsuario).toBe('El cliente ya volvió a comprar')
    }
  })

  it('llama al manejador de no-autorizado en un 401 (no en login)', async () => {
    const manejador = vi.fn()
    registrarManejadorNoAutorizado(manejador)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockRespuesta(401, { detail: 'Token vencido' })))

    await expect(apiFetch('/clientes/politica-privacidad')).rejects.toThrow()
    expect(manejador).toHaveBeenCalledOnce()
  })

  it('un 401 en el propio login no dispara el manejador de sesión vencida', async () => {
    const manejador = vi.fn()
    registrarManejadorNoAutorizado(manejador)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockRespuesta(401, { detail: 'Credenciales inválidas' })))

    await expect(apiFetch('/auth/login', { method: 'POST', body: {}, sinAuth: true })).rejects.toThrow()
    expect(manejador).not.toHaveBeenCalled()
  })

  it('un fallo de red (fetch rechaza) se traduce a ApiError, nunca una excepción cruda', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(apiFetch('/clientes/politica-privacidad')).rejects.toBeInstanceOf(ApiError)
  })

  it('una respuesta 204 sin cuerpo no intenta parsear JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockRespuesta(204, undefined)))
    await expect(apiFetch('/algo')).resolves.toBeUndefined()
  })
})
