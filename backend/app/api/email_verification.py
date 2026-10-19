from fastapi import APIRouter, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime, timezone, timedelta
from ..core.database import get_db
from ..models.models import User
from ..services.email_service import send_email
from pydantic import BaseModel
import secrets

router = APIRouter(prefix="/verify", tags=["Email Verification"])

class VerifyRequest(BaseModel):
    token: str

def generate_verification_token() -> str:
    """Generate a secure verification token."""
    return secrets.token_urlsafe(32)

def create_verification_email(token: str, user_email: str) -> str:
    """Create verification email content."""
    verification_url = f"http://localhost:3000/verify-email?token={token}"
    
    return f"""
Hello,

Thank you for registering with Luna Health! 

To complete your registration and activate your account, please verify your email address by clicking the link below:

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
async def send_verification_email(email: str, background_tasks, db: Session = Depends(get_db)):
    """Send verification email to user."""
    user = db.query(User).filter(User.email == email).first()
    
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

@router.post("/verify")
async def verify_email(request: VerifyRequest, db: Session = Depends(get_db)):
    """Verify email with token."""
    user = db.query(User).filter(
        User.email_verification_token == request.token,
        User.email_verification_expires > datetime.now(timezone.utc)
    ).first()
    
    if not user:
        raise HTTPException(
            status_code=400, 
            detail="Invalid or expired verification token"
        )
    
    if user.is_email_verified:
        return {"message": "Email is already verified."}
    
    # Mark email as verified
    user.is_email_verified = True
    user.email_verification_token = None
    user.email_verification_expires = None
    db.commit()
    
    return {"message": "Email verified successfully! You can now log in."}

@router.post("/resend")
async def resend_verification(email: str, background_tasks, db: Session = Depends(get_db)):
    """Resend verification email."""
    user = db.query(User).filter(User.email == email).first()
    
    if not user:
        return {"message": "If an account with this email exists, a verification email has been sent."}
    
    if user.is_email_verified:
        return {"message": "Email is already verified."}
    
    # Check if enough time has passed since last email (prevent spam)
    if user.email_verification_expires:
        time_since_last = datetime.now(timezone.utc) - user.email_verification_expires + timedelta(hours=24)
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
