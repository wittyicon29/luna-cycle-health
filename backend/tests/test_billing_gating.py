"""require_plan on the two AI POSTs: off is a no-op, consent wins, no LLM call without a plan."""
from datetime import date, datetime, timedelta
from unittest.mock import AsyncMock

import pytest

from app.core.config import settings
from app.core.security import create_access_token
from app.models.models import Period, Subscription
from app.services.billing import entitlement as entitlement_module
from app.services.billing.account_token import token_hash
from app.services.billing.verifier import TestVerifier, set_verifier_for_tests
from app.services.llm_service import llm_service

NOW = datetime(2026, 11, 1, 12, 0, 0)
H = timedelta(hours=1)
ASK, ANALYSIS = "/api/v1/chat/ask", "/api/v1/analysis/"
PLAN_REQUIRED = {"code": "plan_required", "message": "Luna AI plan required"}


def _h(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}"}


@pytest.fixture
def llm(monkeypatch):
    chat = AsyncMock(return_value="Hello from Luna")
    analysis = AsyncMock(return_value={"simple_summary": "ok"})
    monkeypatch.setattr(llm_service, "call_qwen", chat)
    monkeypatch.setattr(llm_service, "analyze_cycle_health", analysis)
    return chat, analysis


@pytest.fixture
def billing_on(monkeypatch):
    monkeypatch.setattr(settings, "BILLING_MODE", "test")
    monkeypatch.setattr(settings, "BILLING_PRODUCT_IDS", "luna_ai_monthly")
    monkeypatch.setattr(entitlement_module, "utcnow", lambda: NOW)
    fake = TestVerifier()
    set_verifier_for_tests(fake)
    entitlement_module.reset_cooldowns()
    yield fake
    set_verifier_for_tests(None)
    entitlement_module.reset_cooldowns()


def consent(client, user):
    client.post("/api/v1/consents", json={"purpose": "ai_processing", "granted": True}, headers=_h(user))


def give_plan(db, user, *, state="SUBSCRIPTION_STATE_ACTIVE", expiry=NOW + 10 * 24 * H):
    db.add(Subscription(
        user_id=user.id, product_id="luna_ai_monthly", purchase_token="stored-token",
        token_hash=token_hash(f"stored-token-{user.id}"), state=state, expiry_time=expiry,
        auto_renewing=True, acknowledged=True, last_verified_at=NOW,
    ))
    db.commit()


def add_periods(db, user):
    today = date.today()
    for days in (60, 32, 4):
        db.add(Period(user_id=user.id, start_date=today - timedelta(days=days)))
    db.commit()


def ask(client, user):
    return client.post(ASK, json={"question": "How long is a typical cycle?"}, headers=_h(user))


def analyze(client, user):
    return client.post(ANALYSIS, json={"analysis_type": "cycle_health"}, headers=_h(user))


# --- off mode --------------------------------------------------------------------------------

def test_off_mode_gating_is_a_no_op_without_entitlement_lookups(client, make_user, db, llm, monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError("off mode must not resolve entitlement")

    monkeypatch.setattr(entitlement_module, "current_entitlement", boom)
    set_verifier_for_tests(None)
    user = make_user()
    consent(client, user)
    add_periods(db, user)

    assert ask(client, user).status_code == 200
    assert analyze(client, user).status_code == 200
    assert llm[0].await_count == 1 and llm[1].await_count == 1


# --- billing on, no plan ---------------------------------------------------------------------

def test_chat_without_a_plan_is_refused_before_the_llm(client, make_user, llm, billing_on):
    user = make_user()
    consent(client, user)
    response = ask(client, user)
    assert response.status_code == 403 and response.json()["detail"] == PLAN_REQUIRED
    llm[0].assert_not_awaited()


def test_analysis_without_a_plan_is_refused_before_the_llm(client, make_user, db, llm, billing_on):
    user = make_user()
    consent(client, user)
    add_periods(db, user)
    response = analyze(client, user)
    assert response.status_code == 403 and response.json()["detail"] == PLAN_REQUIRED
    llm[1].assert_not_awaited()


def test_on_hold_plan_is_refused(client, make_user, db, llm, billing_on):
    user = make_user()
    consent(client, user)
    give_plan(db, user, state="SUBSCRIPTION_STATE_ON_HOLD")
    assert ask(client, user).json()["detail"] == PLAN_REQUIRED
    llm[0].assert_not_awaited()


@pytest.mark.parametrize("path", [ASK, ANALYSIS])
def test_missing_consent_wins_over_missing_plan(client, make_user, llm, billing_on, path):
    user = make_user()
    body = {"question": "hi"} if path == ASK else {"analysis_type": "cycle_health"}
    response = client.post(path, json=body, headers=_h(user))
    assert response.status_code == 403
    assert response.json()["detail"] == {"code": "consent_required", "purpose": "ai_processing"}
    assert billing_on.get_calls == 0
    llm[0].assert_not_awaited()
    llm[1].assert_not_awaited()


# --- billing on, with a plan -----------------------------------------------------------------

def test_chat_and_analysis_with_an_active_plan(client, make_user, db, llm, billing_on):
    user = make_user()
    consent(client, user)
    give_plan(db, user)
    add_periods(db, user)
    assert ask(client, user).status_code == 200
    assert analyze(client, user).status_code == 200
    assert billing_on.get_calls == 0  # fresh row answered from storage


def test_canceled_but_paid_through_plan_still_gets_ai(client, make_user, db, llm, billing_on):
    user = make_user()
    consent(client, user)
    give_plan(db, user, state="SUBSCRIPTION_STATE_CANCELED")
    assert ask(client, user).status_code == 200


# --- free GET endpoints ----------------------------------------------------------------------

def test_history_and_results_stay_free_without_a_plan(client, make_user, llm, billing_on):
    user = make_user()
    consent(client, user)
    assert client.get("/api/v1/chat/history", headers=_h(user)).status_code == 200
    assert client.get("/api/v1/analysis/", headers=_h(user)).status_code == 200
    assert client.get("/api/v1/analysis/latest/cycle_health", headers=_h(user)).status_code == 404  # none yet, not 403
