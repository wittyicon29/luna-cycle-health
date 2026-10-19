from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from ..core.database import get_db
from ..models.models import User, Period, Questionnaire, Analysis, ChatMessage
from ..schemas.schemas import ChatMessageResponse, ChatRequest, ChatResponse
from ..services.llm_service import llm_service
from ..services.prediction_service import predict_next_period, get_cycle_summary
from .auth import get_current_user

router = APIRouter(prefix="/chat", tags=["Chat"])

@router.get("/history", response_model=List[ChatMessageResponse])
def get_chat_history(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    messages = db.query(ChatMessage).filter(
        ChatMessage.user_id == current_user.id
    ).order_by(ChatMessage.created_at.asc()).all()
    return messages

import uuid

@router.post("/ask", response_model=ChatResponse)
async def ask_question(
    request: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Ask questions about your cycle health and get personalized answers."""
    
    session_id = request.session_id or str(uuid.uuid4())
    
    # Save user message
    user_msg = ChatMessage(user_id=current_user.id, session_id=session_id, role="user", content=request.question)
    db.add(user_msg)
    db.commit()
    
    context = ""
    
    if request.include_context:
        # Gather user's data
        periods = db.query(Period).filter(
            Period.user_id == current_user.id
        ).order_by(Period.start_date.desc()).limit(6).all()
        
        questionnaire = db.query(Questionnaire).filter(
            Questionnaire.user_id == current_user.id
        ).order_by(Questionnaire.created_at.desc()).first()
        
        latest_analysis = db.query(Analysis).filter(
            Analysis.user_id == current_user.id
        ).order_by(Analysis.created_at.desc()).first()
        
        # Build context
        if periods:
            stats = get_cycle_summary(periods)
            prediction = predict_next_period(periods, current_user.default_cycle_length)
            
            context += f"\nUSER'S CYCLE DATA:\n"
            context += f"- Average cycle length: {stats.get('avg_cycle_length', 'N/A')} days\n"
            context += f"- Cycle regularity: {stats.get('std_deviation', 'N/A')} days variation\n"
            context += f"- Health score: {stats.get('health_score', 'N/A')}/100\n"
            context += f"- Next period predicted: {prediction.get('predicted_next_period', 'N/A')}\n"
            context += f"- Total cycles tracked: {stats.get('total_cycles', 0)}\n"
        
        if questionnaire:
            qdata = questionnaire.responses
            context += f"\nUSER'S HEALTH PROFILE:\n"
            if 'basic_demographic' in qdata:
                context += f"- Age: {qdata['basic_demographic'].get('age', 'N/A')}\n"
                context += f"- BMI: {qdata['basic_demographic'].get('bmi', 'N/A')}\n"
            if 'pain_symptoms' in qdata:
                context += f"- Pain severity: {qdata['pain_symptoms'].get('pain_severity', 'N/A')}/10\n"
            if 'pms_symptoms' in qdata:
                context += f"- PMS affects daily life: {qdata['pms_symptoms'].get('interferes_with_daily_activities', False)}\n"
        
        if latest_analysis:
            context += f"\nLATEST MEDICAL ANALYSIS:\n"
            if latest_analysis.health_insights:
                context += f"- Health insights: {', '.join(latest_analysis.health_insights[:2])}\n"
            if latest_analysis.risk_flags:
                context += f"- Risk flags: {', '.join(latest_analysis.risk_flags)}\n"
            if latest_analysis.cycle_health_score:
                context += f"- Cycle health score: {latest_analysis.cycle_health_score}/100\n"
    
    # Create prompt for Qwen
    system_prompt = """You are Luna, a warm, human-feeling companion specializing in menstrual and cycle health.

Your core vibe:
- Feel like a close friend who is also a thoughtful therapist and practical health coach.
- Supportive, non-judgmental, gently curious, never preachy.
- Emotionally attuned, but still grounded in evidence and safety.

Tone & style adaptation:
- Mirror the user's style: if they talk like Gen Z (slang, emojis, lowercase), you can lightly match it; if they write more formal, stay calm and clear.
- Always keep things understandable and kind, even when using casual language.
- You may use light emojis only if the user does, and only a few.

Two modes depending on what the user is talking about:

1) GENERAL / NON-HEALTH CHAT (life, feelings, relationships, work, random events):
- Be casual, short, and friendly, like a human friend.
- DO NOT mention periods, cycles, tracking data, scores, predictions, symptoms, or health advice at all unless the user *explicitly* asks about them.
- Answer in 2–5 simple sentences, no bullet points, no sections, no long explanations.

2) CYCLE / HEALTH CHAT (when they clearly ask about periods, symptoms, patterns, predictions, risk, scores):
- Still sound like a friend, but be a bit more structured.
- You may briefly reference their data if it helps, but keep it concise and human.
- You can use a short "Quick notes" style mini-section with at most 2–3 bullets if needed.
- Keep the whole reply reasonably short (no more than ~8 sentences total).

Health & safety rules:
- Never diagnose or imply something is "wrong".
- Do NOT say or imply you are a doctor.
- Use phrases like "Your cycle pattern suggests…" instead of "You have…".
- For concerning symptoms, say things like "These symptoms can sometimes need medical attention" and gently encourage seeing a clinician.
- Be specific with data when relevant, but do not over-focus on numbers.

Never sound like: a generic chatbot, a robot, or a diagnosing doctor.
You are: knowledgeable, friendly, empathetic, calm, science-based, and non-alarmist."""

    user_prompt = f"""USER_MESSAGE (what the user actually said):
{request.question}

USER_DATA_CONTEXT (may or may not be relevant to this message):
{context if context else "No personal data available for this user yet."}

Instructions for how to use this:
- First, in your own reasoning (not shown to the user), decide if USER_MESSAGE is mainly about menstrual health, cycle patterns, symptoms, predictions, or medical concerns.
- If YES, you may briefly use USER_DATA_CONTEXT to ground your answer, but keep it human and gentle.
- If NO (for example, the user is just venting, celebrating, talking about life, relationships, work, or emotions in general), you MUST COMPLETELY IGNORE USER_DATA_CONTEXT and you MUST NOT mention periods, tracking data, health scores, predictions, or stats at all.
- In the NO case, respond like a casual friend: maximum 5 short sentences, no bullet lists, no sections, no clinical language, just natural conversation.

Now write your reply to the user following these rules."""

    try:
        answer = await llm_service.call_qwen(user_prompt, system_prompt)
        
        # Save assistant message
        assistant_msg = ChatMessage(user_id=current_user.id, session_id=session_id, role="assistant", content=answer)
        db.add(assistant_msg)
        db.commit()
        
        return ChatResponse(
            answer=answer,
            context_used=bool(context),
            message_id=str(assistant_msg.id),
            session_id=session_id
        )
    
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Unable to generate response: {str(e)}"
        )
