"""Ciphertexts written by cryptography 42.0.5 (the version before the 2026-11 upgrade) must stay
readable. The two Fernet keys below are throwaway test keys (32 bytes of "A" and of "B"); they
protect nothing. The tokens were produced with cryptography 42.0.5 and are stored without the
"enc:v1:" prefix that EncryptionService adds.
"""
import pytest
from cryptography.fernet import Fernet, InvalidToken

from app.core.encryption import ENCRYPTED_PREFIX, EncryptionService

KEY_NEW = b"QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE="  # base64("A" * 32)
KEY_OLD = b"QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI="  # base64("B" * 32)

# Fernet(KEY_NEW).encrypt("Ünïcode period note 🌙".encode("utf-8")), cryptography 42.0.5
UNICODE_UNDER_NEW = (
    "gAAAAABq8eDWuzhvIdofvk3_HxF8DSvlFFdzK5lpLY2bOpDO9B3-oweV-R45Z_nF6lW7k7TV3qQSAVGUF3pWrYDbBT69"
    "Qd-a5r7A1VKOPOl2_q4tlYHN0UM="
)
UNICODE_PLAINTEXT = "Ünïcode period note 🌙"
# Fernet(KEY_OLD).encrypt(b"old-key data"), cryptography 42.0.5
ASCII_UNDER_OLD = (
    "gAAAAABq8eDWPeyE3JpyndOEVtIjjkkTT3sDgw2J7x1w0raP5JYxqiIlLTwCV9G-5UklNsLPa48xOo7nHoykIpQNPJ6jlhQm0A=="
)
OLD_PLAINTEXT = "old-key data"


@pytest.fixture
def service():
    return EncryptionService([KEY_NEW, KEY_OLD])  # the first key is the current one


def stored(token: str) -> str:
    return ENCRYPTED_PREFIX + token


def test_fixtures_are_real_fernet_tokens_from_the_old_library():
    assert Fernet(KEY_NEW).decrypt(UNICODE_UNDER_NEW.encode()).decode("utf-8") == UNICODE_PLAINTEXT
    assert Fernet(KEY_OLD).decrypt(ASCII_UNDER_OLD.encode()) == OLD_PLAINTEXT.encode()
    with pytest.raises(InvalidToken):
        Fernet(KEY_NEW).decrypt(ASCII_UNDER_OLD.encode())


def test_unicode_ciphertext_under_the_current_key_decrypts(service):
    assert service.decrypt(stored(UNICODE_UNDER_NEW)) == UNICODE_PLAINTEXT
    assert service.is_encrypted(stored(UNICODE_UNDER_NEW))
    assert service.is_current(stored(UNICODE_UNDER_NEW)) is True


def test_ciphertext_under_the_older_key_decrypts_through_multifernet(service):
    assert service.decrypt(stored(ASCII_UNDER_OLD)) == OLD_PLAINTEXT
    assert service.is_current(stored(ASCII_UNDER_OLD)) is False  # rotation would rewrite it


def test_re_encrypting_old_data_makes_it_current(service):
    rewritten = service.encrypt(service.decrypt(stored(ASCII_UNDER_OLD)))
    assert rewritten.startswith(ENCRYPTED_PREFIX)
    assert service.is_current(rewritten) is True
    assert service.decrypt(rewritten) == OLD_PLAINTEXT


def test_with_only_the_old_key_the_old_ciphertext_is_current():
    only_old = EncryptionService([KEY_OLD])
    assert only_old.decrypt(stored(ASCII_UNDER_OLD)) == OLD_PLAINTEXT
    assert only_old.is_current(stored(ASCII_UNDER_OLD)) is True
    assert only_old.is_current(stored(UNICODE_UNDER_NEW)) is False


def test_without_the_right_key_decrypt_fails_closed():
    with pytest.raises(ValueError, match="ENCRYPTION_KEYS"):
        EncryptionService([KEY_NEW]).decrypt(stored(ASCII_UNDER_OLD))


def test_new_library_output_still_reads_as_the_same_format(service):
    token = service.encrypt(UNICODE_PLAINTEXT)[len(ENCRYPTED_PREFIX):]
    assert token.startswith("gAAAAA")  # Fernet version byte 0x80
    assert Fernet(KEY_NEW).decrypt(token.encode()).decode("utf-8") == UNICODE_PLAINTEXT
