import pytest
from cryptography.fernet import Fernet

from app.core.config import DEFAULT_SECRET_KEY, Settings

STRONG_SECRET = "a-real-secret-value-0123456789abcdef"


def build(**overrides):
    values = dict(_env_file=None, APP_ENV="production", SECRET_KEY=STRONG_SECRET,
                  ENCRYPTION_KEYS=Fernet.generate_key().decode(),
                  SMTP_SERVER="smtp.example.in", SMTP_USER="mailer",
                  SMTP_PASSWORD="mail-pass", SUPPORT_EMAIL="help@example.in")
    values.update(overrides)
    return Settings(**values)


def test_production_rejects_default_secret_key():
    with pytest.raises(ValueError):
        build(SECRET_KEY=DEFAULT_SECRET_KEY)


def test_production_rejects_short_secret_key():
    with pytest.raises(ValueError):
        build(SECRET_KEY="short")


def test_production_requires_encryption_keys():
    with pytest.raises(ValueError):
        build(ENCRYPTION_KEYS="")


@pytest.mark.parametrize("env", ["prod", "Production", "staging", ""])
def test_unknown_environments_are_treated_like_production(env):
    with pytest.raises(ValueError):
        build(APP_ENV=env, SECRET_KEY=DEFAULT_SECRET_KEY, ENCRYPTION_KEYS="")


@pytest.mark.parametrize("missing", ["SMTP_SERVER", "SMTP_USER", "SMTP_PASSWORD", "SUPPORT_EMAIL"])
def test_production_requires_mail_and_support_settings(missing):
    with pytest.raises(ValueError, match=missing):
        build(**{missing: ""})


@pytest.mark.parametrize("env", ["development", "testing"])
def test_development_and_testing_do_not_require_mail_settings(env):
    settings = build(APP_ENV=env, SMTP_SERVER="", SMTP_USER="", SMTP_PASSWORD="",
                     SUPPORT_EMAIL="", ENCRYPTION_KEYS="", SECRET_KEY="dev")

    assert len(settings.encryption_key_list) == 1


def test_settings_errors_do_not_echo_secret_values():
    with pytest.raises(ValueError) as exc:
        Settings(_env_file=None, APP_ENV="production", SECRET_KEY="short-secret-value-XYZ",
                 ENCRYPTION_KEYS="not-a-key")

    assert "short-secret-value-XYZ" not in str(exc.value)
    assert "not-a-key" not in str(exc.value)


def test_malformed_encryption_key_is_rejected_in_any_environment():
    with pytest.raises(ValueError):
        build(APP_ENV="development", ENCRYPTION_KEYS="not-a-fernet-key")


def test_production_accepts_valid_settings():
    settings = build()

    assert len(settings.encryption_key_list) == 1


def test_development_derives_a_key_when_none_is_configured():
    settings = build(APP_ENV="development", SECRET_KEY="dev", ENCRYPTION_KEYS="")

    assert len(settings.encryption_key_list) == 1
    Fernet(settings.encryption_key_list[0])  # must be a valid Fernet key


def test_multiple_keys_keep_their_order():
    first, second = Fernet.generate_key(), Fernet.generate_key()
    settings = build(ENCRYPTION_KEYS=f"{first.decode()}, {second.decode()}")

    assert settings.encryption_key_list == [first, second]


def test_verification_email_uses_frontend_url(monkeypatch):
    from app.api.email_verification import create_verification_email
    from app.core.config import settings

    monkeypatch.setattr(settings, "FRONTEND_URL", "https://app.example.in")

    body = create_verification_email("tok123", "a@gmail.com")

    assert "https://app.example.in/verify-email?token=tok123" in body
    assert "localhost" not in body
