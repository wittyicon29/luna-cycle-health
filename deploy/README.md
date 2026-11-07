# Deploying the Luna Health API

One Docker Compose stack on one Linux server: Postgres 16, Redis 7, a one-shot migration
job, the API (gunicorn + uvicorn workers, non-root) and Caddy 2 with automatic HTTPS.
Only Caddy publishes ports (80 and 443, IPv4); the database, Redis and the API are
reachable only on the private compose network.

| File | Purpose |
| --- | --- |
| `compose.prod.yml` | the stack |
| `Caddyfile` | TLS, HTTP->HTTPS redirect, security headers, 2 MB body limit, JSON access log, hides `/docs` `/redoc` `/openapi.json` |
| `.env.example` | every setting, with comments; copy to `deploy/.env` (git-ignored) |
| `smoke.sh` | post-deploy checks through the public proxy |
| `../backend/Dockerfile` | the API image |

All commands run from the repository root and always pass both files:
`docker compose -f deploy/compose.prod.yml --env-file deploy/.env <command>`.

> **WARNING: back up `ENCRYPTION_KEYS` (and `BILLING_ACCOUNT_SECRET`, `SECRET_KEY`) before
> the first real user signs up.** Health data is encrypted with `ENCRYPTION_KEYS`; if the
> keys are lost the data cannot be decrypted, by anyone, ever. Keep a copy outside the
> server (password manager or offline storage). Changing `BILLING_ACCOUNT_SECRET` later
> detaches existing Play purchases from their users.

## IPv4 only

The stack is IPv4 only: create an A record for the API name. IPv6 clients still reach it
through dual-stack/NAT64 on their side. Do not add an AAAA record until the compose network
is made IPv6-capable and the proxy's IPv6 address is added to `TRUSTED_PROXY_IPS`; otherwise
every IPv6 client arrives with the Docker gateway address and they all share one rate-limit
bucket. For the same reason the published ports bind `0.0.0.0` (IPv4) only.

## First deploy

1. **DNS.** Create an A record for the API name, e.g. `api.example.com`, pointing at the
   server's IPv4 address (see "IPv4 only"). Wait until it resolves; Caddy needs it to get
   the certificate.
2. **Server prep.** A Linux host with Docker Engine 25+ and the Compose plugin
   (https://docs.docker.com/engine/install/). Open only TCP 22 (SSH), TCP 80, TCP 443 and
   UDP 443 in the firewall. Keep the OS patched.
3. **Clone.** `git clone <repository-url> luna && cd luna`.
4. **Create `.env`.** `cp deploy/.env.example deploy/.env && chmod 600 deploy/.env`.
5. **Fill in secrets.** Every `REQUIRED` value in `deploy/.env` is empty and the stack
   refuses to start until it is set: `API_DOMAIN`, `ACME_EMAIL`, `POSTGRES_PASSWORD` and
   `REDIS_PASSWORD` (`openssl rand -hex 24`: use hex/alphanumeric values, they are embedded
   in connection URLs unencoded), `SECRET_KEY` (`openssl rand -hex 32`), `ENCRYPTION_KEYS`
   (Fernet command in the file), `SMTP_SERVER`/`SMTP_USER`/`SMTP_PASSWORD`,
   `SUPPORT_EMAIL` and `ALLOWED_HOSTS` (your `API_DOMAIN`, see "Trusted hosts" below). Also review `ALLOWED_ORIGINS`/`FRONTEND_URL` and set
   `BILLING_ACCOUNT_SECRET`. Leave `DATABASE_URL`, `REDIS_URL`, `APP_ENV`,
   `RATE_LIMIT_STORAGE` and `TRUSTED_PROXY_IPS` unset; compose sets them.
6. **Back up the keys** (see the warning above) before going further.
7. **Start.** `docker compose -f deploy/compose.prod.yml --env-file deploy/.env up -d --build`.
   Compose builds the image, waits for Postgres, runs `migrate` once (builds an empty
   database to the current schema, or upgrades an existing one), then starts the API and
   Caddy.
8. **Check.** `docker compose -f deploy/compose.prod.yml --env-file deploy/.env ps` (api
   `healthy`, migrate `exited (0)`) and
   `docker compose -f deploy/compose.prod.yml --env-file deploy/.env logs migrate api proxy`.
9. **Smoke test.** From your workstation: `deploy/smoke.sh api.example.com` (your domain).
   Every line must say `PASS`.
10. **Backups.** Until automated backups land (a later release), take a manual dump before
    and after every deploy and copy it off the server:
    `docker compose -f deploy/compose.prod.yml --env-file deploy/.env exec -T db pg_dump -U luna -Fc luna > luna-$(date +%F).dump`.

## First deploy: things to verify

None of this could be run where the files were written (no Docker there), so check it on
the first real deploy:

1. The configuration resolves: `docker compose -f deploy/compose.prod.yml --env-file deploy/.env config` prints the stack without errors (and fails while a `REQUIRED` value is empty).
2. The Caddyfile is accepted before the first `up`: `docker compose -f deploy/compose.prod.yml --env-file deploy/.env run --rm --no-deps proxy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`.
3. Real client addresses arrive: after one request from a real IPv4 client, `docker compose -f deploy/compose.prod.yml --env-file deploy/.env logs proxy` shows that client in `request>remote_ip`, not `172.28.0.1` (the Docker gateway).
4. The trusted proxy address is right: `docker compose -f deploy/compose.prod.yml --env-file deploy/.env exec api python -c "import socket; print(socket.gethostbyname('proxy'))"` prints `172.28.0.10`. If the host already uses `172.28.0.0/24`, change the subnet, `ip_range`, the proxy's `ipv4_address` and `TRUSTED_PROXY_IPS` in `compose.prod.yml` together.
5. The image builds on `python:3.11-slim`: wheels for numpy, scipy, psycopg2-binary and cryptography exist for amd64; on an arm64 server confirm the build does not fall back to compiling from source.
6. `migrate` exits 0 and its log prints `migrate: bootstrapped` on the first `up`; a second `up` prints `migrate: upgraded`.
7. `deploy/smoke.sh <domain>` reports every check as `PASS`, and the HTTP->HTTPS redirect is a `308`.
8. `POSTGRES_PASSWORD` only takes effect when the `pgdata` volume is first created. Changing it later needs `ALTER USER luna PASSWORD '...'` inside Postgres as well as the new value in `deploy/.env`.
9. With `BILLING_MODE=google`, the mounted Play service-account JSON must be readable by uid 10001 (the API's user).

## Updating

`git pull` then `docker compose -f deploy/compose.prod.yml --env-file deploy/.env up -d --build`.
The `migrate` job runs again and upgrades the schema before the new API starts. Take a
database dump first.

## Notes

- **Migrations.** On Postgres the bootstrap of an empty database (create all tables + stamp
  the Alembic head) runs in a single transaction, so it is atomic: an interrupted bootstrap
  rolls back and the next run bootstraps cleanly. Concurrent `migrate` runs are serialised
  by an advisory lock. Unexpected errors print only the error class (driver messages can
  contain hosts or credentials); rerun with details:
  `docker compose -f deploy/compose.prod.yml --env-file deploy/.env run --rm -e MIGRATE_DEBUG=1 migrate`.
- **Existing databases without Alembic history** (built by `create_all` in development):
  `migrate` refuses them. After checking the schema matches, run
  `docker compose -f deploy/compose.prod.yml --env-file deploy/.env run --rm migrate python scripts/migrate.py --stamp-existing`.
- **Client IP / rate limits.** Caddy has no `trusted_proxies`, so it overwrites any
  client-supplied `X-Forwarded-For` with the real peer address. The API honours
  `X-Forwarded-For` only from Caddy's fixed address (`172.28.0.10`, `TRUSTED_PROXY_IPS`
  in `compose.prod.yml`); uvicorn itself is not allowed to rewrite the client address. If
  you later put a CDN or load balancer in front of Caddy, add its published ranges as
  `trusted_proxies` in the Caddyfile (see the comment there).
- **Trusted hosts.** The API answers only requests whose `Host` header is listed in
  `ALLOWED_HOSTS` (comma-separated, ports ignored); anything else gets `400`. Caddy forwards
  the original `Host`, so set it to the public domain (the same value as `API_DOMAIN`).
  `localhost`, `127.0.0.1` and `::1` are always allowed so the container healthcheck
  (`http://127.0.0.1:8000/health`) keeps working. In production the API refuses to start
  while `ALLOWED_HOSTS` is empty; `ALLOWED_HOSTS=*` turns the check off explicitly (not
  recommended). If you add a second domain, add it here as well as in the Caddyfile.
- **Limits and timeouts.** Request bodies above `MAX_REQUEST_BYTES` (1 MiB) get `413`.
  AI provider calls time out after `AI_CONNECT_TIMEOUT`/`AI_READ_TIMEOUT` seconds and are
  retried once only on connection failures and `502`/`503`/`504`; one call never takes
  longer than `AI_TOTAL_TIMEOUT` (50 s) and a whole analysis than `ANALYSIS_TOTAL_BUDGET`
  (80 s; it then returns its fallback result). Chat answers a timeout with its usual 502.
- **Workers.** `WEB_CONCURRENCY` (default 2) gunicorn workers, each with up to
  `DB_POOL_SIZE + DB_MAX_OVERFLOW` connections; keep the total under Postgres
  `max_connections` (100).
- **Redis password.** It is passed on the `redis-server` command line, so anyone with
  access to the Docker daemon can read it with `docker inspect`; Docker access on the server
  is root-equivalent anyway.
- **Google Play billing.** With `BILLING_MODE=google`, put the service-account JSON in
  `deploy/secrets/` (git-ignored), mount it read-only (commented example in
  `compose.prod.yml`), make it readable by uid 10001, and point
  `GOOGLE_PLAY_SERVICE_ACCOUNT_FILE` at the in-container path.
- **Logs.** Caddy writes JSON access logs to stdout without request bodies, request headers
  or the OAuth `code` query parameter:
  `docker compose -f deploy/compose.prod.yml --env-file deploy/.env logs proxy`.
  The API writes one JSON object per line (no bodies, query strings, headers or exception
  messages); only the gunicorn master's own start/stop lines are plain text.
  `LOG_TRACEBACKS=true` prints exception messages (they can include SQL with values in
  development/testing): never in production.

## Known limitations

- **CORS headers on some errors.** The `400` (unknown `Host`), `413` (request too large) and
  generic `500` responses are produced outside the CORS middleware, so they carry no CORS
  headers: the browser sees an opaque CORS error instead of the status. This includes the
  Android app, whose WebView calls the API with `fetch` from the `https://localhost` origin
  (no native HTTP plugin): it shows its generic "Connection problem" message for these
  responses. Normal 4xx/5xx answers from the API routes carry CORS headers and are unaffected.
