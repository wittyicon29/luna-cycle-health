import asyncio

from app.core.config import settings
from app.services.email_service import send_email


def _unconfigured(monkeypatch, env):
    monkeypatch.setattr(settings, "APP_ENV", env)
    monkeypatch.setattr(settings, "SMTP_SERVER", None)


def test_mock_email_hides_content_outside_development(monkeypatch, capsys):
    _unconfigured(monkeypatch, "staging")

    sent = asyncio.run(send_email("a@gmail.com", "Verify", "secret-token-123"))

    out = capsys.readouterr()
    assert sent is False
    assert "secret-token-123" not in out.out + out.err
    assert "a@gmail.com" not in out.out + out.err


def test_mock_email_prints_content_in_development(monkeypatch, capsys):
    _unconfigured(monkeypatch, "development")

    asyncio.run(send_email("a@gmail.com", "Verify", "secret-token-123"))

    assert "secret-token-123" in capsys.readouterr().out
