from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from .config import Settings, settings


def engine_options(url: str, config: Settings = settings) -> dict:
    options = {"pool_pre_ping": True}
    # Keep bound values (health data, tokens) out of SQLAlchemy exception messages and logs.
    if config.APP_ENV not in ("development", "testing"):
        options["hide_parameters"] = True
    # SQLite (tests, local dev) keeps SQLAlchemy's default pool; its in-memory
    # SingletonThreadPool rejects pool_size/max_overflow.
    if make_url(url).get_backend_name() != "sqlite":
        options.update(
            pool_size=config.DB_POOL_SIZE,
            max_overflow=config.DB_MAX_OVERFLOW,
            pool_recycle=config.DB_POOL_RECYCLE_SECONDS,
        )
    if make_url(url).get_backend_name() == "postgresql":
        # Fail fast (and let /ready report it) instead of hanging when Postgres is unreachable.
        options["connect_args"] = {"connect_timeout": 5}
    return options


engine = create_engine(settings.DATABASE_URL, **engine_options(settings.DATABASE_URL))
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
