/**
 * Tipos de la pantalla del POS del cajero (Tarea #55). Reflejan exactamente
 * los esquemas Pydantic reales que devuelven los endpoints que consume esta
 * pantalla — nunca un tipo "aspiracional" que el backend todavía no cumple.
 */

export interface ProductoBusqueda {
  id: number
  nombre: string
  codigo_barras: string | null
  categoria_id: number
  categoria_nombre: string
  unidad_venta_codigo: string
  es_fraccionable: boolean
  activo: boolean
  /** null si el producto no tiene un precio vigente en esta sucursal — el
   * POS nunca deja agregarlo al carrito en ese caso (RN-CVI-010 de 001). */
  precio_venta_vigente: number | null
}

export interface TurnoCaja {
  id: number
  sucursal_id: number
  cajero_id: number
  hora_apertura: string
  monto_inicial: number
  hora_cierre: string | null
  monto_contado: number | null
  monto_esperado: number | null
  diferencia: number | null
  motivo_diferencia: string | null
  estado: string
}

export interface MetodoPago {
  codigo: string
  etiqueta: string
  es_electronico: boolean
  orden: number
}

export interface DatafonoDisponible {
  id: number
  codigo_serie: string
}

export interface VentaOut {
  id: number
  numero_documento: string
  sucursal_id: number
  turno_caja_id: number
  total: number
  metodo_pago: string
  estado_venta: string
  datafono_id: number | null
}

export interface PoliticaPrivacidad {
  version: string
  vigente_desde: string
  contenido: string
  punto_contacto: string
}

export interface ClienteOut {
  id: number
  nombre: string
  contacto: string | null
  fecha_nacimiento: string | null
  creado_en: string
  consentimiento_privacidad_en: string
  version_politica_privacidad: string
}

export interface ItemCarrito {
  producto: ProductoBusqueda
  cantidad: number
}

/** RF-CF-013 (002, enmienda v1.3) — cliente ya registrado que el cajero
 * eligió de los resultados de `GET /clientes?q=`. Se guarda también el
 * nombre para mostrarlo sin volver a pedirlo al backend. */
export interface ClienteExistenteSeleccionado {
  id: number
  nombre: string
}
