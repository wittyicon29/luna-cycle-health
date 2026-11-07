"""Optional, privacy-safe error reporting to a Sentry-compatible service. Off by default.

``SENTRY_DSN`` empty -> nothing is initialised and ``sentry_sdk`` is never imported (it is
imported lazily inside the functions below, never at module level).

When on, the event is rebuilt from a WHITELIST, so new SDK fields stay out by default:
- every integration is disabled (``default_integrations=False``, ``auto_enabling_integrations=False``,
  ``integrations=[]``): no Starlette/FastAPI request extraction (headers, cookies, query, body,
  user), no logging breadcrumbs/events from log records, no argv/modules/excepthook/atexit/
  threading hooks, no httpx/SQLAlchemy spans or breadcrumbs. Our RequestContextMiddleware answers
  unhandled exceptions itself, so the generic 500 handler captures them explicitly via
  ``capture_exception`` (4xx ``HTTPException``s never reach it);
- ``send_default_pii=False`` plus an all-off ``data_collection`` (its 2.x replacement),
  ``max_request_body_size="never"``, ``include_local_variables=False``,
  ``include_source_context=False`` as a second line of defence;
- ``scrub_event`` keeps only identification/timing keys, the exception class names (the exception
  value, which may embed user data, is replaced by the class name), stack frames reduced to
  file/module/function/line, the request id tag, a few runtime/trace context fields and scrubbed
  breadcrumbs. ``request``, ``user``, ``server_name``, ``extra``, ``modules``, ``threads`` and
  ``transaction`` are dropped. Any error inside a scrubber drops the event (fail closed).
- ``SENTRY_TRACES_SAMPLE_RATE`` is passed through; with no integrations only manually started
  transactions exist, and ``scrub_transaction`` keeps only their timing skeleton.
"""
import logging
import re
import warnings
from typing import Any, Optional

from .config import APP_VERSION, settings
from .logging_config import scrub, scrub_text

logger = logging.getLogger("app.error_reporting")

_enabled = False

_REQUEST_ID = re.compile(r"[A-Za-z0-9-]{8,64}")
_IDENT = re.compile(r"[A-Za-z0-9_.:-]{1,200}")

_EVENT_KEYS = ("event_id", "timestamp", "start_timestamp", "level", "platform", "logger", "environment",
               "release", "dist", "sdk", "type", "fingerprint")
_CONTEXT_KEYS = {"runtime": ("name", "version"),
                 "trace": ("trace_id", "span_id", "parent_span_id", "op", "status")}
_FRAME_KEYS = ("filename", "module", "function", "lineno", "in_app")
_MECHANISM_KEYS = ("type", "handled")
_SPAN_KEYS = ("span_id", "trace_id", "parent_span_id", "op", "start_timestamp", "timestamp", "status",
              "same_process_as_parent")
_CRUMB_KEYS = ("type", "category", "level", "timestamp")
# SDK 2.x "data_collection" (supersedes send_default_pii, which alone still maps to collecting
# request bodies and non-sensitive headers): every category off. send_default_pii=False is passed
# as well; when both are set data_collection wins.
DATA_COLLECTION_OFF = {
    "user_info": False,
    "cookies": {"mode": "off"},
    "http_headers": {"request": {"mode": "off"}},
    "http_bodies": [],
    "url_query_params": {"mode": "off"},
    "graphql": {"document": False, "variables": False},
    "gen_ai": {"inputs": False, "outputs": False},
    "database_query_data": False,
    "queues": False,
    "stack_frame_variables": False,
    "frame_context_lines": 0,
}
DROPPED_BREADCRUMB_CATEGORIES = frozenset({"httplib", "httpx", "console", "query", "subprocess"})


def is_enabled() -> bool:
    return _enabled


def _scalar(value: Any) -> Any:
    return value if value is None or isinstance(value, (bool, int, float)) else None


def _ident(value: Any) -> Optional[str]:
    """Code identifiers (class/module/function/file names, levels): kept only if they look like one."""
    return value if isinstance(value, str) and _IDENT.fullmatch(value) else None


def _pick(source: dict, keys, convert) -> dict:
    result = {}
    for key in keys:
        if key in source:
            value = convert(source[key])
            if value is not None:
                result[key] = value
    return result


def _safe_value(value: Any) -> Any:
    if isinstance(value, str):
        return scrub_text(value)[:200]
    if isinstance(value, (bool, int, float)) or value is None:
        return value
    return scrub(value)


def _scrub_frame(frame: dict) -> dict:
    out = {}
    for key in ("filename", "module", "function"):
        value = frame.get(key)
        if isinstance(value, str) and _IDENT.fullmatch(value.replace("/", ".").replace("<", "").replace(">", "")):
            out[key] = value
    if isinstance(frame.get("lineno"), int):
        out["lineno"] = frame["lineno"]
    if isinstance(frame.get("in_app"), bool):
        out["in_app"] = frame["in_app"]
    return out


def _scrub_exception(exception: dict) -> dict:
    values = []
    for item in exception["values"]:
        exc_type = _ident(item.get("type")) or "Exception"
        clean = {"type": exc_type, "value": exc_type}
        module = _ident(item.get("module"))
        if module:
            clean["module"] = module
        mechanism = item.get("mechanism")
        if isinstance(mechanism, dict):
            clean["mechanism"] = _pick(mechanism, _MECHANISM_KEYS, lambda v: _ident(v) if isinstance(v, str) else (
                v if isinstance(v, bool) else None))
        stacktrace = item.get("stacktrace")
        if isinstance(stacktrace, dict) and isinstance(stacktrace.get("frames"), list):
            clean["stacktrace"] = {"frames": [_scrub_frame(f) for f in stacktrace["frames"] if isinstance(f, dict)]}
        values.append(clean)
    return {"values": values}


def _scrub_contexts(contexts: dict) -> dict:
    result = {}
    for name, keys in _CONTEXT_KEYS.items():
        context = contexts.get(name)
        if isinstance(context, dict):
            picked = _pick(context, keys, lambda v: v if isinstance(v, str) and len(v) <= 100 else None)
            picked = {k: scrub_text(v) for k, v in picked.items()}
            if picked:
                result[name] = picked
    return result


def _scrub_breadcrumbs(breadcrumbs: Any) -> list:
    values = breadcrumbs.get("values") if isinstance(breadcrumbs, dict) else breadcrumbs
    if not isinstance(values, list):
        return []
    return [crumb for crumb in (scrub_breadcrumb(c, {}) for c in values) if crumb is not None]


def _common(event: dict) -> dict:
    clean = _pick(event, _EVENT_KEYS, lambda v: v)
    clean = {k: v for k, v in clean.items() if k in ("sdk", "fingerprint") or _scalar(v) is not None
             or isinstance(v, str)}
    for key in ("environment", "release", "dist", "logger", "level", "platform", "type"):
        if key in clean and not (isinstance(clean[key], str) and _IDENT.fullmatch(clean[key].replace("@", "."))):
            del clean[key]
    if "sdk" in clean:
        sdk = clean["sdk"] if isinstance(clean["sdk"], dict) else {}
        clean["sdk"] = _pick(sdk, ("name", "version"), lambda v: v if isinstance(v, str) else None)
    if "fingerprint" in clean:
        fingerprint = clean["fingerprint"]
        clean["fingerprint"] = [scrub_text(str(f)) for f in fingerprint] if isinstance(fingerprint, list) else None
        if clean["fingerprint"] is None:
            del clean["fingerprint"]
    contexts = event.get("contexts")
    if isinstance(contexts, dict):
        picked = _scrub_contexts(contexts)
        if picked:
            clean["contexts"] = picked
    tags = event.get("tags")
    if tags is not None:
        if not isinstance(tags, dict):
            raise TypeError("tags")
        rid = tags.get("request_id")
        if isinstance(rid, str) and _REQUEST_ID.fullmatch(rid):
            clean["tags"] = {"request_id": rid}
    return clean


def scrub_event(event: Any, hint: Any) -> Optional[dict]:
    """``before_send``: rebuild the event from a whitelist. Returns None (drop) on any problem."""
    try:
        if not isinstance(event, dict):
            return None
        clean = _common(event)
        exception = event.get("exception")
        if exception is not None:
            if not isinstance(exception, dict) or not isinstance(exception.get("values"), list):
                return None
            clean["exception"] = _scrub_exception(exception)
        logentry = event.get("logentry")
        if isinstance(logentry, dict) and isinstance(logentry.get("message"), str):
            # The developer-chosen template only; params/formatted text can carry user data.
            clean["logentry"] = {"message": scrub_text(logentry["message"])[:200]}
        crumbs = _scrub_breadcrumbs(event.get("breadcrumbs"))
        if crumbs:
            clean["breadcrumbs"] = {"values": crumbs}
        return clean
    except Exception:
        return None


def scrub_transaction(event: Any, hint: Any) -> Optional[dict]:
    """``before_send_transaction``: timing skeleton only (no names, descriptions, data, request)."""
    try:
        if not isinstance(event, dict):
            return None
        clean = _common(event)
        clean["type"] = "transaction"
        spans = event.get("spans")
        if isinstance(spans, list):
            clean["spans"] = [_pick(span, _SPAN_KEYS, _span_value) for span in spans if isinstance(span, dict)]
        return clean
    except Exception:
        return None


def _span_value(value: Any) -> Any:
    if isinstance(value, (bool, int, float)):
        return value
    return value if isinstance(value, str) and _IDENT.fullmatch(value) else None


def scrub_breadcrumb(crumb: Any, hint: Any) -> Optional[dict]:
    """``before_breadcrumb``: drop HTTP/console/SQL/subprocess crumbs, scrub the rest."""
    try:
        if not isinstance(crumb, dict):
            return None
        if crumb.get("category") in DROPPED_BREADCRUMB_CATEGORIES or crumb.get("type") in ("http", "query"):
            return None
        clean = _pick(crumb, _CRUMB_KEYS, lambda v: v if isinstance(v, (str, int, float)) else None)
        for key in ("type", "category", "level"):
            if key in clean and _ident(clean[key]) is None:
                del clean[key]
        if isinstance(crumb.get("message"), str):
            clean["message"] = scrub_text(crumb["message"])[:200]
        if isinstance(crumb.get("data"), dict):
            clean["data"] = scrub(crumb["data"])
        return clean
    except Exception:
        return None


def init_error_reporting(*, transport: Any = None) -> bool:
    """Initialise reporting from settings. False (and no import) when SENTRY_DSN is empty.

    Idempotent; never raises: a malformed DSN logs one warning with the error class and leaves
    reporting off. ``transport`` is for tests (a ``sentry_sdk.transport.Transport``).
    """
    global _enabled
    if _enabled:
        return True
    dsn = settings.SENTRY_DSN.strip()
    if not dsn:
        return False
    try:
        import sentry_sdk

        options = dict(
            dsn=dsn,
            environment=settings.sentry_environment,
            release=f"luna-api@{APP_VERSION}",
            server_name="",
            send_default_pii=False,
            data_collection={k: (dict(v) if isinstance(v, dict) else v) for k, v in DATA_COLLECTION_OFF.items()},
            max_request_body_size="never",
            include_local_variables=False,
            include_source_context=False,
            attach_stacktrace=False,
            traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
            default_integrations=False,
            auto_enabling_integrations=False,
            integrations=[],
            before_send=scrub_event,
            before_send_transaction=scrub_transaction,
            before_breadcrumb=scrub_breadcrumb,
            send_client_reports=False,
            auto_session_tracking=False,
        )
        if transport is not None:
            options["transport"] = transport
        with warnings.catch_warnings():
            # send_default_pii is deprecated in favour of data_collection; we set both on purpose.
            warnings.simplefilter("ignore", DeprecationWarning)
            sentry_sdk.init(**options)
        _enabled = sentry_sdk.get_client().is_active()
    except Exception as exc:
        _reset_client()
        _enabled = False
        logger.warning("Error reporting disabled: initialisation failed (%s)", type(exc).__name__)
    return _enabled


def _reset_client() -> None:
    try:
        import sys

        sentry_sdk = sys.modules.get("sentry_sdk")
        if sentry_sdk is not None:
            sentry_sdk.get_global_scope().set_client(None)
    except Exception:
        pass


def shutdown_error_reporting() -> None:
    """Flush and detach the client (tests and orderly shutdown). Safe when reporting is off."""
    global _enabled
    import sys

    sentry_sdk = sys.modules.get("sentry_sdk")
    _enabled = False
    if sentry_sdk is None:
        return
    try:
        sentry_sdk.get_client().close(timeout=2)
    except Exception:
        pass
    for get_scope in ("get_isolation_scope", "get_current_scope", "get_global_scope"):
        try:
            getattr(sentry_sdk, get_scope)().clear()
        except Exception:
            pass
    _reset_client()


def capture_exception(exc: BaseException, *, request_id: Optional[str] = None) -> None:
    """Report an unhandled exception tagged with the request id only. No-op when off; never raises."""
    if not _enabled:
        return
    try:
        import sentry_sdk

        with sentry_sdk.new_scope() as scope:
            if isinstance(request_id, str) and _REQUEST_ID.fullmatch(request_id):
                scope.set_tag("request_id", request_id)
            sentry_sdk.capture_exception(exc)
    except Exception:
        pass
