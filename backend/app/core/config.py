import base64
import hashlib
from typing import List, Optional

from cryptography.fernet import Fernet
from pydantic import model_validator
from pydantic_settings import BaseSettings

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

    class Config:
        env_file = ".env"

    def _split_keys(self) -> List[str]:
        return [key.strip() for key in self.ENCRYPTION_KEYS.split(",") if key.strip()]

    @model_validator(mode="after")
    def _check_security_settings(self):
        if self.APP_ENV == "production":
            if self.SECRET_KEY == DEFAULT_SECRET_KEY or len(self.SECRET_KEY) < 32:
                raise ValueError(
                    "SECRET_KEY must be a random value of at least 32 characters in production"
                )
            if not self._split_keys():
                raise ValueError("ENCRYPTION_KEYS must be set in production")
        for key in self._split_keys():
            Fernet(key)  # raises ValueError for malformed keys
        return self

    @property
    def encryption_key_list(self) -> List[bytes]:
        keys = self._split_keys()
        if keys:
            return [key.encode() for key in keys]
        # Development/testing fallback only (production is rejected above).
        digest = hashlib.sha256(self.SECRET_KEY.encode()).digest()
        return [base64.urlsafe_b64encode(digest)]


settings = Settings()
