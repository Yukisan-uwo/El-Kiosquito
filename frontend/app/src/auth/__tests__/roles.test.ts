import { describe, expect, it } from 'vitest'
import { esCodigoRolConocido, itemsNavegacionParaRol, rolPuedeVerModulo, rutaInicialParaRol } from '../roles'

describe('roles', () => {
  it('un cajero solo ve el módulo de punto de venta', () => {
    const items = itemsNavegacionParaRol('cajero')
    expect(items.map((i) => i.modulo)).toEqual(['pos_cajero'])
  })

  it('un cajero nunca ve el módulo de comparar sucursales/administración (ni siquiera deshabilitado)', () => {
    expect(rolPuedeVerModulo('cajero', 'administracion')).toBe(false)
    expect(rolPuedeVerModulo('cajero', 'dashboard_dueno')).toBe(false)
  })

  it('el dueño ve panel general y administración', () => {
    const modulos = itemsNavegacionParaRol('dueno').map((i) => i.modulo)
    expect(modulos).toContain('dashboard_dueno')
    expect(modulos).toContain('administracion')
  })

  it('encargado_compras es rol corporativo: solo compras y proveedores', () => {
    expect(itemsNavegacionParaRol('encargado_compras').map((i) => i.modulo)).toEqual(['compras_proveedores'])
  })

  it('cada rol tiene una ruta inicial que coincide con un módulo que puede ver', () => {
    const roles = ['dueno', 'encargado_compras', 'encargado_sucursal', 'cajero'] as const
    for (const rol of roles) {
      const ruta = rutaInicialParaRol(rol)
      const rutas = itemsNavegacionParaRol(rol).map((i) => i.ruta)
      expect(rutas).toContain(ruta)
    }
  })

  it('reconoce códigos de rol válidos y rechaza uno inventado', () => {
    expect(esCodigoRolConocido('dueno')).toBe(true)
    expect(esCodigoRolConocido('super-admin-inventado')).toBe(false)
  })
})
