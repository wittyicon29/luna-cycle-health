"""Third-party log text is never trusted: slowapi is quiet and other libraries' messages are
reduced to the first line of their message template (no args, no formatted text)."""
import asyncio
import gc
import json
import logging

import pytest
from fastapi.testclient import TestClient

from app.core.logging_config import ConsoleFormatter, JsonFormatter
from app.main import app
from tests.test_request_log import LogCapture, PeerShim, access_records, logs  # noqa: F401  (fixture)

SENTINEL_IP = "203.0.113.77"


def _record(name, msg, args=(), level=logging.WARNING):
    return logging.LogRecord(name, level, __file__, 1, msg, args, None)


def _formatted(record):
    return json.loads(JsonFormatter().format(record))["msg"], ConsoleFormatter().format(record)


# --- M1: slowapi -----------------------------------------------------------------------------


def test_rate_limit_hit_logs_neither_ip_nor_path(logs):
    client = TestClient(PeerShim(app, SENTINEL_IP))
    statuses = [client.post("/api/v1/auth/login", json={"email": "x@gmail.com", "password": "pw"}).status_code
                for _ in range(8)]
    assert 429 in statuses
    text = logs.text()
    assert SENTINEL_IP not in text
    assert "exceeded at endpoint" not in text
    assert any(r.name == "slowapi" and r.getMessage() == "rate limit exceeded" for r in logs.records())
    limited = [r for r in access_records(logs) if r["status"] == 429]
    assert limited and limited[-1]["route"] == "/api/v1/auth/login"


def test_slowapi_rate_limit_message_is_replaced_and_args_dropped(caplog):
    caplog.set_level(logging.DEBUG)
    slowapi = logging.getLogger("slowapi")
    slowapi.warning("ratelimit %s (%s) exceeded at endpoint: %s", "5 per 1 minute", SENTINEL_IP, "/x/SNTLpath")
    slowapi.error("failed to load ratelimit for view function %s (%s)", "f", "SNTLexc")
    messages = [r.getMessage() for r in caplog.records if r.name == "slowapi"]
    assert messages == ["rate limit exceeded", "failed to load ratelimit for view function %s (%s)"]
    assert SENTINEL_IP not in caplog.text and "SNTL" not in caplog.text


def test_slowapi_storage_warnings_are_kept(caplog):
    caplog.set_level(logging.WARNING)
    logging.getLogger("slowapi").warning("Rate limit storage unreachable - falling back to in-memory storage")
    assert "Rate limit storage unreachable" in caplog.text


# --- M2: template-only messages for foreign loggers --------------------------------------------


def test_foreign_logger_gets_template_first_line_only():
    record = _record("somelib", "failed for %s\nsecond line SNTLline2", ("SNTLarg",))
    msg, console = _formatted(record)
    assert msg == "failed for %s"
    for out in (msg, console):
        assert "SNTL" not in out


def test_foreign_template_is_truncated_and_scrubbed():
    record = _record("somelib", "token eyJabcdefgh.ijklmnopq.rstu " + "x" * 400)
    msg, console = _formatted(record)
    assert len(msg) <= 200 and "eyJabcdefgh" not in msg
    assert "eyJabcdefgh" not in console


def test_non_string_template_is_reduced_to_its_type():
    record = _record("somelib", ValueError("SNTLobj"))
    msg, console = _formatted(record)
    assert "SNTLobj" not in msg and "SNTLobj" not in console


@pytest.mark.parametrize("name", ["app", "app.api.chat", "uvicorn.error", "gunicorn.error"])
def test_own_and_server_loggers_keep_their_formatted_message(name):
    record = _record(name, "Chat LLM call failed: %s", ("RuntimeError",))
    msg, console = _formatted(record)
    assert msg == "Chat LLM call failed: RuntimeError"
    assert "Chat LLM call failed: RuntimeError" in console


def test_console_formatter_scrubs_own_messages_too():
    record = _record("app.x", "got eyJabcdefgh.ijklmnopq.rstu from a@b.example.com")
    console = ConsoleFormatter().format(record)
    assert "eyJabcdefgh" not in console and "a@b.example.com" not in console


def test_app_lookalike_logger_names_are_foreign():
    msg, _ = _formatted(_record("appx", "v=%s", ("SNTLlook",)))
    assert msg == "v" and "SNTLlook" not in msg


def test_unretrieved_task_exception_does_not_leak(logs):
    async def fail():
        raise ValueError("note=SNTLtask")

    async def main():
        asyncio.get_running_loop().create_task(fail())
        await asyncio.sleep(0)
        await asyncio.sleep(0)

    asyncio.run(main())
    gc.collect()  # "Task exception was never retrieved" is logged when the task is collected
    lines = [line for line in logs.json_lines() if line["logger"] == "asyncio"]
    assert lines and all("SNTLtask" not in json.dumps(line) for line in lines)
    assert "SNTLtask" not in logs.json_stream.getvalue() + logs.console_stream.getvalue()


def test_exception_in_callback_does_not_leak(logs):
    def boom():
        raise ValueError("note=SNTLcallback")

    async def main():
        asyncio.get_running_loop().call_soon(boom)
        await asyncio.sleep(0)
        await asyncio.sleep(0)

    asyncio.run(main())
    lines = [line for line in logs.json_lines() if line["logger"] == "asyncio"]
    assert lines and lines[0]["msg"].startswith("Exception in callback")
    assert "SNTLcallback" not in logs.json_stream.getvalue() + logs.console_stream.getvalue()


def test_exception_in_callback_with_arguments_does_not_leak(logs):
    # asyncio pre-formats its message: the first line holds the callback repr, arguments included.
    def boom(value):
        raise ValueError("note=SNTLcbexc")

    async def main():
        asyncio.get_running_loop().call_soon(boom, "SNTLcbarg")
        await asyncio.sleep(0)
        await asyncio.sleep(0)

    asyncio.run(main())
    out = logs.json_stream.getvalue() + logs.console_stream.getvalue()
    assert "Exception in callback" in out
    assert "SNTLcbarg" not in out and "SNTLcbexc" not in out


def test_foreign_template_is_cut_before_repr_like_text():
    msg, console = _formatted(_record("somelib", "Exception in callback f('SNTLrepr') at x.py:1"))
    assert msg == "Exception in callback f"
    assert "SNTLrepr" not in console
