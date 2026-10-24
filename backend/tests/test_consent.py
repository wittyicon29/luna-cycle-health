def test_registration_requires_accepting_the_privacy_policy(client, outbox, register_payload):
    register_payload["accepted_privacy_policy"] = False

    response = client.post("/api/v1/auth/register", json=register_payload)

    assert response.status_code == 422


def test_registration_without_the_field_is_rejected(client, outbox, register_payload):
    del register_payload["accepted_privacy_policy"]

    assert client.post("/api/v1/auth/register", json=register_payload).status_code == 422


def test_registration_requires_confirming_age_18_plus(client, outbox, register_payload):
    register_payload["confirmed_18_plus"] = False

    assert client.post("/api/v1/auth/register", json=register_payload).status_code == 422

    del register_payload["confirmed_18_plus"]

    assert client.post("/api/v1/auth/register", json=register_payload).status_code == 422


def test_registration_records_terms_and_age_consent(client, outbox, register_payload):
    token = client.post("/api/v1/auth/register", json=register_payload).json()["access_token"]

    response = client.get("/api/v1/consents", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    assert response.json()["terms_privacy"] is True
    assert response.json()["age_18_plus"] is True
    assert response.json()["ai_processing"] is False


def test_questionnaire_rejects_users_under_18():
    import pytest
    from pydantic import ValidationError
    from app.schemas.simplified_questionnaire import BasicDemographic

    with pytest.raises(ValidationError):
        BasicDemographic(age=17, biological_sex="female", weight_kg=50, height_cm=160)

    assert BasicDemographic(age=18, biological_sex="female", weight_kg=50, height_cm=160).age == 18


def test_consent_can_be_granted_then_withdrawn(client, auth_headers):
    granted = client.post("/api/v1/consents", json={"purpose": "ai_processing", "granted": True}, headers=auth_headers)
    assert granted.json()["ai_processing"] is True

    withdrawn = client.post("/api/v1/consents", json={"purpose": "ai_processing", "granted": False}, headers=auth_headers)
    assert withdrawn.json()["ai_processing"] is False


def test_unknown_purpose_is_rejected(client, auth_headers):
    response = client.post("/api/v1/consents", json={"purpose": "marketing", "granted": True}, headers=auth_headers)

    assert response.status_code == 422


def test_consents_require_authentication(client):
    assert client.get("/api/v1/consents").status_code in (401, 403)


def test_chat_is_blocked_without_ai_consent(client, auth_headers):
    response = client.post("/api/v1/chat/ask", json={"question": "hi"}, headers=auth_headers)

    assert response.status_code == 403
    assert response.json()["detail"] == {"code": "consent_required", "purpose": "ai_processing"}


def test_analysis_is_blocked_without_ai_consent(client, auth_headers):
    response = client.post("/api/v1/analysis/", json={"analysis_type": "prediction"}, headers=auth_headers)

    assert response.status_code == 403


def test_chat_is_blocked_again_after_withdrawing_ai_consent(client, auth_headers):
    client.post("/api/v1/consents", json={"purpose": "ai_processing", "granted": True}, headers=auth_headers)
    client.post("/api/v1/consents", json={"purpose": "ai_processing", "granted": False}, headers=auth_headers)

    response = client.post("/api/v1/chat/ask", json={"question": "hi"}, headers=auth_headers)

    assert response.status_code == 403
    assert response.json()["detail"] == {"code": "consent_required", "purpose": "ai_processing"}


def test_legacy_questionnaire_schema_rejects_users_under_18():
    import pytest
    from pydantic import ValidationError
    from app.schemas.questionnaire_schema import BasicDemographic

    with pytest.raises(ValidationError):
        BasicDemographic(age=17, biological_sex="female", weight_kg=50, height_cm=160)


def _fake_google(monkeypatch, email):
    from app.services.google_oauth import google_oauth_service

    async def fake_exchange(code):
        return {"access_token": "fake"}

    async def fake_info(token):
        return {"email": email}

    monkeypatch.setattr(google_oauth_service, "exchange_code_for_token", fake_exchange)
    monkeypatch.setattr(google_oauth_service, "get_user_info", fake_info)


def test_google_signup_without_consent_flags_is_rejected(client, db, monkeypatch):
    from app.models.models import User

    _fake_google(monkeypatch, "gnew@gmail.com")

    response = client.post("/api/v1/auth/google/callback?code=abc")

    assert response.status_code == 400
    assert response.json()["detail"] == {"code": "consent_required", "purposes": ["terms_privacy", "age_18_plus"]}
    assert db.query(User).filter(User.email == "gnew@gmail.com").count() == 0


def test_google_signup_with_only_one_flag_is_rejected(client, db, monkeypatch):
    from app.models.models import User

    _fake_google(monkeypatch, "gnew@gmail.com")

    response = client.post("/api/v1/auth/google/callback?code=abc&accepted_privacy_policy=true")

    assert response.status_code == 400
    assert db.query(User).filter(User.email == "gnew@gmail.com").count() == 0


def test_google_signup_with_consent_flags_records_consent(client, monkeypatch):
    _fake_google(monkeypatch, "gnew@gmail.com")

    response = client.post(
        "/api/v1/auth/google/callback?code=abc&accepted_privacy_policy=true&confirmed_18_plus=true"
    )

    assert response.status_code == 200
    token = response.json()["access_token"]
    consents = client.get("/api/v1/consents", headers={"Authorization": f"Bearer {token}"}).json()
    assert consents["terms_privacy"] is True
    assert consents["age_18_plus"] is True


def test_google_login_for_existing_user_needs_no_flags(client, auth_headers, monkeypatch):
    status = client.get("/api/v1/auth/status", headers=auth_headers).json()
    _fake_google(monkeypatch, status["email"])

    response = client.post("/api/v1/auth/google/callback?code=abc")

    assert response.status_code == 200
