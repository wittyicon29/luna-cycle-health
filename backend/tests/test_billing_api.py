"""Billing endpoints: status, verify (binding, replay, ack), refresh, rate limits, deletion."""
from datetime import datetime, timedelta

import pytest
from sqlalchemy import text

from app.core.config import settings
from app.core.security import create_access_token
from app.models.models import Subscription
from app.services.billing import entitlement as entitlement_module
from app.services.billing.account_token import account_token, token_hash
from app.services.billing.verifier import SubscriptionInfo, TestVerifier, VerifierError, set_verifier_for_tests

NOW = datetime(2026, 11, 1, 12, 0, 0)
H = timedelta(hours=1)
STATUS, VERIFY, REFRESH = "/api/v1/billing/status", "/api/v1/billing/verify", "/api/v1/billing/refresh"
MONTHLY = "luna_ai_monthly"


def _h(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}"}


def make_token(user=None, *, product=MONTHLY, state="ACTIVE", expiry=NOW + 30 * 24 * H, account=None, unacked=False):
    acct = account if account is not None else account_token(user.id)
    return f"test:{product}:{state}:{expiry.isoformat()}:{acct}" + (":unacked" if unacked else "")


@pytest.fixture
def verifier(monkeypatch):
    monkeypatch.setattr(settings, "BILLING_MODE", "test")
    monkeypatch.setattr(settings, "BILLING_PRODUCT_IDS", "luna_ai_monthly, luna_ai_yearly")
    monkeypatch.setattr(entitlement_module, "utcnow", lambda: NOW)
    fake = TestVerifier()
    set_verifier_for_tests(fake)
    entitlement_module.reset_cooldowns()
    yield fake
    set_verifier_for_tests(None)
    entitlement_module.reset_cooldowns()


def verify(client, user, token, product=MONTHLY):
    return client.post(VERIFY, json={"purchase_token": token, "product_id": product}, headers=_h(user))


def rows(db):
    db.expire_all()
    return db.query(Subscription).all()


# --- off mode --------------------------------------------------------------------------------

def test_status_in_off_mode_is_not_gated(client, make_user):
    user = make_user()
    body = client.get(STATUS, headers=_h(user)).json()
    assert body["enabled"] is False and body["active"] is False and body["plan"] == "free"


def test_verify_in_off_mode_is_refused_and_stores_nothing(client, make_user, db):
    user = make_user()
    response = verify(client, user, make_token(user))
    assert response.status_code == 400
    assert rows(db) == []


def test_status_requires_authentication(client):
    assert client.get(STATUS).status_code == 403


# --- verify ----------------------------------------------------------------------------------

def test_verify_happy_path_stores_an_encrypted_token_and_returns_active(client, make_user, db, verifier):
    user = make_user()
    token = make_token(user)
    response = verify(client, user, token)

    assert response.status_code == 200
    body = response.json()
    assert body["enabled"] is True and body["active"] is True and body["plan"] == "ai"
    assert body["state"] == "SUBSCRIPTION_STATE_ACTIVE" and body["product_id"] == MONTHLY
    assert body["account_token"] == account_token(user.id)
    assert token not in response.text

    [sub] = rows(db)
    assert sub.user_id == user.id and sub.purchase_token == token and sub.token_hash == token_hash(token)
    assert sub.acknowledged is True and sub.last_verified_at == NOW
    raw = db.execute(text("SELECT purchase_token FROM subscriptions")).scalar()
    assert token not in raw and account_token(user.id) not in raw


def test_already_acknowledged_purchase_is_not_acknowledged_again(client, make_user, verifier):
    user = make_user()
    assert verify(client, user, make_token(user)).status_code == 200
    assert verifier.ack_calls == []


def test_unacknowledged_purchase_is_acknowledged_once(client, make_user, db, verifier):
    user = make_user()
    token = make_token(user, unacked=True)

    assert verify(client, user, token).status_code == 200
    assert verify(client, user, token).status_code == 200

    assert verifier.ack_calls == [(token, MONTHLY)]
    [sub] = rows(db)
    assert sub.acknowledged is True


def test_failed_acknowledge_stores_nothing_and_verify_can_be_retried(client, make_user, db, verifier):
    user = make_user()
    token = make_token(user, unacked=True)
    verifier.fail_ack = "network"

    response = verify(client, user, token)
    assert response.status_code == 502
    assert response.json()["detail"] == "Could not confirm the purchase with Google Play. Try again."
    assert token not in response.text
    assert rows(db) == []

    verifier.fail_ack = None
    assert verify(client, user, token).status_code == 200
    assert len(rows(db)) == 1


def test_same_user_reposting_the_same_token_is_idempotent(client, make_user, db, verifier):
    user = make_user()
    token = make_token(user)
    first = verify(client, user, token).json()
    second = verify(client, user, token)
    assert second.status_code == 200 and second.json() == first
    assert len(rows(db)) == 1


def test_a_new_subscription_replaces_the_previous_row(client, make_user, db, verifier):
    user = make_user()
    old = make_token(user, expiry=NOW + 5 * 24 * H)
    new = make_token(user, product="luna_ai_yearly", expiry=NOW + 365 * 24 * H)
    assert verify(client, user, old).status_code == 200

    response = verify(client, user, new, product="luna_ai_yearly")

    assert response.status_code == 200 and response.json()["product_id"] == "luna_ai_yearly"
    [sub] = rows(db)
    assert sub.token_hash == token_hash(new) and sub.purchase_token == new
    assert sub.expiry_time == NOW + 365 * 24 * H


def test_the_old_token_can_be_relinked_after_being_replaced(client, make_user, db, verifier):
    user = make_user()
    a, b = make_token(user, expiry=NOW + 5 * 24 * H), make_token(user, expiry=NOW + 6 * 24 * H)
    for token in (a, b, a):
        assert verify(client, user, token).status_code == 200
    [sub] = rows(db)
    assert sub.token_hash == token_hash(a)


def test_token_of_another_user_is_rejected_and_their_entitlement_is_unchanged(client, make_user, db, verifier):
    alice, bob = make_user("alice@gmail.com"), make_user("bob@gmail.com")
    token = make_token(alice)
    assert verify(client, alice, token).status_code == 200
    before = rows(db)[0]
    snapshot = (before.user_id, before.token_hash, before.state, before.expiry_time, before.last_verified_at)
    calls = verifier.get_calls

    response = verify(client, bob, token)

    assert response.status_code == 409
    assert response.json()["detail"] == "This purchase is already linked to another account"
    assert "alice" not in response.text and str(alice.id) not in response.text and token not in response.text
    [after] = rows(db)
    assert (after.user_id, after.token_hash, after.state, after.expiry_time, after.last_verified_at) == snapshot
    assert verifier.get_calls == calls  # rejected before asking Google
    assert client.get(STATUS, headers=_h(bob)).json()["active"] is False


def test_foreign_account_id_is_rejected(client, make_user, db, verifier):
    alice, bob = make_user("alice@gmail.com"), make_user("bob@gmail.com")
    response = verify(client, bob, make_token(alice))  # bought under Alice's account token
    assert response.status_code == 409
    assert response.json()["detail"] == "This purchase belongs to a different account"
    assert rows(db) == [] and verifier.ack_calls == []


def test_missing_account_id_is_rejected(client, make_user, db, verifier):
    user = make_user()
    response = verify(client, user, make_token(user, account="", unacked=True))
    assert response.status_code == 409
    assert response.json()["detail"] == "This purchase belongs to a different account"
    assert rows(db) == [] and verifier.ack_calls == []


def test_product_that_is_not_offered_is_rejected(client, make_user, db, verifier):
    user = make_user()
    response = verify(client, user, make_token(user, product="luna_ai_weekly"), product="luna_ai_weekly")
    assert response.status_code == 409
    assert rows(db) == [] and verifier.ack_calls == []


def test_purchase_for_a_different_product_than_requested_is_rejected(client, make_user, db, verifier):
    user = make_user()
    response = verify(client, user, make_token(user, product="luna_ai_yearly"), product=MONTHLY)
    assert response.status_code == 409
    assert rows(db) == []


def test_inactive_purchase_is_not_stored_or_acknowledged(client, make_user, db, verifier):
    user = make_user()
    for state, expiry in [("EXPIRED", NOW - H), ("PENDING", NOW + 24 * H), ("ACTIVE", NOW - H)]:
        response = verify(client, user, make_token(user, state=state, expiry=expiry, unacked=True))
        assert response.status_code == 409, state
    assert rows(db) == [] and verifier.ack_calls == []


def test_inactive_purchase_does_not_replace_an_active_one(client, make_user, db, verifier):
    user = make_user()
    good = make_token(user)
    verify(client, user, good)
    assert verify(client, user, make_token(user, state="EXPIRED", expiry=NOW - H)).status_code == 409
    [sub] = rows(db)
    assert sub.token_hash == token_hash(good)


def test_wrong_package_name_is_rejected(client, make_user, db, monkeypatch, verifier):
    user = make_user()
    monkeypatch.setattr(settings, "BILLING_MODE", "google")
    monkeypatch.setattr(settings, "GOOGLE_PLAY_PACKAGE_NAME", "app.luna.health")

    class OtherPackage:
        async def get(self, token):
            return SubscriptionInfo(MONTHLY, "SUBSCRIPTION_STATE_ACTIVE", NOW + 24 * 30 * H, True, True,
                                    account_token(user.id), "com.someone.else")

        async def acknowledge(self, token, product_id):
            raise AssertionError("must not acknowledge")

    set_verifier_for_tests(OtherPackage())
    assert verify(client, user, "opaque-google-token").status_code == 409
    assert rows(db) == []


def test_verifier_outage_during_verify_is_a_retryable_error(client, make_user, db, verifier):
    user = make_user()
    token = make_token(user)
    verifier.fail_get = "network"
    response = verify(client, user, token)
    assert response.status_code == 503 and token not in response.text
    assert rows(db) == []


@pytest.mark.parametrize("kind", ["invalid", "revoked"])
def test_unverifiable_token_is_rejected(client, make_user, db, verifier, kind):
    user = make_user()
    verifier.fail_get = kind
    token = make_token(user)
    response = verify(client, user, token)
    assert response.status_code == 400 and token not in response.text
    assert rows(db) == []


def test_malformed_test_token_is_rejected(client, make_user, db, verifier):
    user = make_user()
    assert verify(client, user, "garbage").status_code == 400
    assert rows(db) == []


def test_verify_validates_the_body(client, make_user, verifier):
    user = make_user()
    secret = "secret-purchase-token-Z9"
    bodies = [
        {"purchase_token": "", "product_id": MONTHLY},
        {"product_id": MONTHLY},
        {"purchase_token": secret},  # missing product: the whole body would be echoed as `input`
        {"purchase_token": secret * 400, "product_id": MONTHLY},  # too long
        {"purchase_token": secret, "product_id": ["x"]},
    ]
    for body in bodies:
        response = client.post(VERIFY, json=body, headers=_h(user))
        assert response.status_code == 422
        assert secret not in response.text
        for error in response.json()["detail"]:
            assert "input" not in error and "ctx" not in error
            assert {"loc", "msg", "type"} <= set(error)


def test_other_routes_get_the_same_redacted_422_body(client, make_user):
    # Every 422 drops `input`/`ctx` (they can echo user data); the frontend reads detail[].msg.
    user = make_user()
    response = client.post("/api/v1/medications/", json={"name": 5}, headers=_h(user))
    assert response.status_code == 422
    [error] = response.json()["detail"]
    assert "input" not in error and "ctx" not in error
    assert error["loc"] == ["body", "name"] and error["msg"] and error["type"]


# --- status and refresh ----------------------------------------------------------------------

def test_status_never_calls_the_verifier_and_never_returns_the_token(client, make_user, db, verifier):
    user = make_user()
    token = make_token(user, expiry=NOW + 2 * H)  # close to expiry: an AI call would re-verify
    verify(client, user, token)
    calls = verifier.get_calls
    db.query(Subscription).update({"last_verified_at": NOW - 48 * H})
    db.commit()

    response = client.get(STATUS, headers=_h(user))

    assert verifier.get_calls == calls
    assert token not in response.text and token_hash(token) not in response.text
    body = response.json()
    assert body == {
        "enabled": True, "active": True, "plan": "ai", "state": "SUBSCRIPTION_STATE_ACTIVE",
        "product_id": MONTHLY, "expires_at": (NOW + 2 * H).isoformat(), "auto_renewing": True,
        "account_token": account_token(user.id), "product_ids": ["luna_ai_monthly", "luna_ai_yearly"],
    }


def test_status_without_a_plan(client, make_user, verifier):
    user = make_user()
    body = client.get(STATUS, headers=_h(user)).json()
    assert body["enabled"] is True and body["active"] is False and body["plan"] == "free"
    assert body["state"] is None and body["account_token"] == account_token(user.id)


def test_status_lists_the_offered_product_ids_in_order(client, make_user, verifier):
    user = make_user()
    for path in (STATUS, REFRESH):
        response = client.get(path, headers=_h(user)) if path == STATUS else client.post(path, headers=_h(user))
        assert response.json()["product_ids"] == ["luna_ai_monthly", "luna_ai_yearly"]
    verify_body = verify(client, user, make_token(user)).json()
    assert verify_body["product_ids"] == ["luna_ai_monthly", "luna_ai_yearly"]


def test_status_in_off_mode_lists_no_product_ids(client, make_user, monkeypatch):
    monkeypatch.setattr(settings, "BILLING_PRODUCT_IDS", "luna_ai_monthly")
    user = make_user()
    for response in (client.get(STATUS, headers=_h(user)), client.post(REFRESH, headers=_h(user))):
        assert response.json()["product_ids"] == []


def test_refresh_reverifies_now(client, make_user, db, verifier):
    user = make_user()
    verify(client, user, make_token(user))
    calls = verifier.get_calls
    response = client.post(REFRESH, headers=_h(user))
    assert response.status_code == 200 and response.json()["active"] is True
    assert verifier.get_calls == calls + 1


def test_refresh_after_revoke_reports_inactive(client, make_user, db, verifier):
    user = make_user()
    verify(client, user, make_token(user))
    verifier.fail_get = "revoked"
    body = client.post(REFRESH, headers=_h(user)).json()
    assert body["active"] is False and body["state"] == "SUBSCRIPTION_STATE_EXPIRED"


def test_refresh_without_a_plan(client, make_user, verifier):
    user = make_user()
    response = client.post(REFRESH, headers=_h(user))
    assert response.status_code == 200 and response.json()["active"] is False
    assert verifier.get_calls == 0


def test_refresh_in_off_mode_does_not_verify(client, make_user):
    user = make_user()
    body = client.post(REFRESH, headers=_h(user)).json()
    assert body["enabled"] is False and body["plan"] == "free"


# --- limits and deletion ---------------------------------------------------------------------

def test_verify_is_rate_limited(client, make_user, verifier):
    user = make_user()
    codes = [verify(client, user, "garbage").status_code for _ in range(6)]
    assert codes[:5] == [400] * 5 and codes[5] == 429


def test_refresh_is_rate_limited(client, make_user, verifier):
    user = make_user()
    codes = [client.post(REFRESH, headers=_h(user)).status_code for _ in range(6)]
    assert codes[:5] == [200] * 5 and codes[5] == 429


def test_account_deletion_removes_the_subscription(client, make_user, db, verifier):
    user, other = make_user("a@gmail.com"), make_user("b@gmail.com")
    verify(client, user, make_token(user))
    verify(client, other, make_token(other))
    response = client.post("/api/v1/account/delete", json={"confirm": "DELETE"}, headers=_h(user))
    assert response.status_code == 200
    assert [s.user_id for s in rows(db)] == [other.id]


def test_export_has_plan_status_and_no_token(client, make_user, verifier):
    user = make_user()
    token = make_token(user)
    verify(client, user, token)
    response = client.get("/api/v1/account/export", headers=_h(user))
    assert response.json()["plan"]["product_id"] == MONTHLY
    assert token not in response.text


# --- final-review fix: concurrent verify (double tap, restore flow) --------------------------

def _race(db, monkeypatch, insert):
    """On the first commit of `db`, commit `insert(other_session)` first: a concurrent request won."""
    from app.core.database import SessionLocal

    real_commit = db.commit
    state = {"raced": False}

    def commit():
        if not state["raced"]:
            state["raced"] = True
            other = SessionLocal()
            try:
                insert(other)
                other.commit()
            finally:
                other.close()
        real_commit()

    monkeypatch.setattr(db, "commit", commit)
    return state


def _row(user_id, token, *, expiry=NOW + 30 * 24 * H):
    return Subscription(
        user_id=user_id, product_id=MONTHLY, purchase_token=token, token_hash=token_hash(token),
        state="SUBSCRIPTION_STATE_ACTIVE", expiry_time=expiry, auto_renewing=True, acknowledged=True,
        last_verified_at=NOW,
    )


def _verify_service(db, user, token, verifier):
    import asyncio

    return asyncio.run(entitlement_module.verify_and_store(db, user, token, MONTHLY, verifier=verifier, now=NOW))


def test_concurrent_verify_of_the_same_token_by_the_same_user_is_idempotent(make_user, db, monkeypatch, verifier):
    user = make_user()
    token = make_token(user)
    state = _race(db, monkeypatch, lambda other: other.add(_row(user.id, token)))

    ent = _verify_service(db, user, token, verifier)

    assert state["raced"] and ent.active is True and ent.source == "verified"
    [sub] = rows(db)
    assert sub.user_id == user.id and sub.token_hash == token_hash(token)


def test_concurrent_verify_of_another_token_by_the_same_user_updates_that_row(make_user, db, monkeypatch, verifier):
    user = make_user()
    mine = make_token(user, product="luna_ai_monthly", expiry=NOW + 40 * 24 * H)
    other_token = make_token(user, expiry=NOW + 5 * 24 * H)
    state = _race(db, monkeypatch, lambda other: other.add(_row(user.id, other_token, expiry=NOW + 5 * 24 * H)))

    ent = _verify_service(db, user, mine, verifier)

    assert state["raced"] and ent.active is True
    [sub] = rows(db)
    assert sub.user_id == user.id and sub.token_hash == token_hash(mine) and sub.purchase_token == mine
    assert sub.expiry_time == NOW + 40 * 24 * H


def test_concurrent_link_by_a_different_user_is_already_linked(make_user, db, monkeypatch, verifier):
    from fastapi import HTTPException

    alice, bob = make_user("alice@gmail.com"), make_user("bob@gmail.com")
    token = make_token(bob)
    _race(db, monkeypatch, lambda other: other.add(_row(alice.id, token)))

    with pytest.raises(HTTPException) as err:
        _verify_service(db, bob, token, verifier)

    assert err.value.status_code == 409
    assert err.value.detail == "This purchase is already linked to another account"
    [sub] = rows(db)
    assert sub.user_id == alice.id
