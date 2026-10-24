from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.security import hash_token
from app.models.models import RefreshToken, User

RAW = "known-raw-refresh-token"


def make_token(db, user, raw=RAW):
    row = RefreshToken(
        user_id=user.id,
        token_hash=hash_token(raw),
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    )
    db.add(row)
    db.commit()
    return row.id


def refresh(client, raw=RAW):
    return client.post("/api/v1/auth/refresh", json={"refresh_token": raw})


def test_same_token_twice_second_is_rejected(client, db, make_user):
    make_token(db, make_user())

    first = refresh(client)
    second = refresh(client)

    assert first.status_code == 200
    assert second.status_code == 401


def test_token_revoked_between_lookup_and_rotation_is_not_rotated(client, db, make_user, monkeypatch):
    token_id = make_token(db, make_user())
    original_query = Session.query
    fired = []

    def racing_query(self, *entities, **kwargs):
        # The owner lookup happens after the token row was loaded and before
        # the rotation: revoke the token from a second session right here.
        if entities and entities[0] is User and not fired:
            fired.append(True)
            other = SessionLocal()
            try:
                other.query(RefreshToken).filter(RefreshToken.id == token_id).update({"is_revoked": True})
                other.commit()
            finally:
                other.close()
        return original_query(self, *entities, **kwargs)

    monkeypatch.setattr(Session, "query", racing_query)

    response = refresh(client)

    monkeypatch.undo()
    assert fired
    assert response.status_code == 401
    assert "access_token" not in response.json()
    db.expire_all()
    assert db.query(RefreshToken).count() == 1


def test_unverified_owner_token_is_not_consumed(client, db, make_user):
    make_token(db, make_user(verified=False))

    response = refresh(client)

    assert response.status_code == 403
    db.expire_all()
    assert db.query(RefreshToken).one().is_revoked is False
