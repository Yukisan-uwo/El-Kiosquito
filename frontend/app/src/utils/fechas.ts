/**
 * Utilidades de fecha y hora para El Kiosquito.
 * Normaliza timestamps provenientes de Postgres / FastAPI (almacenados en UTC
 * pero en ocasiones serializados sin el sufijo 'Z') a la zona horaria local del usuario.
 */

export function parsearFechaUTC(fecha: string | Date | null | undefined): Date | null {
  if (!fecha) return null
  if (fecha instanceof Date) return isNaN(fecha.getTime()) ? null : fecha

  const limpia = fecha.trim()
  if (!limpia) return null

  // Reemplazar espacio entre fecha y hora por 'T' si viene de Postgres directo
  const normalizada = limpia.replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/, '$1T$2')

  // Si no tiene 'Z' ni offset +/-HH:mm, asumimos que viene en UTC de la base de datos
  const conZona = !normalizada.includes('Z') && !/[+-]\d{2}(?::?\d{2})?$/.test(normalizada)
    ? `${normalizada}Z`
    : normalizada

  const parsed = new Date(conZona)
  return isNaN(parsed.getTime()) ? new Date(fecha) : parsed
}

export function formatearHora(fecha: string | Date | null | undefined): string {
  const d = parsearFechaUTC(fecha)
  if (!d) return '—'
  return d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })
}

export function formatearFechaHora(fecha: string | Date | null | undefined): string {
  const d = parsearFechaUTC(fecha)
  if (!d) return '—'
  return d.toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' })
}

export function formatearFecha(fecha: string | Date | null | undefined): string {
  const d = parsearFechaUTC(fecha)
  if (!d) return '—'
  return d.toLocaleDateString('es-EC', { dateStyle: 'short' })
}
