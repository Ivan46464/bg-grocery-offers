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


def get_session() -> Iterator[Session]:
    """FastAPI dependency: one DB session per request."""
    with Session(engine) as session:
        yield session
