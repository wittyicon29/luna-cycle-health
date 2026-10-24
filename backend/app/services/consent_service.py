from typing import Dict
from uuid import UUID

from sqlalchemy.orm import Session

from ..core.config import settings
from ..models.models import ConsentRecord

CONSENT_PURPOSES = ("terms_privacy", "age_18_plus", "health_data_processing", "ai_processing")


def add_consent(db: Session, user_id: UUID, purpose: str, granted: bool) -> ConsentRecord:
    """Stage a consent record in the current transaction without committing."""
    record = ConsentRecord(
        user_id=user_id,
        purpose=purpose,
        granted=granted,
        policy_version=settings.PRIVACY_POLICY_VERSION,
    )
    db.add(record)
    return record


def record_consent(db: Session, user_id: UUID, purpose: str, granted: bool) -> ConsentRecord:
    record = add_consent(db, user_id, purpose, granted)
    db.commit()
    db.refresh(record)
    return record


def current_consents(db: Session, user_id: UUID) -> Dict[str, bool]:
    """Latest decision per purpose; purposes never answered count as not granted."""
    state = {purpose: False for purpose in CONSENT_PURPOSES}
    records = (
        db.query(ConsentRecord)
        .filter(ConsentRecord.user_id == user_id)
        .order_by(ConsentRecord.created_at.asc())
        .all()
    )
    for record in records:
        state[record.purpose] = record.granted
    return state


def has_consent(db: Session, user_id: UUID, purpose: str) -> bool:
    return current_consents(db, user_id).get(purpose, False)
