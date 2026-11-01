"""Structural checks for the production deploy files (Docker is not available in CI here).

These do not prove the image builds or the stack starts; they pin the security-relevant
shape of the files: exposure, secrets, proxy-header trust, non-root runtime and the env
template staying in sync with Settings.
"""
import ipaddress
import os
import re
import shutil
import stat
import subprocess
from pathlib import Path

import pytest
import yaml

from app.core.config import Settings

REPO = Path(__file__).resolve().parents[2]
BACKEND = REPO / "backend"
DEPLOY = REPO / "deploy"
COMPOSE = DEPLOY / "compose.prod.yml"
CADDYFILE = DEPLOY / "Caddyfile"
ENV_EXAMPLE = DEPLOY / ".env.example"
SMOKE = DEPLOY / "smoke.sh"
DEPLOY_README = DEPLOY / "README.md"
DOCKERFILE = BACKEND / "Dockerfile"
DOCKERIGNORE = BACKEND / ".dockerignore"

PINNED_IMAGES = {"db": "postgres:16", "redis": "redis:7", "proxy": "caddy:2"}


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def compose():
    return yaml.safe_load(_read(COMPOSE))


@pytest.fixture(scope="module")
def services(compose):
    return compose["services"]


def _env(service) -> dict:
    env = service.get("environment") or {}
    if isinstance(env, list):
        env = dict(item.split("=", 1) for item in env)
    return env


def _dockerfile_instructions():
    """Dockerfile lines with continuations joined and comments dropped."""
    joined, current = [], ""
    for raw in _read(DOCKERFILE).splitlines():
        line = raw.strip()
        if not current and (not line or line.startswith("#")):
            continue
        if line.endswith("\\"):
            current += line[:-1] + " "
            continue
        joined.append(current + line)
        current = ""
    return joined


# --- compose -------------------------------------------------------------------------


def test_compose_has_expected_services(services):
    assert set(services) == {"db", "redis", "migrate", "api", "proxy"}


def test_only_the_proxy_publishes_ports(services):
    published = {name for name, svc in services.items() if svc.get("ports")}
    assert published == {"proxy"}
    for port in services["proxy"]["ports"]:
        container_port = str(port).split(":")[-1].split("/")[0]
        assert container_port in {"80", "443"}


def test_no_host_networking_or_privileged_services(services):
    for name, svc in services.items():
        assert svc.get("network_mode") is None, name
        assert not svc.get("privileged"), name


def test_images_pinned_to_major_tags(services):
    for name, image in PINNED_IMAGES.items():
        assert services[name]["image"] == image
    for svc in services.values():
        image = svc.get("image", "")
        assert not image.endswith(":latest") or "build" in svc


def test_api_waits_for_migration_and_dependencies(services):
    deps = services["api"]["depends_on"]
    assert deps["migrate"]["condition"] == "service_completed_successfully"
    assert deps["redis"]["condition"] == "service_healthy"
    assert deps["db"]["condition"] == "service_healthy"
    assert services["migrate"]["depends_on"]["db"]["condition"] == "service_healthy"


def test_restart_policies(services):
    assert services["migrate"]["restart"] == "no"
    for name in ("db", "redis", "api", "proxy"):
        assert services[name]["restart"] == "unless-stopped", name


def test_migrate_runs_the_migration_cli(services):
    command = services["migrate"]["command"]
    if isinstance(command, str):
        command = command.split()
    assert command == ["python", "scripts/migrate.py"]
    assert (BACKEND / "scripts" / "migrate.py").is_file()


def test_api_and_migrate_build_the_backend_image(services):
    for name in ("api", "migrate"):
        build = services[name]["build"]
        assert (COMPOSE.parent / build["context"]).resolve() == BACKEND
        assert services[name]["image"] == services["api"]["image"]


def test_db_and_redis_have_healthchecks(services):
    assert "pg_isready" in str(services["db"]["healthcheck"]["test"])
    assert "ping" in str(services["redis"]["healthcheck"]["test"])


def test_redis_requires_a_password(services):
    command = services["redis"]["command"]
    command = command if isinstance(command, str) else " ".join(command)
    assert "--requirepass" in command
    assert re.search(r"--requirepass\s+\$\{REDIS_PASSWORD:\?", command)


def test_app_services_get_production_urls_from_env(services):
    for name in ("api", "migrate"):
        env = _env(services[name])
        assert env["APP_ENV"] == "production"
        assert env["RATE_LIMIT_STORAGE"] == "redis"
        assert env["REDIS_URL"].startswith("redis://:${REDIS_PASSWORD:?")
        assert env["REDIS_URL"].endswith("@redis:6379/0")
        assert env["DATABASE_URL"].startswith("postgresql://")
        assert "${POSTGRES_PASSWORD:?" in env["DATABASE_URL"]
        assert services[name]["env_file"] in (".env", [".env"])


def test_network_has_fixed_subnet_and_trusted_proxy_is_only_the_proxy(compose, services):
    networks = compose["networks"]
    assert len(networks) == 1
    (net_name, net), = networks.items()
    ipam = net["ipam"]["config"][0]
    subnet = ipaddress.ip_network(ipam["subnet"])
    dynamic = ipaddress.ip_network(ipam["ip_range"])
    proxy_ip = ipaddress.ip_address(services["proxy"]["networks"][net_name]["ipv4_address"])
    assert proxy_ip in subnet
    # Docker hands out dynamic addresses from ip_range only, so no other container can get the proxy's.
    assert dynamic.subnet_of(subnet) and proxy_ip not in dynamic
    for name in ("api", "migrate"):
        trusted = _env(services[name])["TRUSTED_PROXY_IPS"]
        assert ipaddress.ip_network(trusted) == ipaddress.ip_network(f"{proxy_ip}/32")
    for name, svc in services.items():
        assert net_name in svc["networks"], name


def test_secrets_come_from_env_references_only():
    text = _read(COMPOSE)
    for match in re.finditer(r"(?im)^\s*[\w-]*(password|secret|key|token)[\w-]*\s*:\s*(.+)$", text):
        value = match.group(2).strip().strip("\"'")
        assert value.startswith("${") and ":?" in value, match.group(0)
    urls = re.findall(r"(?:postgresql|redis)://\S+", text)
    assert urls
    for url in urls:
        assert re.match(r"\w+://\w*:\$\{\w+:\?", url), url


def test_uvicorn_is_not_told_to_trust_forwarded_headers():
    for path in (COMPOSE, DOCKERFILE, ENV_EXAMPLE):
        text = _read(path)
        assert not re.search(r"(?m)^\s*-?\s*FORWARDED_ALLOW_IPS\s*[:=]", text), path
        assert not re.search(r"forwarded-allow-ips[\"',\s=]+\*", text), path
        assert "--proxy-headers" not in text, path


# --- Dockerfile ----------------------------------------------------------------------


def test_dockerfile_uses_pinned_slim_base_and_non_root_user():
    instructions = _dockerfile_instructions()
    froms = [line for line in instructions if line.upper().startswith("FROM ")]
    assert froms and all(line.split()[1] == "python:3.11-slim" for line in froms)
    users = [line.split()[1] for line in instructions if line.upper().startswith("USER ")]
    assert users and users[-1] not in ("root", "0")
    assert any("10001" in line for line in instructions if "useradd" in line)


def test_dockerfile_copies_only_runtime_files():
    copies = [line for line in _dockerfile_instructions() if line.upper().startswith("COPY ")]
    sources = []
    for line in copies:
        parts = [p for p in line.split()[1:] if not p.startswith("--")]
        if "--from=" in line:
            continue
        sources.extend(s.rstrip("/") for s in parts[:-1])
    assert sources
    assert set(sources) <= {"app", "alembic", "alembic.ini", "scripts", "requirements.txt"}
    text = _read(DOCKERFILE)
    assert not re.search(r"(?m)^\s*COPY\s+\.\s", text)
    assert ".env" not in " ".join(copies)
    assert "tests" not in " ".join(copies)


def test_dockerfile_env_healthcheck_and_cmd():
    text = _read(DOCKERFILE)
    assert "PYTHONUNBUFFERED=1" in text and "PYTHONDONTWRITEBYTECODE=1" in text
    health = [line for line in _dockerfile_instructions() if line.upper().startswith("HEALTHCHECK")]
    assert health and "urllib" in health[0] and ":8000/health" in health[0]
    cmd = [line for line in _dockerfile_instructions() if line.upper().startswith("CMD")]
    assert len(cmd) == 1
    assert "gunicorn" in cmd[0] and "uvicorn.workers.UvicornWorker" in cmd[0]
    assert "${WEB_CONCURRENCY:-2}" in cmd[0] and "sh" in cmd[0] and "exec gunicorn" in cmd[0]
    assert "0.0.0.0:8000" in cmd[0]
    assert "--forwarded-allow-ips 127.0.0.1" in cmd[0]
    assert any(line.startswith("ENV ") and "WEB_CONCURRENCY=2" in line for line in _dockerfile_instructions())


def test_gunicorn_is_pinned():
    assert re.search(r"(?m)^gunicorn==23\.0\.0$", _read(BACKEND / "requirements.txt"))


def test_dockerignore_excludes_local_and_secret_files():
    lines = {line.strip() for line in _read(DOCKERIGNORE).splitlines() if line.strip() and not line.startswith("#")}
    for entry in (".env", ".git", "tests", "test.db", "__pycache__", ".venv"):
        assert any(line.rstrip("/").endswith(entry) and not line.startswith("!") for line in lines), entry


# --- Caddy ---------------------------------------------------------------------------


def _caddy_without_comments() -> str:
    return "\n".join(line.split("#", 1)[0] for line in _read(CADDYFILE).splitlines())


def test_caddyfile_site_proxy_and_hardening():
    text = _caddy_without_comments()
    assert "{$API_DOMAIN}" in text
    assert re.search(r"reverse_proxy\s+api:8000", text)
    assert "encode zstd gzip" in text
    assert "Strict-Transport-Security" in text
    assert re.search(r"X-Content-Type-Options\s+\"?nosniff", text)
    assert "-Server" in text
    assert re.search(r"max_size\s+2MB", text)
    assert re.search(r"format\s+filter", text) and "wrap json" in text
    assert "output stdout" in text


def test_caddyfile_blocks_api_docs():
    text = _caddy_without_comments()
    matcher = re.search(r"@\w+\s+path\s+([^\n]+)", text)
    assert matcher
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert path in matcher.group(1).split()
    assert re.search(r"respond\s+404|error\s+404", text)


def test_caddy_does_not_trust_client_forwarded_headers():
    # Without trusted_proxies Caddy replaces client X-Forwarded-For with the real peer.
    text = _caddy_without_comments()
    assert "trusted_proxies" not in text
    assert "client_ip_headers" not in text


# --- env template --------------------------------------------------------------------


def test_env_template_mentions_every_setting():
    text = _read(ENV_EXAMPLE)
    missing = [name for name in Settings.model_fields if not re.search(rf"(?m)^#?\s*{name}=", text)]
    assert not missing, f"deploy/.env.example does not document: {missing}"


def test_env_template_documents_compose_variables_and_key_generation():
    text = _read(ENV_EXAMPLE)
    for name in ("POSTGRES_PASSWORD", "REDIS_PASSWORD", "API_DOMAIN", "ACME_EMAIL", "WEB_CONCURRENCY"):
        assert re.search(rf"(?m)^{name}=", text), name
    assert "Fernet.generate_key()" in text
    assert "openssl rand -hex" in text
    assert "REQUIRED" in text


def test_env_template_every_variable_has_a_comment():
    lines = _read(ENV_EXAMPLE).splitlines()
    for index, line in enumerate(lines):
        if re.match(r"^#?\s*[A-Z][A-Z0-9_]*=", line):
            previous = [l for l in lines[:index] if l.strip()]
            assert previous and previous[-1].startswith("#"), line


# --- smoke script --------------------------------------------------------------------


def test_smoke_script_is_executable_and_parses():
    mode = SMOKE.stat().st_mode
    assert mode & stat.S_IXUSR
    tracked = subprocess.run(
        ["git", "ls-files", "-s", "deploy/smoke.sh"], cwd=REPO, capture_output=True, text=True
    ).stdout
    if tracked:
        assert tracked.startswith("100755")
    bash = shutil.which("bash")
    if bash:
        assert subprocess.run([bash, "-n", str(SMOKE)], capture_output=True).returncode == 0
    text = _read(SMOKE)
    assert text.startswith("#!/usr/bin/env bash")
    assert "set -euo pipefail" in text
    for needle in ("/health", "/ready", "/docs", "/openapi.json", "http://", "Strict-Transport-Security", "nosniff", "PASS", "FAIL"):
        assert needle in text, needle


def test_smoke_script_requires_a_domain_argument():
    bash = shutil.which("bash")
    if not bash:
        pytest.skip("bash not available")
    result = subprocess.run([bash, str(SMOKE)], capture_output=True, text=True)
    assert result.returncode != 0
    result = subprocess.run([bash, str(SMOKE), "bad domain; rm -rf /"], capture_output=True, text=True)
    assert result.returncode != 0


# --- docs and repo hygiene -----------------------------------------------------------


def test_deploy_readme_has_backup_warning_and_steps():
    text = _read(DEPLOY_README)
    assert "ENCRYPTION_KEYS" in text and "BILLING_ACCOUNT_SECRET" in text
    assert re.search(r"(?i)back\s*up", text)
    assert "docker compose -f deploy/compose.prod.yml" in text
    assert re.search(r"(?m)^10\. ", text)
    assert "deploy/README.md" in _read(REPO / "README.md")


DEPLOY_FILES = [COMPOSE, CADDYFILE, ENV_EXAMPLE, SMOKE, DEPLOY_README, DOCKERFILE, DOCKERIGNORE]
ALLOWED_HOST_SUFFIXES = ("example.com", "example.org", "example.net", "caddyserver.com", "docs.docker.com")


@pytest.mark.parametrize("path", DEPLOY_FILES, ids=lambda p: p.name)
def test_no_company_resources_or_real_hostnames(path):
    text = _read(path)
    assert "cfologic" not in text.lower()
    for host in re.findall(r"\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|dev|app|in|co|ai)\b", text.lower()):
        assert host.endswith(ALLOWED_HOST_SUFFIXES), f"{path.name}: {host}"
    assert not re.search(r"[\w.+-]+@(?!example\.)[\w-]+\.[a-z]{2,}", text.lower().replace("@redis:", "").replace("@db:", ""))


@pytest.mark.parametrize("path", DEPLOY_FILES, ids=lambda p: p.name)
def test_no_literal_secrets(path):
    text = _read(path)
    # Long random-looking tokens (keys, passwords) must never be committed.
    for token in re.findall(r"[A-Za-z0-9+/_-]{32,}", text):
        assert not (re.search(r"[A-Z]", token) and re.search(r"[a-z]", token) and re.search(r"\d", token)), token
        assert not re.fullmatch(r"[0-9a-f]{32,}", token), token


def test_gitignore_tracks_deploy_files_but_not_the_real_env():
    def ignored(rel):
        return subprocess.run(["git", "check-ignore", "-q", rel], cwd=REPO).returncode == 0

    assert ignored("deploy/.env")
    for rel in ("deploy/.env.example", "deploy/compose.prod.yml", "deploy/Caddyfile", "deploy/smoke.sh",
                "deploy/README.md", "backend/Dockerfile", "backend/.dockerignore"):
        assert not ignored(rel), rel
