from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..models.models import DailyLog, Medication, User
from ..schemas.schemas import DailyLogData, MedicationCreate, MedicationResponse, MedicationUpdate
from .auth import get_current_user

router = APIRouter(prefix="/medications", tags=["Medications"])
MAX_ACTIVE = 30


def _owned(db: Session, med_id: UUID, user: User) -> Medication:
    med = db.query(Medication).filter(Medication.id == med_id, Medication.user_id == user.id).first()
    if not med:
        raise HTTPException(status_code=404, detail="Medication not found")
    return med


def _active(db: Session, user: User, exclude_id=None) -> List[Medication]:
    rows = db.query(Medication).filter(Medication.user_id == user.id, Medication.archived == False).all()  # noqa: E712
    return [m for m in rows if m.id != exclude_id]


def _check_name_free(active: List[Medication], name: str) -> None:
    if any(m.name.casefold() == name.casefold() for m in active):
        raise HTTPException(status_code=409, detail="You already have a medication with that name")


@router.get("/", response_model=List[MedicationResponse])
def list_medications(include_archived: bool = Query(False), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = db.query(Medication).filter(Medication.user_id == current_user.id)
    if not include_archived:
        query = query.filter(Medication.archived == False)  # noqa: E712
    return query.order_by(Medication.created_at.asc()).all()


@router.post("/", response_model=MedicationResponse, status_code=201)
def create_medication(payload: MedicationCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    active = _active(db, current_user)
    if len(active) >= MAX_ACTIVE:
        raise HTTPException(status_code=422, detail="You can keep up to 30 medications. Remove or archive one first.")
    _check_name_free(active, payload.name)
    med = Medication(user_id=current_user.id, name=payload.name)
    db.add(med)
    db.commit()
    db.refresh(med)
    return med


@router.patch("/{med_id}", response_model=MedicationResponse)
def update_medication(med_id: UUID, payload: MedicationUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    med = _owned(db, med_id, current_user)
    final_name = payload.name if payload.name is not None else med.name
    final_archived = med.archived if payload.archived is None else payload.archived
    if not final_archived:
        active = _active(db, current_user, exclude_id=med.id)
        if len(active) >= MAX_ACTIVE:
            raise HTTPException(status_code=422, detail="You can keep up to 30 medications. Remove or archive one first.")
        _check_name_free(active, final_name)
    med.name = final_name
    med.archived = final_archived
    db.commit()
    db.refresh(med)
    return med


def _strip_from_logs(db: Session, user: User, med_id: str) -> None:
    """Remove a deleted medication's id from this user's daily logs (stored encrypted, so filter in Python).

    A stale id would make every later save of that day fail with "Unknown medication". A day left with nothing
    else in it is deleted, as the server does for any empty day. Runs in the caller's transaction."""
    for row in db.query(DailyLog).filter(DailyLog.user_id == user.id).all():
        data = row.data or {}
        taken = data.get("medications_taken") or []
        if med_id not in [str(m) for m in taken]:
            continue
        kept = {k: v for k, v in data.items() if k != "medications_taken"}
        rest = [m for m in taken if str(m) != med_id]
        if rest:
            kept["medications_taken"] = rest
        if DailyLogData.model_validate(kept).is_empty():
            db.delete(row)
        else:
            row.data = kept  # assign a new dict so the encrypted column registers the change


@router.delete("/{med_id}")
def delete_medication(med_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    med = _owned(db, med_id, current_user)
    _strip_from_logs(db, current_user, str(med.id))
    db.delete(med)
    db.commit()
    return {"deleted": True}
