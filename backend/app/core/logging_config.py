"""Structured, privacy-safe logging.

Allow-list logging: a record carries only the fields chosen here (timestamp, level, logger,
message, request id and a few whitelisted extras). Callers must never put request/response
content, emails, tokens or health data into a message; ``scrub_text`` masks the obvious
secret shapes in JSON output as a second line of defence, and ``scrub`` is shared with the
error reporter.
"""
import json
import logging
import re
import sys
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any, Optional

from .config import settings

request_id_var: ContextVar[Optional[str]] = ContextVar("request_id", default=None)


def get_request_id() -> Optional[str]:
    return request_id_var.get()


# --- scrubbing ----------------------------------------------------------------------------

SCRUBBED = "[scrubbed]"
SENSITIVE_KEY = re.compile(
    r"(?i)token|password|passwd|secret|authorization|cookie|set-cookie|note|notes|message|question|prompt|answer"
    r"|content|email|name|symptom|medication|mood|purchase|receipt|code|dsn|api[_-]?key"
)
_JWT = re.compile(r"eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]*)?")
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
# Long runs of base64/urlsafe/hex characters that mix letters and digits look like keys or tokens.
_LONG_SECRET = re.compile(r"[A-Za-z0-9+_=-]{32,}")


def _mask_long(match: "re.Match[str]") -> str:
    run = match.group(0)
    if any(c.isdigit() for c in run) and any(c.isalpha() for c in run):
        return SCRUBBED
    return run


def scrub_text(text: str) -> str:
    """Mask JWTs, emails and long token-like strings inside free text. Never raises."""
    try:
        text = _JWT.sub(SCRUBBED, text)
        text = _EMAIL.sub(SCRUBBED, text)
        return _LONG_SECRET.sub(_mask_long, text)
    except Exception:
        return SCRUBBED


def _key_is_sensitive(key: Any) -> bool:
    try:
        return bool(SENSITIVE_KEY.search(key if isinstance(key, str) else str(key)))
    except Exception:
        return True


def _scrub(obj: Any, depth: int, max_depth: int, path: set) -> Any:
    if obj is None or isinstance(obj, (bool, int, float)):
        return obj
    if isinstance(obj, str):
        return scrub_text(obj)
    if isinstance(obj, (bytes, bytearray, memoryview)):
        return "[bytes]"
    if isinstance(obj, (dict, list, tuple, set, frozenset)):
        if id(obj) in path:
            return "[cycle]"
        if depth >= max_depth:
            return "[truncated]"
        path.add(id(obj))
        try:
            if isinstance(obj, dict):
                result = {}
                for key, value in list(obj.items()):
                    safe_key = key if isinstance(key, (str, int, float, bool)) or key is None else _scrub(
                        key, depth + 1, max_depth, path)
                    try:
                        hash(safe_key)
                    except TypeError:
                        safe_key = repr(safe_key)
                    if _key_is_sensitive(key):
                        result[safe_key] = SCRUBBED
                    else:
                        result[safe_key] = _scrub(value, depth + 1, max_depth, path)
                return result
            items = [_scrub(item, depth + 1, max_depth, path) for item in list(obj)]
            return tuple(items) if isinstance(obj, tuple) else items
        finally:
            path.discard(id(obj))
    try:
        return scrub_text(str(obj))
    except Exception:
        return "[unserializable]"


def scrub(obj: Any, *, max_depth: int = 8) -> Any:
    """Deep copy of ``obj`` with sensitive keys and secret-looking strings masked. Never raises.

    Containers are copied (sets become lists), values under keys matching SENSITIVE_KEY become
    "[scrubbed]", cycles become "[cycle]", anything deeper than ``max_depth`` "[truncated]",
    and unknown objects are reduced to their scrubbed ``str()``.
    """
    try:
        return _scrub(obj, 0, max_depth, set())
    except Exception:
        return SCRUBBED


# --- formatters ---------------------------------------------------------------------------

EXTRA_FIELDS = ("method", "route", "status", "duration_ms", "exc_type", "exc_where")
_MAX_FIELD_LEN = 200


def _safe_message(record: logging.LogRecord) -> str:
    try:
        return record.getMessage()
    except Exception:
        try:
            return str(record.msg)
        except Exception:
            return "[unformattable log message]"


def _safe_extra(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float)):
        return value
    try:
        return scrub_text(str(value))[:_MAX_FIELD_LEN]
    except Exception:
        return None


def _record_fields(record: logging.LogRecord) -> dict:
    fields = {}
    for name in EXTRA_FIELDS:
        if name in record.__dict__:
            value = _safe_extra(record.__dict__[name])
            if value is not None:
                fields[name] = value
    if record.exc_info and record.exc_info[0] is not None and "exc_type" not in fields:
        fields["exc_type"] = record.exc_info[0].__name__
    return fields


def _request_id(record: logging.LogRecord) -> Optional[str]:
    rid = record.__dict__.get("request_id")
    return rid if isinstance(rid, str) else get_request_id()


class JsonFormatter(logging.Formatter):
    """One JSON object per line with allow-listed keys only."""

    def format(self, record: logging.LogRecord) -> str:
        try:
            ts = datetime.fromtimestamp(record.created, tz=timezone.utc)
            data = {
                "ts": ts.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                "level": record.levelname,
                "logger": record.name,
                "msg": scrub_text(_safe_message(record)),
                "request_id": _request_id(record),
            }
            data.update(_record_fields(record))
            if settings.LOG_TRACEBACKS and record.exc_info:
                data["traceback"] = self.formatException(record.exc_info)
            return json.dumps(data, ensure_ascii=False, default=str)
        except Exception:
            return json.dumps({"level": "ERROR", "logger": "app.logging", "msg": "unformattable log record"})


class ConsoleFormatter(logging.Formatter):
    """Human-readable single line for development; same field allow-list as JSON."""

    def format(self, record: logging.LogRecord) -> str:
        try:
            ts = datetime.fromtimestamp(record.created, tz=timezone.utc).strftime("%H:%M:%S")
            rid = _request_id(record) or "-"
            extras = " ".join(f"{k}={v}" for k, v in _record_fields(record).items())
            line = f"{ts} {record.levelname:<7} {record.name} [{rid}] {_safe_message(record)}"
            if extras:
                line += f" {extras}"
            if settings.LOG_TRACEBACKS and record.exc_info:
                line += "\n" + self.formatException(record.exc_info)
            return line
        except Exception:
            return "unformattable log record"


# --- configuration --------------------------------------------------------------------------

HANDLER_MARK = "_luna_handler"
SERVER_LOGGERS = ("uvicorn", "uvicorn.error", "gunicorn.error")
ACCESS_LOGGERS = ("uvicorn.access", "gunicorn.access")
# Chatty libraries that can log URLs, SQL parameters or bodies at INFO/DEBUG: pinned to WARNING
# whatever LOG_LEVEL says.
QUIET_LOGGERS = ("httpx", "httpcore", "sqlalchemy", "urllib3", "multipart", "python_multipart", "hpack", "asyncio")


class _StdoutHandler(logging.StreamHandler):
    """Writes to whatever sys.stdout is at emit time (survives stream swaps in tests)."""

    def __init__(self):
        super().__init__(sys.stdout)

    @property
    def stream(self):
        return sys.stdout

    @stream.setter
    def stream(self, value):
        pass


def configure_logging() -> None:
    """Install one stdout handler on the root logger from settings. Safe to call repeatedly."""
    root = logging.getLogger()
    for handler in list(root.handlers):
        if getattr(handler, HANDLER_MARK, False):
            root.removeHandler(handler)
    handler = _StdoutHandler()
    setattr(handler, HANDLER_MARK, True)
    handler.setFormatter(JsonFormatter() if settings.LOG_FORMAT == "json" else ConsoleFormatter())
    root.addHandler(handler)
    root.setLevel(settings.LOG_LEVEL)

    for name in SERVER_LOGGERS:
        server = logging.getLogger(name)
        server.handlers.clear()
        server.propagate = True
    for name in ACCESS_LOGGERS:
        access = logging.getLogger(name)
        access.handlers.clear()
        access.propagate = False
        access.disabled = True  # RequestContextMiddleware writes the access log
    for name in QUIET_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)
