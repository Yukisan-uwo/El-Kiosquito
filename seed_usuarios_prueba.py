"""
Seed de un usuario de prueba por cada rol real del sistema (rol.codigo:
dueno, encargado_compras, encargado_sucursal, cajero — ver
backend/alembic/versions/791f2fa5c65a_..._010_administracion_y_009_expansion_.py).
Idempotente: si el email ya existe, solo actualiza password/rol/activo en
vez de fallar por duplicado — se puede correr de nuevo sin problema.

Uso (desde la carpeta del proyecto, con el stack levantado):
  Get-Content seed_usuarios_prueba.py | docker compose exec -T backend python -
"""
import os
import bcrypt
import psycopg

dsn = os.environ["DATABASE_URL"].replace("+psycopg", "")
conn = psycopg.connect(dsn)
cur = conn.cursor()

USUARIOS = [
    ("Mario (Dueño)", "lzambranop6@uteq.edu.ec", "MiPasswordReal123", "dueno"),
    ("Prueba Compras", "compras@elkiosquito.test", "Prueba123!", "encargado_compras"),
    ("Prueba Sucursal", "sucursal@elkiosquito.test", "Prueba123!", "encargado_sucursal"),
    ("Prueba Cajero", "cajero@elkiosquito.test", "Prueba123!", "cajero"),
]

for nombre, email, password, rol in USUARIOS:
    h = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    cur.execute("SELECT id FROM usuario WHERE email = %s", (email,))
    row = cur.fetchone()
    if row:
        cur.execute(
            "UPDATE usuario SET password_hash = %s, rol = %s, activo = true WHERE email = %s",
            (h, rol, email),
        )
        print(f"actualizado: {email} ({rol})")
    else:
        cur.execute(
            "INSERT INTO usuario (nombre, email, password_hash, rol, activo) VALUES (%s,%s,%s,%s,true)",
            (nombre, email, h, rol),
        )
        print(f"creado: {email} ({rol})")

conn.commit()
print("OK — 4 usuarios listos, uno por rol")
