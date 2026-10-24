from datetime import date

from app.core.security import create_access_token
from app.models.models import (Analysis, ChatMessage, ConsentRecord, Period,
                               Questionnaire)


def headers_for(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}"}


def test_export_contains_decrypted_user_data(client, db, make_user):
    user = make_user()
    db.add_all([
        Period(user_id=user.id, start_date=date(2026, 1, 1), notes="my note", symptoms=["cramps"]),
        Questionnaire(user_id=user.id, responses={"pain": 3}),
        ChatMessage(user_id=user.id, session_id="s", role="user", content="hello luna"),
    ])
    db.commit()

    response = client.get("/api/v1/account/export", headers=headers_for(user))

    assert response.status_code == 200
    assert "attachment" in response.headers["content-disposition"]
    body = response.json()
    assert body["account"]["email"] == "user@gmail.com"
    assert body["periods"][0]["notes"] == "my note"
    assert body["periods"][0]["symptoms"] == ["cramps"]
    assert body["questionnaires"][0]["responses"] == {"pain": 3}
    assert body["chat_messages"][0]["content"] == "hello luna"
    assert set(body) == {"exported_at", "account", "periods", "questionnaires",
                         "analyses", "chat_messages", "consents"}


def test_export_never_includes_another_users_data(client, db, make_user):
    mine, theirs = make_user("a@gmail.com"), make_user("b@gmail.com")
    db.add_all([
        Period(user_id=theirs.id, start_date=date(2026, 2, 2), notes="secret-period-note"),
        Questionnaire(user_id=theirs.id, responses={"k": "secret-questionnaire"}),
        Analysis(user_id=theirs.id, analysis_type="secret-analysis-type",
                 llm_response="secret-llm-response", risk_flags=["secret-risk"]),
        ChatMessage(user_id=theirs.id, session_id="secret-session", role="user",
                    content="secret-chat-content"),
        ConsentRecord(user_id=theirs.id, purpose="secret-purpose",
                      policy_version="secret-version", granted=True),
    ])
    db.commit()

    response = client.get("/api/v1/account/export", headers=headers_for(mine))
    body = response.json()

    for key in ("periods", "questionnaires", "analyses", "chat_messages", "consents"):
        assert body[key] == [], key
    assert "secret-" not in response.text


def test_export_serializes_analyses_and_consents(client, db, make_user):
    user = make_user()
    db.add_all([
        Analysis(user_id=user.id, analysis_type="cycle", llm_response="llm says hi",
                 predictions={"next": "2026-02-01"}, health_insights=["i1"],
                 risk_flags=["r1"], recommendations=["rec1"], cycle_health_score=82),
        ConsentRecord(user_id=user.id, purpose="ai_processing",
                      policy_version="v1", granted=True),
    ])
    db.commit()

    body = client.get("/api/v1/account/export", headers=headers_for(user)).json()

    a = body["analyses"][0]
    assert a["analysis_type"] == "cycle"
    assert a["llm_response"] == "llm says hi"
    assert a["predictions"] == {"next": "2026-02-01"}
    assert a["health_insights"] == ["i1"]
    assert a["risk_flags"] == ["r1"]
    assert a["recommendations"] == ["rec1"]
    assert a["cycle_health_score"] == 82
    c = body["consents"][0]
    assert (c["purpose"], c["policy_version"], c["granted"]) == ("ai_processing", "v1", True)


def test_export_response_is_not_cacheable(client, make_user):
    user = make_user()
    response = client.get("/api/v1/account/export", headers=headers_for(user))
    assert response.headers["cache-control"] == "no-store"


def test_export_requires_authentication(client):
    assert client.get("/api/v1/account/export").status_code in (401, 403)
