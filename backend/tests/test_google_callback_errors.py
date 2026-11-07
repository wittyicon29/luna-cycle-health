"""The Google OAuth callback never echoes exception text to the client or the logs."""
import logging

from app.services.google_oauth import google_oauth_service
from tests.test_consent import _fake_google

CALLBACK = "/api/v1/auth/google/callback?code=abc&accepted_privacy_policy=true&confirmed_18_plus=true"
SENTINEL = "SNTLgoogle42"


def test_unexpected_error_returns_a_fixed_translated_message(client, monkeypatch, caplog):
    caplog.set_level(logging.DEBUG)

    async def broken(code):
        raise ValueError(f"upstream said {SENTINEL} for a@b.example.com")

    monkeypatch.setattr(google_oauth_service, "exchange_code_for_token", broken)
    response = client.post(CALLBACK)
    assert response.status_code == 400
    assert response.json() == {"detail": "Google sign-in could not be verified"}
    assert SENTINEL not in response.text
    assert SENTINEL not in caplog.text
    assert any(r.getMessage() == "Google OAuth callback failed: ValueError" for r in caplog.records)


def test_service_messages_reach_the_client_unprefixed(client, monkeypatch):
    _fake_google(monkeypatch, "someone@gmail.com", verified_email=False)
    response = client.post(CALLBACK)
    assert response.status_code == 400
    assert response.json() == {"detail": "Your Google email is not verified"}


def test_structured_consent_errors_still_pass_through(client, monkeypatch):
    _fake_google(monkeypatch, "new@gmail.com")
    response = client.post("/api/v1/auth/google/callback?code=abc")
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "consent_required"
