"""
Punto de entrada de la API (Art. 5.1). Un único FastAPI app; cada módulo de
`specs/` agrega su router aquí a medida que se implementa —
010-administracion (auth, RBAC, auditoría, parámetros, ARCO y catálogos),
001-core-ventas-inventario (productos, inventario, ventas),
002-clientes-fidelizacion (cliente, segmentación, churn),
003-precios-margenes (historial de precio, margen real, competencia,
clasificación comercial, recomendaciones), 004-pronostico-demanda
(demanda insatisfecha, ciclos de pronóstico, eventos locales),
005-promociones-inteligentes (cupón y su ciclo de vida),
006-caja-mermas-fraude (turno de caja, mermas, incidencias de cuadre,
alertas de fraude), 007-pagos-seguridad (datáfonos y su historial de
revisiones de seguridad), 008-compras-proveedores (proveedor, orden de
compra, recepciones, historial de costo), 009-expansion-sucursales
(sucursal, checklist de apertura, herencia de catálogo, activación) y
011-analitica-reportes (pipeline ETL, versiones de modelos de ML,
asistente conversacional dueño-exclusivo) — los 11 módulos de
`specs/` completos.

Arrancar en local: `uvicorn app.main:app --reload` (con `DATABASE_URL`
exportado y `alembic upgrade head` ya corrido).
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.routers import (
    administracion,
    analitica,
    caja,
    clientes,
    compras,
    core_ventas,
    expansion,
    gastos,
    pagos,
    precios,
    promociones,
    pronostico,
)

app = FastAPI(
    title="El Kiosquito — API",
    version="0.1.0",
    description="Capa operativa (Art. 5) — endpoints REST sobre los 11 módulos de specs/.",
    root_path="",
)

# CORS (Art. 5.1) — sin esto el navegador bloquea toda llamada del frontend
# (Vite, otro origen) aunque el backend responda bien. Lista explícita
# desde Settings.cors_origins_list, nunca "*" (ver comentario en
# app/core/config.py). allow_credentials=True es seguro acá porque la
# lista de orígenes es explícita, no wildcard.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(administracion.router, prefix="/api/v1")
app.include_router(core_ventas.router, prefix="/api/v1")
app.include_router(clientes.router, prefix="/api/v1")
app.include_router(precios.router, prefix="/api/v1")
app.include_router(pronostico.router, prefix="/api/v1")
app.include_router(promociones.router, prefix="/api/v1")
app.include_router(caja.router, prefix="/api/v1")
app.include_router(pagos.router, prefix="/api/v1")
app.include_router(compras.router, prefix="/api/v1")
app.include_router(expansion.router, prefix="/api/v1")
app.include_router(gastos.router, prefix="/api/v1")
app.include_router(analitica.router, prefix="/api/v1")


@app.get("/", tags=["salud"])
def salud() -> dict[str, str]:
    return {"estado": "ok", "servicio": "el-kiosquito-api"}
