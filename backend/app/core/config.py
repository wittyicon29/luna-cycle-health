import base64
import hashlib
import os
from typing import List, Literal, Optional

from cryptography.fernet import Fernet
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_SECRET_KEY = "your-secret-key-change-in-production"


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://luna:lunapass@localhost:5432/luna_db"
    SECRET_KEY: str = DEFAULT_SECRET_KEY
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    REDIS_URL: str = "redis://localhost:6379/0"
    HUGGINGFACE_API_KEY: str = ""
    MEDGEMMA_MODEL: str = "google/medgemma-1.5-4b-it"
    GROQ_API_KEY: str = ""
    QWEN_MODEL: str = "qwen/qwen3-32b"
    APP_ENV: str = "development"
    ALLOWED_ORIGINS: str = "http://localhost:3000"
    GOOGLE_ID_TOKEN_AUDIENCES: str = ""  # comma-separated Web client IDs accepted as the ID-token audience
    SMTP_SERVER: Optional[str] = None
    SMTP_PORT: int = 587
    SMTP_USER: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    SMTP_USE_TLS: bool = True
    SMTP_FROM_EMAIL: Optional[str] = None
    SMTP_FROM_NAME: str = "Luna Health"

    FRONTEND_URL: str = "http://localhost:3000"
    ENCRYPTION_KEYS: str = ""  # comma-separated Fernet keys, newest first
    RATE_LIMIT_ENABLED: bool = True
    AUTH_RATE_LIMIT: str = "10/minute"
    CHAT_RATE_LIMIT: str = "10/minute"
    CHAT_DAILY_LIMIT: int = 20
    PRIVACY_POLICY_VERSION: str = "1.0"
    SUPPORT_EMAIL: str = ""

    BILLING_MODE: Literal["off", "test", "google"] = "off"
    GOOGLE_PLAY_PACKAGE_NAME: str = ""
    GOOGLE_PLAY_SERVICE_ACCOUNT_FILE: str = ""
    BILLING_PRODUCT_IDS: str = ""  # comma-separated Play subscription product ids
    BILLING_REVERIFY_AFTER_HOURS: int = 6
    BILLING_OUTAGE_GRACE_HOURS: int = 24
    # Key for account_token(); empty falls back to SECRET_KEY. Set it so a JWT SECRET_KEY
    # rotation does not change every user's Play obfuscated account id.
    BILLING_ACCOUNT_SECRET: str = ""

    # hide_input_in_errors keeps SECRET_KEY / ENCRYPTION_KEYS / DATABASE_URL out of validation errors.
    model_config = SettingsConfigDict(env_file=".env", hide_input_in_errors=True)

    def _split_keys(self) -> List[str]:
        return [key.strip() for key in self.ENCRYPTION_KEYS.split(",") if key.strip()]

    @model_validator(mode="after")
    def _check_security_settings(self):
        # Only these two environments may use the derived-key fallback; anything else
        # (production, staging, typos, unset) gets the strict production checks.
        if self.APP_ENV not in ("development", "testing"):
            if self.SECRET_KEY == DEFAULT_SECRET_KEY or len(self.SECRET_KEY) < 32:
                raise ValueError(
                    "SECRET_KEY must be a random value of at least 32 characters in production"
                )
            if not self._split_keys():
                raise ValueError("ENCRYPTION_KEYS must be set in production")
            for name in ("SMTP_SERVER", "SMTP_USER", "SMTP_PASSWORD", "SUPPORT_EMAIL"):
                if not getattr(self, name):
                    raise ValueError(f"{name} must be set in production")
        for key in self._split_keys():
            Fernet(key)  # raises ValueError for malformed keys
        return self

    @property
    def billing_product_ids(self) -> List[str]:
        return [p.strip() for p in self.BILLING_PRODUCT_IDS.split(",") if p.strip()]

    @model_validator(mode="after")
    def _check_billing_settings(self):
        if self.BILLING_MODE == "test" and self.APP_ENV not in ("development", "testing"):
            raise ValueError("BILLING_MODE=test is only allowed when APP_ENV is development or testing")
        if self.BILLING_MODE == "google":
            if not self.GOOGLE_PLAY_PACKAGE_NAME:
                raise ValueError("GOOGLE_PLAY_PACKAGE_NAME must be set when BILLING_MODE=google")
            if not self.billing_product_ids:
                raise ValueError("BILLING_PRODUCT_IDS must be set when BILLING_MODE=google")
            path = self.GOOGLE_PLAY_SERVICE_ACCOUNT_FILE
            if not path or not os.path.isfile(path) or not os.access(path, os.R_OK):
                raise ValueError("GOOGLE_PLAY_SERVICE_ACCOUNT_FILE must point to a readable file when BILLING_MODE=google")
        return self

    @property
    def encryption_key_list(self) -> List[bytes]:
        keys = self._split_keys()
        if keys:
            return [key.encode() for key in keys]
        # Development/testing fallback only (other environments are rejected above).
        digest = hashlib.sha256(self.SECRET_KEY.encode()).digest()
        return [base64.urlsafe_b64encode(digest)]


settings = Settings()
