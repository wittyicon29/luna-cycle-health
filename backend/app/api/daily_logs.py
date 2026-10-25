from datetime import date, timedelta
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..models.models import DailyLog, Medication, User
from ..schemas.schemas import DailyLogData, DailyLogResponse
from .auth import get_current_user

router = APIRouter(prefix="/logs", tags=["Daily logs"])
EARLIEST = date(2000, 1, 1)
MAX_RANGE_DAYS = 400


def entry_dict(row: DailyLog) -> dict:
    data = row.data or {}
    return DailyLogResponse(
        date=row.log_date,
        mood=data.get("mood"),
        symptoms=data.get("symptoms", []),
        flow=data.get("flow"),
        sleep_hours=data.get("sleep_hours"),
        water_glasses=data.get("water_glasses"),
        medications_taken=data.get("medications_taken", []),
        note=data.get("note"),
        updated_at=row.updated_at,
    ).model_dump(mode="json")


def _check_date(day: date) -> None:
    if day < EARLIEST or day > date.today() + timedelta(days=1):
        raise HTTPException(status_code=422, detail="Date is out of range")


def _find(db: Session, user: User, day: date):
    return db.query(DailyLog).filter(DailyLog.user_id == user.id, DailyLog.log_date == day).first()


@router.get("/", response_model=List[DailyLogResponse])
def list_logs(
    from_: date = Query(..., alias="from"),
    to: date = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if to < from_ or (to - from_).days > MAX_RANGE_DAYS:
        raise HTTPException(status_code=422, detail="Choose a range of at most 400 days")
    rows = (
        db.query(DailyLog)
        .filter(DailyLog.user_id == current_user.id, DailyLog.log_date >= from_, DailyLog.log_date <= to)
        .order_by(DailyLog.log_date.asc())
        .all()
    )
    return [entry_dict(r) for r in rows]


@router.put("/{log_date}")
def put_log(log_date: date, payload: DailyLogData, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _check_date(log_date)
    existing = _find(db, current_user, log_date)

    if payload.is_empty():
        if existing:
            db.delete(existing)
            db.commit()
        return {"date": str(log_date), "deleted": True}

    if payload.medications_taken:
        owned = db.query(Medication.id).filter(
            Medication.user_id == current_user.id, Medication.id.in_(payload.medications_taken)
        ).count()
        if owned != len(payload.medications_taken):
            raise HTTPException(status_code=422, detail="Unknown medication")

    data = payload.model_dump(mode="json", exclude_none=True)
    # keep real zeros (sleep_hours 0, water_glasses 0); drop only None and empty lists
    data = {k: v for k, v in data.items() if v is not None and not (isinstance(v, list) and not v)}

    def save(row):
        if row is None:
            row = DailyLog(user_id=current_user.id, log_date=log_date, data=data)
            db.add(row)
        else:
            row.data = data
        db.commit()
        db.refresh(row)
        return row

    try:
        row = save(existing)
    except IntegrityError:  # two concurrent first saves for the same day: update the winner
        db.rollback()
        row = save(_find(db, current_user, log_date))
    return entry_dict(row)


@router.delete("/{log_date}")
def delete_log(log_date: date, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = _find(db, current_user, log_date)
    if row:
        db.delete(row)
        db.commit()
    return {"deleted": True}
