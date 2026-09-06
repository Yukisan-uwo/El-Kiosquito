import os, psycopg
dsn = os.environ["DATABASE_URL"].replace("+psycopg", "")
conn = psycopg.connect(dsn)
cur = conn.cursor()
cur.execute("INSERT INTO cliente (nombre, contacto) VALUES (%s, %s) RETURNING id", ("Luis", "zambranoxz37@gmail.com"))
cliente_id = cur.fetchone()[0]
conn.commit()
print(cliente_id)
