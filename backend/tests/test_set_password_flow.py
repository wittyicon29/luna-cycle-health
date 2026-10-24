from datetime import datetime, timedelta, timezone

from app.core.security import hash_token
from app.models.models import RefreshToken, User

EMAIL = "new@gmail.com"


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
    assert login.status_code in (401, 403)


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
    assert client.post("/api/v1/verify/check", json={"token": "nope"}).status_code == 400
    assert client.post("/api/v1/verify/complete", json={"token": "nope", "password": "longenough1"}).status_code == 400


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
