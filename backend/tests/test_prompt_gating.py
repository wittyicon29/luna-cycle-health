from datetime import date, timedelta

import json

from app.models.models import Analysis
from app.services.llm_service import llm_service
from tests.test_analysis import add_periods, ai_user, analyze  # noqa: F401


def stored(db):
    return json.loads(db.query(Analysis).one().llm_response)


def capture(monkeypatch):
    prompts = []

    async def fake(prompt, *args, **kwargs):
        prompts.append(prompt)
        return "{}"

    monkeypatch.setattr(llm_service, "call_medgemma", fake)
    monkeypatch.setattr(llm_service, "call_qwen", fake)
    return prompts


def test_no_score_components_in_prompt_when_score_hidden(client, ai_user, db, monkeypatch):
    user, headers = ai_user
    today = date.today()
    add_periods(db, user, [today - timedelta(days=30), today - timedelta(days=2)])
    prompts = capture(monkeypatch)

    response = analyze(client, headers)

    assert response.status_code == 200
    assert prompts
    for prompt in prompts:
        assert "Regularity:" not in prompt
        assert "Cycle Length:" not in prompt
        assert "Pain Management:" not in prompt
    assert any("not enough data yet" in p for p in prompts)
    assert any("Do not quote or estimate numeric scores" in p for p in prompts)
    assert stored(db)["health_score_breakdown"] == {}


def test_score_components_present_when_score_exists(client, ai_user, db, monkeypatch):
    user, headers = ai_user
    today = date.today()
    add_periods(db, user, [today - timedelta(days=28 * i + 2) for i in range(5)])
    prompts = capture(monkeypatch)

    response = analyze(client, headers)

    assert response.status_code == 200
    assert any("Regularity:" in p for p in prompts)
    assert stored(db)["health_score_breakdown"]
