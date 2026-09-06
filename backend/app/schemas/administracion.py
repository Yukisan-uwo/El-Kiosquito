"""
Esquemas Pydantic del contrato el-kiosquito-010-administracion-contracts-
openapi.yaml — un modelo `*In` por cada requestBody y uno `*Out` por cada
schema de respuesta, con los mismos nombres de campo que el contrato para
que el router no tenga que traducir nada.

`email` se valida como `str` (no `EmailStr`): el proyecto no tiene
`email-validator` como dependencia — igual que la columna `usuario.email`
en el modelo, que es `Text` sin CHECK de formato.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class LoginIn(BaseModel):
    email: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UsuarioCrearIn(BaseModel):
    nombre: str
    email: str
    password: str
    rol: str


class UsuarioActualizarIn(BaseModel):
    nombre: str | None = None
    email: str | None = None


class UsuarioRolSucursalesIn(BaseModel):
    rol: str
    sucursal_ids: list[int] | None = None


class UsuarioOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nombre: str
    email: str
    rol: str
    activo: bool
    # RF-AD-014-bis / Tarea #58 (enmienda v1.2): no viene de una columna de
    # `usuario` (from_attributes no la resuelve sola) — el router la arma
    # explícitamente desde `usuario_sucursal` en cada respuesta. Sin esto la
    # pantalla de Administración no puede mostrar de forma segura qué
    # sucursales tiene asignadas un usuario antes de dejar editarlas
    # (RN-AD-002/RN-AD-003: cambiarlas a ciegas arriesga vaciar el alcance
    # de alguien sin querer).
    sucursal_ids: list[int] = []


class PermisoRolOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    rol: str
    recurso: str
    operacion: str
    permitido: bool


class ParametroSistemaCrearIn(BaseModel):
    clave: str
    valor: str


class ParametroSistemaOut(BaseModel):
    clave: str
    valor: str
    vigente_desde: datetime


class SolicitudArcoCrearIn(BaseModel):
    cliente_id: int
    tipo: str
    detalle: str


class SolicitudArcoResolverIn(BaseModel):
    estado: str
    respuesta: str


class SolicitudArcoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    cliente_id: int
    tipo: str
    detalle: str
    estado: str
    fecha_solicitud: datetime
    # Enmienda v1.2 (Tarea #58 del frontend): faltaban en la respuesta. Sin
    # `detalle`, quien resuelve una solicitud ni siquiera puede leer qué pidió
    # el cliente; sin los tres campos de resolución, la respuesta a un
    # `PATCH .../resolver` exitoso no confirma lo que el backend acaba de
    # guardar (Art. 10.3: la resolución debe quedar registrada y verificable).
    fecha_resolucion: datetime | None = None
    atendida_por: int | None = None
    respuesta: str | None = None


class RolOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    codigo: str
    etiqueta: str
    nivel_jerarquico: int
    alcance_cadena: bool
    activo: bool


class RecursoSistemaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    codigo: str
    etiqueta: str
    modulo: str
    es_auditable: bool
    activo: bool


class OperacionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    codigo: str
    etiqueta: str
    es_escritura: bool
    activo: bool


class TipoSolicitudArcoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    codigo: str
    etiqueta: str
    plazo_respuesta_dias: int
    activo: bool


class EstadoSolicitudArcoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    codigo: str
    etiqueta: str
    es_estado_final: bool
    activo: bool
