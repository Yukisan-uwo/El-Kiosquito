"""
Scoping por sucursal (Art. 3.3) — compartido por todos los módulos que
reciben un `sucursal_id` (directo o vía una tabla que lo tiene, como
`turno_caja`). Un rol con `alcance_cadena = true` (dueño, encargado de
compras) opera sobre toda la red; uno sin alcance_cadena (encargado de
sucursal, cajero) solo sobre las sucursales que tiene asignadas en
`usuario_sucursal` (010-administracion, `asignarRolYSucursales`).

Se resuelve siempre contra BD, nunca contra los claims `sucursal_ids` del
JWT: si `asignarRolYSucursales` cambia el alcance de un usuario después de
emitido su token, el próximo request ya debe reflejar el alcance nuevo,
no el que tenía el token al emitirse (mismo criterio que la revisión de
`usuario.activo` en `get_current_user`).
"""

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.administracion import Rol, Usuario, UsuarioSucursal


def verificar_alcance_sucursal(db: Session, usuario: Usuario, sucursal_id: int) -> None:
    rol = db.get(Rol, usuario.rol)
    if rol is not None and rol.alcance_cadena:
        return

    tiene_acceso = (
        db.query(UsuarioSucursal)
        .filter_by(usuario_id=usuario.id, sucursal_id=sucursal_id)
        .first()
        is not None
    )
    if not tiene_acceso:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="La sucursal indicada no pertenece al alcance de su rol (Art. 3.3)",
        )
