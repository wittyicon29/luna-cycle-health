import re
from datetime import datetime, timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.core.security import create_access_token
from app.models.models import Subscription, User
from app.services.billing.account_token import account_token, token_hash

TOKEN = "super-secret-purchase-token-123"


def _h(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}"}


def _sub(user, token=TOKEN, **kw):
    values = dict(user_id=user.id, product_id="luna_ai", purchase_token=token,
                  token_hash=token_hash(token), state="SUBSCRIPTION_STATE_ACTIVE",
                  expiry_time=datetime.utcnow() + timedelta(days=30), auto_renewing=True,
                  acknowledged=True, last_verified_at=datetime.utcnow())
    values.update(kw)
    return Subscription(**values)


def test_round_trip(db, make_user):
    user = make_user()
    db.add(_sub(user))
    db.commit()
    db.expire_all()
    row = db.query(Subscription).one()
    assert row.purchase_token == TOKEN
    assert row.product_id == "luna_ai" and row.auto_renewing is True and row.acknowledged is True
    assert row.created_at is not None and row.updated_at is not None
    assert db.get(User, user.id).subscription.id == row.id


def test_purchase_token_encrypted_at_rest(db, make_user):
    db.add(_sub(make_user()))
    db.commit()
    raw = db.execute(text("select purchase_token from subscriptions")).scalar_one()
    assert TOKEN not in raw
    assert db.execute(text("select token_hash from subscriptions")).scalar_one() == token_hash(TOKEN)


def test_token_hash_unique(db, make_user):
    db.add(_sub(make_user("a@gmail.com")))
    db.commit()
    db.add(_sub(make_user("b@gmail.com")))
    with pytest.raises(IntegrityError):
        db.commit()


def test_one_row_per_user(db, make_user):
    user = make_user()
    db.add(_sub(user))
    db.commit()
    db.add(_sub(user, token="another-token"))
    with pytest.raises(IntegrityError):
        db.commit()


def test_deleting_user_cascades(db, make_user):
    user = make_user()
    db.add(_sub(user))
    db.commit()
    db.delete(user)
    db.commit()
    assert db.query(Subscription).count() == 0


def test_account_token_properties(monkeypatch):
    import uuid
    a, b = uuid.uuid4(), uuid.uuid4()
    t = account_token(a)
    assert re.fullmatch(r"[0-9a-f]{64}", t)
    assert t == account_token(a) and t != account_token(b)
    monkeypatch.setattr(settings, "SECRET_KEY", "a-different-secret-key")
    assert account_token(a) != t


def test_token_hash_is_sha256_hex():
    h = token_hash("abc")
    assert h == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"


def test_export_plan_null_without_subscription(client, make_user):
    body = client.get("/api/v1/account/export", headers=_h(make_user())).json()
    assert body["plan"] is None


def test_export_plan_without_token(client, db, make_user):
    user = make_user()
    expiry = datetime.utcnow() + timedelta(days=3)
    db.add(_sub(user, expiry_time=expiry))
    db.commit()
    response = client.get("/api/v1/account/export", headers=_h(user))
    assert TOKEN not in response.text and token_hash(TOKEN) not in response.text
    plan = response.json()["plan"]
    assert plan == {"active": True, "state": "SUBSCRIPTION_STATE_ACTIVE",
                    "expires_at": expiry.isoformat(), "product_id": "luna_ai"}


def test_export_plan_inactive_when_expired_or_on_hold(client, db, make_user):
    user = make_user()
    db.add(_sub(user, expiry_time=datetime.utcnow() - timedelta(days=1)))
    db.commit()
    assert client.get("/api/v1/account/export", headers=_h(user)).json()["plan"]["active"] is False
    row = db.query(Subscription).one()
    row.expiry_time = datetime.utcnow() + timedelta(days=1)
    row.state = "SUBSCRIPTION_STATE_ON_HOLD"
    db.commit()
    assert client.get("/api/v1/account/export", headers=_h(user)).json()["plan"]["active"] is False
