from typing import Any, Dict, Optional

from slowapi import Limiter

from .client_ip import get_client_ip
from .config import settings

# Keep a Redis outage from adding seconds to every limited request.
REDIS_TIMEOUT_SECONDS = 1


def build_limiter(
    storage_uri: Optional[str],
    *,
    enabled: bool = True,
    extra_options: Optional[Dict[str, Any]] = None,
) -> Limiter:
    """Limiter keyed on the trusted-proxy client IP.

    storage_uri=None keeps counters in process memory. With a Redis URI the counters are
    shared across workers/instances; if Redis is unreachable slowapi logs a warning and
    falls back to per-process in-memory limits (in_memory_fallback_enabled), and any
    other storage error is logged and swallowed, so the limiter fails open instead of
    turning requests into 500s.
    """
    options: Dict[str, Any] = {}
    if storage_uri:
        options = {
            "socket_connect_timeout": REDIS_TIMEOUT_SECONDS,
            "socket_timeout": REDIS_TIMEOUT_SECONDS,
        }
    options.update(extra_options or {})
    return Limiter(
        key_func=get_client_ip,
        storage_uri=storage_uri or "memory://",
        storage_options=options,
        in_memory_fallback_enabled=True,
        swallow_errors=True,
        headers_enabled=False,
        enabled=enabled,
    )


def limiter_from_settings() -> Limiter:
    uri = settings.REDIS_URL if settings.RATE_LIMIT_STORAGE == "redis" else None
    return build_limiter(uri, enabled=settings.RATE_LIMIT_ENABLED)


limiter = limiter_from_settings()
