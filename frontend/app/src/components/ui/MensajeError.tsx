import { Boton } from './Boton'

interface MensajeErrorProps {
  mensaje: string
  onReintentar?: () => void
}

// Mensaje específico + acción siguiente, nunca un error técnico crudo del
// backend (doc de diseño, 4.5) — el mensaje ya viene filtrado por
// ApiError.mensajeUsuario antes de llegar acá.
export function MensajeError({ mensaje, onReintentar }: MensajeErrorProps) {
  return (
    <div role="alert" className="rounded-[var(--radius-card)] border border-status-danger-soft bg-status-danger-soft p-4">
      <p className="text-body text-status-danger">{mensaje}</p>
      {onReintentar && (
        <Boton variante="secundario" className="mt-3" onClick={onReintentar}>
          Reintentar
        </Boton>
      )}
    </div>
  )
}
