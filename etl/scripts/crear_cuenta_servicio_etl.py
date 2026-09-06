"""
Crea (o dejа sin tocar, si ya existe) la cuenta de servicio con rol
`dueno` contra la que se autentica el ETL — ver `etl/pipeline_api.py` y
el docstring de `api_service_email` en `etl/config.py`: es la única
manera de registrar `ejecucion_pipeline_etl`/`validacion_calidad_datos`
pasando por la API 011 en vez de escribir esas tablas por SQL directo.

Por qué un script aparte y no un endpoint de la API: crear el PRIMER
usuario de un sistema con RBAC es un problema de arranque clásico — todo
endpoint de creación de usuarios exige ya estar autenticado como alguien
con permiso para crear usuarios (010-administracion), así que la
primera cuenta no puede nacer por ahí. Este script inserta directamente
en `usuario` con el mismo hash de contraseña (`bcrypt`) que usa
`app/core/security.py`, para que el login por la API funcione idéntico
a cualquier otro usuario. Es idempotente: si el email ya existe, no
hace nada (no pisa una contraseña que el dueño real ya haya cambiado).

Uso:
    DATABASE_URL=postgresql://... \\
    ETL_SERVICE_EMAIL=etl@elkiosquito.local \\
    ETL_SERVICE_PASSWORD='...' \\
    python -m scripts.crear_cuenta_servicio_etl
"""

import os
import sys

import bcrypt
import psycopg


def main() -> int:
    dsn = os.environ.get("DATABASE_URL", "postgresql://elkiosquito:elkiosquito_dev@localhost:5432/elkiosquito")
    email = os.environ.get("ETL_SERVICE_EMAIL")
    password = os.environ.get("ETL_SERVICE_PASSWORD")
    if not email or not password:
        print("ETL_SERVICE_EMAIL y ETL_SERVICE_PASSWORD son obligatorias.", file=sys.stderr)
        return 1

    password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    with psycopg.connect(dsn, autocommit=True) as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM usuario WHERE email = %s", (email,))
        if cur.fetchone():
            print(f"Ya existe una cuenta con email={email}; no se modifica.")
            return 0

        cur.execute(
            "INSERT INTO usuario (nombre, email, password_hash, rol, activo) "
            "VALUES (%s, %s, %s, 'dueno', true)",
            ("Cuenta de servicio ETL", email, password_hash),
        )
        print(f"Cuenta de servicio creada: {email} (rol=dueno).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
