import time
from typing import Optional

import httpx
from fastapi import HTTPException
from jose import JWTError, jwt

from ..core.config import settings

GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = {"https://accounts.google.com", "accounts.google.com"}
_CERTS_TTL_SECONDS = 3600
_FORCED_REFRESH_COOLDOWN_SECONDS = 60

_cache = {"fetched_at": 0.0, "keys": []}
_last_fetch_attempt = 0.0

_INVALID = "Google sign-in could not be verified"


def _invalid() -> HTTPException:
    return HTTPException(status_code=400, detail=_INVALID)


def allowed_audiences() -> list:
    return [a.strip() for a in settings.GOOGLE_ID_TOKEN_AUDIENCES.split(",") if a.strip()]


async def _fetch_google_keys() -> list:
    """The single network seam: fetch Google's current signing keys."""
    unavailable = HTTPException(status_code=503, detail="Google sign-in is temporarily unavailable")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(GOOGLE_CERTS_URL)
        response.raise_for_status()
        payload = response.json()
    except Exception:
        raise unavailable
    keys = payload.get("keys") if isinstance(payload, dict) else None
    if not isinstance(keys, list) or not keys or not all(isinstance(k, dict) for k in keys):
        raise unavailable
    return keys


async def _google_keys(force: bool = False) -> list:
    global _last_fetch_attempt
    now = time.time()
    cached = _cache["keys"]
    fresh = bool(cached) and now - _cache["fetched_at"] < _CERTS_TTL_SECONDS
    if fresh and not force:
        return cached
    # No fetch within the cooldown of the last attempt, except the first fetch on an empty cache.
    if (force or cached) and now - _last_fetch_attempt < _FORCED_REFRESH_COOLDOWN_SECONDS:
        return cached
    _last_fetch_attempt = now
    try:
        keys = await _fetch_google_keys()
    except HTTPException:
        if cached:
            return cached  # stale keys beat failing sign-in during a Google outage
        raise
    _cache["keys"], _cache["fetched_at"] = keys, now
    return keys


def _find_key(keys: list, kid: Optional[str]) -> Optional[dict]:
    return next((k for k in keys if kid and k.get("kid") == kid), None)


async def verify_google_id_token(id_token: str) -> dict:
    audiences = allowed_audiences()
    if not audiences:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured")
    try:
        header = jwt.get_unverified_header(id_token)
    except JWTError:
        raise _invalid()
    if header.get("alg") != "RS256":
        raise _invalid()

    key = _find_key(await _google_keys(), header.get("kid"))
    if key is None:
        key = _find_key(await _google_keys(force=True), header.get("kid"))
    if key is None:
        raise _invalid()

    try:
        claims = jwt.decode(
            id_token,
            key,
            algorithms=["RS256"],
            options={"verify_aud": False, "require_exp": True, "require_iat": True},
        )
    except (JWTError, ValueError, KeyError):
        raise _invalid()

    if claims.get("iss") not in GOOGLE_ISSUERS or claims.get("aud") not in audiences:
        raise _invalid()
    return claims
