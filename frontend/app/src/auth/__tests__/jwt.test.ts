import { describe, expect, it } from 'vitest'
import { decodificarClaims, JwtInvalidoError, tokenVencido } from '../jwt'

/** Construye un JWT sintético válido en estructura (no firmado de verdad,
 * no hace falta para probar el decoder — la firma la valida el backend). */
function construirToken(payload: Record<string, unknown>): string {
  const b64url = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.firma-falsa`
}

describe('decodificarClaims', () => {
  it('decodifica un token con los 4 claims esperados', () => {
    const token = construirToken({ sub: 'dueno@elkiosquito.ec', rol: 'dueno', sucursal_ids: [], exp: 9999999999 })
    const claims = decodificarClaims(token)
    expect(claims.sub).toBe('dueno@elkiosquito.ec')
    expect(claims.rol).toBe('dueno')
    expect(claims.sucursal_ids).toEqual([])
    expect(claims.exp).toBe(9999999999)
  })

  it('decodifica sucursal_ids con valores reales para un encargado_sucursal', () => {
    const token = construirToken({ sub: 'ana@elkiosquito.ec', rol: 'encargado_sucursal', sucursal_ids: [3, 7], exp: 9999999999 })
    expect(decodificarClaims(token).sucursal_ids).toEqual([3, 7])
  })

  it('rechaza un token sin 3 segmentos', () => {
    expect(() => decodificarClaims('no-es-un-jwt')).toThrow(JwtInvalidoError)
  })

  it('rechaza un token cuyo payload no es JSON válido', () => {
    expect(() => decodificarClaims('aGVhZGVy.no-es-json-valido.firma')).toThrow(JwtInvalidoError)
  })

  it('rechaza un payload sin el claim rol', () => {
    const token = construirToken({ sub: 'x@x.com', sucursal_ids: [], exp: 1 })
    expect(() => decodificarClaims(token)).toThrow(JwtInvalidoError)
  })

  it('rechaza un payload donde sucursal_ids no es array', () => {
    const token = construirToken({ sub: 'x@x.com', rol: 'cajero', sucursal_ids: 'no-es-array', exp: 1 })
    expect(() => decodificarClaims(token)).toThrow(JwtInvalidoError)
  })
})

describe('tokenVencido', () => {
  it('detecta un token vencido', () => {
    const claims = { sub: 'x', rol: 'cajero', sucursal_ids: [1], exp: 1000 }
    expect(tokenVencido(claims, 1000 * 1000 + 1)).toBe(true)
  })

  it('detecta un token todavía vigente', () => {
    const claims = { sub: 'x', rol: 'cajero', sucursal_ids: [1], exp: 2000 }
    expect(tokenVencido(claims, 1000 * 1000)).toBe(false)
  })

  it('trata exp exactamente igual a ahora como vencido (borde inclusivo)', () => {
    const claims = { sub: 'x', rol: 'cajero', sucursal_ids: [1], exp: 1000 }
    expect(tokenVencido(claims, 1000 * 1000)).toBe(true)
  })
})
