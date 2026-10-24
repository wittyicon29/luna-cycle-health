import json
import re
from datetime import date, timedelta

import pytest

from app.models.models import Period
from app.services.llm_service import llm_service
from app.services.prediction_service import (
    format_friendly_date,
    get_cycle_summary,
    tracked_cycles_phrase,
)
from tests.test_analysis import add_periods, ai_user, analyze  # noqa: F401

ISO = re.compile(r"\d{4}-\d{2}-\d{2}")


@pytest.fixture
def ai_down(monkeypatch):
    async def down(*args, **kwargs):
        raise RuntimeError("provider down")

    monkeypatch.setattr(llm_service, "call_medgemma", down)
    monkeypatch.setattr(llm_service, "call_qwen", down)


def test_tracked_cycles_phrase_pluralises():
    assert tracked_cycles_phrase(1) == "1 tracked cycle"
    assert tracked_cycles_phrase(2) == "2 tracked cycles"
    assert tracked_cycles_phrase(0) == "0 tracked cycles"


def test_format_friendly_date_is_portable_and_short():
    assert format_friendly_date(date(2026, 11, 21)) == "Nov 21"
    assert format_friendly_date("2026-03-05") == "Mar 5"
    assert format_friendly_date("not a date") == "not a date"


def test_summary_has_no_score_below_three_cycle_lengths():
    P = lambda d: Period(start_date=d)  # noqa: E731

    base = date(2026, 1, 1)
    two = [P(base), P(base + timedelta(days=28))]
    assert get_cycle_summary(two)["health_score"] is None
    five = [P(base + timedelta(days=28 * i)) for i in range(5)]
    assert isinstance(get_cycle_summary(five)["health_score"], int)


def test_two_periods_give_no_score_and_clean_copy(client, ai_user, db, ai_down):
    user, headers = ai_user
    today = date.today()
    add_periods(db, user, [today - timedelta(days=30), today - timedelta(days=2)])

    response = analyze(client, headers)

    assert response.status_code == 200
    body = response.json()
    assert body["cycle_health_score"] is None
    text = json.dumps(body["user_report"])
    assert "1 tracked cycle" in text
    assert "1 tracked cycles" not in text
    assert "±0" not in text
    assert not ISO.search(body["user_report"]["simple_summary"])
    assert not ISO.search(body["user_report"]["what_to_expect"])
    # machine-readable prediction stays ISO
    assert ISO.search(json.dumps(body["predictions"]))
    assert "1 tracked cycles" not in json.dumps(body["predictions"])
    assert "±0" not in json.dumps(body["predictions"])


def test_five_periods_give_an_int_score(client, ai_user, db, ai_down):
    user, headers = ai_user
    today = date.today()
    add_periods(db, user, [today - timedelta(days=28 * i + 2) for i in range(5)])

    body = analyze(client, headers).json()

    assert isinstance(body["cycle_health_score"], int)
