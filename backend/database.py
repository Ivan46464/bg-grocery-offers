"""
SQLite connection + session helper.

DATABASE_URL defaults to a file next to this module. Override with an env var
if you ever move to Postgres (`postgresql://...`) - nothing else needs to change.
"""
import os
from pathlib import Path
from typing import Iterator

from sqlmodel import Session, SQLModel, create_engine

_DEFAULT_DB = Path(__file__).resolve().parent / "offers.db"
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{_DEFAULT_DB}")

# SQLite is single-file and FastAPI serves requests from several threads,
# so disable the same-thread check.
_connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=_connect_args)


def init_db() -> None:
    """Create tables if they don't exist yet (safe to call on every startup)."""
    # Import models so their tables are registered on SQLModel.metadata.
    import models  # noqa: F401

    SQLModel.metadata.create_all(engine)
    _add_missing_columns()


def _add_missing_columns() -> None:
    """
    Poor man's migration for SQLite: `create_all` never alters existing tables,
    so when a model gains a column we ADD it here (nullable, no default).
    Good enough for this app; switch to Alembic if the schema keeps changing.
    """
    if not DATABASE_URL.startswith("sqlite"):
        return
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    with engine.begin() as conn:
        for table in SQLModel.metadata.sorted_tables:
            if not inspector.has_table(table.name):
                continue
            existing = {c["name"] for c in inspector.get_columns(table.name)}
            for col in table.columns:
                if col.name in existing:
                    continue
                coltype = col.type.compile(engine.dialect)
                conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {coltype}'))


def get_session() -> Iterator[Session]:
    """FastAPI dependency: one DB session per request."""
    with Session(engine) as session:
        yield session
