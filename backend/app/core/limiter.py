from slowapi import Limiter
from slowapi.util import get_remote_address

from .config import settings

# In-memory storage is fine for a single process. Behind several workers or
# instances, pass storage_uri=settings.REDIS_URL so the counters are shared.
limiter = Limiter(key_func=get_remote_address, enabled=settings.RATE_LIMIT_ENABLED)
