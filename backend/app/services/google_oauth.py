from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime, timezone, timedelta
from ..models.models import User, RefreshToken
from .consent_service import add_consent
from ..core.security import create_access_token, create_refresh_token, hash_token
import httpx
import os
from typing import Optional, Dict

class GoogleOAuthService:
    def __init__(self):
        self.client_id = os.getenv("GOOGLE_CLIENT_ID")
        self.client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
        self.redirect_uri = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:3000/auth/google/callback")
        
    def get_google_auth_url(self) -> str:
        """Generate Google OAuth authorization URL."""
        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "access_type": "offline",
            "prompt": "consent"
        }
        
        base_url = "https://accounts.google.com/o/oauth2/v2/auth"
        query_string = "&".join([f"{k}={v}" for k, v in params.items()])
        return f"{base_url}?{query_string}"
    
    async def exchange_code_for_token(self, code: str) -> Dict:
        """Exchange authorization code for access token."""
        token_url = "https://oauth2.googleapis.com/token"
        
        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "code": code,
            "redirect_uri": self.redirect_uri,
            "grant_type": "authorization_code"
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(token_url, data=data)
            
            if response.status_code != 200:
                raise HTTPException(
                    status_code=400, 
                    detail="Failed to exchange authorization code"
                )
            
            return response.json()
    
    async def get_user_info(self, access_token: str) -> Dict:
        """Get user information from Google."""
        user_info_url = "https://www.googleapis.com/oauth2/v2/userinfo"
        
        headers = {"Authorization": f"Bearer {access_token}"}
        
        async with httpx.AsyncClient() as client:
            response = await client.get(user_info_url, headers=headers)
            
            if response.status_code != 200:
                raise HTTPException(
                    status_code=400,
                    detail="Failed to get user information from Google"
                )
            
            return response.json()
    
    async def authenticate_google_user(
        self,
        code: str,
        db: Session,
        accepted_privacy_policy: bool = False,
        confirmed_18_plus: bool = False,
    ) -> Dict:
        """Authenticate user with Google OAuth code."""
        # Exchange code for tokens
        token_data = await self.exchange_code_for_token(code)
        access_token = token_data.get("access_token")
        
        # Get user info
        user_info = await self.get_user_info(access_token)
        email = user_info.get("email")

        if user_info.get("verified_email") is not True:
            raise HTTPException(status_code=400, detail="Your Google email is not verified")
        
        if not email:
            raise HTTPException(
                status_code=400,
                detail="Could not get email from Google"
            )
        
        return await self._sign_in_verified_email(
            email, db, accepted_privacy_policy, confirmed_18_plus
        )

    async def authenticate_google_id_token(
        self,
        id_token: str,
        db: Session,
        accepted_privacy_policy: bool = False,
        confirmed_18_plus: bool = False,
    ) -> Dict:
        """Authenticate a user with a Google ID token obtained by the native app."""
        from .google_id_token import verify_google_id_token

        claims = await verify_google_id_token(id_token)
        email = claims.get("email")
        if claims.get("email_verified") is not True or not isinstance(email, str) or not email:
            raise HTTPException(status_code=400, detail="Google sign-in could not be verified")
        return await self._sign_in_verified_email(
            email, db, accepted_privacy_policy, confirmed_18_plus
        )

    async def _sign_in_verified_email(
        self,
        email: str,
        db: Session,
        accepted_privacy_policy: bool,
        confirmed_18_plus: bool,
    ) -> Dict:
        # Validate Gmail address
        if not email.endswith("@gmail.com"):
            raise HTTPException(
                status_code=400,
                detail="Only Gmail addresses are supported"
            )
        
        # Find or create user
        user = db.query(User).filter(User.email == email).first()
        
        if not user:
            if accepted_privacy_policy is not True or confirmed_18_plus is not True:
                raise HTTPException(
                    status_code=400,
                    detail={"code": "consent_required", "purposes": ["terms_privacy", "age_18_plus"]},
                )
            # Create new user
            user = User(
                email=email,
                hashed_password="",  # No password for OAuth users
                is_email_verified=True,  # Google emails are pre-verified
                default_cycle_length=28,
                has_completed_questionnaire=False
            )
            try:
                # User and both consent records are committed together or not at all.
                db.add(user)
                db.flush()
                add_consent(db, user.id, "terms_privacy", True)
                add_consent(db, user.id, "age_18_plus", True)
                db.commit()
            except Exception:
                db.rollback()
                raise
            db.refresh(user)
        elif not user.is_email_verified:
            # Consent recorded at pre-registration was given by a third party; the owner gives it now.
            if accepted_privacy_policy is not True or confirmed_18_plus is not True:
                raise HTTPException(
                    status_code=400,
                    detail={"code": "consent_required", "purposes": ["terms_privacy", "age_18_plus"]},
                )
            # Google just proved ownership of this address. Any password set on an
            # unverified account was chosen by someone who never proved it, so drop it.
            user.is_email_verified = True
            user.hashed_password = ""
            user.email_verification_token = None
            user.email_verification_expires = None
            user.password_reset_token = None
            user.password_reset_expires = None
            # Refresh tokens held by whoever pre-registered this address must die too.
            db.query(RefreshToken).filter(RefreshToken.user_id == user.id).update({"is_revoked": True})
            add_consent(db, user.id, "terms_privacy", True)
            add_consent(db, user.id, "age_18_plus", True)
            db.commit()
            db.refresh(user)
        
        # Create JWT tokens
        jwt_access_token = create_access_token({"sub": str(user.id)})
        refresh_token_raw = create_refresh_token()
        
        # Store refresh token hash
        refresh_token_db = RefreshToken(
            user_id=user.id,
            token_hash=hash_token(refresh_token_raw),
            expires_at=datetime.now(timezone.utc) + timedelta(days=30)
        )
        db.add(refresh_token_db)
        db.commit()
        
        return {
            "access_token": jwt_access_token,
            "refresh_token": refresh_token_raw,
            "token_type": "bearer",
            "user": {
                "email": user.email,
                "is_email_verified": user.is_email_verified,
                "has_completed_questionnaire": user.has_completed_questionnaire
            }
        }

# Global instance
google_oauth_service = GoogleOAuthService()
