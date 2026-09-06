"""
Cliente de ClickHouse de solo lectura para el backend — hasta el asistente
conversacional (Art. 5.10), el backend nunca había necesitado hablar con
ClickHouse: la capa táctica era territorio exclusivo del pipeline ETL
(`etl/etl/db.py`). Esta clase deliberadamente NO expone `insert`/`command`
— las tools del asistente (`services/asistente_tools.py`) solo pueden leer
`elkiosquito_dw`, nunca escribirlo. Mismo driver (`clickhouse-driver`,
protocolo nativo) y misma forma de resultado (`SimpleNamespace(result_rows=
...)`, sin nombres de columna — limitación real del driver) que el ETL, para
no tener dos convenciones distintas de acceso al mismo motor en el proyecto.
"""

from types import SimpleNamespace

from clickhouse_driver import Client as _ClickHouseDriverClient

from app.core.config import settings


class ClienteClickHouseSoloLectura:
    def __init__(self, client: _ClickHouseDriverClient):
        self._client = client

    def query(self, sql: str, parameters: dict | None = None):
        filas = self._client.execute(sql, parameters or {})
        return SimpleNamespace(result_rows=filas)


def clickhouse_client_solo_lectura() -> ClienteClickHouseSoloLectura:
    return ClienteClickHouseSoloLectura(
        _ClickHouseDriverClient(
            host=settings.clickhouse_host,
            port=settings.clickhouse_native_port,
            database=settings.clickhouse_database,
            user=settings.clickhouse_user,
            password=settings.clickhouse_password,
        )
    )
