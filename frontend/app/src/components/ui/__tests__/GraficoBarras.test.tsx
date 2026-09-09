import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GraficoBarras } from '../GraficoBarras'

describe('GraficoBarras', () => {
  const datosPrueba = [
    { sucursal: 'Centro', ventas: 1200, margen: 400 },
    { sucursal: 'La María', ventas: 950, margen: 310 },
  ]

  const barrasPrueba = [
    { clave: 'ventas', nombre: 'Ventas ($)', color: '#D4A017' },
    { clave: 'margen', nombre: 'Margen ($)', color: '#946F00' },
  ]

  it('renderiza título y subtítulo cuando se proporcionan', () => {
    render(
      <GraficoBarras
        titulo="Comparativa de Sucursales"
        subtitulo="Ventas y margen neto por punto de venta"
        datos={datosPrueba}
        claveEjeX="sucursal"
        barras={barrasPrueba}
      />,
    )
    expect(screen.getByText('Comparativa de Sucursales')).toBeInTheDocument()
    expect(screen.getByText('Ventas y margen neto por punto de venta')).toBeInTheDocument()
  })

  it('no renderiza nada si los datos están vacíos', () => {
    const { container } = render(
      <GraficoBarras
        titulo="Sin Datos"
        datos={[]}
        claveEjeX="sucursal"
        barras={barrasPrueba}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
