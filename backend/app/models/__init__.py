"""
Importa los modelos de cada módulo para que se registren en `Base.metadata`.

Alembic autogenera y ordena las migraciones a partir de este único punto —
por eso cada módulo nuevo se agrega aquí, nunca con su propio metadata.
Orden de aparición = orden de la enmienda de catálogos maestros §7
(001 es la base; 010 y 009 antes de los módulos que los referencian por FK
externa habría sido el ideal, pero SQLAlchemy no exige orden de import: solo
exige que el modelo exista antes de generar/aplicar la migración).
"""

from app.models import (  # noqa: F401
    administracion,
    analitica,
    caja,
    clientes,
    compras,
    core_ventas,
    expansion,
    pagos,
    precios,
    promociones,
    pronostico,
)

# Los 11 módulos de specs/ están representados. Siguiente: endpoints
# FastAPI sobre los contratos OpenAPI, DAG de Airflow, modelos scikit-learn.
