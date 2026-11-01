"""Purchase verifiers for the Luna AI plan: off, test (local fake) and google (Play Developer API).

A verifier never logs the purchase token or puts it in an exception message.
"""
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional, Protocol

from ...core.config import settings

ERROR_KINDS = ("network", "revoked", "invalid")

SUBSCRIPTION_STATES = frozenset({
    "SUBSCRIPTION_STATE_ACTIVE",
    "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
    "SUBSCRIPTION_STATE_CANCELED",
    "SUBSCRIPTION_STATE_ON_HOLD",
    "SUBSCRIPTION_STATE_PAUSED",
    "SUBSCRIPTION_STATE_EXPIRED",
    "SUBSCRIPTION_STATE_PENDING",
    "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED",
})
_STATE_PREFIX = "SUBSCRIPTION_STATE_"
_ACCOUNT_RE = re.compile(r"[0-9a-f]{64}")  # the account_token() format


@dataclass
class SubscriptionInfo:
    product_id: str
    state: str
    expiry_time: datetime  # naive UTC
    auto_renewing: bool
    acknowledged: bool
    account_id: Optional[str]
    package_name: Optional[str]


class VerifierError(Exception):
    """kind: network (timeout/5xx/auth with Google), revoked (Google 404/410), invalid (malformed)."""

    def __init__(self, kind: str, detail: str = ""):
        if kind not in ERROR_KINDS:
            raise ValueError(f"unknown verifier error kind: {kind}")
        self.kind = kind
        self.detail = detail
        super().__init__(f"{kind}: {detail}" if detail else kind)


class Verifier(Protocol):
    async def get(self, token: str) -> SubscriptionInfo: ...

    async def acknowledge(self, token: str, product_id: str) -> None: ...


def to_naive_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


class OffVerifier:
    """Billing disabled: nothing should ever ask for verification."""

    async def get(self, token: str) -> SubscriptionInfo:
        raise RuntimeError("Billing is off; no purchase verification is available")

    async def acknowledge(self, token: str, product_id: str) -> None:
        raise RuntimeError("Billing is off; no purchase verification is available")


class TestVerifier:
    """Local fake for development/testing.

    Token format: ``test:<product_id>:<STATE>:<expiry ISO>:<account_token>[:unacked]``.
    STATE omits the ``SUBSCRIPTION_STATE_`` prefix; account_token is 64 lowercase hex
    chars (the account_token() format) or empty for "no obfuscated account id". Acknowledged tokens are remembered in memory. ``fail_get`` /
    ``fail_ack`` may be set to an error kind to simulate Google failures.
    """

    __test__ = False  # not a pytest test class

    def __init__(self):
        self.acknowledged: set = set()
        self.ack_calls: list = []
        self.get_calls = 0
        self.fail_get: Optional[str] = None
        self.fail_ack: Optional[str] = None

    def __repr__(self) -> str:
        return f"TestVerifier(acknowledged={len(self.acknowledged)})"

    @staticmethod
    def _parse(token: str) -> SubscriptionInfo:
        invalid = VerifierError("invalid", "unrecognised test purchase token")
        if not isinstance(token, str) or not token.startswith("test:"):
            raise invalid
        rest = token[len("test:"):]
        acknowledged = True
        if rest.endswith(":unacked"):
            rest, acknowledged = rest[: -len(":unacked")], False
        head = rest.split(":", 2)
        if len(head) != 3:
            raise invalid
        product_id, state, tail = head
        if ":" not in tail:
            raise invalid
        expiry_raw, account = tail.rsplit(":", 1)
        full_state = _STATE_PREFIX + state
        if not product_id or state.startswith(_STATE_PREFIX) or full_state not in SUBSCRIPTION_STATES:
            raise invalid
        try:
            expiry = to_naive_utc(datetime.fromisoformat(expiry_raw))
        except ValueError:
            raise invalid from None
        if account and not _ACCOUNT_RE.fullmatch(account):
            raise invalid
        return SubscriptionInfo(
            product_id=product_id,
            state=full_state,
            expiry_time=expiry,
            auto_renewing=state in ("ACTIVE", "IN_GRACE_PERIOD"),
            acknowledged=acknowledged,
            account_id=account or None,
            package_name=None,
        )

    async def get(self, token: str) -> SubscriptionInfo:
        self.get_calls += 1
        if self.fail_get:
            raise VerifierError(self.fail_get, "simulated failure")
        info = self._parse(token)
        if token in self.acknowledged:
            info.acknowledged = True
        return info

    async def acknowledge(self, token: str, product_id: str) -> None:
        self.ack_calls.append((token, product_id))
        if self.fail_ack:
            raise VerifierError(self.fail_ack, "simulated failure")
        if self._parse(token).product_id != product_id:
            raise VerifierError("invalid", "product does not match the purchase")
        self.acknowledged.add(token)


_override: Optional[Verifier] = None
_instances: dict = {}


def set_verifier_for_tests(verifier: Optional[Verifier]) -> None:
    """Force get_verifier() to return `verifier`; None restores mode-based selection."""
    global _override
    _override = verifier


def get_verifier() -> Verifier:
    if _override is not None:
        return _override
    mode = settings.BILLING_MODE
    if mode not in _instances:
        if mode == "google":
            from .google import GoogleVerifier  # imported lazily: google.py imports this module

            _instances[mode] = GoogleVerifier()
        elif mode == "test":
            _instances[mode] = TestVerifier()
        else:
            _instances[mode] = OffVerifier()
    return _instances[mode]
