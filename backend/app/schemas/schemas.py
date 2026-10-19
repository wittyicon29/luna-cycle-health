from pydantic import BaseModel, EmailStr, Field, validator
from datetime import date, datetime
from typing import Optional, List, Dict, Any
from uuid import UUID
import re

class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    
    @validator('email')
    def validate_gmail(cls, v):
        """Validate that email is a Gmail address."""
        if not v.endswith('@gmail.com'):
            raise ValueError('Only Gmail addresses are supported for registration')
        # Basic Gmail validation
        gmail_pattern = r'^[a-zA-Z0-9._%+-]+@gmail\.com$'
        if not re.match(gmail_pattern, v):
            raise ValueError('Invalid Gmail address format')
        return v

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class Token(BaseModel):
    access_token: str
    refresh_token: Optional[str] = None
    token_type: str

class RefreshTokenRequest(BaseModel):
    refresh_token: str

class EmailVerificationRequest(BaseModel):
    token: str

class PasswordResetRequest(BaseModel):
    email: EmailStr

class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str = Field(min_length=8)

class PeriodCreate(BaseModel):
    start_date: date
    end_date: Optional[date] = None
    flow_intensity: Optional[str] = None
    pain_level: Optional[int] = Field(None, ge=0, le=10)
    symptoms: Optional[List[str]] = []
    notes: Optional[str] = None

class PeriodResponse(BaseModel):
    id: UUID
    start_date: date
    end_date: Optional[date]
    cycle_length: Optional[int]
    flow_intensity: Optional[str]
    pain_level: Optional[int]
    symptoms: Optional[List[str]]
    notes: Optional[str]
    created_at: datetime
    
    class Config:
        from_attributes = True

class QuestionnaireCreate(BaseModel):
    responses: Dict[str, Any]

class QuestionnaireResponse(BaseModel):
    id: UUID
    responses: Dict[str, Any]
    created_at: datetime
    
    class Config:
        from_attributes = True

class AnalysisRequest(BaseModel):
    analysis_type: str
    include_history: bool = True

class AnalysisResponse(BaseModel):
    id: UUID
    analysis_type: str
    llm_response: Optional[str]
    medical_analysis: Optional[Dict[str, Any]] = None
    user_report: Optional[Dict[str, Any]] = None
    predictions: Optional[Dict[str, Any]]
    health_insights: Optional[List[str]]
    risk_flags: Optional[List[str]]
    recommendations: Optional[List[str]]
    cycle_health_score: Optional[int]
    avg_cycle_length: Optional[int]
    cycle_std_deviation: Optional[int]
    created_at: datetime
    
    class Config:
        from_attributes = True

class ChatRequest(BaseModel):
    question: str
    include_context: bool = True
    session_id: Optional[str] = None

class ChatResponse(BaseModel):
    answer: str
    context_used: bool
    message_id: str
    session_id: str

class ChatMessageResponse(BaseModel):
    id: UUID
    session_id: Optional[str] = None
    role: str
    content: str
    created_at: datetime
    
    class Config:
        from_attributes = True
