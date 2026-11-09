"""Backup and restore drills against a disposable PostgreSQL server.

Runs scripts/backup_db.sh and scripts/restore_db.sh as subprocesses. Needs
TEST_POSTGRES_URL (a throwaway server: every test creates and drops its own
luna_backup_* / luna_restore_* databases), `age`/`age-keygen` and the PostgreSQL client
tools (pg_dump, pg_restore, psql); otherwise each test skips with the reason.

The source database is seeded through the app models with the real EncryptionService
(the ORM TypeDecorators read the module-global service, swapped while seeding), so the
dump holds realistic `enc:v1:` ciphertext plus plaintext columns (e-mails) that would
give a plaintext dump away.
"""

import contextlib
import hashlib
import json
import os
import shutil
import signal
import stat
import subprocess
import threading
import time
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.core import crypto_types
from app.core.database import Base
from app.core.encryption import EncryptionService
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

REPO = Path(__file__).resolve().parents[2]
BACKUP = REPO / "scripts" / "backup_db.sh"
RESTORE = REPO / "scripts" / "restore_db.sh"
TEST_POSTGRES_URL = os.environ.get("TEST_POSTGRES_URL", "")
SENTINEL = "SENTINEL-b4c2"
EMAIL_MARK = "drill-user"
ROWS = 6
AGE_HEADER = b"age-encryption.org/v1\n"
# Anything a plaintext custom-format dump (or a SQL dump) would contain.
PLAINTEXT_MARKERS = (b"PGDMP", EMAIL_MARK.encode(), b"CREATE TABLE", b"COPY public.", b"enc:v1:")

_missing = [tool for tool in ("age", "age-keygen", "pg_dump", "pg_restore", "psql") if not shutil.which(tool)]
pytestmark = [
    pytest.mark.skipif(not TEST_POSTGRES_URL, reason="set TEST_POSTGRES_URL to a disposable PostgreSQL server to run the backup drills"),
    pytest.mark.skipif(bool(_missing), reason=f"backup drills need {', '.join(_missing) or 'nothing'} on PATH"),
]


# --- databases ---------------------------------------------------------------------


@pytest.fixture
def server():
    """Admin engine on the throwaway server; drops every database the test registers."""
    admin_url = make_url(TEST_POSTGRES_URL)
    admin = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    names = []

    def url_for(name):
        return admin_url.set(database=name)

    def new_name(prefix):
        name = f"{prefix}_{uuid.uuid4().hex[:12]}"
        names.append(name)
        return name

    def exists(name):
        with admin.connect() as conn:
            return conn.execute(text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": name}).first() is not None

    def create(name):
        with admin.connect() as conn:
            conn.execute(text(f'CREATE DATABASE "{name}"'))

    yield type("Server", (), {"admin": admin, "url_for": staticmethod(url_for), "new_name": staticmethod(new_name),
                              "exists": staticmethod(exists), "create": staticmethod(create)})
    with admin.connect() as conn:
        for name in names:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
    admin.dispose()


def dsn(url):
    """libpq URL (no SQLAlchemy driver suffix), password included when the URL has one."""
    return url.set(drivername="postgresql").render_as_string(hide_password=False)


@contextlib.contextmanager
def app_service(service):
    original = crypto_types.encryption_service
    crypto_types.encryption_service = service
    try:
        yield
    finally:
        crypto_types.encryption_service = original


def seed(engine, service, rows=ROWS, start=0):
    now = datetime(2026, 1, 1)
    with app_service(service), Session(engine) as session:
        for i in range(start, start + rows):
            user = User(email=f"{EMAIL_MARK}{i}@example.com", hashed_password="x")
            session.add(user)
            session.flush()
            session.add_all(
                [
                    Period(user_id=user.id, start_date=date(2026, 1, 1) + timedelta(days=i), notes=f"{SENTINEL} period {i}"),
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
                    DailyLog(user_id=user.id, log_date=date(2026, 2, 1) + timedelta(days=i), data={"mood": f"{SENTINEL} {i}"}),
                    Questionnaire(user_id=user.id, responses={"pain": {"note": f"{SENTINEL} q{i}"}}),
                    Analysis(user_id=user.id, input_data={"cycle": f"{SENTINEL} {i}"}, llm_response=f"{SENTINEL} answer {i}"),
                    ChatMessage(user_id=user.id, session_id="s", role="user", content=f"{SENTINEL} chat {i}"),
                ]
            )
        session.commit()


MODEL_FIELDS = [(Period, "notes"), (Medication, "name"), (Subscription, "purchase_token"), (DailyLog, "data"),
                (Questionnaire, "responses"), (Analysis, "input_data"), (Analysis, "llm_response"), (ChatMessage, "content")]


def app_view(engine, service):
    result = {}
    with app_service(service), Session(engine) as session:
        for model, field in MODEL_FIELDS:
            for row in session.query(model).all():
                result[(model.__tablename__, field, str(row.id))] = getattr(row, field)
    return result


def table_counts(engine):
    with engine.connect() as conn:
        names = conn.execute(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")).scalars().all()
        return {name: conn.execute(text(f'SELECT count(*) FROM "{name}"')).scalar() for name in names}


@pytest.fixture
def key():
    return Fernet.generate_key()


@pytest.fixture
def source(server, key):
    """A seeded source database; yields (sqlalchemy url, engine)."""
    name = server.new_name("luna_backup")
    server.create(name)
    url = server.url_for(name)
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    seed(engine, EncryptionService([key]))
    yield url, engine
    engine.dispose()


# --- age keys and script runs ----------------------------------------------------------


@pytest.fixture
def age_keys(tmp_path):
    """(recipient, identity file) generated now; plus a second unrelated identity."""
    keys = tmp_path / "keys"
    keys.mkdir(mode=0o700)

    def make(name):
        path = keys / name
        subprocess.run(["age-keygen", "-o", str(path)], check=True, capture_output=True)
        recipient = subprocess.run(["age-keygen", "-y", str(path)], check=True, capture_output=True, text=True).stdout.strip()
        return recipient, path

    recipient, identity = make("identity.txt")
    _, other = make("other.txt")
    return recipient, identity, other


@pytest.fixture
def dirs(tmp_path):
    backups = tmp_path / "backups"
    private_tmp = tmp_path / "tmp"
    private_tmp.mkdir()
    return backups, private_tmp


def base_env(private_tmp, shim_dir=None):
    path = os.environ.get("PATH", "")
    env = {"PATH": f"{shim_dir}:{path}" if shim_dir else path, "HOME": str(private_tmp.parent), "TMPDIR": str(private_tmp)}
    return env


def backup_env(source_url, recipient, backups, private_tmp, shim_dir=None, **extra):
    env = base_env(private_tmp, shim_dir)
    env.update({"DATABASE_URL": dsn(source_url), "BACKUP_DIR": str(backups), "BACKUP_AGE_RECIPIENT": recipient})
    env.update(extra)
    return env


def run(script, env, *args, timeout=120):
    return subprocess.run(["bash", str(script), *args], env=env, capture_output=True, text=True, timeout=timeout)


def scan_for_plaintext(*directories):
    """Every regular file below `directories`: none may hold dump plaintext; dumps are age files."""
    problems = []
    for directory in directories:
        if not directory.exists():
            continue
        for path in directory.rglob("*"):
            try:
                if path.is_symlink() or not path.is_file():
                    continue
                data = path.read_bytes()
            except (FileNotFoundError, PermissionError):
                continue  # renamed/removed while we looked
            if ".dump.age" in path.name and data and not data.startswith(AGE_HEADER[: len(data)]):
                problems.append(f"{path.name}: not an age file")
            for marker in PLAINTEXT_MARKERS:
                if marker in data:
                    problems.append(f"{path.name}: contains {marker!r}")
    return problems


class Watcher:
    """Scans the directories in a loop while a script runs."""

    def __init__(self, *directories):
        self.directories = directories
        self.problems = []
        self.scans = 0
        self.seen_partial = False
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, daemon=True)

    def _loop(self):
        while not self._stop.is_set():
            self.problems.extend(scan_for_plaintext(*self.directories))
            for directory in self.directories:
                if directory.exists() and any(p.name.endswith(".partial") for p in directory.iterdir()):
                    self.seen_partial = True
            self.scans += 1
            time.sleep(0.02)

    def __enter__(self):
        self._thread.start()
        return self

    def __exit__(self, *exc):
        self._stop.set()
        self._thread.join()
        self.problems.extend(scan_for_plaintext(*self.directories))


def write_shim(shim_dir, name, body):
    shim_dir.mkdir(exist_ok=True)
    path = shim_dir / name
    path.write_text("#!/usr/bin/env bash\n" + body)
    path.chmod(0o755)
    return path


def slow_pg_dump_shim(shim_dir, marker, pid_file, sleep_seconds=60, args_log=None):
    """pg_dump that emits the first 4 KiB of the real dump, touches `marker`, then sleeps."""
    real = shutil.which("pg_dump")
    log = f'printf "%s\\n" "$*" >> "{args_log}"; [ -n "${{PGPASSWORD:-}}" ] && echo PGPASSWORD-set >> "{args_log}"\n' if args_log else ""
    return write_shim(
        shim_dir,
        "pg_dump",
        f'{log}echo $$ > "{pid_file}"\n"{real}" "$@" | head -c 4096\ntouch "{marker}"\nexec sleep {sleep_seconds}\n',
    )


def wait_for(path, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if path.exists():
            return
        time.sleep(0.02)
    raise AssertionError(f"timed out waiting for {path.name}")


def only_backup(backups):
    dumps = sorted(backups.glob("luna-*.dump.age"))
    assert len(dumps) == 1, [p.name for p in backups.iterdir()]
    dump = dumps[0]
    counts = dump.with_name(dump.name.replace(".dump.age", ".counts.json"))
    return dump, counts


def assert_nothing_left(backups, private_tmp):
    leftovers = [p.name for p in backups.iterdir()] if backups.exists() else []
    assert leftovers == [], leftovers
    assert list(private_tmp.iterdir()) == [], [p.name for p in private_tmp.iterdir()]


# --- backup ------------------------------------------------------------------------------


def test_backup_writes_only_encrypted_files_with_private_modes(source, age_keys, dirs):
    source_url, engine = source
    recipient, identity, _ = age_keys
    backups, private_tmp = dirs
    with Watcher(backups, private_tmp) as watcher:
        result = run(BACKUP, backup_env(source_url, recipient, backups, private_tmp))
    assert result.returncode == 0, result.stdout + result.stderr
    assert watcher.problems == []
    dump, counts = only_backup(backups)
    assert sorted(p.name for p in backups.iterdir()) == sorted([dump.name, counts.name])
    assert len(dump.name) == len("luna-20260101T000000Z.dump.age")
    assert stat.S_IMODE(backups.stat().st_mode) == 0o700
    assert stat.S_IMODE(dump.stat().st_mode) == 0o600
    assert stat.S_IMODE(counts.stat().st_mode) == 0o600
    assert dump.read_bytes().startswith(AGE_HEADER)
    assert list(private_tmp.iterdir()) == []
    manifest = json.loads(counts.read_text())
    assert manifest == table_counts(engine)
    assert manifest["users"] == ROWS and manifest["chat_messages"] == ROWS
    out = result.stdout + result.stderr
    assert SENTINEL not in out and EMAIL_MARK not in out and "postgresql://" not in out
    # The dump decrypts with the identity into a valid custom-format archive.
    decrypted = subprocess.run(["age", "-d", "-i", str(identity), str(dump)], capture_output=True, check=True).stdout
    assert decrypted.startswith(b"PGDMP")


def test_backup_password_never_reaches_a_command_line(source, age_keys, dirs, tmp_path):
    source_url, _ = source
    recipient, _, _ = age_keys
    backups, private_tmp = dirs
    shim_dir = tmp_path / "shims"
    args_log = tmp_path / "args.log"
    secret = "pw-SENTINEL-9d1e"  # the throwaway server uses trust auth, so any password works
    for tool in ("pg_dump", "psql"):
        real = shutil.which(tool)
        write_shim(shim_dir, tool, f'printf "{tool} %s\\n" "$*" >> "{args_log}"\n'
                                   f'[ -n "${{PGPASSWORD:-}}" ] && echo "{tool} PGPASSWORD-set" >> "{args_log}"\n'
                                   f'exec "{real}" "$@"\n')
    url = source_url.set(password=secret)
    result = run(BACKUP, backup_env(url, recipient, backups, private_tmp, shim_dir))
    assert result.returncode == 0, result.stdout + result.stderr
    calls = args_log.read_text()
    assert secret not in calls and "postgresql://" not in calls
    assert "pg_dump PGPASSWORD-set" in calls and "psql PGPASSWORD-set" in calls
    assert "--snapshot=" in calls
    assert secret not in result.stdout + result.stderr


def test_manifest_and_dump_come_from_the_same_snapshot(source, age_keys, dirs, tmp_path, server, key):
    """Rows committed after the snapshot is exported are in neither the manifest nor the dump."""
    source_url, engine = source
    recipient, identity, _ = age_keys
    backups, private_tmp = dirs
    shim_dir = tmp_path / "shims"
    ready = tmp_path / "pg_dump-started"
    real = shutil.which("pg_dump")
    # Signal, wait until the test has committed more rows, then run the real pg_dump.
    go = tmp_path / "go"
    write_shim(shim_dir, "pg_dump", f'touch "{ready}"\nwhile [ ! -e "{go}" ]; do sleep 0.05; done\nexec "{real}" "$@"\n')
    proc = subprocess.Popen(["bash", str(BACKUP)], env=backup_env(source_url, recipient, backups, private_tmp, shim_dir),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        wait_for(ready)
        seed(engine, EncryptionService([key]), rows=3, start=100)
        go.touch()
        out, err = proc.communicate(timeout=120)
    finally:
        if proc.poll() is None:
            proc.kill()
    assert proc.returncode == 0, out + err
    _, counts = only_backup(backups)
    manifest = json.loads(counts.read_text())
    assert manifest["users"] == ROWS
    assert table_counts(engine)["users"] == ROWS + 3

    dump, counts = only_backup(backups)
    target = server.new_name("luna_restore")
    result = run(RESTORE, base_env(private_tmp), "--file", str(dump), "--identity", str(identity),
                 "--target-url", dsn(server.url_for(target)), "--create")
    assert result.returncode == 0, result.stdout + result.stderr
    restored = create_engine(server.url_for(target))
    try:
        assert table_counts(restored) == manifest
    finally:
        restored.dispose()


def test_killed_pg_dump_leaves_no_partial_file(source, age_keys, dirs, tmp_path):
    source_url, _ = source
    recipient, _, _ = age_keys
    backups, private_tmp = dirs
    shim_dir = tmp_path / "shims"
    marker, pid_file = tmp_path / "mid-dump", tmp_path / "pg_dump.pid"
    slow_pg_dump_shim(shim_dir, marker, pid_file)
    env = backup_env(source_url, recipient, backups, private_tmp, shim_dir)
    with Watcher(backups, private_tmp) as watcher:
        proc = subprocess.Popen(["bash", str(BACKUP)], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            wait_for(marker)
            time.sleep(0.2)
            partials = list(backups.glob("*.partial"))
            assert partials, [p.name for p in backups.iterdir()]
            os.kill(int(pid_file.read_text()), signal.SIGKILL)
            out, err = proc.communicate(timeout=60)
        finally:
            if proc.poll() is None:
                proc.kill()
    assert proc.returncode == 1, out + err
    assert watcher.seen_partial
    assert watcher.problems == []
    assert_nothing_left(backups, private_tmp)
    assert "failed" in err.lower()


@pytest.mark.parametrize("sig", [signal.SIGTERM, signal.SIGINT])
def test_signal_during_backup_cleans_up(source, age_keys, dirs, tmp_path, sig):
    source_url, _ = source
    recipient, _, _ = age_keys
    backups, private_tmp = dirs
    shim_dir = tmp_path / "shims"
    marker, pid_file = tmp_path / "mid-dump", tmp_path / "pg_dump.pid"
    slow_pg_dump_shim(shim_dir, marker, pid_file)
    env = backup_env(source_url, recipient, backups, private_tmp, shim_dir)
    proc = subprocess.Popen(["bash", str(BACKUP)], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        wait_for(marker)
        started = time.time()
        proc.send_signal(sig)
        out, err = proc.communicate(timeout=30)
        assert time.time() - started < 15  # interrupted, not waiting for the 60 s sleep
    finally:
        if proc.poll() is None:
            proc.kill()
    assert proc.returncode != 0
    assert [p.name for p in backups.iterdir()] == []
    assert list(private_tmp.iterdir()) == []
    # The shim (our stand-in for pg_dump) was stopped too.
    pid = int(pid_file.read_text())
    time.sleep(0.2)
    with pytest.raises(ProcessLookupError):
        os.kill(pid, 0)


def test_bogus_recipient_fails_before_touching_the_database(source, dirs, tmp_path):
    source_url, _ = source
    backups, private_tmp = dirs
    shim_dir = tmp_path / "shims"
    calls = tmp_path / "calls.log"
    for tool in ("pg_dump", "psql"):
        write_shim(shim_dir, tool, f'echo {tool} >> "{calls}"\nexit 99\n')
    bogus = "age1" + "q" * 58  # right shape, bad checksum: age rejects it
    with Watcher(backups, private_tmp) as watcher:
        result = run(BACKUP, backup_env(source_url, bogus, backups, private_tmp, shim_dir))
    assert result.returncode == 2, result.stdout + result.stderr
    assert "recipient" in result.stderr.lower()
    assert not calls.exists()
    assert watcher.problems == []
    assert not backups.exists() or [p.name for p in backups.iterdir()] == []
    assert list(private_tmp.iterdir()) == []


def test_unreachable_database_fails_cleanly(age_keys, dirs):
    recipient, _, _ = age_keys
    backups, private_tmp = dirs
    env = base_env(private_tmp)
    env.update({"DATABASE_URL": "postgresql://nobody:pw-SENTINEL-x@127.0.0.1:1/none", "BACKUP_DIR": str(backups),
                "BACKUP_AGE_RECIPIENT": recipient, "BACKUP_SNAPSHOT_TIMEOUT": "10"})
    result = run(BACKUP, env)
    assert result.returncode == 1, result.stdout + result.stderr
    assert "pw-SENTINEL-x" not in result.stdout + result.stderr
    assert [p.name for p in backups.iterdir()] == []
    assert list(private_tmp.iterdir()) == []


def test_concurrent_alter_table_does_not_hang_the_backup(source, age_keys, dirs, tmp_path):
    """A migration's ALTER TABLE queues behind the snapshot session's read locks, and
    pg_dump's LOCK TABLE queues behind the ALTER. --lock-wait-timeout makes the backup fail
    cleanly instead of hanging; once it gave up, the ALTER goes through."""
    source_url, engine = source
    recipient, _, _ = age_keys
    backups, private_tmp = dirs
    shim_dir = tmp_path / "shims"
    alter_out, alter_pid = tmp_path / "alter.out", tmp_path / "alter.pid"
    real = shutil.which("pg_dump")
    write_shim(
        shim_dir,
        "pg_dump",
        # Before the real pg_dump starts: an ALTER TABLE from another session (it waits for
        # the snapshot session's locks), given a moment to get into the lock queue.
        f'psql -X -w -q -c "ALTER TABLE periods ADD COLUMN probe_col integer" > "{alter_out}" 2>&1 &\n'
        f'echo $! > "{alter_pid}"\n'
        'sleep 1\n'
        f'exec "{real}" "$@"\n',
    )
    env = backup_env(source_url, recipient, backups, private_tmp, shim_dir, BACKUP_LOCK_WAIT_TIMEOUT="2s")
    started = time.monotonic()
    result = run(BACKUP, env, timeout=90)
    elapsed = time.monotonic() - started
    assert result.returncode == 1, result.stdout + result.stderr
    assert elapsed < 30, elapsed
    assert "lock" in result.stderr.lower()
    assert_nothing_left(backups, private_tmp)
    pid = int(alter_pid.read_text())
    deadline = time.time() + 30
    while time.time() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            break
        time.sleep(0.1)
    assert "ERROR" not in alter_out.read_text()
    with engine.connect() as conn:
        columns = conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'periods'")).scalars().all()
    assert "probe_col" in columns


def test_backup_survives_a_short_idle_in_transaction_timeout(source, age_keys, dirs, tmp_path, server):
    """Managed servers may end idle transactions quickly. The snapshot session turns the
    timeout off for itself; otherwise the session would die while pg_dump starts and the
    exported snapshot would be gone."""
    source_url, engine = source
    recipient, identity, _ = age_keys
    backups, private_tmp = dirs
    with server.admin.connect() as conn:
        conn.execute(text(f'ALTER DATABASE "{source_url.database}" SET idle_in_transaction_session_timeout = \'500ms\''))
    shim_dir = tmp_path / "shims"
    real = shutil.which("pg_dump")
    write_shim(shim_dir, "pg_dump", f'sleep 2\nexec "{real}" "$@"\n')
    result = run(BACKUP, backup_env(source_url, recipient, backups, private_tmp, shim_dir))
    assert result.returncode == 0, result.stdout + result.stderr
    dump, counts = only_backup(backups)
    assert json.loads(counts.read_text()) == table_counts(engine)


def test_snapshot_session_ending_after_a_good_dump_is_only_a_warning(source, age_keys, dirs, tmp_path, server):
    """pg_dump has imported the snapshot and finished: the backup is complete even if the
    snapshot session was ended (by the server or an admin) in the meantime."""
    source_url, engine = source
    recipient, identity, _ = age_keys
    backups, private_tmp = dirs
    shim_dir = tmp_path / "shims"
    real = shutil.which("pg_dump")
    terminate = ("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() "
                 "AND pid <> pg_backend_pid() AND state LIKE 'idle in transaction%'")
    write_shim(
        shim_dir,
        "pg_dump",
        f'"{real}" "$@" || exit $?\n'
        f'psql -X -w -q -At -c "{terminate}" > /dev/null 2>&1\n'
        'sleep 0.5\n',
    )
    result = run(BACKUP, backup_env(source_url, recipient, backups, private_tmp, shim_dir))
    assert result.returncode == 0, result.stdout + result.stderr
    assert "snapshot session" in result.stderr and "warning" in result.stderr.lower()
    dump, counts = only_backup(backups)
    target = server.new_name("luna_restore")
    restored = run(RESTORE, base_env(private_tmp), "--file", str(dump), "--identity", str(identity),
                   "--target-url", dsn(server.url_for(target)), "--create")
    assert restored.returncode == 0, restored.stdout + restored.stderr


def test_compose_mode_through_a_stand_in_docker(source, age_keys, dirs, tmp_path, server):
    """BACKUP_MODE=compose end to end, with `docker` replaced by a shim that runs the
    in-container command against the test server (Docker itself is not used here)."""
    source_url, engine = source
    recipient, identity, _ = age_keys
    backups, private_tmp = dirs
    shim_dir = tmp_path / "shims"
    calls = tmp_path / "docker.log"
    compose_file, env_file = tmp_path / "compose.prod.yml", tmp_path / "prod.env"
    compose_file.write_text("services: {}\n")
    env_file.write_text("POSTGRES_PASSWORD=\n")
    write_shim(
        shim_dir,
        "docker",
        f'printf "%s\\n" "$*" >> "{calls}"\n'
        f'[ "$1 $2 $3 $4 $5 $6 $7 $8" = "compose -f {compose_file} --env-file {env_file} exec -T db" ] || exit 98\n'
        'shift 8\n'
        '[ -t 0 ] && exit 97\n'
        f'PGHOST={source_url.host} PGPORT={source_url.port} exec "$@"\n',
    )
    env = base_env(private_tmp, shim_dir)
    env.update({"BACKUP_MODE": "compose", "COMPOSE_FILE": str(compose_file), "COMPOSE_ENV_FILE": str(env_file),
                "COMPOSE_DB_USER": source_url.username, "COMPOSE_DB_NAME": source_url.database,
                "BACKUP_DIR": str(backups), "BACKUP_AGE_RECIPIENT": recipient})
    with Watcher(backups, private_tmp) as watcher:
        result = run(BACKUP, env)
    assert result.returncode == 0, result.stdout + result.stderr
    assert watcher.problems == []
    logged = calls.read_text().splitlines()
    assert any(" exec -T db psql -U " in line for line in logged)
    assert any(" exec -T db pg_dump -U " in line and "--snapshot=" in line for line in logged)
    dump, counts = only_backup(backups)
    assert json.loads(counts.read_text()) == table_counts(engine)
    target = server.new_name("luna_restore")
    restored = run(RESTORE, base_env(private_tmp), "--file", str(dump), "--identity", str(identity),
                   "--target-url", dsn(server.url_for(target)), "--create")
    assert restored.returncode == 0, restored.stdout + restored.stderr


def test_upload_hook_receives_the_backup_path(source, age_keys, dirs, tmp_path):
    source_url, _ = source
    recipient, _, _ = age_keys
    backups, private_tmp = dirs
    offsite = tmp_path / "offsite"
    offsite.mkdir()
    hook = f'cp "$1" "$2" "{offsite}/"'
    result = run(BACKUP, backup_env(source_url, recipient, backups, private_tmp, BACKUP_UPLOAD_CMD=hook))
    assert result.returncode == 0, result.stdout + result.stderr
    dump, counts = only_backup(backups)
    assert sorted(p.name for p in offsite.iterdir()) == sorted([dump.name, counts.name])

    failing = run(BACKUP, backup_env(source_url, recipient, backups, private_tmp, BACKUP_UPLOAD_CMD="exit 7"))
    assert failing.returncode == 4, failing.stdout + failing.stderr
    assert len(list(backups.glob("luna-*.dump.age"))) == 2  # the backup itself is kept


def test_retention_runs_after_a_real_backup(source, age_keys, dirs):
    source_url, _ = source
    recipient, _, _ = age_keys
    backups, private_tmp = dirs
    names = []
    for _ in range(3):
        result = run(BACKUP, backup_env(source_url, recipient, backups, private_tmp, BACKUP_KEEP_LAST="2"))
        assert result.returncode == 0, result.stdout + result.stderr
        names = sorted(p.name for p in backups.glob("luna-*.dump.age"))
    assert len(names) == 2
    assert len(list(backups.glob("luna-*.counts.json"))) == 2


# --- restore -----------------------------------------------------------------------------


@pytest.fixture
def backup_file(source, age_keys, dirs):
    source_url, _ = source
    recipient, _, _ = age_keys
    backups, private_tmp = dirs
    result = run(BACKUP, backup_env(source_url, recipient, backups, private_tmp))
    assert result.returncode == 0, result.stdout + result.stderr
    return only_backup(backups)


def test_restore_into_a_new_database_matches_and_reads_back(source, backup_file, age_keys, dirs, server, key):
    _, source_engine = source
    dump, counts = backup_file
    _, identity, _ = age_keys
    _, private_tmp = dirs
    target = server.new_name("luna_restore")
    with Watcher(dump.parent, private_tmp) as watcher:
        result = run(RESTORE, base_env(private_tmp), "--file", str(dump), "--identity", str(identity),
                     "--target-url", dsn(server.url_for(target)), "--create")
    assert result.returncode == 0, result.stdout + result.stderr
    assert watcher.problems == []
    assert list(private_tmp.iterdir()) == []
    out = result.stdout + result.stderr
    assert SENTINEL not in out and EMAIL_MARK not in out and "enc:v1:" not in out
    assert "users" in result.stdout and "match" in result.stdout.lower()
    restored = create_engine(server.url_for(target))
    try:
        assert table_counts(restored) == json.loads(counts.read_text())
        view = app_view(restored, EncryptionService([key]))
        assert view == app_view(source_engine, EncryptionService([key]))
        assert f"{SENTINEL} chat 0" in view.values()
    finally:
        restored.dispose()


def test_restore_into_an_existing_empty_database(backup_file, age_keys, dirs, server):
    dump, counts = backup_file
    _, identity, _ = age_keys
    _, private_tmp = dirs
    target = server.new_name("luna_restore")
    server.create(target)
    result = run(RESTORE, base_env(private_tmp), "--file", str(dump), "--identity", str(identity),
                 "--target-url", dsn(server.url_for(target)))
    assert result.returncode == 0, result.stdout + result.stderr
    restored = create_engine(server.url_for(target))
    try:
        assert table_counts(restored) == json.loads(counts.read_text())
    finally:
        restored.dispose()


def test_wrong_identity_fails_cleanly_without_a_database(backup_file, age_keys, dirs, server):
    dump, _ = backup_file
    _, _, other = age_keys
    _, private_tmp = dirs
    target = server.new_name("luna_restore")
    result = run(RESTORE, base_env(private_tmp), "--file", str(dump), "--identity", str(other),
                 "--target-url", dsn(server.url_for(target)), "--create")
    assert result.returncode == 1, result.stdout + result.stderr
    assert "decrypt" in result.stderr.lower()
    assert not server.exists(target)
    assert list(private_tmp.iterdir()) == []


def test_wrong_identity_leaves_an_existing_empty_target_empty(backup_file, age_keys, dirs, server):
    dump, _ = backup_file
    _, _, other = age_keys
    _, private_tmp = dirs
    target = server.new_name("luna_restore")
    server.create(target)
    result = run(RESTORE, base_env(private_tmp), "--file", str(dump), "--identity", str(other),
                 "--target-url", dsn(server.url_for(target)))
    assert result.returncode == 1
    restored = create_engine(server.url_for(target))
    try:
        assert table_counts(restored) == {}
    finally:
        restored.dispose()


def test_corrupted_backup_fails_cleanly_without_a_database(backup_file, age_keys, dirs, server, tmp_path):
    dump, counts = backup_file
    _, identity, _ = age_keys
    _, private_tmp = dirs
    broken = tmp_path / "broken" / dump.name
    broken.parent.mkdir()
    data = bytearray(dump.read_bytes())
    data[-10] ^= 0xFF  # flips a byte in the last chunk: age's authentication catches it
    broken.write_bytes(bytes(data))
    shutil.copy(counts, broken.parent / counts.name)
    target = server.new_name("luna_restore")
    result = run(RESTORE, base_env(private_tmp), "--file", str(broken), "--identity", str(identity),
                 "--target-url", dsn(server.url_for(target)), "--create")
    assert result.returncode == 1, result.stdout + result.stderr
    assert not server.exists(target)


def test_failed_pg_restore_drops_the_database_it_created(backup_file, age_keys, dirs, server, tmp_path):
    dump, _ = backup_file
    _, identity, _ = age_keys
    _, private_tmp = dirs
    shim_dir = tmp_path / "shims"
    real = shutil.which("pg_restore")
    # Restores part of the archive, then fails (as a disk-full or a killed restore would).
    write_shim(shim_dir, "pg_restore", f'"{real}" "$@" --section=pre-data\nexit 1\n')
    target = server.new_name("luna_restore")
    result = run(RESTORE, base_env(private_tmp, shim_dir), "--file", str(dump), "--identity", str(identity),
                 "--target-url", dsn(server.url_for(target)), "--create")
    assert result.returncode == 1, result.stdout + result.stderr
    assert not server.exists(target)
    assert list(private_tmp.iterdir()) == []


def test_restore_refuses_a_non_empty_target(source, backup_file, age_keys, dirs, server):
    source_url, source_engine = source
    dump, _ = backup_file
    _, identity, _ = age_keys
    _, private_tmp = dirs
    before = table_counts(source_engine)
    result = run(RESTORE, base_env(private_tmp), "--file", str(dump), "--identity", str(identity),
                 "--target-url", dsn(source_url))
    assert result.returncode == 3, result.stdout + result.stderr
    assert "not empty" in result.stderr.lower()
    assert table_counts(source_engine) == before
    # --create on a database that already exists is refused as well, and it is not dropped.
    result = run(RESTORE, base_env(private_tmp), "--file", str(dump), "--identity", str(identity),
                 "--target-url", dsn(source_url), "--create")
    assert result.returncode == 3
    assert server.exists(source_url.database)
    assert table_counts(source_engine) == before


def test_restore_with_force_replaces_the_objects(backup_file, age_keys, dirs, server, key):
    dump, counts = backup_file
    _, identity, _ = age_keys
    _, private_tmp = dirs
    target = server.new_name("luna_restore")
    args = ["--file", str(dump), "--identity", str(identity), "--target-url", dsn(server.url_for(target))]
    assert run(RESTORE, base_env(private_tmp), *args, "--create").returncode == 0
    engine = create_engine(server.url_for(target))
    try:
        seed(engine, EncryptionService([key]), rows=2, start=500)  # drift after the restore
        assert run(RESTORE, base_env(private_tmp), *args).returncode == 3
        result = run(RESTORE, base_env(private_tmp), *args, "--force")
        assert result.returncode == 0, result.stdout + result.stderr
        assert table_counts(engine) == json.loads(counts.read_text())
    finally:
        engine.dispose()


def test_restore_reports_a_count_mismatch(backup_file, age_keys, dirs, server, tmp_path):
    dump, counts = backup_file
    _, identity, _ = age_keys
    _, private_tmp = dirs
    tampered = json.loads(counts.read_text())
    tampered["periods"] += 1
    tampered["ghost_table"] = 3
    manifest = tmp_path / "tampered.counts.json"
    manifest.write_text(json.dumps(tampered, indent=2))
    target = server.new_name("luna_restore")
    result = run(RESTORE, base_env(private_tmp), "--file", str(dump), "--identity", str(identity),
                 "--target-url", dsn(server.url_for(target)), "--create", "--manifest", str(manifest))
    assert result.returncode == 4, result.stdout + result.stderr
    assert "periods" in result.stdout and "ghost_table" in result.stdout
    assert "mismatch" in (result.stdout + result.stderr).lower()
    assert SENTINEL not in result.stdout + result.stderr


# --- restore --compose (docker replaced by a shim that runs the command on the test server) ---


def compose_shim(tmp_path, server_url):
    """(shim_dir, calls log, env) for restore --compose: the stand-in `docker` checks the
    compose prefix, refuses a TTY stdin, and runs the in-container command against the test
    server (Docker itself is not used here)."""
    shim_dir = tmp_path / "compose-shims"
    calls = tmp_path / "docker-restore.log"
    compose_file, env_file = tmp_path / "compose.prod.yml", tmp_path / "prod.env"
    compose_file.write_text("services: {}\n")
    env_file.write_text("POSTGRES_PASSWORD=\n")
    password = f"PGPASSWORD={server_url.password} " if server_url.password else ""
    write_shim(
        shim_dir,
        "docker",
        f'printf "%s\\n" "$*" >> "{calls}"\n'
        f'[ "$1 $2 $3 $4 $5 $6 $7 $8" = "compose -f {compose_file} --env-file {env_file} exec -T db" ] || exit 98\n'
        'shift 8\n'
        '[ -t 0 ] && exit 97\n'
        f'{password}PGHOST={server_url.host} PGPORT={server_url.port or 5432} exec "$@"\n',
    )
    env = {"COMPOSE_FILE": str(compose_file), "COMPOSE_ENV_FILE": str(env_file), "COMPOSE_DB_USER": server_url.username}
    return shim_dir, calls, env


def compose_restore(private_tmp, shim_dir, compose_env, dump, identity, target, *extra):
    env = base_env(private_tmp, shim_dir)
    env.update(compose_env)
    return run(RESTORE, env, "--compose", "--file", str(dump), "--identity", str(identity), "--target-db", target, *extra)


def test_compose_restore_into_a_new_database_matches_and_reads_back(source, backup_file, age_keys, dirs, server, key, tmp_path):
    _, source_engine = source
    dump, counts = backup_file
    _, identity, _ = age_keys
    _, private_tmp = dirs
    shim_dir, calls, compose_env = compose_shim(tmp_path, make_url(TEST_POSTGRES_URL))
    target = server.new_name("luna_restore")
    with Watcher(dump.parent, private_tmp) as watcher:
        result = compose_restore(private_tmp, shim_dir, compose_env, dump, identity, target, "--create")
    assert result.returncode == 0, result.stdout + result.stderr
    assert watcher.problems == []
    assert list(private_tmp.iterdir()) == []
    out = result.stdout + result.stderr
    assert SENTINEL not in out and EMAIL_MARK not in out
    logged = calls.read_text().splitlines()
    assert any(" exec -T db pg_restore -U " in line and "--no-owner --no-acl" in line and line.endswith(f"-d {target}")
               for line in logged), logged
    assert any(" exec -T db psql -U " in line and f"-d {target}" in line for line in logged)
    restored = create_engine(server.url_for(target))
    try:
        assert table_counts(restored) == json.loads(counts.read_text())
        assert app_view(restored, EncryptionService([key])) == app_view(source_engine, EncryptionService([key]))
    finally:
        restored.dispose()


def test_compose_restore_refuses_a_non_empty_target(source, backup_file, age_keys, dirs, server, tmp_path):
    source_url, source_engine = source
    dump, _ = backup_file
    _, identity, _ = age_keys
    _, private_tmp = dirs
    shim_dir, calls, compose_env = compose_shim(tmp_path, make_url(TEST_POSTGRES_URL))
    before = table_counts(source_engine)
    result = compose_restore(private_tmp, shim_dir, compose_env, dump, identity, source_url.database)
    assert result.returncode == 3, result.stdout + result.stderr
    assert table_counts(source_engine) == before
    assert not any(" pg_restore " in line for line in calls.read_text().splitlines())


def test_compose_restore_with_the_wrong_identity_creates_nothing(backup_file, age_keys, dirs, server, tmp_path):
    dump, _ = backup_file
    _, _, other = age_keys
    _, private_tmp = dirs
    shim_dir, _, compose_env = compose_shim(tmp_path, make_url(TEST_POSTGRES_URL))
    target = server.new_name("luna_restore")
    result = compose_restore(private_tmp, shim_dir, compose_env, dump, other, target, "--create")
    assert result.returncode == 1, result.stdout + result.stderr
    assert not server.exists(target)


def test_compose_restore_failure_drops_the_database_it_created(backup_file, age_keys, dirs, server, tmp_path):
    dump, _ = backup_file
    _, identity, _ = age_keys
    _, private_tmp = dirs
    shim_dir, _, compose_env = compose_shim(tmp_path, make_url(TEST_POSTGRES_URL))
    real = shutil.which("pg_restore")
    # The "in-container" pg_restore restores part of the archive, then fails.
    write_shim(shim_dir, "pg_restore", f'"{real}" "$@" --section=pre-data\nexit 1\n')
    target = server.new_name("luna_restore")
    result = compose_restore(private_tmp, shim_dir, compose_env, dump, identity, target, "--create")
    assert result.returncode == 1, result.stdout + result.stderr
    assert not server.exists(target)
    assert list(private_tmp.iterdir()) == []
