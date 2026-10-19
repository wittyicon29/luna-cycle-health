from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
import json
from ..core.database import get_db
from ..core.encryption import encryption_service, SENSITIVE_FIELDS
from ..models.models import User, Questionnaire
from ..schemas.schemas import QuestionnaireResponse
from ..schemas.simplified_questionnaire import SimplifiedQuestionnaire
from ..services.simplified_analysis_service import simplified_analysis_service
from .auth import get_current_user

router = APIRouter(prefix="/questionnaires", tags=["Questionnaires"])

@router.post("/", response_model=dict)
def create_questionnaire(
    questionnaire: SimplifiedQuestionnaire,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Submit health questionnaire with privacy protection."""
    
    if not questionnaire.optional_data.data_consent_given:
        raise HTTPException(
            status_code=400,
            detail="Data consent is required to submit questionnaire"
        )
    
    questionnaire_dict = questionnaire.to_dict()
    
    # Encrypt sensitive fields
    if questionnaire.optional_data.additional_notes:
        questionnaire_dict['optional_data']['additional_notes'] = encryption_service.encrypt(
            questionnaire.optional_data.additional_notes
        )
    
    # Perform analysis
    analysis = simplified_analysis_service.analyze(questionnaire)
    
    # Store in database
    new_questionnaire = Questionnaire(
        user_id=current_user.id,
        responses=questionnaire_dict
    )
    db.add(new_questionnaire)
    
    # Mark questionnaire as completed for this user
    current_user.has_completed_questionnaire = True
    
    db.commit()
    db.refresh(new_questionnaire)
    
    return {
        "questionnaire_id": str(new_questionnaire.id),
        "status": "submitted",
        "analysis": analysis,
        "disclaimer": "This analysis is probabilistic and not a diagnosis. Please consult with a healthcare provider for medical advice."
    }

@router.get("/", response_model=List[QuestionnaireResponse])
def get_questionnaires(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    questionnaires = db.query(Questionnaire).filter(
        Questionnaire.user_id == current_user.id
    ).order_by(Questionnaire.created_at.desc()).all()
    return questionnaires

@router.get("/latest", response_model=QuestionnaireResponse)
def get_latest_questionnaire(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    questionnaire = db.query(Questionnaire).filter(
        Questionnaire.user_id == current_user.id
    ).order_by(Questionnaire.created_at.desc()).first()
    
    if not questionnaire:
        raise HTTPException(status_code=404, detail="No questionnaire found")
    return questionnaire
