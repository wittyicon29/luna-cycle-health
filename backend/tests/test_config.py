import pytest
from cryptography.fernet import Fernet

from app.core.config import DEFAULT_SECRET_KEY, Settings

STRONG_SECRET = "a-real-secret-value-0123456789abcdef"


def build(**overrides):
    values = dict(_env_file=None, APP_ENV="production", SECRET_KEY=STRONG_SECRET,
                  ENCRYPTION_KEYS=Fernet.generate_key().decode(),
                  SMTP_SERVER="smtp.example.in", SMTP_USER="mailer",
                  SMTP_PASSWORD="mail-pass", SUPPORT_EMAIL="help@example.in",
                  ALLOWED_HOSTS="api.example.in")
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


def test_db_pool_defaults():
    s = Settings(_env_file=None, APP_ENV="testing")
    assert (s.DB_POOL_SIZE, s.DB_MAX_OVERFLOW, s.DB_POOL_RECYCLE_SECONDS) == (10, 20, 1800)


def test_engine_options_pass_pool_settings_to_postgres():
    from app.core.database import engine_options

    s = Settings(_env_file=None, APP_ENV="testing", DB_POOL_SIZE=3, DB_MAX_OVERFLOW=4,
                 DB_POOL_RECYCLE_SECONDS=60)
    options = engine_options("postgresql://user:pw@db.example.com/luna", s)
    assert options == {"pool_pre_ping": True, "pool_size": 3, "max_overflow": 4, "pool_recycle": 60,
                       "connect_args": {"connect_timeout": 5}}


@pytest.mark.parametrize("env,hidden", [("development", False), ("testing", False), ("production", True), ("staging", True)])
def test_engine_options_hide_sql_parameters_outside_development(env, hidden):
    from app.core.database import engine_options

    s = Settings.model_construct(APP_ENV=env, DB_POOL_SIZE=1, DB_MAX_OVERFLOW=1, DB_POOL_RECYCLE_SECONDS=1)
    for url in ("postgresql://user:pw@db.example.com/luna", "sqlite://"):
        assert engine_options(url, s).get("hide_parameters", False) is hidden


@pytest.mark.parametrize("url", ["sqlite:///./test.db", "sqlite://"])
def test_engine_options_skip_pool_settings_for_sqlite(url):
    from app.core.database import engine_options

    assert engine_options(url, Settings(_env_file=None, APP_ENV="testing")) == {"pool_pre_ping": True}


# --- ALLOWED_ORIGINS wildcard and ALGORITHM (2026-11 dependency upgrades review) -----------------


@pytest.mark.parametrize("origins", ["*", "https://app.example.in,*", " * ", "https://app.example.in, *"])
def test_production_refuses_a_wildcard_origin(origins):
    # Starlette 1.x echoes every Origin (with Allow-Credentials) when '*' is combined with
    # allow_credentials=True, so '*' would let any site make credentialed requests.
    with pytest.raises(ValueError) as excinfo:
        build(ALLOWED_ORIGINS=origins)
    assert "ALLOWED_ORIGINS" in str(excinfo.value)
    assert "app.example.in" not in str(excinfo.value)


@pytest.mark.parametrize("env", ["prod", "staging", ""])
def test_wildcard_origin_is_refused_outside_development_and_testing(env):
    with pytest.raises(ValueError):
        build(APP_ENV=env, ALLOWED_ORIGINS="*")


@pytest.mark.parametrize("env", ["development", "testing"])
def test_development_and_testing_accept_a_wildcard_origin(env):
    assert build(APP_ENV=env, ALLOWED_ORIGINS="*").ALLOWED_ORIGINS == "*"


def test_production_accepts_explicit_origins():
    origins = "https://app.example.in,capacitor://localhost"
    assert build(ALLOWED_ORIGINS=origins).ALLOWED_ORIGINS == origins


@pytest.mark.parametrize("env", ["production", "development", "testing"])
def test_hs256_is_the_default_algorithm(env):
    assert build(APP_ENV=env).ALGORITHM == "HS256"


@pytest.mark.parametrize("env", ["production", "development", "testing"])
@pytest.mark.parametrize("algorithm", ["HS512", "RS256", "none", "hs256", "", "HS256,none"])
def test_only_hs256_is_accepted(env, algorithm):
    with pytest.raises(ValueError) as excinfo:
        build(APP_ENV=env, ALGORITHM=algorithm)
    message = str(excinfo.value)
    assert "ALGORITHM must be HS256" in message
    if algorithm and algorithm != "HS256":
        assert f"'{algorithm}'" not in message and f"input_value={algorithm!r}" not in message
