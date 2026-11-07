"""Discover every column stored through EncryptedText / EncryptedJSON.

Used by scripts/rotate_encryption_keys.py so a newly added encrypted column is covered by
key rotation without editing the script.
"""
from typing import List, NamedTuple, Optional, Tuple

from sqlalchemy import MetaData

from .crypto_types import EncryptedJSON, EncryptedText


class EncryptedColumn(NamedTuple):
    table: str
    pk_columns: Tuple[str, ...]
    column: str
    kind: str  # "text" (EncryptedText) or "json" (EncryptedJSON)

    @property
    def label(self) -> str:
        return f"{self.table}.{self.column}"


def _kind(column_type) -> Optional[str]:
    if isinstance(column_type, EncryptedJSON):
        return "json"
    if isinstance(column_type, EncryptedText):
        return "text"
    return None


def encrypted_columns(metadata: Optional[MetaData] = None) -> List[EncryptedColumn]:
    """All encrypted columns in `metadata` (default: the app's models), sorted by table and column."""
    if metadata is None:
        from . import database
        from ..models import models  # noqa: F401  (registers every model on Base.metadata)

        metadata = database.Base.metadata
    found = []
    for table in metadata.tables.values():
        pk_columns = tuple(c.name for c in table.primary_key.columns)
        for column in table.columns:
            kind = _kind(column.type)
            if kind is None:
                continue
            if not pk_columns:
                raise ValueError(f"{table.name}.{column.name} is encrypted but its table has no primary key")
            found.append(EncryptedColumn(table.name, pk_columns, column.name, kind))
    return sorted(found, key=lambda c: (c.table, c.column))
