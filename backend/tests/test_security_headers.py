"""Security headers, Cache-Control on the API, hidden schema endpoints and the global 422 shape."""
import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.testclient import TestClient
from starlette.middleware.base import BaseHTTPMiddleware

from app import main as main_module
from app.core.config import settings
from app.core.middleware import (
    BodySizeLimitMiddleware,
    RequestContextMiddleware,
    SecurityHeadersMiddleware,
    TrustedHostMiddleware,
)
from app.main import app, install_http_middleware

SECURITY_HEADERS = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
}


def assert_security_headers(response):
    for name, value in SECURITY_HEADERS.items():
        assert response.headers.get(name) == value, (name, response.status_code)
    assert response.headers.get("x-request-id")


@pytest.fixture
def mini_client():
    """A small app wired with exactly the production middleware stack."""
    mini = FastAPI()

    @mini.get("/api/v1/ok")
    def ok():
        return {"ok": True}

    @mini.get("/api/v1/cached")
    def cached():
        return JSONResponse({"ok": True}, headers={"Cache-Control": "private, max-age=60"})

    @mini.get("/api/v1/boom")
    def boom():
        raise ValueError("note=SECRET")

    @mini.get("/api/v1/stream")
    def stream():
        def chunks():
            yield b"one,"
            yield b"two"
        return StreamingResponse(chunks(), media_type="text/plain")

    @mini.get("/plain")
    def plain():
        return {"ok": True}

    install_http_middleware(mini)
    return TestClient(mini, raise_server_exceptions=False)


# --- wiring ----------------------------------------------------------------------------------


def test_new_middleware_is_pure_asgi():
    for cls in (SecurityHeadersMiddleware, TrustedHostMiddleware, BodySizeLimitMiddleware):
        assert not issubclass(cls, BaseHTTPMiddleware)


def test_middleware_order_request_id_outermost_then_headers_hosts_size_cors():
    # user_middleware lists the outermost first.
    names = [m.cls.__name__ for m in app.user_middleware]
    assert names == ["RequestContextMiddleware", "SecurityHeadersMiddleware", "TrustedHostMiddleware",
                     "BodySizeLimitMiddleware", "CORSMiddleware"]
    assert app.user_middleware[0].cls is RequestContextMiddleware


# --- headers on every kind of response -------------------------------------------------------


def test_headers_on_200(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert_security_headers(response)


def test_headers_on_4xx(client):
    for response in (client.get("/api/v1/auth/status"), client.get("/nope"),
                     client.post("/api/v1/auth/login", json={})):
        assert 400 <= response.status_code < 500
        assert_security_headers(response)


def test_headers_on_5xx_from_the_real_app(monkeypatch):
    def broken():
        raise RuntimeError("db exploded SECRET")

    monkeypatch.setattr(main_module, "_readiness_failure", broken)
    response = TestClient(app, raise_server_exceptions=False).get("/ready")
    assert response.status_code == 500
    assert response.json()["detail"] == "Internal server error"
    assert_security_headers(response)


def test_headers_and_no_store_on_api_5xx(mini_client):
    response = mini_client.get("/api/v1/boom")
    assert response.status_code == 500
    assert "SECRET" not in response.text
    assert_security_headers(response)
    assert response.headers["cache-control"] == "no-store"


def test_headers_on_413(client, monkeypatch):
    monkeypatch.setattr(settings, "MAX_REQUEST_BYTES", 10)
    response = client.post("/api/v1/auth/login", content=b"x" * 100,
                           headers={"Content-Type": "application/json"})
    assert response.status_code == 413
    assert_security_headers(response)


def test_headers_on_cors_preflight(client):
    origin = settings.ALLOWED_ORIGINS.split(",")[0]
    response = client.options("/api/v1/auth/login", headers={
        "Origin": origin, "Access-Control-Request-Method": "POST"})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    assert_security_headers(response)
    assert response.headers["cache-control"] == "no-store"


def test_headers_on_streaming_response(mini_client):
    response = mini_client.get("/api/v1/stream")
    assert response.status_code == 200
    assert response.text == "one,two"
    assert_security_headers(response)


def test_existing_security_header_values_are_not_duplicated(mini_client):
    response = mini_client.get("/api/v1/ok")
    raw = [k for k, _ in response.headers.raw if k.lower() == b"x-frame-options"]
    assert len(raw) == 1


# --- Cache-Control ---------------------------------------------------------------------------


def test_api_responses_are_no_store(client, auth_headers):
    response = client.get("/api/v1/auth/status", headers=auth_headers)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"


def test_health_is_not_marked_no_store(client):
    assert "cache-control" not in client.get("/health").headers


def test_non_api_paths_are_not_marked_no_store(mini_client):
    assert "cache-control" not in mini_client.get("/plain").headers


def test_route_cache_control_is_preserved(mini_client):
    response = mini_client.get("/api/v1/cached")
    assert response.headers["cache-control"] == "private, max-age=60"
    assert len(response.headers.get_list("cache-control")) == 1


# --- schema endpoints ------------------------------------------------------------------------


@pytest.mark.parametrize("path", ["/openapi.json", "/docs", "/redoc"])
def test_schema_endpoints_hidden_outside_development(client, path):
    assert settings.APP_ENV == "testing"
    response = client.get(path)
    assert response.status_code == 404
    assert_security_headers(response)


def test_openapi_url_is_none_outside_development():
    assert app.openapi_url is None


# --- 422 bodies never echo the input --------------------------------------------------------


def test_every_422_drops_input_and_ctx(client, auth_headers):
    secret = "SNTL-medication-name-123"
    response = client.post("/api/v1/medications/", json={"name": 5, "dose": secret}, headers=auth_headers)
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail and all("input" not in e and "ctx" not in e for e in detail)
    assert all({"loc", "msg", "type"} <= set(e) for e in detail)
    assert detail[0]["loc"] == ["body", "name"] and isinstance(detail[0]["msg"], str)


def test_422_for_too_long_value_does_not_echo_it(client):
    secret = "SNTLpassword" * 50
    response = client.post("/api/v1/auth/login", json={"email": secret, "password": secret})
    assert response.status_code == 422
    assert "SNTLpassword" not in response.text
    for error in response.json()["detail"]:
        assert "input" not in error and "ctx" not in error


def test_422_for_invalid_json_keeps_shape(client):
    response = client.post("/api/v1/auth/login", content=b"{not json SNTLjson",
                           headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    assert "SNTLjson" not in response.text
    [error] = response.json()["detail"]
    assert error["msg"] == "JSON decode error" and "ctx" not in error and "input" not in error
