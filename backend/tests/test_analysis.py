import json
import re
from datetime import date, timedelta

import pytest

from app.core.security import create_access_token
from app.models.models import Analysis, Period
from app.services.llm_service import llm_service

MESSAGE = "Log at least two periods (about a month apart) so Luna can find your pattern."


@pytest.fixture
def ai_user(client, make_user):
    user = make_user()
    headers = {"Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}"}
    client.post("/api/v1/consents", json={"purpose": "ai_processing", "granted": True}, headers=headers)
    return user, headers


def add_periods(db, user, starts):
    for start in starts:
        db.add(Period(user_id=user.id, start_date=start))
    db.commit()


def analyze(client, headers, analysis_type="cycle_health"):
    return client.post("/api/v1/analysis/", json={"analysis_type": analysis_type}, headers=headers)


def test_no_periods_is_refused_with_a_clear_message(client, ai_user, db):
    _, headers = ai_user

    response = analyze(client, headers)

    assert response.status_code == 400
    assert response.json()["detail"] == MESSAGE
    assert db.query(Analysis).count() == 0


def test_a_single_period_is_refused_and_nothing_is_saved(client, ai_user, db):
    user, headers = ai_user
    add_periods(db, user, [date.today() - timedelta(days=10)])

    response = analyze(client, headers)

    assert response.status_code == 400
    assert response.json()["detail"] == MESSAGE
    assert db.query(Analysis).count() == 0


def test_prediction_type_is_refused_the_same_way(client, ai_user, db):
    user, headers = ai_user
    add_periods(db, user, [date.today() - timedelta(days=10)])

    assert analyze(client, headers, "prediction").status_code == 400


def test_ai_outage_still_never_shows_none(client, ai_user, db, monkeypatch):
    user, headers = ai_user
    today = date.today()
    add_periods(db, user, [today - timedelta(days=58), today - timedelta(days=30), today - timedelta(days=2)])

    async def down(*args, **kwargs):
        raise RuntimeError("provider down")

    monkeypatch.setattr(llm_service, "call_medgemma", down)
    monkeypatch.setattr(llm_service, "call_qwen", down)

    response = analyze(client, headers)

    assert response.status_code == 200
    assert not re.search(r"\bNone\b", json.dumps(response.json()))
