"""Password hashing with bcrypt (called directly; passlib was never used and is gone).

The fixture hashes below were produced on 2026-11-10 with bcrypt 5.0.0 as resolved through
the old `passlib[bcrypt]==1.7.4` pin (default cost 12, `$2b$` prefix), before bcrypt was
pinned directly. Every stored password hash in the database was produced the same way, so
these must keep verifying after any bcrypt upgrade.
"""

from pathlib import Path
import re

import bcrypt
import pytest

from app.core.security import get_password_hash, verify_password

BACKEND = Path(__file__).resolve().parents[1]

LEGACY_HASHES = [
    ("Fixture-Passw0rd-before-passlib-removal",
     "$2b$12$E0K7jckjbaWMGjjewtXFt.GZeHisS.Au6xLA1PbOz5srrhwBNPnUq"),
    ("Ünïcode-пароль-密码-9",
     "$2b$12$pUcmuHrdPzQ5G2iWvVcZZOgOpZ.tVSl1z4VgK.6wJtd22izKLzxj6"),
]


@pytest.mark.parametrize("password, stored", LEGACY_HASHES, ids=["ascii", "unicode"])
def test_hashes_made_before_the_change_still_verify(password, stored):
    assert verify_password(password, stored) is True


@pytest.mark.parametrize("password, stored", LEGACY_HASHES, ids=["ascii", "unicode"])
def test_legacy_hashes_reject_wrong_passwords(password, stored):
    assert verify_password(password + "x", stored) is False
    assert verify_password(password.upper(), stored) is False
    assert verify_password("", stored) is False


def test_new_hash_round_trip_uses_bcrypt_2b_cost_12():
    hashed = get_password_hash("correct horse battery staple")
    assert re.fullmatch(r"\$2b\$12\$[./A-Za-z0-9]{53}", hashed)
    assert verify_password("correct horse battery staple", hashed) is True
    assert verify_password("correct horse battery stapl", hashed) is False
    # A fresh salt every time.
    assert get_password_hash("correct horse battery staple") != hashed


def test_seventy_two_byte_password_round_trips():
    password = "é" * 36  # 72 bytes in UTF-8, the most the schemas accept
    assert verify_password(password, get_password_hash(password)) is True


@pytest.mark.parametrize("stored", [None, "", "not-a-bcrypt-hash", "$2b$12$short"])
def test_missing_or_malformed_hashes_never_verify_or_raise(stored):
    assert verify_password("anything", stored) is False


def test_passlib_is_not_a_dependency_and_bcrypt_is_pinned_directly():
    requirements = (BACKEND / "requirements.txt").read_text()
    assert "passlib" not in requirements.lower()
    pin = re.search(r"(?m)^bcrypt==(\S+)$", requirements)
    assert pin, "bcrypt must be pinned exactly in requirements.txt"
    assert pin.group(1) == bcrypt.__version__
    for lock in ("requirements.lock", "requirements-dev.lock"):
        assert "passlib" not in (BACKEND / lock).read_text().lower(), lock


def test_nothing_imports_passlib():
    offenders = [
        str(path.relative_to(BACKEND))
        for folder in ("app", "scripts", "alembic")
        for path in (BACKEND / folder).rglob("*.py")
        if re.search(r"^\s*(?:import|from)\s+passlib\b", path.read_text(), re.M)
    ]
    assert offenders == []
