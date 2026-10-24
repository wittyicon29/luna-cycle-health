from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
import json
from ..core.database import get_db
from ..core.redis import redis_client
from ..models.models import User, Analysis, Period, Questionnaire
from ..schemas.schemas import AnalysisRequest, AnalysisResponse
from ..services.llm_service import llm_service
from ..services.prediction_service import predict_next_period, get_cycle_summary
from .auth import get_current_user
from .consents import require_consent

router = APIRouter(prefix="/analysis", tags=["Analysis"])

CACHE_TTL = 60 * 60 * 6  # 6 hours
INSUFFICIENT_DATA = "Log at least two periods (about a month apart) so Luna can find your pattern."

async def get_cached_analysis(user_id: str):
    return None  # Redis disabled

async def cache_analysis(user_id: str, data: dict):
    pass  # Redis disabled

async def invalidate_analysis(user_id: str):
    pass  # Redis disabled

@router.post("/", response_model=AnalysisResponse)
async def create_analysis(request: AnalysisRequest, current_user: User = Depends(require_consent("ai_processing")), db: Session = Depends(get_db)):
    # Check cache first
    cached = await get_cached_analysis(str(current_user.id))
    if cached and request.analysis_type == "cycle_health":
        return cached
    
    periods = db.query(Period).filter(Period.user_id == current_user.id).order_by(Period.start_date.desc()).limit(12).all()
    questionnaire = db.query(Questionnaire).filter(Questionnaire.user_id == current_user.id).order_by(Questionnaire.created_at.desc()).first()
    
    if not periods:
        raise HTTPException(status_code=400, detail=INSUFFICIENT_DATA)
    
    period_data = [
        {
            "start_date": str(p.start_date),
            "end_date": str(p.end_date) if p.end_date else None,
            "cycle_length": p.cycle_length,
            "flow_intensity": p.flow_intensity,
            "pain_level": p.pain_level,
            "symptoms": p.symptoms
        }
        for p in periods
    ]
    
    questionnaire_data = questionnaire.responses if questionnaire else {}
    
    # Get statistical predictions
    prediction = predict_next_period(periods, current_user.default_cycle_length)
    if prediction.get("error"):
        raise HTTPException(status_code=400, detail=INSUFFICIENT_DATA)
    stats = get_cycle_summary(periods)

    if request.analysis_type == "cycle_health":
        llm_result = await llm_service.analyze_cycle_health(period_data, questionnaire_data, stats, prediction)
        
        # Parse the complete LLM result
        medical_analysis = llm_result.get("medical_analysis", {})
        user_report = {
            "simple_summary": llm_result.get("simple_summary", ""),
            "key_insights": llm_result.get("key_insights", []),
            "why_this_result": llm_result.get("why_this_result", []),
            "recommendations": llm_result.get("recommendations", []),
            "what_to_expect": llm_result.get("what_to_expect", ""),
            "when_to_see_doctor": llm_result.get("when_to_see_doctor", ""),
            "next_steps": llm_result.get("next_steps", [])
        }
        
        analysis = Analysis(
            user_id=current_user.id,
            analysis_type=request.analysis_type,
            input_data={"periods": period_data, "questionnaire": questionnaire_data},
            llm_response=json.dumps(llm_result),
            predictions=prediction,
            health_insights=llm_result.get("health_insights", []),
            risk_flags=llm_result.get("risk_flags", []),
            recommendations=llm_result.get("recommendations", []),
            cycle_health_score=stats.get("health_score"),
            avg_cycle_length=int(stats.get("avg_cycle_length", 0)) if stats.get("avg_cycle_length") else None,
            cycle_std_deviation=int(stats.get("std_deviation", 0)) if stats.get("std_deviation") else None,
        )
    elif request.analysis_type == "prediction":
        analysis = Analysis(
            user_id=current_user.id,
            analysis_type=request.analysis_type,
            input_data={"periods": period_data},
            llm_response=f"Next period predicted for {prediction.get('predicted_next_period')}",
            predictions=prediction,
            cycle_health_score=stats.get("health_score"),
            avg_cycle_length=int(stats.get("avg_cycle_length", 0)) if stats.get("avg_cycle_length") else None,
            cycle_std_deviation=int(stats.get("std_deviation", 0)) if stats.get("std_deviation") else None,
        )
    else:
        raise HTTPException(status_code=400, detail="Invalid analysis type")
    
    db.add(analysis)
    db.commit()
    db.refresh(analysis)
    
    # Cache result
    await cache_analysis(str(current_user.id), {
        "id": str(analysis.id),
        "analysis_type": analysis.analysis_type,
        "predictions": analysis.predictions,
        "health_insights": analysis.health_insights,
        "risk_flags": analysis.risk_flags,
        "recommendations": analysis.recommendations,
        "cycle_health_score": analysis.cycle_health_score,
        "medical_analysis": medical_analysis if 'medical_analysis' in locals() else {},
        "user_report": user_report if 'user_report' in locals() else {},
    })
    
    # Add parsed analysis to response for cycle_health analysis
    if request.analysis_type == "cycle_health" and 'medical_analysis' in locals():
        analysis.medical_analysis = medical_analysis
        analysis.user_report = user_report
    
    return analysis

@router.get("/", response_model=List[AnalysisResponse])
def get_analyses(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    analyses = db.query(Analysis).filter(Analysis.user_id == current_user.id).order_by(Analysis.created_at.desc()).all()
    return analyses

@router.get("/latest/{analysis_type}", response_model=AnalysisResponse)
def get_latest_analysis(analysis_type: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    analysis = db.query(Analysis).filter(
        Analysis.user_id == current_user.id,
        Analysis.analysis_type == analysis_type
    ).order_by(Analysis.created_at.desc()).first()
    
    if not analysis:
        raise HTTPException(status_code=404, detail="No analysis found")
    
    # Parse complete analysis for cycle_health type
    if analysis.analysis_type == "cycle_health" and analysis.llm_response:
        try:
            llm_result = json.loads(analysis.llm_response)
            analysis.medical_analysis = llm_result.get("medical_analysis", {})
            analysis.user_report = {
                "simple_summary": llm_result.get("simple_summary", ""),
                "key_insights": llm_result.get("key_insights", []),
                "why_this_result": llm_result.get("why_this_result", []),
                "recommendations": llm_result.get("recommendations", []),
                "what_to_expect": llm_result.get("what_to_expect", ""),
                "when_to_see_doctor": llm_result.get("when_to_see_doctor", ""),
                "next_steps": llm_result.get("next_steps", [])
            }
        except (json.JSONDecodeError, AttributeError):
            pass
    
    return analysis
