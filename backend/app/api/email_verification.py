from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from datetime import datetime, timezone, timedelta
from ..core.database import get_db
from ..models.models import User, RefreshToken
from ..services.email_service import send_email
from ..core.config import settings
from ..core.limiter import limiter
from ..core.security import get_password_hash, create_access_token, create_refresh_token, hash_token
from pydantic import BaseModel, EmailStr, Field
import secrets

router = APIRouter(prefix="/verify", tags=["Email Verification"])

class VerifyTokenRequest(BaseModel):
    token: str

class CompleteVerificationRequest(BaseModel):
    token: str
    password: str = Field(min_length=8)

class EmailRequest(BaseModel):
    email: EmailStr

def generate_verification_token() -> str:
    """Generate a secure verification token."""
    return secrets.token_urlsafe(32)

def create_verification_email(token: str, user_email: str) -> str:
    """Create verification email content."""
    verification_url = f"{settings.FRONTEND_URL}/verify-email?token={token}"
    
    return f"""
Hello,

Thank you for registering with Luna Health! 

Open the link below to finish creating your Luna Health account and choose your password:

{verification_url}

This verification link will expire in 24 hours.

If you didn't create an account with Luna Health, you can safely ignore this email.

For your security:
• Never share this verification link with anyone
• This link can only be used once
• Luna Health will never ask for your password via email

Need help? Contact our support team.

Welcome to Luna Health!

The Luna Health Team
"""

@router.post("/send-verification")
@limiter.limit(settings.AUTH_RATE_LIMIT)
async def send_verification_email(request: Request, payload: EmailRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Send verification email to user."""
    user = db.query(User).filter(User.email == payload.email).first()
    
    if not user:
        # Don't reveal if email exists
        return {"message": "If an account with this email exists, a verification email has been sent."}
    
    if user.is_email_verified:
        return {"message": "Email is already verified."}
    
    # Generate and store verification token
    token = generate_verification_token()
    user.email_verification_token = token
    user.email_verification_expires = datetime.now(timezone.utc) + timedelta(hours=24)
    db.commit()
    
    # Send verification email
    email_content = create_verification_email(token, user.email)
    background_tasks.add_task(
        send_email,
        to_email=user.email,
        subject="Verify Your Luna Health Account",
        content=email_content
    )
    
    return {"message": "Verification email sent successfully."}

def _unverified_user_for_token(db: Session, token: str) -> User:
    user = db.query(User).filter(
        User.email_verification_token == token,
        User.email_verification_expires > datetime.now(timezone.utc)
    ).first()
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired verification link.")
    if user.is_email_verified:
        raise HTTPException(status_code=400, detail="This link has already been used. Please log in.")
    return user

@router.post("/check")
@limiter.limit(settings.AUTH_RATE_LIMIT)
def check_verification_token(request: Request, payload: VerifyTokenRequest, db: Session = Depends(get_db)):
    """Report which address a verification link belongs to. Changes nothing."""
    user = _unverified_user_for_token(db, payload.token)
    return {"email": user.email}

@router.post("/complete")
@limiter.limit(settings.AUTH_RATE_LIMIT)
def complete_verification(request: Request, payload: CompleteVerificationRequest, db: Session = Depends(get_db)):
    """Choose a password, verify the email and sign in. Single use."""
    user = _unverified_user_for_token(db, payload.token)

    user.hashed_password = get_password_hash(payload.password)
    user.is_email_verified = True
    user.email_verification_token = None
    user.email_verification_expires = None
    # Anything issued before ownership was proven must not survive verification.
    db.query(RefreshToken).filter(RefreshToken.user_id == user.id).update({"is_revoked": True})

    access_token = create_access_token({"sub": str(user.id)})
    refresh_token_raw = create_refresh_token()
    db.add(RefreshToken(
        user_id=user.id,
        token_hash=hash_token(refresh_token_raw),
        expires_at=datetime.now(timezone.utc) + timedelta(days=30)
    ))
    db.commit()

    return {"access_token": access_token, "refresh_token": refresh_token_raw, "token_type": "bearer"}

@router.post("/resend")
@limiter.limit(settings.AUTH_RATE_LIMIT)
async def resend_verification(request: Request, payload: EmailRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Resend verification email."""
    user = db.query(User).filter(User.email == payload.email).first()
    
    if not user:
        return {"message": "If an account with this email exists, a verification email has been sent."}
    
    if user.is_email_verified:
        return {"message": "Email is already verified."}
    
    # Check if enough time has passed since last email (prevent spam)
    if user.email_verification_expires:
        expires = user.email_verification_expires
        if expires.tzinfo is None:  # the database returns naive UTC datetimes
            expires = expires.replace(tzinfo=timezone.utc)
        time_since_last = datetime.now(timezone.utc) - expires + timedelta(hours=24)
        if time_since_last < timedelta(minutes=5):
            raise HTTPException(
                status_code=429,
                detail="Please wait before requesting another verification email."
            )
    
    # Generate new token
    token = generate_verification_token()
    user.email_verification_token = token
    user.email_verification_expires = datetime.now(timezone.utc) + timedelta(hours=24)
    db.commit()
    
    # Send verification email
    email_content = create_verification_email(token, user.email)
    background_tasks.add_task(
        send_email,
        to_email=user.email,
        subject="Verify Your Luna Health Account",
        content=email_content
    )
    
    return {"message": "Verification email sent successfully."}
