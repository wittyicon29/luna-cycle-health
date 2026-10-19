from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://luna:lunapass@localhost:5432/luna_db"
    SECRET_KEY: str = "your-secret-key-change-in-production"
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
    
    class Config:
        env_file = ".env"

settings = Settings()
