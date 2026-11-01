# Deploying the Luna Health API

One Docker Compose stack on one Linux server: Postgres 16, Redis 7, a one-shot migration
job, the API (gunicorn + uvicorn workers, non-root) and Caddy 2 with automatic HTTPS.
Only Caddy publishes ports (80 and 443); the database, Redis and the API are reachable
only on the private compose network.

| File | Purpose |
| --- | --- |
| `compose.prod.yml` | the stack |
| `Caddyfile` | TLS, HTTP->HTTPS redirect, security headers, 2 MB body limit, JSON access log, hides `/docs` `/redoc` `/openapi.json` |
| `.env.example` | every setting, with comments; copy to `deploy/.env` (git-ignored) |
| `smoke.sh` | post-deploy checks through the public proxy |
| `../backend/Dockerfile` | the API image |

> **WARNING: back up `ENCRYPTION_KEYS` (and `BILLING_ACCOUNT_SECRET`, `SECRET_KEY`) before
> the first real user signs up.** Health data is encrypted with `ENCRYPTION_KEYS`; if the
> keys are lost the data cannot be decrypted, by anyone, ever. Keep a copy outside the
> server (password manager or offline storage). Changing `BILLING_ACCOUNT_SECRET` later
> detaches existing Play purchases from their users.

## First deploy

1. **DNS.** Create an A (and AAAA, if the server has IPv6) record for the API name, e.g.
   `api.example.com`, pointing at the server. Wait until it resolves; Caddy needs it to get
   the certificate.
2. **Server prep.** A Linux host with Docker Engine and the Compose plugin
   (https://docs.docker.com/engine/install/). Open only TCP 22 (SSH), TCP 80, TCP 443 and
   UDP 443 in the firewall. Keep the OS patched.
3. **Clone.** `git clone <repository-url> luna && cd luna` (all commands below run from the
   repository root).
4. **Create `.env`.** `cp deploy/.env.example deploy/.env && chmod 600 deploy/.env`.
5. **Fill in secrets.** Edit `deploy/.env` and set every `REQUIRED` value: `API_DOMAIN`,
   `ACME_EMAIL`, `POSTGRES_PASSWORD` and `REDIS_PASSWORD` (`openssl rand -hex 24`: use
   hex/alphanumeric values, they are embedded in connection URLs unencoded), `SECRET_KEY`
   (`openssl rand -hex 32`), `ENCRYPTION_KEYS` (Fernet command in the file), `SMTP_*`,
   `SUPPORT_EMAIL`, and `ALLOWED_ORIGINS`/`FRONTEND_URL`. Set `BILLING_ACCOUNT_SECRET` too.
   Leave `DATABASE_URL`, `REDIS_URL`, `APP_ENV`, `RATE_LIMIT_STORAGE` and
   `TRUSTED_PROXY_IPS` unset; compose sets them.
6. **Back up the keys** (see the warning above) before going further.
7. **Start.** `docker compose -f deploy/compose.prod.yml up -d --build`. Compose builds the
   image, waits for Postgres, runs `migrate` once (builds an empty database to the current
   schema, or upgrades an existing one), then starts the API and Caddy.
8. **Check.** `docker compose -f deploy/compose.prod.yml ps` (api `healthy`, migrate
   `exited (0)`) and `docker compose -f deploy/compose.prod.yml logs migrate api proxy`.
9. **Smoke test.** From your workstation: `deploy/smoke.sh api.example.com` (your domain).
   Every line must say `PASS`.
10. **Backups.** Until automated backups land (a later release), take a manual dump before
    and after every deploy and copy it off the server:
    `docker compose -f deploy/compose.prod.yml exec -T db pg_dump -U luna -Fc luna > luna-$(date +%F).dump`.

## Updating

`git pull` then `docker compose -f deploy/compose.prod.yml up -d --build`. The `migrate`
job runs again and upgrades the schema before the new API starts. Take a database dump
first.

## Notes

- **Client IP / rate limits.** Caddy has no `trusted_proxies`, so it overwrites any
  client-supplied `X-Forwarded-For` with the real peer address. The API honours
  `X-Forwarded-For` only from Caddy's fixed address (`172.28.0.10`, `TRUSTED_PROXY_IPS`
  in `compose.prod.yml`); uvicorn itself is not allowed to rewrite the client address. If
  you later put a CDN or load balancer in front of Caddy, add its published ranges as
  `trusted_proxies` in the Caddyfile (see the comment there). If `172.28.0.0/24` collides
  with a network on the host, change the subnet, `ip_range`, the proxy's `ipv4_address`
  and `TRUSTED_PROXY_IPS` together.
- **Workers.** `WEB_CONCURRENCY` (default 2) gunicorn workers, each with up to
  `DB_POOL_SIZE + DB_MAX_OVERFLOW` connections; keep the total under Postgres
  `max_connections` (100).
- **Google Play billing.** With `BILLING_MODE=google`, mount the service-account JSON
  read-only (commented example in `compose.prod.yml`), make it readable by uid 10001, and
  point `GOOGLE_PLAY_SERVICE_ACCOUNT_FILE` at the in-container path.
- **Existing databases without Alembic history** (built by `create_all` in development):
  `migrate` refuses them. After checking the schema matches, run
  `docker compose -f deploy/compose.prod.yml run --rm migrate python scripts/migrate.py --stamp-existing`.
- **Logs.** Caddy writes JSON access logs to stdout without request bodies, request headers
  or the OAuth `code` query parameter: `docker compose -f deploy/compose.prod.yml logs proxy`.
