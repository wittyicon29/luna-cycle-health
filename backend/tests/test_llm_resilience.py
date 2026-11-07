"""AI provider calls: timeouts from settings, a single bounded retry, and privacy of the logs."""
import asyncio
import json
import logging
from datetime import date, timedelta

import httpx
import pytest

from app.core.config import Settings, settings
from app.core.security import create_access_token
from app.models.models import Period
from app.services import llm_service as llm_module
from app.services.llm_service import LLMService, _post_with_retry, llm_service

PROMPT_SENTINEL = "SNTLprompt7f3a"
RESPONSE_SENTINEL = "SNTLresponse9c1b"
URL = "https://llm.invalid/v1/chat"


class Recorder:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = 0

    def __call__(self, request):
        self.calls += 1
        outcome = self.outcomes.pop(0) if len(self.outcomes) > 1 else self.outcomes[0]
        if isinstance(outcome, Exception):
            raise outcome
        if isinstance(outcome, int):
            return httpx.Response(outcome, text=f"error body {RESPONSE_SENTINEL}")
        return httpx.Response(200, json=outcome)


class Sleeps:
    def __init__(self):
        self.delays = []

    async def __call__(self, delay):
        self.delays.append(delay)


def qwen_ok(text="hello"):
    return {"choices": [{"message": {"content": text}}]}


def run_helper(outcomes):
    recorder, sleeps = Recorder(outcomes), Sleeps()

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(recorder)) as client:
            return await _post_with_retry(client, URL, sleep=sleeps, json={"prompt": PROMPT_SENTINEL})

    return recorder, sleeps, go


def _connect_error():
    return httpx.ConnectError("connection refused", request=httpx.Request("POST", URL))


def _connect_timeout():
    return httpx.ConnectTimeout("connect timed out", request=httpx.Request("POST", URL))


def _read_timeout():
    return httpx.ReadTimeout(f"read timed out {RESPONSE_SENTINEL}", request=httpx.Request("POST", URL))


# --- retry semantics -----------------------------------------------------------------------------


@pytest.mark.parametrize("first", [_connect_error, _connect_timeout, lambda: 502, lambda: 503, lambda: 504])
def test_retries_once_then_succeeds(first):
    recorder, sleeps, go = run_helper([first(), qwen_ok()])
    response = asyncio.run(go())
    assert response.status_code == 200
    assert recorder.calls == 2
    assert sleeps.delays == [0.5]


@pytest.mark.parametrize("status", [400, 401, 403, 404, 422, 429, 500])
def test_no_retry_on_client_errors_rate_limits_and_500(status):
    recorder, sleeps, go = run_helper([status, qwen_ok()])
    with pytest.raises(httpx.HTTPStatusError):
        asyncio.run(go())
    assert recorder.calls == 1 and sleeps.delays == []


def test_no_retry_on_read_timeout():
    recorder, sleeps, go = run_helper([_read_timeout(), qwen_ok()])
    with pytest.raises(httpx.ReadTimeout):
        asyncio.run(go())
    assert recorder.calls == 1 and sleeps.delays == []


@pytest.mark.parametrize("outcomes,exc", [
    ([503, 503, qwen_ok()], httpx.HTTPStatusError),
    ([_connect_error(), _connect_error(), qwen_ok()], httpx.ConnectError),
    ([_connect_error(), 502, qwen_ok()], httpx.HTTPStatusError),
    ([503, _read_timeout(), qwen_ok()], httpx.ReadTimeout),
])
def test_second_failure_raises_without_a_third_attempt(outcomes, exc):
    recorder, sleeps, go = run_helper(outcomes)
    with pytest.raises(exc):
        asyncio.run(go())
    assert recorder.calls == 2 and sleeps.delays == [0.5]


def test_default_sleep_is_asyncio_sleep(monkeypatch):
    delays = []

    async def fake_sleep(delay):
        delays.append(delay)

    monkeypatch.setattr(llm_module.asyncio, "sleep", fake_sleep)
    recorder = Recorder([503, qwen_ok()])

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(recorder)) as client:
            return await _post_with_retry(client, URL, json={})

    assert asyncio.run(go()).status_code == 200
    assert delays == [0.5]


# --- timeouts and call sites ---------------------------------------------------------------------


def make_service(outcomes):
    recorder, sleeps, seen = Recorder(outcomes), Sleeps(), {}

    def factory(**kwargs):
        seen.update(kwargs)
        return httpx.AsyncClient(transport=httpx.MockTransport(recorder), **kwargs)

    return LLMService(client_factory=factory, sleep=sleeps), recorder, sleeps, seen


def test_defaults_for_ai_timeouts():
    s = Settings(_env_file=None)
    assert s.AI_CONNECT_TIMEOUT == 5 and s.AI_READ_TIMEOUT == 45


def test_timeouts_come_from_settings(monkeypatch):
    monkeypatch.setattr(settings, "AI_CONNECT_TIMEOUT", 3.0)
    monkeypatch.setattr(settings, "AI_READ_TIMEOUT", 17.0)
    service, _, _, seen = make_service([qwen_ok("hi")])
    assert asyncio.run(service.call_qwen("question")) == "hi"
    timeout = seen["timeout"]
    assert isinstance(timeout, httpx.Timeout)
    assert (timeout.connect, timeout.read, timeout.write, timeout.pool) == (3.0, 17.0, 10.0, 5.0)


def test_call_qwen_retries_on_503(monkeypatch):
    service, recorder, sleeps, _ = make_service([503, qwen_ok("recovered")])
    assert asyncio.run(service.call_qwen("question", "system")) == "recovered"
    assert recorder.calls == 2 and sleeps.delays == [0.5]


def test_call_medgemma_retries_on_connect_error_and_uses_timeouts():
    service, recorder, sleeps, seen = make_service([_connect_error(), [{"generated_text": "ok"}]])
    assert asyncio.run(service.call_medgemma("prompt")) == "ok"
    assert recorder.calls == 2 and sleeps.delays == [0.5]
    assert seen["timeout"].read == settings.AI_READ_TIMEOUT


def test_call_qwen_does_not_retry_429():
    service, recorder, sleeps, _ = make_service([429, qwen_ok()])
    with pytest.raises(httpx.HTTPStatusError):
        asyncio.run(service.call_qwen("question"))
    assert recorder.calls == 1 and sleeps.delays == []


def test_default_factory_is_httpx_async_client_with_the_ai_timeout():
    client = LLMService()._client()
    try:
        assert type(client) is httpx.AsyncClient
        assert client.timeout == httpx.Timeout(connect=5.0, read=45.0, write=10.0, pool=5.0)
    finally:
        asyncio.run(client.aclose())


# --- logging privacy ----------------------------------------------------------------------------


@pytest.mark.parametrize("outcomes,exc_name", [
    ([503, 503], "HTTPStatusError"),
    ([401], "HTTPStatusError"),
    ([_read_timeout()], "ReadTimeout"),
    ([_connect_error(), _connect_error()], "ConnectError"),
])
def test_failure_logs_class_name_only(caplog, outcomes, exc_name):
    caplog.set_level(logging.DEBUG)
    service, _, _, _ = make_service(outcomes)
    with pytest.raises(httpx.HTTPError):
        asyncio.run(service.call_qwen(f"my secret question {PROMPT_SENTINEL}", f"system {PROMPT_SENTINEL}"))
    failures = [r for r in caplog.records if r.getMessage().startswith("LLM call failed: ")]
    assert failures and all(r.getMessage() == f"LLM call failed: {exc_name}" for r in failures)
    assert all(r.levelno == logging.WARNING for r in failures)
    everything = caplog.text + "".join(repr(r.__dict__) for r in caplog.records)
    assert PROMPT_SENTINEL not in everything
    assert RESPONSE_SENTINEL not in everything
    assert "llm.invalid" not in everything and "huggingface" not in everything and "groq" not in everything


def test_no_print_in_llm_service():
    import inspect

    assert "print(" not in inspect.getsource(llm_module)


# --- end-to-end fallbacks --------------------------------------------------------------------------


@pytest.fixture
def ai_headers(client, make_user, db):
    user = make_user()
    headers = {"Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}"}
    client.post("/api/v1/consents", json={"purpose": "ai_processing", "granted": True}, headers=headers)
    today = date.today()
    for start in (today - timedelta(days=58), today - timedelta(days=30), today - timedelta(days=2)):
        db.add(Period(user_id=user.id, start_date=start))
    db.commit()
    return headers


@pytest.fixture
def providers_down(monkeypatch):
    recorder, sleeps = Recorder([503]), Sleeps()

    def factory(**kwargs):
        return httpx.AsyncClient(transport=httpx.MockTransport(recorder), **kwargs)

    monkeypatch.setattr(llm_service, "_client_factory", factory)
    monkeypatch.setattr(llm_service, "_sleep", sleeps)
    return recorder, sleeps


def test_analysis_returns_fallback_when_both_providers_fail(client, ai_headers, providers_down, caplog):
    caplog.set_level(logging.DEBUG)
    recorder, sleeps = providers_down
    response = client.post("/api/v1/analysis/", json={"analysis_type": "cycle_health"}, headers=ai_headers)
    assert response.status_code == 200
    body = response.json()
    assert "chance your next period" in json.dumps(body)  # the graceful fallback summary
    assert recorder.calls == 4 and sleeps.delays == [0.5, 0.5]  # two providers x (call + one retry)
    assert RESPONSE_SENTINEL not in caplog.text and RESPONSE_SENTINEL not in json.dumps(body)


def test_chat_returns_translated_502_when_provider_fails(client, ai_headers, providers_down, caplog):
    caplog.set_level(logging.DEBUG)
    question = f"private question {PROMPT_SENTINEL}"
    response = client.post("/api/v1/chat/ask", json={"question": question}, headers=ai_headers)
    assert response.status_code == 502
    assert response.json()["detail"] == "Luna is unavailable right now. Please try again in a moment."
    assert PROMPT_SENTINEL not in caplog.text and RESPONSE_SENTINEL not in caplog.text
    assert any(r.getMessage() == "LLM call failed: HTTPStatusError" for r in caplog.records)


# --- overall deadlines (no real waiting beyond a few tens of milliseconds) ------------------------


class Trickle(httpx.AsyncByteStream):
    """A response body that never ends: one byte, then a short pause, forever."""

    async def __aiter__(self):
        while True:
            yield b" "
            await asyncio.sleep(0.005)


def _trickle_handler(request):
    return httpx.Response(200, stream=Trickle())


def test_ai_budget_defaults():
    s = Settings(_env_file=None)
    assert s.AI_TOTAL_TIMEOUT == 50 and s.ANALYSIS_TOTAL_BUDGET == 80


@pytest.mark.parametrize("name", ["AI_TOTAL_TIMEOUT", "ANALYSIS_TOTAL_BUDGET"])
def test_ai_budgets_must_be_positive(name):
    with pytest.raises(ValueError):
        Settings(_env_file=None, **{name: 0})


def test_trickle_response_is_bounded_by_the_total_deadline(monkeypatch, caplog):
    caplog.set_level(logging.DEBUG)
    monkeypatch.setattr(settings, "AI_TOTAL_TIMEOUT", 0.05)

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(_trickle_handler)) as client:
            loop = asyncio.get_running_loop()
            started = loop.time()
            with pytest.raises(llm_module.AITimeoutError):
                await _post_with_retry(client, URL, sleep=Sleeps(), json={"prompt": PROMPT_SENTINEL})
            return loop.time() - started

    assert asyncio.run(go()) < 1.0
    assert issubclass(llm_module.AITimeoutError, TimeoutError)
    assert [r.getMessage() for r in caplog.records if r.getMessage().startswith("LLM call failed")] == [
        "LLM call failed: AITimeoutError"]
    assert PROMPT_SENTINEL not in caplog.text


def test_retry_is_skipped_when_the_budget_cannot_fit_another_attempt(monkeypatch):
    monkeypatch.setattr(settings, "AI_TOTAL_TIMEOUT", 3.0)  # < AI_CONNECT_TIMEOUT (5) + 0.5
    recorder, sleeps, go = run_helper([503, qwen_ok()])
    with pytest.raises(httpx.HTTPStatusError):
        asyncio.run(go())
    assert recorder.calls == 1 and sleeps.delays == []


def test_retry_happens_when_the_budget_fits(monkeypatch):
    monkeypatch.setattr(settings, "AI_TOTAL_TIMEOUT", 6.0)
    monkeypatch.setattr(settings, "AI_CONNECT_TIMEOUT", 1.0)
    recorder, sleeps, go = run_helper([_connect_error(), qwen_ok()])
    assert asyncio.run(go()).status_code == 200
    assert recorder.calls == 2


def test_exhausted_outer_deadline_fails_without_calling(monkeypatch):
    recorder, sleeps, go = run_helper([qwen_ok()])

    async def with_spent_budget():
        token = llm_module._deadline_var.set(asyncio.get_running_loop().time() - 1)
        try:
            return await go()
        finally:
            llm_module._deadline_var.reset(token)

    with pytest.raises(llm_module.AITimeoutError):
        asyncio.run(with_spent_budget())
    assert recorder.calls == 0


def test_analysis_falls_back_within_its_budget(client, ai_headers, monkeypatch, caplog):
    caplog.set_level(logging.DEBUG)
    monkeypatch.setattr(settings, "ANALYSIS_TOTAL_BUDGET", 0.1)

    def factory(**kwargs):
        return httpx.AsyncClient(transport=httpx.MockTransport(_trickle_handler), **kwargs)

    monkeypatch.setattr(llm_service, "_client_factory", factory)
    import time
    started = time.monotonic()
    response = client.post("/api/v1/analysis/", json={"analysis_type": "cycle_health"}, headers=ai_headers)
    assert time.monotonic() - started < 2.0
    assert response.status_code == 200
    assert "chance your next period" in json.dumps(response.json())
    names = {r.getMessage() for r in caplog.records if "call failed" in r.getMessage()}
    assert "LLM call failed: AITimeoutError" in names
    assert {"MedGemma analysis call failed: AITimeoutError", "Qwen analysis call failed: AITimeoutError"} <= names


def test_analysis_gives_medgemma_a_share_and_qwen_the_rest(monkeypatch):
    monkeypatch.setattr(settings, "ANALYSIS_TOTAL_BUDGET", 80.0)
    monkeypatch.setattr(settings, "AI_TOTAL_TIMEOUT", 50.0)
    seen = {}

    async def fake_medgemma(prompt):
        seen["medgemma"] = llm_module._deadline_var.get() - asyncio.get_running_loop().time()
        return "{}"

    async def fake_qwen(prompt, system_prompt=None, **kwargs):
        seen["qwen"] = llm_module._deadline_var.get() - asyncio.get_running_loop().time()
        return "{}"

    service = LLMService()
    monkeypatch.setattr(service, "call_medgemma", fake_medgemma)
    monkeypatch.setattr(service, "call_qwen", fake_qwen)
    asyncio.run(service.analyze_cycle_health([], {}, {}, {}))
    assert 39 < seen["medgemma"] <= 40
    assert 79 < seen["qwen"] <= 80
    assert llm_module._deadline_var.get() is None


def test_chat_returns_translated_502_on_total_timeout(client, ai_headers, monkeypatch, caplog):
    caplog.set_level(logging.DEBUG)
    monkeypatch.setattr(settings, "AI_TOTAL_TIMEOUT", 0.05)

    def factory(**kwargs):
        return httpx.AsyncClient(transport=httpx.MockTransport(_trickle_handler), **kwargs)

    monkeypatch.setattr(llm_service, "_client_factory", factory)
    response = client.post("/api/v1/chat/ask", json={"question": f"q {PROMPT_SENTINEL}"}, headers=ai_headers)
    assert response.status_code == 502
    assert response.json()["detail"] == "Luna is unavailable right now. Please try again in a moment."
    assert any(r.getMessage() == "Chat LLM call failed: AITimeoutError" for r in caplog.records)
    assert PROMPT_SENTINEL not in caplog.text
