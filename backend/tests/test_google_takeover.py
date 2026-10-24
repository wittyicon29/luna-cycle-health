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

    response = client.post(CALLBACK)

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
