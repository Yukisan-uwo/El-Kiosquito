"""
Conexiones a las dos bases del pipeline. PostgreSQL es la fuente,
ClickHouse el destino — ver el-kiosquito-clickhouse-fact-dim.md §1.

El cliente de ClickHouse usa `clickhouse-driver` (protocolo nativo,
puerto 9000) en vez de `clickhouse-connect` (HTTP): este último asume
en su secuencia de inicialización columnas de `system.settings` que no
existen en versiones de ClickHouse anteriores a la que trae el
`docker-compose.yml` de este proyecto. `clickhouse-driver` es
compatible con ambas, así que es el que se usa en todo el paquete —
`ClienteClickHouse` expone una interfaz mínima (`query`/`command`/
`insert`) para que el resto del código no dependa de los detalles del
driver elegido.
"""

import time
from contextlib import contextmanager
from types import SimpleNamespace

import psycopg
from clickhouse_driver import Client as _ClickHouseDriverClient

from etl.config import settings


@contextmanager
def postgres_conn():
    conn = psycopg.connect(settings.postgres_dsn)
    try:
        yield conn
    finally:
        conn.close()


class ClienteClickHouse:
    """Los parámetros de consulta usan el estilo `%(nombre)s` de
    `clickhouse-driver` (sustitución en el propio driver, no en el
    servidor) — distinto del `{nombre:Tipo}` de `clickhouse-connect`."""

    def __init__(self, client: _ClickHouseDriverClient):
        self._client = client

    def query(self, sql: str, parameters: dict | None = None):
        filas = self._client.execute(sql, parameters or {})
        return SimpleNamespace(result_rows=filas)

    def command(self, sql: str, parameters: dict | None = None):
        return self._client.execute(sql, parameters or {})

    def mutacion_sincrona(self, sql: str, tabla: str, parameters: dict | None = None, timeout_seg: float = 30.0) -> None:
        """Para `ALTER TABLE ... UPDATE/DELETE`: ClickHouse ejecuta estas
        mutaciones EN SEGUNDO PLANO — una lectura hecha justo después
        (p.ej. `recalibrar_hora_pico` verificando su propio resultado, o
        un reporte que corre apenas termina el ETL) puede ver los datos
        todavía sin actualizar. La setting `mutations_sync=1` resolvería
        esto directamente, pero no existe en ClickHouse 18.16.1 (el único
        paquete apt disponible en este sandbox — `DB::Exception: Unknown
        setting mutations_sync`); si se pasa y el server la rechaza, se
        reintenta sin ella. Para que el pipeline sea correcto en AMBAS
        versiones (la vieja de aquí y la moderna de docker-compose.yml),
        el que realmente garantiza la consistencia es el sondeo de
        `system.mutations` hasta `is_done=1` — esa tabla y columna sí
        existen desde siempre. `DROP PARTITION`, TRUNCATE e INSERT no son
        mutaciones y no pasan por este método."""
        try:
            self._client.execute(sql, parameters or {}, settings={"mutations_sync": 1})
            return
        except Exception as exc:  # noqa: BLE001 — setting inexistente en versiones viejas
            if "mutations_sync" not in str(exc):
                raise
            self._client.execute(sql, parameters or {})

        limite = time.monotonic() + timeout_seg
        while time.monotonic() < limite:
            pendientes = self._client.execute(
                "SELECT count() FROM system.mutations WHERE table = %(t)s AND is_done = 0",
                {"t": tabla},
            )[0][0]
            if pendientes == 0:
                return
            time.sleep(0.2)
        raise TimeoutError(f"mutación sobre {tabla} no terminó en {timeout_seg}s")

    def insert(self, table: str, data: list[tuple], column_names: list[str]) -> None:
        columnas = ", ".join(column_names)
        self._client.execute(f"INSERT INTO {table} ({columnas}) VALUES", data)


def clickhouse_client() -> ClienteClickHouse:
    return ClienteClickHouse(
        _ClickHouseDriverClient(
            host=settings.clickhouse_host,
            port=settings.clickhouse_native_port,
            database=settings.clickhouse_database,
            user=settings.clickhouse_user,
            password=settings.clickhouse_password,
        )
    )
