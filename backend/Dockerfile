# Imagen de la API (Art. 5.1). Aplica las migraciones de Alembic antes de
# arrancar uvicorn — así `docker-compose up` deja el esquema al día sin
# un paso manual aparte, tanto en el primer arranque como en uno
# posterior con migraciones nuevas.
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY alembic ./alembic
COPY alembic.ini .

EXPOSE 8000

CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
