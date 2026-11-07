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
| `backup.env.example` | settings for `scripts/backup_db.sh`; copy to `deploy/backup.env` (git-ignored) |
| `../scripts/backup_db.sh`, `../scripts/restore_db.sh` | encrypted backups with retention, and verified restores (see [Backups and restore](#backups-and-restore)) |
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
10. **Backups.** Set up the encrypted nightly backup described in
    [Backups and restore](#backups-and-restore), run it once by hand, and do one restore
    drill before real users arrive.

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

## Backups and restore

`scripts/backup_db.sh` streams `pg_dump -Fc` straight into `age`, so an unencrypted dump
never exists on disk, and writes two files per run into `BACKUP_DIR` (directory `0700`,
files `0600`):

- `luna-YYYYmmddTHHMMSSZ.dump.age`: the dump, encrypted to your age public key;
- `luna-YYYYmmddTHHMMSSZ.counts.json`: the row count of every table, taken from the same
  database snapshot as the dump (`pg_export_snapshot()` + `pg_dump --snapshot`), used by
  `scripts/restore_db.sh` to verify a restore.

A failed or interrupted run exits non-zero and leaves no partial file; the script refuses
to run without a valid recipient, and it checks the recipient before it contacts the
database. Exit codes and every setting are listed at the top of the script.

**Setup (once).**

1. On your workstation (not the server): `age-keygen -o luna-backup.key`. It prints the
   public key (`age1...`). Store `luna-backup.key` with the other secrets (password
   manager or offline): it is the only way to read the backups, and it must never be on
   the server. Losing it loses every backup; leaking it exposes them (the health data in
   them is still encrypted with `ENCRYPTION_KEYS`, but e-mails and metadata are not).
2. On the server: install `age` (`apt-get install -y age` on Ubuntu 22.04+/Debian 12+).
   In the default `BACKUP_MODE=compose` the database tools come from the `db` container:
   the script runs `docker compose -f deploy/compose.prod.yml --env-file deploy/.env exec -T db pg_dump ...`
   (and `psql` the same way for the snapshot and the counts), so no database port or
   password is needed on the host.
3. `cp deploy/backup.env.example deploy/backup.env && chmod 600 deploy/backup.env`, then
   set `BACKUP_AGE_RECIPIENT` to the public key and `BACKUP_DIR` to an absolute path.
4. Check the settings without touching anything:
   `DRY_RUN=1 scripts/backup_db.sh --env-file deploy/backup.env` prints the commands that
   would run (any password redacted). Then run it once for real.

**Schedule.** A cron entry as the user that runs the stack, from the repository root (cron
has a short `PATH`: make sure `docker` and `age` are on it):

```
# /etc/cron.d/luna-backup
PATH=/usr/local/bin:/usr/bin:/bin
17 3 * * * deploy cd /srv/luna && scripts/backup_db.sh --env-file deploy/backup.env >> /var/log/luna-backup.log 2>&1
```

The log contains file names and counts only, never connection strings or passwords. Alert
on a non-zero exit (or on the newest `luna-*.dump.age` being older than a day).

**Retention.** After each successful backup the script keeps the newest `BACKUP_KEEP_LAST`
(default 14) backups and deletes any older than `BACKUP_KEEP_DAYS` (default 30); both
limits apply, and the newest backup is never deleted, even if it is older than the limit.
Only `luna-YYYYmmddTHHMMSSZ.dump.age` files directly in `BACKUP_DIR` (and their
`.counts.json`) are considered; symlinks, subdirectories and other files are left alone.
`scripts/backup_db.sh --env-file deploy/backup.env --prune-only` applies retention
without taking a backup.

**Off-site copy.** A backup on the same disk as the database does not survive the server.
Set `BACKUP_UPLOAD_CMD` to a command that copies `$1` (the dump) and `$2` (the counts) to
another provider, for example `rclone copy "$1" offsite:luna-backups/` (rclone configured
separately). The files are already encrypted, so the storage does not need to be trusted.
If the hook fails the script exits `4` and keeps the local backup.

**Restore and drills.** `scripts/restore_db.sh` needs `age` and the PostgreSQL 16 client
tools (`psql`, `pg_restore`) on a machine that can reach the target database, plus the
private key file:

```
scripts/restore_db.sh --file luna-20260101T031700Z.dump.age --identity luna-backup.key \
    --target-url postgresql://luna@127.0.0.1:55432/luna_restore --create
```

It decrypts the whole file first (a wrong key or a damaged file fails before the target is
touched), streams `age -d | pg_restore --no-owner --no-acl --single-transaction` into the
target (no plaintext file), then prints the row count of every table next to the manifest
and exits `4` on any difference. The target must be empty, or created by the script with
`--create` (it is dropped again if the restore fails); `--force` restores over a
non-empty database. Put the password in `PGPASSWORD` or `~/.pgpass`, not in the URL.

Do a restore drill monthly: copy the newest `.dump.age` and `.counts.json` to your
workstation, start a throwaway server (`docker run --rm -d -p 127.0.0.1:55432:5432 -e POSTGRES_USER=luna -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16`),
run the command above, and check that the counts match. To read data with the app, the
same `ENCRYPTION_KEYS` are needed: a backup without the keys is useless.

The production `db` container does not publish a port, so `restore_db.sh` cannot reach it
from the host as the stack is shipped. To restore production, either publish the port on
`127.0.0.1` temporarily (stop `api` first), or stream the dump into the container by hand
(no count check then):
`age -d -i luna-backup.key luna-....dump.age | docker compose -f deploy/compose.prod.yml --env-file deploy/.env exec -T db pg_restore -U luna -d luna --no-owner --no-acl --single-transaction`
into an empty database.

**Tested where these files were written:** both scripts against a local PostgreSQL 16 in
direct mode (backup, retention, interrupted and failed runs, restore, wrong key, non-empty
target, count mismatch), and compose mode with a stand-in for `docker`. **Untested here:**
real Docker/compose, cron, `apt-get install age`, `rclone`, and the `docker run` and
manual `pg_restore` commands above.

## Updating

`git pull` then `docker compose -f deploy/compose.prod.yml --env-file deploy/.env up -d --build`.
The `migrate` job runs again and upgrades the schema before the new API starts. Take a
backup first: `scripts/backup_db.sh --env-file deploy/backup.env`.

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
