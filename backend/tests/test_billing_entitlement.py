"""Entitlement rules: active states, re-verify triggers, outage grace, revoke and refund paths."""
from datetime import datetime, timedelta

import pytest

from app.core.config import settings
from app.models.models import Subscription
from app.services.billing.account_token import account_token, token_hash
from app.services.billing import entitlement as entitlement_module
from app.services.billing.entitlement import REVERIFY_MIN_INTERVAL, current_entitlement, is_active
from app.services.billing.verifier import SubscriptionInfo, TestVerifier, VerifierError, set_verifier_for_tests

NOW = datetime(2026, 11, 1, 12, 0, 0)
PRODUCT = "luna_ai_monthly"
H = timedelta(hours=1)
S = timedelta(seconds=1)

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


class ScriptedVerifier:
    """Returns a fixed SubscriptionInfo (or raises a VerifierError kind) and counts calls."""

    def __init__(self, info=None, error=None):
        self.info, self.error, self.get_calls, self.ack_calls = info, error, 0, []

    async def get(self, token):
        self.get_calls += 1
        if self.error:
            raise VerifierError(self.error, "scripted")
        return self.info

    async def acknowledge(self, token, product_id):
        self.ack_calls.append((token, product_id))


@pytest.fixture(autouse=True)
def billing_test_mode(monkeypatch):
    monkeypatch.setattr(settings, "BILLING_MODE", "test")
    monkeypatch.setattr(settings, "BILLING_PRODUCT_IDS", "luna_ai_monthly,luna_ai_yearly")
    set_verifier_for_tests(None)
    entitlement_module.reset_cooldowns()
    yield
    set_verifier_for_tests(None)
    entitlement_module.reset_cooldowns()


def store(db, user, *, state="SUBSCRIPTION_STATE_ACTIVE", expiry=NOW + 10 * 24 * H, verified=NOW - H, token="tok-1"):
    sub = Subscription(
        user_id=user.id, product_id=PRODUCT, purchase_token=token, token_hash=token_hash(token),
        state=state, expiry_time=expiry, auto_renewing=True, acknowledged=True, last_verified_at=verified,
    )
    db.add(sub)
    db.commit()
    return sub


def info_for(user, *, state="SUBSCRIPTION_STATE_ACTIVE", expiry=NOW + 30 * 24 * H, account="self", product=PRODUCT):
    return SubscriptionInfo(
        product_id=product, state=state, expiry_time=expiry, auto_renewing=True, acknowledged=True,
        account_id=account_token(user.id) if account == "self" else account, package_name=None,
    )


def row(db, user):
    db.expire_all()
    return db.query(Subscription).filter(Subscription.user_id == user.id).one()


# --- the active rule -------------------------------------------------------------------------

@pytest.mark.parametrize("state, expected", [
    ("SUBSCRIPTION_STATE_ACTIVE", True),
    ("SUBSCRIPTION_STATE_IN_GRACE_PERIOD", True),
    ("SUBSCRIPTION_STATE_CANCELED", True),  # canceled but paid through
    ("SUBSCRIPTION_STATE_ON_HOLD", False),
    ("SUBSCRIPTION_STATE_PAUSED", False),
    ("SUBSCRIPTION_STATE_EXPIRED", False),
    ("SUBSCRIPTION_STATE_PENDING", False),
    ("SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED", False),
    ("SOMETHING_NEW", False),
    (None, False),
])
def test_active_states(state, expected):
    assert is_active(state, NOW + H, NOW) is expected


def test_expiry_exactly_now_is_inactive_and_one_second_ahead_is_active():
    assert is_active("SUBSCRIPTION_STATE_ACTIVE", NOW, NOW) is False
    assert is_active("SUBSCRIPTION_STATE_ACTIVE", NOW + S, NOW) is True
    assert is_active("SUBSCRIPTION_STATE_ACTIVE", None, NOW) is False


# --- stored answers and off mode -------------------------------------------------------------

async def test_off_mode_is_always_entitled_and_never_calls_the_verifier(db, make_user, monkeypatch):
    monkeypatch.setattr(settings, "BILLING_MODE", "off")
    verifier = TestVerifier()
    ent = await current_entitlement(db, make_user(), now=NOW, verifier=verifier)
    assert ent.active is True and ent.source == "off"
    assert verifier.get_calls == 0


async def test_no_subscription_is_inactive(db, make_user):
    verifier = TestVerifier()
    ent = await current_entitlement(db, make_user(), now=NOW, verifier=verifier)
    assert ent.active is False and ent.state is None and verifier.get_calls == 0


async def test_fresh_active_row_is_answered_from_storage(db, make_user):
    user = make_user()
    store(db, user)
    verifier = ScriptedVerifier(error="network")
    ent = await current_entitlement(db, user, now=NOW, verifier=verifier)
    assert (ent.active, ent.source, ent.state, ent.product_id) == (True, "stored", "SUBSCRIPTION_STATE_ACTIVE", PRODUCT)
    assert ent.expires_at == NOW + 10 * 24 * H
    assert verifier.get_calls == 0


@pytest.mark.parametrize("state", ["SUBSCRIPTION_STATE_CANCELED", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"])
async def test_canceled_paid_through_and_grace_period_rows_are_active(db, make_user, state):
    user = make_user()
    store(db, user, state=state)
    assert (await current_entitlement(db, user, now=NOW, verifier=ScriptedVerifier())).active is True


async def test_on_hold_row_is_inactive(db, make_user):
    user = make_user()
    store(db, user, state="SUBSCRIPTION_STATE_ON_HOLD")
    assert (await current_entitlement(db, user, now=NOW, verifier=ScriptedVerifier())).active is False


# --- re-verify triggers ----------------------------------------------------------------------

async def test_expiry_within_24h_triggers_reverify(db, make_user):
    user = make_user()
    store(db, user, expiry=NOW + 24 * H - S, verified=NOW - REVERIFY_MIN_INTERVAL)
    verifier = ScriptedVerifier(info=info_for(user, expiry=NOW + 31 * 24 * H))
    ent = await current_entitlement(db, user, now=NOW, verifier=verifier)
    assert verifier.get_calls == 1
    assert ent.active is True and ent.source == "verified"
    assert row(db, user).expiry_time == NOW + 31 * 24 * H
    assert row(db, user).last_verified_at == NOW


async def test_expiry_exactly_24h_ahead_does_not_reverify(db, make_user):
    user = make_user()
    store(db, user, expiry=NOW + 24 * H, verified=NOW)
    verifier = ScriptedVerifier(error="network")
    assert (await current_entitlement(db, user, now=NOW, verifier=verifier)).source == "stored"
    assert verifier.get_calls == 0


async def test_expired_row_triggers_reverify_and_renewal_reactivates(db, make_user):
    user = make_user()
    store(db, user, expiry=NOW, verified=NOW - S)  # last verified before it lapsed
    verifier = ScriptedVerifier(info=info_for(user))
    ent = await current_entitlement(db, user, now=NOW, verifier=verifier)
    assert verifier.get_calls == 1 and ent.active is True


async def test_last_verified_older_than_6h_triggers_reverify(db, make_user):
    user = make_user()
    store(db, user, verified=NOW - 6 * H - S)
    verifier = ScriptedVerifier(info=info_for(user))
    await current_entitlement(db, user, now=NOW, verifier=verifier)
    assert verifier.get_calls == 1


async def test_last_verified_within_6h_does_not_reverify(db, make_user):
    user = make_user()
    store(db, user, verified=NOW - 6 * H + S)
    verifier = ScriptedVerifier(error="network")
    await current_entitlement(db, user, now=NOW, verifier=verifier)
    assert verifier.get_calls == 0


async def test_force_reverifies_a_fresh_row(db, make_user):
    user = make_user()
    store(db, user, verified=NOW)
    verifier = ScriptedVerifier(info=info_for(user))
    ent = await current_entitlement(db, user, now=NOW, verifier=verifier, force=True)
    assert verifier.get_calls == 1 and ent.source == "verified"


async def test_reverify_uses_the_stored_token(db, make_user):
    user = make_user()
    token = f"test:{PRODUCT}:ACTIVE:{(NOW + 40 * 24 * H).isoformat()}:{account_token(user.id)}"
    store(db, user, verified=NOW - 7 * H, token=token)
    verifier = TestVerifier()
    ent = await current_entitlement(db, user, now=NOW, verifier=verifier)
    assert verifier.get_calls == 1 and ent.expires_at == NOW + 40 * 24 * H


async def test_default_verifier_comes_from_get_verifier(db, make_user):
    user = make_user()
    store(db, user, verified=NOW - 7 * H)
    verifier = ScriptedVerifier(info=info_for(user))
    set_verifier_for_tests(verifier)
    await current_entitlement(db, user, now=NOW)
    assert verifier.get_calls == 1


# --- outage grace ----------------------------------------------------------------------------

async def test_outage_keeps_an_active_user_active_until_expiry_plus_24h(db, make_user):
    user = make_user()
    store(db, user, expiry=NOW - 24 * H + S, verified=NOW - 30 * H)
    verifier = ScriptedVerifier(error="network")
    ent = await current_entitlement(db, user, now=NOW, verifier=verifier)
    assert verifier.get_calls == 1
    assert ent.active is True and ent.source == "grace"
    stored = row(db, user)
    assert stored.state == "SUBSCRIPTION_STATE_ACTIVE" and stored.last_verified_at == NOW - 30 * H  # unchanged


async def test_outage_after_expiry_plus_24h_is_inactive(db, make_user):
    user = make_user()
    store(db, user, expiry=NOW - 24 * H - S, verified=NOW - 30 * H)
    ent = await current_entitlement(db, user, now=NOW, verifier=ScriptedVerifier(error="network"))
    assert ent.active is False


async def test_outage_with_a_valid_expiry_keeps_the_stored_answer(db, make_user):
    user = make_user()
    store(db, user, expiry=NOW + 2 * H, verified=NOW - 7 * H)
    ent = await current_entitlement(db, user, now=NOW, verifier=ScriptedVerifier(error="network"))
    assert ent.active is True


async def test_outage_grants_nothing_when_the_stored_state_was_inactive(db, make_user):
    user = make_user()
    store(db, user, state="SUBSCRIPTION_STATE_ON_HOLD", expiry=NOW - H, verified=NOW - 30 * H)
    ent = await current_entitlement(db, user, now=NOW, verifier=ScriptedVerifier(error="network"))
    assert ent.active is False


# --- revoke, malformed, refund ---------------------------------------------------------------

async def test_revoked_token_is_inactive_immediately_and_marked_expired(db, make_user):
    user = make_user()
    store(db, user, expiry=NOW + 10 * 24 * H, verified=NOW - 7 * H)
    ent = await current_entitlement(db, user, now=NOW, verifier=ScriptedVerifier(error="revoked"))
    assert ent.active is False
    stored = row(db, user)
    assert stored.state == "SUBSCRIPTION_STATE_EXPIRED" and stored.expiry_time == NOW
    assert stored.auto_renewing is False


async def test_malformed_response_is_never_active(db, make_user):
    user = make_user()
    store(db, user, expiry=NOW + 10 * 24 * H, verified=NOW - 7 * H)
    ent = await current_entitlement(db, user, now=NOW, verifier=ScriptedVerifier(error="invalid"))
    assert ent.active is False


async def test_reverify_with_foreign_account_is_inactive(db, make_user):
    user = make_user()
    store(db, user, verified=NOW - 7 * H)
    verifier = ScriptedVerifier(info=info_for(user, account="f" * 64))
    assert (await current_entitlement(db, user, now=NOW, verifier=verifier)).active is False


async def test_refund_blocks_ai_on_the_first_call_after_the_6h_window(db, make_user):
    user = make_user()
    store(db, user, expiry=NOW + 20 * 24 * H, verified=NOW)
    refunded = ScriptedVerifier(info=info_for(user, state="SUBSCRIPTION_STATE_EXPIRED", expiry=NOW + H))

    within = await current_entitlement(db, user, now=NOW + 5 * H, verifier=refunded)
    assert within.active is True and refunded.get_calls == 0

    after = await current_entitlement(db, user, now=NOW + 6 * H + S, verifier=refunded)
    assert after.active is False and refunded.get_calls == 1
    assert row(db, user).state == "SUBSCRIPTION_STATE_EXPIRED"


async def test_canceled_with_past_expiry_is_inactive_after_reverify(db, make_user):
    user = make_user()
    store(db, user, verified=NOW - 7 * H)
    verifier = ScriptedVerifier(info=info_for(user, state="SUBSCRIPTION_STATE_CANCELED", expiry=NOW - H))
    assert (await current_entitlement(db, user, now=NOW, verifier=verifier)).active is False


# --- final-review fix: re-verify back-off and cool-downs -------------------------------------

M = timedelta(minutes=1)


def test_min_interval_is_15_minutes():
    assert REVERIFY_MIN_INTERVAL == timedelta(minutes=15)
    assert entitlement_module.EXPIRY_REVERIFY_WINDOW == timedelta(hours=24)


async def test_lapsed_plan_is_rechecked_at_most_every_15_minutes(db, make_user):
    user = make_user()
    store(db, user, expiry=NOW - 2 * H, verified=NOW - 3 * H)
    verifier = ScriptedVerifier(info=info_for(user, state="SUBSCRIPTION_STATE_EXPIRED", expiry=NOW - 2 * H))

    assert (await current_entitlement(db, user, now=NOW, verifier=verifier)).active is False
    assert verifier.get_calls == 1
    assert (await current_entitlement(db, user, now=NOW + 14 * M, verifier=verifier)).active is False
    assert verifier.get_calls == 1  # backed off
    await current_entitlement(db, user, now=NOW + 15 * M, verifier=verifier)
    assert verifier.get_calls == 2


async def test_renewal_is_seen_on_the_first_call_after_expiry(db, make_user):
    user = make_user()
    store(db, user, expiry=NOW - S, verified=NOW - 5 * M)  # verified 5 min ago, but before expiry
    verifier = ScriptedVerifier(info=info_for(user, expiry=NOW + 30 * 24 * H))
    ent = await current_entitlement(db, user, now=NOW, verifier=verifier)
    assert verifier.get_calls == 1 and ent.active is True


async def test_revoked_row_backs_off(db, make_user):
    user = make_user()
    store(db, user, verified=NOW - 7 * H)
    verifier = ScriptedVerifier(error="revoked")
    await current_entitlement(db, user, now=NOW, verifier=verifier)
    assert (await current_entitlement(db, user, now=NOW + M, verifier=verifier)).active is False
    assert verifier.get_calls == 1
    await current_entitlement(db, user, now=NOW + 15 * M, verifier=verifier)
    assert verifier.get_calls == 2


async def test_refund_inside_the_24h_window_is_seen_within_15_minutes(db, make_user):
    user = make_user()
    store(db, user, expiry=NOW + 10 * H, verified=NOW - 14 * M)
    refunded = ScriptedVerifier(info=info_for(user, state="SUBSCRIPTION_STATE_EXPIRED", expiry=NOW - M))

    assert (await current_entitlement(db, user, now=NOW, verifier=refunded)).active is True
    assert refunded.get_calls == 0
    assert (await current_entitlement(db, user, now=NOW + M, verifier=refunded)).active is False
    assert refunded.get_calls == 1


async def test_force_always_calls_the_verifier(db, make_user):
    user = make_user()
    store(db, user, expiry=NOW - H, verified=NOW)
    verifier = ScriptedVerifier(info=info_for(user, state="SUBSCRIPTION_STATE_EXPIRED", expiry=NOW - H))
    for _ in range(3):
        await current_entitlement(db, user, now=NOW, verifier=verifier, force=True)
    assert verifier.get_calls == 3


async def test_network_failure_starts_a_short_cool_down(db, make_user):
    user = make_user()
    store(db, user, expiry=NOW - H, verified=NOW - 2 * H)
    verifier = ScriptedVerifier(error="network")

    first = await current_entitlement(db, user, now=NOW, verifier=verifier)
    assert first.active is True and first.source == "grace" and verifier.get_calls == 1

    during = await current_entitlement(db, user, now=NOW + 29 * S, verifier=verifier)
    assert during.active is True and during.source == "grace" and verifier.get_calls == 1

    await current_entitlement(db, user, now=NOW + 30 * S, verifier=verifier)
    assert verifier.get_calls == 2


async def test_cool_down_never_extends_the_outage_grace(db, make_user):
    user = make_user()
    store(db, user, expiry=NOW - 24 * H + 10 * S, verified=NOW - 30 * H)
    verifier = ScriptedVerifier(error="network")
    assert (await current_entitlement(db, user, now=NOW, verifier=verifier)).active is True
    assert (await current_entitlement(db, user, now=NOW + 11 * S, verifier=verifier)).active is False


async def test_force_ignores_the_network_cool_down(db, make_user):
    user = make_user()
    store(db, user, expiry=NOW - H, verified=NOW - 2 * H)
    verifier = ScriptedVerifier(error="network")
    await current_entitlement(db, user, now=NOW, verifier=verifier)
    await current_entitlement(db, user, now=NOW + S, verifier=verifier, force=True)
    assert verifier.get_calls == 2


async def test_success_clears_the_cool_down(db, make_user):
    user = make_user()
    store(db, user, expiry=NOW - H, verified=NOW - 2 * H)
    verifier = ScriptedVerifier(error="network")
    await current_entitlement(db, user, now=NOW, verifier=verifier)
    verifier.error, verifier.info = None, info_for(user)
    assert (await current_entitlement(db, user, now=NOW + S, verifier=verifier, force=True)).source == "verified"
    assert entitlement_module._cooldowns == {}


@pytest.mark.parametrize("case", ["mismatch", "invalid"])
async def test_mismatch_and_invalid_answers_back_off_and_stay_inactive(db, make_user, case):
    user = make_user()
    store(db, user, expiry=NOW + 10 * 24 * H, verified=NOW - 7 * H)
    if case == "mismatch":
        verifier = ScriptedVerifier(info=info_for(user, account="f" * 64))
    else:
        verifier = ScriptedVerifier(error="invalid")

    assert (await current_entitlement(db, user, now=NOW, verifier=verifier)).active is False
    during = await current_entitlement(db, user, now=NOW + 14 * M, verifier=verifier)
    assert during.active is False and verifier.get_calls == 1  # no call, and never active from the stored row
    await current_entitlement(db, user, now=NOW + 15 * M, verifier=verifier)
    assert verifier.get_calls == 2


async def test_cool_downs_are_per_user(db, make_user):
    a, b = make_user("a@gmail.com"), make_user("b@gmail.com")
    store(db, a, expiry=NOW - H, verified=NOW - 2 * H, token="tok-a")
    store(db, b, expiry=NOW - H, verified=NOW - 2 * H, token="tok-b")
    verifier = ScriptedVerifier(error="network")
    await current_entitlement(db, a, now=NOW, verifier=verifier)
    await current_entitlement(db, b, now=NOW + S, verifier=verifier)
    assert verifier.get_calls == 2
