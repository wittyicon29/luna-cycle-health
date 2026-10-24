from datetime import datetime, timedelta, timezone

import pytest

from app.core.config import settings
from app.models.models import RefreshToken, User


def login(client, email, password):
    return client.post("/api/v1/auth/login", json={"email": email, "password": password})


def test_register_sends_verification_email(client, outbox, register_payload):
    response = client.post("/api/v1/auth/register", json=register_payload)

    assert response.status_code == 201
    assert len(outbox) == 1
    assert outbox[0]["to"] == "new@gmail.com"
    assert f"{settings.FRONTEND_URL}/verify-email?token=" in outbox[0]["content"]


def test_verify_email_marks_user_verified(client, db, make_user):
    user = make_user(verified=False)
    user.email_verification_token = "tok-123"
    user.email_verification_expires = datetime.now(timezone.utc) + timedelta(hours=1)
    db.commit()

    response = client.post("/api/v1/verify/verify", json={"token": "tok-123"})

    assert response.status_code == 200
    db.refresh(user)
    assert user.is_email_verified is True


def test_password_reset_round_trip(client, db, make_user, outbox):
    user = make_user()

    response = client.post("/api/v1/auth/request-password-reset", json={"email": user.email})
    assert response.status_code == 200
    db.refresh(user)
    token = user.password_reset_token
    assert token
    assert len(outbox) == 1
    assert f"{settings.FRONTEND_URL}/reset-password?token={token}" in outbox[0]["content"]

    response = client.post(
        "/api/v1/auth/reset-password",
        json={"token": token, "new_password": "brandnewpass1"},
    )
    assert response.status_code == 200
    assert login(client, user.email, "brandnewpass1").status_code == 200
    assert login(client, user.email, "password123").status_code == 401


def test_password_reset_revokes_existing_refresh_tokens(client, db, make_user, outbox):
    user = make_user()
    first_login = login(client, user.email, "password123").json()
    client.post("/api/v1/auth/request-password-reset", json={"email": user.email})
    db.refresh(user)

    client.post(
        "/api/v1/auth/reset-password",
        json={"token": user.password_reset_token, "new_password": "brandnewpass1"},
    )

    response = client.post("/api/v1/auth/refresh", json={"refresh_token": first_login["refresh_token"]})
    assert response.status_code == 401
    assert db.query(RefreshToken).filter(RefreshToken.is_revoked == False).count() == 0  # noqa: E712


def test_google_only_account_cannot_password_login(client, db):
    db.add(User(email="g@gmail.com", hashed_password="", is_email_verified=True))
    db.commit()

    response = login(client, "g@gmail.com", "anything123")

    assert response.status_code == 401


@pytest.mark.parametrize("path", ["/api/v1/verify/resend", "/api/v1/verify/send-verification"])
def test_verification_email_endpoints_accept_json_body(client, make_user, outbox, path):
    user = make_user(verified=False)

    response = client.post(path, json={"email": user.email})

    assert response.status_code == 200
    assert len(outbox) == 1


def test_resend_is_throttled_when_called_twice_quickly(client, make_user, outbox):
    user = make_user(verified=False)

    first = client.post("/api/v1/verify/resend", json={"email": user.email})
    second = client.post("/api/v1/verify/resend", json={"email": user.email})

    assert first.status_code == 200
    assert second.status_code == 429
    assert len(outbox) == 1


def test_register_does_not_issue_tokens(client, outbox, register_payload):
    response = client.post("/api/v1/auth/register", json=register_payload)

    assert response.status_code == 201
    body = response.json()
    assert "access_token" not in body
    assert "refresh_token" not in body
    assert "verify" in body["message"].lower()


def test_signup_requires_email_verification_before_login(client, db, outbox, register_payload):
    client.post("/api/v1/auth/register", json=register_payload)
    credentials = {"email": register_payload["email"], "password": register_payload["password"]}

    assert client.post("/api/v1/auth/login", json=credentials).status_code == 403

    token = db.query(User).filter(User.email == register_payload["email"]).one().email_verification_token
    assert client.post("/api/v1/verify/verify", json={"token": token}).status_code == 200

    login = client.post("/api/v1/auth/login", json=credentials)
    assert login.status_code == 200
    assert "access_token" in login.json()
