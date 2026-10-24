from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..models.models import User, Period
from ..schemas.schemas import PeriodCreate, PeriodResponse
from .auth import get_current_user

router = APIRouter(prefix="/periods", tags=["Periods"])


def get_owned_period(db: Session, period_id: UUID, user: User) -> Period:
    period = db.query(Period).filter(Period.id == period_id, Period.user_id == user.id).first()
    if not period:
        raise HTTPException(status_code=404, detail="Period not found")
    return period


def recompute_cycle_lengths(db: Session, user_id) -> None:
    """Set each period's cycle_length to the days since the previous period's start."""
    periods = db.query(Period).filter(Period.user_id == user_id).order_by(Period.start_date.asc()).all()
    previous = None
    for period in periods:
        period.cycle_length = (period.start_date - previous.start_date).days if previous else None
        previous = period
    db.commit()


@router.post("/", response_model=PeriodResponse)
def create_period(period: PeriodCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    new_period = Period(
        user_id=current_user.id,
        start_date=period.start_date,
        end_date=period.end_date,
        flow_intensity=period.flow_intensity,
        pain_level=period.pain_level,
        symptoms=period.symptoms,
        notes=period.notes
    )
    db.add(new_period)
    db.commit()
    recompute_cycle_lengths(db, current_user.id)
    db.refresh(new_period)
    return new_period


@router.get("/", response_model=List[PeriodResponse])
def get_periods(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Period).filter(Period.user_id == current_user.id).order_by(Period.start_date.desc()).all()


@router.get("/{period_id}", response_model=PeriodResponse)
def get_period(period_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_owned_period(db, period_id, current_user)


@router.put("/{period_id}", response_model=PeriodResponse)
def update_period(period_id: UUID, period_update: PeriodCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    period = get_owned_period(db, period_id, current_user)

    period.start_date = period_update.start_date
    period.end_date = period_update.end_date
    period.flow_intensity = period_update.flow_intensity
    period.pain_level = period_update.pain_level
    period.symptoms = period_update.symptoms
    period.notes = period_update.notes

    db.commit()
    recompute_cycle_lengths(db, current_user.id)
    db.refresh(period)
    return period


@router.delete("/{period_id}")
def delete_period(period_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    period = get_owned_period(db, period_id, current_user)
    db.delete(period)
    db.commit()
    recompute_cycle_lengths(db, current_user.id)
    return {"message": "Period deleted"}
