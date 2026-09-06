/**
 * Mapa rol -> módulos visibles en el sidebar (frontend/prompt-interfaces-ia.md,
 * sección 1 y 8). Esto es una afordancia de navegación, NO el mecanismo de
 * autorización real: cada endpoint sigue validando contra `permiso_rol` en
 * el backend (`require_permission`, 010-administracion) sin importar lo que
 * el sidebar muestre. Si el backend devuelve 403, la UI lo declara — nunca
 * se asume que mostrar un ítem de menú basta para tener permiso.
 *
 * Los 4 códigos coinciden con el catálogo `rol` sembrado por la migración
 * de 010-administracion — si se agrega un rol nuevo ahí, este mapa hay que
 * actualizarlo a mano (es intencional: agregar un módulo de navegación es
 * una decisión de producto, no algo que deba inferirse solo).
 */

export type CodigoRol = 'dueno' | 'encargado_compras' | 'encargado_sucursal' | 'cajero'

export type CodigoModulo =
  | 'dashboard_dueno'
  | 'pos_cajero'
  | 'dashboard_sucursal'
  | 'compras_proveedores'
  | 'administracion'

export interface ItemNavegacion {
  modulo: CodigoModulo
  etiqueta: string
  ruta: string
}

const ITEMS_NAVEGACION: Record<CodigoModulo, ItemNavegacion> = {
  dashboard_dueno: { modulo: 'dashboard_dueno', etiqueta: 'Panel general', ruta: '/dueno' },
  pos_cajero: { modulo: 'pos_cajero', etiqueta: 'Punto de venta', ruta: '/pos' },
  dashboard_sucursal: { modulo: 'dashboard_sucursal', etiqueta: 'Mi sucursal', ruta: '/sucursal' },
  compras_proveedores: { modulo: 'compras_proveedores', etiqueta: 'Compras y proveedores', ruta: '/compras' },
  administracion: { modulo: 'administracion', etiqueta: 'Administración', ruta: '/admin' },
}

const MODULOS_POR_ROL: Record<CodigoRol, CodigoModulo[]> = {
  // Dueño / Gerencia General: red completa, analítica estratégica y asistente.
  dueno: ['dashboard_dueno', 'administracion'],
  // Rol corporativo (toda la red): proveedores y órdenes de compra.
  encargado_compras: ['compras_proveedores'],
  // Alcance limitado a su(s) sucursal(es) asignada(s).
  encargado_sucursal: ['dashboard_sucursal'],
  // Punto de venta de una sola sucursal.
  cajero: ['pos_cajero'],
}

const RUTA_INICIAL_POR_ROL: Record<CodigoRol, string> = {
  dueno: '/dueno',
  encargado_compras: '/compras',
  encargado_sucursal: '/sucursal',
  cajero: '/pos',
}

export function esCodigoRolConocido(valor: string): valor is CodigoRol {
  return valor in MODULOS_POR_ROL
}

export function itemsNavegacionParaRol(rol: CodigoRol): ItemNavegacion[] {
  return MODULOS_POR_ROL[rol].map((modulo) => ITEMS_NAVEGACION[modulo])
}

export function rutaInicialParaRol(rol: CodigoRol): string {
  return RUTA_INICIAL_POR_ROL[rol]
}

export function rolPuedeVerModulo(rol: CodigoRol, modulo: CodigoModulo): boolean {
  return MODULOS_POR_ROL[rol].includes(modulo)
}
