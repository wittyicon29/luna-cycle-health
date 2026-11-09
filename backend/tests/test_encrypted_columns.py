import uuid

import pytest
from sqlalchemy import Column, Integer

from app.core.crypto_types import EncryptedJSON, EncryptedText
from app.core.database import Base, engine
from app.core.encrypted_columns import EncryptedColumn, encrypted_columns

KNOWN = {
    ("periods", ("id",), "notes", "text"),
    ("medications", ("id",), "name", "text"),
    ("subscriptions", ("id",), "purchase_token", "text"),
    ("daily_logs", ("id",), "data", "json"),
    ("questionnaires", ("id",), "responses", "json"),
    ("analyses", ("id",), "input_data", "json"),
    ("analyses", ("id",), "llm_response", "text"),
    ("chat_messages", ("id",), "content", "text"),
}


@pytest.fixture
def extra_encrypted_model():
    """A test-only model on the real Base; removed from the metadata afterwards."""
    suffix = uuid.uuid4().hex[:8]
    name = f"zz_test_secrets_{suffix}"
    model = type(
        f"TestSecret{suffix}",
        (Base,),
        {
            "__tablename__": name,
            "id": Column(Integer, primary_key=True),
            "secret": Column(EncryptedText),
            "blob": Column(EncryptedJSON),
        },
    )
    yield model
    model.__table__.drop(bind=engine, checkfirst=True)
    Base.metadata.remove(model.__table__)


def test_discovers_exactly_the_known_encrypted_columns():
    found = encrypted_columns()

    assert {tuple(c) for c in found} == KNOWN
    assert len(found) == len(KNOWN)
    assert all(isinstance(c, EncryptedColumn) for c in found)


def test_entries_unpack_as_table_pk_column_kind():
    table, pk_columns, column_name, kind = encrypted_columns()[0]

    assert isinstance(table, str) and isinstance(pk_columns, tuple)
    assert isinstance(column_name, str) and kind in ("text", "json")


def test_a_new_encrypted_column_is_discovered(extra_encrypted_model):
    name = extra_encrypted_model.__tablename__
    found = {tuple(c) for c in encrypted_columns()}

    assert (name, ("id",), "secret", "text") in found
    assert (name, ("id",), "blob", "json") in found
    assert found - {(name, ("id",), "secret", "text"), (name, ("id",), "blob", "json")} == KNOWN


def test_discovery_accepts_another_metadata():
    from sqlalchemy import MetaData, Table

    md = MetaData()
    Table("plain", md, Column("id", Integer, primary_key=True))
    Table("other", md, Column("id", Integer, primary_key=True), Column("x", EncryptedText))

    assert [tuple(c) for c in encrypted_columns(md)] == [("other", ("id",), "x", "text")]
