import pytest

from app.core.config import Settings, settings
from tests.test_config import build as build_prod


def make(**overrides):
    return Settings(_env_file=None, APP_ENV="testing", **overrides)


def test_global_default_is_off():
    assert settings.BILLING_MODE == "off"


def test_off_needs_nothing_else():
    s = make()
    assert s.BILLING_MODE == "off"
    assert s.BILLING_REVERIFY_AFTER_HOURS == 6
    assert s.BILLING_OUTAGE_GRACE_HOURS == 24
    assert s.billing_product_ids == []


def test_product_ids_split_and_strip():
    assert make(BILLING_PRODUCT_IDS=" a , b,,c ").billing_product_ids == ["a", "b", "c"]


def test_google_ok_with_everything(tmp_path):
    key = tmp_path / "sa.json"
    key.write_text("{}")
    s = make(BILLING_MODE="google", GOOGLE_PLAY_PACKAGE_NAME="com.example.app",
             BILLING_PRODUCT_IDS="luna_ai", GOOGLE_PLAY_SERVICE_ACCOUNT_FILE=str(key))
    assert s.BILLING_MODE == "google"


@pytest.mark.parametrize("missing", ["package", "products", "file"])
def test_google_requires_each_setting(tmp_path, missing):
    key = tmp_path / "sa.json"
    key.write_text("{}")
    values = dict(BILLING_MODE="google", GOOGLE_PLAY_PACKAGE_NAME="com.example.app",
                  BILLING_PRODUCT_IDS="luna_ai", GOOGLE_PLAY_SERVICE_ACCOUNT_FILE=str(key))
    values[{"package": "GOOGLE_PLAY_PACKAGE_NAME", "products": "BILLING_PRODUCT_IDS",
            "file": "GOOGLE_PLAY_SERVICE_ACCOUNT_FILE"}[missing]] = ""
    with pytest.raises(ValueError):
        make(**values)


def test_google_rejects_unreadable_file(tmp_path):
    with pytest.raises(ValueError):
        make(BILLING_MODE="google", GOOGLE_PLAY_PACKAGE_NAME="com.example.app",
             BILLING_PRODUCT_IDS="luna_ai",
             GOOGLE_PLAY_SERVICE_ACCOUNT_FILE=str(tmp_path / "missing.json"))


def test_google_allowed_in_production(tmp_path):
    key = tmp_path / "sa.json"
    key.write_text("{}")
    s = build_prod(BILLING_MODE="google", GOOGLE_PLAY_PACKAGE_NAME="com.example.app",
                   BILLING_PRODUCT_IDS="luna_ai", GOOGLE_PLAY_SERVICE_ACCOUNT_FILE=str(key))
    assert s.BILLING_MODE == "google"


def test_test_mode_allowed_in_development_and_testing():
    for env in ("development", "testing"):
        assert Settings(_env_file=None, APP_ENV=env, BILLING_MODE="test").BILLING_MODE == "test"


@pytest.mark.parametrize("env", ["production", "staging", ""])
def test_test_mode_refused_outside_dev(env):
    with pytest.raises(ValueError):
        Settings(_env_file=None, APP_ENV=env, BILLING_MODE="test")


def test_test_mode_refused_in_production_build():
    with pytest.raises(ValueError):
        build_prod(BILLING_MODE="test")


def test_unknown_mode_rejected():
    with pytest.raises(ValueError):
        make(BILLING_MODE="paypal")
