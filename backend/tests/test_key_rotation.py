"""Key rotation drill for scripts/rotate_encryption_keys.py.

Every test builds its own database (a temp SQLite file, or a throwaway database on the
server named by TEST_POSTGRES_URL) and passes an explicit EncryptionService: the global
encryption_service is built from settings at import time and is only swapped while seeding
and reading rows through the ORM.
"""
import contextlib
import hashlib
import logging
import os
import subprocess
import sys
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.core import crypto_types
from app.core.database import Base
from app.core.encrypted_columns import encrypted_columns
from app.core.encryption import ENCRYPTED_PREFIX, EncryptionService
from app.models.models import (
    Analysis,
    ChatMessage,
    DailyLog,
    Medication,
    Period,
    Questionnaire,
    Subscription,
    User,
)
from scripts import rotate_encryption_keys as cli
from scripts.rotate_encryption_keys import RotationError, rotate_database

BACKEND_DIR = Path(__file__).resolve().parents[1]
TEST_POSTGRES_URL = os.environ.get("TEST_POSTGRES_URL", "")
SENTINEL = "SENTINEL-7f3a"
ROWS_PER_TABLE = 5


# --- fixtures ---------------------------------------------------------------


def _sqlite_engine(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'rotation.db'}")
    Base.metadata.create_all(engine)
    return engine


@contextlib.contextmanager
def _postgres_engine():
    admin_url = make_url(TEST_POSTGRES_URL)
    name = f"luna_rotation_{uuid.uuid4().hex[:12]}"
    admin = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    engine = create_engine(admin_url.set(database=name))
    try:
        Base.metadata.create_all(engine)
        yield engine
    finally:
        engine.dispose()
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{name}"'))
        admin.dispose()


@pytest.fixture(
    params=[
        "sqlite",
        pytest.param(
            "postgres",
            marks=pytest.mark.skipif(
                not TEST_POSTGRES_URL,
                reason="set TEST_POSTGRES_URL to a disposable PostgreSQL server to run the Postgres rotation drill",
            ),
        ),
    ]
)
def db_engine(request, tmp_path):
    if request.param == "sqlite":
        engine = _sqlite_engine(tmp_path)
        yield engine
        engine.dispose()
    else:
        with _postgres_engine() as engine:
            yield engine


@pytest.fixture
def sqlite_engine(tmp_path):
    engine = _sqlite_engine(tmp_path)
    yield engine
    engine.dispose()


@pytest.fixture
def keys():
    return Fernet.generate_key(), Fernet.generate_key(), Fernet.generate_key()


@contextlib.contextmanager
def app_service(service):
    """Make the ORM TypeDecorators use `service` (they read the module global)."""
    original = crypto_types.encryption_service
    crypto_types.encryption_service = service
    try:
        yield
    finally:
        crypto_types.encryption_service = original


# --- helpers ----------------------------------------------------------------


def seed(engine, service, rows=ROWS_PER_TABLE):
    """Realistic rows in every table with an encrypted column, written through the app models."""
    now = datetime(2026, 1, 1)
    with app_service(service), Session(engine) as session:
        for i in range(rows):
            user = User(email=f"user{i}@example.com", hashed_password="x")
            session.add(user)
            session.flush()
            session.add_all(
                [
                    Period(user_id=user.id, start_date=date(2026, 1, 1 + i), notes=f"{SENTINEL} period {i}"),
                    Medication(user_id=user.id, name=f"{SENTINEL} med {i}"),
                    Subscription(
                        user_id=user.id,
                        product_id="premium",
                        purchase_token=f"{SENTINEL} token {i}",
                        token_hash=hashlib.sha256(f"t{i}".encode()).hexdigest(),
                        state="active",
                        expiry_time=now + timedelta(days=30),
                        last_verified_at=now,
                    ),
                    DailyLog(user_id=user.id, log_date=date(2026, 2, 1 + i), data={"mood": f"{SENTINEL} {i}", "n": i}),
                    Questionnaire(user_id=user.id, responses={"pain": {"note": f"{SENTINEL} q{i}"}}),
                    # Every other analysis has no input_data: NULLs are skipped, not counted.
                    Analysis(
                        user_id=user.id,
                        input_data={"cycle": f"{SENTINEL} {i}"} if i % 2 == 0 else None,
                        llm_response=f"{SENTINEL} answer {i}",
                    ),
                    ChatMessage(user_id=user.id, session_id="s", role="user", content=f"{SENTINEL} chat {i}"),
                ]
            )
        session.commit()


MODEL_FIELDS = [
    (Period, "notes"),
    (Medication, "name"),
    (Subscription, "purchase_token"),
    (DailyLog, "data"),
    (Questionnaire, "responses"),
    (Analysis, "input_data"),
    (Analysis, "llm_response"),
    (ChatMessage, "content"),
]


def app_view(engine, service):
    """What the app reads through the ORM with `service` (raises if any row is unreadable)."""
    result = {}
    with app_service(service), Session(engine) as session:
        for model, field in MODEL_FIELDS:
            for row in session.query(model).all():
                result[(model.__tablename__, field, str(row.id))] = getattr(row, field)
    return result


def norm(pk):
    """Same id string whether it came back as a UUID (ORM, Postgres) or as SQLite's hex text."""
    return str(uuid.UUID(str(pk)))


def raw_values(engine, table=None):
    """Stored text of every encrypted column, read with plain SQL (no TypeDecorator)."""
    values = {}
    with engine.connect() as conn:
        for col in encrypted_columns():
            if table and col.table != table:
                continue
            for pk, value in conn.execute(text(f"SELECT id, {col.column} FROM {col.table}")):
                values[(col.table, col.column, norm(pk))] = value
    return values


def checksum(engine):
    digest = hashlib.sha256()
    with engine.connect() as conn:
        for table in Base.metadata.sorted_tables:
            rows = sorted(repr(tuple(r)) for r in conn.execute(text(f"SELECT * FROM {table.name}")))
            digest.update(f"{table.name}:{rows}".encode())
    return digest.hexdigest()


def decrypts_with(key, stored):
    try:
        Fernet(key).decrypt(stored[len(ENCRYPTED_PREFIX):].encode())
        return True
    except InvalidToken:
        return False


def set_raw(engine, table, column, pk, value):
    with engine.begin() as conn:
        pk_value = conn.execute(text(f"SELECT id FROM {table}")).scalars().all()
        target = next(p for p in pk_value if norm(p) == pk)
        conn.execute(text(f"UPDATE {table} SET {column} = :v WHERE id = :pk"), {"v": value, "pk": target})


def first_key(table, column, values):
    return sorted(k for k in values if k[0] == table and k[1] == column)[0]


# --- the drill --------------------------------------------------------------


def test_rotation_drill_k1_to_k2(db_engine, keys):
    k1, k2, _ = keys
    seed(db_engine, EncryptionService([k1]))
    before = app_view(db_engine, EncryptionService([k1]))

    report = rotate_database(db_engine, EncryptionService([k2, k1]), apply=True, batch_size=2, encrypt_legacy=False)

    assert len(report.columns) == len(encrypted_columns()) == 8
    for (table, column), counts in report.columns.items():
        expected = 3 if (table, column) == ("analyses", "input_data") else ROWS_PER_TABLE
        assert counts.total == expected, (table, column)
        assert counts.rotated == expected
        assert counts.already_current == counts.legacy_plaintext == counts.undecryptable == 0
    # The new key alone now reads every encrypted column in every table, unchanged.
    assert app_view(db_engine, EncryptionService([k2])) == before
    for key, stored in raw_values(db_engine).items():
        if stored is not None:
            assert decrypts_with(k2, stored), key
            assert not decrypts_with(k1, stored), key


def test_second_run_is_a_no_op(db_engine, keys):
    k1, k2, _ = keys
    seed(db_engine, EncryptionService([k1]))
    service = EncryptionService([k2, k1])
    rotate_database(db_engine, service, apply=True, batch_size=3, encrypt_legacy=False)
    stored = raw_values(db_engine)

    report = rotate_database(db_engine, service, apply=True, batch_size=3, encrypt_legacy=False)

    assert report.totals().rotated == 0
    assert report.totals().already_current == report.totals().total == 5 * 7 + 3
    assert raw_values(db_engine) == stored


def test_dry_run_changes_nothing(db_engine, keys):
    k1, k2, _ = keys
    seed(db_engine, EncryptionService([k1]))
    before = checksum(db_engine)

    report = rotate_database(db_engine, EncryptionService([k2, k1]), apply=False, batch_size=2, encrypt_legacy=True)

    assert checksum(db_engine) == before
    assert report.totals().rotated == 5 * 7 + 3  # "would rotate"
    assert report.pending == 5 * 7 + 3


def test_failure_after_committed_batches_resumes(db_engine, keys):
    k1, k2, _ = keys
    seed(db_engine, EncryptionService([k1]))
    before = app_view(db_engine, EncryptionService([k1]))
    service = EncryptionService([k2, k1])
    written = []

    def boom(column, count):
        written.append(count)
        if len(written) == 4:
            raise RuntimeError("simulated crash")

    with pytest.raises(RuntimeError):
        rotate_database(db_engine, service, apply=True, batch_size=2, encrypt_legacy=False, after_batch=boom)

    # Half-rotated database: every row still readable with the configured keys.
    done = sum(written)
    assert 4 <= done < 38
    assert app_view(db_engine, service) == before
    stored = [v for v in raw_values(db_engine).values() if v]
    assert sum(decrypts_with(k2, v) for v in stored) == done
    assert sum(decrypts_with(k1, v) for v in stored) == len(stored) - done

    report = rotate_database(db_engine, service, apply=True, batch_size=2, encrypt_legacy=False)

    assert report.totals().already_current == done
    assert report.totals().rotated == len(stored) - done
    assert app_view(db_engine, EncryptionService([k2])) == before


def test_failure_inside_a_batch_rolls_that_batch_back(sqlite_engine, keys):
    k1, k2, _ = keys
    seed(sqlite_engine, EncryptionService([k1]))
    service = EncryptionService([k2, k1])
    real_encrypt = service.encrypt
    calls = []

    def flaky_encrypt(value):
        calls.append(1)
        if len(calls) == 4:  # second row of the second batch
            raise RuntimeError("simulated crash")
        return real_encrypt(value)

    service.encrypt = flaky_encrypt
    written = []
    with pytest.raises(RuntimeError):
        rotate_database(
            sqlite_engine, service, apply=True, batch_size=2, encrypt_legacy=False,
            after_batch=lambda column, count: written.append(count),
        )

    stored = [v for v in raw_values(sqlite_engine).values() if v]
    # Only committed batches are under K2; the row encrypted before the crash was not written.
    assert sum(written) in (2, 3)
    assert sum(decrypts_with(k2, v) for v in stored) == sum(written)
    service.encrypt = real_encrypt
    rotate_database(sqlite_engine, service, apply=True, batch_size=2, encrypt_legacy=False)
    assert all(decrypts_with(k2, v) for v in raw_values(sqlite_engine).values() if v)


def test_only_the_new_key_works_after_rotation(db_engine, keys):
    k1, k2, _ = keys
    seed(db_engine, EncryptionService([k1]))
    rotate_database(db_engine, EncryptionService([k2, k1]), apply=True, batch_size=50, encrypt_legacy=False)

    with pytest.raises(ValueError):
        app_view(db_engine, EncryptionService([k1]))
    assert len(app_view(db_engine, EncryptionService([k2]))) == 5 * 8


def test_unknown_key_aborts_without_partial_batch(db_engine, keys):
    k1, k2, k3 = keys
    seed(db_engine, EncryptionService([k1]))
    rogue = first_key("chat_messages", "content", raw_values(db_engine))
    set_raw(db_engine, "chat_messages", "content", rogue[2], EncryptionService([k3]).encrypt(f"{SENTINEL} rogue"))
    chat_before = raw_values(db_engine, "chat_messages")
    service = EncryptionService([k2, k1])

    with pytest.raises(RotationError) as excinfo:
        rotate_database(db_engine, service, apply=True, batch_size=100, encrypt_legacy=False)

    message = str(excinfo.value)
    assert "chat_messages.content" in message
    assert SENTINEL not in message and ENCRYPTED_PREFIX not in message
    assert excinfo.value.report.columns[("chat_messages", "content")].undecryptable == 1
    # The batch holding the rogue row was not written at all.
    assert raw_values(db_engine, "chat_messages") == chat_before
    # Everything else is still readable with the configured keys.
    with app_service(service), Session(db_engine) as session:
        assert session.query(Period).count() == 5
        assert all(p.notes.startswith(SENTINEL) for p in session.query(Period))


def test_dry_run_counts_undecryptable_rows_and_keeps_going(sqlite_engine, keys):
    k1, k2, k3 = keys
    seed(sqlite_engine, EncryptionService([k1]))
    rogue = first_key("periods", "notes", raw_values(sqlite_engine))
    set_raw(sqlite_engine, "periods", "notes", rogue[2], EncryptionService([k3]).encrypt("x"))

    report = rotate_database(sqlite_engine, EncryptionService([k2, k1]), apply=False, batch_size=2, encrypt_legacy=False)

    assert report.columns[("periods", "notes")].undecryptable == 1
    assert report.columns[("periods", "notes")].rotated == 4
    assert report.columns[("chat_messages", "content")].rotated == 5


def test_legacy_plaintext_untouched_without_flag(db_engine, keys):
    k1, k2, _ = keys
    seed(db_engine, EncryptionService([k1]))
    values = raw_values(db_engine)
    note = first_key("periods", "notes", values)
    log = first_key("daily_logs", "data", values)
    set_raw(db_engine, *note, "legacy plain note")
    set_raw(db_engine, *log, '{"legacy":  true,   "spacing": "kept"}')

    report = rotate_database(db_engine, EncryptionService([k2, k1]), apply=True, batch_size=2, encrypt_legacy=False)

    after = raw_values(db_engine)
    assert after[note] == "legacy plain note"
    assert after[log] == '{"legacy":  true,   "spacing": "kept"}'
    assert report.columns[("periods", "notes")].legacy_plaintext == 1
    assert report.columns[("periods", "notes")].encrypted_legacy == 0
    assert report.columns[("periods", "notes")].rotated == 4


def test_encrypt_legacy_encrypts_the_same_string(db_engine, keys):
    k1, k2, _ = keys
    seed(db_engine, EncryptionService([k1]))
    values = raw_values(db_engine)
    note = first_key("periods", "notes", values)
    log = first_key("daily_logs", "data", values)
    legacy_json = '{"legacy":  true,   "spacing": "kept"}'
    set_raw(db_engine, *note, "legacy plain note")
    set_raw(db_engine, *log, legacy_json)

    report = rotate_database(db_engine, EncryptionService([k2, k1]), apply=True, batch_size=2, encrypt_legacy=True)

    after = raw_values(db_engine)
    k2_only = EncryptionService([k2])
    assert after[note].startswith(ENCRYPTED_PREFIX) and k2_only.decrypt(after[note]) == "legacy plain note"
    assert k2_only.decrypt(after[log]) == legacy_json  # byte-identical, not re-serialised
    assert report.columns[("daily_logs", "data")].encrypted_legacy == 1
    assert report.columns[("daily_logs", "data")].legacy_plaintext == 1
    assert app_view(db_engine, k2_only)[("daily_logs", "data", log[2])] == {"legacy": True, "spacing": "kept"}


def test_json_ciphertext_keeps_the_exact_plaintext_string(sqlite_engine, keys):
    k1, k2, _ = keys
    seed(sqlite_engine, EncryptionService([k1]), rows=1)
    log = first_key("daily_logs", "data", raw_values(sqlite_engine))
    odd = '{ "b" :2,\n "a": [1,  2] }'
    set_raw(sqlite_engine, *log, EncryptionService([k1]).encrypt(odd))

    rotate_database(sqlite_engine, EncryptionService([k2, k1]), apply=True, batch_size=1, encrypt_legacy=False)

    assert EncryptionService([k2]).decrypt(raw_values(sqlite_engine)[log]) == odd


def test_tables_filter(sqlite_engine, keys):
    k1, k2, _ = keys
    seed(sqlite_engine, EncryptionService([k1]))

    report = rotate_database(
        sqlite_engine, EncryptionService([k2, k1]), apply=True, batch_size=2, encrypt_legacy=False, tables=["periods"]
    )

    assert list(report.columns) == [("periods", "notes")]
    assert all(decrypts_with(k2, v) for v in raw_values(sqlite_engine, "periods").values())
    assert all(decrypts_with(k1, v) for v in raw_values(sqlite_engine, "medications").values())


def test_a_new_encrypted_model_is_rotated_too(sqlite_engine, keys):
    """Discovery: an EncryptedText column added to any model is covered without editing the script."""
    from sqlalchemy import Column, Integer

    from app.core.crypto_types import EncryptedText

    k1, k2, _ = keys
    suffix = uuid.uuid4().hex[:8]
    model = type(
        f"RotationProbe{suffix}",
        (Base,),
        {"__tablename__": f"zz_rotation_probe_{suffix}", "id": Column(Integer, primary_key=True), "secret": Column(EncryptedText)},
    )
    try:
        model.__table__.create(sqlite_engine)
        with app_service(EncryptionService([k1])), Session(sqlite_engine) as session:
            session.add_all([model(id=i, secret=f"{SENTINEL} {i}") for i in range(1, 4)])
            session.commit()

        report = rotate_database(sqlite_engine, EncryptionService([k2, k1]), apply=True, batch_size=2, encrypt_legacy=False)

        assert report.columns[(model.__tablename__, "secret")].rotated == 3
        with sqlite_engine.connect() as conn:
            stored = conn.execute(text(f"SELECT secret FROM {model.__tablename__}")).scalars().all()
        assert all(decrypts_with(k2, v) for v in stored)
    finally:
        Base.metadata.remove(model.__table__)


# --- CLI: exit codes and output ---------------------------------------------


def run_cli(args, engine, service, capsys, caplog):
    caplog.set_level(logging.DEBUG)
    # SQLAlchemy's own statement echo is off unless logging is configured for it; the
    # script never enables it. Everything else is captured at DEBUG.
    caplog.set_level(logging.WARNING, logger="sqlalchemy.engine")
    code = cli.main(args, engine=engine, service=service)
    out, err = capsys.readouterr()
    return code, out + err + caplog.text


def assert_no_secrets(output, *keys):
    assert SENTINEL not in output
    assert ENCRYPTED_PREFIX not in output
    for key in keys:
        assert key.decode() not in output


def test_cli_exit_codes_and_counts_only_output(sqlite_engine, keys, capsys, caplog):
    k1, k2, _ = keys
    seed(sqlite_engine, EncryptionService([k1]))
    service = EncryptionService([k2, k1])

    code, output = run_cli([], sqlite_engine, service, capsys, caplog)
    assert code == 2  # dry run with work pending
    assert "dry run" in output.lower() and "periods.notes" in output
    assert_no_secrets(output, k1, k2)

    code, output = run_cli(["--apply", "--batch-size", "2"], sqlite_engine, service, capsys, caplog)
    assert code == 0
    assert_no_secrets(output, k1, k2)

    code, output = run_cli([], sqlite_engine, service, capsys, caplog)
    assert code == 0  # nothing left to do


def test_cli_undecryptable_row_exits_1_without_values(sqlite_engine, keys, capsys, caplog):
    k1, k2, k3 = keys
    seed(sqlite_engine, EncryptionService([k1]))
    rogue = first_key("medications", "name", raw_values(sqlite_engine))
    set_raw(sqlite_engine, *rogue, EncryptionService([k3]).encrypt(f"{SENTINEL} rogue"))

    code, output = run_cli(["--apply"], sqlite_engine, EncryptionService([k2, k1]), capsys, caplog)

    assert code == 1
    assert "medications.name" in output
    assert_no_secrets(output, k1, k2, k3)
    code, output = run_cli([], sqlite_engine, EncryptionService([k2, k1]), capsys, caplog)
    assert code == 1  # dry run reports the undecryptable row as an error too
    assert_no_secrets(output, k1, k2, k3)


def test_cli_legacy_rows_are_pending_only_with_encrypt_legacy(sqlite_engine, keys, capsys, caplog):
    k1, _, _ = keys
    seed(sqlite_engine, EncryptionService([k1]), rows=1)
    service = EncryptionService([Fernet.generate_key(), k1])
    rotate_database(sqlite_engine, service, apply=True, batch_size=10, encrypt_legacy=False)
    set_raw(sqlite_engine, *first_key("periods", "notes", raw_values(sqlite_engine)), f"{SENTINEL} legacy")

    assert run_cli([], sqlite_engine, service, capsys, caplog)[0] == 0
    code, output = run_cli(["--encrypt-legacy"], sqlite_engine, service, capsys, caplog)
    assert code == 2
    assert_no_secrets(output)


def test_cli_single_key(sqlite_engine, keys, capsys, caplog):
    k1, _, _ = keys
    seed(sqlite_engine, EncryptionService([k1]), rows=1)
    single = EncryptionService([k1])
    before = checksum(sqlite_engine)

    code, output = run_cli([], sqlite_engine, single, capsys, caplog)
    assert code == 1 and "--allow-single-key" in output
    code, output = run_cli(["--apply", "--allow-single-key"], sqlite_engine, single, capsys, caplog)
    assert code == 1
    code, output = run_cli(["--allow-single-key"], sqlite_engine, single, capsys, caplog)
    assert code == 0 and "periods.notes" in output
    assert checksum(sqlite_engine) == before


def test_cli_rejects_bad_arguments(sqlite_engine, keys, capsys, caplog):
    service = EncryptionService([keys[1], keys[0]])

    assert run_cli(["--batch-size", "0"], sqlite_engine, service, capsys, caplog)[0] == 1
    assert run_cli(["--tables", "nope"], sqlite_engine, service, capsys, caplog)[0] == 1
    assert run_cli(["--bogus"], sqlite_engine, service, capsys, caplog)[0] == 1


def test_cli_unexpected_error_prints_class_name_only(keys, capsys, caplog):
    engine = create_engine("sqlite:////nonexistent-dir-for-rotation-test/x.db")
    code, output = run_cli([], engine, EncryptionService([keys[1], keys[0]]), capsys, caplog)
    assert code == 1
    assert "OperationalError" in output
    assert "nonexistent-dir" not in output


def _script(tmp_path, keys_value, *args):
    env = {
        "PATH": os.environ.get("PATH", ""),
        "APP_ENV": "testing",
        "SECRET_KEY": "test-secret-key",
        "DATABASE_URL": f"sqlite:///{tmp_path / 'rotation.db'}",
        "ENCRYPTION_KEYS": keys_value,
    }
    return subprocess.run(
        [sys.executable, str(BACKEND_DIR / "scripts" / "rotate_encryption_keys.py"), *args],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )


def test_script_reads_keys_from_settings(sqlite_engine, tmp_path, keys):
    k1, k2, _ = keys
    seed(sqlite_engine, EncryptionService([k1]), rows=2)
    both = f"{k2.decode()},{k1.decode()}"

    dry = _script(tmp_path, both)
    assert dry.returncode == 2, dry.stderr
    applied = _script(tmp_path, both, "--apply")
    assert applied.returncode == 0, applied.stderr
    for result in (dry, applied):
        assert_no_secrets(result.stdout + result.stderr, k1, k2)
    assert all(decrypts_with(k2, v) for v in raw_values(sqlite_engine).values() if v)


def test_script_treats_the_derived_development_key_as_single_key(sqlite_engine, tmp_path):
    result = _script(tmp_path, "", "--apply")

    assert result.returncode == 1
    assert "single" in result.stderr.lower()


# --- guards (each test fails when its guard is removed from the script) ------------------


def test_row_rewritten_by_the_app_during_the_batch_is_left_alone(db_engine, keys):
    """The UPDATE is guarded on the value that was read: a value the app wrote between the
    read and the write (through another connection) survives, counted as changed_during_run."""
    k1, k2, _ = keys
    seed(db_engine, EncryptionService([k1]))
    service = EncryptionService([k2, k1])
    real_encrypt = service.encrypt
    app_value = EncryptionService([k2]).encrypt("written by the app during rotation")
    target = {}

    def encrypt_and_race(plaintext):
        if not target:
            # The app rewrites this very row through a second connection, mid-batch.
            with db_engine.connect() as other:
                for pk, stored in other.execute(text("SELECT id, notes FROM periods")):
                    if stored and EncryptionService([k1]).decrypt(stored) == plaintext:
                        target["pk"] = norm(pk)
                        other.execute(text("UPDATE periods SET notes = :v WHERE id = :pk"), {"v": app_value, "pk": pk})
                        other.commit()
                        break
        return real_encrypt(plaintext)

    service.encrypt = encrypt_and_race
    report = rotate_database(db_engine, service, apply=True, batch_size=100, encrypt_legacy=False, tables=["periods"])

    counts = report.columns[("periods", "notes")]
    assert counts.changed_during_run == 1
    assert counts.rotated == ROWS_PER_TABLE - 1
    stored = raw_values(db_engine, "periods")
    assert stored[("periods", "notes", target["pk"])] == app_value
    assert all(decrypts_with(k2, v) for v in stored.values())


@pytest.mark.parametrize("bad", ["other_plaintext", "old_key"])
def test_a_re_encrypted_value_that_fails_verification_aborts_without_writing(sqlite_engine, keys, bad):
    k1, k2, _ = keys
    seed(sqlite_engine, EncryptionService([k1]))
    service = EncryptionService([k2, k1])
    real_encrypt = service.encrypt
    if bad == "other_plaintext":
        service.encrypt = lambda value: real_encrypt(value + " tampered")
    else:
        service.encrypt = lambda value: EncryptionService([k1]).encrypt(value)  # not under the newest key
    before = checksum(sqlite_engine)

    with pytest.raises(RotationError) as excinfo:
        rotate_database(sqlite_engine, service, apply=True, batch_size=100, encrypt_legacy=False)

    assert "verification" in str(excinfo.value)
    assert SENTINEL not in str(excinfo.value)
    assert checksum(sqlite_engine) == before


@pytest.mark.parametrize("which", ["single", "duplicate"])
def test_rotate_database_refuses_to_write_with_one_distinct_key(sqlite_engine, keys, which):
    k1, _, _ = keys
    seed(sqlite_engine, EncryptionService([k1]), rows=2)
    service = EncryptionService([k1] if which == "single" else [k1, k1])
    before = checksum(sqlite_engine)
    with pytest.raises(RotationError) as excinfo:
        rotate_database(sqlite_engine, service, apply=True, batch_size=10, encrypt_legacy=False)
    assert "fewer than two" in str(excinfo.value)
    assert checksum(sqlite_engine) == before
    # Counting is allowed.
    report = rotate_database(sqlite_engine, service, apply=False, batch_size=10, encrypt_legacy=False)
    assert report.columns[("periods", "notes")].already_current == 2


def test_cli_duplicate_keys_warn_and_count_once(sqlite_engine, keys, capsys, caplog):
    k1, k2, _ = keys
    seed(sqlite_engine, EncryptionService([k1]), rows=1)
    code, output = run_cli([], sqlite_engine, EncryptionService([k1, k1]), capsys, caplog)
    assert code == 1 and "--allow-single-key" in output
    assert "more than once" in output
    assert_no_secrets(output, k1)
    # Duplicates next to a real second key: a warning only, exit codes unchanged.
    code, output = run_cli([], sqlite_engine, EncryptionService([k2, k1, k2]), capsys, caplog)
    assert code == 2 and "more than once" in output
    assert_no_secrets(output, k1, k2)


def test_cli_show_ids_prints_primary_keys_only(sqlite_engine, keys, capsys, caplog):
    k1, k2, k3 = keys
    seed(sqlite_engine, EncryptionService([k1]), rows=3)
    rogue = first_key("chat_messages", "content", raw_values(sqlite_engine))
    set_raw(sqlite_engine, *rogue, EncryptionService([k3]).encrypt(f"{SENTINEL} rogue"))
    service = EncryptionService([k2, k1])

    code, output = run_cli([], sqlite_engine, service, capsys, caplog)
    assert code == 1 and rogue[2] not in output.replace("-", "") and rogue[2] not in output
    for args in (["--show-ids"], ["--show-ids", "--apply"]):
        code, output = run_cli(args, sqlite_engine, service, capsys, caplog)
        assert code == 1
        id_lines = [line for line in output.splitlines() if "undecryptable row" in line]
        assert len(id_lines) == 1, output
        assert "chat_messages.content" in id_lines[0]
        assert rogue[2] in id_lines[0].replace("-", "") or rogue[2] in id_lines[0]
        assert_no_secrets(output, k1, k2, k3)
