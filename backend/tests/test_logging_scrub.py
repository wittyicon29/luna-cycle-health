"""Structured logging: JSON formatter, configure_logging(), scrub() truth table, no print()."""
import copy
import io
import json
import logging
import re
from datetime import datetime
from pathlib import Path

import pytest

from app.core import logging_config
from app.core.config import Settings, settings
from app.core.logging_config import (
    ConsoleFormatter,
    JsonFormatter,
    SCRUBBED,
    configure_logging,
    get_request_id,
    request_id_var,
    scrub,
    scrub_text,
)

APP_DIR = Path(__file__).resolve().parents[1] / "app"
JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk"
HEX = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"


def _record(msg="hello %s", args=("world",), level=logging.INFO, **extra):
    record = logging.LogRecord("app.test", level, __file__, 10, msg, args, None)
    for key, value in extra.items():
        setattr(record, key, value)
    return record


# --- JSON formatter ------------------------------------------------------------------


def test_json_formatter_emits_valid_json_with_expected_keys():
    line = JsonFormatter().format(_record())
    data = json.loads(line)
    assert set(data) == {"ts", "level", "logger", "msg", "request_id"}
    assert data["level"] == "INFO" and data["logger"] == "app.test" and data["msg"] == "hello world"
    assert data["request_id"] is None
    assert data["ts"].endswith("Z")
    datetime.fromisoformat(data["ts"].replace("Z", "+00:00"))
    assert "\n" not in line


def test_json_formatter_includes_only_whitelisted_extras():
    record = _record(method="GET", route="/api/v1/logs/{log_date}", status=200, duration_ms=1.5,
                     exc_type="ValueError", exc_where="app/x.py:1", body="SECRET-BODY", note="SECRET-NOTE")
    data = json.loads(JsonFormatter().format(record))
    assert data["method"] == "GET" and data["route"] == "/api/v1/logs/{log_date}"
    assert data["status"] == 200 and data["duration_ms"] == 1.5
    assert data["exc_type"] == "ValueError" and data["exc_where"] == "app/x.py:1"
    assert "SECRET" not in json.dumps(data)


def test_json_formatter_reads_the_request_id_contextvar():
    token = request_id_var.set("abcdef123456")
    try:
        assert get_request_id() == "abcdef123456"
        assert json.loads(JsonFormatter().format(_record()))["request_id"] == "abcdef123456"
    finally:
        request_id_var.reset(token)
    assert get_request_id() is None


def test_json_formatter_masks_secrets_inside_the_message():
    data = json.loads(JsonFormatter().format(_record("failed for %s with %s and %s", ("a.person@gmail.com", JWT, HEX))))
    assert "a.person@gmail.com" not in data["msg"] and JWT not in data["msg"] and HEX not in data["msg"]


def test_json_formatter_drops_tracebacks_by_default(monkeypatch):
    monkeypatch.setattr(settings, "LOG_TRACEBACKS", False)
    try:
        raise ValueError("note=TRACEBACK-SENTINEL")
    except ValueError:
        import sys
        record = logging.LogRecord("app.test", logging.ERROR, __file__, 1, "boom", (), sys.exc_info())
    line = JsonFormatter().format(record)
    assert "TRACEBACK-SENTINEL" not in line
    data = json.loads(line)
    assert data["exc_type"] == "ValueError" and "traceback" not in data

    monkeypatch.setattr(settings, "LOG_TRACEBACKS", True)
    assert "traceback" in json.loads(JsonFormatter().format(record))


def test_console_formatter_drops_tracebacks_by_default(monkeypatch):
    monkeypatch.setattr(settings, "LOG_TRACEBACKS", False)
    try:
        raise KeyError("note=TRACEBACK-SENTINEL")
    except KeyError:
        import sys
        record = logging.LogRecord("app.test", logging.ERROR, __file__, 1, "boom", (), sys.exc_info())
    line = ConsoleFormatter().format(record)
    assert "TRACEBACK-SENTINEL" not in line and "KeyError" in line


def test_json_formatter_never_raises_on_bad_records():
    record = _record("%s %s", ("only-one",))  # wrong arg count
    data = json.loads(JsonFormatter().format(record))
    assert data["level"] == "INFO"

    class Unprintable:
        def __str__(self):
            raise RuntimeError("nope")

    data = json.loads(JsonFormatter().format(_record("%s", (Unprintable(),), route=Unprintable())))
    assert "route" not in data or isinstance(data["route"], str)


# --- configure_logging ----------------------------------------------------------------


def _our_handlers():
    return [h for h in logging.getLogger().handlers if getattr(h, logging_config.HANDLER_MARK, False)]


def test_configure_logging_is_idempotent_and_keeps_foreign_handlers():
    foreign = logging.StreamHandler(io.StringIO())
    root = logging.getLogger()
    root.addHandler(foreign)
    try:
        configure_logging()
        configure_logging()
        assert len(_our_handlers()) == 1
        assert foreign in root.handlers
    finally:
        root.removeHandler(foreign)
        configure_logging()


def test_configure_logging_routes_server_loggers_and_disables_access_log():
    configure_logging()
    access = logging.getLogger("uvicorn.access")
    assert access.disabled and not access.propagate and not access.handlers
    for name in ("uvicorn", "uvicorn.error", "gunicorn.error"):
        server = logging.getLogger(name)
        assert server.propagate and not server.handlers
    for name in ("httpx", "httpcore", "sqlalchemy"):
        assert logging.getLogger(name).level == logging.WARNING


def test_configure_logging_uses_settings(monkeypatch):
    monkeypatch.setattr(settings, "LOG_LEVEL", "WARNING")
    monkeypatch.setattr(settings, "LOG_FORMAT", "json")
    try:
        configure_logging()
        (handler,) = _our_handlers()
        assert isinstance(handler.formatter, JsonFormatter)
        assert logging.getLogger().level == logging.WARNING
    finally:
        monkeypatch.undo()
        configure_logging()
    (handler,) = _our_handlers()
    assert isinstance(handler.formatter, ConsoleFormatter)  # APP_ENV=testing default


def test_root_handler_writes_to_current_stdout(capsys):
    configure_logging()
    logging.getLogger("app.test").warning("visible-line")
    assert "visible-line" in capsys.readouterr().out


@pytest.mark.parametrize("env,expected", [("development", "console"), ("testing", "console"), ("production", "json"),
                                          ("staging", "json")])
def test_log_format_defaults_by_environment(env, expected):
    extra = {}
    if env not in ("development", "testing"):
        extra = dict(SECRET_KEY="x" * 40, ENCRYPTION_KEYS="", SMTP_SERVER="s", SMTP_USER="u", SMTP_PASSWORD="p",
                     SUPPORT_EMAIL="support@example.com")
        from cryptography.fernet import Fernet
        extra["ENCRYPTION_KEYS"] = Fernet.generate_key().decode()
    config = Settings(_env_file=None, APP_ENV=env, **extra)
    assert config.LOG_FORMAT == expected
    assert config.LOG_LEVEL == "INFO" and config.LOG_TRACEBACKS is False


def test_log_settings_validate():
    assert Settings(_env_file=None, APP_ENV="testing", LOG_FORMAT="json").LOG_FORMAT == "json"
    assert Settings(_env_file=None, APP_ENV="testing", LOG_LEVEL="debug").LOG_LEVEL == "DEBUG"
    with pytest.raises(ValueError):
        Settings(_env_file=None, APP_ENV="testing", LOG_LEVEL="LOUD")
    with pytest.raises(ValueError):
        Settings(_env_file=None, APP_ENV="testing", LOG_FORMAT="xml")


# --- scrub() ----------------------------------------------------------------------------


@pytest.mark.parametrize("key", [
    "token", "access_token", "refresh_token", "purchase_token", "Password", "new_password", "passwd", "SECRET_KEY",
    "Authorization", "authorization", "cookie", "Set-Cookie", "note", "notes", "message", "question", "prompt",
    "answer", "content", "email", "Email", "name", "user_name", "symptoms", "medication", "medications_taken", "mood",
    "purchase", "receipt", "code", "dsn", "api_key", "API-KEY", "apikey",
])
def test_sensitive_keys_are_scrubbed(key):
    assert scrub({key: "VALUE-SENTINEL"}) == {key: SCRUBBED}
    assert scrub({key: {"nested": "VALUE-SENTINEL"}}) == {key: SCRUBBED}


@pytest.mark.parametrize("key", ["status", "method", "route", "duration_ms", "level", "id", 3, None])
def test_harmless_keys_are_kept(key):
    assert scrub({key: 42}) == {key: 42}
    assert scrub({key: "plain words"}) == {key: "plain words"}


def test_nested_structures_are_scrubbed_and_types_kept():
    data = {"outer": [{"email": "a@b.co", "ok": 1}, ("x", {"Token": "t"})], "flow": "light", 7: {"notes": "n"}}
    assert scrub(data) == {"outer": [{"email": SCRUBBED, "ok": 1}, ("x", {"Token": SCRUBBED})], "flow": "light",
                           7: {"notes": SCRUBBED}}
    assert isinstance(scrub(data)["outer"][1], tuple)


@pytest.mark.parametrize("text,secret", [
    (f"Bearer {JWT}", JWT),
    (f"hash={HEX} done", HEX),
    ("contact a.person+tag@example.co.in now", "a.person+tag@example.co.in"),
    ("key=Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZg== end", "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZg=="),
    ("tok=gsk_9aZ3kq8Pq2mVnXr7Lw4Ty1Hs6Bd0Fe5Gc end", "gsk_9aZ3kq8Pq2mVnXr7Lw4Ty1Hs6Bd0Fe5Gc"),
])
def test_secrets_inside_free_text_are_masked(text, secret):
    assert secret not in scrub(text)
    assert secret not in scrub({"detail": text})["detail"]
    assert secret not in scrub_text(text)


def test_ordinary_text_is_left_alone():
    for text in ("Database at revision 0007_daily_logs, upgrading", "GET /api/v1/email-verification/resend",
                 "luna-cycle-health-production-server-name"):
        assert scrub_text(text) == text


@pytest.mark.parametrize("value", [None, 0, 12, 1.5, True, False, ""])
def test_scalars_pass_through(value):
    assert scrub(value) == value
    assert scrub({"k": value}) == {"k": value}


def test_scrub_never_mutates_the_input():
    data = {"user": {"email": "a@b.co", "items": [1, {"password": "p"}]}}
    before = copy.deepcopy(data)
    result = scrub(data)
    assert data == before
    assert result is not data and result["user"] is not data["user"]


def test_cycles_are_cut():
    data = {"a": 1}
    data["self"] = data
    items = [1]
    items.append(items)
    assert scrub(data)["self"] == "[cycle]"
    assert scrub(items)[1] == "[cycle]"


def test_shared_but_acyclic_references_are_kept():
    shared = {"x": 1}
    assert scrub({"a": shared, "b": shared}) == {"a": {"x": 1}, "b": {"x": 1}}


def test_deep_nesting_is_truncated():
    data = current = {}
    for _ in range(50):
        current["d"] = {}
        current = current["d"]
    result = scrub(data, max_depth=4)
    depth, node = 0, result
    while isinstance(node, dict):
        node = node["d"]
        depth += 1
    assert node == "[truncated]" and depth <= 5


def test_odd_objects_never_raise():
    class Boom:
        def __str__(self):
            raise RuntimeError("no")

        __repr__ = __str__

    class Weird:
        def __str__(self):
            return "weird a@b.co"

    assert scrub(Boom()) == "[unserializable]"
    assert "a@b.co" not in scrub(Weird())
    assert scrub(b"raw bytes a@b.co") == "[bytes]"
    assert sorted(scrub({1, 2})) == [1, 2]
    assert scrub({Boom(): 1}) is not None
    assert scrub({"k": float("nan")})["k"] != 0


# --- no print() in app/ -----------------------------------------------------------------------


def test_no_print_calls_in_app():
    offenders = []
    for path in APP_DIR.rglob("*.py"):
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if re.search(r"(?<![\w.])print\(", line):
                offenders.append(f"{path.relative_to(APP_DIR)}:{number}")
    assert not offenders, offenders


def test_no_fstring_or_exception_text_in_log_calls():
    offenders = []
    pattern = re.compile(r"logger\.\w+\(\s*f[\"']|logger\.\w+\(.*\{e\}|logger\.\w+\(.*,\s*e\)|logger\.\w+\(.*str\(e")
    for path in APP_DIR.rglob("*.py"):
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if pattern.search(line):
                offenders.append(f"{path.relative_to(APP_DIR)}:{number}")
    assert not offenders, offenders
