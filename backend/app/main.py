from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from .core.database import engine, Base
from .core.config import settings
from .core.limiter import limiter
from .api import auth, periods, questionnaire, analysis, chat, email_verification, consents, account, legal

# Create tables (use Alembic in production)
if settings.APP_ENV == "development":
    Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Luna Health API",
    version="1.0.0",
    docs_url="/docs" if settings.APP_ENV == "development" else None,
    redoc_url="/redoc" if settings.APP_ENV == "development" else None,
)

# Rate limiting
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS
allowed_origins = settings.ALLOWED_ORIGINS.split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/v1")
app.include_router(periods.router, prefix="/api/v1")
app.include_router(questionnaire.router, prefix="/api/v1")
app.include_router(analysis.router, prefix="/api/v1")
app.include_router(chat.router, prefix="/api/v1")
app.include_router(email_verification.router, prefix="/api/v1")
app.include_router(consents.router, prefix="/api/v1")
app.include_router(account.router, prefix="/api/v1")
app.include_router(legal.router)

@app.get("/")
def root():
    return {"message": "Luna Health API", "status": "running", "version": "1.0.0"}

@app.get("/health")
def health_check():
    return {"status": "healthy"}
