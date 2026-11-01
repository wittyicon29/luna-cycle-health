from logging.config import fileConfig
from sqlalchemy import engine_from_config
from sqlalchemy import pool
from alembic import context
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.core.database import Base
from app.core.config import settings
from app.models import models  # noqa: F401  (registers every table on Base.metadata)

config = context.config
# app.db_migrate passes an open connection; the alembic CLI connects from settings.
connection = config.attributes.get("connection")
if connection is None:
    # configparser treats "%" as interpolation, so escape it (e.g. in URL-encoded passwords).
    config.set_main_option("sqlalchemy.url", settings.DATABASE_URL.replace("%", "%%"))

if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()

def _run_with_connection(conn) -> None:
    context.configure(connection=conn, target_metadata=target_metadata)

    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online() -> None:
    if connection is not None:
        _run_with_connection(connection)
        return

    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as conn:
        _run_with_connection(conn)

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
