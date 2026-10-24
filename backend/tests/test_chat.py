from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from app.api.chat import messages_sent_today
from app.models.models import ChatMessage
from app.services.llm_service import llm_service

IST = ZoneInfo("Asia/Kolkata")


@pytest.fixture
def ai_headers(client, auth_headers):
    client.post("/api/v1/consents", json={"purpose": "ai_processing", "granted": True}, headers=auth_headers)
    return auth_headers


@pytest.fixture
def fake_llm(monkeypatch):
    async def fake(prompt, system_prompt=None):
        return "Hello from Luna"

    monkeypatch.setattr(llm_service, "call_qwen", fake)


def ask(client, headers, question="How long is a typical cycle?"):
    return client.post("/api/v1/chat/ask", json={"question": question}, headers=headers)


def test_chat_happy_path_stores_both_messages(client, ai_headers, fake_llm, db):
    response = ask(client, ai_headers)

    assert response.status_code == 200
    assert response.json()["answer"] == "Hello from Luna"
    assert [m.role for m in db.query(ChatMessage).order_by(ChatMessage.created_at)] == ["user", "assistant"]


def test_llm_failure_hides_details_and_stores_nothing(client, ai_headers, db, monkeypatch):
    async def boom(prompt, system_prompt=None):
        raise RuntimeError("secret upstream detail gsk_abc123")

    monkeypatch.setattr(llm_service, "call_qwen", boom)

    response = ask(client, ai_headers)

    assert response.status_code == 502
    assert "secret" not in response.text and "gsk_" not in response.text
    assert db.query(ChatMessage).count() == 0


@pytest.mark.parametrize("question", ["", "x" * 1001])
def test_question_length_is_limited(client, ai_headers, fake_llm, question):
    assert ask(client, ai_headers, question).status_code == 422


def test_daily_quota_is_enforced(client, ai_headers, fake_llm, monkeypatch):
    monkeypatch.setattr("app.api.chat.settings.CHAT_DAILY_LIMIT", 2)

    codes = [ask(client, ai_headers).status_code for _ in range(3)]

    assert codes == [200, 200, 429]


def test_quota_day_starts_at_midnight_ist(db, make_user):
    user = make_user()
    midnight_ist = datetime.now(IST).replace(hour=0, minute=0, second=0, microsecond=0)
    midnight_utc = midnight_ist.astimezone(timezone.utc).replace(tzinfo=None)
    db.add_all([
        ChatMessage(user_id=user.id, session_id="s", role="user", content="late last night",
                    created_at=midnight_utc - timedelta(minutes=1)),
        ChatMessage(user_id=user.id, session_id="s", role="user", content="just after midnight",
                    created_at=midnight_utc + timedelta(minutes=1)),
        ChatMessage(user_id=user.id, session_id="s", role="assistant", content="reply",
                    created_at=midnight_utc + timedelta(minutes=2)),
    ])
    db.commit()

    assert messages_sent_today(db, user.id) == 1
