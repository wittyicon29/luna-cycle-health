import os

os.environ["APP_ENV"] = "testing"
os.environ["DATABASE_URL"] = "sqlite:///./test.db"
os.environ["SECRET_KEY"] = "test-secret-key"
os.environ["AUTH_RATE_LIMIT"] = "5/minute"
os.environ["CHAT_RATE_LIMIT"] = "50/minute"

import pytest
from fastapi.testclient import TestClient

from app.core.database import Base, SessionLocal, engine
from app.core.limiter import limiter
from app.core.security import create_access_token, get_password_hash
from app.main import app
from app.models.models import User


@pytest.fixture(autouse=True)
def fresh_database():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    limiter.reset()
    yield


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def make_user(db):
    def _make(email="user@gmail.com", password="password123", verified=True):
        user = User(
            email=email,
            hashed_password=get_password_hash(password),
            is_email_verified=verified,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user

    return _make


@pytest.fixture
def auth_headers(make_user):
    user = make_user()
    token = create_access_token({"sub": str(user.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def outbox(monkeypatch):
    sent = []

    async def fake_send_email(to_email, subject, content, is_html=False):
        sent.append({"to": to_email, "subject": subject, "content": content})
        return True

    monkeypatch.setattr("app.services.email_service.send_email", fake_send_email)
    monkeypatch.setattr("app.api.auth.send_email", fake_send_email)
    monkeypatch.setattr("app.api.email_verification.send_email", fake_send_email)
    return sent


@pytest.fixture
def register_payload():
    return {"email": "new@gmail.com", "password": "password123"}
