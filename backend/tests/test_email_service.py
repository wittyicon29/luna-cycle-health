import asyncio
import logging

import pytest

from app.core.config import settings
from app.services.email_service import send_email


def _unconfigured(monkeypatch, env):
    monkeypatch.setattr(settings, "APP_ENV", env)
    monkeypatch.setattr(settings, "SMTP_SERVER", None)


@pytest.mark.parametrize("env", ["staging", "production", "testing"])
def test_mock_email_hides_content_outside_development(monkeypatch, capsys, caplog, env):
    _unconfigured(monkeypatch, env)
    caplog.set_level(logging.DEBUG)

    sent = asyncio.run(send_email("a@gmail.com", "Verify", "secret-token-123"))

    out = capsys.readouterr()
    output = out.out + out.err + caplog.text
    assert sent is False
    assert "secret-token-123" not in output
    assert "a@gmail.com" not in output


def test_mock_email_shows_content_in_development(monkeypatch, caplog):
    _unconfigured(monkeypatch, "development")
    caplog.set_level(logging.DEBUG)

    asyncio.run(send_email("a@gmail.com", "Verify", "secret-token-123"))

    assert "secret-token-123" in caplog.text
