from datetime import date

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import text

from app.core.encryption import ENCRYPTED_PREFIX, EncryptionService, encryption_service
from app.models.models import Analysis, ChatMessage, Period, Questionnaire


def test_round_trip():
    token = encryption_service.encrypt("my private note")

    assert token.startswith(ENCRYPTED_PREFIX)
    assert "private" not in token
    assert encryption_service.decrypt(token) == "my private note"


def test_none_and_empty_pass_through():
    assert encryption_service.encrypt(None) is None
    assert encryption_service.encrypt("") == ""
    assert encryption_service.decrypt(None) is None
    assert encryption_service.decrypt("") == ""


def test_legacy_plaintext_is_returned_unchanged():
    assert encryption_service.decrypt("written before encryption existed") == "written before encryption existed"


def test_wrong_key_fails_loudly():
    token = EncryptionService([Fernet.generate_key()]).encrypt("secret")

    with pytest.raises(ValueError):
        EncryptionService([Fernet.generate_key()]).decrypt(token)


def test_old_data_is_readable_after_key_rotation():
    old_key, new_key = Fernet.generate_key(), Fernet.generate_key()
    token = EncryptionService([old_key]).encrypt("secret")

    rotated = EncryptionService([new_key, old_key])

    assert rotated.decrypt(token) == "secret"
    assert EncryptionService([new_key]).decrypt(rotated.encrypt("fresh")) == "fresh"


def raw(db, sql):
    return db.execute(text(sql)).scalar_one()


def test_period_notes_are_encrypted_at_rest(db, make_user):
    user = make_user()
    db.add(Period(user_id=user.id, start_date=date(2026, 1, 1), notes="private note"))
    db.commit()

    stored = raw(db, "SELECT notes FROM periods")
    assert stored.startswith(ENCRYPTED_PREFIX)
    assert "private note" not in stored
    db.expire_all()
    assert db.query(Period).one().notes == "private note"


def test_legacy_plaintext_rows_still_load(db, make_user):
    user = make_user()
    db.add(Period(user_id=user.id, start_date=date(2026, 1, 1)))
    db.commit()
    db.execute(text("UPDATE periods SET notes = 'old plaintext note'"))
    db.commit()
    db.expire_all()

    assert db.query(Period).one().notes == "old plaintext note"


def test_questionnaire_responses_are_encrypted_json(db, make_user):
    user = make_user()
    db.add(Questionnaire(user_id=user.id, responses={"pain": {"severity": 7}}))
    db.commit()

    stored = raw(db, "SELECT responses FROM questionnaires")
    assert stored.startswith(ENCRYPTED_PREFIX)
    assert "severity" not in stored
    db.expire_all()
    assert db.query(Questionnaire).one().responses == {"pain": {"severity": 7}}


def test_legacy_plaintext_json_questionnaire_still_loads(db, make_user):
    user = make_user()
    db.add(Questionnaire(user_id=user.id, responses={"a": 1}))
    db.commit()
    db.execute(text("""UPDATE questionnaires SET responses = '{"a": 2}'"""))
    db.commit()
    db.expire_all()

    assert db.query(Questionnaire).one().responses == {"a": 2}


def test_chat_content_is_encrypted_at_rest(db, make_user):
    user = make_user()
    db.add(ChatMessage(user_id=user.id, session_id="s1", role="user", content="I feel anxious"))
    db.commit()

    assert "anxious" not in raw(db, "SELECT content FROM chat_messages")
    db.expire_all()
    assert db.query(ChatMessage).one().content == "I feel anxious"


def test_analysis_inputs_and_llm_text_are_encrypted(db, make_user):
    user = make_user()
    db.add(Analysis(user_id=user.id, analysis_type="cycle_health",
                    input_data={"periods": [{"notes": "x"}]}, llm_response="long reply"))
    db.commit()

    assert "periods" not in raw(db, "SELECT input_data FROM analyses")
    assert "long reply" not in raw(db, "SELECT llm_response FROM analyses")
    db.expire_all()
    stored = db.query(Analysis).one()
    assert stored.input_data == {"periods": [{"notes": "x"}]}
    assert stored.llm_response == "long reply"
