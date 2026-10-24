from datetime import datetime, timedelta, timezone

from app.core.security import hash_token
from app.models.models import RefreshToken, User

EMAIL = "new@gmail.com"
VERIFY_FIRST = "Please verify your email before logging in. Check your inbox for the verification link."
DEAD_LINK = "This link is invalid, expired or already used. If you already chose a password, please log in."


def register(client, **extra):
    body = {"email": EMAIL, "accepted_privacy_policy": True, "confirmed_18_plus": True, **extra}
    return client.post("/api/v1/auth/register", json=body)


def token_of(db):
    return db.query(User).filter(User.email == EMAIL).one().email_verification_token


def test_registering_stores_no_password(client, db, outbox):
    response = register(client)

    assert response.status_code == 201
    assert db.query(User).filter(User.email == EMAIL).one().hashed_password == ""


def test_a_password_sent_by_an_old_client_is_ignored(client, db, outbox):
    register(client, password="attacker-chosen-1")

    user = db.query(User).filter(User.email == EMAIL).one()
    assert user.hashed_password == ""
    login = client.post("/api/v1/auth/login", json={"email": EMAIL, "password": "attacker-chosen-1"})
    assert login.status_code == 403
    assert login.json()["detail"] == VERIFY_FIRST


def test_check_reports_the_email_and_changes_nothing(client, db, outbox):
    register(client)
    token = token_of(db)

    first = client.post("/api/v1/verify/check", json={"token": token})
    second = client.post("/api/v1/verify/check", json={"token": token})

    assert first.status_code == second.status_code == 200
    assert first.json() == {"email": EMAIL}
    user = db.query(User).filter(User.email == EMAIL).one()
    assert user.is_email_verified is False
    assert user.email_verification_token == token


def test_unknown_token_is_rejected(client, outbox):
    check = client.post("/api/v1/verify/check", json={"token": "nope"})
    complete = client.post("/api/v1/verify/complete", json={"token": "nope", "password": "longenough1"})
    assert check.status_code == complete.status_code == 400
    assert check.json()["detail"] == complete.json()["detail"] == DEAD_LINK


def test_expired_token_is_rejected(client, db, outbox):
    register(client)
    user = db.query(User).filter(User.email == EMAIL).one()
    user.email_verification_expires = datetime.now(timezone.utc) - timedelta(minutes=1)
    db.commit()

    assert client.post("/api/v1/verify/check", json={"token": user.email_verification_token}).status_code == 400
    assert client.post("/api/v1/verify/complete",
                       json={"token": user.email_verification_token, "password": "longenough1"}).status_code == 400


def test_complete_sets_the_password_verifies_and_signs_in(client, db, outbox):
    register(client)
    token = token_of(db)

    response = client.post("/api/v1/verify/complete", json={"token": token, "password": "my-new-pass-1"})

    assert response.status_code == 200
    body = response.json()
    assert body["access_token"] and body["refresh_token"]
    status = client.get("/api/v1/auth/status", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert status.status_code == 200
    assert client.post("/api/v1/auth/login", json={"email": EMAIL, "password": "my-new-pass-1"}).status_code == 200
    user = db.query(User).filter(User.email == EMAIL).one()
    assert user.is_email_verified is True
    assert user.email_verification_token is None


def test_complete_is_single_use(client, db, outbox):
    register(client)
    token = token_of(db)
    client.post("/api/v1/verify/complete", json={"token": token, "password": "my-new-pass-1"})

    again = client.post("/api/v1/verify/complete", json={"token": token, "password": "someone-elses-1"})

    assert again.status_code == 400
    assert again.json()["detail"] == DEAD_LINK
    assert client.post("/api/v1/verify/check", json={"token": token}).json()["detail"] == DEAD_LINK
    assert client.post("/api/v1/auth/login", json={"email": EMAIL, "password": "someone-elses-1"}).status_code == 401


def test_short_passwords_are_rejected_and_the_account_stays_unverified(client, db, outbox):
    register(client)
    token = token_of(db)

    response = client.post("/api/v1/verify/complete", json={"token": token, "password": "short"})

    assert response.status_code == 422
    assert db.query(User).filter(User.email == EMAIL).one().is_email_verified is False


def test_refresh_tokens_from_before_verification_are_revoked(client, db, outbox):
    register(client)
    user = db.query(User).filter(User.email == EMAIL).one()
    db.add(RefreshToken(user_id=user.id, token_hash=hash_token("attacker-held"),
                        expires_at=datetime.now(timezone.utc) + timedelta(days=30)))
    db.commit()

    client.post("/api/v1/verify/complete", json={"token": user.email_verification_token, "password": "my-new-pass-1"})

    assert client.post("/api/v1/auth/refresh", json={"refresh_token": "attacker-held"}).status_code == 401


def test_the_old_verify_endpoint_is_gone(client):
    assert client.post("/api/v1/verify/verify", json={"token": "x"}).status_code in (404, 405)


def test_the_pre_registration_attack_gets_the_attacker_nothing(client, db, outbox):
    """Attacker registers the victim's address; the victim opens the link and picks their own password."""
    register(client, password="attacker-knows-this")
    token = token_of(db)

    client.post("/api/v1/verify/complete", json={"token": token, "password": "victims-own-secret-1"})

    assert client.post("/api/v1/auth/login", json={"email": EMAIL, "password": "attacker-knows-this"}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"email": EMAIL, "password": "victims-own-secret-1"}).status_code == 200


def test_unverified_account_with_a_password_gets_403_or_401(client, make_user):
    make_user(email="p@gmail.com", password="password123", verified=False)

    right = client.post("/api/v1/auth/login", json={"email": "p@gmail.com", "password": "password123"})
    wrong = client.post("/api/v1/auth/login", json={"email": "p@gmail.com", "password": "wrong-pass-1"})

    assert right.status_code == 403 and right.json()["detail"] == VERIFY_FIRST
    assert wrong.status_code == 401


def test_a_token_consumed_between_validation_and_claim_is_rejected(client, db, outbox, monkeypatch):
    from app.api import email_verification
    from app.core.database import SessionLocal

    register(client)
    token = token_of(db)
    original = email_verification._unverified_user_for_token

    def consumed_after_validation(session, tok):
        user = original(session, tok)
        other = SessionLocal()
        other.query(User).filter(User.id == user.id).update({"email_verification_token": None})
        other.commit()
        other.close()
        return user

    monkeypatch.setattr(email_verification, "_unverified_user_for_token", consumed_after_validation)

    response = client.post("/api/v1/verify/complete", json={"token": token, "password": "racer-pass-1"})

    assert response.status_code == 400
    assert response.json()["detail"] == DEAD_LINK
    db.expire_all()
    assert db.query(RefreshToken).count() == 0
    assert db.query(User).filter(User.email == EMAIL).one().is_email_verified is False


def test_a_rejected_second_complete_keeps_the_first_session_usable(client, db, outbox):
    register(client)
    token = token_of(db)
    first = client.post("/api/v1/verify/complete", json={"token": token, "password": "my-new-pass-1"}).json()

    second = client.post("/api/v1/verify/complete", json={"token": token, "password": "someone-elses-1"})

    assert second.status_code == 400
    refreshed = client.post("/api/v1/auth/refresh", json={"refresh_token": first["refresh_token"]})
    assert refreshed.status_code == 200


def test_completing_a_password_reset_verifies_an_unverified_account(client, db, make_user):
    user = make_user(email="r@gmail.com", verified=False)
    user.password_reset_token = "reset-tok"
    user.password_reset_expires = datetime.now(timezone.utc) + timedelta(hours=1)
    user.email_verification_token = "ver-tok"
    user.email_verification_expires = datetime.now(timezone.utc) + timedelta(hours=1)
    db.commit()

    reset = client.post("/api/v1/auth/reset-password", json={"token": "reset-tok", "new_password": "brandnewpass1"})

    assert reset.status_code == 200
    assert client.post("/api/v1/auth/login", json={"email": "r@gmail.com", "password": "brandnewpass1"}).status_code == 200
    db.expire_all()
    fresh = db.query(User).filter(User.email == "r@gmail.com").one()
    assert fresh.is_email_verified is True
    assert fresh.email_verification_token is None
    assert fresh.email_verification_expires is None
