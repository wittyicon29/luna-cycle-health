"""MAX_REQUEST_BYTES: Content-Length checks, streamed-byte counting and normal requests."""
import asyncio
import json

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.core.config import Settings, settings
from app.core.middleware import BodySizeLimitMiddleware
from app.main import install_http_middleware


class Item(BaseModel):
    text: str


def _mini_app():
    mini = FastAPI()
    seen = {}

    @mini.post("/api/v1/echo")
    async def echo(item: Item):
        return {"length": len(item.text)}

    @mini.post("/api/v1/raw")
    async def raw(request: Request):
        body = await request.body()
        seen["raw"] = len(body)
        return {"length": len(body)}

    @mini.post("/api/v1/ignore")
    async def ignore():
        seen["ignore"] = True  # never reads the body: only the Content-Length check can stop it
        return {"ok": True}

    @mini.post("/api/v1/stream-read")
    async def stream_read(request: Request):
        total = 0
        async for chunk in request.stream():
            total += len(chunk)
        return {"length": total}

    install_http_middleware(mini)
    return mini, seen


@pytest.fixture
def mini():
    return _mini_app()


def test_default_limit_is_one_mebibyte():
    assert Settings(_env_file=None).MAX_REQUEST_BYTES == 1_048_576


def test_normal_requests_pass(mini):
    app_, _ = mini
    client = TestClient(app_)
    response = client.post("/api/v1/echo", json={"text": "hello"})
    assert response.status_code == 200 and response.json() == {"length": 5}


def test_oversize_content_length_is_rejected_before_the_app_runs(mini, monkeypatch):
    monkeypatch.setattr(settings, "MAX_REQUEST_BYTES", 100)
    app_, seen = mini
    response = TestClient(app_).post("/api/v1/raw", content=b"x" * 101)
    assert response.status_code == 413
    assert response.json() == {"detail": "Request too large"}
    assert "raw" not in seen
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-request-id"]
    response = TestClient(app_).post("/api/v1/ignore", content=b"x" * 101)
    assert response.status_code == 413 and "ignore" not in seen


def test_body_exactly_at_limit_passes(mini, monkeypatch):
    monkeypatch.setattr(settings, "MAX_REQUEST_BYTES", 100)
    app_, _ = mini
    response = TestClient(app_).post("/api/v1/raw", content=b"x" * 100)
    assert response.status_code == 200 and response.json() == {"length": 100}


def test_limit_is_configurable(mini, monkeypatch):
    app_, _ = mini
    client = TestClient(app_)
    body = b"y" * 5000
    assert client.post("/api/v1/raw", content=body).status_code == 200
    monkeypatch.setattr(settings, "MAX_REQUEST_BYTES", 4999)
    assert client.post("/api/v1/raw", content=body).status_code == 413


def test_chunked_upload_without_content_length_is_counted(mini, monkeypatch):
    monkeypatch.setattr(settings, "MAX_REQUEST_BYTES", 100)
    app_, _ = mini

    def chunks():
        for _ in range(10):
            yield b"z" * 20

    response = TestClient(app_).post("/api/v1/raw", content=chunks())
    assert response.status_code == 413
    assert response.json() == {"detail": "Request too large"}
    assert response.headers["x-frame-options"] == "DENY"


# --- raw ASGI: multi-message bodies and a lying Content-Length -----------------------------------


async def _call(asgi_app, path, chunks, headers=()):
    messages = [{"type": "http.request", "body": c, "more_body": i < len(chunks) - 1} for i, c in enumerate(chunks)]
    sent = []

    async def receive():
        if messages:
            return messages.pop(0)
        await asyncio.sleep(0)
        return {"type": "http.disconnect"}

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST",
             "scheme": "http", "path": path, "raw_path": path.encode(), "query_string": b"",
             "root_path": "", "headers": [(b"host", b"testserver"), *headers],
             "client": ("127.0.0.1", 5000), "server": ("testserver", 80)}
    await asgi_app(scope, receive, send)
    start = next(m for m in sent if m["type"] == "http.response.start")
    body = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return start["status"], dict(start["headers"]), body


@pytest.mark.parametrize("path", ["/api/v1/raw", "/api/v1/stream-read", "/api/v1/echo"])
def test_streamed_body_exceeding_cap_mid_stream_gets_413(mini, monkeypatch, path):
    monkeypatch.setattr(settings, "MAX_REQUEST_BYTES", 100)
    app_, _ = mini
    status, headers, body = asyncio.run(_call(app_, path, [b"a" * 60, b"b" * 60, b"c" * 60]))
    assert status == 413
    assert json.loads(body) == {"detail": "Request too large"}
    assert headers[b"x-content-type-options"] == b"nosniff"
    assert b"x-request-id" in headers


def test_lying_content_length_is_still_counted(mini, monkeypatch):
    monkeypatch.setattr(settings, "MAX_REQUEST_BYTES", 100)
    app_, _ = mini
    status, _, body = asyncio.run(_call(app_, "/api/v1/raw", [b"a" * 60, b"b" * 60],
                                        headers=[(b"content-length", b"10")]))
    assert status == 413 and json.loads(body) == {"detail": "Request too large"}


def test_multi_chunk_body_under_cap_passes(mini, monkeypatch):
    monkeypatch.setattr(settings, "MAX_REQUEST_BYTES", 100)
    app_, _ = mini
    status, _, body = asyncio.run(_call(app_, "/api/v1/stream-read", [b"a" * 40, b"b" * 40, b""]))
    assert status == 200 and json.loads(body) == {"length": 80}


def test_non_http_scopes_pass_through():
    calls = []

    async def inner(scope, receive, send):
        calls.append(scope["type"])

    asyncio.run(BodySizeLimitMiddleware(inner)({"type": "lifespan"}, None, None))
    assert calls == ["lifespan"]


def test_existing_422_handler_unaffected(client):
    response = client.post("/api/v1/auth/login", json={"email": "not-an-email", "password": "x"})
    assert response.status_code == 422
    assert response.json()["detail"][0]["msg"]
