from typing import List, Optional

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from .config import settings

ENCRYPTED_PREFIX = "enc:v1:"


class EncryptionService:
    """Encrypts strings with the first key and decrypts with any configured key."""

    def __init__(self, keys: List[bytes]):
        self._fernet = MultiFernet([Fernet(key) for key in keys])

    def encrypt(self, data: Optional[str]) -> Optional[str]:
        if not data:
            return data
        token = self._fernet.encrypt(data.encode("utf-8")).decode("ascii")
        return ENCRYPTED_PREFIX + token

    def decrypt(self, data: Optional[str]) -> Optional[str]:
        # Rows written before encryption was enabled have no prefix: return them as-is.
        if not data or not data.startswith(ENCRYPTED_PREFIX):
            return data
        try:
            token = data[len(ENCRYPTED_PREFIX):].encode("ascii")
            return self._fernet.decrypt(token).decode("utf-8")
        except InvalidToken:
            raise ValueError("Cannot decrypt stored data: ENCRYPTION_KEYS is wrong or missing") from None


encryption_service = EncryptionService(settings.encryption_key_list)
