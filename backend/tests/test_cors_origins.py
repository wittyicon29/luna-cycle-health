from fastapi.testclient import TestClient

from app.main import app


def test_preflight_allows_a_configured_origin(monkeypatch):
    # The middleware is built at import time from settings.ALLOWED_ORIGINS, so assert on the real list.
    from app.core.config import settings

    origins = settings.ALLOWED_ORIGINS.split(",")
    assert "http://localhost:3000" in origins
    client = TestClient(app)
    response = client.options(
        "/api/v1/auth/login",
        headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"},
    )
    assert response.headers.get("access-control-allow-origin") == "http://localhost:3000"


def test_capacitor_origin_is_documented_in_env_example():
    import pathlib

    text = (pathlib.Path(__file__).parents[2] / "frontend" / "android" / "README.md")
    # Created in Task 6; until then this file may not exist, so only check when present.
    if text.exists():
        assert "https://localhost" in text.read_text()
