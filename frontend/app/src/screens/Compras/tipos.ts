/**
 * Tipos de la pantalla de Compras y Proveedores (Tarea #57). Reflejan
 * exactamente los esquemas Pydantic reales de 008-compras-proveedores y
 * 009-expansion-sucursales (enmienda v1.3/v1.2 respectivamente).
 *
 * Importante — campos `Decimal`: Pydantic los serializa como STRING en el
 * JSON real (verificado con HTTP real: `"cantidad_pedida": "100.000"`,
 * nunca `100`), no como number. Bug real encontrado y corregido en
 * `DashboardSucursal` por tipar estos campos como `number` y sumarlos con
 * `+` directo (concatenación de texto en JS cuando el operando es
 * string, no suma). Acá se tipan `string` desde el principio y se
 * convierten con `Number(...)` en el único punto donde hace falta operar
 * con ellos — nunca antes, y nunca se muestran ni se comparan como texto.
 */

export interface Proveedor {
  id: number
  nombre: string
  contacto: string | null
  activo: boolean
}

export interface Sucursal {
  id: number
  nombre: string
  direccion: string
  responsable_id: number | null
  estado: string
  fecha_registro: string
  fecha_activacion: string | null
}

export interface FormaPago {
  codigo: string
  etiqueta: string
  dias_plazo_default: number
  activo: boolean
}

export interface EstadoOrdenCompra {
  codigo: string
  etiqueta: string
  permite_recepcion: boolean
  es_estado_final: boolean
  activo: boolean
}

export interface DetalleOrdenCompra {
  id: number
  producto_id: number
  cantidad_pedida: string
  cantidad_recibida: string
  precio_ofrecido: string
  pronostico_consultado: boolean
  motivo_no_siguio_pronostico: string | null
}

export interface OrdenCompra {
  id: number
  proveedor_id: number
  sucursal_id: number
  fecha_pedido: string
  es_oferta: boolean
  forma_pago: string
  estado: string
  items: DetalleOrdenCompra[]
}

export interface HistorialCostoProducto {
  producto_id: number
  proveedor_id: number
  costo: string
  fecha: string
}

export interface PronosticoParaCompra {
  producto_id: number
  datos_suficientes: boolean
  cantidad_recomendada: string | null
}

/** Subconjunto de `GET /productos` que usa el selector de ítems de una
 * orden nueva — el mismo endpoint que ya usa PosCajero/DashboardSucursal,
 * aquí solo para elegir qué producto pedir, nunca para ver precio de
 * venta (irrelevante en una compra: lo que importa es el precio ofrecido
 * por el proveedor, que el usuario escribe a mano). */
export interface ProductoCatalogo {
  id: number
  nombre: string
  codigo_barras: string | null
  categoria_nombre: string
}
