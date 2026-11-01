import os
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

import pytest
from alembic import command
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url

from app import db_migrate
from app.core.database import Base
from app.db_migrate import MigrationError, current_revision, head_revision, migrate

BACKEND_DIR = Path(__file__).resolve().parents[1]
TEST_POSTGRES_URL = os.environ.get("TEST_POSTGRES_URL", "")
# Last revision before daily_logs and subscriptions were added.
OLDER_REVISION = "f6a7b8c9d0e1"
HEAD = "a1b2c3d4e5f6"


@pytest.fixture
def sqlite_engine(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'migrate.db'}")
    yield engine
    engine.dispose()


def model_schema():
    return {name: {c.name for c in table.columns} for name, table in Base.metadata.tables.items()}


def db_schema(engine):
    inspector = inspect(engine)
    return {
        name: {c["name"] for c in inspector.get_columns(name)}
        for name in inspector.get_table_names()
        if name != "alembic_version"
    }


def stamp(engine, revision):
    with engine.begin() as conn:
        command.stamp(db_migrate.alembic_config(conn), revision)


def test_head_revision_comes_from_the_script_directory():
    assert head_revision() == HEAD


def test_current_revision_is_none_without_version_table(sqlite_engine):
    assert current_revision(sqlite_engine) is None


def test_empty_database_is_bootstrapped(sqlite_engine):
    assert migrate(sqlite_engine) == "bootstrapped"

    assert db_schema(sqlite_engine) == model_schema()
    assert current_revision(sqlite_engine) == head_revision()


def test_second_run_after_bootstrap_is_a_noop_upgrade(sqlite_engine):
    migrate(sqlite_engine)
    before = db_schema(sqlite_engine)

    assert migrate(sqlite_engine) == "upgraded"
    assert db_schema(sqlite_engine) == before
    assert current_revision(sqlite_engine) == head_revision()


def test_older_revision_runs_pending_migrations(sqlite_engine):
    Base.metadata.create_all(sqlite_engine)
    Base.metadata.tables["subscriptions"].drop(sqlite_engine)
    Base.metadata.tables["daily_logs"].drop(sqlite_engine)
    stamp(sqlite_engine, OLDER_REVISION)

    assert migrate(sqlite_engine) == "upgraded"

    tables = set(inspect(sqlite_engine).get_table_names())
    assert {"subscriptions", "daily_logs"} <= tables
    assert current_revision(sqlite_engine) == head_revision()


def test_tables_without_version_are_refused(sqlite_engine):
    Base.metadata.create_all(sqlite_engine)

    with pytest.raises(MigrationError, match="--stamp-existing"):
        migrate(sqlite_engine)
    assert current_revision(sqlite_engine) is None


def test_tables_without_version_are_stamped_when_asked(sqlite_engine):
    Base.metadata.create_all(sqlite_engine)

    assert migrate(sqlite_engine, stamp_existing=True) == "stamped"
    assert current_revision(sqlite_engine) == head_revision()
    assert migrate(sqlite_engine) == "upgraded"


def test_stamp_existing_on_empty_database_still_bootstraps(sqlite_engine):
    assert migrate(sqlite_engine, stamp_existing=True) == "bootstrapped"
    assert db_schema(sqlite_engine) == model_schema()


def test_empty_version_table_alone_counts_as_empty(sqlite_engine):
    with sqlite_engine.begin() as conn:
        conn.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY)"))

    assert migrate(sqlite_engine) == "bootstrapped"
    assert current_revision(sqlite_engine) == head_revision()


def test_progress_logs_do_not_contain_the_database_url(tmp_path, caplog):
    engine = create_engine(f"sqlite:///{tmp_path / 'secret-name.db'}")
    try:
        with caplog.at_level("INFO", logger="app.db_migrate"):
            migrate(engine)
            migrate(engine)
    finally:
        engine.dispose()
    messages = [r.getMessage() for r in caplog.records if r.name == "app.db_migrate"]
    assert messages
    assert not any("secret-name" in m or "sqlite" in m for m in messages)


def test_alembic_env_registers_every_model_table():
    env = (BACKEND_DIR / "alembic" / "env.py").read_text()
    assert "from app.models import models" in env


# --- CLI -------------------------------------------------------------------

def run_cli(db_path, *args):
    env = dict(os.environ, APP_ENV="testing", SECRET_KEY="test-secret-key",
               DATABASE_URL=f"sqlite:///{db_path}")
    return subprocess.run(
        [sys.executable, "scripts/migrate.py", *args],
        cwd=BACKEND_DIR, env=env, capture_output=True, text=True, timeout=120,
    )


def test_cli_bootstraps_then_upgrades(tmp_path):
    db_path = tmp_path / "cli.db"

    first = run_cli(db_path)
    assert first.returncode == 0, first.stderr
    assert "bootstrapped" in first.stdout

    second = run_cli(db_path)
    assert second.returncode == 0, second.stderr
    assert "upgraded" in second.stdout


def test_cli_refuses_unversioned_tables_unless_stamp_existing(tmp_path):
    db_path = tmp_path / "cli.db"
    engine = create_engine(f"sqlite:///{db_path}")
    Base.metadata.create_all(engine)
    engine.dispose()

    refused = run_cli(db_path)
    assert refused.returncode == 1
    assert "--stamp-existing" in refused.stderr
    assert str(db_path) not in refused.stderr + refused.stdout

    stamped = run_cli(db_path, "--stamp-existing")
    assert stamped.returncode == 0, stamped.stderr
    assert "stamped" in stamped.stdout


def test_cli_runs_from_another_working_directory(tmp_path):
    env = dict(os.environ, APP_ENV="testing", SECRET_KEY="test-secret-key",
               DATABASE_URL=f"sqlite:///{tmp_path / 'cwd.db'}")
    result = subprocess.run(
        [sys.executable, str(BACKEND_DIR / "scripts" / "migrate.py")],
        cwd=tmp_path, env=env, capture_output=True, text=True, timeout=120,
    )
    assert result.returncode == 0, result.stderr
    assert "bootstrapped" in result.stdout


FAILING_MIGRATE = """
import sys
from sqlalchemy.exc import OperationalError
import app.db_migrate as d
from scripts import migrate as cli

def boom(**kwargs):
    raise OperationalError("SELECT 1", {}, Exception('could not connect to host=db password=secret'))

d.migrate = boom
sys.exit(cli.main(sys.argv[1:]))
"""


def run_failing_cli(tmp_path, *args, **extra_env):
    env = {k: v for k, v in os.environ.items() if k != "MIGRATE_DEBUG"}
    env.update(APP_ENV="testing", SECRET_KEY="test-secret-key",
               DATABASE_URL=f"sqlite:///{tmp_path / 'fail.db'}", **extra_env)
    return subprocess.run(
        [sys.executable, "-c", FAILING_MIGRATE, *args],
        cwd=BACKEND_DIR, env=env, capture_output=True, text=True, timeout=120,
    )


def test_cli_unexpected_error_prints_only_the_class_name(tmp_path):
    result = run_failing_cli(tmp_path)
    assert result.returncode == 1
    assert "migrate: failed (OperationalError); set MIGRATE_DEBUG=1 for details" in result.stderr
    output = result.stderr + result.stdout
    assert "secret" not in output and "db" not in output
    assert "Traceback" not in output


@pytest.mark.parametrize("args,extra_env", [((), {"MIGRATE_DEBUG": "1"}), (("--debug",), {})])
def test_cli_debug_logs_the_traceback(tmp_path, args, extra_env):
    result = run_failing_cli(tmp_path, *args, **extra_env)
    assert result.returncode == 1
    assert "Traceback" in result.stderr and "OperationalError" in result.stderr


def test_cli_imports_the_app_inside_main():
    source = (BACKEND_DIR / "scripts" / "migrate.py").read_text()
    module_level = [line for line in source.splitlines() if line.startswith(("import ", "from "))]
    assert not any("app." in line or "app " in line for line in module_level)


# --- advisory lock release ---------------------------------------------------

class _FakeConn:
    def __init__(self, fail_unlock):
        self.fail_unlock = fail_unlock
        self.invalidated = False

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, statement, params=None):
        if "unlock" in str(statement) and self.fail_unlock:
            raise RuntimeError("connection lost")

    def commit(self):
        pass

    def invalidate(self):
        self.invalidated = True


class _FakePgEngine:
    class dialect:
        name = "postgresql"

    def __init__(self, fail_unlock=True):
        self.conn = _FakeConn(fail_unlock)

    def connect(self):
        return self.conn


def test_failed_unlock_does_not_mask_the_original_error(caplog):
    engine = _FakePgEngine()
    with pytest.raises(ValueError, match="original"):
        with db_migrate._migration_lock(engine):
            raise ValueError("original")
    assert "migration lock" in caplog.text.lower()
    assert engine.conn.invalidated


def test_failed_unlock_after_success_only_warns(caplog):
    engine = _FakePgEngine()
    with db_migrate._migration_lock(engine):
        pass
    assert any(r.levelname == "WARNING" for r in caplog.records)
    assert engine.conn.invalidated


def test_unlock_success_keeps_connection():
    engine = _FakePgEngine(fail_unlock=False)
    with db_migrate._migration_lock(engine):
        pass
    assert not engine.conn.invalidated


# --- PostgreSQL (only when TEST_POSTGRES_URL is set) -------------------------

requires_postgres = pytest.mark.skipif(
    not TEST_POSTGRES_URL,
    reason="set TEST_POSTGRES_URL to a disposable PostgreSQL server to run the Postgres migration tests",
)


@pytest.fixture
def pg_engine():
    admin_url = make_url(TEST_POSTGRES_URL)
    name = f"luna_migrate_{uuid.uuid4().hex[:12]}"
    admin = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    engine = create_engine(admin_url.set(database=name))
    try:
        yield engine
    finally:
        engine.dispose()
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{name}"'))
        admin.dispose()


@requires_postgres
def test_postgres_bootstrap_matches_models_and_reruns(pg_engine):
    assert migrate(pg_engine) == "bootstrapped"
    assert db_schema(pg_engine) == model_schema()
    assert current_revision(pg_engine) == head_revision()

    assert migrate(pg_engine) == "upgraded"
    assert current_revision(pg_engine) == head_revision()


@requires_postgres
def test_postgres_real_migrations_upgrade_from_older_revision(pg_engine):
    migrate(pg_engine)
    with pg_engine.begin() as conn:
        command.downgrade(db_migrate.alembic_config(conn), "e5f6a7b8c9d0")
    assert current_revision(pg_engine) == "e5f6a7b8c9d0"
    assert "medications" not in inspect(pg_engine).get_table_names()

    assert migrate(pg_engine) == "upgraded"
    assert current_revision(pg_engine) == head_revision()
    assert db_schema(pg_engine) == model_schema()


@requires_postgres
def test_postgres_refuses_unversioned_tables(pg_engine):
    Base.metadata.create_all(pg_engine)
    with pytest.raises(MigrationError):
        migrate(pg_engine)
    assert migrate(pg_engine, stamp_existing=True) == "stamped"


@requires_postgres
def test_postgres_migrate_waits_for_the_advisory_lock(pg_engine):
    holder = pg_engine.connect()
    holder.execute(text("SELECT pg_advisory_lock(:key)"), {"key": db_migrate.ADVISORY_LOCK_KEY})
    holder.commit()
    results = []
    worker = threading.Thread(target=lambda: results.append(migrate(pg_engine)))
    try:
        worker.start()
        time.sleep(1.0)
        assert worker.is_alive() and results == []
    finally:
        holder.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": db_migrate.ADVISORY_LOCK_KEY})
        holder.commit()
        holder.close()
    worker.join(timeout=60)
    assert results == ["bootstrapped"]


@requires_postgres
def test_postgres_concurrent_migrations_do_not_collide(pg_engine):
    results, errors = [], []
    barrier = threading.Barrier(2)

    def run():
        barrier.wait()
        try:
            results.append(migrate(pg_engine))
        except Exception as exc:  # pragma: no cover - reported below
            errors.append(exc)

    threads = [threading.Thread(target=run) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)

    assert errors == []
    assert sorted(results) == ["bootstrapped", "upgraded"]
    assert current_revision(pg_engine) == head_revision()
