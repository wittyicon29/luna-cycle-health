"""ALLOWED_HOSTS: Host header checks, always-allowed loopback names and the production guard."""
import asyncio

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app.core.config import Settings, normalize_host, settings
from app.main import app

STRONG_SECRET = "a-real-secret-value-0123456789abcdef"


def production(**overrides):
    values = dict(_env_file=None, APP_ENV="production", SECRET_KEY=STRONG_SECRET,
                  ENCRYPTION_KEYS=Fernet.generate_key().decode(),
                  SMTP_SERVER="smtp.example.in", SMTP_USER="mailer",
                  SMTP_PASSWORD="mail-pass", SUPPORT_EMAIL="help@example.in",
                  ALLOWED_HOSTS="api.example.com")
    values.update(overrides)
    return Settings(**values)


@pytest.fixture
def enforced(monkeypatch):
    monkeypatch.setattr(settings, "ALLOWED_HOSTS", "api.example.com")
    return TestClient(app)


def _get(client, host, path="/health"):
    return client.get(path, headers={"Host": host})


# --- request checks ----------------------------------------------------------------------------


def test_unknown_host_is_rejected_with_400_and_headers(enforced):
    response = _get(enforced, "evil.example.net")
    assert response.status_code == 400
    assert response.json() == {"detail": "Invalid host header"}
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-request-id"]


def test_configured_host_passes_with_and_without_port(enforced):
    for host in ("api.example.com", "API.Example.com", "api.example.com:443", "api.example.com."):
        assert _get(enforced, host).status_code == 200, host


@pytest.mark.parametrize("host", ["localhost", "localhost:8000", "127.0.0.1", "127.0.0.1:8000", "[::1]", "[::1]:8000"])
def test_loopback_is_always_allowed_for_the_healthcheck(enforced, host):
    assert _get(enforced, host).status_code == 200


@pytest.mark.parametrize("host", ["", "api.example.com:abc", "api.example.com.evil.net", "sub.api.example.com",
                                  "[::1", "[::2]:8000", "evil.example.net:8000", "api.example.com@evil.net",
                                  "[::1]x"])
def test_bad_or_foreign_hosts_are_rejected(enforced, host):
    assert _get(enforced, host).status_code == 400


def test_api_routes_are_checked_too(enforced):
    response = enforced.post("/api/v1/auth/login", json={}, headers={"Host": "evil.example.net"})
    assert response.status_code == 400


def test_ipv6_literal_can_be_configured(monkeypatch):
    monkeypatch.setattr(settings, "ALLOWED_HOSTS", "[2001:db8::1]")
    client = TestClient(app)
    assert _get(client, "[2001:db8::1]:443").status_code == 200
    assert _get(client, "[2001:db8:0:0::1]").status_code == 200
    assert _get(client, "[2001:db8::2]").status_code == 400


def test_multiple_configured_hosts(monkeypatch):
    monkeypatch.setattr(settings, "ALLOWED_HOSTS", " api.example.com , www.example.com ")
    client = TestClient(app)
    assert _get(client, "www.example.com").status_code == 200
    assert _get(client, "api.example.com").status_code == 200
    assert _get(client, "example.com").status_code == 400


def test_explicit_wildcard_allows_any_host(monkeypatch):
    monkeypatch.setattr(settings, "ALLOWED_HOSTS", "*")
    assert _get(TestClient(app), "anything.example.org").status_code == 200


def test_empty_allowed_hosts_disables_the_check_in_testing(monkeypatch):
    monkeypatch.setattr(settings, "ALLOWED_HOSTS", "")
    assert settings.APP_ENV == "testing"
    assert _get(TestClient(app), "anything.example.org").status_code == 200


def test_missing_or_duplicate_host_header_is_rejected(monkeypatch):
    monkeypatch.setattr(settings, "ALLOWED_HOSTS", "api.example.com")

    async def run(headers):
        sent = []

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            sent.append(message)

        scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "GET",
                 "scheme": "http", "path": "/health", "raw_path": b"/health", "query_string": b"",
                 "root_path": "", "headers": headers, "client": ("10.0.0.5", 5000), "server": ("x", 80)}
        await app(scope, receive, send)
        return next(m for m in sent if m["type"] == "http.response.start")["status"]

    assert asyncio.run(run([])) == 400
    assert asyncio.run(run([(b"host", b"api.example.com"), (b"host", b"evil.example.net")])) == 400
    assert asyncio.run(run([(b"host", b"api.example.com")])) == 200


# --- host normalisation --------------------------------------------------------------------------


@pytest.mark.parametrize("raw,expected", [
    ("api.example.com", "api.example.com"),
    ("API.EXAMPLE.COM:8443", "api.example.com"),
    ("api.example.com.", "api.example.com"),
    ("127.0.0.1:8000", "127.0.0.1"),
    ("[::1]:8000", "::1"),
    ("[2001:DB8:0::1]", "2001:db8::1"),
    ("2001:db8::1", "2001:db8::1"),
    ("localhost:", "localhost"),
    ("", None), ("[::1", None), ("[nothex]", None), ("host:port", None), ("a b", None),
    ("user@host", None), ("host/path", None), ("[::1]:80:80", None),
])
def test_normalize_host(raw, expected):
    assert normalize_host(raw) == expected


# --- settings validation -------------------------------------------------------------------------


def test_production_fails_startup_with_empty_allowed_hosts():
    with pytest.raises(ValueError, match="ALLOWED_HOSTS"):
        production(ALLOWED_HOSTS="")
    with pytest.raises(ValueError, match="ALLOWED_HOSTS"):
        production(ALLOWED_HOSTS=" , ")


def test_production_accepts_explicit_wildcard_and_real_hosts():
    assert production(ALLOWED_HOSTS="*").allowed_hosts is None
    allowed = production(ALLOWED_HOSTS="api.example.com").allowed_hosts
    assert {"api.example.com", "localhost", "127.0.0.1", "::1"} <= allowed


@pytest.mark.parametrize("bad", ["*.example.com", "https://api.example.com", "api.example.com/x", "*,api.example.com",
                                 "bad host"])
def test_malformed_allowed_hosts_are_rejected(bad):
    with pytest.raises(ValueError, match="ALLOWED_HOSTS"):
        production(ALLOWED_HOSTS=bad)


def test_empty_allowed_hosts_means_disabled_in_development_and_testing():
    for env in ("development", "testing"):
        assert Settings(_env_file=None, APP_ENV=env, ALLOWED_HOSTS="").allowed_hosts is None


def test_production_app_import_fails_without_allowed_hosts(tmp_path):
    """The real factory refuses to start (subprocess so the module-level settings are fresh)."""
    import os
    import subprocess
    import sys
    from pathlib import Path

    backend = Path(__file__).resolve().parents[1]
    env = {k: v for k, v in os.environ.items() if k not in ("ALLOWED_HOSTS",)}
    env.update(APP_ENV="production", SECRET_KEY=STRONG_SECRET, ENCRYPTION_KEYS=Fernet.generate_key().decode(),
               SMTP_SERVER="smtp.example.in", SMTP_USER="mailer", SMTP_PASSWORD="mail-pass",
               SUPPORT_EMAIL="help@example.in", DATABASE_URL=f"sqlite:///{tmp_path}/x.db",
               RATE_LIMIT_STORAGE="memory", ALLOWED_HOSTS="")
    result = subprocess.run([sys.executable, "-c", "import app.main"], cwd=backend, env=env,
                            capture_output=True, text=True, timeout=120)
    assert result.returncode != 0
    assert "ALLOWED_HOSTS" in result.stderr
