"""
Configuración del ETL — todo por variable de entorno, sin valores por
defecto que apunten a producción. Los defaults acá son los del entorno
de desarrollo local (mismo patrón que app/core/config.py del backend).
"""

import os


class Settings:
    postgres_dsn: str = os.environ.get(
        "POSTGRES_DSN", "postgresql://elkiosquito:elkiosquito_dev@localhost:5432/elkiosquito"
    )
    # Puerto nativo (clickhouse-driver) — no el HTTP 8123.
    clickhouse_native_port: int = int(os.environ.get("CLICKHOUSE_NATIVE_PORT", "9000"))
    clickhouse_host: str = os.environ.get("CLICKHOUSE_HOST", "localhost")
    clickhouse_database: str = os.environ.get("CLICKHOUSE_DATABASE", "elkiosquito_dw")
    clickhouse_user: str = os.environ.get("CLICKHOUSE_USER", "default")
    clickhouse_password: str = os.environ.get("CLICKHOUSE_PASSWORD", "")

    # API 011-analitica-reportes del propio backend — el DAG se autentica
    # como una cuenta de servicio con rol dueño (única con crear/leer en
    # los recursos modelo_ml/pipeline_etl/asistente, ver RBAC del router).
    api_base_url: str = os.environ.get("API_BASE_URL", "http://localhost:8000/api/v1")
    api_service_email: str = os.environ.get("API_SERVICE_EMAIL", "")
    api_service_password: str = os.environ.get("API_SERVICE_PASSWORD", "")


settings = Settings()
