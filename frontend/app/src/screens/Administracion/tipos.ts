/**
 * Tipos de la pantalla de Administración (Tarea #58). Reflejan
 * exactamente los esquemas Pydantic reales de 010-administracion
 * (enmienda v1.2): `Usuario` ganó `sucursal_ids` (calculado desde
 * `usuario_sucursal`, nunca inventado) y `SolicitudArco` ganó `detalle` +
 * los tres campos que deja una resolución (`fecha_resolucion`,
 * `atendida_por`, `respuesta`) — antes de esta enmienda ninguno de los
 * dos existía en la respuesta real del backend.
 *
 * Igual que en `Compras`: todo campo `Decimal` de Pydantic llega como
 * STRING en el JSON real, nunca como number — acá no hay ninguno (IVA se
 * maneja como `valor: string` de `historial_parametro_sistema`, que ya es
 * TEXT en el modelo, no Decimal), pero se deja este comentario para que
 * quien extienda esta pantalla no vuelva a caer en ese bug.
 */

export interface Usuario {
  id: number
  nombre: string
  email: string
  rol: string
  activo: boolean
  sucursal_ids: number[]
}

export interface Rol {
  codigo: string
  etiqueta: string
  nivel_jerarquico: number
  alcance_cadena: boolean
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

export interface ChecklistItem {
  item: string
  completado: boolean
  fecha_completado: string | null
}

export interface EstadoApertura {
  sucursal: Sucursal
  checklist: ChecklistItem[]
}

export interface HerenciaCatalogo {
  sucursal_id: number
  cantidad_productos_heredados: number
  cantidad_productos_pendientes: number
  fecha: string
}

export interface ItemChecklistCatalogo {
  codigo: string
  etiqueta: string
  orden: number
  es_bloqueante: boolean
  activo: boolean
}

export interface RecursoSistema {
  codigo: string
  etiqueta: string
  modulo: string
  es_auditable: boolean
  activo: boolean
}

export interface Operacion {
  codigo: string
  etiqueta: string
  es_escritura: boolean
  activo: boolean
}

export interface PermisoRol {
  rol: string
  recurso: string
  operacion: string
  permitido: boolean
}

export interface LogAuditoria {
  id: number
  usuario_id: number | null
  accion: string
  recurso: string
  recurso_id: number | null
  sucursal_id: number | null
  detalle: unknown
  exitoso: boolean
  ip_origen: string | null
  creado_en: string
}

export interface ParametroSistema {
  clave: string
  valor: string
  vigente_desde: string
}

export interface TipoSolicitudArco {
  codigo: string
  etiqueta: string
  plazo_respuesta_dias: number
  activo: boolean
}

export interface EstadoSolicitudArco {
  codigo: string
  etiqueta: string
  es_estado_final: boolean
  activo: boolean
}

export interface SolicitudArco {
  id: number
  cliente_id: number
  tipo: string
  detalle: string
  estado: string
  fecha_solicitud: string
  fecha_resolucion: string | null
  atendida_por: number | null
  respuesta: string | null
}

/** Subconjunto de `GET /clientes?q=` que usa el buscador de cliente al
 * registrar una solicitud ARCO — mismo endpoint y mismo criterio de
 * mínimo 2 caracteres que `ClienteVenta.tsx` de PosCajero. */
export interface ClienteBusqueda {
  id: number
  nombre: string
  contacto: string | null
}
