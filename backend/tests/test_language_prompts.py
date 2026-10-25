import hashlib
import json
from datetime import date

import pytest

from app.models.models import Analysis
from app.services.language import SUPPORTED_LANGUAGES, language_instruction
from app.services.llm_service import llm_service
from tests.test_analysis import add_periods, ai_user  # noqa: F401
from tests.test_chat import ai_headers  # noqa: F401

# SHA-256 of the prompts produced by the code at base commit 5fb4f5c (before any
# language support), for the fixed fixtures below. English must stay byte-identical.
GOLDEN = {
    "chat_user_no_context": "8b808de67c78a95faa8d4343de4e14eb87146ef0aa17e1915d7c74155861e4f0",
    "chat_system": "06af8a2c63ec22f7aa07cb4abde77c3416b37062205c5a3201119b28f255eff5",
    "chat_user_with_context": "80132a73b534d650a94d1370a613d8040b1dce4eafb5a0cd7568235127ff1f05",
    "medgemma": "ef2738387835f1da8d2457b5fa0ac8126bc48a0e35dfac5e449195304f23d6e9",
    "qwen_user": "16e74309375b591802614ca57a83bebde32c8cc43fff8348fe3434cb5085efef",
    "qwen_system": "9c7ec41778cd554cbc79b81f41dee0eb3d344aef1322aa664121d646a5b0a9e3",
}

HINDI_VALUES = {
    "simple_summary": "आपका अगला पीरियड लगभग 24 अप्रैल को आ सकता है।",
    "key_insights": ["आपका चक्र काफी नियमित है"],
    "recommendations": ["रोज़ पानी पिएं"],
}


def sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


@pytest.fixture
def captured(monkeypatch):
    calls = {"qwen": [], "medgemma": []}
    answer = {"qwen": "{}"}

    async def fake_qwen(prompt, system_prompt=None, **kwargs):
        calls["qwen"].append((prompt, system_prompt))
        calls.setdefault("kwargs", []).append(kwargs)
        return answer["qwen"]

    async def fake_medgemma(prompt):
        calls["medgemma"].append(prompt)
        return "{}"

    monkeypatch.setattr(llm_service, "call_qwen", fake_qwen)
    monkeypatch.setattr(llm_service, "call_medgemma", fake_medgemma)
    calls["answer"] = answer
    return calls


@pytest.fixture
def fixed_periods(ai_user, db):
    user, headers = ai_user
    add_periods(db, user, [date(2025, 1, 1), date(2025, 1, 29), date(2025, 2, 27), date(2025, 3, 27)])
    return headers


def chat(client, headers, **extra):
    body = {"question": "hi there", **extra}
    return client.post("/api/v1/chat/ask", json=body, headers=headers)


def analyze_with(client, headers, **extra):
    return client.post("/api/v1/analysis/", json={"analysis_type": "cycle_health", **extra}, headers=headers)


def test_chat_prompt_unchanged_for_english(client, fixed_periods, captured):
    # The golden context includes the latest stored analysis, so analyse first (as at capture time).
    assert analyze_with(client, fixed_periods).status_code == 200
    captured["qwen"].clear()
    assert chat(client, fixed_periods, include_context=False).status_code == 200
    assert chat(client, fixed_periods).status_code == 200
    assert chat(client, fixed_periods, language="en").status_code == 200

    (u1, s1), (u2, s2), (u3, s3) = captured["qwen"]
    assert sha(u1) == GOLDEN["chat_user_no_context"]
    assert sha(u2) == GOLDEN["chat_user_with_context"]
    assert {sha(s1), sha(s2), sha(s3)} == {GOLDEN["chat_system"]}
    assert u3 == u2
    assert "Hindi" not in s1 and "Devanagari" not in s1


def test_chat_prompt_adds_hindi_instruction_once(client, fixed_periods, captured):
    assert chat(client, fixed_periods, include_context=False).status_code == 200
    assert chat(client, fixed_periods, include_context=False, language="hi").status_code == 200

    (u_en, s_en), (u_hi, s_hi) = captured["qwen"]
    instruction = language_instruction("hi")
    assert s_hi.count(instruction) == 1
    assert s_hi == s_en + "\n\n" + instruction
    assert u_hi == u_en


def test_analysis_prompt_unchanged_for_english(client, fixed_periods, captured):
    assert analyze_with(client, fixed_periods).status_code == 200

    assert [sha(p) for p in captured["medgemma"]] == [GOLDEN["medgemma"]]
    ((prompt, system),) = captured["qwen"]
    assert sha(prompt) == GOLDEN["qwen_user"]
    assert sha(system) == GOLDEN["qwen_system"]
    assert "Hindi" not in prompt


def test_analysis_explicit_en_matches_omitted(client, fixed_periods, captured):
    assert analyze_with(client, fixed_periods, language="en").status_code == 200
    assert sha(captured["qwen"][0][0]) == GOLDEN["qwen_user"]
    assert [sha(p) for p in captured["medgemma"]] == [GOLDEN["medgemma"]]


def test_analysis_prompt_keeps_json_keys_english(client, fixed_periods, captured):
    assert analyze_with(client, fixed_periods, language="hi").status_code == 200

    ((prompt, system),) = captured["qwen"]
    instruction = language_instruction("hi", structured=True)
    assert prompt.count(instruction) == 1
    assert "every key in English" in prompt
    assert prompt.startswith("Convert medical analysis")
    assert sha(system) == GOLDEN["qwen_system"]
    # The structural prompt itself is the English one plus the instruction.
    assert prompt.endswith("\n\n" + instruction)
    # Clinical (MedGemma) prompt is unchanged.
    assert [sha(p) for p in captured["medgemma"]] == [GOLDEN["medgemma"]]


def test_hindi_values_round_trip(client, fixed_periods, captured, db):
    captured["answer"]["qwen"] = json.dumps(HINDI_VALUES, ensure_ascii=False)

    response = analyze_with(client, fixed_periods, language="hi")

    assert response.status_code == 200
    report = response.json()["user_report"]
    assert report["simple_summary"] == HINDI_VALUES["simple_summary"]
    assert report["key_insights"] == HINDI_VALUES["key_insights"]
    assert report["recommendations"] == HINDI_VALUES["recommendations"]
    db.expire_all()
    row = db.query(Analysis).one()
    assert row.analysis_type == "cycle_health"
    assert row.recommendations == HINDI_VALUES["recommendations"]
    stored = json.loads(row.llm_response)
    assert stored["simple_summary"] == HINDI_VALUES["simple_summary"]
    assert "simple_summary" in stored and "key_insights" in stored


@pytest.mark.parametrize("bad", ["fr", "", "None", "HI", "En", None, 5, ["hi"]])
def test_unknown_language_is_422(client, fixed_periods, captured, bad):
    assert chat(client, fixed_periods, language=bad).status_code == 422
    assert analyze_with(client, fixed_periods, language=bad).status_code == 422
    assert captured["qwen"] == [] and captured["medgemma"] == []


def test_language_instruction_content():
    hi = language_instruction("hi")
    assert "Hindi" in hi and "Devanagari" in hi
    assert "Hinglish" in hi
    assert "simple everyday words" in hi
    assert "medicine names exactly as written" in hi
    assert "JSON" not in hi
    structured = language_instruction("hi", structured=True)
    assert structured.startswith(hi) and "every key in English" in structured
    assert language_instruction("en") == ""
    assert language_instruction("en", structured=True) == ""
    assert SUPPORTED_LANGUAGES == ("en", "hi")


def test_requests_without_language_still_accepted(client, fixed_periods, captured):
    assert chat(client, fixed_periods).status_code == 200
    assert analyze_with(client, fixed_periods).status_code == 200


def test_max_tokens_default_for_english_and_higher_for_hindi_chat(client, fixed_periods, captured):
    assert chat(client, fixed_periods).status_code == 200
    assert chat(client, fixed_periods, language="hi").status_code == 200
    assert captured["kwargs"] == [{}, {"max_tokens": 4096}]


def test_max_tokens_default_for_english_and_higher_for_hindi_analysis(client, fixed_periods, captured):
    assert analyze_with(client, fixed_periods).status_code == 200
    assert analyze_with(client, fixed_periods, language="hi").status_code == 200
    assert captured["kwargs"] == [{}, {"max_tokens": 4096}]


@pytest.mark.parametrize("language,expected", [("en", 2048), (None, 2048), ("hi", 4096)])
def test_call_qwen_payload_max_tokens(monkeypatch, language, expected):
    import asyncio

    sent = {}

    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {"choices": [{"message": {"content": "ok"}}]}

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None, headers=None):
            sent.update(json)
            return FakeResponse()

    monkeypatch.setattr("app.services.llm_service.httpx.AsyncClient", FakeClient)
    kwargs = {"max_tokens": 4096} if language == "hi" else {}
    asyncio.run(llm_service.call_qwen("p", "s", **kwargs))
    assert sent["max_tokens"] == expected


def test_truncated_hindi_json_falls_back_cleanly(client, fixed_periods, captured):
    full = json.dumps(HINDI_VALUES, ensure_ascii=False)
    captured["answer"]["qwen"] = full[: len(full) // 2]

    response = analyze_with(client, fixed_periods, language="hi")

    assert response.status_code == 200
    report = response.json()["user_report"]
    assert report["simple_summary"] == "Your cycle data has been analyzed."
    assert report["recommendations"] == ["Please consult with a healthcare provider."]
