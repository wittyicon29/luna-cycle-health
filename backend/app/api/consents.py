from typing import Dict, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..models.models import User
from ..services.consent_service import current_consents, has_consent, record_consent
from .auth import get_current_user

router = APIRouter(prefix="/consents", tags=["Consents"])


class ConsentUpdate(BaseModel):
    purpose: Literal["terms_privacy", "age_18_plus", "health_data_processing", "ai_processing"]
    granted: bool


@router.get("/", response_model=Dict[str, bool])
def get_consents(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return current_consents(db, current_user.id)


@router.post("/", response_model=Dict[str, bool])
def update_consent(
    payload: ConsentUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record_consent(db, current_user.id, payload.purpose, payload.granted)
    return current_consents(db, current_user.id)


def require_consent(purpose: str):
    """Dependency factory: resolves to the current user, or 403 if consent is missing."""

    def dependency(
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> User:
        if not has_consent(db, current_user.id, purpose):
            raise HTTPException(
                status_code=403,
                detail={"code": "consent_required", "purpose": purpose},
            )
        return current_user

    return dependency
