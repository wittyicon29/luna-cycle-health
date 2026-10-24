from datetime import date

from app.core.security import create_access_token
from app.models.models import ChatMessage, Period, Questionnaire


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
    db.add(Period(user_id=theirs.id, start_date=date(2026, 2, 2), notes="not yours"))
    db.commit()

    body = client.get("/api/v1/account/export", headers=headers_for(mine)).json()

    assert body["periods"] == []
    assert "not yours" not in str(body)


def test_export_requires_authentication(client):
    assert client.get("/api/v1/account/export").status_code in (401, 403)
