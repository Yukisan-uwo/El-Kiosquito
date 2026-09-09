import { LogoMarca } from './LogoMarca'

export interface EncabezadoReporteImpresionProps {
  titulo: string
  subtitulo?: string
  rangoFechas?: { desde: string; hasta: string }
  sucursalNombre?: string
  usuarioNombre?: string
  className?: string
}

export function EncabezadoReporteImpresion({
  titulo,
  subtitulo,
  rangoFechas,
  sucursalNombre,
  usuarioNombre,
  className = '',
}: EncabezadoReporteImpresionProps) {
  const fechaGeneracion = new Date().toLocaleString('es-EC', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className={`print-only mb-6 border-b-2 border-amber-300 pb-4 text-left ${className}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <LogoMarca tamano={48} className="shrink-0" />
          <div>
            <span className="font-display text-2xl font-bold tracking-tight text-brand-deep">
              El Kiosquito
            </span>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-primary">
              Sistema de Gestión Comercial e Inteligencia de Negocios
            </p>
          </div>
        </div>

        <div className="text-right text-xs text-text-secondary">
          <p className="font-semibold text-brand-deep">Documento Oficial de Uso Interno</p>
          <p>Emisión: {fechaGeneracion}</p>
          {usuarioNombre && <p>Emitido por: {usuarioNombre}</p>}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="font-display text-xl font-bold text-brand-deep uppercase tracking-wide">
            {titulo}
          </h1>
          {subtitulo && <p className="text-xs text-text-secondary mt-0.5">{subtitulo}</p>}
        </div>

        <div className="flex flex-wrap gap-4 text-xs font-medium text-text-secondary">
          {sucursalNombre && (
            <span className="rounded-lg bg-amber-50 px-2.5 py-1 border border-amber-200">
              <strong className="text-brand-deep">Ámbito:</strong> {sucursalNombre}
            </span>
          )}
          {rangoFechas && (
            <span className="rounded-lg bg-amber-50 px-2.5 py-1 border border-amber-200">
              <strong className="text-brand-deep">Período:</strong> {rangoFechas.desde} al {rangoFechas.hasta}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
