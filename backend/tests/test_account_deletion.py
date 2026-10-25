from datetime import date, datetime, timedelta, timezone

from app.core.security import create_access_token
from app.models.models import (Analysis, ChatMessage, ConsentRecord, Medication,
                               Period, Questionnaire, RefreshToken, User)


def seed(db, user):
    db.add_all([
        Period(user_id=user.id, start_date=date(2026, 1, 1), notes="n"),
        Questionnaire(user_id=user.id, responses={"a": 1}),
        ChatMessage(user_id=user.id, session_id="s", role="user", content="hello"),
        Analysis(user_id=user.id, analysis_type="prediction", llm_response="r"),
        Medication(user_id=user.id, name="Iron"),
        ConsentRecord(user_id=user.id, purpose="terms_privacy", policy_version="1.0", granted=True),
        RefreshToken(user_id=user.id, token_hash="h", expires_at=datetime.now(timezone.utc) + timedelta(days=1)),
    ])
    db.commit()


def headers_for(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}"}


def test_delete_requires_exact_confirmation(client, auth_headers, db):
    response = client.post("/api/v1/account/delete", json={"confirm": "delete"}, headers=auth_headers)

    assert response.status_code == 400
    assert db.query(User).count() == 1


def test_delete_removes_the_user_and_all_their_data(client, db, make_user):
    user = make_user()
    seed(db, user)

    response = client.post("/api/v1/account/delete", json={"confirm": "DELETE"}, headers=headers_for(user))

    assert response.status_code == 200
    for model in (User, Period, Questionnaire, ChatMessage, Analysis, ConsentRecord, RefreshToken, Medication):
        assert db.query(model).count() == 0, model.__name__


def test_delete_leaves_other_users_untouched(client, db, make_user):
    victim, bystander = make_user("a@gmail.com"), make_user("b@gmail.com")
    seed(db, victim)
    seed(db, bystander)

    client.post("/api/v1/account/delete", json={"confirm": "DELETE"}, headers=headers_for(victim))

    assert db.query(User).count() == 1
    assert db.query(Period).filter(Period.user_id == bystander.id).count() == 1
    assert db.query(ChatMessage).filter(ChatMessage.user_id == bystander.id).count() == 1


def test_token_is_useless_after_deletion_and_double_delete_is_safe(client, db, make_user):
    user = make_user()
    headers = headers_for(user)
    client.post("/api/v1/account/delete", json={"confirm": "DELETE"}, headers=headers)

    assert client.get("/api/v1/auth/status", headers=headers).status_code == 401
    assert client.post("/api/v1/account/delete", json={"confirm": "DELETE"}, headers=headers).status_code == 401


def test_deletion_page_is_public_and_explains_how(client):
    response = client.get("/account-deletion")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert "Delete account" in response.text
