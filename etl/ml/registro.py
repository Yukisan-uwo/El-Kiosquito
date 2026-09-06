"""
Registro de versiones de modelo contra la API 011 (Art. 5.6/5.9) — capa
compartida por los 5 scripts de `ml/`. Cada script hace su propia
extracción de features y entrenamiento (`entrenar(...)`, que siempre
devuelve el mismo diccionario: `tamano_muestra`/`periodo_inicio`/
`periodo_fin`/`valor_metrica`); este módulo solo se ocupa de la parte
común, reportar ese resultado tal cual a la API.

Ningún script de `ml/` decide `activo` vs.
`descartado_datos_insuficientes` por su cuenta — eso lo decide el propio
servidor comparando `tamano_muestra` contra `modelo_ml.tamano_muestra_
minimo` (RN-AR-002, ver `registrar_version_modelo` en
`app/routers/analitica.py`). Acá solo se reporta honestamente cuántas
filas entrenaron el modelo, nunca se infla la muestra para que pase el
umbral.
"""

from datetime import date, datetime

from etl.pipeline_api import ClientePipelineApi


def generar_version(sufijo: str = "a") -> str:
    """Mismo formato de versión usado en el resto del proyecto:
    'AAAA.MM.DD-sufijo'."""
    return f"{datetime.utcnow():%Y.%m.%d}-{sufijo}"


def registrar(
    api: ClientePipelineApi,
    modelo: str,
    nombre_metrica: str,
    resultado_entrenamiento: dict,
) -> dict:
    """`resultado_entrenamiento` es el dict que devuelve cada
    `entrenar(...)` de `ml/<modelo>.py`. Si `tamano_muestra` es 0 (sin
    ningún dato todavía, p. ej. `evaluacion_churn` vacía) no tiene
    sentido ni siquiera llamar a la API con un periodo `None` — se
    reporta localmente y se corta acá, no es un error del pipeline."""
    if resultado_entrenamiento["tamano_muestra"] == 0:
        return {
            "modelo": modelo,
            "estado": "sin_datos",
            "tamano_muestra": 0,
            "motivo": "todavía no hay ninguna fila fuente para este modelo",
        }

    return api.registrar_version_modelo(
        modelo=modelo,
        version=generar_version(),
        tamano_muestra=resultado_entrenamiento["tamano_muestra"],
        periodo_inicio=resultado_entrenamiento["periodo_inicio"],
        periodo_fin=resultado_entrenamiento["periodo_fin"],
        nombre_metrica=nombre_metrica,
        valor_metrica=resultado_entrenamiento["valor_metrica"],
    )
