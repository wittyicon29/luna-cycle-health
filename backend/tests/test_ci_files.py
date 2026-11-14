"""Static checks of the CI workflows, the CI helper files and the operations runbook.

The workflows themselves only run on GitHub; here they are parsed and checked for the
security rules (read-only token, no pull_request_target, no expressions inside `run:`,
actions pinned to commit SHAs, no secrets), for the steps each job must contain, and the
docker job's generated environment is validated against the real production settings.
"""

import re
import secrets
import subprocess
from pathlib import Path

import pytest
import yaml
from cryptography.fernet import Fernet

from app.core.config import Settings

REPO = Path(__file__).resolve().parents[2]
WORKFLOWS = REPO / ".github" / "workflows"
NAMES = ["backend.yml", "frontend.yml", "audit.yml", "docker.yml", "android.yml"]
RUNBOOK = REPO / "docs" / "superpowers" / "runbook.md"
ALLOWLIST = REPO / ".github" / "audit-allowlist.txt"
NVMRC = REPO / "frontend" / ".nvmrc"
GATE_JS = REPO / "frontend" / "scripts" / "check-build-warnings.js"
AUDIT_GATE = REPO / "scripts" / "ci" / "audit_gate.py"
NEW_FILES = [*(WORKFLOWS / n for n in NAMES), RUNBOOK, ALLOWLIST, NVMRC, GATE_JS, AUDIT_GATE,
             REPO / "frontend" / "src" / "checkBuildWarnings.test.js"]


def _text(path):
    return path.read_text(encoding="utf-8")


def _load(name):
    data = yaml.safe_load(_text(WORKFLOWS / name))
    # YAML 1.1 reads the bare key `on` as True.
    if True in data:
        data["on"] = data.pop(True)
    return data


def _steps(workflow):
    for job_id, job in workflow["jobs"].items():
        for step in job.get("steps", []):
            yield job_id, step


def _runs(workflow):
    return "\n".join(step.get("run", "") for _, step in _steps(workflow))


@pytest.fixture(params=NAMES)
def workflow(request):
    return request.param, _load(request.param)


# --- every workflow ---------------------------------------------------------------------


def test_the_four_workflows_exist_and_test_yml_is_gone():
    assert sorted(p.name for p in WORKFLOWS.glob("*.yml")) == sorted(NAMES)
    assert not list(WORKFLOWS.glob("*.yaml"))


def test_read_only_token(workflow):
    name, data = workflow
    assert data["permissions"] == {"contents": "read"}, name
    for job_id, job in data["jobs"].items():
        for scope, level in (job.get("permissions") or {}).items():
            assert level in ("read", "none"), (name, job_id, scope)


def test_no_dangerous_triggers(workflow):
    name, data = workflow
    triggers = data["on"]
    assert "pull_request_target" not in triggers, name
    assert "workflow_run" not in triggers, name
    assert "pull_request_target" not in _text(WORKFLOWS / name)


def test_concurrency_cancels_superseded_pr_runs(workflow):
    name, data = workflow
    concurrency = data["concurrency"]
    assert "github.workflow" in concurrency["group"] and "github.ref" in concurrency["group"]
    assert "pull_request" in str(concurrency["cancel-in-progress"])


def test_every_job_has_a_timeout_and_a_pinned_runner(workflow):
    name, data = workflow
    for job_id, job in data["jobs"].items():
        assert isinstance(job.get("timeout-minutes"), int) and 0 < job["timeout-minutes"] <= 45, (name, job_id)
        assert job["runs-on"] == "ubuntu-24.04", (name, job_id)


def test_no_expressions_inside_run_blocks(workflow):
    """Untrusted values (PR titles, branch names) must never be pasted into a shell script:
    run blocks use no ${{ }} at all; values come in through env."""
    name, data = workflow
    for job_id, step in _steps(data):
        assert "${{" not in step.get("run", ""), (name, job_id, step.get("name"))
    assert "github.event." not in _text(WORKFLOWS / name)
    assert "github.head_ref" not in _text(WORKFLOWS / name)


def test_actions_are_pinned_to_commit_shas(workflow):
    name, data = workflow
    text = _text(WORKFLOWS / name)
    uses = [step["uses"] for _, step in _steps(data) if "uses" in step]
    assert uses, name
    for ref in uses:
        assert re.fullmatch(r"[\w.-]+/[\w.-]+@[0-9a-f]{40}", ref), ref
        # The commit SHA carries its release tag as a comment.
        assert re.search(rf"uses: {re.escape(ref)} # v\d+\.\d+\.\d+\b", text), ref


def test_same_action_same_pin_everywhere():
    pins = {}
    for name in NAMES:
        for _, step in _steps(_load(name)):
            if "uses" in step:
                action, sha = step["uses"].split("@")
                assert pins.setdefault(action, sha) == sha, action


def test_no_secrets_used(workflow):
    name, _ = workflow
    text = _text(WORKFLOWS / name)
    assert "secrets." not in text
    assert "codecov/codecov-action" not in text


def test_checkout_does_not_persist_the_token(workflow):
    name, data = workflow
    for _, step in _steps(data):
        if step.get("uses", "").startswith("actions/checkout@"):
            assert step.get("with", {}).get("persist-credentials") is False, name


def test_python_is_3_11(workflow):
    name, data = workflow
    for _, step in _steps(data):
        if step.get("uses", "").startswith("actions/setup-python@"):
            assert step["with"]["python-version"] == "3.11", name
            assert step["with"]["cache"] == "pip" and "requirements" in step["with"]["cache-dependency-path"]


def test_bash_with_pipefail_by_default(workflow):
    name, data = workflow
    assert data["defaults"]["run"]["shell"] == "bash", name


# --- backend -------------------------------------------------------------------------------


def test_backend_triggers_match_the_old_workflow():
    on = _load("backend.yml")["on"]
    assert on["push"]["branches"] == ["main", "develop"]
    assert on["pull_request"]["branches"] == ["main", "develop"]


def test_backend_runs_against_postgres_and_redis_services():
    job = _load("backend.yml")["jobs"]["test"]
    services = job["services"]
    assert services["postgres"]["image"] == "postgres:16"
    assert services["redis"]["image"] == "redis:7"
    for service in services.values():
        assert "--health-cmd" in service["options"]
    assert job["env"]["TEST_POSTGRES_URL"].startswith("postgresql://") and ":5432/" in job["env"]["TEST_POSTGRES_URL"]
    assert job["env"]["TEST_REDIS_URL"].startswith("redis://") and ":6379/" in job["env"]["TEST_REDIS_URL"]


def test_backend_installs_the_backup_tools_and_runs_everything():
    data = _load("backend.yml")
    runs = _runs(data)
    assert re.search(r"apt-get install [^\n]*\bage\b[^\n]*\bpostgresql-client-16\b", runs)
    assert "/usr/lib/postgresql/16/bin" in runs and "pg_dump --version" in runs
    assert "pip install --require-hashes --no-deps -r requirements-dev.lock" in runs
    assert "pip check" in runs
    assert not re.search(r"pip install (?:-r )?requirements[\w-]*\.txt", runs)
    assert "shellcheck -x scripts/*.sh deploy/smoke.sh" in runs
    assert re.search(r"pytest tests/[^\n]*--cov=app", runs)
    assert "GITHUB_STEP_SUMMARY" in runs and "coverage report --format=markdown" in runs
    # Service-backed tests must not skip silently in CI.
    assert "TEST_POSTGRES_URL" in runs and "junit.xml" in runs


def test_backend_checks_the_lock_files_are_in_sync():
    data = _load("backend.yml")
    job = data["jobs"]["test"]
    assert job["env"]["LUNA_REQUIRE_LOCK_CHECK"] == "1"  # the sync check fails instead of skipping
    steps = [step for _, step in _steps(data)]
    runs = [step.get("run", "") for step in steps]
    install = next(i for i, run in enumerate(runs) if "requirements-dev.lock" in run)
    check = next(i for i, run in enumerate(runs) if "pytest tests/test_requirements_lock.py" in run)
    suite = next(i for i, run in enumerate(runs) if re.search(r"pytest tests/ ", run))
    assert install < check < suite
    # The main run does not repeat the (network-bound) re-lock.
    assert "--deselect tests/test_requirements_lock.py::test_locks_are_in_sync_with_their_inputs" in runs[suite]


def test_docker_job_checks_the_image_against_the_lock():
    runs = _runs(_load("docker.yml"))
    assert "pip check && pip freeze --all" in runs and "backend/requirements.lock" in runs


# --- frontend ---------------------------------------------------------------------------


def test_frontend_job_runs_i18n_jest_and_the_build_gate():
    data = _load("frontend.yml")
    steps = [step for _, step in _steps(data)]
    node = [s for s in steps if s.get("uses", "").startswith("actions/setup-node@")][0]
    assert node["with"]["node-version-file"] == "frontend/.nvmrc"
    assert node["with"]["cache"] == "npm" and node["with"]["cache-dependency-path"] == "frontend/package-lock.json"
    runs = [s.get("run", "") for s in steps]
    order = ["npm ci", "npm run i18n:check", "CI=true npm test -- --watchAll=false", "node scripts/check-build-warnings.js --max 15"]
    positions = [next(i for i, run in enumerate(runs) if run.startswith(cmd)) for cmd in order]
    assert positions == sorted(positions)
    assert data["defaults"]["run"]["working-directory"] == "frontend"


def test_nvmrc_is_a_node_major_version():
    assert re.fullmatch(r"\d{2}\n", _text(NVMRC))
    assert int(_text(NVMRC)) >= 20


def test_build_gate_runs_the_build_with_ci_false():
    text = _text(GATE_JS)
    assert "CI: 'false'" in text and "'run', 'build'" in text
    assert "DEFAULT_MAX = 15" in text


# --- audit -----------------------------------------------------------------------------------


def test_audit_triggers():
    on = _load("audit.yml")["on"]
    assert on["schedule"] and "cron" in on["schedule"][0]
    assert "workflow_dispatch" in on
    paths = on["pull_request"]["paths"]
    for needed in ("backend/requirements*.txt", "backend/requirements*.lock", "frontend/package.json",
                   "frontend/package-lock.json", ".github/audit-allowlist.txt"):
        assert needed in paths


def test_audit_runs_both_audits_through_the_gate():
    runs = _runs(_load("audit.yml"))
    assert "pip-audit -r backend/requirements.lock --disable-pip -f json" in runs
    assert "pip-audit -r backend/requirements-dev.lock --disable-pip -f json" in runs
    assert "pip-audit -r backend/requirements.txt" not in runs
    assert len(re.findall(r"audit_gate\.py pip ", runs)) == 2
    assert "npm audit --omit=dev --audit-level=high --json" in runs
    assert re.search(r"audit_gate\.py pip [^\n]*--allowlist \.github/audit-allowlist\.txt", runs)
    assert re.search(r"audit_gate\.py npm [^\n]*--min-severity high[^\n]*--allowlist \.github/audit-allowlist\.txt", runs)
    assert re.search(r"pip install pip-audit==\d", runs)


# --- docker ------------------------------------------------------------------------------------


def _docker_env_block():
    runs = _runs(_load("docker.yml"))
    match = re.search(r"<<ENV\n(.*?)\nENV\n", runs, re.S)
    assert match, "the generated env heredoc is missing"
    return dict(line.split("=", 1) for line in match.group(1).splitlines())


def test_docker_job_builds_without_pushing():
    steps = [step for _, step in _steps(_load("docker.yml"))]
    build = [s for s in steps if s.get("uses", "").startswith("docker/build-push-action@")][0]
    assert build["with"]["push"] is False and build["with"]["load"] is True
    assert build["with"]["file"] == "backend/Dockerfile" and build["with"]["context"] == "backend"
    assert any(s.get("uses", "").startswith("docker/setup-buildx-action@") for s in steps)
    services = _load("docker.yml")["jobs"]["smoke"]["services"]
    assert services["postgres"]["image"] == "postgres:16" and services["redis"]["image"] == "redis:7"


def test_docker_job_generates_a_production_env_that_the_app_accepts(monkeypatch):
    env = _docker_env_block()
    assert env["APP_ENV"] == "production"
    assert env["SECRET_KEY"] == "$secret_key" and env["ENCRYPTION_KEYS"] == "$encryption_key"
    runs = _runs(_load("docker.yml"))
    assert 'secret_key="$(openssl rand -hex 32)"' in runs
    assert "Fernet.generate_key()" in runs
    for name in ("ALLOWED_HOSTS", "SUPPORT_EMAIL", "SMTP_SERVER", "SMTP_USER", "SMTP_PASSWORD", "DATABASE_URL",
                 "REDIS_URL", "TRUSTED_PROXY_IPS"):
        assert env.get(name), name
    assert env["RATE_LIMIT_STORAGE"] == "redis" and env["BILLING_MODE"] == "off"
    # Substitute what the step generates, then let the real settings validate it.
    generated = {"$secret_key": secrets.token_hex(32), "$encryption_key": Fernet.generate_key().decode(),
                 "$smtp_password": secrets.token_hex(16), "$API_HOST": "api.example.test"}
    values = {key: generated.get(value, value) for key, value in env.items() if key in Settings.model_fields}
    assert set(env) - set(values) == {"WEB_CONCURRENCY"}  # read by the image's gunicorn CMD
    assert not any("$" in value for value in values.values()), values
    for key in list(Settings.model_fields):
        monkeypatch.delenv(key, raising=False)
    settings = Settings(_env_file=None, **values)
    assert settings.allowed_hosts and "api.example.test" in settings.allowed_hosts
    # Without one of the required values production refuses to start (the check is real).
    with pytest.raises(ValueError):
        Settings(_env_file=None, **{k: v for k, v in values.items() if k != "SUPPORT_EMAIL"})


def test_docker_job_contains_the_smoke_steps():
    data = _load("docker.yml")
    runs = _runs(data)
    assert "python scripts/migrate.py" in runs
    assert re.search(r'docker run -d --name luna-api [^\n]*"\$IMAGE"\s*$', runs, re.M)  # the image CMD (gunicorn)
    for check in (r'check "GET /health[^"]*" 200 -H "Host: \$API_HOST"',
                  r'check "GET /ready[^"]*" 200 -H "Host: \$API_HOST"',
                  r'check "GET /ready via --resolve" 200 --resolve',
                  r'check "GET /docs is hidden" 404',
                  r'check "wrong Host header is rejected" 400 -H "Host: evil\.example\.test"'):
        assert re.search(check, runs), check
    assert data["env"]["API_HOST"] == "api.example.test"
    logs = [step for _, step in _steps(data) if "docker logs" in step.get("run", "")]
    assert logs and logs[0]["if"] == "${{ failure() }}"


def test_docker_job_uses_every_production_requirement_of_the_settings():
    """The names the production validator insists on are all in the generated env."""
    source = _text(REPO / "backend" / "app" / "core" / "config.py")
    required = set(re.findall(r'"(SMTP_\w+|SUPPORT_EMAIL)"', source)) | {"SECRET_KEY", "ENCRYPTION_KEYS", "ALLOWED_HOSTS"}
    assert required <= set(_docker_env_block())


# --- runbook ------------------------------------------------------------------------------------


def _existing_scripts():
    found = [p for p in (REPO / "scripts").rglob("*") if p.is_file() and p.suffix in (".sh", ".py")]
    found += [p for p in (REPO / "backend" / "scripts").glob("*.py") if p.name != "__init__.py"]
    found.append(REPO / "deploy" / "smoke.sh")
    return sorted(str(p.relative_to(REPO)) for p in found)


def test_runbook_mentions_every_script():
    text = _text(RUNBOOK)
    for rel in _existing_scripts():
        assert rel in text, rel


# Paths the owner creates from the templates (git-ignored on purpose) or placeholders.
CREATED_BY_OWNER = {"deploy/.env", "deploy/backup.env", "deploy/secrets/"}


def test_every_path_in_the_runbook_exists():
    text = _text(RUNBOOK)
    paths = set()
    for match in re.finditer(r"(?<![\w./-])((?:\.github|backend|deploy|docs|frontend|scripts)/[\w./*-]*[\w*/])", text):
        # `python scripts/...` runs inside the API image (WORKDIR /app = backend/).
        prefix = "backend/" if text[: match.start()].endswith("python ") else ""
        paths.add(prefix + match.group(1))
    assert len(paths) > 15
    for rel in sorted(paths):
        if rel in CREATED_BY_OWNER:
            continue
        if "*" in rel:
            assert list(REPO.glob(rel)), rel
            continue
        assert (REPO / rel).exists(), rel
    for target in re.findall(r"\]\(((?!https?:|#)[^)#]+)", text):
        assert (RUNBOOK.parent / target).resolve().exists(), target


def test_runbook_commands_use_real_flags():
    """Every --flag on a runbook line that runs one of the scripts is in that script."""
    text = _text(RUNBOOK)
    scripts = {
        "restore_db.sh": REPO / "scripts" / "restore_db.sh",
        "backup_db.sh": REPO / "scripts" / "backup_db.sh",
        "rotate_encryption_keys.py": REPO / "backend" / "scripts" / "rotate_encryption_keys.py",
    }
    checked = 0
    for line in text.splitlines():
        for name, path in scripts.items():
            if name not in line:
                continue
            for command in re.findall(rf"{re.escape(name)}((?: [^`]*)?)`", line):
                for flag in re.findall(r"(?<![\w-])--[a-z][a-z-]*", command):
                    assert flag in _text(path), (name, flag)
                    checked += 1
    assert checked >= 15


def test_runbook_covers_the_required_sections():
    text = _text(RUNBOOK).lower()
    for needle in ("first deploy", "secrets inventory", "rotation", "dry run", "--apply", "monthly restore drill",
                   "do you have the keys", "rollback", "downgrade", "incident", "key leak", "corruption",
                   "provider outage", "rate-limit storm", "billing_mode=off", "monitoring", "/ready", "cert",
                   "backup age", "pre-launch", "privacy_policy_version", "hindi", "play console", "untested here",
                   "--compose", "dry_run=1"):
        assert needle in text, needle


def test_untested_list_names_what_could_not_run_here():
    section = _text(RUNBOOK).split("## Untested here", 1)[1].lower()
    for needle in ("docker", "caddy", "age", "cron", "rclone", "github actions"):
        assert needle in section, needle


# --- android -------------------------------------------------------------------------------


def test_android_workflow_builds_the_debug_apk_on_jdk_21():
    data = _load("android.yml")
    assert data["defaults"]["run"]["working-directory"] == "frontend"
    uses = [s["uses"].split("@")[0] for _, s in _steps(data) if "uses" in s]
    assert "actions/setup-java" in uses and "actions/upload-artifact" in uses
    java = [s for _, s in _steps(data) if s.get("uses", "").startswith("actions/setup-java@")][0]
    assert str(java["with"]["java-version"]) == "21"
    assert java["with"]["distribution"] == "temurin"
    runs = [s.get("run", "") for _, s in _steps(data)]
    assert any("npm run android:sync" in r for r in runs)
    assert any("./gradlew" in r and "assembleDebug" in r for r in runs)
    assert any("lintDebug" in r for r in runs)


def test_android_workflow_only_runs_for_android_relevant_paths():
    data = _load("android.yml")
    paths = data["on"]["pull_request"]["paths"]
    assert "frontend/**" in paths and ".github/workflows/android.yml" in paths


def test_android_workflow_uploads_only_the_debug_apk_and_lint_report():
    text = _text(WORKFLOWS / "android.yml")
    assert "app-debug.apk" in text
    assert "bundleRelease" not in text and "keystore" not in text.lower()
    uploads = [s["with"] for _, s in _steps(_load("android.yml")) if s.get("uses", "").startswith("actions/upload-artifact@")]
    assert [(u["name"], u["path"]) for u in uploads] == [
        ("luna-debug-apk", "frontend/android/app/build/outputs/apk/debug/app-debug.apk"),
        ("luna-lint-report", "frontend/android/app/build/reports/lint-results-debug.html"),
    ]


def test_android_sync_step_runs_with_ci_false():
    """CI=true makes react-scripts fail the build on the baseline ESLint warnings."""
    steps = [s for _, s in _steps(_load("android.yml")) if "npm run android:sync" in s.get("run", "")]
    assert len(steps) == 1 and steps[0]["env"]["CI"] == "false"


def test_android_workflow_asserts_target_sdk_36():
    text = _text(WORKFLOWS / "android.yml")
    assert "targetSdkVersion:'36'" in text and "aapt2" in text


# --- hygiene -----------------------------------------------------------------------------------


@pytest.mark.parametrize("path", NEW_FILES + [REPO / "README.md", REPO / "deploy" / "README.md"], ids=lambda p: p.name)
def test_no_secrets_or_real_contacts(path):
    text = _text(path)
    assert "-----BEGIN" not in text
    assert not re.search(r"AKIA[0-9A-Z]{16}", text)
    assert not re.search(r"\bgh[pousr]_[A-Za-z0-9]{20,}", text)
    assert not re.search(r"AGE-SECRET-KEY-1[0-9A-Z]{20,}", text)
    assert "cfologic" not in text.lower()
    for email in re.findall(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}\b", text):
        domain = email.split("@", 1)[1].lower()
        assert domain.endswith(("example.com", "example.org", "example.net", "example.test")) or domain in (
            "anthropic.com",
        ), email


def test_new_files_are_not_git_ignored():
    for path in NEW_FILES:
        rel = str(path.relative_to(REPO))
        ignored = subprocess.run(["git", "check-ignore", "-q", rel], cwd=REPO).returncode == 0
        assert not ignored, rel
