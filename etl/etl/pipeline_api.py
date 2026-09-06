"""
Cliente HTTP contra la propia API 011-analitica-reportes del backend —
el DAG registra sus corridas ahí (`ejecucion_pipeline_etl`) y sus
validaciones de calidad (`validacion_calidad_datos`) en vez de escribir
esas tablas por SQL directo, para que ambas pasen por las mismas reglas
de negocio (RN-AR-*) y por la matriz RBAC real del backend, igual que
cualquier otro cliente de la API. Los 5 scripts de `ml/` (Art. 5.6)
reusan este mismo cliente para registrar cada versión de modelo
entrenada — misma cuenta de servicio `dueno`, mismo login, para no
duplicar la lógica de autenticación en un segundo cliente HTTP.
"""

from datetime import date

import requests

from etl.config import settings


class ClientePipelineApi:
    def __init__(self):
        self._token: str | None = None

    def _login(self) -> str:
        if self._token:
            return self._token
        resp = requests.post(
            f"{settings.api_base_url}/auth/login",
            json={"email": settings.api_service_email, "password": settings.api_service_password},
            timeout=10,
        )
        resp.raise_for_status()
        self._token = resp.json()["access_token"]
        return self._token

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self._login()}"}

    def registrar_ejecucion(
        self,
        dag_run_id: str,
        estado: str,
        sucursales_procesadas: int | None = None,
        filas_cargadas: int | None = None,
        mensaje_error: str | None = None,
    ) -> dict:
        """Se llama dos veces por corrida (al iniciar con
        `en_progreso` y al finalizar con `exitoso`/`error`) — el
        endpoint resuelve el upsert por `dag_run_id`, ver
        `registrar_ejecucion_pipeline` en app/routers/analitica.py."""
        payload = {"dag_run_id": dag_run_id, "estado": estado}
        if sucursales_procesadas is not None:
            payload["sucursales_procesadas"] = sucursales_procesadas
        if filas_cargadas is not None:
            payload["filas_cargadas"] = filas_cargadas
        if mensaje_error is not None:
            payload["mensaje_error"] = mensaje_error

        resp = requests.post(
            f"{settings.api_base_url}/analitica/pipeline/ejecuciones",
            json=payload, headers=self._headers(), timeout=10,
        )
        resp.raise_for_status()
        return resp.json()

    def registrar_validacion(
        self, ejecucion_id: int, regla_validada: str, aprobado: bool, detalle: str | None = None
    ) -> dict:
        payload = {"ejecucion_id": ejecucion_id, "regla_validada": regla_validada, "aprobado": aprobado}
        if detalle is not None:
            payload["detalle"] = detalle
        resp = requests.post(
            f"{settings.api_base_url}/analitica/pipeline/validaciones",
            json=payload, headers=self._headers(), timeout=10,
        )
        resp.raise_for_status()
        return resp.json()

    def registrar_version_modelo(
        self,
        modelo: str,
        version: str,
        tamano_muestra: int,
        periodo_inicio: date,
        periodo_fin: date,
        nombre_metrica: str,
        valor_metrica: float | None,
    ) -> dict:
        """POST /analitica/modelos/versiones (Art. 5.6/5.9). El propio
        endpoint decide `activo` vs. `descartado_datos_insuficientes`
        comparando `tamano_muestra` contra `modelo_ml.tamano_muestra_
        minimo` (RN-AR-002) — este cliente nunca decide el estado ni
        inventa un `motivo`, solo reporta honestamente cuántas filas
        entrenaron el modelo. `valor_metrica` se manda igual aunque el
        servidor lo descarte si faltan datos: es más simple que decidir
        acá cuándo omitirlo, y el servidor ya aplica RNF-AR-002."""
        resp = requests.post(
            f"{settings.api_base_url}/analitica/modelos/versiones",
            json={
                "modelo": modelo,
                "version": version,
                "tamano_muestra": tamano_muestra,
                "periodo_inicio": periodo_inicio.isoformat(),
                "periodo_fin": periodo_fin.isoformat(),
                "nombre_metrica": nombre_metrica,
                "valor_metrica": valor_metrica,
            },
            headers=self._headers(), timeout=10,
        )
        resp.raise_for_status()
        return resp.json()
