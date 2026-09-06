"""
Conexión a PostgreSQL (Art. 5.1/5.2) y metadata compartida de SQLAlchemy.

Todos los módulos (001-011) declaran sus modelos contra el mismo `Base`
importado desde aquí. Esto es lo que permite que Alembic ordene las
migraciones topológicamente por FK sin que nosotros tengamos que calcular
el orden a mano — ver `alembic/env.py`.
"""

import os
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+psycopg://elkiosquito:elkiosquito_dev@localhost:5432/elkiosquito",
)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    """Metadata compartida por los 11 módulos — un solo Base, nunca uno por módulo."""

    pass


def get_db() -> Generator[Session, None, None]:
    """Dependencia de FastAPI: una sesión por request, cerrada siempre al final."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
