"""GoogleVerifier: Play Developer API (subscriptionsv2) behind an injectable HTTP layer.

The purchase token is only ever placed percent-encoded in a request path; it is never
logged, never put in an exception message, and never part of repr().
"""
import asyncio
import json
import logging
import time
from datetime import datetime
from typing import Any, Callable, Optional
from urllib.parse import quote

import httpx
import jwt

from ...core.config import settings
from .verifier import SubscriptionInfo, VerifierError, to_naive_utc

logger = logging.getLogger(__name__)

TOKEN_URL = "https://oauth2.googleapis.com/token"
ANDROID_PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher"
API_BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications"
JWT_BEARER_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer"
HTTP_TIMEOUT_SECONDS = 10
TOTAL_TIMEOUT_SECONDS = 12  # hard cap per request (incl. the OAuth token fetch), on top of httpx's own
_ASSERTION_LIFETIME_SECONDS = 3600
_REFRESH_MARGIN_SECONDS = 60
ACKNOWLEDGED = "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED"


# httpx logs every request URL at INFO ("HTTP Request: GET https://..."), and the purchase
# token is part of the Play API path. Drop those records at the source loggers (not by raising
# the level app-wide); other hosts keep logging normally.
GOOGLE_HOSTS = ("androidpublisher.googleapis.com", "oauth2.googleapis.com")
FILTERED_LOGGERS = (
    "httpx",
    "httpcore.connection",
    "httpcore.http11",
    "httpcore.http2",
    "httpcore.proxy",
    "httpcore.socks",
)


class _GoogleRequestLogFilter(logging.Filter):
    luna_google_filter = True  # marker so re-imports (reload) do not stack filters

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:  # a malformed record: judge by its raw parts
            message = f"{record.msg} {record.args}"
        return not any(host in message for host in GOOGLE_HOSTS)


def _install_log_filter() -> None:
    for name in FILTERED_LOGGERS:
        target = logging.getLogger(name)
        if not any(getattr(f, "luna_google_filter", False) for f in target.filters):
            target.addFilter(_GoogleRequestLogFilter())


_install_log_filter()


class HttpxTransport:
    """Default network seam: one short-lived httpx client per request, 10 s timeout."""

    def __init__(self, transport: Optional[httpx.AsyncBaseTransport] = None):
        self._transport = transport  # tests pass httpx.MockTransport

    async def request(self, method: str, url: str, *, headers=None, data=None, json=None):
        kwargs = {"timeout": httpx.Timeout(HTTP_TIMEOUT_SECONDS)}
        if self._transport is not None:
            kwargs["transport"] = self._transport
        async with httpx.AsyncClient(**kwargs) as client:
            return await client.request(method, url, headers=headers, data=data, json=json)


def _seg(value: str) -> str:
    return quote(value, safe="")


def _status_error(status: int, what: str) -> VerifierError:
    if status in (404, 410):
        return VerifierError("revoked", f"Google Play reported the purchase as gone ({what}, HTTP {status})")
    if status == 400:
        return VerifierError("invalid", f"Google Play rejected the request ({what}, HTTP 400)")
    if status in (401, 403, 429) or status >= 500:
        return VerifierError("network", f"Google Play unavailable ({what}, HTTP {status})")
    return VerifierError("invalid", f"unexpected Google Play response ({what}, HTTP {status})")


def _parse_time(value: Any) -> datetime:
    if not isinstance(value, str):
        raise ValueError("timestamp is not a string")
    parsed = datetime.fromisoformat(value)  # 3.11+: RFC 3339 with Z, offsets, nanoseconds
    if parsed.tzinfo is None:
        raise ValueError("timestamp has no offset")
    return to_naive_utc(parsed)


class GoogleVerifier:
    def __init__(
        self,
        http=None,
        now: Callable[[], float] = time.time,
        *,
        package_name: Optional[str] = None,
        product_ids: Optional[list] = None,
        service_account_file: Optional[str] = None,
        total_timeout: float = TOTAL_TIMEOUT_SECONDS,
    ):
        self._http = http or HttpxTransport()
        self._total_timeout = total_timeout
        self._now = now
        self.package_name = package_name if package_name is not None else settings.GOOGLE_PLAY_PACKAGE_NAME
        self.product_ids = list(product_ids if product_ids is not None else settings.billing_product_ids)
        self._sa_file = (
            service_account_file if service_account_file is not None else settings.GOOGLE_PLAY_SERVICE_ACCOUNT_FILE
        )
        self._access_token: Optional[str] = None
        self._access_expires_at = 0.0

    def __repr__(self) -> str:
        return f"GoogleVerifier(package_name={self.package_name!r})"

    # --- transport ---------------------------------------------------------------

    async def _send(self, method: str, url: str, what: str, **kw):
        try:
            return await asyncio.wait_for(self._http.request(method, url, **kw), self._total_timeout)
        except (httpx.HTTPError, OSError, TimeoutError):  # asyncio.TimeoutError is TimeoutError on 3.11
            # `from None`: httpx exceptions can carry the request URL (which holds the token).
            logger.warning("Google Play %s request failed (transport error)", what)
            raise VerifierError("network", f"could not reach Google Play ({what})") from None

    # --- service-account access token -----------------------------------------

    def _load_service_account(self) -> tuple:
        try:
            with open(self._sa_file) as fh:
                info = json.load(fh)
            email, key = info["client_email"], info["private_key"]
            if not isinstance(email, str) or not isinstance(key, str) or not email or not key:
                raise ValueError
            return email, key, info.get("private_key_id")
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            logger.error("Google Play service account file is unusable")
            raise VerifierError("network", "service account credentials unavailable") from None

    async def _access(self) -> str:
        now = self._now()
        if self._access_token and now < self._access_expires_at - _REFRESH_MARGIN_SECONDS:
            return self._access_token
        email, key, key_id = self._load_service_account()
        iat = int(now)
        claims = {
            "iss": email,
            "scope": ANDROID_PUBLISHER_SCOPE,
            "aud": TOKEN_URL,
            "iat": iat,
            "exp": iat + _ASSERTION_LIFETIME_SECONDS,
        }
        try:
            assertion = jwt.encode(claims, key, algorithm="RS256", headers={"kid": key_id} if key_id else None)
        except Exception:
            logger.error("Google Play service account key could not sign the assertion")
            raise VerifierError("network", "service account credentials unavailable") from None
        response = await self._send(
            "POST", TOKEN_URL, "token", data={"grant_type": JWT_BEARER_GRANT, "assertion": assertion}
        )
        if response.status_code != 200:
            logger.warning("Google OAuth token request failed with HTTP %s", response.status_code)
            raise VerifierError("network", f"Google OAuth token request failed (HTTP {response.status_code})")
        try:
            body = response.json()
            token = body["access_token"]
            expires_in = float(body.get("expires_in", 3600))
            if not isinstance(token, str) or not token:
                raise ValueError
        except (ValueError, KeyError, TypeError, AttributeError):
            logger.warning("Google OAuth token response was malformed")
            raise VerifierError("network", "Google OAuth token response was malformed") from None
        self._access_token, self._access_expires_at = token, now + expires_in
        return token

    def _auth_failed(self, status: int) -> None:
        if status == 401:
            self._access_token, self._access_expires_at = None, 0.0

    # --- subscriptionsv2 read --------------------------------------------------

    async def get(self, token: str) -> SubscriptionInfo:
        access = await self._access()
        url = f"{API_BASE}/{_seg(self.package_name)}/purchases/subscriptionsv2/tokens/{_seg(token)}"
        response = await self._send("GET", url, "subscription lookup", headers={"Authorization": f"Bearer {access}"})
        if response.status_code != 200:
            self._auth_failed(response.status_code)
            logger.warning("Google Play subscription lookup failed with HTTP %s", response.status_code)
            raise _status_error(response.status_code, "subscription lookup")
        try:
            body = response.json()
        except ValueError:
            raise VerifierError("invalid", "Google Play response was not JSON") from None
        return self._map(body)

    def _map(self, body: Any) -> SubscriptionInfo:
        def invalid(reason: str) -> VerifierError:
            logger.warning("Google Play subscription response malformed: %s", reason)
            return VerifierError("invalid", f"malformed Google Play response: {reason}")

        if not isinstance(body, dict):
            raise invalid("not an object")
        state = body.get("subscriptionState")
        if not isinstance(state, str) or not state:
            raise invalid("subscriptionState missing")
        items = body.get("lineItems")
        if not isinstance(items, list) or not items:
            raise invalid("lineItems missing")

        best = None
        for item in items:
            if not isinstance(item, dict):
                raise invalid("line item is not an object")
            product_id = item.get("productId")
            if product_id not in self.product_ids:
                continue
            try:
                expiry = _parse_time(item.get("expiryTime"))
            except ValueError:
                raise invalid("expiryTime missing or unparseable") from None
            plan = item.get("autoRenewingPlan", {})
            if not isinstance(plan, dict):
                raise invalid("autoRenewingPlan is not an object")
            auto_renewing = plan.get("autoRenewEnabled", False)
            if not isinstance(auto_renewing, bool):
                raise invalid("autoRenewEnabled is not a boolean")
            if best is None or expiry > best[1]:
                best = (product_id, expiry, auto_renewing)
        if best is None:
            raise invalid("no allowed product in lineItems")

        ids = body.get("externalAccountIdentifiers")
        account_id = None
        if ids is not None:
            if not isinstance(ids, dict):
                raise invalid("externalAccountIdentifiers is not an object")
            account_id = ids.get("obfuscatedExternalAccountId")
            if account_id is not None and not isinstance(account_id, str):
                raise invalid("obfuscatedExternalAccountId is not a string")

        return SubscriptionInfo(
            product_id=best[0],
            state=state,
            expiry_time=best[1],
            auto_renewing=best[2],
            acknowledged=body.get("acknowledgementState") == ACKNOWLEDGED,
            account_id=account_id or None,
            package_name=self.package_name,
        )

    # --- acknowledge (legacy subscriptions endpoint, still the documented call) --

    async def acknowledge(self, token: str, product_id: str) -> None:
        if product_id not in self.product_ids:
            raise VerifierError("invalid", "product is not a Luna AI plan")
        access = await self._access()
        url = (
            f"{API_BASE}/{_seg(self.package_name)}/purchases/subscriptions/"
            f"{_seg(product_id)}/tokens/{_seg(token)}:acknowledge"
        )
        response = await self._send(
            "POST", url, "acknowledge", headers={"Authorization": f"Bearer {access}"}, json={}
        )
        if 200 <= response.status_code < 300:
            return
        self._auth_failed(response.status_code)
        if response.status_code == 400:
            # Google answers 400 when the purchase is already acknowledged; confirm by reading
            # the purchase rather than matching an error string.
            info = await self.get(token)
            if info.acknowledged:
                logger.info("Google Play purchase was already acknowledged")
                return
        logger.warning("Google Play acknowledge failed with HTTP %s", response.status_code)
        raise _status_error(response.status_code, "acknowledge")
