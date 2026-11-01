import pytest
from sqlalchemy import text

from app import main
from app.core.config import settings
from app.core.database import engine

UNAVAILABLE = {"status": "unavailable"}


@pytest.fixture
def version_table():
    def _set(revision):
        with engine.begin() as conn:
            conn.execute(text("DROP TABLE IF EXISTS alembic_version"))
            conn.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY)"))
            conn.execute(text("INSERT INTO alembic_version (version_num) VALUES (:rev)"), {"rev": revision})

    yield _set
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS alembic_version"))


class BrokenEngine:
    def connect(self):
        raise RuntimeError("could not connect to db.internal:5432 password=hunter2")


class FakeRedis:
    pings = 0

    def ping(self):
        FakeRedis.pings += 1
        return True

    def close(self):
        pass


def test_ready_on_healthy_test_database(client):
    response = client.get("/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_ready_at_head(client, version_table):
    version_table(main.db_migrate.head_revision())

    response = client.get("/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_not_ready_when_database_fails(client, monkeypatch):
    monkeypatch.setattr(main, "engine", BrokenEngine())

    response = client.get("/ready")

    assert response.status_code == 503
    assert response.json() == UNAVAILABLE
    assert "hunter2" not in response.text and "db.internal" not in response.text


def test_not_ready_when_behind_head(client, version_table):
    version_table("f6a7b8c9d0e1")

    response = client.get("/ready")

    assert response.status_code == 503
    assert response.json() == UNAVAILABLE


def test_not_ready_without_version_table_outside_development(client, monkeypatch):
    monkeypatch.setattr(settings, "APP_ENV", "production")
    monkeypatch.setattr(settings, "REDIS_URL", "")

    response = client.get("/ready")

    assert response.status_code == 503
    assert response.json() == UNAVAILABLE


def test_ready_in_production_at_head(client, monkeypatch, version_table):
    version_table(main.db_migrate.head_revision())
    monkeypatch.setattr(settings, "APP_ENV", "production")
    monkeypatch.setattr(main.redis_sync.Redis, "from_url", classmethod(lambda cls, *a, **kw: FakeRedis()))

    response = client.get("/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_not_ready_when_redis_fails(client, monkeypatch):
    monkeypatch.setattr(settings, "APP_ENV", "development")
    monkeypatch.setattr(settings, "REDIS_URL", "redis://:topsecret@127.0.0.1:1/0")

    response = client.get("/ready")

    assert response.status_code == 503
    assert response.json() == UNAVAILABLE
    assert "topsecret" not in response.text and "127.0.0.1" not in response.text


def test_redis_is_pinged_outside_testing(client, monkeypatch):
    FakeRedis.pings = 0
    monkeypatch.setattr(settings, "APP_ENV", "development")
    monkeypatch.setattr(main.redis_sync.Redis, "from_url", classmethod(lambda cls, *a, **kw: FakeRedis()))

    response = client.get("/ready")

    assert response.status_code == 200
    assert FakeRedis.pings == 1


def test_redis_is_skipped_when_not_configured(client, monkeypatch):
    monkeypatch.setattr(settings, "APP_ENV", "development")
    monkeypatch.setattr(settings, "REDIS_URL", "")

    assert client.get("/ready").status_code == 200


def test_redis_is_skipped_in_testing(client, monkeypatch):
    monkeypatch.setattr(settings, "REDIS_URL", "redis://127.0.0.1:1/0")

    assert client.get("/ready").status_code == 200


def test_revision_check_failure_is_generic(client, monkeypatch, version_table):
    version_table("a1b2c3d4e5f6")

    def boom():
        raise RuntimeError("/app/alembic/versions secret path")

    monkeypatch.setattr(main.db_migrate, "head_revision", boom)

    response = client.get("/ready")

    assert response.status_code == 503
    assert response.json() == UNAVAILABLE
    assert "secret" not in response.text


def test_health_is_unchanged(client, monkeypatch):
    monkeypatch.setattr(main, "engine", BrokenEngine())

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}
