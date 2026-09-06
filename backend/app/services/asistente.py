"""
Orquestación del asistente conversacional (Art. 5.10, enmienda v1.4.0):
recibe la pregunta en lenguaje natural del Dueño, la manda a OpenRouter
con el catálogo de tools de `services/asistente_tools.py`, ejecuta
localmente las tools que el modelo elija (nunca deja que el LLM toque la
base de datos directo), le devuelve el resultado real, y deja que el LLM
redacte la respuesta final SOLO a partir de esos resultados.

Mecánica obligatoria del Art. 5.10 traducida a este loop:
- "traduce la pregunta a una consulta estructurada sobre datos reales":
  cada tool_call que el LLM emite ES esa consulta estructurada —
  `_consulta_generada()` arma la representación auditable (nombre de la
  tool + argumentos) que se persiste en `pregunta_asistente.consulta_
  generada` (RN-AR-003).
- "responde solo con lo que esa consulta devuelve": el resultado de cada
  tool se inyecta de vuelta al LLM como mensaje `role=tool`; el prompt de
  sistema le prohíbe explícitamente usar cualquier cifra que no venga de
  ahí. Si el modelo no invoca ninguna tool, NO se deja pasar como
  respuesta válida (ver `_SIN_CONSULTA`) — la honestidad de 5.10 no es
  una sugerencia de prompt, es una rama de código.

No se testeó contra la red real de OpenRouter en el sandbox de
desarrollo (sin egress a `openrouter.ai` — confirmado con un `curl`
directo). Se probó con un doble de `_llamar_openrouter` (ver `tests/`);
la prueba end-to-end contra el proveedor real solo puede correr en la
máquina del usuario, con Docker y la API key real de OpenRouter.
"""

import json
import logging
from datetime import date

import httpx
from sqlalchemy.orm import Session

from app.core.clickhouse import ClienteClickHouseSoloLectura, clickhouse_client_solo_lectura
from app.core.config import settings
from app.services.asistente_tools import EJECUTORES, TOOLS_SCHEMA

log = logging.getLogger("asistente")

_MAX_ITERACIONES_TOOL_CALLING = 4

_SISTEMA = """Sos el asistente de analítica de El Kiosquito, una cadena de \
minimarkets de barrio. Respondés SOLO preguntas del Dueño/Gerencia \
General sobre datos ya consolidados de la cadena (ventas, merma, \
márgenes, inventario, modelos de ML).

Regla no negociable (Art. 5.10 de la constitución del proyecto): NUNCA \
respondas con una cifra, tendencia o recomendación que no provenga \
literalmente del resultado de una tool que hayas invocado. Si no tenés \
una tool que responda la pregunta, decilo explícitamente en vez de \
inventar un número — es preferible una respuesta honesta de "no tengo \
esa consulta disponible" a una cifra inventada.

Para responder CUALQUIER pregunta con datos, DEBÉS invocar al menos una \
tool primero. No respondas nunca con una cifra en el primer turno sin \
haber llamado una tool.

Hoy es {fecha_hoy}. Cuando la pregunta use expresiones relativas ("esta \
semana", "este mes", "los últimos 30 días"), calculá vos las fechas \
concretas (YYYY-MM-DD) a partir de hoy antes de invocar la tool.

Respondé siempre en español, en un párrafo breve y directo, citando \
nombres de sucursal/producto/categoría (no solo IDs) cuando la tool los \
devuelva. Si una tool devuelve una lista vacía, decí explícitamente que \
no hay datos para ese rango — no lo interpretes como "todo está bien"."""

_SIN_CONSULTA = "(el modelo no invocó ninguna tool — no hay consulta real que auditar)"


class ErrorAsistente(Exception):
    """Cubre tanto fallas de red/HTTP contra OpenRouter como una
    respuesta que, tras agotar los reintentos, sigue sin haber invocado
    ninguna tool — en ambos casos el router la traduce a un 502, nunca a
    un 500 silencioso."""


def _llamar_openrouter(mensajes: list[dict]) -> dict:
    if not settings.openrouter_api_key:
        raise ErrorAsistente(
            "OPENROUTER_API_KEY no está configurada — el asistente conversacional (Art. 5.10) "
            "requiere una API key propia de OpenRouter, fuera del Docker Compose local."
        )
    try:
        resp = httpx.post(
            f"{settings.openrouter_base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.openrouter_api_key}",
                "Content-Type": "application/json",
                # Headers recomendados por OpenRouter para atribución del
                # tráfico de la app — no afectan la funcionalidad. httpx
                # codifica los valores de header en ASCII puro por
                # default (UnicodeEncodeError si llevan tildes/guion
                # largo/etc, un bug real encontrado al probar contra
                # OpenRouter real, nunca contra el doble de pruebas) —
                # por eso este valor va sin ñ ni "—", nunca por estética.
                "HTTP-Referer": "https://github.com/el-kiosquito",
                "X-Title": "El Kiosquito - Asistente Dueno",
            },
            json={
                "model": settings.openrouter_model,
                "messages": mensajes,
                "tools": TOOLS_SCHEMA,
                "tool_choice": "auto",
                "temperature": 0.2,  # respuestas de analítica de negocio, no creativas
            },
            timeout=45.0,
        )
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPStatusError as exc:
        raise ErrorAsistente(f"OpenRouter devolvió {exc.response.status_code}: {exc.response.text[:500]}") from exc
    except httpx.HTTPError as exc:
        raise ErrorAsistente(f"No se pudo conectar con OpenRouter: {exc}") from exc
    except ErrorAsistente:
        raise
    except Exception as exc:
        # Cualquier otra falla inesperada armando o mandando la request
        # (el UnicodeEncodeError real de arriba fue una de estas, no un
        # httpx.HTTPError) — el propio docstring de ErrorAsistente
        # promete que el router nunca ve un 500 silencioso desde acá, así
        # que ningún error de este bloque puede escapar sin convertirse
        # en ErrorAsistente/502.
        raise ErrorAsistente(f"Fallo inesperado llamando a OpenRouter: {exc}") from exc


def _ejecutar_tool_call(ch: ClienteClickHouseSoloLectura, db: Session, tool_call: dict) -> tuple[str, str, dict]:
    nombre = tool_call["function"]["name"]
    try:
        argumentos = json.loads(tool_call["function"]["arguments"] or "{}")
    except json.JSONDecodeError:
        argumentos = {}

    ejecutor = EJECUTORES.get(nombre)
    if ejecutor is None:
        # El LLM inventó un nombre de tool que no existe en el catálogo —
        # nunca se ejecuta código para un nombre no reconocido.
        resultado = {"error": f"tool '{nombre}' no existe en el catálogo del asistente"}
    else:
        try:
            resultado = ejecutor(ch, db, **argumentos)
        except Exception as exc:  # noqa: BLE001 — cualquier falla de la tool se reporta al LLM, no rompe el request
            log.exception("Fallo ejecutando tool '%s' con args %s", nombre, argumentos)
            resultado = {"error": f"la consulta falló: {exc}"}

    return nombre, json.dumps(resultado, default=str, ensure_ascii=False), argumentos


def _consulta_generada(llamadas: list[tuple[str, dict]]) -> str:
    if not llamadas:
        return _SIN_CONSULTA
    partes = []
    for nombre, argumentos in llamadas:
        args_legibles = ", ".join(f"{k}={v}" for k, v in argumentos.items())
        partes.append(f"{nombre}({args_legibles})")
    return "; ".join(partes)


def preguntar(pregunta_texto: str, db: Session) -> dict:
    """Punto de entrada usado por el router. Devuelve
    {'consulta_generada': str, 'respuesta_texto': str}, siempre con
    ambos campos no vacíos (satisface RN-AR-003 incluso en el camino de
    error: `_SIN_CONSULTA` no es una cadena vacía)."""

    ch = clickhouse_client_solo_lectura()
    mensajes = [
        {"role": "system", "content": _SISTEMA.format(fecha_hoy=date.today().isoformat())},
        {"role": "user", "content": pregunta_texto},
    ]
    llamadas_reales: list[tuple[str, dict]] = []

    for _ in range(_MAX_ITERACIONES_TOOL_CALLING):
        respuesta = _llamar_openrouter(mensajes)
        mensaje = respuesta["choices"][0]["message"]
        tool_calls = mensaje.get("tool_calls") or []

        if not tool_calls:
            # Primer turno sin ninguna tool invocada en todo el
            # intercambio: no se acepta como respuesta de datos reales
            # (Art. 5.10) — se corta acá con una respuesta honesta en vez
            # de reintentar indefinidamente.
            if not llamadas_reales:
                return {
                    "consulta_generada": _SIN_CONSULTA,
                    "respuesta_texto": (
                        "No tengo una consulta de datos disponible para responder esa pregunta con "
                        "información real — puedo responder sobre merma, márgenes, rotación de "
                        "inventario, demanda insatisfecha, cuadre de caja y las métricas de los 5 "
                        "modelos de ML."
                    ),
                }
            return {
                "consulta_generada": _consulta_generada(llamadas_reales),
                "respuesta_texto": mensaje.get("content") or "",
            }

        mensajes.append(mensaje)
        for tool_call in tool_calls:
            nombre, resultado_json, argumentos = _ejecutar_tool_call(ch, db, tool_call)
            llamadas_reales.append((nombre, argumentos))
            mensajes.append(
                {
                    "role": "tool",
                    "tool_call_id": tool_call["id"],
                    "content": resultado_json,
                }
            )

    # Se agotaron las iteraciones sin una respuesta final sin tool_calls
    # — se devuelve lo que se alcanzó a consultar en vez de fallar en
    # silencio; queda igualmente auditado.
    return {
        "consulta_generada": _consulta_generada(llamadas_reales) if llamadas_reales else _SIN_CONSULTA,
        "respuesta_texto": (
            "No pude terminar de armar una respuesta completa dentro del límite de pasos — "
            "las consultas que sí se ejecutaron quedaron registradas igual."
        ),
    }
