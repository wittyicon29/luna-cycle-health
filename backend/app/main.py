import logging
from typing import Dict, Optional

import redis as redis_sync
from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text
from . import db_migrate
from .core.database import engine, Base
from .core.config import settings
from .core.limiter import limiter
from .api import auth, periods, questionnaire, analysis, chat, email_verification, consents, account, legal, medications, daily_logs, billing

logger = logging.getLogger(__name__)

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

# Billing request bodies carry purchase tokens; their 422s must not echo the input back.
_REDACTED_422_PATHS = frozenset({"/api/v1/billing/verify", "/api/v1/billing/refresh"})


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    if request.url.path.rstrip("/") not in _REDACTED_422_PATHS:
        return await request_validation_exception_handler(request, exc)
    errors = [{k: v for k, v in error.items() if k not in ("input", "ctx")} for error in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(errors)})

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
app.include_router(medications.router, prefix="/api/v1")
app.include_router(daily_logs.router, prefix="/api/v1")
app.include_router(billing.router, prefix="/api/v1")
app.include_router(legal.router)

@app.get("/")
def root():
    return {"message": "Luna Health API", "status": "running", "version": "1.0.0"}

@app.get("/health")
def health_check():
    return {"status": "healthy"}


# One client (and connection pool) per process for the readiness check, keyed by URL.
_redis_clients: Dict[str, redis_sync.Redis] = {}


def _redis_client() -> redis_sync.Redis:
    url = settings.REDIS_URL
    client = _redis_clients.get(url)
    if client is None:
        client = redis_sync.Redis.from_url(url, socket_connect_timeout=2, socket_timeout=2)
        _redis_clients.clear()
        _redis_clients[url] = client
    return client


def _redis_ping() -> None:
    _redis_client().ping()


def _readiness_failure() -> Optional[str]:
    """Return a short reason for the log when not ready (never sent to the client)."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            current = db_migrate.current_revision(conn)
    except Exception as exc:
        return f"database check failed ({type(exc).__name__})"
    if settings.REDIS_URL and settings.APP_ENV != "testing":
        try:
            _redis_ping()
        except Exception as exc:
            return f"redis check failed ({type(exc).__name__})"
    if current is None and settings.APP_ENV in ("development", "testing"):
        return None  # create_all database without Alembic history
    try:
        head = db_migrate.head_revision()
    except Exception as exc:
        return f"revision check failed ({type(exc).__name__})"
    if current != head:
        return "database revision is not at head"
    return None


@app.get("/ready")
def readiness_check():
    failure = _readiness_failure()
    if failure:
        logger.warning("Not ready: %s", failure)
        return JSONResponse(status_code=503, content={"status": "unavailable"})
    return {"status": "ready"}
