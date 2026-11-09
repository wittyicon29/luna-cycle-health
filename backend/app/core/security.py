from datetime import datetime, timedelta, timezone
import bcrypt
import jwt
import hashlib
import secrets
from .config import settings

def verify_password(plain_password, hashed_password):
    if not hashed_password:
        return False  # e.g. Google-only accounts have no password
    try:
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
    except ValueError:
        return False

def get_password_hash(password):
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    # An integer NumericDate, as python-jose wrote it (PyJWT would convert a datetime the same way).
    to_encode.update({"exp": int(expire.timestamp()), "type": "access"})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

def create_refresh_token():
    """Generate a random refresh token."""
    return secrets.token_urlsafe(64)

def hash_token(token: str) -> str:
    """Hash a token for storage."""
    return hashlib.sha256(token.encode()).hexdigest()

def decode_access_token(token: str):
    """The access token's claims, or None for anything invalid (callers answer 401).

    The algorithm is pinned (never read from the token), exp is required and checked without
    leeway, nbf and iat (if present) must not be in the future, and a token carrying a
    non-empty aud, a non-string sub or a non-string jti is refused, as python-jose did. Tokens
    issued by python-jose decode unchanged (they carry only sub, exp and type).
    """
    try:
        return jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
            options={"require": ["exp"]},
        )
    except (jwt.PyJWTError, ValueError):  # ValueError: e.g. a lone surrogate cannot be encoded
        return None
