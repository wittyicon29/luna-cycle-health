from sqlalchemy.orm import Session
from datetime import datetime, timezone, timedelta
from ..core.config import settings
from ..models.models import User, RefreshToken
from ..core.security import get_password_hash
from . import email_service
import secrets

def generate_verification_token():
    """Generate a secure verification token."""
    return secrets.token_urlsafe(32)

async def send_password_reset_email(to_email: str, token: str) -> bool:
    """Send the password reset email."""
    reset_url = f"{settings.FRONTEND_URL}/reset-password?token={token}"
    content = f"""Hello,

You requested to reset your Luna Health password. Open the link below to set a new one:

{reset_url}

This link expires in 1 hour. If you didn't request it, you can safely ignore this email.

The Luna Health Team
"""
    return await email_service.send_email(
        to_email=to_email,
        subject="Reset your Luna Health password",
        content=content,
    )


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
    # Receiving the reset email proves the person owns the mailbox.
    user.is_email_verified = True
    user.email_verification_token = None
    user.email_verification_expires = None
    db.query(RefreshToken).filter(RefreshToken.user_id == user.id).update({"is_revoked": True})
    db.commit()
    
    return True
