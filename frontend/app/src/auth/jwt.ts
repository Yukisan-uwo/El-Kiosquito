/**
 * Decodificación de los claims del JWT emitido por `POST /auth/login`
 * (010-administracion, `app/core/security.py`: `sub`, `rol`,
 * `sucursal_ids`, `exp`). Solo lectura — nunca se valida la firma acá,
 * eso es responsabilidad exclusiva del backend en cada request; esto es
 * solo para poder pintar el sidebar/rutas correctas sin esperar un round
 * trip. El backend es la única fuente de verdad de autorización real.
 */

export interface ClaimsJwt {
  sub: string
  rol: string
  sucursal_ids: number[]
  exp: number
}

export class JwtInvalidoError extends Error {}

function base64UrlDecode(segment: string): string {
  const normalizado = segment.replace(/-/g, '+').replace(/_/g, '/')
  const relleno = normalizado.padEnd(normalizado.length + ((4 - (normalizado.length % 4)) % 4), '=')
  return atob(relleno)
}

export function decodificarClaims(token: string): ClaimsJwt {
  const partes = token.split('.')
  if (partes.length !== 3) {
    throw new JwtInvalidoError('El token no tiene el formato JWT esperado (header.payload.signature)')
  }
  let payload: unknown
  try {
    payload = JSON.parse(base64UrlDecode(partes[1]))
  } catch (error) {
    throw new JwtInvalidoError(`No se pudo decodificar el payload del token: ${error}`)
  }
  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof (payload as Record<string, unknown>).sub !== 'string' ||
    typeof (payload as Record<string, unknown>).rol !== 'string' ||
    !Array.isArray((payload as Record<string, unknown>).sucursal_ids) ||
    typeof (payload as Record<string, unknown>).exp !== 'number'
  ) {
    throw new JwtInvalidoError('El payload del token no trae los claims esperados (sub/rol/sucursal_ids/exp)')
  }
  return payload as ClaimsJwt
}

export function tokenVencido(claims: ClaimsJwt, ahoraMs: number = Date.now()): boolean {
  return claims.exp * 1000 <= ahoraMs
}
