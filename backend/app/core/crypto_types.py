import json

from sqlalchemy import Text
from sqlalchemy.types import TypeDecorator

from .encryption import encryption_service


class EncryptedText(TypeDecorator):
    """Text column stored encrypted; Python sees plain str."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return encryption_service.encrypt(value)

    def process_result_value(self, value, dialect):
        return encryption_service.decrypt(value)


class EncryptedJSON(TypeDecorator):
    """JSON document stored as encrypted text; Python sees dict/list."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return encryption_service.encrypt(json.dumps(value))

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return json.loads(encryption_service.decrypt(value))
