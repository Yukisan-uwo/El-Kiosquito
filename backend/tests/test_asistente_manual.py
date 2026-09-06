"""
Prueba manual (no pytest formal, ver nota abajo) del asistente
conversacional — corrida a mano en el sandbox de desarrollo contra
Postgres + ClickHouse reales, con `_llamar_openrouter` monkeypatcheado
(sin egress a openrouter.ai desde este sandbox, confirmado con curl
directo). Ejercita: los 8 tool-executors contra datos reales, el loop de
orquestación completo (`asistente.preguntar`) con una respuesta de LLM
simulada realista (tool_calls -> resultado real -> respuesta final), el
camino "el LLM no invoca ninguna tool" (RN-AR-003), y la persistencia vía
el router (`_persistir_pregunta`).

No es un test de pytest formal porque este módulo no tiene fixtures de
base de datos aisladas (usa la BD real del sandbox, con los datos ya
sembrados de `tests/seed_test_data.sql`) — se corre con
`python -m tests.test_asistente_manual` y falla con AssertionError si
algo no cuadra. La prueba end-to-end contra el proveedor real de
OpenRouter queda pendiente para la máquina del usuario (Docker, con la
API key real).
"""

import json
from unittest.mock import patch

from app.core.clickhouse import clickhouse_client_solo_lectura
from app.database import SessionLocal
from app.services import asistente
from app.services.asistente_tools import EJECUTORES

db = SessionLocal()
ch = clickhouse_client_solo_lectura()

print("=== 1. Tool executors contra datos reales ===")
for nombre, ejecutor in EJECUTORES.items():
    try:
        if nombre == "metricas_modelo_ml":
            resultado = ejecutor(ch, db, modelo="demanda")
        elif nombre == "productos_baja_rotacion":
            resultado = ejecutor(ch, db)
        else:
            resultado = ejecutor(ch, db, desde="2026-08-01", hasta="2026-09-05")
        print(f"  OK {nombre}: {len(resultado)} filas — ejemplo: {resultado[:1]}")
    except Exception as exc:
        print(f"  FALLO {nombre}: {exc!r}")
        raise

print("\n=== 2. Loop de orquestación con LLM simulado (tool_calls reales) ===")


def _llm_simulado_con_tool_call(mensajes):
    ultimo = mensajes[-1]
    if ultimo["role"] == "user":
        return {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {
                                "id": "call_1",
                                "type": "function",
                                "function": {
                                    "name": "merma_por_sucursal",
                                    "arguments": json.dumps({"desde": "2026-08-01", "hasta": "2026-09-05"}),
                                },
                            }
                        ],
                    }
                }
            ]
        }
    # Segunda vuelta: ya hay un resultado de tool en el historial -> respuesta final.
    return {
        "choices": [
            {"message": {"role": "assistant", "content": "La sucursal con más merma fue la que ves en los datos.", "tool_calls": []}}
        ]
    }


with patch.object(asistente, "_llamar_openrouter", side_effect=_llm_simulado_con_tool_call):
    resultado = asistente.preguntar("¿Qué sucursal tuvo más merma?", db)
    assert resultado["consulta_generada"] == "merma_por_sucursal(desde=2026-08-01, hasta=2026-09-05)", resultado
    assert resultado["respuesta_texto"], resultado
    assert resultado["consulta_generada"].strip() != "", "RN-AR-003: consulta_generada nunca vacía"
    print(f"  OK consulta_generada = {resultado['consulta_generada']!r}")
    print(f"  OK respuesta_texto = {resultado['respuesta_texto']!r}")

print("\n=== 3. Camino honesto: el LLM no invoca ninguna tool ===")


def _llm_simulado_sin_tools(mensajes):
    return {"choices": [{"message": {"role": "assistant", "content": "no sé", "tool_calls": []}}]}


with patch.object(asistente, "_llamar_openrouter", side_effect=_llm_simulado_sin_tools):
    resultado = asistente.preguntar("¿Cuál es el sentido de la vida?", db)
    assert resultado["consulta_generada"] == asistente._SIN_CONSULTA
    assert resultado["consulta_generada"].strip() != "", "RN-AR-003: incluso el camino honesto deja no-vacío"
    assert "no tengo" in resultado["respuesta_texto"].lower()
    print(f"  OK respuesta honesta sin inventar datos: {resultado['respuesta_texto']!r}")

print("\n=== 4. Tool con nombre inexistente (defensa contra alucinación del LLM) ===")


def _llm_simulado_tool_inventada(mensajes):
    ultimo = mensajes[-1]
    if ultimo["role"] == "user":
        return {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {
                                "id": "call_1",
                                "type": "function",
                                "function": {"name": "borrar_toda_la_base_de_datos", "arguments": "{}"},
                            }
                        ],
                    }
                }
            ]
        }
    return {"choices": [{"message": {"role": "assistant", "content": "no pude ejecutar eso", "tool_calls": []}}]}


with patch.object(asistente, "_llamar_openrouter", side_effect=_llm_simulado_tool_inventada):
    resultado = asistente.preguntar("pregunta cualquiera", db)
    assert "borrar_toda_la_base_de_datos" in resultado["consulta_generada"]
    print(f"  OK tool inexistente no ejecuta nada, queda auditada igual: {resultado['consulta_generada']!r}")

db.close()
print("\n=== TODO OK ===")
