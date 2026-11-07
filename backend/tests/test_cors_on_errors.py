"""Responses produced outside CORSMiddleware (host 400, size 413, generic 500) carry the same CORS
headers CORSMiddleware adds for an allowed Origin, so the app sees the real status instead of an
opaque network error; nothing is added for a disallowed or missing Origin."""
import pytest
from fastapi.testclient import TestClient

from app import main as main_module
from app.core.config import settings
from app.core.middleware import cors_headers_for
from app.main import app

# The app's CORSMiddleware is built at import from settings.ALLOWED_ORIGINS; use that origin.
ALLOWED = settings.ALLOWED_ORIGINS.split(",")[0]
DISALLOWED = "https://evil.example.net"


def _client():
    return TestClient(app, raise_server_exceptions=False)


def _bad_host(origin):
    headers = {"Host": "evil.example.net"}
    if origin:
        headers["Origin"] = origin
    return _client().get("/health", headers=headers)


def _too_large(origin, monkeypatch):
    monkeypatch.setattr(settings, "MAX_REQUEST_BYTES", 10)
    headers = {"Content-Type": "application/json"}
    if origin:
        headers["Origin"] = origin
    return _client().post("/api/v1/auth/login", content=b"x" * 100, headers=headers)


def _server_error(origin, monkeypatch):
    def broken():
        raise RuntimeError("SNTLcors500")

    monkeypatch.setattr(main_module, "_readiness_failure", broken)
    return _client().get("/ready", headers={"Origin": origin} if origin else {})


def assert_cors(response, origin):
    assert response.headers.get("access-control-allow-origin") == origin
    assert response.headers.get("access-control-allow-credentials") == "true"
    assert "origin" in [v.strip().lower() for v in response.headers.get("vary", "").split(",")]
    assert len(response.headers.get_list("access-control-allow-origin")) == 1


def assert_no_cors(response):
    assert not any(k.lower().startswith("access-control-") for k in response.headers)


def assert_common(response):
    assert response.headers["x-request-id"]
    assert response.headers["x-content-type-options"] == "nosniff"


@pytest.fixture(params=["host", "size", "500"])
def early(request, monkeypatch):
    def run(origin):
        if request.param == "host":
            monkeypatch.setattr(settings, "ALLOWED_HOSTS", "api.example.com")
            response, status = _bad_host(origin), 400
        elif request.param == "size":
            response, status = _too_large(origin, monkeypatch), 413
        else:
            response, status = _server_error(origin, monkeypatch), 500
            assert "SNTLcors500" not in response.text
        assert response.status_code == status
        assert_common(response)
        return response
    return run


def test_allowed_origin_gets_cors_headers_on_early_errors(early):
    assert_cors(early(ALLOWED), ALLOWED)


def test_disallowed_origin_gets_no_cors_headers(early):
    assert_no_cors(early(DISALLOWED))


def test_missing_origin_gets_no_cors_headers(early):
    assert_no_cors(early(None))


def test_preflight_unchanged(monkeypatch):
    response = _client().options("/api/v1/auth/login", headers={
        "Origin": ALLOWED, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"})
    assert response.status_code == 200
    assert_cors(response, ALLOWED)
    assert "POST" in response.headers["access-control-allow-methods"]
    assert_common(response)

    rejected = _client().options("/api/v1/auth/login", headers={
        "Origin": DISALLOWED, "Access-Control-Request-Method": "POST"})
    assert rejected.status_code == 400
    assert "access-control-allow-origin" not in rejected.headers
    assert_common(rejected)


def test_normal_responses_keep_single_cors_headers():
    response = _client().get("/health", headers={"Origin": ALLOWED})
    assert response.status_code == 200
    assert_cors(response, ALLOWED)
    # CORSMiddleware's own behaviour for a disallowed origin: no Allow-Origin.
    assert "access-control-allow-origin" not in _client().get("/health", headers={"Origin": DISALLOWED}).headers


# --- the helper's semantics match Starlette's CORSMiddleware ---------------------------------


def _h(**headers):
    return [(k.lower().replace("_", "-").encode(), v.encode()) for k, v in headers.items()]


def test_helper_exact_match_only(monkeypatch):
    monkeypatch.setattr(settings, "ALLOWED_ORIGINS", f"{ALLOWED},capacitor://localhost")
    assert cors_headers_for(_h(origin="capacitor://localhost"))["access-control-allow-origin"] == "capacitor://localhost"
    assert cors_headers_for(_h(origin=ALLOWED))["access-control-allow-origin"] == ALLOWED
    assert cors_headers_for(_h(origin=ALLOWED + "/")) == {}
    assert cors_headers_for(_h(origin="https://localhost.evil.net")) == {}
    assert cors_headers_for([]) == {}


def test_helper_wildcard_like_starlette(monkeypatch):
    monkeypatch.setattr(settings, "ALLOWED_ORIGINS", "*")
    plain = cors_headers_for(_h(origin=DISALLOWED))
    assert plain["access-control-allow-origin"] == "*"
    with_cookie = cors_headers_for(_h(origin=DISALLOWED, cookie="a=b"))
    assert with_cookie["access-control-allow-origin"] == DISALLOWED
    assert "Origin" in with_cookie["vary"]
