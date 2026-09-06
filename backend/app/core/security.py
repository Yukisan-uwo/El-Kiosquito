"""
Hashing de contraseñas y JWT (RF-AD-010). Sin `passlib`: `bcrypt` se usa
directo (ya está pinneado en requirements.txt) y `PyJWT` para el token —
son las dos únicas piezas criptográficas que necesita este módulo.
"""

from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt

from app.core.config import settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        # Hash corrupto/con formato inesperado — nunca autenticar por defecto.
        return False


def create_access_token(*, usuario_id: int, rol: str, sucursal_ids: list[int]) -> str:
    """Claims de rol y sucursal(es) en el propio token (RF-AD-010) — evita
    una consulta a `usuario`/`usuario_sucursal` en cada request solo para
    saber el alcance; `get_current_user` sí vuelve a leer `usuario` para
    confirmar que sigue activo (RN de baja lógica, ver desactivarUsuario)."""

    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": str(usuario_id),
        "rol": rol,
        "sucursal_ids": sucursal_ids,
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_expire_minutes),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def decode_access_token(token: str) -> dict[str, Any]:
    """Lanza `jwt.PyJWTError` (o una subclase) si el token es inválido,
    está mal firmado o venció — `deps.get_current_user` lo traduce a 401."""

    return jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
