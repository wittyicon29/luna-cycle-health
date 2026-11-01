# Luna Health API image. Build context: backend/ (see backend/.dockerignore).
# Used by deploy/compose.prod.yml for both the one-shot `migrate` job and the `api` service.

# --- builder: install the pinned runtime requirements into a self-contained venv -------
FROM python:3.11-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH

# Runtime requirements only (requirements-dev.txt and tests are never installed or copied).
COPY requirements.txt /tmp/requirements.txt
RUN pip install -r /tmp/requirements.txt

# --- runtime -----------------------------------------------------------------------------
FROM python:3.11-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH=/opt/venv/bin:$PATH \
    APP_ENV=production \
    WEB_CONCURRENCY=2

# Unprivileged user; the code stays root-owned and read-only to it.
RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --no-create-home --home-dir /app --shell /usr/sbin/nologin app

COPY --from=builder /opt/venv /opt/venv

WORKDIR /app
COPY requirements.txt alembic.ini ./
COPY alembic/ ./alembic/
COPY scripts/ ./scripts/
COPY app/ ./app/

USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["python", "-c", "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"]

# Proxy headers: uvicorn rewrites request.client from X-Forwarded-For only for peers in
# --forwarded-allow-ips. It is pinned to 127.0.0.1 (the in-container healthcheck) so the
# proxy's header is NOT applied by uvicorn; the application's get_client_ip() decides
# whom to trust from TRUSTED_PROXY_IPS (compose sets it to the Caddy container only).
# Never set this to '*' or export FORWARDED_ALLOW_IPS: that would bypass that check.
# `sh -c` lets WEB_CONCURRENCY expand; `exec` makes gunicorn PID 1 so it gets SIGTERM.
CMD ["sh", "-c", "exec gunicorn app.main:app -k uvicorn.workers.UvicornWorker -b 0.0.0.0:8000 --workers ${WEB_CONCURRENCY:-2} --timeout 90 --graceful-timeout 30 --forwarded-allow-ips 127.0.0.1"]
