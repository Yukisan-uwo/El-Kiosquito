export interface PaginacionProps {
  paginaActual: number
  totalPaginas: number
  totalItems: number
  itemsPorPagina: number
  onCambiarPagina: (pagina: number) => void
  onCambiarItemsPorPagina?: (itemsPorPagina: number) => void
  opcionesItemsPorPagina?: number[]
  etiquetaItems?: string
}

export function Paginacion({
  paginaActual,
  totalPaginas,
  totalItems,
  itemsPorPagina,
  onCambiarPagina,
  onCambiarItemsPorPagina,
  opcionesItemsPorPagina = [5, 10, 20, 50],
  etiquetaItems = 'registros',
}: PaginacionProps) {
  if (totalItems <= 0 || (totalPaginas <= 1 && totalItems <= itemsPorPagina)) return null

  const inicio = Math.min((paginaActual - 1) * itemsPorPagina + 1, totalItems)
  const fin = Math.min(paginaActual * itemsPorPagina, totalItems)

  // Generación de números de página con elipsis inteligente
  const obtenerPaginasVisibles = (): (number | '...')[] => {
    if (totalPaginas <= 7) {
      return Array.from({ length: totalPaginas }, (_, i) => i + 1)
    }

    const paginas: (number | '...')[] = [1]

    if (paginaActual > 3) {
      paginas.push('...')
    }

    const start = Math.max(2, paginaActual - 1)
    const end = Math.min(totalPaginas - 1, paginaActual + 1)

    for (let i = start; i <= end; i++) {
      paginas.push(i)
    }

    if (paginaActual < totalPaginas - 2) {
      paginas.push('...')
    }

    paginas.push(totalPaginas)
    return paginas
  }

  const paginasVisibles = obtenerPaginasVisibles()

  return (
    <nav
      className="flex flex-col items-center justify-between gap-3 border-t border-surface-bg px-2 py-3 sm:flex-row"
      aria-label="Paginación de resultados"
    >
      <div className="flex items-center gap-3 text-body-sm text-text-secondary">
        <span>
          Mostrando <strong className="text-text-primary">{inicio}</strong>–
          <strong className="text-text-primary">{fin}</strong> de{' '}
          <strong className="text-text-primary">{totalItems}</strong> {etiquetaItems}
        </span>

        {onCambiarItemsPorPagina && (
          <div className="flex items-center gap-1.5 pl-2 border-l border-surface-bg">
            <label htmlFor="items-por-pagina-select" className="text-label uppercase">
              Por pág:
            </label>
            <select
              id="items-por-pagina-select"
              value={itemsPorPagina}
              onChange={(e) => onCambiarItemsPorPagina(Number(e.target.value))}
              className="rounded-[var(--radius-card)] border border-brand-primary-soft bg-surface-card px-2 py-1 text-body-sm text-text-primary hover:border-brand-primary focus:border-brand-primary focus:outline-none"
            >
              {opcionesItemsPorPagina.map((opcion) => (
                <option key={opcion} value={opcion}>
                  {opcion} / pág.
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onCambiarPagina(paginaActual - 1)}
          disabled={paginaActual <= 1}
          aria-label="Página anterior"
          className="inline-flex h-8 items-center justify-center rounded-xl border-2 border-amber-200/90 bg-white px-2.5 text-body-sm font-medium text-brand-deep shadow-2xs transition-all hover:border-brand-primary hover:bg-amber-50/60 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white disabled:hover:border-amber-200/90"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span className="sr-only sm:not-sr-only sm:ml-1">Anterior</span>
        </button>

        <div className="flex items-center gap-1">
          {paginasVisibles.map((item, index) => {
            if (item === '...') {
              return (
                <span key={`elipsis-${index}`} className="px-2 text-body-sm text-text-secondary select-none">
                  …
                </span>
              )
            }

            const esActiva = item === paginaActual
            return (
              <button
                key={`pagina-${item}`}
                type="button"
                onClick={() => onCambiarPagina(item)}
                aria-label={`Ir a página ${item}`}
                aria-current={esActiva ? 'page' : undefined}
                className={`inline-flex h-8 min-w-[2rem] items-center justify-center rounded-xl px-2.5 text-body-sm font-semibold transition-all ${
                  esActiva
                    ? 'border-2 border-brand-deep bg-brand-deep text-white shadow-xs'
                    : 'border-2 border-amber-200/80 bg-white text-brand-deep hover:border-brand-primary hover:bg-amber-50/60 shadow-2xs'
                }`}
              >
                {item}
              </button>
            )
          })}
        </div>

        <button
          type="button"
          onClick={() => onCambiarPagina(paginaActual + 1)}
          disabled={paginaActual >= totalPaginas}
          aria-label="Página siguiente"
          className="inline-flex h-8 items-center justify-center rounded-xl border-2 border-amber-200/90 bg-white px-2.5 text-body-sm font-medium text-brand-deep shadow-2xs transition-all hover:border-brand-primary hover:bg-amber-50/60 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white disabled:hover:border-amber-200/90"
        >
          <span className="sr-only sm:not-sr-only sm:mr-1">Siguiente</span>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </nav>
  )
}
