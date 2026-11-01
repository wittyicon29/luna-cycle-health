from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.database import get_db
from ..core.limiter import limiter
from ..models.models import User
from ..schemas.schemas import BillingStatus, VerifyRequest
from ..services.billing import entitlement as entitlement_service
from ..services.billing.account_token import account_token
from .auth import get_current_user
from .consents import require_consent

router = APIRouter(prefix="/billing", tags=["Billing"])

PLAN_REQUIRED = {"code": "plan_required", "message": "Luna AI plan required"}

# The consent each gated feature needs first; consent_required wins over plan_required.
_FEATURE_CONSENT = {"ai": "ai_processing"}


def require_plan(feature: str = "ai"):
    """Dependency factory: resolves to the current user, or 403 plan_required.

    Runs the feature's consent check first. In BILLING_MODE=off it returns the user without
    looking up any subscription or calling a verifier.
    """
    consent_dependency = require_consent(_FEATURE_CONSENT[feature])

    async def dependency(
        current_user: User = Depends(consent_dependency),
        db: Session = Depends(get_db),
    ) -> User:
        if settings.BILLING_MODE == "off":
            return current_user
        ent = await entitlement_service.current_entitlement(db, current_user)
        if not ent.active:
            raise HTTPException(status_code=403, detail=PLAN_REQUIRED)
        return current_user

    return dependency


def _status(user: User, ent: entitlement_service.Entitlement) -> BillingStatus:
    if settings.BILLING_MODE == "off":
        return BillingStatus(enabled=False, active=False, plan="free", account_token=account_token(user.id))
    return BillingStatus(
        enabled=True,
        active=ent.active,
        plan="ai" if ent.active else "free",
        state=ent.state,
        product_id=ent.product_id,
        expires_at=ent.expires_at,
        auto_renewing=ent.auto_renewing,
        account_token=account_token(user.id),
    )


_OFF = entitlement_service.Entitlement(False, None, None, None, None, "off")


@router.get("/status", response_model=BillingStatus)
def billing_status(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Cached plan status; never calls Google."""
    if settings.BILLING_MODE == "off":
        return _status(current_user, _OFF)
    return _status(current_user, entitlement_service.stored_entitlement(db, current_user))


@router.post("/verify", response_model=BillingStatus)
@limiter.limit(settings.AUTH_RATE_LIMIT)
async def verify_purchase(
    request: Request,
    payload: VerifyRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if settings.BILLING_MODE == "off":
        raise HTTPException(status_code=400, detail="Billing is not enabled")
    ent = await entitlement_service.verify_and_store(db, current_user, payload.purchase_token, payload.product_id)
    return _status(current_user, ent)


@router.post("/refresh", response_model=BillingStatus)
@limiter.limit(settings.AUTH_RATE_LIMIT)
async def refresh_purchase(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Re-verify the stored purchase now (after the Play manage screen, at app start)."""
    if settings.BILLING_MODE == "off":
        return _status(current_user, _OFF)
    ent = await entitlement_service.current_entitlement(db, current_user, force=True)
    return _status(current_user, ent)
