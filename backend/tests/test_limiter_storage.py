import importlib
import logging
import os
import time

import pytest
from cryptography.fernet import Fernet
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.core import limiter as limiter_module
from app.core.client_ip import get_client_ip
from app.core.config import Settings
from app.core.limiter import REDIS_TIMEOUT_SECONDS, build_limiter

STRONG_SECRET = "a-real-secret-value-0123456789abcdef"
CLOSED_PORT_URL = "redis://127.0.0.1:1/0"


def production_settings(**overrides):
    values = dict(_env_file=None, APP_ENV="production", SECRET_KEY=STRONG_SECRET,
                  ENCRYPTION_KEYS=Fernet.generate_key().decode(),
                  SMTP_SERVER="smtp.example.com", SMTP_USER="mailer",
                  SMTP_PASSWORD="change-me", SUPPORT_EMAIL="help@example.com")
    values.update(overrides)
    return Settings(**values)


@pytest.fixture(autouse=True)
def no_storage_env(monkeypatch):
    monkeypatch.delenv("RATE_LIMIT_STORAGE", raising=False)
    monkeypatch.delenv("TRUSTED_PROXY_IPS", raising=False)


# --- settings defaults -------------------------------------------------------

@pytest.mark.parametrize("env", ["development", "testing"])
def test_storage_defaults_to_memory_in_dev_and_tests(env):
    assert Settings(_env_file=None, APP_ENV=env).RATE_LIMIT_STORAGE == "memory"


@pytest.mark.parametrize("env", ["production", "staging"])
def test_storage_defaults_to_redis_elsewhere(env):
    assert production_settings(APP_ENV=env).RATE_LIMIT_STORAGE == "redis"


def test_empty_storage_value_uses_the_default():
    assert production_settings(RATE_LIMIT_STORAGE="").RATE_LIMIT_STORAGE == "redis"
    assert Settings(_env_file=None, APP_ENV="development", RATE_LIMIT_STORAGE="").RATE_LIMIT_STORAGE == "memory"


def test_explicit_storage_is_kept():
    assert production_settings(RATE_LIMIT_STORAGE="memory").RATE_LIMIT_STORAGE == "memory"
    assert Settings(_env_file=None, APP_ENV="development", RATE_LIMIT_STORAGE="redis").RATE_LIMIT_STORAGE == "redis"


def test_storage_read_from_environment(monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_STORAGE", "memory")
    assert production_settings().RATE_LIMIT_STORAGE == "memory"


def test_invalid_storage_is_rejected():
    with pytest.raises(ValueError):
        Settings(_env_file=None, APP_ENV="development", RATE_LIMIT_STORAGE="memcached")


def test_redis_storage_requires_redis_url():
    with pytest.raises(ValueError):
        production_settings(REDIS_URL="")
    assert production_settings(REDIS_URL="", RATE_LIMIT_STORAGE="memory").RATE_LIMIT_STORAGE == "memory"


def test_trusted_proxies_default_to_nobody():
    assert Settings(_env_file=None, APP_ENV="development").trusted_proxies == []
    assert production_settings().trusted_proxies == []


@pytest.mark.parametrize("value", ["not-an-ip", "10.0.0.0/33", "1.2.3.4, nope"])
def test_invalid_trusted_proxies_are_rejected(value):
    with pytest.raises(ValueError):
        Settings(_env_file=None, APP_ENV="development", TRUSTED_PROXY_IPS=value)


# --- limiter wiring ----------------------------------------------------------

def make_app(limiter, limit="2/minute"):
    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    @app.get("/limited")
    @limiter.limit(limit)
    async def limited(request: Request):
        return {"ok": True}

    return app


def test_module_limiter_uses_client_ip_and_memory_in_tests():
    assert limiter_module.limiter._key_func is get_client_ip
    assert type(limiter_module.limiter._storage).__name__ == "MemoryStorage"
    assert limiter_module.limiter._headers_enabled is False


def test_redis_limiter_gets_short_timeouts_and_fail_open_flags():
    lim = build_limiter("redis://127.0.0.1:1/0")
    kwargs = lim._storage.storage.connection_pool.connection_kwargs
    assert kwargs["socket_connect_timeout"] == REDIS_TIMEOUT_SECONDS
    assert kwargs["socket_timeout"] == REDIS_TIMEOUT_SECONDS
    assert REDIS_TIMEOUT_SECONDS <= 1
    assert lim._in_memory_fallback_enabled is True
    assert lim._swallow_errors is True
    assert lim._key_func is get_client_ip


def test_module_limiter_selects_redis_when_configured(monkeypatch):
    monkeypatch.setattr(limiter_module.settings, "RATE_LIMIT_STORAGE", "redis")
    monkeypatch.setattr(limiter_module.settings, "REDIS_URL", CLOSED_PORT_URL)
    lim = limiter_module.limiter_from_settings()
    assert type(lim._storage).__name__ == "RedisStorage"
    monkeypatch.setattr(limiter_module.settings, "RATE_LIMIT_STORAGE", "memory")
    assert type(limiter_module.limiter_from_settings()._storage).__name__ == "MemoryStorage"


def test_two_limiters_share_a_redis_counter():
    fakeredis = pytest.importorskip("fakeredis")
    import redis

    server = fakeredis.FakeServer()

    def pool():
        return redis.ConnectionPool(connection_class=fakeredis.FakeRedisConnection, server=server)

    first = TestClient(make_app(build_limiter("redis://localhost:6379/0", extra_options={"connection_pool": pool()})))
    second = TestClient(make_app(build_limiter("redis://localhost:6379/0", extra_options={"connection_pool": pool()})))

    assert first.get("/limited").status_code == 200
    assert second.get("/limited").status_code == 200
    assert first.get("/limited").status_code == 429
    assert second.get("/limited").status_code == 429


def test_memory_limiters_do_not_share(monkeypatch):
    first = TestClient(make_app(build_limiter(None)))
    second = TestClient(make_app(build_limiter(None)))
    assert [first.get("/limited").status_code for _ in range(2)] == [200, 200]
    assert second.get("/limited").status_code == 200


def test_redis_down_fails_open_with_warning(caplog):
    client = TestClient(make_app(build_limiter(CLOSED_PORT_URL)))
    caplog.set_level(logging.WARNING)

    started = time.monotonic()
    response = client.get("/limited")
    elapsed = time.monotonic() - started

    assert response.status_code == 200
    assert elapsed < 3
    warnings = [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert warnings, "expected a warning when the rate-limit storage is unreachable"
    assert not any("127.0.0.1:1" in r.getMessage() for r in warnings)


def test_redis_down_still_limits_per_process():
    client = TestClient(make_app(build_limiter(CLOSED_PORT_URL)))
    assert [client.get("/limited").status_code for _ in range(3)] == [200, 200, 429]


@pytest.mark.skipif(not os.environ.get("TEST_REDIS_URL"), reason="TEST_REDIS_URL not set")
def test_two_limiters_share_a_real_redis_counter():
    url = os.environ["TEST_REDIS_URL"]
    first_limiter = build_limiter(url)
    first_limiter.reset()
    first = TestClient(make_app(first_limiter))
    second = TestClient(make_app(build_limiter(url)))
    try:
        assert first.get("/limited").status_code == 200
        assert second.get("/limited").status_code == 200
        assert first.get("/limited").status_code == 429
    finally:
        first_limiter.reset()


# --- lazy redis client -------------------------------------------------------

def test_redis_client_is_optional(monkeypatch):
    from app.core import redis as redis_module

    monkeypatch.setattr(redis_module.settings, "REDIS_URL", "")
    reloaded = importlib.reload(redis_module)
    assert reloaded.get_redis_client() is None

    monkeypatch.setattr(reloaded, "_client", None)  # restored to None after the test
    monkeypatch.setattr(reloaded.settings, "REDIS_URL", CLOSED_PORT_URL)
    client = reloaded.get_redis_client()
    assert client is not None
    assert reloaded.get_redis_client() is client
