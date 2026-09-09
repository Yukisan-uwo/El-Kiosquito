import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Boton } from '../Boton'
import { BadgeEstado } from '../BadgeEstado'
import { CardKpi } from '../CardKpi'
import { EstadoVacio } from '../EstadoVacio'
import { Paginacion } from '../Paginacion'

describe('CardKpi', () => {
  it('muestra el pie de tamaño de muestra/periodo cuando el dato viene de ML', () => {
    render(
      <CardKpi
        etiqueta="Segmento predominante"
        cifra="Leal alto margen"
        origenMl={{ tamanoMuestra: 87, periodoDesde: '2026-06-01', periodoHasta: '2026-08-31' }}
      />,
    )
    expect(screen.getByText(/Basado en 87 muestras/)).toBeInTheDocument()
  })

  it('NO muestra el pie de ML cuando el dato no viene de un modelo', () => {
    render(<CardKpi etiqueta="Ticket promedio" cifra="$4.20" />)
    expect(screen.queryByText(/Basado en/)).not.toBeInTheDocument()
  })

  it('muestra la comparación con el color correcto según sea favorable', () => {
    render(<CardKpi etiqueta="Margen" cifra="24%" comparacion={{ texto: '+3pp vs mes anterior', favorable: true }} />)
    expect(screen.getByText('+3pp vs mes anterior')).toHaveClass('text-status-success')
  })
})

describe('Boton', () => {
  it('el botón peligro nunca comparte clases de color con un badge de éxito', () => {
    render(<Boton variante="peligro">Anular</Boton>)
    const boton = screen.getByRole('button', { name: 'Anular' })
    expect(boton.className).toContain('bg-status-danger')
    expect(boton.className).not.toContain('status-success')
  })

  it('respeta disabled', () => {
    render(<Boton disabled>Guardar</Boton>)
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
  })
})

describe('BadgeEstado', () => {
  it('nunca inventa el texto — lo recibe tal cual del catálogo', () => {
    render(<BadgeEstado texto="CANJEADO" color="success" />)
    expect(screen.getByText('CANJEADO')).toBeInTheDocument()
  })
})

describe('EstadoVacio', () => {
  it('nunca renderiza "no hay datos" a secas — exige título y descripción', () => {
    render(<EstadoVacio titulo="Todavía no hay revisiones" descripcion="Registrá la primera revisión de seguridad." />)
    expect(screen.getByText('Todavía no hay revisiones')).toBeInTheDocument()
    expect(screen.getByText('Registrá la primera revisión de seguridad.')).toBeInTheDocument()
  })
})

describe('Paginacion', () => {
  it('muestra el rango correcto y botones de navegación', () => {
    render(
      <Paginacion
        paginaActual={2}
        totalPaginas={5}
        totalItems={50}
        itemsPorPagina={10}
        onCambiarPagina={() => {}}
      />,
    )
    expect(screen.getByText(/11/)).toBeInTheDocument()
    expect(screen.getByText(/20/)).toBeInTheDocument()
    expect(screen.getByText(/50/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Página anterior' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Página siguiente' })).toBeEnabled()
  })

  it('deshabilita el botón anterior en la primera página', () => {
    render(
      <Paginacion
        paginaActual={1}
        totalPaginas={3}
        totalItems={25}
        itemsPorPagina={10}
        onCambiarPagina={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'Página anterior' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Página siguiente' })).toBeEnabled()
  })
})

