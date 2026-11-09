from typing import List, Optional

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from .config import settings

ENCRYPTED_PREFIX = "enc:v1:"


class EncryptionService:
    """Encrypts strings with the first key and decrypts with any configured key."""

    def __init__(self, keys: List[bytes]):
        fernets = [Fernet(key) for key in keys]
        self._primary = fernets[0] if fernets else None
        self._fernet = MultiFernet(fernets)
        self.key_count = len(fernets)
        # ENCRYPTION_KEYS=K,K is one key: rotation needs two different ones.
        self.distinct_key_count = len(set(keys))

    @staticmethod
    def is_encrypted(data: Optional[str]) -> bool:
        return bool(data) and data.startswith(ENCRYPTED_PREFIX)

    def is_current(self, data: Optional[str]) -> bool:
        """True when `data` is ciphertext readable with the newest (first) key alone."""
        if not self.is_encrypted(data):
            return False
        try:
            self._primary.decrypt(data[len(ENCRYPTED_PREFIX):].encode("ascii"))
        except (InvalidToken, UnicodeEncodeError):
            return False
        return True

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
