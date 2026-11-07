"""Always-run checks of scripts/backup_db.sh and scripts/restore_db.sh.

Nothing here needs Postgres or age: the scripts are parsed, linted (when shellcheck is
installed), grepped for dangerous patterns, and driven through the code paths that must
stop before any database is contacted (missing/invalid recipient, DRY_RUN, usage errors,
retention with --prune-only on fake files). PATH shims stand in for psql, pg_dump,
pg_restore, docker and age and record whether they were called.
"""

import os
import re
import shutil
import stat
import subprocess
import time
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
BACKUP = REPO / "scripts" / "backup_db.sh"
RESTORE = REPO / "scripts" / "restore_db.sh"
BACKUP_ENV_EXAMPLE = REPO / "deploy" / "backup.env.example"
SCRIPTS = [BACKUP, RESTORE]
BASH = shutil.which("bash")
# Has the shape of an X25519 recipient (passes the script's format check). Its checksum is
# not valid, so age itself would reject it; nothing here ever encrypts with it.
VALID_RECIPIENT = "age1" + "q" * 58
SECRET = "pw-SENTINEL-not-to-be-logged"

needs_bash = pytest.mark.skipif(not BASH, reason="bash not available")


def _read(path):
    return path.read_text(encoding="utf-8")


def _code_lines(path):
    """Script lines without full-line comments."""
    return [line for line in _read(path).splitlines() if not line.lstrip().startswith("#")]


# --- shape -------------------------------------------------------------------------


@pytest.mark.parametrize("path", SCRIPTS, ids=lambda p: p.name)
def test_script_is_executable_and_tracked_as_such(path):
    assert path.exists(), path
    assert path.stat().st_mode & stat.S_IXUSR
    tracked = subprocess.run(
        ["git", "ls-files", "-s", str(path.relative_to(REPO))], cwd=REPO, capture_output=True, text=True
    ).stdout
    if tracked:
        assert tracked.startswith("100755"), tracked


@needs_bash
@pytest.mark.parametrize("path", SCRIPTS, ids=lambda p: p.name)
def test_script_parses(path):
    result = subprocess.run([BASH, "-n", str(path)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("path", SCRIPTS, ids=lambda p: p.name)
def test_script_is_shellcheck_clean(path):
    shellcheck = shutil.which("shellcheck")
    if not shellcheck:
        pytest.skip("shellcheck not installed")
    result = subprocess.run([shellcheck, "-x", str(path)], capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.parametrize("path", SCRIPTS, ids=lambda p: p.name)
def test_script_header_and_strict_mode(path):
    text = _read(path)
    assert text.startswith("#!/usr/bin/env bash\n")
    assert "set -euo pipefail" in text
    assert "umask 077" in text
    code = "\n".join(_code_lines(path))
    assert not re.search(r"\beval\b", code)
    # Exit codes are documented in the header comment.
    assert re.search(r"(?mi)^# Exit codes", text)


def test_backup_never_writes_a_plaintext_dump():
    code = "\n".join(_code_lines(BACKUP))
    # pg_dump is only ever piped into age; no output file, no redirect, no tee.
    dump_lines = [l for l in code.splitlines() if re.search(r"\bpg_dump\b", l) and not re.search(r"\b(command -v|log|warn|die)\b", l)]
    assert dump_lines
    for line in dump_lines:
        assert not re.search(r"(\s-f\s|--file|\btee\b|>\s*(?!/dev/null)[\"$\w/])", line), line
    assert not re.search(r"\.(dump|sql)\b(?!\.age)\"?\s*$", code, re.M)
    assert not re.search(r">\s*\"?[^|&\n]*\.(dump|sql)\"?(\s|$)", code)
    assert re.search(r"\bage\b[^\n]*-r\b", code)
    assert ".partial" in code
    assert re.search(r"\btrap\b", code)
    assert "--snapshot" in code
    assert "pg_export_snapshot()" in code
    assert "REPEATABLE READ" in code


def test_restore_streams_decryption_into_pg_restore():
    code = "\n".join(_code_lines(RESTORE))
    assert re.search(r"age\b[^\n]*-d\b[^\n]*-i\b", code)
    assert re.search(r"pg_restore\b[^\n]*--no-owner", code)
    assert re.search(r"pg_restore\b[^\n]*--no-acl", code)
    # age -d never writes its output to a file.
    for line in code.splitlines():
        if re.search(r"\bage\b.*\s-d\b", line):
            assert not re.search(r"\s-o\s|--output|>\s*[\"$\w/](?!dev/null)", line), line
    assert re.search(r"\btrap\b", code)
    assert "DROP DATABASE" in code


@pytest.mark.parametrize("path", SCRIPTS, ids=lambda p: p.name)
def test_no_secret_on_a_command_line_or_in_output(path):
    code = "\n".join(_code_lines(path))
    assert "PGPASSWORD" in code
    assert not re.search(r"--password\b|\s-W\b", code)
    # Nothing echoes a URL or a password.
    for line in code.splitlines():
        for match in re.finditer(r"\b(?:echo|printf|log|warn|die)\b(.*)", line):
            printed = match.group(1)
            assert not re.search(r"\$\{?(PGPASSWORD|DATABASE_URL|RESTORE_TARGET_URL|target_url|url|userinfo)\b", printed), line


def test_both_scripts_count_rows_with_the_same_query():
    def count_sql(path):
        match = re.search(r'(?m)^COUNT_SQL="(.*)"$', _read(path))
        assert match, path
        return match.group(1)

    assert count_sql(BACKUP) == count_sql(RESTORE)
    assert "query_to_xml" in count_sql(BACKUP)


def test_restore_flags_are_present():
    text = _read(RESTORE)
    for flag in ("--file", "--identity", "--target-url", "--force", "--create", "--manifest", "--help"):
        assert flag in text, flag
    for needle in ("--single-transaction", "--exit-on-error", "WITH (FORCE)"):
        assert needle in text, needle


def test_backup_settings_are_documented():
    text = _read(BACKUP)
    example = _read(BACKUP_ENV_EXAMPLE)
    for name in ("BACKUP_MODE", "DATABASE_URL", "COMPOSE_FILE", "COMPOSE_ENV_FILE", "BACKUP_DIR",
                 "BACKUP_AGE_RECIPIENT", "BACKUP_KEEP_LAST", "BACKUP_KEEP_DAYS", "BACKUP_UPLOAD_CMD", "DRY_RUN"):
        assert name in text, name
        assert re.search(rf"(?m)^#?\s*{name}=", example), name
    assert "luna-" in text and ".dump.age" in text and ".counts.json" in text
    assert re.search(r"(?m)^#?\s*BACKUP_KEEP_LAST=14$", example)
    assert re.search(r"(?m)^#?\s*BACKUP_KEEP_DAYS=30$", example)


def test_backup_env_example_has_only_placeholders():
    lines = _read(BACKUP_ENV_EXAMPLE).splitlines()
    for index, line in enumerate(lines):
        match = re.match(r"^([A-Z][A-Z0-9_]*)=(.*)$", line)
        if not match:
            continue
        previous = [l for l in lines[:index] if l.strip()]
        assert previous and previous[-1].startswith("#"), line
        if match.group(1) in ("BACKUP_AGE_RECIPIENT", "DATABASE_URL"):
            assert match.group(2) == "", line


@pytest.mark.parametrize("path", SCRIPTS + [BACKUP_ENV_EXAMPLE], ids=lambda p: p.name)
def test_no_company_resources_real_hosts_or_secrets(path):
    text = _read(path)
    assert "cfologic" not in text.lower()
    for host in re.findall(r"\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|dev|app|in|co|ai)\b", text.lower()):
        assert host.endswith(("example.com", "example.org", "example.net", "age-encryption.org")), host
    for token in re.findall(r"[A-Za-z0-9+/_-]{32,}", text):
        assert not (re.search(r"[A-Z]", token) and re.search(r"[a-z]", token) and re.search(r"\d", token)), token
    assert not re.search(r"AGE-SECRET-KEY-1[0-9A-Z]{20,}", text)


def test_gitignore_tracks_the_scripts_and_backup_template():
    def ignored(rel):
        return subprocess.run(["git", "check-ignore", "-q", rel], cwd=REPO).returncode == 0

    for rel in ("scripts/backup_db.sh", "scripts/restore_db.sh", "deploy/backup.env.example"):
        assert not ignored(rel), rel
    assert ignored("deploy/backup.env")


# --- behaviour that must stop before any database is contacted ----------------------


@pytest.fixture
def shims(tmp_path):
    """PATH dir whose psql/pg_dump/pg_restore/docker/age record each call and fail."""
    shim_dir = tmp_path / "shims"
    shim_dir.mkdir()
    log = tmp_path / "calls.log"
    for name in ("psql", "pg_dump", "pg_restore", "docker", "age", "createdb"):
        script = shim_dir / name
        script.write_text(f'#!/bin/sh\necho "{name} $*" >> "{log}"\nexit 99\n')
        script.chmod(0o755)
    return shim_dir, log


def _env(tmp_path, shim_dir, **extra):
    env = {
        "PATH": f"{shim_dir}:/usr/bin:/bin:/usr/sbin:/sbin",
        "HOME": str(tmp_path),
        "TMPDIR": str(tmp_path),
        "BACKUP_DIR": str(tmp_path / "backups"),
    }
    env.update(extra)
    return env


def _run(script, env, *args):
    return subprocess.run([BASH, str(script), *args], env=env, capture_output=True, text=True, timeout=60)


@needs_bash
def test_backup_refuses_without_recipient_before_connecting(tmp_path, shims):
    shim_dir, log = shims
    env = _env(tmp_path, shim_dir, DATABASE_URL=f"postgresql://luna:{SECRET}@db.example.com:5432/luna")
    result = _run(BACKUP, env)
    assert result.returncode == 2
    assert "BACKUP_AGE_RECIPIENT" in result.stderr
    assert not log.exists(), log.read_text()
    assert SECRET not in result.stdout + result.stderr
    assert not (tmp_path / "backups").exists() or not any((tmp_path / "backups").iterdir())


@needs_bash
@pytest.mark.parametrize("recipient", ["not-a-key", "age1", "AGE-SECRET-KEY-1QQQQ", "age1 has spaces", "ssh-ed25519", "-r"])
def test_backup_refuses_a_malformed_recipient_before_connecting(tmp_path, shims, recipient):
    shim_dir, log = shims
    env = _env(tmp_path, shim_dir, DATABASE_URL="postgresql://luna@db.example.com/luna", BACKUP_AGE_RECIPIENT=recipient)
    result = _run(BACKUP, env)
    assert result.returncode == 2, result.stderr
    assert "recipient" in result.stderr.lower()
    assert not log.exists(), log.read_text()


@needs_bash
def test_backup_requires_a_database_url_in_direct_mode(tmp_path, shims):
    shim_dir, log = shims
    result = _run(BACKUP, _env(tmp_path, shim_dir, BACKUP_AGE_RECIPIENT=VALID_RECIPIENT))
    assert result.returncode == 2
    assert "DATABASE_URL" in result.stderr
    assert not log.exists()


@needs_bash
@pytest.mark.parametrize("name,value", [("BACKUP_KEEP_LAST", "0"), ("BACKUP_KEEP_LAST", "abc"), ("BACKUP_KEEP_DAYS", "-1"),
                                        ("BACKUP_KEEP_DAYS", "1e3"), ("BACKUP_MODE", "ssh")])
def test_backup_rejects_bad_settings(tmp_path, shims, name, value):
    shim_dir, log = shims
    env = _env(tmp_path, shim_dir, DATABASE_URL="postgresql://luna@db.example.com/luna", BACKUP_AGE_RECIPIENT=VALID_RECIPIENT)
    env[name] = value
    result = _run(BACKUP, env)
    assert result.returncode == 2, result.stderr
    assert name in result.stderr
    assert not log.exists()


@needs_bash
def test_backup_dry_run_direct_mode_redacts_the_password(tmp_path, shims):
    shim_dir, log = shims
    env = _env(tmp_path, shim_dir, DRY_RUN="1", BACKUP_AGE_RECIPIENT=VALID_RECIPIENT,
               DATABASE_URL=f"postgresql+psycopg2://luna:{SECRET}@db.example.com:6543/lunadb?sslmode=require")
    result = _run(BACKUP, env)
    assert result.returncode == 0, result.stderr
    out = result.stdout + result.stderr
    assert SECRET not in out
    assert "db.example.com:6543" not in out and "postgresql" not in out
    assert "PGPASSWORD=<redacted>" in out
    assert "PGHOST=db.example.com" in out and "PGPORT=6543" in out and "PGDATABASE=lunadb" in out
    assert "PGSSLMODE=require" in out
    assert re.search(r"pg_dump .*-Fc", out) and "--snapshot=" in out
    assert re.search(r"\| age -r " + VALID_RECIPIENT, out)
    assert "pg_export_snapshot()" in out
    assert not log.exists()
    assert not (tmp_path / "backups").exists() or not any((tmp_path / "backups").iterdir())


@needs_bash
def test_backup_dry_run_compose_mode_builds_the_docker_command(tmp_path, shims):
    shim_dir, log = shims
    compose_file = tmp_path / "compose with space.yml"
    env_file = tmp_path / "prod.env"
    env = _env(tmp_path, shim_dir, DRY_RUN="1", BACKUP_MODE="compose", BACKUP_AGE_RECIPIENT=VALID_RECIPIENT,
               COMPOSE_FILE=str(compose_file), COMPOSE_ENV_FILE=str(env_file),
               DATABASE_URL=f"postgresql://luna:{SECRET}@db.example.com/luna", PGPASSWORD=SECRET)
    result = _run(BACKUP, env)
    assert result.returncode == 0, result.stderr
    out = result.stdout + result.stderr
    assert SECRET not in out
    quoted_file = str(compose_file).replace(" ", "\\ ")
    assert f"docker compose -f {quoted_file} --env-file {env_file} exec -T db pg_dump -U luna -d luna -Fc --snapshot=" in out
    assert f"docker compose -f {quoted_file} --env-file {env_file} exec -T db psql" in out
    assert not log.exists()


@needs_bash
def test_backup_dry_run_compose_mode_honours_service_user_and_db(tmp_path, shims):
    shim_dir, _ = shims
    env = _env(tmp_path, shim_dir, DRY_RUN="1", BACKUP_MODE="compose", BACKUP_AGE_RECIPIENT=VALID_RECIPIENT,
               COMPOSE_FILE="deploy/compose.prod.yml", COMPOSE_ENV_FILE="deploy/.env",
               COMPOSE_DB_SERVICE="postgres", COMPOSE_DB_USER="app", COMPOSE_DB_NAME="appdb")
    result = _run(BACKUP, env)
    assert result.returncode == 0, result.stderr
    assert "exec -T postgres pg_dump -U app -d appdb -Fc" in result.stdout


@needs_bash
def test_backup_env_file_is_parsed_not_sourced(tmp_path, shims):
    shim_dir, log = shims
    marker = tmp_path / "pwned"
    env_file = tmp_path / "backup.env"
    env_file.write_text(
        "# comment\n"
        f"BACKUP_AGE_RECIPIENT={VALID_RECIPIENT}\n"
        "DATABASE_URL='postgresql://luna@db.example.com/luna'\n"
        f"BACKUP_UPLOAD_CMD=\"touch {marker}\"\n"
        f"$(touch {marker})\n"
        f"NOT_A_BACKUP_SETTING=`touch {marker}`\n"
    )
    result = _run(BACKUP, _env(tmp_path, shim_dir, DRY_RUN="1"), "--env-file", str(env_file))
    assert result.returncode == 2, result.stdout + result.stderr  # the junk lines are rejected
    assert not marker.exists()
    env_file.write_text(f"BACKUP_AGE_RECIPIENT={VALID_RECIPIENT}\nDATABASE_URL='postgresql://luna@db.example.com/luna'\n")
    result = _run(BACKUP, _env(tmp_path, shim_dir, DRY_RUN="1"), "--env-file", str(env_file))
    assert result.returncode == 0, result.stderr
    assert "PGHOST=db.example.com" in result.stdout
    assert not log.exists()


@needs_bash
def test_backup_help(tmp_path, shims):
    shim_dir, log = shims
    result = _run(BACKUP, _env(tmp_path, shim_dir), "--help")
    assert result.returncode == 0
    assert "BACKUP_AGE_RECIPIENT" in result.stdout
    result = _run(BACKUP, _env(tmp_path, shim_dir), "--bogus")
    assert result.returncode == 2


@needs_bash
@pytest.mark.parametrize(
    "args",
    [
        [],
        ["--file", "x.dump.age"],
        ["--file", "x.dump.age", "--identity", "key.txt"],
        ["--identity", "key.txt", "--target-url", "postgresql://luna@db.example.com/restore"],
        ["--file", "MISSING", "--identity", "MISSING", "--target-url", "postgresql://luna@db.example.com/restore"],
        ["--bogus"],
    ],
)
def test_restore_usage_errors_stop_before_connecting(tmp_path, shims, args):
    shim_dir, log = shims
    result = _run(RESTORE, _env(tmp_path, shim_dir), *args)
    assert result.returncode == 2, result.stdout + result.stderr
    assert not log.exists(), log.read_text()


@needs_bash
def test_restore_requires_the_manifest(tmp_path, shims):
    shim_dir, log = shims
    dump = tmp_path / "luna-20260101T000000Z.dump.age"
    dump.write_bytes(b"age-encryption.org/v1\n")
    key = tmp_path / "key.txt"
    key.write_text("placeholder\n")
    result = _run(RESTORE, _env(tmp_path, shim_dir), "--file", str(dump), "--identity", str(key),
                  "--target-url", "postgresql://luna@db.example.com/restore")
    assert result.returncode == 2
    assert "counts.json" in result.stderr
    assert not log.exists()


@needs_bash
def test_restore_does_not_print_the_target_password(tmp_path, shims):
    shim_dir, _ = shims
    dump = tmp_path / "luna-20260101T000000Z.dump.age"
    dump.write_bytes(b"age-encryption.org/v1\n")
    (tmp_path / "luna-20260101T000000Z.counts.json").write_text('{\n  "users": 1\n}\n')
    key = tmp_path / "key.txt"
    key.write_text("placeholder\n")
    result = _run(RESTORE, _env(tmp_path, shim_dir), "--file", str(dump), "--identity", str(key),
                  "--target-url", f"postgresql://luna:{SECRET}@db.example.com/restore")
    # The age shim fails the pre-flight decryption: exit 1, and no secret anywhere.
    assert result.returncode == 1
    assert SECRET not in result.stdout + result.stderr


# --- retention (--prune-only, fake files) --------------------------------------------

DAY = 86400


def _make_backups(directory, ages_days, now=None):
    """Fake backups whose name and mtime both say `age` days ago; returns names newest first."""
    now = now or time.time()
    directory.mkdir(parents=True, exist_ok=True)
    directory.chmod(0o700)
    names = []
    for age in ages_days:
        moment = now - age * DAY
        stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime(moment))
        dump = directory / f"luna-{stamp}.dump.age"
        counts = directory / f"luna-{stamp}.counts.json"
        dump.write_bytes(b"age-encryption.org/v1\nfake")
        counts.write_text("{}\n")
        for path in (dump, counts):
            os.utime(path, (moment, moment))
        names.append(dump.name)
    return sorted(names, reverse=True)


def _prune(tmp_path, shim_dir, backup_dir, **extra):
    env = _env(tmp_path, shim_dir, BACKUP_DIR=str(backup_dir), **extra)
    return _run(BACKUP, env, "--prune-only")


def _dumps(directory):
    return sorted((p.name for p in directory.glob("luna-*.dump.age")), reverse=True)


@needs_bash
def test_retention_keeps_the_newest_n(tmp_path, shims):
    shim_dir, log = shims
    backups = tmp_path / "backups"
    names = _make_backups(backups, [d + 0.1 for d in range(20)])
    result = _prune(tmp_path, shim_dir, backups)  # defaults: 14 and 30 days
    assert result.returncode == 0, result.stderr
    assert _dumps(backups) == names[:14]
    for name in names[14:]:
        assert not (backups / name.replace(".dump.age", ".counts.json")).exists()
    for name in names[:14]:
        assert (backups / name.replace(".dump.age", ".counts.json")).exists()
    assert not log.exists()


@needs_bash
def test_retention_deletes_backups_older_than_keep_days(tmp_path, shims):
    shim_dir, _ = shims
    backups = tmp_path / "backups"
    names = _make_backups(backups, [0.1, 10, 29, 31, 45])
    result = _prune(tmp_path, shim_dir, backups, BACKUP_KEEP_LAST="14", BACKUP_KEEP_DAYS="30")
    assert result.returncode == 0, result.stderr
    assert _dumps(backups) == names[:3]


@needs_bash
def test_retention_never_deletes_the_newest_backup(tmp_path, shims):
    shim_dir, _ = shims
    backups = tmp_path / "backups"
    names = _make_backups(backups, [45, 60, 90])
    result = _prune(tmp_path, shim_dir, backups, BACKUP_KEEP_DAYS="30")
    assert result.returncode == 0, result.stderr
    assert _dumps(backups) == names[:1]
    assert (backups / names[0].replace(".dump.age", ".counts.json")).exists()


@needs_bash
def test_retention_applies_both_limits(tmp_path, shims):
    shim_dir, _ = shims
    backups = tmp_path / "backups"
    names = _make_backups(backups, [0.1, 1, 2, 3, 40])
    result = _prune(tmp_path, shim_dir, backups, BACKUP_KEEP_LAST="2", BACKUP_KEEP_DAYS="30")
    assert result.returncode == 0, result.stderr
    assert _dumps(backups) == names[:2]
    _make_backups(backups, [35, 36])
    result = _prune(tmp_path, shim_dir, backups, BACKUP_KEEP_LAST="5", BACKUP_KEEP_DAYS="30")
    assert _dumps(backups) == names[:2]


@needs_bash
def test_retention_only_touches_backup_files_in_the_directory(tmp_path, shims):
    shim_dir, _ = shims
    backups = tmp_path / "backups"
    names = _make_backups(backups, [0.1, 50])
    old = time.time() - 100 * DAY
    outside = tmp_path / "outside"
    outside.mkdir()
    precious = outside / "luna-20200101T000000Z.dump.age"
    precious.write_text("not ours")
    subdir = backups / "archive"
    subdir.mkdir()
    nested = subdir / "luna-20200101T000000Z.dump.age"
    nested.write_text("nested")
    link = backups / "luna-20200102T000000Z.dump.age"
    link.symlink_to(precious)
    others = [backups / "notes.txt", backups / "luna-manual.dump.age", backups / "luna-20200101T000000Z.dump",
              backups / "other-20200101T000000Z.dump.age"]
    for path in others:
        path.write_text("keep me")
    for path in others + [nested, precious]:
        os.utime(path, (old, old))
    os.utime(link, (old, old), follow_symlinks=False)

    result = _prune(tmp_path, shim_dir, backups, BACKUP_KEEP_LAST="1", BACKUP_KEEP_DAYS="1")
    assert result.returncode == 0, result.stderr
    assert not (backups / names[1]).exists()
    assert (backups / names[0]).exists()
    for path in others + [nested, precious]:
        assert path.exists(), path
    assert link.is_symlink()
    assert precious.read_text() == "not ours"


@needs_bash
def test_retention_removes_stale_partials_and_orphan_manifests(tmp_path, shims):
    shim_dir, _ = shims
    backups = tmp_path / "backups"
    names = _make_backups(backups, [0.1])
    partial = backups / "luna-20200101T000000Z.dump.age.partial"
    partial.write_bytes(b"age-encryption.org/v1\n")
    counts_partial = backups / "luna-20200101T000000Z.counts.json.partial"
    counts_partial.write_text("{}")
    orphan = backups / "luna-20200101T000000Z.counts.json"
    orphan.write_text("{}")
    result = _prune(tmp_path, shim_dir, backups)
    assert result.returncode == 0, result.stderr
    assert not partial.exists() and not counts_partial.exists() and not orphan.exists()
    assert _dumps(backups) == names


@needs_bash
def test_retention_with_an_empty_or_missing_directory(tmp_path, shims):
    shim_dir, _ = shims
    backups = tmp_path / "backups"
    result = _prune(tmp_path, shim_dir, backups)
    assert result.returncode == 0, result.stderr
    assert stat.S_IMODE(backups.stat().st_mode) == 0o700


@needs_bash
def test_retention_refuses_while_another_backup_holds_the_lock(tmp_path, shims):
    shim_dir, _ = shims
    backups = tmp_path / "backups"
    _make_backups(backups, [0.1, 50])
    lock = backups / ".backup.lock"
    lock.mkdir()
    (lock / "pid").write_text(f"{os.getpid()}\n")  # a live process
    result = _prune(tmp_path, shim_dir, backups, BACKUP_KEEP_DAYS="1")
    assert result.returncode == 3, result.stderr
    assert len(_dumps(backups)) == 2
    (lock / "pid").write_text("999999\n")  # stale: taken over
    result = _prune(tmp_path, shim_dir, backups, BACKUP_KEEP_DAYS="1")
    assert result.returncode == 0, result.stderr
    assert len(_dumps(backups)) == 1
    assert not lock.exists()
