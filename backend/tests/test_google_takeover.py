from datetime import datetime, timedelta, timezone

from tests.test_consent import _fake_google

CALLBACK = "/api/v1/auth/google/callback?code=abc"


def _login(client, email, password):
    return client.post("/api/v1/auth/login", json={"email": email, "password": password})


def test_google_signin_takes_over_unverified_password_account(client, db, make_user, monkeypatch):
    user = make_user(email="victim@gmail.com", password="attackerpw1", verified=False)
    user.email_verification_token = "tok"
    user.email_verification_expires = datetime.now(timezone.utc) + timedelta(hours=1)
    user.password_reset_token = "reset"
    user.password_reset_expires = datetime.now(timezone.utc) + timedelta(hours=1)
    db.commit()
    _fake_google(monkeypatch, "victim@gmail.com")

    response = client.post(CALLBACK + "&accepted_privacy_policy=true&confirmed_18_plus=true")

    assert response.status_code == 200
    db.expire_all()
    db.refresh(user)
    assert user.is_email_verified is True
    assert user.hashed_password == ""
    assert user.email_verification_token is None
    assert user.email_verification_expires is None
    assert user.password_reset_token is None
    assert user.password_reset_expires is None
    assert _login(client, "victim@gmail.com", "attackerpw1").status_code == 401


def test_google_signin_keeps_password_of_verified_account(client, db, make_user, monkeypatch):
    user = make_user(email="ok@gmail.com", password="mypassword1", verified=True)
    hashed = user.hashed_password
    _fake_google(monkeypatch, "ok@gmail.com")

    assert client.post(CALLBACK).status_code == 200

    db.expire_all()
    db.refresh(user)
    assert user.hashed_password == hashed
    assert _login(client, "ok@gmail.com", "mypassword1").status_code == 200


def test_google_new_user_flow_unchanged(client, db, monkeypatch):
    from app.models.models import User

    _fake_google(monkeypatch, "fresh@gmail.com")

    response = client.post(CALLBACK + "&accepted_privacy_policy=true&confirmed_18_plus=true")

    assert response.status_code == 200
    user = db.query(User).filter(User.email == "fresh@gmail.com").one()
    assert user.is_email_verified is True
    assert user.hashed_password == ""


def _refresh_token_for(db, user, raw="known-refresh-token"):
    from app.core.security import hash_token
    from app.models.models import RefreshToken

    db.add(RefreshToken(
        user_id=user.id,
        token_hash=hash_token(raw),
        expires_at=datetime.now(timezone.utc) + timedelta(days=30),
    ))
    db.commit()
    return raw


def test_takeover_revokes_existing_refresh_tokens(client, db, make_user, monkeypatch):
    user = make_user(email="victim@gmail.com", verified=False)
    raw = _refresh_token_for(db, user)
    _fake_google(monkeypatch, "victim@gmail.com")

    assert client.post(CALLBACK + "&accepted_privacy_policy=true&confirmed_18_plus=true").status_code == 200

    response = client.post("/api/v1/auth/refresh", json={"refresh_token": raw})
    assert response.status_code == 401


def test_unverified_google_email_is_refused(client, db, monkeypatch):
    from app.models.models import User

    _fake_google(monkeypatch, "fresh@gmail.com", verified_email=False)

    response = client.post(CALLBACK + "&accepted_privacy_policy=true&confirmed_18_plus=true")

    assert response.status_code == 400
    assert "Your Google email is not verified" in response.json()["detail"]
    assert db.query(User).count() == 0


def test_refresh_refuses_unverified_user_without_rotating(client, db, make_user):
    from app.models.models import RefreshToken

    user = make_user(email="unv@gmail.com", verified=False)
    raw = _refresh_token_for(db, user)

    response = client.post("/api/v1/auth/refresh", json={"refresh_token": raw})

    assert response.status_code == 403
    assert response.json()["detail"] == "Please verify your email to continue."
    assert db.query(RefreshToken).count() == 1
    assert db.query(RefreshToken).one().is_revoked is False


def test_refresh_still_works_for_verified_user(client, db, make_user):
    user = make_user(email="ver@gmail.com", verified=True)
    raw = _refresh_token_for(db, user)

    assert client.post("/api/v1/auth/refresh", json={"refresh_token": raw}).status_code == 200


def test_google_takeover_needs_the_owners_own_consent(client, db, make_user, monkeypatch):
    from app.models.models import ConsentRecord
    user = make_user(email="own@gmail.com", password="attackerpw1", verified=False)
    _fake_google(monkeypatch, "own@gmail.com")

    refused = client.post(CALLBACK)

    assert refused.status_code == 400
    assert refused.json()["detail"]["code"] == "consent_required"
    db.expire_all()
    db.refresh(user)
    assert user.is_email_verified is False

    ok = client.post(CALLBACK + "&accepted_privacy_policy=true&confirmed_18_plus=true")

    assert ok.status_code == 200
    purposes = {r.purpose for r in db.query(ConsentRecord).filter(ConsentRecord.user_id == user.id)}
    assert {"terms_privacy", "age_18_plus"} <= purposes
