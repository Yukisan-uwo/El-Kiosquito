interface EsqueletoCargaProps {
  /** Cuántas filas/cards fantasma mostrar, con la misma geometría del
   * contenido final — nunca un spinner genérico (doc de diseño, 4.5). */
  filas?: number
  alturaPx?: number
}

export function EsqueletoCarga({ filas = 3, alturaPx = 44 }: EsqueletoCargaProps) {
  return (
    <div className="space-y-2" role="status" aria-label="Cargando">
      {Array.from({ length: filas }).map((_, indice) => (
        <div
          key={indice}
          className="animate-pulse rounded-[var(--radius-card)] bg-brand-primary-soft"
          style={{ height: alturaPx }}
        />
      ))}
    </div>
  )
}
