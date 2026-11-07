"""Pure ASGI middleware (no BaseHTTPMiddleware: it buffers streaming bodies and breaks contextvars).

Sections:
- request context: request id, structured access log and the generic 500 handler
"""
import logging
import re
import time
import traceback
import uuid
from pathlib import Path
from typing import Optional

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .client_ip import _is_trusted, _networks, _parse_ip
from .config import settings
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
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        except Exception as exc:
            if status["sent"]:
                raise  # too late for a 500; the server closes the connection
            response = await unhandled_exception_handler(Request(scope), exc)
            await response(scope, receive, send_with_request_id)
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
