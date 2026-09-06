interface LogoMarcaProps {
  tamano?: number
  className?: string
}

// Isotipo propio de El Kiosquito (Tarea #63, 2026-09-06) — un puestito con
// toldo a dos aguas, ventanilla de atención y banderín, no un ícono de
// stock ("carrito", "tienda" genérica) ni una letra suelta. Usa
// exclusivamente los tokens de color del tema (Art. 11.2 — ningún hex
// suelto), así que el mismo componente hereda el rebranding a amarillo
// automáticamente si los tokens vuelven a cambiar. Es puramente
// decorativo (el nombre "El Kiosquito" siempre va como texto real al
// lado, nunca solo como imagen) — por eso aria-hidden.
export function LogoMarca({ tamano = 40, className = '' }: LogoMarcaProps) {
  return (
    <svg
      width={tamano}
      height={tamano}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect x="2" y="2" width="44" height="44" rx="12" fill="var(--color-brand-primary)" />
      <line
        x1="24" y1="9" x2="24" y2="3"
        stroke="var(--color-brand-deep)" strokeWidth="1.6" strokeLinecap="round"
      />
      <polygon points="24,3 24,7.5 29.5,5.2" fill="var(--color-brand-accent)" />
      <polygon points="8,21 24,9 40,21" fill="var(--color-brand-deep)" />
      <rect x="6" y="20" width="36" height="3" rx="1.5" fill="var(--color-brand-deep)" />
      <rect x="10" y="23" width="28" height="16" rx="3" fill="var(--color-surface-card)" />
      <rect x="14" y="27" width="20" height="8" rx="1.5" fill="var(--color-brand-accent)" />
      <rect x="13" y="39" width="3" height="4" rx="1" fill="var(--color-brand-deep)" />
      <rect x="32" y="39" width="3" height="4" rx="1" fill="var(--color-brand-deep)" />
    </svg>
  )
}
