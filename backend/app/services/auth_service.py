from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime, timezone, timedelta
from ..models.models import User
from ..core.security import get_password_hash
import secrets
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import os

def generate_verification_token():
    """Generate a secure verification token."""
    return secrets.token_urlsafe(32)

def send_password_reset_email(to_email: str, token: str):
    """Send password reset email."""
    try:
        reset_url = f"http://localhost:3000/reset-password?token={token}"
        
        subject = "Reset your Luna Health password"
        body = f"""
        Hello! 🔐
        
        You requested to reset your Luna Health password. Click the link below to set a new password:
        
        {reset_url}
        
        This link will expire in 1 hour for security reasons.
        
        If you didn't request this password reset, you can safely ignore this email.
        
        Stay secure,
        The Luna Health Team 💜
        """
        
        # For development, just print the URL
        print(f"=== PASSWORD RESET ===")
        print(f"To: {to_email}")
        print(f"Reset URL: {reset_url}")
        print(f"===================")
        
        return True
        
    except Exception as e:
        print(f"Failed to send password reset email: {e}")
        return False

def verify_email_token(db: Session, token: str) -> bool:
    """Verify email token and mark email as verified."""
    user = db.query(User).filter(
        User.email_verification_token == token,
        User.email_verification_expires > datetime.now(timezone.utc)
    ).first()
    
    if not user:
        return False
    
    user.is_email_verified = True
    user.email_verification_token = None
    user.email_verification_expires = None
    db.commit()
    
    return True

def create_password_reset_token(db: Session, email: str) -> str:
    """Create password reset token for user."""
    user = db.query(User).filter(User.email == email).first()
    if not user:
        # Don't reveal if user exists
        return None
    
    token = generate_verification_token()
    user.password_reset_token = token
    user.password_reset_expires = datetime.now(timezone.utc) + timedelta(hours=1)
    db.commit()
    
    return token

def reset_password(db: Session, token: str, new_password: str) -> bool:
    """Reset user password using token."""
    user = db.query(User).filter(
        User.password_reset_token == token,
        User.password_reset_expires > datetime.now(timezone.utc)
    ).first()
    
    if not user:
        return False
    
    user.hashed_password = get_password_hash(new_password)
    user.password_reset_token = None
    user.password_reset_expires = None
    db.commit()
    
    return True
