import os, bcrypt, psycopg
dsn = os.environ["DATABASE_URL"].replace("+psycopg", "")
h = bcrypt.hashpw(b"MiPasswordReal123", bcrypt.gensalt()).decode()
conn = psycopg.connect(dsn)
cur = conn.cursor()
cur.execute("SELECT id FROM usuario WHERE email = %s", ("lzambranop6@uteq.edu.ec",))
row = cur.fetchone()
if row:
    cur.execute("UPDATE usuario SET password_hash = %s, rol = %s, activo = true WHERE email = %s", (h, "dueno", "lzambranop6@uteq.edu.ec"))
    print("actualizado")
else:
    cur.execute("INSERT INTO usuario (nombre, email, password_hash, rol, activo) VALUES (%s,%s,%s,%s,true)", ("Mario","lzambranop6@uteq.edu.ec", h, "dueno"))
    print("creado")
conn.commit()
print("OK")
