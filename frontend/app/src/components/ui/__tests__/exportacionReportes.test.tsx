import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EncabezadoReporteImpresion } from '../EncabezadoReporteImpresion'
import { BotonExportarReporte } from '../BotonExportarReporte'

describe('EncabezadoReporteImpresion', () => {
  it('renderiza título corporativo, ámbito de sucursal y rango de fechas', () => {
    render(
      <EncabezadoReporteImpresion
        titulo="Informe Ejecutivo Consolidado"
        subtitulo="Márgenes y rentabilidad"
        rangoFechas={{ desde: '2026-08-01', hasta: '2026-08-31' }}
        sucursalNombre="Sucursal Matriz"
        usuarioNombre="Mario (Dueño)"
      />,
    )

    expect(screen.getByText('El Kiosquito')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /informe ejecutivo consolidado/i })).toBeInTheDocument()
    expect(screen.getByText('Márgenes y rentabilidad')).toBeInTheDocument()
    expect(screen.getByText(/Sucursal Matriz/)).toBeInTheDocument()
    expect(screen.getByText(/2026-08-01 al 2026-08-31/)).toBeInTheDocument()
    expect(screen.getByText(/Emitido por: Mario \(Dueño\)/)).toBeInTheDocument()
  })

  it('tiene la clase print-only para mantenerse oculto en pantalla normal', () => {
    const { container } = render(
      <EncabezadoReporteImpresion titulo="Reporte Operativo" />
    )
    expect(container.firstChild).toHaveClass('print-only')
  })
})

describe('BotonExportarReporte', () => {
  it('renderiza con etiqueta adecuada y clase no-print', () => {
    render(<BotonExportarReporte etiqueta="Exportar informe (PDF)" />)
    const boton = screen.getByRole('button', { name: /Exportar informe a PDF o imprimir/i })
    expect(boton).toBeInTheDocument()
    expect(boton).toHaveClass('no-print')
    expect(screen.getByText('Exportar informe (PDF)')).toBeInTheDocument()
  })

  it('invoca window.print() al hacer clic', async () => {
    const printSpy = vi.fn()
    window.print = printSpy
    const callbackSpy = vi.fn()

    render(
      <BotonExportarReporte
        etiqueta="Exportar informe"
        onAntesDeExportar={callbackSpy}
      />
    )

    const boton = screen.getByRole('button', { name: /Exportar informe a PDF o imprimir/i })
    fireEvent.click(boton)

    expect(callbackSpy).toHaveBeenCalledTimes(1)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(printSpy).toHaveBeenCalledTimes(1)
  })
})
