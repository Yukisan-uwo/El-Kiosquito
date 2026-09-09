import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from '../AuthContext'

const apiFetchMock = vi.fn()
vi.mock('@/api/client', async () => {
  const real = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...real, apiFetch: (...args: unknown[]) => apiFetchMock(...args) }
})

function construirToken(payload: Record<string, unknown>): string {
  const b64url = (obj: unknown) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64url({ alg: 'HS256' })}.${b64url(payload)}.firma`
}

interface PantallaDePruebaProps {
  /** El click de un <button> no le hace `await` a nada — `userEvent.click`
   * resuelve en cuanto termina el despacho del evento DOM, no cuando
   * termina la continuación async de `iniciarSesion`. Sin esta ref, un
   * rechazo de `iniciarSesion` queda como "unhandled rejection" en vez de
   * algo que el test pueda `await`/asertar. */
  promiseIniciarSesionRef?: { current: Promise<void> | null }
}

function PantallaDePrueba({ promiseIniciarSesionRef }: PantallaDePruebaProps = {}) {
  const { sesion, iniciarSesion, cerrarSesion, cargandoSesionInicial } = useAuth()
  if (cargandoSesionInicial) return <p>cargando...</p>
  return (
    <div>
      <p>{sesion ? `rol:${sesion.rol}` : 'sin-sesion'}</p>
      <button
        onClick={() => {
          const promesa = iniciarSesion('dueno@elkiosquito.ec', 'clave')
          if (promiseIniciarSesionRef) {
            promiseIniciarSesionRef.current = promesa
            promesa.catch(() => {})
          }
        }}
      >
        login
      </button>
      <button onClick={cerrarSesion}>logout</button>
    </div>
  )
}

describe('AuthProvider', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    apiFetchMock.mockReset()
  })

  it('arranca sin sesión cuando no hay token guardado', async () => {
    render(<AuthProvider><PantallaDePrueba /></AuthProvider>)
    expect(await screen.findByText('sin-sesion')).toBeInTheDocument()
  })

  it('iniciarSesion decodifica el rol real del JWT devuelto por el backend', async () => {
    const token = construirToken({ sub: 'dueno@elkiosquito.ec', rol: 'dueno', sucursal_ids: [], exp: 9999999999 })
    apiFetchMock.mockResolvedValue({ access_token: token, token_type: 'bearer' })
    render(<AuthProvider><PantallaDePrueba /></AuthProvider>)
    await screen.findByText('sin-sesion')

    await act(async () => {
      await userEvent.click(screen.getByText('login'))
    })

    expect(await screen.findByText('rol:dueno')).toBeInTheDocument()
    expect(sessionStorage.getItem('elkiosquito.token')).toBe(token)
  })

  it('restaura la sesión desde sessionStorage al montar de nuevo (recarga de página)', async () => {
    const token = construirToken({ sub: 'cajero@elkiosquito.ec', rol: 'cajero', sucursal_ids: [1], exp: 9999999999 })
    sessionStorage.setItem('elkiosquito.token', token)

    render(<AuthProvider><PantallaDePrueba /></AuthProvider>)

    expect(await screen.findByText('rol:cajero')).toBeInTheDocument()
  })

  it('restaura la sesión desde localStorage al recargar la página', async () => {
    const token = construirToken({ sub: 'encargado@elkiosquito.ec', rol: 'encargado_sucursal', sucursal_ids: [2], exp: 9999999999 })
    localStorage.setItem('elkiosquito.token', token)

    render(<AuthProvider><PantallaDePrueba /></AuthProvider>)

    expect(await screen.findByText('rol:encargado_sucursal')).toBeInTheDocument()
  })

  it('un token vencido guardado se descarta, no restaura sesión', async () => {
    const token = construirToken({ sub: 'x@x.com', rol: 'cajero', sucursal_ids: [1], exp: 1 })
    sessionStorage.setItem('elkiosquito.token', token)

    render(<AuthProvider><PantallaDePrueba /></AuthProvider>)

    expect(await screen.findByText('sin-sesion')).toBeInTheDocument()
    expect(sessionStorage.getItem('elkiosquito.token')).toBeNull()
  })

  it('cerrarSesion limpia el storage y el estado', async () => {
    const token = construirToken({ sub: 'x@x.com', rol: 'dueno', sucursal_ids: [], exp: 9999999999 })
    sessionStorage.setItem('elkiosquito.token', token)
    render(<AuthProvider><PantallaDePrueba /></AuthProvider>)
    await screen.findByText('rol:dueno')

    await act(async () => {
      await userEvent.click(screen.getByText('logout'))
    })

    expect(await screen.findByText('sin-sesion')).toBeInTheDocument()
    expect(sessionStorage.getItem('elkiosquito.token')).toBeNull()
  })

  it('un rol que el backend emite pero el frontend no conoce lanza un error explícito, nunca navega a ciegas', async () => {
    const token = construirToken({ sub: 'x@x.com', rol: 'rol-fantasma', sucursal_ids: [], exp: 9999999999 })
    apiFetchMock.mockResolvedValue({ access_token: token, token_type: 'bearer' })
    const promiseIniciarSesionRef: { current: Promise<void> | null } = { current: null }
    render(<AuthProvider><PantallaDePrueba promiseIniciarSesionRef={promiseIniciarSesionRef} /></AuthProvider>)
    await screen.findByText('sin-sesion')

    await act(async () => {
      await userEvent.click(screen.getByText('login'))
    })

    await expect(promiseIniciarSesionRef.current).rejects.toThrow('rol-fantasma')
    // Nunca navega a ciegas: sigue sin sesión pese al rol desconocido.
    expect(screen.getByText('sin-sesion')).toBeInTheDocument()
  })
})
