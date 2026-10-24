from datetime import datetime, timedelta, timezone

from app.models.models import User


def test_verify_twice_with_same_token_succeeds(client, db, make_user):
    from datetime import datetime, timedelta, timezone

    user = make_user(email="v@gmail.com", verified=False)
    user.email_verification_token = "tok123"
    user.email_verification_expires = datetime.now(timezone.utc) + timedelta(hours=1)
    db.commit()

    first = client.post("/api/v1/verify/verify", json={"token": "tok123"})
    second = client.post("/api/v1/verify/verify", json={"token": "tok123"})

    assert first.status_code == 200
    assert second.status_code == 200
    assert "already verified" in second.json()["message"]
    db.expire_all()
    assert db.query(User).filter(User.email == "v@gmail.com").one().is_email_verified is True


def test_unknown_token_is_rejected(client):
    assert client.post("/api/v1/verify/verify", json={"token": "nope"}).status_code == 400


def test_resend_only_issues_token_for_unverified(client, db, make_user, outbox):
    verified = make_user(email="a@gmail.com", verified=True)
    unverified = make_user(email="b@gmail.com", verified=False)

    client.post("/api/v1/verify/resend", json={"email": "a@gmail.com"})
    client.post("/api/v1/verify/resend", json={"email": "b@gmail.com"})

    db.expire_all()
    db.refresh(verified)
    db.refresh(unverified)
    assert verified.email_verification_token is None
    assert unverified.email_verification_token


def _token_user(db, make_user, delta=timedelta(hours=1), verified=False):
    user = make_user(email="t@gmail.com", verified=verified)
    user.email_verification_token = "tok-x"
    user.email_verification_expires = datetime.now(timezone.utc) + delta
    db.commit()
    return user


def _refresh_token_for(db, user, raw):
    from app.core.security import hash_token
    from app.models.models import RefreshToken

    db.add(RefreshToken(user_id=user.id, token_hash=hash_token(raw),
                        expires_at=datetime.now(timezone.utc) + timedelta(days=30)))
    db.commit()


def test_expired_token_is_rejected(client, db, make_user):
    _token_user(db, make_user, delta=timedelta(hours=-1))

    assert client.post("/api/v1/verify/verify", json={"token": "tok-x"}).status_code == 400


def test_first_verification_revokes_existing_refresh_tokens(client, db, make_user):
    user = _token_user(db, make_user)
    _refresh_token_for(db, user, "old-raw")

    assert client.post("/api/v1/verify/verify", json={"token": "tok-x"}).status_code == 200

    assert client.post("/api/v1/auth/refresh", json={"refresh_token": "old-raw"}).status_code == 401


def test_repeat_verification_does_not_revoke_tokens(client, db, make_user):
    user = _token_user(db, make_user)
    assert client.post("/api/v1/verify/verify", json={"token": "tok-x"}).status_code == 200
    _refresh_token_for(db, user, "new-raw")

    assert client.post("/api/v1/verify/verify", json={"token": "tok-x"}).status_code == 200

    assert client.post("/api/v1/auth/refresh", json={"refresh_token": "new-raw"}).status_code == 200
