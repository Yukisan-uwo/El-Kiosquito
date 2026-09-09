import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { Compras } from '../Compras'

vi.mock('../Ordenes', () => ({
  Ordenes: () => <div data-testid="vista-ordenes">Vista Órdenes</div>,
}))

vi.mock('../NuevaOrden', () => ({
  NuevaOrden: () => <div data-testid="vista-nueva-orden">Vista Nueva Orden</div>,
}))

vi.mock('../Proveedores', () => ({
  Proveedores: () => <div data-testid="vista-proveedores">Vista Proveedores</div>,
}))

vi.mock('../HistorialCosto', () => ({
  HistorialCosto: () => <div data-testid="vista-historial-costo">Vista Historial Costo</div>,
}))

describe('Compras — Navegación por pestañas', () => {
  it('inicia en Órdenes de compra por defecto cuando no hay parámetro en la URL', () => {
    render(
      <MemoryRouter initialEntries={['/compras']}>
        <Routes>
          <Route path="/compras" element={<Compras />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByTestId('vista-ordenes')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Órdenes de compra' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('inicia en Historial de costo si la URL tiene ?seccion=historial-costo', () => {
    render(
      <MemoryRouter initialEntries={['/compras?seccion=historial-costo']}>
        <Routes>
          <Route path="/compras" element={<Compras />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByTestId('vista-historial-costo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Historial de costo' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('permite cambiar de sección al hacer clic en los botones de pestañas', async () => {
    render(
      <MemoryRouter initialEntries={['/compras?seccion=historial-costo']}>
        <Routes>
          <Route path="/compras" element={<Compras />} />
        </Routes>
      </MemoryRouter>,
    )

    // Comenzamos en historial de costo
    expect(screen.getByTestId('vista-historial-costo')).toBeInTheDocument()

    // Clic en "Nueva orden"
    await userEvent.click(screen.getByRole('button', { name: 'Nueva orden' }))
    expect(screen.getByTestId('vista-nueva-orden')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nueva orden' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Historial de costo' })).toHaveAttribute('aria-pressed', 'false')

    // Clic en "Proveedores"
    await userEvent.click(screen.getByRole('button', { name: 'Proveedores' }))
    expect(screen.getByTestId('vista-proveedores')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Proveedores' })).toHaveAttribute('aria-pressed', 'true')

    // Clic en "Órdenes de compra"
    await userEvent.click(screen.getByRole('button', { name: 'Órdenes de compra' }))
    expect(screen.getByTestId('vista-ordenes')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Órdenes de compra' })).toHaveAttribute('aria-pressed', 'true')
  })
})
