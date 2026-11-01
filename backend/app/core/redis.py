from typing import Optional

import redis.asyncio as redis

from .config import settings

_client: Optional[redis.Redis] = None


def get_redis_client() -> Optional[redis.Redis]:
    """Shared async client, created on first use; None when REDIS_URL is empty."""
    global _client
    if not settings.REDIS_URL:
        return None
    if _client is None:
        _client = redis.from_url(
            settings.REDIS_URL, decode_responses=True, socket_connect_timeout=1, socket_timeout=1
        )
    return _client


async def get_redis() -> Optional[redis.Redis]:
    return get_redis_client()
