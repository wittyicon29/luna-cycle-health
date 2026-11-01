"""Bring a database to the current schema.

The first Alembic revision assumes the original tables already exist, so an empty
database cannot be built with ``alembic upgrade head``. Instead an empty database is
bootstrapped (``create_all`` + ``alembic stamp head``) and a versioned database is
upgraded. A database with tables but no Alembic revision (e.g. built by ``create_all``
in development) is refused unless the caller explicitly asks to stamp it.
"""
import logging
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path
from typing import Optional, Union

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection, Engine

from .core.database import Base
from .models import models  # noqa: F401  (registers every table on Base.metadata)

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parents[1]
ALEMBIC_INI = BACKEND_DIR / "alembic.ini"
ALEMBIC_DIR = BACKEND_DIR / "alembic"
VERSION_TABLE = "alembic_version"
# Session-level PostgreSQL advisory lock shared by every migrate run, so two
# containers starting at once cannot migrate the same database concurrently.
ADVISORY_LOCK_KEY = 726_351_904_118


class MigrationError(RuntimeError):
    pass


def alembic_config(connection: Optional[Connection] = None) -> Config:
    cfg = Config(str(ALEMBIC_INI))
    cfg.set_main_option("script_location", str(ALEMBIC_DIR))
    # Keep the application's logging setup; alembic.ini's fileConfig would replace it.
    cfg.attributes["configure_logger"] = False
    if connection is not None:
        cfg.attributes["connection"] = connection
    return cfg


@lru_cache(maxsize=1)
def head_revision() -> str:
    return ScriptDirectory.from_config(alembic_config()).get_current_head()


def current_revision(bind: Union[Engine, Connection]) -> Optional[str]:
    if isinstance(bind, Engine):
        with bind.connect() as conn:
            return MigrationContext.configure(conn).get_current_revision()
    return MigrationContext.configure(bind).get_current_revision()


@contextmanager
def _migration_lock(engine: Engine):
    if engine.dialect.name != "postgresql":
        yield
        return
    with engine.connect() as conn:
        logger.info("Waiting for the migration lock")
        conn.execute(text("SELECT pg_advisory_lock(:key)"), {"key": ADVISORY_LOCK_KEY})
        conn.commit()
        try:
            yield
        finally:
            # A failed unlock must not mask the migration's own error. Invalidating the
            # connection closes it instead of returning it to the pool, which releases the
            # session-level lock on the server.
            try:
                conn.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": ADVISORY_LOCK_KEY})
                conn.commit()
            except Exception as exc:
                logger.warning("Could not release the migration lock (%s); closing the connection", type(exc).__name__)
                try:
                    conn.invalidate()
                except Exception:
                    pass


def migrate(engine: Optional[Engine] = None, *, stamp_existing: bool = False) -> str:
    if engine is None:
        from .core.database import engine
    with _migration_lock(engine):
        return _migrate_locked(engine, stamp_existing)


def _migrate_locked(engine: Engine, stamp_existing: bool) -> str:
    head = head_revision()
    current = current_revision(engine)
    if current is not None:
        logger.info("Database at revision %s, upgrading to %s", current, head)
        with engine.begin() as conn:
            command.upgrade(alembic_config(conn), "head")
        logger.info("Database upgraded to %s", head)
        return "upgraded"

    tables = set(inspect(engine).get_table_names()) - {VERSION_TABLE}
    if not tables:
        logger.info("Empty database, creating all tables and stamping %s", head)
        with engine.begin() as conn:
            Base.metadata.create_all(conn)
            command.stamp(alembic_config(conn), "head")
        logger.info("Database bootstrapped at %s", head)
        return "bootstrapped"

    if not stamp_existing:
        raise MigrationError(
            "Database has tables but no Alembic revision; refusing to bootstrap over it. "
            "Check that its schema matches the current models, then rerun with --stamp-existing."
        )
    logger.info("Existing unversioned tables, stamping %s without changing the schema", head)
    with engine.begin() as conn:
        command.stamp(alembic_config(conn), "head")
    return "stamped"
