from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..models.models import (Analysis, ChatMessage, ConsentRecord, Medication,
                             Period, Questionnaire, User)
from ..schemas.schemas import PeriodResponse
from .auth import get_current_user

router = APIRouter(prefix="/account", tags=["Account"])


class DeleteAccountRequest(BaseModel):
    confirm: str


@router.post("/delete")
def delete_account(
    payload: DeleteAccountRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Permanently delete the account and everything linked to it."""
    if payload.confirm != "DELETE":
        raise HTTPException(status_code=400, detail="Type DELETE to confirm account deletion")

    db.delete(current_user)  # cascades to periods, questionnaires, chats, analyses, tokens, consents
    db.commit()
    return {"message": "Your account and all associated data have been permanently deleted."}


@router.get("/export")
def export_account_data(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Download everything stored about the current user as JSON."""
    uid = current_user.id
    periods = db.query(Period).filter(Period.user_id == uid).order_by(Period.start_date).all()
    questionnaires = db.query(Questionnaire).filter(Questionnaire.user_id == uid).order_by(Questionnaire.created_at).all()
    analyses = db.query(Analysis).filter(Analysis.user_id == uid).order_by(Analysis.created_at).all()
    messages = db.query(ChatMessage).filter(ChatMessage.user_id == uid).order_by(ChatMessage.created_at).all()
    consents = db.query(ConsentRecord).filter(ConsentRecord.user_id == uid).order_by(ConsentRecord.created_at).all()

    meds = db.query(Medication).filter(Medication.user_id == uid).order_by(Medication.created_at).all()

    data = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "account": {"email": current_user.email, "created_at": current_user.created_at.isoformat()},
        "periods": [PeriodResponse.model_validate(p).model_dump(mode="json") for p in periods],
        "medications": [
            {"id": str(m.id), "name": m.name, "archived": m.archived, "created_at": m.created_at.isoformat()}
            for m in meds
        ],
        "questionnaires": [
            {"id": str(q.id), "created_at": q.created_at.isoformat(), "responses": q.responses}
            for q in questionnaires
        ],
        "analyses": [
            {
                "id": str(a.id),
                "analysis_type": a.analysis_type,
                "created_at": a.created_at.isoformat(),
                "predictions": a.predictions,
                "health_insights": a.health_insights,
                "risk_flags": a.risk_flags,
                "recommendations": a.recommendations,
                "cycle_health_score": a.cycle_health_score,
                "llm_response": a.llm_response,
            }
            for a in analyses
        ],
        "chat_messages": [
            {"id": str(m.id), "session_id": m.session_id, "role": m.role,
             "content": m.content, "created_at": m.created_at.isoformat()}
            for m in messages
        ],
        "consents": [
            {"purpose": c.purpose, "granted": c.granted,
             "policy_version": c.policy_version, "created_at": c.created_at.isoformat()}
            for c in consents
        ],
    }
    return JSONResponse(
        content=data,
        headers={
            "Content-Disposition": 'attachment; filename="luna-health-export.json"',
            "Cache-Control": "no-store",
        },
    )
