from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..models.models import User
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
