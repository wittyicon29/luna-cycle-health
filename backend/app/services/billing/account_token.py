import hashlib
import hmac
import uuid

from ...core.config import settings


def account_token(user_id: uuid.UUID | str) -> str:
    """Opaque per-user id sent to Play as the obfuscated account id (hex HMAC-SHA256)."""
    return hmac.new(settings.SECRET_KEY.encode(), f"billing:{user_id}".encode(), hashlib.sha256).hexdigest()


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
