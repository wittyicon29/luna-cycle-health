from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Date, Boolean, JSON, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid
import enum
from ..core.database import Base
from ..core.crypto_types import EncryptedJSON, EncryptedText

class FlowIntensity(str, enum.Enum):
    light = "light"
    medium = "medium"
    heavy = "heavy"

class User(Base):
    __tablename__ = "users"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    is_email_verified = Column(Boolean, default=False)
    email_verification_token = Column(String, nullable=True)
    email_verification_expires = Column(DateTime, nullable=True)
    password_reset_token = Column(String, nullable=True)
    password_reset_expires = Column(DateTime, nullable=True)
    default_cycle_length = Column(Integer, default=28)
    has_completed_questionnaire = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    periods = relationship("Period", back_populates="user", cascade="all, delete-orphan")
    questionnaires = relationship("Questionnaire", back_populates="user", cascade="all, delete-orphan")
    analyses = relationship("Analysis", back_populates="user", cascade="all, delete-orphan")
    refresh_tokens = relationship("RefreshToken", back_populates="user", cascade="all, delete-orphan")
    chat_messages = relationship("ChatMessage", back_populates="user", cascade="all, delete-orphan")

class Period(Base):
    __tablename__ = "periods"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    start_date = Column(Date, nullable=False, index=True)
    end_date = Column(Date)
    cycle_length = Column(Integer)
    flow_intensity = Column(SQLEnum(FlowIntensity))
    pain_level = Column(Integer)
    symptoms = Column(JSON, default=list)
    notes = Column(EncryptedText)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    user = relationship("User", back_populates="periods")

class Questionnaire(Base):
    __tablename__ = "questionnaires"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    responses = Column(EncryptedJSON, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    user = relationship("User", back_populates="questionnaires")

class Analysis(Base):
    __tablename__ = "analyses"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    analysis_type = Column(String)
    input_data = Column(EncryptedJSON)
    llm_response = Column(EncryptedText)
    predictions = Column(JSON)
    health_insights = Column(JSON)
    risk_flags = Column(JSON)
    recommendations = Column(JSON)
    cycle_health_score = Column(Integer)
    avg_cycle_length = Column(Integer)
    cycle_std_deviation = Column(Integer)
    model_used = Column(String, default="medgemma-1.5-4b-it")
    created_at = Column(DateTime, default=datetime.utcnow)
    
    user = relationship("User", back_populates="analyses")

class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash = Column(String, nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False)
    is_revoked = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    user = relationship("User", back_populates="refresh_tokens")

class ChatMessage(Base):
    __tablename__ = "chat_messages"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    session_id = Column(String, index=True)
    role = Column(String, nullable=False)
    content = Column(EncryptedText, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    user = relationship("User", back_populates="chat_messages")
