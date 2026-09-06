"""
Dependencias de FastAPI compartidas por los routers de los 11 módulos:
identidad (`get_current_user`), autorización genérica contra la matriz
`permiso_rol` (`require_permission`), el caso dueño-exclusivo que no tiene
`recurso_sistema` propio (`require_dueno` — mismo criterio que
`pregunta_asistente` en 011), y el helper de auditoría inmutable
(`log_accion`, Art. 10.5 / RNF-AD-001).
"""

from collections.abc import Callable

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWTError
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.database import get_db
from app.models.administracion import LogAuditoria, PermisoRol, Rol, Usuario

# auto_error=False: sin esto, HTTPBearer devuelve 403 cuando no hay header
# Authorization en absoluto (bug conocido de FastAPI) — acá se homologa a
# 401 en todos los casos (falta, mal formado o vencido), como corresponde
# a un endpoint bearerAuth.
_bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    db: Session = Depends(get_db),
) -> Usuario:
    credenciales_invalidas = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Credenciales inválidas o token vencido",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None:
        raise credenciales_invalidas
    try:
        payload = decode_access_token(credentials.credentials)
        usuario_id = int(payload["sub"])
    except (PyJWTError, KeyError, ValueError) as exc:
        raise credenciales_invalidas from exc

    usuario = db.get(Usuario, usuario_id)
    if usuario is None or not usuario.activo:
        # RN de baja lógica: un token emitido antes de desactivarUsuario
        # (OO-AD06) deja de servir en cuanto activo pasa a false, sin
        # esperar a que venza por tiempo.
        raise credenciales_invalidas
    return usuario


def require_permission(recurso: str, operacion: str) -> Callable[..., Usuario]:
    """Fábrica de dependencia: autoriza contra la fila `permiso_rol` de
    (rol del usuario, recurso, operacion) — nunca compara contra el código
    de rol en el propio endpoint (RN-AD-004: agregar un rol no debe tocar
    el código de los routers, solo la matriz sembrada en BD)."""

    def checker(
        current_user: Usuario = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> Usuario:
        permiso = (
            db.query(PermisoRol)
            .filter_by(rol=current_user.rol, recurso=recurso, operacion=operacion)
            .first()
        )
        if permiso is None or not permiso.permitido:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"El rol '{current_user.rol}' no tiene permiso de "
                f"'{operacion}' sobre '{recurso}'",
            )
        return current_user

    return checker


def require_dueno(
    current_user: Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Usuario:
    """Para recursos sin fila propia en `recurso_sistema` (la matriz de
    auditoría y la de permisos son datos sobre el propio sistema RBAC, no
    un recurso de negocio) — se valida por `nivel_jerarquico == 1`, no por
    el código literal 'dueno', mismo criterio que `alcance_cadena` en
    scoping.py (RN-AD-004)."""

    rol = db.get(Rol, current_user.rol)
    if rol is None or rol.nivel_jerarquico != 1:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Este recurso es exclusivo del rol con mayor jerarquía (dueño)",
        )
    return current_user


def log_accion(
    db: Session,
    *,
    usuario_id: int | None,
    accion: str,
    recurso: str,
    exitoso: bool,
    recurso_id: int | None = None,
    sucursal_id: int | None = None,
    detalle: dict | None = None,
    request: Request | None = None,
) -> None:
    """Escribe en `log_auditoria` — estrictamente append-only (RNF-AD-001).
    Hace su propio commit: una falla al registrar la sesión de negocio (p.
    ej. RBAC deniega) no debe perder la auditoría de que ocurrió."""

    entry = LogAuditoria(
        usuario_id=usuario_id,
        accion=accion,
        recurso=recurso,
        recurso_id=recurso_id,
        sucursal_id=sucursal_id,
        detalle=detalle,
        exitoso=exitoso,
        ip_origen=(request.client.host if request and request.client else None),
    )
    db.add(entry)
    db.commit()
