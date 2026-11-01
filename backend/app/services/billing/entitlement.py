"""The single answer to "may this user use Luna AI?" plus purchase verification.

Rules (plan Global Constraints): active iff the stored state is in ACTIVE_STATES and
expiry_time > now. Re-verify with the verifier when expiry is less than 24 h away (or
past), when the row was last verified more than BILLING_REVERIFY_AFTER_HOURS ago, or
on demand (force). A verifier network error keeps the stored answer, but never past
expiry_time + BILLING_OUTAGE_GRACE_HOURS. All datetimes are naive UTC.

The purchase token is never logged, returned or put in an exception message.
"""
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...core.config import settings
from ...models.models import Subscription, User
from . import ACTIVE_STATES
from .account_token import account_token, token_hash
from .verifier import SubscriptionInfo, Verifier, VerifierError, get_verifier

logger = logging.getLogger(__name__)

EXPIRED_STATE = "SUBSCRIPTION_STATE_EXPIRED"
EXPIRY_REVERIFY_WINDOW = timedelta(hours=24)

DIFFERENT_ACCOUNT = "This purchase belongs to a different account"
ALREADY_LINKED = "This purchase is already linked to another account"
WRONG_PRODUCT = "This purchase is not for a Luna AI plan"
NOT_ACTIVE = "This subscription is not active"
ACK_FAILED = "Could not confirm the purchase with Google Play. Try again."
UNAVAILABLE = "Google Play is unavailable right now. Try again."
UNVERIFIABLE = "This purchase could not be verified"


def utcnow() -> datetime:
    """Naive UTC now; a seam so tests can fix the clock."""
    return datetime.utcnow()


@dataclass
class Entitlement:
    active: bool
    state: Optional[str]
    product_id: Optional[str]
    expires_at: Optional[datetime]
    auto_renewing: Optional[bool]
    source: str  # "off" | "stored" | "verified" | "grace"


def is_active(state: Optional[str], expiry_time: Optional[datetime], now: datetime) -> bool:
    return state in ACTIVE_STATES and expiry_time is not None and expiry_time > now


def _from_row(sub: Subscription, active: bool, source: str) -> Entitlement:
    return Entitlement(
        active=active,
        state=sub.state,
        product_id=sub.product_id,
        expires_at=sub.expiry_time,
        auto_renewing=sub.auto_renewing,
        source=source,
    )


NO_PLAN = Entitlement(active=False, state=None, product_id=None, expires_at=None, auto_renewing=None, source="stored")


def get_subscription(db: Session, user: User) -> Optional[Subscription]:
    return db.query(Subscription).filter(Subscription.user_id == user.id).first()


def stored_entitlement(db: Session, user: User, *, now: Optional[datetime] = None) -> Entitlement:
    """The cached answer from the stored row only; never calls the verifier."""
    now = now or utcnow()
    sub = get_subscription(db, user)
    if sub is None:
        return NO_PLAN
    return _from_row(sub, is_active(sub.state, sub.expiry_time, now), "stored")


def _needs_reverify(sub: Subscription, now: datetime) -> bool:
    if sub.expiry_time - now < EXPIRY_REVERIFY_WINDOW:  # also covers expiry_time <= now
        return True
    return now - sub.last_verified_at > timedelta(hours=settings.BILLING_REVERIFY_AFTER_HOURS)


def _mismatch(info: SubscriptionInfo, user: User) -> Optional[str]:
    """Why a verified purchase cannot belong to this user's Luna AI plan, or None."""
    if info.product_id not in settings.billing_product_ids:
        return WRONG_PRODUCT
    if settings.BILLING_MODE == "google" and info.package_name != settings.GOOGLE_PLAY_PACKAGE_NAME:
        return WRONG_PRODUCT
    if not info.account_id or info.account_id != account_token(user.id):
        return DIFFERENT_ACCOUNT
    return None


async def current_entitlement(
    db: Session,
    user: User,
    *,
    now: Optional[datetime] = None,
    verifier: Optional[Verifier] = None,
    force: bool = False,
) -> Entitlement:
    if settings.BILLING_MODE == "off":
        return Entitlement(active=True, state=None, product_id=None, expires_at=None, auto_renewing=None, source="off")
    now = now or utcnow()
    sub = get_subscription(db, user)
    if sub is None:
        return NO_PLAN
    if not (force or _needs_reverify(sub, now)):
        return _from_row(sub, is_active(sub.state, sub.expiry_time, now), "stored")

    verifier = verifier or get_verifier()
    try:
        info = await verifier.get(sub.purchase_token)
    except VerifierError as exc:
        if exc.kind == "network":
            grace_end = sub.expiry_time + timedelta(hours=settings.BILLING_OUTAGE_GRACE_HOURS)
            active = sub.state in ACTIVE_STATES and now < grace_end
            source = "stored" if is_active(sub.state, sub.expiry_time, now) else "grace"
            logger.warning("Billing re-verify unavailable; using stored entitlement")
            return _from_row(sub, active, source)
        if exc.kind == "revoked":
            sub.state, sub.expiry_time, sub.auto_renewing, sub.last_verified_at = EXPIRED_STATE, now, False, now
            db.commit()
            return _from_row(sub, False, "verified")
        # invalid: a malformed answer is an error, never a grant; keep the row and retry next time.
        logger.warning("Billing re-verify returned an invalid response")
        return _from_row(sub, False, "stored")

    if _mismatch(info, user):
        logger.warning("Billing re-verify returned a purchase that does not match the stored plan")
        return _from_row(sub, False, "stored")

    sub.product_id = info.product_id
    sub.state = info.state
    sub.expiry_time = info.expiry_time
    sub.auto_renewing = info.auto_renewing
    sub.acknowledged = sub.acknowledged or info.acknowledged
    sub.last_verified_at = now
    db.commit()
    return _from_row(sub, is_active(sub.state, sub.expiry_time, now), "verified")


async def verify_and_store(
    db: Session,
    user: User,
    token: str,
    product_id: str,
    *,
    verifier: Optional[Verifier] = None,
    now: Optional[datetime] = None,
) -> Entitlement:
    """Verify a purchase with Play, bind it to `user`, acknowledge it if needed, then store it.

    Nothing is stored unless every check passes and the purchase is acknowledged.
    """
    now = now or utcnow()
    verifier = verifier or get_verifier()
    digest = token_hash(token)

    # Replay of another user's token: refuse before asking Google, say nothing about the owner.
    owner = db.query(Subscription.user_id).filter(Subscription.token_hash == digest).first()
    if owner is not None and owner.user_id != user.id:
        raise HTTPException(status_code=409, detail=ALREADY_LINKED)

    if product_id not in settings.billing_product_ids:
        raise HTTPException(status_code=409, detail=WRONG_PRODUCT)

    try:
        info = await verifier.get(token)
    except VerifierError as exc:
        if exc.kind == "network":
            raise HTTPException(status_code=503, detail=UNAVAILABLE) from None
        raise HTTPException(status_code=400, detail=UNVERIFIABLE) from None

    if info.product_id != product_id:
        raise HTTPException(status_code=409, detail=WRONG_PRODUCT)
    reason = _mismatch(info, user)
    if reason:
        raise HTTPException(status_code=409, detail=reason)
    if not is_active(info.state, info.expiry_time, now):
        raise HTTPException(status_code=409, detail=NOT_ACTIVE)

    sub = get_subscription(db, user)
    same_token = sub is not None and sub.token_hash == digest
    if not info.acknowledged and not (same_token and sub.acknowledged):
        try:
            await verifier.acknowledge(token, info.product_id)
        except VerifierError:
            raise HTTPException(status_code=502, detail=ACK_FAILED) from None

    # Insert, or replace the user's single row in place (user_id is unique), in one commit.
    if sub is None:
        sub = Subscription(user_id=user.id)
        db.add(sub)
    if not same_token:
        sub.purchase_token = token
        sub.token_hash = digest
        sub.created_at = now
    sub.product_id = info.product_id
    sub.state = info.state
    sub.expiry_time = info.expiry_time
    sub.auto_renewing = info.auto_renewing
    sub.acknowledged = True
    sub.last_verified_at = now
    try:
        db.commit()
    except IntegrityError:
        # Another account linked the same token concurrently.
        db.rollback()
        raise HTTPException(status_code=409, detail=ALREADY_LINKED) from None
    return _from_row(sub, True, "verified")
