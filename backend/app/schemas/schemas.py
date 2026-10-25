from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints, field_validator, model_validator, validator
from datetime import date, datetime, timedelta
from typing import Annotated, Optional, List, Dict, Any, Literal
from uuid import UUID
import re

class UserCreate(BaseModel):
    email: EmailStr
    accepted_privacy_policy: bool
    confirmed_18_plus: bool
    
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

    @validator('accepted_privacy_policy')
    def must_accept_policy(cls, v):
        if v is not True:
            raise ValueError('You must accept the Privacy Policy and Terms to create an account')
        return v

    @validator('confirmed_18_plus')
    def must_be_adult(cls, v):
        if v is not True:
            raise ValueError('Luna Health is for users aged 18 and over')
        return v

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class Token(BaseModel):
    access_token: str
    refresh_token: Optional[str] = None
    token_type: str

class RegisterResponse(BaseModel):
    message: str

class RefreshTokenRequest(BaseModel):
    refresh_token: str

class EmailVerificationRequest(BaseModel):
    token: str

class PasswordResetRequest(BaseModel):
    email: EmailStr

def check_password_bytes(v: str) -> str:
    # bcrypt only handles 72 bytes; longer input must be a clear 422, not a 500.
    if len(v.encode("utf-8")) > 72:
        raise ValueError("Password must be at most 72 bytes")
    return v


class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str = Field(min_length=8)

    @validator('new_password')
    def password_within_bcrypt_limit(cls, v):
        return check_password_bytes(v)

Symptom = Annotated[str, StringConstraints(max_length=50)]


class PeriodCreate(BaseModel):
    start_date: date
    end_date: Optional[date] = None
    flow_intensity: Optional[Literal["light", "medium", "heavy"]] = None
    pain_level: Optional[int] = Field(None, ge=0, le=10)
    symptoms: Optional[List[Symptom]] = Field(default_factory=list, max_length=30)
    notes: Optional[str] = Field(None, max_length=2000)

    @model_validator(mode="after")
    def check_dates(self):
        if self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date cannot be before start_date")
        # Allow tomorrow: users in IST are ahead of the server's UTC date.
        if self.start_date > date.today() + timedelta(days=1):
            raise ValueError("start_date cannot be in the future")
        return self


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


class PeriodPredictionResponse(BaseModel):
    predicted_next_period: Optional[date] = None
    earliest: Optional[date] = None
    latest: Optional[date] = None

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
    question: str = Field(min_length=1, max_length=1000)
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


class GoogleIdTokenRequest(BaseModel):
    id_token: str = Field(min_length=20, max_length=4096)
    accepted_privacy_policy: bool = False
    confirmed_18_plus: bool = False


MedicationName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]


class MedicationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: MedicationName


class MedicationUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Optional[MedicationName] = None
    archived: Optional[bool] = None

    @model_validator(mode="after")
    def need_a_field(self):
        if self.name is None and self.archived is None:
            raise ValueError("Nothing to update")
        return self


class MedicationResponse(BaseModel):
    id: UUID
    name: str
    archived: bool
    created_at: datetime

    class Config:
        from_attributes = True


SYMPTOM_CHOICES = ("cramps", "bloating", "headache", "fatigue", "mood swings", "acne", "back pain", "nausea", "tender breasts", "insomnia")


class DailyLogData(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mood: Optional[int] = Field(default=None, ge=1, le=5, strict=True)
    symptoms: List[Literal[SYMPTOM_CHOICES]] = Field(default_factory=list, max_length=10)  # cap applies to the raw list, before de-duplication
    flow: Optional[Literal["spotting", "light", "medium", "heavy"]] = None
    sleep_hours: Optional[float] = Field(default=None, ge=0, le=24, strict=True)
    water_glasses: Optional[int] = Field(default=None, ge=0, le=30, strict=True)
    medications_taken: List[UUID] = Field(default_factory=list, max_length=30)
    note: Optional[str] = Field(default=None, max_length=5000)  # hard raw cap; 1000 enforced after trimming

    @field_validator("symptoms")
    @classmethod
    def _dedupe_symptoms(cls, v):
        return list(dict.fromkeys(v))

    @field_validator("medications_taken")
    @classmethod
    def _dedupe_meds(cls, v):
        return list(dict.fromkeys(v))

    @field_validator("sleep_hours")
    @classmethod
    def _half_hours(cls, v):
        if v is not None and (v * 2) != int(v * 2):
            raise ValueError("Sleep must be in half-hour steps")
        return None if v is None else v + 0.0  # normalise -0.0

    @field_validator("note")
    @classmethod
    def _trim_note(cls, v):
        if v is None:
            return None
        v = v.strip()
        if len(v) > 1000:
            raise ValueError("Note must be at most 1000 characters")
        return v or None

    def is_empty(self) -> bool:
        return (self.mood is None and not self.symptoms and self.flow is None and self.sleep_hours is None
                and self.water_glasses is None and not self.medications_taken and self.note is None)


class DailyLogResponse(BaseModel):
    date: date
    mood: Optional[int] = None
    symptoms: List[str] = []
    flow: Optional[str] = None
    sleep_hours: Optional[float] = None
    water_glasses: Optional[int] = None
    medications_taken: List[UUID] = []
    note: Optional[str] = None
    updated_at: Optional[datetime] = None
