from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks, Query, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone
from ..core.database import get_db
from ..core.config import settings
from ..core.limiter import limiter
from ..core.security import (
    verify_password, get_password_hash, create_access_token, 
    decode_access_token, create_refresh_token, hash_token
)
from ..models.models import User, RefreshToken
from ..schemas.schemas import (
    UserCreate, UserLogin, Token, RegisterResponse, RefreshTokenRequest,
    PasswordResetRequest, PasswordResetConfirm
)
from ..services.auth_service import (
    send_password_reset_email,
    create_password_reset_token,
    reset_password as apply_password_reset,
)
from ..services.email_service import send_email
from ..services.consent_service import add_consent
from ..services.google_oauth import google_oauth_service
from pydantic import BaseModel

class UserStatus(BaseModel):
    email: str
    has_completed_questionnaire: bool
    is_email_verified: bool
    created_at: datetime

router = APIRouter(prefix="/auth", tags=["Authentication"])
security = HTTPBearer()

@router.post("/register", response_model=RegisterResponse, status_code=201)
@limiter.limit(settings.AUTH_RATE_LIMIT)
def register(request: Request, user: UserCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    existing_user = db.query(User).filter(User.email == user.email).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Create user with email verification required
    from ..api.email_verification import generate_verification_token
    verification_token = generate_verification_token()
    
    new_user = User(
        email=user.email, 
        hashed_password="",  # chosen later, when the email owner opens the verification link
        is_email_verified=False,  # Require email verification
        email_verification_token=verification_token,
        email_verification_expires=datetime.now(timezone.utc) + timedelta(hours=24),
        default_cycle_length=28
    )
    try:
        # User and both consent records are committed together or not at all.
        db.add(new_user)
        db.flush()
        add_consent(db, new_user.id, "terms_privacy", True)
        add_consent(db, new_user.id, "age_18_plus", True)
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(new_user)
    
    # Send verification email
    from ..api.email_verification import create_verification_email
    email_content = create_verification_email(verification_token, new_user.email)
    background_tasks.add_task(
        send_email,
        to_email=new_user.email,
        subject="Verify Your Luna Health Account",
        content=email_content
    )
    
    return {"message": "Registration successful! Please check your email to verify your account."}

@router.post("/login", response_model=Token)
@limiter.limit(settings.AUTH_RATE_LIMIT)
def login(request: Request, user: UserLogin, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.email == user.email).first()
    if db_user and not db_user.is_email_verified and not db_user.hashed_password:
        # Registered but the person has not chosen a password yet.
        raise HTTPException(
            status_code=403,
            detail="Please verify your email before logging in. Check your inbox for the verification link."
        )
    if not db_user or not verify_password(user.password, db_user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    # Check email verification
    if not db_user.is_email_verified:
        raise HTTPException(
            status_code=403, 
            detail="Please verify your email before logging in. Check your inbox for the verification link."
        )
    
    # Create tokens
    access_token = create_access_token({"sub": str(db_user.id)})
    refresh_token_raw = create_refresh_token()
    
    # Store refresh token hash
    refresh_token_db = RefreshToken(
        user_id=db_user.id,
        token_hash=hash_token(refresh_token_raw),
        expires_at=datetime.now(timezone.utc) + timedelta(days=30)
    )
    db.add(refresh_token_db)
    db.commit()
    
    # Send login alert email
    from ..services.email_service import send_login_alert
    
    login_time = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    background_tasks.add_task(
        send_login_alert,
        to_email=db_user.email,
        login_time=login_time
    )
    
    return {
        "access_token": access_token,
        "refresh_token": refresh_token_raw,
        "token_type": "bearer"
    }

@router.post("/request-password-reset")
@limiter.limit(settings.AUTH_RATE_LIMIT)
def request_password_reset(request: Request, payload: PasswordResetRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Request password reset."""
    token = create_password_reset_token(db, payload.email)

    if token:
        background_tasks.add_task(
            send_password_reset_email,
            to_email=payload.email,
            token=token
        )

    # Always return success to prevent email enumeration
    return {"message": "If an account with this email exists, a password reset link has been sent."}

@router.post("/reset-password")
@limiter.limit(settings.AUTH_RATE_LIMIT)
def reset_password(request: Request, payload: PasswordResetConfirm, db: Session = Depends(get_db)):
    """Reset password with token."""
    if apply_password_reset(db, payload.token, payload.new_password):
        return {"message": "Password reset successfully! You can now log in."}
    else:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

@router.post("/refresh", response_model=Token)
@limiter.limit(settings.AUTH_RATE_LIMIT)
def refresh(request: Request, payload: RefreshTokenRequest, db: Session = Depends(get_db)):
    token_hash = hash_token(payload.refresh_token)
    
    # Find and validate refresh token
    db_token = db.query(RefreshToken).filter(
        RefreshToken.token_hash == token_hash,
        RefreshToken.is_revoked == False,
        RefreshToken.expires_at > datetime.now(timezone.utc)
    ).first()
    
    if not db_token:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")
    
    owner = db.query(User).filter(User.id == db_token.user_id).first()
    if not owner or not owner.is_email_verified:
        raise HTTPException(status_code=403, detail="Please verify your email to continue.")
    
    # Revoke old token
    db_token.is_revoked = True
    
    # Create new tokens
    access_token = create_access_token({"sub": str(db_token.user_id)})
    new_refresh_token_raw = create_refresh_token()
    
    # Store new refresh token
    new_refresh_token_db = RefreshToken(
        user_id=db_token.user_id,
        token_hash=hash_token(new_refresh_token_raw),
        expires_at=datetime.now(timezone.utc) + timedelta(days=30)
    )
    db.add(new_refresh_token_db)
    db.commit()
    
    return {
        "access_token": access_token,
        "refresh_token": new_refresh_token_raw,
        "token_type": "bearer"
    }

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security), db: Session = Depends(get_db)):
    payload = decode_access_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    user_id = payload.get("sub")
    # Convert string UUID to UUID object for SQLAlchemy
    from uuid import UUID
    try:
        user_id_uuid = UUID(user_id) if isinstance(user_id, str) else user_id
    except (ValueError, AttributeError):
        raise HTTPException(status_code=401, detail="Invalid user ID")
    
    user = db.query(User).filter(User.id == user_id_uuid).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if not user.is_email_verified:
        raise HTTPException(status_code=403, detail="Please verify your email to continue.")
    
    return user

@router.get("/status", response_model=UserStatus)
def get_auth_status(current_user: User = Depends(get_current_user)):
    """Get current user's authentication status including questionnaire completion."""
    return UserStatus(
        email=current_user.email,
        has_completed_questionnaire=current_user.has_completed_questionnaire,
        is_email_verified=current_user.is_email_verified,
        created_at=current_user.created_at
    )

@router.get("/google/auth-url")
def get_google_auth_url():
    """Get Google OAuth authorization URL."""
    auth_url = google_oauth_service.get_google_auth_url()
    return {"auth_url": auth_url}

@router.post("/google/callback")
@limiter.limit(settings.AUTH_RATE_LIMIT)
async def google_oauth_callback(
    request: Request,
    code: str = Query(..., description="Authorization code from Google"),
    accepted_privacy_policy: bool = Query(False),
    confirmed_18_plus: bool = Query(False),
    db: Session = Depends(get_db)
):
    """Handle Google OAuth callback."""
    try:
        result = await google_oauth_service.authenticate_google_user(
            code, db, accepted_privacy_policy, confirmed_18_plus
        )
        return result
    except HTTPException as e:
        if isinstance(e.detail, dict):
            raise  # structured errors (e.g. consent_required) must reach the client intact
        raise HTTPException(
            status_code=400,
            detail=f"Google authentication failed: {e.detail}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Google authentication failed: {str(e)}"
        )
