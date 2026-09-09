import { useState } from 'react'

export interface BotonExportarReporteProps {
  etiqueta?: string
  tituloReporte?: string
  className?: string
  variante?: 'primario' | 'secundario'
  onAntesDeExportar?: () => void
}

export function BotonExportarReporte({
  etiqueta = 'Exportar informe (PDF)',
  tituloReporte,
  className = '',
  variante = 'secundario',
  onAntesDeExportar,
}: BotonExportarReporteProps) {
  const [exportando, setExportando] = useState(false)

  function manejarImprimir() {
    if (onAntesDeExportar) {
      onAntesDeExportar()
    }
    setExportando(true)
    // Pequeño timeout para permitir que cualquier render pendiente se asiente
    setTimeout(() => {
      if (typeof window !== 'undefined' && typeof window.print === 'function') {
        window.print()
      }
      setExportando(false)
    }, 150)
  }

  const estilosVariante =
    variante === 'primario'
      ? 'bg-brand-primary text-white hover:bg-[#7D5E00] shadow-2xs border-2 border-brand-primary'
      : 'bg-white text-brand-deep hover:bg-amber-50 hover:border-brand-primary border-2 border-amber-200/90 shadow-2xs'

  return (
    <button
      type="button"
      onClick={manejarImprimir}
      disabled={exportando}
      title={tituloReporte ? `Exportar ${tituloReporte}` : 'Exportar informe a PDF o imprimir'}
      aria-label="Exportar informe a PDF o imprimir"
      className={`no-print inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-body-sm font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-brand-primary/40 ${estilosVariante} ${className}`}
    >
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
        />
      </svg>
      <span>{exportando ? 'Preparando...' : etiqueta}</span>
    </button>
  )
}
