"""The hash-pinned lock files and the human-edited requirements files agree.

requirements.txt / requirements-dev.txt hold the direct pins; requirements.lock /
requirements-dev.lock are generated from them with pip-compile (exact command below and in
docs/superpowers/runbook.md, "Updating dependencies"). The Docker image installs
requirements.lock with --require-hashes --no-deps and CI installs requirements-dev.lock, so
an input change that is not re-locked would silently not ship.

The structural checks always run. The re-lock check needs pip-tools (in
requirements-dev.txt) and network access, and runs only on Linux with Python 3.11 because
pip-compile evaluates environment markers for the machine it runs on (greenlet, for
example, is a SQLAlchemy dependency only on x86_64/aarch64 Linux and Windows). CI sets
LUNA_REQUIRE_LOCK_CHECK=1 so that it fails instead of skipping there. It re-resolves
without --generate-hashes and compares the pinned versions: pip-tools 7.6.2 computes
hashes by downloading every file of every release (its PyPI JSON lookup does not match
pypi.org's URL layout), gigabytes for numpy and scipy alone, which is fine when locking but
too slow for every CI run. The hashes themselves are checked by every --require-hashes
install (CI and the image).
"""

import importlib.util
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
REQUIREMENTS = BACKEND / "requirements.txt"
REQUIREMENTS_DEV = BACKEND / "requirements-dev.txt"
LOCK = BACKEND / "requirements.lock"
LOCK_DEV = BACKEND / "requirements-dev.lock"

# The canonical flags (runbook) minus --generate-hashes; see the module docstring.
SYNC_FLAGS = ["--quiet", "--allow-unsafe", "--strip-extras", "--no-header", "--no-annotate"]
PAIRS = [("requirements.txt", "requirements.lock"), ("requirements-dev.txt", "requirements-dev.lock")]

_PIN = re.compile(r"^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?==([^\s;#]+)")
_LOCK_ENTRY = re.compile(r"^([a-z0-9][a-z0-9._-]*)==(\S+)")


def _canonical(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def _input_pins(path: Path) -> dict:
    """Direct pins of a requirements input file, following -r includes."""
    pins = {}
    for raw in path.read_text().splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        if line.startswith("-r "):
            pins.update(_input_pins(path.parent / line[3:].strip()))
            continue
        match = _PIN.match(line)
        assert match, f"{path.name}: not an exact pin: {raw!r}"
        pins[_canonical(match.group(1))] = match.group(3)
    return pins


def _locked_versions(text: str) -> dict:
    return {
        _canonical(m.group(1)): m.group(2)
        for m in (_LOCK_ENTRY.match(line.strip()) for line in text.splitlines())
        if m
    }


def _lock_entries(path: Path) -> dict:
    """{name: (version, sorted hashes)} of a pip-compile --generate-hashes output."""
    text = path.read_text()
    entries = {}
    # One entry = a "name==version \" line plus its "--hash=..." continuation lines.
    for block in re.split(r"\n(?=[a-z0-9])", text):
        first = block.splitlines()[0]
        if first.startswith("#") or not first.strip():
            continue
        match = _LOCK_ENTRY.match(first)
        assert match, f"{path.name}: unexpected line {first!r}"
        hashes = sorted(re.findall(r"--hash=sha256:([0-9a-f]{64})", block))
        assert hashes, f"{path.name}: {first!r} has no sha256 hash"
        entries[_canonical(match.group(1))] = (match.group(2), hashes)
    return entries


def test_inputs_contain_only_exact_pins():
    assert _input_pins(REQUIREMENTS)
    assert set(_input_pins(REQUIREMENTS)) <= set(_input_pins(REQUIREMENTS_DEV))


@pytest.mark.parametrize("lock", [LOCK, LOCK_DEV], ids=lambda p: p.name)
def test_every_lock_entry_is_pinned_with_hashes(lock):
    entries = _lock_entries(lock)
    assert len(entries) > 20
    text = lock.read_text()
    # Nothing unpinned or editable can sneak into a --require-hashes install.
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith("--hash="):
            continue
        assert _LOCK_ENTRY.match(stripped), f"{lock.name}: {line!r}"


@pytest.mark.parametrize("source, lock", [(REQUIREMENTS, LOCK), (REQUIREMENTS_DEV, LOCK_DEV)],
                         ids=["runtime", "dev"])
def test_every_direct_pin_is_locked_at_the_same_version(source, lock):
    entries = _lock_entries(lock)
    for name, version in _input_pins(source).items():
        assert name in entries, f"{name} is pinned in {source.name} but missing from {lock.name}"
        assert entries[name][0] == version, f"{name}: {source.name} {version}, {lock.name} {entries[name][0]}"


def test_dev_lock_contains_the_runtime_lock_unchanged():
    runtime, dev = _lock_entries(LOCK), _lock_entries(LOCK_DEV)
    for name, entry in runtime.items():
        assert dev.get(name) == entry, f"{name} differs between requirements.lock and requirements-dev.lock"


def test_runtime_lock_has_no_dev_only_packages():
    runtime = _lock_entries(LOCK)
    for name in ("pytest", "pytest-cov", "fakeredis", "pip-tools", "coverage"):
        assert name not in runtime, name


@pytest.mark.parametrize("source, lock", PAIRS)
def test_lock_header_records_the_canonical_command(source, lock):
    header = (BACKEND / lock).read_text()
    command = f"pip-compile --allow-unsafe --generate-hashes --output-file={lock} --strip-extras {source}"
    assert command in header, f"{lock} was not generated with: {command}"


def _skip_or_fail(reason: str):
    if os.environ.get("LUNA_REQUIRE_LOCK_CHECK") == "1":
        pytest.fail(f"lock sync check cannot run: {reason}")
    pytest.skip(reason)


def test_locks_are_in_sync_with_their_inputs(tmp_path):
    """Re-resolve into a copy (existing pins preferred, as in the runbook); same versions."""
    if importlib.util.find_spec("piptools") is None:
        _skip_or_fail("pip-tools is not installed (it is in requirements-dev.txt)")
    if not sys.platform.startswith("linux") or sys.version_info[:2] != (3, 11):
        _skip_or_fail("the locks are resolved for Linux and Python 3.11 (CI runs this check)")
    for source, lock in PAIRS:
        shutil.copy(BACKEND / source, tmp_path / source)
        shutil.copy(BACKEND / lock, tmp_path / lock)
    env = {k: v for k, v in os.environ.items() if k != "CUSTOM_COMPILE_COMMAND"}
    env["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"
    for source, lock in PAIRS:
        result = subprocess.run(
            [sys.executable, "-m", "piptools", "compile", *SYNC_FLAGS, f"--output-file={lock}", source],
            cwd=tmp_path, env=env, capture_output=True, text=True, timeout=900,
        )
        assert result.returncode == 0, result.stderr[-4000:]
        regenerated = _locked_versions((tmp_path / lock).read_text())
        committed = _locked_versions((BACKEND / lock).read_text())
        assert regenerated, result.stderr[-4000:]
        assert regenerated == committed, (
            f"added/changed {sorted(set(regenerated.items()) - set(committed.items()))}, "
            f"dropped/changed {sorted(set(committed.items()) - set(regenerated.items()))}: "
            f"backend/{lock} is out of date with backend/{source}: regenerate it "
            "(docs/superpowers/runbook.md, 'Updating dependencies')"
        )
