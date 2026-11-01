import asyncio
from datetime import datetime

import pytest

from app.core.config import settings
from app.services.billing import verifier as verifier_module
from app.services.billing.verifier import (
    OffVerifier,
    SubscriptionInfo,
    TestVerifier,
    VerifierError,
    get_verifier,
    set_verifier_for_tests,
)

ACCOUNT = "a" * 64
EXPIRY = "2026-12-01T10:00:00Z"

STATES = [
    "ACTIVE",
    "IN_GRACE_PERIOD",
    "CANCELED",
    "ON_HOLD",
    "PAUSED",
    "EXPIRED",
    "PENDING",
    "PENDING_PURCHASE_CANCELED",
]


def run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def reset_override():
    set_verifier_for_tests(None)
    yield
    set_verifier_for_tests(None)


def test_verifier_error_kind_and_validation():
    err = VerifierError("revoked")
    assert err.kind == "revoked"
    assert "revoked" in str(err)
    with pytest.raises(ValueError):
        VerifierError("other")


@pytest.mark.parametrize("state", STATES)
def test_test_verifier_parses_every_state(state):
    token = f"test:luna_ai_monthly:{state}:{EXPIRY}:{ACCOUNT}"
    info = run(TestVerifier().get(token))
    assert info == SubscriptionInfo(
        product_id="luna_ai_monthly",
        state=f"SUBSCRIPTION_STATE_{state}",
        expiry_time=datetime(2026, 12, 1, 10, 0, 0),
        auto_renewing=state in ("ACTIVE", "IN_GRACE_PERIOD"),
        acknowledged=True,
        account_id=ACCOUNT,
        package_name=None,
    )
    assert info.expiry_time.tzinfo is None


def test_test_verifier_offset_expiry_becomes_naive_utc():
    info = run(TestVerifier().get(f"test:p:ACTIVE:2026-12-01T12:30:00+02:00:{ACCOUNT}"))
    assert info.expiry_time == datetime(2026, 12, 1, 10, 30, 0)


def test_test_verifier_naive_expiry_is_utc():
    info = run(TestVerifier().get(f"test:p:ACTIVE:2026-12-01T10:00:00:{ACCOUNT}"))
    assert info.expiry_time == datetime(2026, 12, 1, 10, 0, 0)


def test_test_verifier_unacked_suffix():
    info = run(TestVerifier().get(f"test:p:ACTIVE:{EXPIRY}:{ACCOUNT}:unacked"))
    assert info.acknowledged is False
    assert info.account_id == ACCOUNT


def test_test_verifier_empty_account_means_missing():
    info = run(TestVerifier().get(f"test:p:ACTIVE:{EXPIRY}:"))
    assert info.account_id is None


@pytest.mark.parametrize(
    "token",
    [
        "",
        "garbage",
        "google-token-abc",
        f"test:p:ACTIVE:{EXPIRY}",  # no account segment
        f"test::ACTIVE:{EXPIRY}:{ACCOUNT}",  # empty product
        f"test:p:BOGUS:{EXPIRY}:{ACCOUNT}",  # unknown state
        f"test:p:SUBSCRIPTION_STATE_ACTIVE:{EXPIRY}:{ACCOUNT}",  # prefix not allowed
        f"test:p:ACTIVE:not-a-date:{ACCOUNT}",
        f"test:p:ACTIVE:{EXPIRY}:{ACCOUNT}:acked",  # unknown suffix
        f"test:p:ACTIVE:{EXPIRY}:not-hex",  # account must be account_token() format
        f"prod:p:ACTIVE:{EXPIRY}:{ACCOUNT}",
    ],
)
def test_test_verifier_malformed_tokens_are_invalid(token):
    with pytest.raises(VerifierError) as exc:
        run(TestVerifier().get(token))
    assert exc.value.kind == "invalid"
    if token:
        assert token not in str(exc.value)


def test_test_verifier_records_acknowledgement():
    v = TestVerifier()
    token = f"test:p:ACTIVE:{EXPIRY}:{ACCOUNT}:unacked"
    assert run(v.get(token)).acknowledged is False
    run(v.acknowledge(token, "p"))
    assert token in v.acknowledged
    assert v.ack_calls == [(token, "p")]
    assert run(v.get(token)).acknowledged is True


def test_test_verifier_acknowledge_rejects_malformed_or_wrong_product():
    v = TestVerifier()
    with pytest.raises(VerifierError) as exc:
        run(v.acknowledge("nope", "p"))
    assert exc.value.kind == "invalid"
    with pytest.raises(VerifierError):
        run(v.acknowledge(f"test:p:ACTIVE:{EXPIRY}:{ACCOUNT}", "other"))
    assert v.acknowledged == set()


def test_test_verifier_failure_hooks():
    v = TestVerifier()
    token = f"test:p:ACTIVE:{EXPIRY}:{ACCOUNT}"
    v.fail_get = "network"
    with pytest.raises(VerifierError) as exc:
        run(v.get(token))
    assert exc.value.kind == "network"
    v.fail_get = None
    v.fail_ack = "network"
    with pytest.raises(VerifierError):
        run(v.acknowledge(token, "p"))
    assert v.acknowledged == set()
    assert v.get_calls == 1


def test_off_verifier_raises_if_called():
    v = OffVerifier()
    with pytest.raises(RuntimeError):
        run(v.get("x"))
    with pytest.raises(RuntimeError):
        run(v.acknowledge("x", "p"))


def test_get_verifier_follows_mode(monkeypatch):
    monkeypatch.setattr(verifier_module, "_instances", {})
    monkeypatch.setattr(settings, "BILLING_MODE", "off")
    assert isinstance(get_verifier(), OffVerifier)
    monkeypatch.setattr(settings, "BILLING_MODE", "test")
    first = get_verifier()
    assert isinstance(first, TestVerifier)
    assert get_verifier() is first  # one instance, so acknowledgements persist


def test_get_verifier_google_mode_builds_google_verifier(monkeypatch):
    from app.services.billing.google import GoogleVerifier

    monkeypatch.setattr(verifier_module, "_instances", {})
    monkeypatch.setattr(settings, "BILLING_MODE", "google")
    assert isinstance(get_verifier(), GoogleVerifier)


def test_set_verifier_for_tests_overrides_and_resets(monkeypatch):
    monkeypatch.setattr(settings, "BILLING_MODE", "off")
    fake = TestVerifier()
    set_verifier_for_tests(fake)
    assert get_verifier() is fake
    set_verifier_for_tests(None)
    assert isinstance(get_verifier(), OffVerifier)
