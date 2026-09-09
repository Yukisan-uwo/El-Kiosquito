export interface BarraBusquedaProps {
  valor: string
  onChange: (valor: string) => void
  placeholder?: string
  className?: string
  totalCoincidencias?: number
  etiquetaTotal?: string
  id?: string
  autoFocus?: boolean
}

export function BarraBusqueda({
  valor,
  onChange,
  placeholder = 'Buscar...',
  className = '',
  totalCoincidencias,
  etiquetaTotal = 'encontrados',
  id = 'barra-busqueda',
  autoFocus = false,
}: BarraBusquedaProps) {
  return (
    <div className={`relative flex flex-col gap-1 sm:flex-row sm:items-center ${className}`}>
      <div className="relative flex-1">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-text-secondary">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>

        <input
          id={id}
          type="text"
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="w-full rounded-[var(--radius-card)] border border-brand-primary-soft bg-surface-card py-2 pl-9 pr-8 text-body text-text-primary shadow-2xs transition-colors placeholder:text-text-secondary/60 hover:border-brand-primary/60 focus:border-brand-primary focus:bg-white focus:outline-none"
        />

        {valor && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Limpiar búsqueda"
            className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-text-secondary hover:text-brand-accent transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {totalCoincidencias !== undefined && valor.trim().length > 0 && (
        <span className="text-body-sm text-text-secondary self-center px-1 shrink-0">
          <strong className="text-brand-deep">{totalCoincidencias}</strong> {etiquetaTotal}
        </span>
      )}
    </div>
  )
}
