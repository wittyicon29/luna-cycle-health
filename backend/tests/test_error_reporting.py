"""Optional error reporting (Sentry-compatible): off by default, scrubbed when on.

The privacy proof: real requests are driven through the real app against a failing endpoint
registered only for the test. Sentinels are planted in the body, query string, headers,
cookies, path id, the exception message, local variables, breadcrumbs and the Sentry scope
(user, extra, context, tags), and the serialised event that reached a capturing transport
must contain none of them.
"""
import json
import logging
import os
import subprocess
import sys
import uuid
from pathlib import Path

import pytest
from fastapi import HTTPException, Request
from fastapi.testclient import TestClient

from app.core import error_reporting
from app.core.config import APP_VERSION, Settings, settings
from app.main import app

BACKEND = Path(__file__).resolve().parents[1]
FAKE_DSN = "https://public@example.invalid/1"
EMAIL = "leaky.user@example.org"


def sentinel(label: str) -> str:
    return f"SNTL{label}{uuid.uuid4().hex[:8]}"


@pytest.fixture
def capturing_transport_cls():
    import sentry_sdk.transport

    class CapturingTransport(sentry_sdk.transport.Transport):
        def __init__(self, options=None):
            super().__init__(options)
            self.envelopes = []

        def capture_envelope(self, envelope):
            self.envelopes.append(envelope)

        def events(self):
            events = []
            for envelope in self.envelopes:
                for item in envelope.items:
                    payload = item.payload.json
                    if payload is not None and item.headers.get("type") in ("event", "transaction"):
                        events.append(payload)
            return events

        def serialised(self):
            # The bytes that would go over the wire, plus the decoded events.
            raw = "".join(e.serialize().decode("utf-8", "replace") for e in self.envelopes)
            return raw + json.dumps(self.events(), default=str)

    return CapturingTransport


@pytest.fixture
def reporting(monkeypatch, capturing_transport_cls):
    import sentry_sdk

    monkeypatch.setattr(settings, "SENTRY_DSN", FAKE_DSN)
    transport = capturing_transport_cls()
    assert error_reporting.init_error_reporting(transport=transport) is True
    yield transport
    error_reporting.shutdown_error_reporting()
    assert not sentry_sdk.get_client().is_active()


@pytest.fixture
def failing_routes():
    """Test-only endpoints on the real app (removed afterwards)."""
    sentinels = {name: sentinel(name) for name in ("BODY", "QUERY", "AUTH", "COOKIE", "HDR", "PATH", "EXC",
                                                    "LOCAL", "CRUMB", "USER", "EXTRA", "CTX", "TAG", "LOG")}

    async def boom(item_id: str, request: Request):
        import sentry_sdk

        body = await request.body()
        local_secret = sentinels["LOCAL"]  # noqa: F841 - must not appear as a frame variable
        sentry_sdk.set_user({"id": sentinels["USER"], "email": EMAIL})
        sentry_sdk.set_extra("payload", sentinels["EXTRA"])
        sentry_sdk.set_context("custom", {"value": sentinels["CTX"]})
        sentry_sdk.set_tag("leak", sentinels["TAG"])
        sentry_sdk.add_breadcrumb(category="httpx", message=f"GET https://x/?q={sentinels['CRUMB']}")
        sentry_sdk.add_breadcrumb(category="console", message=sentinels["CRUMB"])
        sentry_sdk.add_breadcrumb(category="query", message=f"SELECT '{sentinels['CRUMB']}'")
        sentry_sdk.add_breadcrumb(category="custom", message=f"for {EMAIL}",
                                  data={"note": sentinels["CRUMB"], "email": EMAIL})
        logging.getLogger("app.test").error("about to fail %s", sentinels["LOG"])
        raise ValueError(f"note={sentinels['EXC']} email={EMAIL} body={body!r} id={item_id}")

    async def not_found():
        raise HTTPException(status_code=404, detail="nope")

    async def forbidden():
        raise HTTPException(status_code=403, detail="no")

    async def typed(n: int):
        return {"n": n}

    before = list(app.router.routes)
    app.add_api_route("/__test__/boom/{item_id}", boom, methods=["POST"])
    app.add_api_route("/__test__/404", not_found, methods=["GET"])
    app.add_api_route("/__test__/403", forbidden, methods=["GET"])
    app.add_api_route("/__test__/typed", typed, methods=["GET"])
    yield sentinels
    app.router.routes[:] = before


def _boom(client, s):
    return client.post(
        f"/__test__/boom/{s['PATH']}?q={s['QUERY']}&email={EMAIL}",
        json={"note": s["BODY"], "email": EMAIL},
        headers={"Authorization": f"Bearer {s['AUTH']}", "X-Custom": s["HDR"], "Cookie": f"sid={s['COOKIE']}"},
    )


# --- off by default -------------------------------------------------------------------------


def _run_python(code: str, **env_overrides):
    env = {**os.environ, "APP_ENV": "testing", "SECRET_KEY": "test-secret-key",
           "DATABASE_URL": "sqlite:///:memory:", "SENTRY_DSN": "", **env_overrides}
    return subprocess.run([sys.executable, "-c", code], cwd=BACKEND, env=env, capture_output=True, text=True,
                          timeout=120)


def test_empty_dsn_never_imports_sentry_sdk():
    code = (
        "import sys\n"
        "import app.main\n"
        "from app.core import error_reporting\n"
        "assert 'sentry_sdk' not in sys.modules, 'imported at app import'\n"
        "assert error_reporting.init_error_reporting() is False\n"
        "assert error_reporting.is_enabled() is False\n"
        "error_reporting.capture_exception(ValueError('x'), request_id='abcdefgh1234')\n"
        "from fastapi.testclient import TestClient\n"
        "from fastapi import Request\n"
        "async def boom():\n"
        "    raise ValueError('x')\n"
        "app.main.app.add_api_route('/__boom', boom)\n"
        "r = TestClient(app.main.app).get('/__boom')\n"
        "assert r.status_code == 500, r.status_code\n"
        "assert 'sentry_sdk' not in sys.modules, 'imported later'\n"
        "print('OK')\n"
    )
    result = _run_python(code)
    assert result.returncode == 0, result.stderr[-2000:]
    assert "OK" in result.stdout


def test_reporting_is_off_by_default():
    assert Settings().SENTRY_DSN == ""
    assert Settings().SENTRY_TRACES_SAMPLE_RATE == 0.0
    assert error_reporting.is_enabled() is False


# --- settings ---------------------------------------------------------------------------------


def test_environment_defaults_to_app_env(monkeypatch):
    monkeypatch.setenv("SENTRY_ENVIRONMENT", "")
    assert Settings().sentry_environment == Settings().APP_ENV
    monkeypatch.setenv("SENTRY_ENVIRONMENT", "staging-eu")
    assert Settings().sentry_environment == "staging-eu"


@pytest.mark.parametrize("value", ["-0.1", "1.5", "nan"])
def test_traces_sample_rate_must_be_between_zero_and_one(monkeypatch, value):
    monkeypatch.setenv("SENTRY_TRACES_SAMPLE_RATE", value)
    with pytest.raises(ValueError):
        Settings()


# --- init -------------------------------------------------------------------------------------


def test_init_uses_privacy_options(reporting):
    import sentry_sdk

    client = sentry_sdk.get_client()
    assert client.is_active()
    options = client.options
    assert options["send_default_pii"] is False
    assert options["include_local_variables"] is False
    assert options["include_source_context"] is False
    assert options["max_request_body_size"] == "never"
    assert options["default_integrations"] is False
    collection = options["data_collection"]
    assert collection["provided_by_user"] is True
    assert collection["user_info"] is False
    assert collection["http_bodies"] == []
    for key in ("cookies", "url_query_params"):
        assert collection[key]["mode"] == "off", key
    assert collection["http_headers"]["request"]["mode"] == "off"
    assert collection["stack_frame_variables"] is False
    assert collection["frame_context_lines"] == 0
    assert collection["database_query_data"] is False
    assert collection["gen_ai"] == {"inputs": False, "outputs": False}
    assert options["auto_enabling_integrations"] is False
    assert options["before_send"] is error_reporting.scrub_event
    assert options["before_breadcrumb"] is error_reporting.scrub_breadcrumb
    assert options["before_send_transaction"] is error_reporting.scrub_transaction
    assert options["environment"] == settings.sentry_environment
    assert options["release"] == f"luna-api@{APP_VERSION}"
    assert options["traces_sample_rate"] == 0.0
    # No integration may attach request data, log records, argv, modules or hooks.
    assert dict(client.integrations) == {}


def test_traces_sample_rate_is_honoured(monkeypatch, capturing_transport_cls):
    import sentry_sdk

    monkeypatch.setattr(settings, "SENTRY_DSN", FAKE_DSN)
    monkeypatch.setattr(settings, "SENTRY_TRACES_SAMPLE_RATE", 0.25)
    try:
        assert error_reporting.init_error_reporting(transport=capturing_transport_cls()) is True
        assert sentry_sdk.get_client().options["traces_sample_rate"] == 0.25
    finally:
        error_reporting.shutdown_error_reporting()


def test_init_is_idempotent(reporting, capturing_transport_cls):
    import sentry_sdk

    client = sentry_sdk.get_client()
    assert error_reporting.init_error_reporting(transport=capturing_transport_cls()) is True
    assert sentry_sdk.get_client() is client


def test_malformed_dsn_never_crashes(monkeypatch, caplog):
    import sentry_sdk

    secret_part = sentinel("DSN")
    monkeypatch.setattr(settings, "SENTRY_DSN", f"nota-dsn://{secret_part}@@::/x")
    caplog.set_level(logging.WARNING)
    try:
        assert error_reporting.init_error_reporting() is False
        assert error_reporting.is_enabled() is False
        assert not sentry_sdk.get_client().is_active()
        error_reporting.capture_exception(ValueError("x"), request_id="abcdefgh1234")  # no-op, no raise
        warnings = [r for r in caplog.records if r.levelno == logging.WARNING and r.name == "app.error_reporting"]
        assert len(warnings) == 1
        assert "BadDsn" in warnings[0].getMessage()
        assert secret_part not in caplog.text
        assert all(secret_part not in repr(r.__dict__) for r in caplog.records)
    finally:
        error_reporting.shutdown_error_reporting()


# --- events through the real app --------------------------------------------------------------


def test_unhandled_exception_event_contains_no_request_content(reporting, failing_routes):
    s = failing_routes
    response = _boom(TestClient(app, raise_server_exceptions=False), s)

    assert response.status_code == 500
    rid = response.json()["request_id"]
    assert response.json() == {"detail": "Internal server error", "request_id": rid}

    events = reporting.events()
    assert len(events) == 1
    event = events[0]
    serialised = reporting.serialised()
    leaked = [value for value in [*s.values(), EMAIL, "SNTL"] if value in serialised]
    assert not leaked, f"leaked into the error event: {leaked}"

    (exc,) = event["exception"]["values"]
    assert exc["type"] == "ValueError"
    assert exc["value"] == "ValueError"
    frames = exc["stacktrace"]["frames"]
    assert frames, "stack trace (file/line/function) is kept"
    for frame in frames:
        assert set(frame) <= {"filename", "module", "function", "lineno", "in_app"}
    assert any(f.get("function") == "boom" for f in frames)

    for key in ("request", "user", "server_name", "extra", "modules", "threads"):
        assert key not in event, key
    assert event["tags"] == {"request_id": rid}
    assert set(event.get("contexts", {})) <= {"runtime", "trace"}
    crumbs = event.get("breadcrumbs", {}).get("values", [])
    assert [c["category"] for c in crumbs] == ["custom"]
    assert crumbs[0]["data"] == {"note": "[scrubbed]", "email": "[scrubbed]"}
    assert event["environment"] == settings.sentry_environment
    assert event["release"] == f"luna-api@{APP_VERSION}"


def test_scope_data_does_not_leak_into_later_events(reporting, failing_routes):
    client = TestClient(app, raise_server_exceptions=False)
    _boom(client, failing_routes)
    _boom(client, failing_routes)
    events = reporting.events()
    assert len(events) == 2
    rids = [e["tags"]["request_id"] for e in events]
    assert rids[0] != rids[1]


def test_client_errors_are_not_reported(reporting, failing_routes):
    client = TestClient(app, raise_server_exceptions=False)
    assert client.get("/__test__/404").status_code == 404
    assert client.get("/__test__/403").status_code == 403
    assert client.get("/__test__/typed?n=notanumber").status_code == 422
    assert client.get("/api/v1/periods/").status_code in (401, 403)
    assert client.get("/no/such/route").status_code == 404
    assert reporting.events() == []


def test_capture_never_raises(reporting, monkeypatch):
    import sentry_sdk

    def explode(*args, **kwargs):
        raise RuntimeError("transport down")

    monkeypatch.setattr(sentry_sdk, "capture_exception", explode)
    error_reporting.capture_exception(ValueError("x"), request_id="abcdefgh1234")


# --- scrubbers (unit) -------------------------------------------------------------------------


def _dirty_event(secret):
    return {
        "event_id": "a" * 32,
        "level": "error",
        "platform": "python",
        "timestamp": "2026-11-07T00:00:00Z",
        "environment": "production",
        "release": "luna-api@1.0.0",
        "server_name": f"host-{secret}",
        "transaction": f"/api/v1/logs/{secret}",
        "message": f"failed for {secret}",
        "logentry": {"message": "failed for %s", "params": [secret], "formatted": f"failed for {secret}"},
        "request": {"url": f"https://x/?q={secret}", "data": secret, "headers": {"Authorization": secret},
                    "cookies": secret, "query_string": secret},
        "user": {"id": secret, "email": EMAIL, "ip_address": "1.2.3.4"},
        "extra": {"sys.argv": [secret]},
        "modules": {"x": secret},
        "contexts": {"runtime": {"name": "CPython", "version": "3.11.9", "extra": secret},
                     "trace": {"trace_id": "b" * 32, "span_id": "c" * 16, "op": "http", "data": {"q": secret}},
                     "response": {"body": secret}, "custom": {"x": secret}},
        "tags": {"request_id": "abcdef0123456789", "leak": secret},
        "breadcrumbs": {"values": [
            {"category": "httplib", "message": secret},
            {"category": "custom", "message": f"mail {EMAIL}", "data": {"token": secret}, "level": "info"},
        ]},
        "exception": {"values": [
            {"type": "KeyError", "value": f"'{secret}'", "module": None,
             "mechanism": {"type": "generic", "handled": False, "data": {"x": secret}}},
            {"type": "ValueError", "value": f"note={secret}",
             "stacktrace": {"frames": [{"filename": "app/x.py", "function": "f", "lineno": 3, "in_app": True,
                                        "abs_path": f"/srv/{secret}.py", "context_line": secret,
                                        "pre_context": [secret], "vars": {"note": secret}}]}},
        ]},
        "threads": {"values": [{"stacktrace": {"frames": [{"vars": {"x": secret}}]}}]},
    }


def test_scrub_event_whitelists_structure():
    secret = sentinel("UNIT")
    event = _dirty_event(secret)
    original = json.dumps(event, sort_keys=True)
    cleaned = error_reporting.scrub_event(event, {})
    assert json.dumps(event, sort_keys=True) == original, "input must not be mutated"
    text = json.dumps(cleaned)
    assert secret not in text and EMAIL not in text
    for key in ("request", "user", "server_name", "extra", "modules", "threads", "transaction"):
        assert key not in cleaned, key
    assert cleaned["tags"] == {"request_id": "abcdef0123456789"}
    assert cleaned["contexts"] == {"runtime": {"name": "CPython", "version": "3.11.9"},
                                   "trace": {"trace_id": "b" * 32, "span_id": "c" * 16, "op": "http"}}
    assert [v["value"] for v in cleaned["exception"]["values"]] == ["KeyError", "ValueError"]
    assert cleaned["exception"]["values"][0]["mechanism"] == {"type": "generic", "handled": False}
    assert cleaned["exception"]["values"][1]["stacktrace"]["frames"] == [
        {"filename": "app/x.py", "function": "f", "lineno": 3, "in_app": True}]
    assert cleaned["logentry"] == {"message": "failed for %s"}
    assert cleaned["breadcrumbs"]["values"] == [
        {"category": "custom", "message": "mail [scrubbed]", "data": {"token": "[scrubbed]"}, "level": "info"}]
    assert cleaned["event_id"] == "a" * 32 and cleaned["level"] == "error"


def test_scrub_event_drops_invalid_request_id_tag():
    event = {"tags": {"request_id": "bad id\nwith newline"}}
    assert "tags" not in error_reporting.scrub_event(event, {}) or \
        error_reporting.scrub_event(event, {})["tags"] == {}


@pytest.mark.parametrize("event", ["garbage", None, {"exception": {"values": "notalist"}}, {"tags": 5}])
def test_scrub_event_fails_closed(event):
    result = error_reporting.scrub_event(event, {})
    assert result is None or "SNTL" not in json.dumps(result, default=str)


def test_scrub_event_fails_closed_on_unexpected_error(monkeypatch):
    def broken(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(error_reporting, "_scrub_exception", broken)
    assert error_reporting.scrub_event({"exception": {"values": []}}, {}) is None


@pytest.mark.parametrize("category", ["httplib", "httpx", "console", "query", "subprocess"])
def test_scrub_breadcrumb_drops_noisy_categories(category):
    assert error_reporting.scrub_breadcrumb({"category": category, "message": "x"}, {}) is None


def test_scrub_breadcrumb_scrubs_the_rest():
    secret = sentinel("CRUMB")
    crumb = {"category": "auth", "type": "default", "level": "info", "timestamp": "t",
             "message": f"user {EMAIL}", "data": {"email": EMAIL, "password": secret, "count": 3}, "extra": secret}
    cleaned = error_reporting.scrub_breadcrumb(crumb, {})
    assert cleaned == {"category": "auth", "type": "default", "level": "info", "timestamp": "t",
                       "message": "user [scrubbed]", "data": {"email": "[scrubbed]", "password": "[scrubbed]",
                                                              "count": 3}}
    assert error_reporting.scrub_breadcrumb("garbage", {}) is None


def test_scrub_transaction_keeps_only_timing():
    secret = sentinel("TX")
    tx = {"type": "transaction", "event_id": "a" * 32, "transaction": f"/x/{secret}",
          "start_timestamp": 1, "timestamp": 2, "request": {"url": secret}, "user": {"id": secret},
          "contexts": {"trace": {"trace_id": "b" * 32, "span_id": "c" * 16, "op": "http", "data": {"x": secret}}},
          "spans": [{"span_id": "d" * 16, "trace_id": "b" * 32, "parent_span_id": "c" * 16, "op": "db",
                     "description": f"SELECT '{secret}'", "data": {"q": secret}, "start_timestamp": 1,
                     "timestamp": 2, "status": "ok"}]}
    cleaned = error_reporting.scrub_transaction(tx, {})
    assert secret not in json.dumps(cleaned)
    assert cleaned["type"] == "transaction"
    assert cleaned["spans"] == [{"span_id": "d" * 16, "trace_id": "b" * 32, "parent_span_id": "c" * 16,
                                 "op": "db", "start_timestamp": 1, "timestamp": 2, "status": "ok"}]


def test_env_template_documents_sentry_settings():
    text = (BACKEND.parent / "deploy" / ".env.example").read_text(encoding="utf-8")
    for name in ("SENTRY_DSN", "SENTRY_TRACES_SAMPLE_RATE", "SENTRY_ENVIRONMENT"):
        assert f"\n{name}=" in text, name
    assert "\nSENTRY_DSN=\n" in text, "reporting must stay off in an untouched template"


def test_real_trace_ids_survive_and_malformed_ids_are_dropped():
    trace_id, span_id = uuid.uuid4().hex, uuid.uuid4().hex[:16]  # mixed digits/letters, like the SDK's
    event = {"event_id": "a" * 32, "contexts": {"trace": {"trace_id": trace_id, "span_id": span_id,
                                                          "parent_span_id": "not-hex-SNTL", "op": "http"}}}
    cleaned = error_reporting.scrub_event(event, {})
    assert cleaned["contexts"]["trace"] == {"trace_id": trace_id, "span_id": span_id, "op": "http"}

    for bad in ("SNTL" + "a" * 28, "A" * 32, "a" * 15, "a" * 33, "a@b.example.com", 12345):
        event = {"event_id": "a" * 32, "contexts": {"trace": {"trace_id": bad, "span_id": span_id}}}
        trace = error_reporting.scrub_event(event, {})["contexts"]["trace"]
        assert "trace_id" not in trace and trace["span_id"] == span_id


def test_span_ids_are_validated_as_hex():
    trace_id = uuid.uuid4().hex
    tx = {"type": "transaction", "event_id": "a" * 32,
          "spans": [{"span_id": "zz-not-hex-span", "trace_id": trace_id, "op": "db"}]}
    [span] = error_reporting.scrub_transaction(tx, {})["spans"]
    assert span == {"trace_id": trace_id, "op": "db"}
