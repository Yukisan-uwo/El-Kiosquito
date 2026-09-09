import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { Administracion } from '../Administracion'

vi.mock('../Usuarios', () => ({
  Usuarios: () => <div data-testid="vista-usuarios">Vista Usuarios</div>,
}))
vi.mock('../Sucursales', () => ({
  Sucursales: () => <div data-testid="vista-sucursales">Vista Sucursales</div>,
}))
vi.mock('../Permisos', () => ({
  Permisos: () => <div data-testid="vista-permisos">Vista Permisos</div>,
}))
vi.mock('../Auditoria', () => ({
  Auditoria: () => <div data-testid="vista-auditoria">Vista Auditoría</div>,
}))
vi.mock('../Parametros', () => ({
  Parametros: () => <div data-testid="vista-parametros">Vista Parámetros</div>,
}))
vi.mock('../SolicitudesArco', () => ({
  SolicitudesArco: () => <div data-testid="vista-arco">Vista ARCO</div>,
}))

describe('Administracion — Navegación por pestañas', () => {
  it('inicia en Usuarios por defecto', () => {
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin" element={<Administracion />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByTestId('vista-usuarios')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Usuarios' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('permite cambiar entre pestañas al hacer clic', async () => {
    render(
      <MemoryRouter initialEntries={['/admin?seccion=usuarios']}>
        <Routes>
          <Route path="/admin" element={<Administracion />} />
        </Routes>
      </MemoryRouter>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Sucursales' }))
    expect(screen.getByTestId('vista-sucursales')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sucursales' })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(screen.getByRole('button', { name: 'Parámetros del sistema' }))
    expect(screen.getByTestId('vista-parametros')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Parámetros del sistema' })).toHaveAttribute('aria-pressed', 'true')
  })
})
