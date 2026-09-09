import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import { Login } from '../Login'

const iniciarSesionMock = vi.fn()
let sesionMock: { rol: string } | null = null

vi.mock('@/auth/AuthContext', async () => {
  const real = await vi.importActual<typeof import('@/auth/AuthContext')>('@/auth/AuthContext')
  return {
    ...real,
    useAuth: () => ({ sesion: sesionMock, iniciarSesion: iniciarSesionMock, cerrarSesion: vi.fn() }),
  }
})

describe('Login', () => {
  beforeEach(() => {
    sessionStorage.setItem('elkiosquito.intro-vista', '1') // saltar la cinemática en los tests de formulario
    sesionMock = null
    iniciarSesionMock.mockReset()
  })

  it('muestra la cinemática de entrada la primera vez (sin flag en sessionStorage)', () => {
    sessionStorage.removeItem('elkiosquito.intro-vista')
    render(<MemoryRouter><Login /></MemoryRouter>)
    expect(screen.getByLabelText('Omitir animación de entrada')).toBeInTheDocument()
  })

  it('no muestra la cinemática si ya se vio en esta sesión', () => {
    render(<MemoryRouter><Login /></MemoryRouter>)
    expect(screen.queryByLabelText('Omitir animación de entrada')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Correo')).toBeInTheDocument()
  })

  it('envía email/password reales a iniciarSesion, nunca valores vacíos por defecto', async () => {
    iniciarSesionMock.mockResolvedValue(undefined)
    render(<MemoryRouter><Login /></MemoryRouter>)

    await userEvent.type(screen.getByLabelText('Correo'), 'dueno@elkiosquito.ec')
    await userEvent.type(screen.getByLabelText('Contraseña'), 'clave-real-123')
    await userEvent.click(screen.getByRole('button', { name: 'Ingresar' }))

    await waitFor(() => expect(iniciarSesionMock).toHaveBeenCalledWith('dueno@elkiosquito.ec', 'clave-real-123'))
  })

  it('muestra el mensaje real del backend cuando las credenciales son inválidas (401)', async () => {
    iniciarSesionMock.mockRejectedValue(new ApiError(401, 'Credenciales inválidas o token vencido'))
    render(<MemoryRouter><Login /></MemoryRouter>)

    await userEvent.type(screen.getByLabelText('Correo'), 'x@x.com')
    await userEvent.type(screen.getByLabelText('Contraseña'), 'mal')
    await userEvent.click(screen.getByRole('button', { name: 'Ingresar' }))

    expect(await screen.findByText('Credenciales inválidas o token vencido')).toBeInTheDocument()
  })

  it('nunca navega a un dashboard sin que iniciarSesion haya resuelto exitosamente', async () => {
    let resolver: (() => void) | undefined
    iniciarSesionMock.mockReturnValue(new Promise<void>((r) => { resolver = () => r() }))
    render(<MemoryRouter><Login /></MemoryRouter>)

    await userEvent.type(screen.getByLabelText('Correo'), 'x@x.com')
    await userEvent.type(screen.getByLabelText('Contraseña'), 'clave')
    await userEvent.click(screen.getByRole('button', { name: 'Ingresar' }))

    expect(screen.getByRole('button', { name: 'Ingresando...' })).toBeDisabled()
    resolver?.()
  })

  it('permite alternar la visibilidad de la contraseña con el botón de mostrar/ocultar', async () => {
    render(<MemoryRouter><Login /></MemoryRouter>)

    const inputPassword = screen.getByLabelText('Contraseña')
    expect(inputPassword).toHaveAttribute('type', 'password')

    const botonMostrar = screen.getByRole('button', { name: 'Mostrar contraseña' })
    await userEvent.click(botonMostrar)

    expect(inputPassword).toHaveAttribute('type', 'text')

    const botonOcultar = screen.getByRole('button', { name: 'Ocultar contraseña' })
    await userEvent.click(botonOcultar)

    expect(inputPassword).toHaveAttribute('type', 'password')
  })
})
