"""Request ids, the structured access log, the generic 500 handler and the privacy contract.

The sentinel tests are the proof that no log line carries request or response content: unique
strings are planted in JSON bodies, query strings, headers (Authorization, Cookie, custom),
path ids and exception messages, success and failure paths are driven for the endpoints
that handle the most sensitive data, and ALL log output is searched (a JSON handler and a
console handler on the root logger, caplog's records including their args and extras, and
whatever reached stdout/stderr).
"""
import asyncio
import io
import json
import logging
import re
import uuid
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings
from app.core.logging_config import ConsoleFormatter, JsonFormatter, get_request_id
from app.core.middleware import RequestContextMiddleware, unhandled_exception_handler
from app.core.security import create_access_token, get_password_hash
from app.main import app
from app.models.models import User
from app.services.billing import entitlement as entitlement_module
from app.services.billing.account_token import account_token
from app.services.billing.verifier import TestVerifier, set_verifier_for_tests
from app.services.llm_service import llm_service

GENERATED_ID = re.compile(r"^[0-9a-f]{32}$")
PROXY = "10.20.30.40"


def sentinel(label: str) -> str:
    # Short and pattern-free so the message scrubber cannot hide a leak: the proof must be that
    # we never log the content at all.
    return f"SNTL{label}{uuid.uuid4().hex[:8]}"


class LogCapture:
    def __init__(self, caplog, capsys):
        self.caplog, self.capsys = caplog, capsys
        self.json_stream, self.console_stream = io.StringIO(), io.StringIO()
        self.out = ""

    def json_lines(self):
        return [json.loads(line) for line in self.json_stream.getvalue().splitlines() if line.strip()]

    def records(self, name=None):
        return [r for r in self.caplog.records if name is None or r.name == name]

    def text(self):
        captured = self.capsys.readouterr()
        self.out += captured.out + captured.err
        parts = [self.json_stream.getvalue(), self.console_stream.getvalue(), self.caplog.text, self.out]
        for record in self.caplog.records:
            parts.append(repr(record.__dict__))
            try:
                parts.append(record.getMessage())
            except Exception:
                pass
        return "\n".join(parts)

    def assert_clean(self, *secrets):
        text = self.text()
        leaked = [s for s in secrets if s and s in text]
        assert not leaked, f"leaked into logs: {leaked}"


@pytest.fixture
def logs(caplog, capsys):
    capture = LogCapture(caplog, capsys)
    root = logging.getLogger()
    handlers = []
    for stream, formatter in ((capture.json_stream, JsonFormatter()), (capture.console_stream, ConsoleFormatter())):
        handler = logging.StreamHandler(stream)
        handler.setFormatter(formatter)
        handler.setLevel(logging.DEBUG)
        root.addHandler(handler)
        handlers.append(handler)
    caplog.set_level(logging.DEBUG)
    yield capture
    for handler in handlers:
        root.removeHandler(handler)


def access_records(capture):
    return [line for line in capture.json_lines() if line["logger"] == "app.access"]


def _h(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}"}


class PeerShim:
    """Sets the ASGI peer address (TestClient always reports 'testclient')."""

    def __init__(self, inner, host):
        self.inner, self.host = inner, host

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            scope = dict(scope, client=(self.host, 40000))
        await self.inner(scope, receive, send)


def noisy_headers(token_header):
    """Headers carrying sentinels in Cookie and a custom header next to the given Authorization."""
    cookie, custom = sentinel("cookie"), sentinel("hdr")
    headers = dict(token_header)
    headers.update({"Cookie": f"session={cookie}", "X-Debug-Note": custom, "User-Agent": f"ua-{custom}"})
    return headers, [cookie, custom]


# --- wiring ----------------------------------------------------------------------------------


def test_middleware_is_pure_asgi_and_installed():
    assert not issubclass(RequestContextMiddleware, BaseHTTPMiddleware)
    assert any(m.cls is RequestContextMiddleware for m in app.user_middleware)
    assert app.exception_handlers.get(Exception) is unhandled_exception_handler


# --- request ids -------------------------------------------------------------------------------


def test_request_id_is_generated_and_echoed(client):
    response = client.get("/health")
    assert GENERATED_ID.match(response.headers["X-Request-ID"])
    assert client.get("/health").headers["X-Request-ID"] != response.headers["X-Request-ID"]


def test_request_id_from_untrusted_peer_is_ignored(client, monkeypatch):
    monkeypatch.setattr(settings, "TRUSTED_PROXY_IPS", PROXY)
    response = client.get("/health", headers={"X-Request-ID": "spoofed-id-12345"})
    assert response.headers["X-Request-ID"] != "spoofed-id-12345"
    assert GENERATED_ID.match(response.headers["X-Request-ID"])

    other_proxy = TestClient(PeerShim(app, "10.20.30.41"))
    response = other_proxy.get("/health", headers={"X-Request-ID": "spoofed-id-12345"})
    assert response.headers["X-Request-ID"] != "spoofed-id-12345"


def test_request_id_from_trusted_proxy_is_honoured(monkeypatch, logs):
    monkeypatch.setattr(settings, "TRUSTED_PROXY_IPS", f"{PROXY}/32")
    proxied = TestClient(PeerShim(app, PROXY))
    response = proxied.get("/health", headers={"X-Request-ID": "Proxy-Id-0123456789"})
    assert response.headers["X-Request-ID"] == "Proxy-Id-0123456789"
    assert access_records(logs)[-1]["request_id"] == "Proxy-Id-0123456789"


def test_no_trusted_proxies_means_nobody_is_trusted(monkeypatch):
    monkeypatch.setattr(settings, "TRUSTED_PROXY_IPS", "")
    response = TestClient(PeerShim(app, PROXY)).get("/health", headers={"X-Request-ID": "Proxy-Id-0123456789"})
    assert response.headers["X-Request-ID"] != "Proxy-Id-0123456789"


async def _ok_app(scope, receive, send):
    await send({"type": "http.response.start", "status": 200,
                "headers": [(b"content-type", b"text/plain"), (b"x-request-id", b"inner-set-value")]})
    await send({"type": "http.response.body", "body": b"ok"})


def _run_raw(headers, client=(PROXY, 1234)):
    sent = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "method": "GET", "path": "/x", "raw_path": b"/x", "query_string": b"",
             "headers": headers, "client": client, "server": ("t", 80), "scheme": "http", "http_version": "1.1"}
    asyncio.run(RequestContextMiddleware(_ok_app)(scope, receive, send))
    start = sent[0]
    ids = [v for k, v in start["headers"] if k.lower() == b"x-request-id"]
    assert len(ids) == 1, start["headers"]
    return ids[0].decode("latin-1")


@pytest.mark.parametrize("value", [
    b"abc\ndef12345", b"abcdefgh\r\nX-Evil: 1", b'abcdefgh"quoted', b"abcdefgh 123", b"abcd_efgh_123",
    b"x" * 65, b"short", b"", b"\xff" * 12, b"abcdefgh12\n",
])
def test_invalid_request_ids_from_trusted_proxy_are_replaced(monkeypatch, value):
    monkeypatch.setattr(settings, "TRUSTED_PROXY_IPS", PROXY)
    assert GENERATED_ID.match(_run_raw([(b"x-request-id", value)]))


def test_valid_request_id_bounds_from_trusted_proxy(monkeypatch):
    monkeypatch.setattr(settings, "TRUSTED_PROXY_IPS", PROXY)
    assert _run_raw([(b"x-request-id", b"a" * 8)]) == "a" * 8
    assert _run_raw([(b"x-request-id", b"A-1" * 21 + b"z")]) == "A-1" * 21 + "z"


def test_duplicate_request_id_headers_are_not_trusted(monkeypatch):
    monkeypatch.setattr(settings, "TRUSTED_PROXY_IPS", PROXY)
    assert GENERATED_ID.match(_run_raw([(b"x-request-id", b"first-id-1234"), (b"x-request-id", b"second-id-1234")]))


def test_inner_request_id_header_is_replaced_not_duplicated(monkeypatch):
    monkeypatch.setattr(settings, "TRUSTED_PROXY_IPS", "")
    assert GENERATED_ID.match(_run_raw([], client=None))


def test_request_id_contextvar_reaches_log_records_and_is_reset(client, ai_headers, monkeypatch, logs):
    async def boom(prompt, system_prompt=None, **kwargs):
        raise RuntimeError("upstream down")

    monkeypatch.setattr(llm_service, "call_qwen", boom)
    response = client.post("/api/v1/chat/ask", json={"question": "hi"}, headers=ai_headers)
    assert response.status_code == 502
    rid = response.headers["X-Request-ID"]
    failure = [line for line in logs.json_lines() if line["msg"].startswith("Chat LLM call failed")]
    assert failure and failure[0]["request_id"] == rid
    assert access_records(logs)[-1]["request_id"] == rid
    assert get_request_id() is None


# --- access log ---------------------------------------------------------------------------------


def test_access_log_uses_route_template_and_no_query(client, make_user, logs):
    user = make_user()
    query = sentinel("query")
    response = client.put(f"/api/v1/logs/2024-02-29?trace={query}", json={"mood": 3}, headers=_h(user))
    assert response.status_code == 200
    record = access_records(logs)[-1]
    assert record["msg"] == "request" and record["level"] == "INFO"
    assert record["method"] == "PUT" and record["route"] == "/api/v1/logs/{log_date}" and record["status"] == 200
    assert isinstance(record["duration_ms"], (int, float)) and record["duration_ms"] >= 0
    assert record["request_id"] == response.headers["X-Request-ID"]
    logs.assert_clean("2024-02-29", query, "trace=")


def test_access_log_for_unmatched_paths_is_generic(client, logs):
    secret_path = sentinel("path")
    assert client.get(f"/api/v1/nothing/{secret_path}?q=1").status_code == 404
    record = access_records(logs)[-1]
    assert record["route"] == "/unmatched" and record["status"] == 404 and record["level"] == "INFO"
    logs.assert_clean(secret_path)


def test_access_log_hides_path_ids(client, auth_headers, logs):
    period_id = str(uuid.uuid4())
    assert client.get(f"/api/v1/periods/{period_id}", headers=auth_headers).status_code == 404
    assert access_records(logs)[-1]["route"] == "/api/v1/periods/{period_id}"
    logs.assert_clean(period_id, period_id.replace("-", ""))


def test_one_access_record_per_request(client, logs):
    client.get("/health")
    assert len(access_records(logs)) == 1


def test_unknown_method_is_not_logged_verbatim(client, logs):
    client.request("SNTLMETHOD", "/health")
    assert access_records(logs)[-1]["method"] == "OTHER"
    logs.assert_clean("SNTLMETHOD")


# --- the generic 500 handler -------------------------------------------------------------------


@pytest.fixture
def quiet_client():
    return TestClient(app, raise_server_exceptions=False)


def _explode(secret):
    def raiser(*args, **kwargs):
        raise ValueError(f"note={secret} email={secret.lower()}@gmail.com")
    return raiser


def test_unhandled_exception_returns_generic_500_with_request_id(quiet_client, auth_headers, monkeypatch, logs):
    secret = sentinel("exc")
    monkeypatch.setattr("app.api.periods.recompute_cycle_lengths", _explode(secret))
    response = quiet_client.post("/api/v1/periods/", json={"start_date": "2026-01-01", "notes": "n"},
                                 headers=auth_headers)
    assert response.status_code == 500
    rid = response.headers["X-Request-ID"]
    assert response.json() == {"detail": "Internal server error", "request_id": rid}
    assert secret not in response.text

    errors = [line for line in logs.json_lines() if line.get("exc_type") == "ValueError"]
    assert len(errors) == 1, errors  # logged once
    assert errors[0]["level"] == "ERROR" and errors[0]["request_id"] == rid
    assert errors[0]["exc_where"].startswith("app/api/periods.py:")
    assert "traceback" not in errors[0]
    access = access_records(logs)[-1]
    assert access["status"] == 500 and access["level"] == "ERROR" and access["route"] == "/api/v1/periods/"
    logs.assert_clean(secret, secret.lower())


def test_unhandled_exception_is_not_reraised_to_the_server(auth_headers, monkeypatch):
    # The default TestClient re-raises server exceptions; the middleware answers instead.
    monkeypatch.setattr("app.api.periods.recompute_cycle_lengths", _explode(sentinel("exc")))
    response = TestClient(app).post("/api/v1/periods/", json={"start_date": "2026-01-01"}, headers=auth_headers)
    assert response.status_code == 500


def test_log_tracebacks_is_off_by_default_and_opt_in(quiet_client, auth_headers, monkeypatch, logs):
    from app.core.config import Settings

    assert Settings(_env_file=None, APP_ENV="testing").LOG_TRACEBACKS is False
    monkeypatch.setattr(settings, "LOG_TRACEBACKS", True)
    monkeypatch.setattr("app.api.periods.recompute_cycle_lengths", _explode("opt-in-detail"))
    quiet_client.post("/api/v1/periods/", json={"start_date": "2026-01-01"}, headers=auth_headers)
    errors = [line for line in logs.json_lines() if line.get("exc_type") == "ValueError"]
    assert "Traceback" in errors[0]["traceback"]


def test_registered_handler_works_on_its_own(logs):
    """The exception handler is also usable when an exception escapes outside the middleware."""
    mini = FastAPI()
    mini.add_exception_handler(Exception, unhandled_exception_handler)
    secret = sentinel("mini")

    @mini.get("/boom")
    def boom():
        raise KeyError(secret)

    response = TestClient(mini, raise_server_exceptions=False).get("/boom")
    assert response.status_code == 500
    body = response.json()
    assert body["detail"] == "Internal server error" and body["request_id"] == response.headers["X-Request-ID"]
    logs.assert_clean(secret)


def test_streaming_and_errors_after_start(logs):
    mini = FastAPI()
    mini.add_middleware(RequestContextMiddleware)

    @mini.get("/stream")
    def stream():
        def chunks():
            yield b"one,"
            yield b"two"
        return StreamingResponse(chunks(), media_type="text/plain")

    response = TestClient(mini).get("/stream")
    assert response.text == "one,two" and GENERATED_ID.match(response.headers["X-Request-ID"])
    assert access_records(logs)[-1]["route"] == "/stream"

    @mini.get("/broken-stream")
    def broken():
        def chunks():
            yield b"one,"
            raise RuntimeError("mid-stream")
        return StreamingResponse(chunks(), media_type="text/plain")

    with pytest.raises(Exception):  # RuntimeError, possibly wrapped in an ExceptionGroup by anyio
        TestClient(mini).get("/broken-stream")
    assert access_records(logs)[-1]["status"] == 200  # headers were already sent


# --- sentinel tests: the privacy contract ------------------------------------------------------


@pytest.fixture
def ai_headers(client, auth_headers):
    client.post("/api/v1/consents", json={"purpose": "ai_processing", "granted": True}, headers=auth_headers)
    return auth_headers


def test_chat_ask_success_logs_no_content(client, ai_headers, monkeypatch, logs):
    question, answer, query = sentinel("question"), sentinel("answer"), sentinel("query")
    prompts = []

    async def fake(prompt, system_prompt=None, **kwargs):
        prompts.append(prompt)
        return f"Here you go {answer}"

    monkeypatch.setattr(llm_service, "call_qwen", fake)
    headers, extra = noisy_headers(ai_headers)
    response = client.post(f"/api/v1/chat/ask?debug={query}", json={"question": f"Is {question} normal?"},
                           headers=headers)
    assert response.status_code == 200 and answer in response.text and question in prompts[0]
    logs.assert_clean(question, answer, query, *extra, ai_headers["Authorization"].split()[1])
    assert access_records(logs)[-1]["route"] == "/api/v1/chat/ask"


@pytest.mark.parametrize("failure", ["llm", "unhandled", "invalid"])
def test_chat_ask_failures_log_no_content(quiet_client, ai_headers, monkeypatch, logs, failure):
    question, secret = sentinel("question"), sentinel("exc")
    if failure == "llm":
        async def boom(prompt, system_prompt=None, **kwargs):
            raise RuntimeError(f"provider said {secret} about {prompt}")
        monkeypatch.setattr(llm_service, "call_qwen", boom)
        body, expected = {"question": question}, 502
    elif failure == "unhandled":
        monkeypatch.setattr("app.api.chat.messages_sent_today", _explode(secret))
        body, expected = {"question": question}, 500
    else:
        body, expected = {"question": question * 200, "language": secret}, 422
    headers, extra = noisy_headers(ai_headers)
    response = quiet_client.post("/api/v1/chat/ask", json=body, headers=headers)
    assert response.status_code == expected
    logs.assert_clean(question, secret, secret.lower(), *extra)


def test_chat_ask_with_bad_auth_logs_no_credentials(client, logs):
    bad = sentinel("auth")
    response = client.post("/api/v1/chat/ask", json={"question": sentinel("q")},
                           headers={"Authorization": f"Bearer {bad}", "Cookie": f"refresh={bad}"})
    assert response.status_code in (401, 403)
    logs.assert_clean(bad)


def test_daily_log_put_success_and_failures_log_no_content(client, quiet_client, db, make_user, monkeypatch, logs):
    from app.models.models import Medication

    user = make_user()
    med_name = sentinel("medname")
    med = Medication(user_id=user.id, name=med_name)
    db.add(med)
    db.commit()
    note, query = sentinel("note"), sentinel("query")
    headers, extra = noisy_headers(_h(user))
    body = {"mood": 2, "symptoms": ["cramps"], "flow": "heavy", "medications_taken": [str(med.id)],
            "note": f"felt {note}"}
    assert client.put(f"/api/v1/logs/2024-02-29?x={query}", json=body, headers=headers).status_code == 200
    assert client.get("/api/v1/logs/?from=2024-02-01&to=2024-02-29", headers=headers).status_code == 200
    bad_note = sentinel("badnote")
    assert client.put("/api/v1/logs/2024-02-28", json={"note": bad_note, "mood": 99}, headers=headers).status_code == 422
    assert client.put("/api/v1/logs/2024-02-28", json={"note": bad_note, "medications_taken": [str(uuid.uuid4())]},
                      headers=headers).status_code == 422
    secret = sentinel("exc")
    monkeypatch.setattr("app.api.daily_logs.entry_dict", _explode(secret))
    assert quiet_client.put("/api/v1/logs/2024-02-27", json={"note": bad_note}, headers=headers).status_code == 500
    logs.assert_clean(note, query, bad_note, secret, secret.lower(), med_name, str(med.id), "2024-02-2", *extra)


def test_periods_post_success_and_failures_log_no_content(client, quiet_client, make_user, monkeypatch, logs):
    user = make_user()
    note, query, client_id = sentinel("pnote"), sentinel("query"), str(uuid.uuid4())
    headers, extra = noisy_headers(_h(user))
    body = {"id": client_id, "start_date": "2026-01-02", "flow_intensity": "heavy", "pain_level": 8,
            "symptoms": ["cramps"], "notes": f"painful {note}"}
    assert client.post(f"/api/v1/periods/?ref={query}", json=body, headers=headers).status_code == 200
    assert client.get(f"/api/v1/periods/{client_id}", headers=headers).status_code == 200
    bad_note = sentinel("bad")
    assert client.post("/api/v1/periods/", json={"start_date": "not-a-date", "notes": bad_note},
                       headers=headers).status_code == 422
    other = make_user(email="other@gmail.com")
    assert client.post("/api/v1/periods/", json=dict(body, notes=bad_note), headers=_h(other)).status_code == 409
    secret = sentinel("exc")
    monkeypatch.setattr("app.api.periods.recompute_cycle_lengths", _explode(secret))
    assert quiet_client.post("/api/v1/periods/", json={"start_date": "2026-02-01", "notes": bad_note},
                             headers=headers).status_code == 500
    logs.assert_clean(note, query, client_id, bad_note, secret, secret.lower(), *extra)


@pytest.fixture
def billing(monkeypatch):
    now = datetime(2026, 11, 1, 12, 0, 0)
    monkeypatch.setattr(settings, "BILLING_MODE", "test")
    monkeypatch.setattr(settings, "BILLING_PRODUCT_IDS", "luna_ai_monthly")
    monkeypatch.setattr(entitlement_module, "utcnow", lambda: now)
    set_verifier_for_tests(TestVerifier())
    entitlement_module.reset_cooldowns()
    yield now
    set_verifier_for_tests(None)
    entitlement_module.reset_cooldowns()


def test_billing_verify_success_and_failures_log_no_content(client, quiet_client, make_user, billing, monkeypatch,
                                                            logs):
    user = make_user()
    expiry = (billing + timedelta(days=30)).isoformat()
    token = f"test:luna_ai_monthly:ACTIVE:{expiry}:{account_token(user.id)}"
    headers, extra = noisy_headers(_h(user))
    query = sentinel("query")
    response = client.post(f"/api/v1/billing/verify?t={query}",
                           json={"purchase_token": token, "product_id": "luna_ai_monthly"}, headers=headers)
    assert response.status_code == 200, response.text
    garbage = sentinel("ptoken")
    assert client.post("/api/v1/billing/verify", json={"purchase_token": garbage, "product_id": "luna_ai_monthly"},
                       headers=headers).status_code in (400, 402, 403, 409, 422)
    assert client.post("/api/v1/billing/verify", json={"purchase_token": garbage * 100, "product_id": 5},
                       headers=headers).status_code == 422
    secret = sentinel("exc")
    monkeypatch.setattr(entitlement_module, "verify_and_store", _explode(secret))
    assert quiet_client.post("/api/v1/billing/verify", json={"purchase_token": garbage, "product_id": "luna_ai_monthly"},
                             headers=headers).status_code == 500
    logs.assert_clean(token, account_token(user.id), garbage, query, secret, secret.lower(), *extra)


def test_auth_login_success_and_failures_log_no_content(client, quiet_client, db, monkeypatch, logs):
    local = sentinel("email").lower()
    email, password = f"{local}@gmail.com", sentinel("pass")
    db.add(User(email=email, hashed_password=get_password_hash(password), is_email_verified=True))
    db.commit()
    cookie = sentinel("cookie")
    headers = {"Cookie": f"sid={cookie}"}
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password}, headers=headers)
    assert response.status_code == 200, response.text
    tokens = [response.json()["access_token"], response.json().get("refresh_token") or ""]
    wrong = sentinel("wrong")
    assert client.post("/api/v1/auth/login", json={"email": email, "password": wrong}, headers=headers).status_code == 401
    assert client.post("/api/v1/auth/login", json={"email": f"x{local}", "password": wrong},
                       headers=headers).status_code == 422
    secret = sentinel("exc")
    monkeypatch.setattr("app.api.auth.verify_password", _explode(secret))
    assert quiet_client.post("/api/v1/auth/login", json={"email": email, "password": password},
                             headers=headers).status_code == 500
    logs.assert_clean(local, email, password, wrong, cookie, secret, secret.lower(), *tokens)
