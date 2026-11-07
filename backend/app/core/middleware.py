"""Pure ASGI middleware (no BaseHTTPMiddleware: it buffers streaming bodies and breaks contextvars).

Sections:
- request context: request id, structured access log and the generic 500 handler
- security headers: nosniff/frame/referrer/permissions on every response, no-store on /api/v1/*
- trusted hosts: Host header must be in ALLOWED_HOSTS (loopback always allowed)
- body size limit: MAX_REQUEST_BYTES by Content-Length and by counting streamed bytes

Order (outermost first; see main.install_http_middleware):
  RequestContext -> SecurityHeaders -> TrustedHost -> BodySizeLimit -> CORS -> app
so the 400 (bad host) and 413 (too large) answers carry both the request id and the security
headers, CORS preflights get the security headers, and the generic 500 that RequestContext
writes itself is passed through with_security_headers() explicitly. Responses made outside
CORSMiddleware (400, 413, 500) get CORS headers from RequestContext via cors_headers_for(), so
a browser/WebView client sees the real status instead of an opaque network error.
"""
import logging
import re
import time
import traceback
import uuid
from pathlib import Path
from typing import Optional

from starlette.datastructures import Headers
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .client_ip import _is_trusted, _networks, _parse_ip
from . import error_reporting
from .config import normalize_host, settings
from .logging_config import request_id_var

access_logger = logging.getLogger("app.access")
error_logger = logging.getLogger("app.errors")

# ==== request context ==========================================================================

REQUEST_ID_HEADER = b"x-request-id"
_REQUEST_ID = re.compile(r"[A-Za-z0-9-]{8,64}")
_METHODS = frozenset({"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE", "CONNECT"})
UNMATCHED_ROUTE = "/unmatched"
_APP_DIR = Path(__file__).resolve().parents[1]  # backend/app


def _peer_is_trusted(scope: Scope) -> bool:
    networks = _networks(settings.TRUSTED_PROXY_IPS)
    client = scope.get("client")
    if not networks or not client or not client[0]:
        return False
    peer = _parse_ip(str(client[0]))
    return peer is not None and _is_trusted(peer, networks)


def _incoming_request_id(scope: Scope) -> Optional[str]:
    values = [value for key, value in scope.get("headers") or () if key.lower() == REQUEST_ID_HEADER]
    if len(values) != 1 or not _peer_is_trusted(scope):
        return None
    try:
        value = values[0].decode("ascii")
    except (UnicodeDecodeError, AttributeError):
        return None
    return value if _REQUEST_ID.fullmatch(value) else None


def _route_template(scope: Scope) -> str:
    route = scope.get("route")
    path = getattr(route, "path", None)
    return path if isinstance(path, str) and path else UNMATCHED_ROUTE


def _method(scope: Scope) -> str:
    method = scope.get("method")
    return method if method in _METHODS else "OTHER"


def _exception_where(exc: BaseException) -> str:
    """Innermost traceback frame inside the app package, as app/<file>.py:<line>."""
    where = "unknown"
    for frame in traceback.extract_tb(exc.__traceback__):
        try:
            relative = Path(frame.filename).resolve().relative_to(_APP_DIR.parent)
        except (ValueError, OSError):
            continue
        if relative.parts and relative.parts[0] == "app":
            where = f"{relative.as_posix()}:{frame.lineno}"
    return where


def _request_id_of(request: Request) -> str:
    rid = request.scope.get("state", {}).get("request_id") or request_id_var.get()
    return rid or uuid.uuid4().hex


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Generic JSON 500: the client gets no internals; the log gets the class name and file:line."""
    rid = _request_id_of(request)
    token = request_id_var.set(rid)
    try:
        error_logger.error(
            "Unhandled exception",
            exc_info=exc if settings.LOG_TRACEBACKS else None,
            extra={"exc_type": type(exc).__name__, "exc_where": _exception_where(exc)},
        )
        # Only unhandled exceptions get here (4xx HTTPExceptions are answered by FastAPI); a no-op
        # unless SENTRY_DSN is set. Tagged with the request id only.
        error_reporting.capture_exception(exc, request_id=rid)
    finally:
        request_id_var.reset(token)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "request_id": rid},
        headers={"X-Request-ID": rid},
    )


class RequestContextMiddleware:
    """Assigns a request id, echoes it in X-Request-ID and writes one access record per request.

    The id from X-Request-ID is honoured only from a trusted proxy (TRUSTED_PROXY_IPS) and only
    when it matches [A-Za-z0-9-]{8,64}; otherwise a uuid4 hex is generated. Unhandled exceptions
    are answered here (generic 500) so the record, the header and the error log share the id.
    Must be the outermost middleware.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        rid = _incoming_request_id(scope) or uuid.uuid4().hex
        scope.setdefault("state", {})["request_id"] = rid
        token = request_id_var.set(rid)
        started = time.perf_counter()
        status = {"code": 500, "sent": False}
        header_value = rid.encode("ascii")

        async def send_with_request_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                status["code"], status["sent"] = message["status"], True
                headers = [(k, v) for k, v in message.get("headers", []) if k.lower() != REQUEST_ID_HEADER]
                headers.append((REQUEST_ID_HEADER, header_value))
                _add_missing_cors_headers(scope, headers)
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        except Exception as exc:
            if status["sent"]:
                raise  # too late for a 500; the server closes the connection
            response = await unhandled_exception_handler(Request(scope), exc)
            # This response bypasses the inner SecurityHeadersMiddleware, so add them here.
            await response(scope, receive, with_security_headers(scope, send_with_request_id))
        finally:
            duration_ms = round((time.perf_counter() - started) * 1000, 2)
            code = status["code"]
            access_logger.log(
                logging.ERROR if code >= 500 else logging.INFO,
                "request",
                extra={"method": _method(scope), "route": _route_template(scope), "status": code,
                       "duration_ms": duration_ms},
            )
            request_id_var.reset(token)


# ==== CORS on responses made outside CORSMiddleware ==============================================


def cors_options() -> dict:
    """CORSMiddleware options from settings (shared by main and cors_headers_for)."""
    return dict(allow_origins=settings.ALLOWED_ORIGINS.split(","), allow_credentials=True,
                allow_methods=["*"], allow_headers=["*"])


_cors_cache: dict = {}


def _cors() -> CORSMiddleware:
    key = settings.ALLOWED_ORIGINS
    cors = _cors_cache.get(key)
    if cors is None:
        _cors_cache.clear()
        cors = _cors_cache[key] = CORSMiddleware(app=None, **cors_options())
    return cors


def cors_headers_for(request_headers) -> dict:
    """The headers CORSMiddleware adds to a simple (non-preflight) response for these request
    headers (ASGI header list), or {} when there is no Origin or it is not allowed.

    Uses Starlette's own CORSMiddleware config and origin check (exact match; '*' -> '*' unless a
    cookie is sent, then the origin is echoed; Vary: Origin when echoed). Unlike CORSMiddleware nothing at all,
    not even Allow-Credentials, is added for a disallowed origin.
    """
    headers = Headers(raw=list(request_headers or ()))
    origin = headers.get("origin")
    if origin is None:
        return {}
    cors = _cors()
    if not (cors.allow_all_origins or cors.is_allowed_origin(origin=origin)):
        return {}
    # Same steps as CORSMiddleware.send(), from its own precomputed simple headers.
    result = {k.lower(): v for k, v in cors.simple_headers.items()}
    if not cors.allow_all_origins or "cookie" in headers:
        result["access-control-allow-origin"] = origin
        result["vary"] = "Origin"
    return result


def _add_missing_cors_headers(scope: Scope, headers: list) -> None:
    """Add CORS headers in place unless the response already has them (CORSMiddleware ran)."""
    if any(k.lower() == b"access-control-allow-origin" for k, _ in headers):
        return
    try:
        extra = cors_headers_for(scope.get("headers"))
    except Exception:
        return
    present = {k.lower() for k, _ in headers}
    for name, value in extra.items():
        key = name.encode("latin-1")
        if key == b"vary" and key in present:
            index = next(i for i, (k, _) in enumerate(headers) if k.lower() == b"vary")
            existing = headers[index][1].decode("latin-1")
            if "origin" not in existing.lower():
                headers[index] = (headers[index][0], f"{existing}, Origin".encode("latin-1"))
        elif key not in present:
            headers.append((key, value.encode("latin-1")))


# ==== security headers =========================================================================

SECURITY_HEADERS = (
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"no-referrer"),
    (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
)
_CACHE_CONTROL = b"cache-control"
_NO_STORE_PREFIX = "/api/v1/"


def with_security_headers(scope: Scope, send: Send) -> Send:
    """Wrap `send` so the response start gets the security headers (existing values are kept).

    /api/v1/* responses also get Cache-Control: no-store unless the route set its own. HSTS is
    added by the proxy (it is the TLS terminator).
    """
    path = scope.get("path") or ""
    no_store = path.startswith(_NO_STORE_PREFIX) or path == _NO_STORE_PREFIX.rstrip("/")

    async def send_with_headers(message: Message) -> None:
        if message["type"] == "http.response.start":
            headers = list(message.get("headers", []))
            present = {key.lower() for key, _ in headers}
            headers.extend((key, value) for key, value in SECURITY_HEADERS if key not in present)
            if no_store and _CACHE_CONTROL not in present:
                headers.append((_CACHE_CONTROL, b"no-store"))
            message = {**message, "headers": headers}
        await send(message)

    return send_with_headers


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        await self.app(scope, receive, with_security_headers(scope, send))


# ==== trusted hosts ============================================================================


def _host_is_allowed(scope: Scope) -> bool:
    allowed = settings.allowed_hosts
    if allowed is None:  # "*" or empty in development/testing (production refuses empty)
        return True
    values = [value for key, value in scope.get("headers") or () if key.lower() == b"host"]
    if len(values) != 1:
        return False
    try:
        host = normalize_host(values[0].decode("ascii"))
    except UnicodeDecodeError:
        return False
    return host is not None and host in allowed


class TrustedHostMiddleware:
    """Rejects requests whose Host header is not in ALLOWED_HOSTS with 400 (ports ignored).

    Our own class (not Starlette's) so the rejection is a JSON body and passes through the outer
    request-id and security-header middleware like every other response. Caddy forwards the
    original Host (the public domain); the healthcheck uses 127.0.0.1, which is always allowed.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and not _host_is_allowed(scope):
            response = JSONResponse(status_code=400, content={"detail": "Invalid host header"})
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


# ==== body size limit ==========================================================================

TOO_LARGE = {"detail": "Request too large"}


class _BodyTooLarge(Exception):
    """Raised from receive() once the streamed body passes MAX_REQUEST_BYTES."""


def _declared_length(scope: Scope) -> Optional[int]:
    for key, value in scope.get("headers") or ():
        if key.lower() == b"content-length":
            try:
                return int(value)
            except ValueError:
                return None  # malformed: rely on counting
    return None


class BodySizeLimitMiddleware:
    """413 {"detail": "Request too large"} for bodies above MAX_REQUEST_BYTES.

    Checks Content-Length up front (the app never runs) and counts the bytes actually received,
    so chunked uploads and a lying Content-Length are caught too. When the cap is passed
    mid-stream, receive() raises; whatever the app makes of that (a 400 "error parsing the
    body", an exception) is discarded and the 413 is sent instead, as long as the app has not
    started its response. The response itself is streamed through untouched.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        limit = settings.MAX_REQUEST_BYTES
        declared = _declared_length(scope)
        if declared is not None and declared > limit:
            await JSONResponse(status_code=413, content=TOO_LARGE)(scope, receive, send)
            return

        state = {"received": 0, "exceeded": False, "started": False}

        async def limited_receive() -> Message:
            message = await receive()
            if message["type"] == "http.request":
                state["received"] += len(message.get("body", b""))
                if state["received"] > limit:
                    state["exceeded"] = True
                    raise _BodyTooLarge()
            return message

        async def guarded_send(message: Message) -> None:
            if state["exceeded"] and not state["started"]:
                return  # drop the app's answer to the aborted read; the 413 goes out below
            if message["type"] == "http.response.start":
                state["started"] = True
            await send(message)

        try:
            await self.app(scope, limited_receive, guarded_send)
        except Exception:
            if not state["exceeded"] or state["started"]:
                raise
        if state["exceeded"] and not state["started"]:
            await JSONResponse(status_code=413, content=TOO_LARGE)(scope, receive, send)
