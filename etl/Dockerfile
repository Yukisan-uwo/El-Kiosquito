# Imagen de Airflow con las dependencias del paquete etl/ (psycopg,
# clickhouse-driver, requests) instaladas encima de la base oficial.
# Se usa para airflow-init / airflow-webserver / airflow-scheduler en
# docker-compose.yml — las tres corren la MISMA imagen, cada una con un
# `command` distinto (patrón estándar de Airflow, no hace falta una
# imagen por rol).
FROM apache/airflow:2.10.3-python3.11

COPY requirements.txt /tmp/requirements-etl.txt
RUN pip install --no-cache-dir -r /tmp/requirements-etl.txt
