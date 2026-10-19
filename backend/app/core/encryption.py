from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.backends import default_backend
import base64
import os
from ..core.config import settings

class EncryptionService:
    """Service for encrypting/decrypting PHI data."""
    
    def __init__(self):
        self._key = self._derive_key()
        self._cipher = Fernet(self._key)
    
    def _derive_key(self) -> bytes:
        """Derive encryption key from SECRET_KEY."""
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=b'luna_health_salt',  # In production, use env variable
            iterations=100000,
            backend=default_backend()
        )
        key = base64.urlsafe_b64encode(kdf.derive(settings.SECRET_KEY.encode()))
        return key
    
    def encrypt(self, data: str) -> str:
        """Encrypt sensitive data."""
        if not data:
            return data
        encrypted = self._cipher.encrypt(data.encode())
        return base64.urlsafe_b64encode(encrypted).decode()
    
    def decrypt(self, encrypted_data: str) -> str:
        """Decrypt sensitive data."""
        if not encrypted_data:
            return encrypted_data
        decoded = base64.urlsafe_b64decode(encrypted_data.encode())
        decrypted = self._cipher.decrypt(decoded)
        return decrypted.decode()
    
    def encrypt_dict(self, data: dict, sensitive_fields: list) -> dict:
        """Encrypt specific fields in a dictionary."""
        encrypted_data = data.copy()
        for field in sensitive_fields:
            if field in encrypted_data and encrypted_data[field]:
                encrypted_data[field] = self.encrypt(str(encrypted_data[field]))
        return encrypted_data
    
    def decrypt_dict(self, data: dict, sensitive_fields: list) -> dict:
        """Decrypt specific fields in a dictionary."""
        decrypted_data = data.copy()
        for field in sensitive_fields:
            if field in decrypted_data and decrypted_data[field]:
                decrypted_data[field] = self.decrypt(decrypted_data[field])
        return decrypted_data

encryption_service = EncryptionService()

# Define which fields should be encrypted
SENSITIVE_FIELDS = [
    'gender_identity',
    'surgery_details',
    'medication_list',
    'chronic_illnesses',
    'sti_details',
    'ultrasound_findings',
    'additional_notes',
]
