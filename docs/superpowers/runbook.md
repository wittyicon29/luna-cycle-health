# Luna Health operations runbook

What to do, in order, for the production stack in `deploy/`: first deploy, secrets and key
custody, encryption key rotation, backups and restores, updates and rollbacks, incidents,
monitoring and the pre-launch checklist. The details of the stack itself are in
[`deploy/README.md`](../../deploy/README.md); this file does not repeat them.

Conventions:

- Commands run on the server, from the repository checkout (for example `/srv/luna`), as the
  user that runs the stack. Every compose command passes both files:
  `docker compose -f deploy/compose.prod.yml --env-file deploy/.env ...`.
- `deploy/.env` (app settings and secrets) and `deploy/backup.env` (backup settings) are
  created from `deploy/.env.example` and `deploy/backup.env.example`; both are git-ignored
  and `chmod 600`.
- Placeholders: `api.example.com` is your API domain, `luna-20260101T031700Z` a backup name.
- Commands marked *(untested here)* were written against the scripts' documented usage but
  could not be run on the machine where this runbook was written (no Docker, Caddy, cron
  or a Linux server there). See [Untested here](#untested-here).

## 1. First deploy

1. Follow [`deploy/README.md`](../../deploy/README.md), "First deploy" (DNS, server, `deploy/.env`,
   `up -d --build`). Before the first real user: put every secret from
   [section 2](#2-secrets-inventory) into your password manager.
2. Check from any machine: `deploy/smoke.sh api.example.com` (PASS/FAIL per check,
   non-zero exit on any failure). *(untested here against a real deployment)*
3. Set up backups ([section 4](#4-backups)): key pair, `deploy/backup.env`, a first manual
   backup, the cron entry, the off-site copy.
4. Do one restore drill ([section 4.3](#43-monthly-restore-drill)) before launch. A backup
   that has never been restored is not a backup.

## 2. Secrets inventory

Keep every row in a password manager (or offline storage) **outside the server**. "Server"
means `deploy/.env` unless noted.

| Secret | Where it is used | What breaks if it is lost | Rotation |
| --- | --- | --- | --- |
| `ENCRYPTION_KEYS` (Fernet keys, newest first) | server; encrypts health data columns (period notes, logs, questionnaires, analyses, chat, medication names, purchase tokens) | **Everything encrypted is unreadable forever**, in the database and in every backup. No recovery. | [Section 3](#3-encryption-key-rotation): add a new key first, rotate, keep the old key archived while old backups exist |
| age backup private key (`luna-backup.key`) | **not** on the server; only on the machine doing a restore | Every backup is unreadable | New key pair: set the new public key in `deploy/backup.env`; keep the old private key as long as backups made with it are kept |
| `SECRET_KEY` | server; signs JWTs (and billing account ids when `BILLING_ACCOUNT_SECRET` is empty) | Nothing permanent: every user is signed out | Replace, `up -d`; users sign in again |
| `BILLING_ACCOUNT_SECRET` | server; Play obfuscated account id | Existing Play purchases no longer match their users | Do not rotate once purchases exist |
| `POSTGRES_PASSWORD` | server; compose builds `DATABASE_URL` from it | Nothing if the volume is intact (the db container authenticates locally); the API cannot connect until it matches the database | `ALTER USER luna PASSWORD ...` inside the db container, then change `.env`, `up -d` |
| `REDIS_PASSWORD` | server; Redis `requirepass` and `REDIS_URL` | Nothing (rate-limit counters only) | Change `.env`, `up -d` |
| `SMTP_PASSWORD` | server; verification and reset e-mails | E-mails stop until replaced | At the provider, then `.env`, `up -d` |
| `GROQ_API_KEY`, `HUGGINGFACE_API_KEY` | server; chat and analysis | AI features fall back / fail until replaced | At the provider, then `.env`, `up -d` |
| `SENTRY_DSN` (optional) | server | Error reports stop | At the provider |
| Play service-account JSON | server, `deploy/secrets/` (mounted read-only) | Subscription verification fails (outage grace applies) | New key in Google Cloud, replace the file, revoke the old key |
| Android signing keystore + passwords (`LUNA_KEYSTORE`, `LUNA_KEYSTORE_PASSWORD`, `LUNA_KEY_ALIAS`, `LUNA_KEY_PASSWORD`) | build machine only (`scripts/android/release.sh`) | With Play App Signing: request an upload-key reset; without it, no more updates to the app | Upload key reset in Play Console |

Backup guidance: two independent copies (for example a password manager plus an encrypted
offline copy). Never in the repository, chats, tickets or CI. CI uses no secrets at all.

## 3. Encryption key rotation

`backend/scripts/rotate_encryption_keys.py` re-encrypts every encrypted column under the
newest key in `ENCRYPTION_KEYS`. Usage (from its `--help`):

```
python scripts/rotate_encryption_keys.py [--apply] [--batch-size BATCH_SIZE]
                                         [--encrypt-legacy] [--allow-single-key] [--tables TABLES]
                                         [--show-ids]
```

It is a dry run unless `--apply` is given; it prints counts per column only; exit codes are
`0` nothing pending / done, `1` refused or failed (any undecryptable row), `2` dry run found
work pending. It refuses to run with fewer than two keys unless `--allow-single-key` (then it
only reports); a key listed twice counts once. `--show-ids` adds the primary keys (never
values) of undecryptable rows. It is safe to rerun: rows already under the newest key are
skipped.

In the compose stack the script runs in a one-off `migrate` container, which has
`DATABASE_URL` and `ENCRYPTION_KEYS` from `deploy/.env`. *(untested here: Docker)*

1. **Back up first**: `scripts/backup_db.sh --env-file deploy/backup.env`.
2. Generate the new key on a trusted machine:
   `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`.
   Store it in the password manager **before** it goes on the server.
3. Put it **first** in `deploy/.env`: `ENCRYPTION_KEYS=NEW,OLD`. Recreate the API so new
   writes use it:
   `docker compose -f deploy/compose.prod.yml --env-file deploy/.env up -d --force-recreate api`.
4. Dry run (expect exit `2`, rows pending):
   `docker compose -f deploy/compose.prod.yml --env-file deploy/.env run --rm migrate python scripts/rotate_encryption_keys.py`
5. Apply:
   `docker compose -f deploy/compose.prod.yml --env-file deploy/.env run --rm migrate python scripts/rotate_encryption_keys.py --apply`
   If it stops (exit `1`), nothing of the failing batch was written; fix the cause (an
   "undecryptable" count means a row is under a key that is not configured) and run it again.
6. Dry run again: it must exit `0`. Legacy plaintext rows (reported as `legacy_plaintext`)
   are only encrypted with `--encrypt-legacy`.
7. Take a backup (it now holds data under the new key only).
8. **Check that the new key alone reads everything.** Run the script with only NEW
   configured (single key, so it needs `--allow-single-key` and only reports). It must exit
   `0`; exit `1` means rows that NEW cannot decrypt (listed as `undecryptable`; add
   `--show-ids` for their ids). Type the key at a prompt instead of on the command line, so
   it stays out of the shell history and the process list (`-e NAME` without a value passes
   the variable from your shell): *(untested here: Docker)*
   ```
   read -rs ENCRYPTION_KEYS && export ENCRYPTION_KEYS   # paste NEW only; nothing is echoed
   docker compose -f deploy/compose.prod.yml --env-file deploy/.env run --rm -e ENCRYPTION_KEYS migrate python scripts/rotate_encryption_keys.py --allow-single-key
   unset ENCRYPTION_KEYS
   ```
   This is also what catches keys entered in the wrong order. With `ENCRYPTION_KEYS=OLD,NEW`
   the "newest" key is OLD, so the dry runs in steps 4 and 6 report nothing pending, and
   removing OLD afterwards would make every row unreadable. The NEW-only check fails
   loudly in that case.
9. **Remove the old key.** Wait at least 7 days (time to notice problems), run step 8 again
   **immediately before** removing it (exit `0`), then set `ENCRYPTION_KEYS=NEW` in
   `deploy/.env` and `up -d --force-recreate api`. Keep the old key **archived offline**
   until the last backup taken before step 6 passed has been deleted everywhere
   (`BACKUP_KEEP_DAYS`, default 30, plus whatever the off-site copy keeps): those backups
   still need it.

## 4. Backups

`scripts/backup_db.sh` streams `pg_dump -Fc` into `age` (no plaintext file), writes
`luna-YYYYmmddTHHMMSSZ.dump.age` plus `luna-YYYYmmddTHHMMSSZ.counts.json` into `BACKUP_DIR`,
then applies retention. Exit codes: `0` ok, `1` backup failed (no partial file left), `2`
usage/config error (nothing contacted), `3` another backup holds the lock, `4` backup ok but
`BACKUP_UPLOAD_CMD` failed, `5` backup ok but retention failed. Settings and setup:
`deploy/backup.env.example` and [`deploy/README.md`](../../deploy/README.md), "Backups and restore".

### 4.1 Schedule

- Daily, by cron, in `BACKUP_MODE=compose` (the default in `deploy/backup.env.example`);
  the cron entry is in `deploy/README.md`. *(untested here: cron)*
- Check the settings without touching anything:
  `DRY_RUN=1 scripts/backup_db.sh --env-file deploy/backup.env`.
- Retention: `BACKUP_KEEP_LAST=14` and `BACKUP_KEEP_DAYS=30` by default, both applied, the
  newest backup is never deleted. Retention alone:
  `scripts/backup_db.sh --env-file deploy/backup.env --prune-only`.
- Off-site: set `BACKUP_UPLOAD_CMD` (for example `rclone copy "$1" offsite:luna-backups/`;
  copy `$2`, the counts file, too). *(untested here: rclone)* The files are encrypted, so
  the storage does not need to be trusted **for confidentiality**. It does need to be
  trusted for integrity: age does not authenticate who encrypted a file (the recipient key
  is public), so anyone with write access to the off-site storage could plant a forged
  backup that decrypts fine with your key. Give the server write-only/append-only
  credentials where the provider supports it, keep other write access to yourself, and
  keep a local list of checksums, e.g. with
  `BACKUP_UPLOAD_CMD='sha256sum "$1" "$2" >> /var/backups/luna-SHA256SUMS && rclone copy "$1" offsite:luna-backups/ && rclone copy "$2" offsite:luna-backups/'`,
  which you compare before a restore (section 5, step 1).
- **Do not deploy or migrate during the backup window.** The backup holds read locks on
  every table while it runs; a migration's `ALTER TABLE` then waits for it, and the backup
  gives up after `BACKUP_LOCK_WAIT_TIMEOUT` (default `60s`, exit `1`, nothing left behind)
  rather than hanging. Schedule the cron job away from deploys.
- Before every update and every key rotation: one manual run.

### 4.2 Verification (weekly, 2 minutes)

- The newest `luna-*.dump.age` in `BACKUP_DIR` is less than a day old and not tiny.
- The cron log has no `backup: error:` lines; the off-site copy has the same newest file.
- The age private key is still where you think it is (open the password manager entry).

### 4.3 Monthly restore drill

On a workstation with `age`, `psql` and `pg_restore` 16, and the private key:

1. Copy the newest `.dump.age` and its `.counts.json` from the server (or off-site).
2. Start a throwaway server:
   `docker run --rm -d --name luna-drill -p 127.0.0.1:55432:5432 -e POSTGRES_USER=luna -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16`
   *(untested here: Docker; any local PostgreSQL 16 works the same way)*
3. Restore and verify:
   `scripts/restore_db.sh --file luna-20260101T031700Z.dump.age --identity luna-backup.key --target-url postgresql://luna@127.0.0.1:55432/luna_restore --create`
   Exit `0` means every table's row count matches the manifest; `4` means a mismatch (the
   database is kept for inspection); `1` failed (nothing left behind); `3` refused.
4. Optional: point a local API at it with the production `ENCRYPTION_KEYS` and open a few
   records. Without the keys the restored health data is unreadable.
5. `docker rm -f luna-drill`. Note the date and result.

## 5. Restore procedure (production)

**Step 0: do you have the keys?** You need (a) the age private key for the backup and (b)
the `ENCRYPTION_KEYS` that were current when the backup was taken (plus any older keys
still in use then). Without (a) the backup cannot be opened; without (b) the health data in
it cannot be read. Find both before you stop anything.

1. Pick the backup: the newest one from before the problem. Copy its `.dump.age` and
   `.counts.json` to the server's `BACKUP_DIR` if they are not there. If it came from the
   off-site storage, compare its `sha256sum` with your local checksum list first
   (section 4.1): age cannot tell you who made the file.
2. Put the private key on the server in RAM only, readable by you:
   `install -m 600 /dev/null /dev/shm/luna-backup.key`, paste the key into it.
3. Stop the API so nothing writes during the restore:
   `docker compose -f deploy/compose.prod.yml --env-file deploy/.env stop api`. *(untested here)*
4. Rehearse: `DRY_RUN=1 scripts/restore_db.sh --compose --file BACKUP_DIR/luna-20260101T031700Z.dump.age --identity /dev/shm/luna-backup.key --target-db luna_restored --create`
   prints every command (nothing runs).
5. Restore into a **new** database next to the live one (`--compose` runs `psql`/`pg_restore`
   inside the db container, which publishes no port):
   `scripts/restore_db.sh --compose --file BACKUP_DIR/luna-20260101T031700Z.dump.age --identity /dev/shm/luna-backup.key --target-db luna_restored --create`
   It refuses if `luna_restored` exists, decrypts the whole file first (wrong key or damaged
   file: exit `1`, nothing created), restores in one transaction (failure: the new database
   is dropped), and compares the row counts with the manifest (exit `0` only if all match).
   *(untested here: real Docker; tested with a stand-in for `docker`)*
   **Exit `4` (row counts differ): stop here and do not swap the databases.** The restored
   `luna_restored` is kept for inspection. Investigate first: the wrong `.counts.json` next
   to the dump, a damaged or truncated manifest, or a backup that is not what you think it
   is. Until then, either keep the API stopped or start it again on the untouched live
   database (`up -d`) if that database is still usable.
6. Swap the databases, keeping the old one for forensics:
   `docker compose -f deploy/compose.prod.yml --env-file deploy/.env exec -T db psql -U luna -d postgres -c 'ALTER DATABASE luna RENAME TO luna_before_restore'`
   then
   `docker compose -f deploy/compose.prod.yml --env-file deploy/.env exec -T db psql -U luna -d postgres -c 'ALTER DATABASE luna_restored RENAME TO luna'`.
   *(untested here)*
7. Make sure `deploy/.env` has the `ENCRYPTION_KEYS` from step 0, then start everything:
   `docker compose -f deploy/compose.prod.yml --env-file deploy/.env up -d`
   (`migrate` brings the restored schema to the current head first).
8. `deploy/smoke.sh api.example.com`, sign in with a test account, open an encrypted record.
9. `rm -f /dev/shm/luna-backup.key`. Drop `luna_before_restore` only when you are sure.
   Everything written after the backup was taken is lost: tell affected users.

Alternative without compose (a managed database, or a published port): use direct mode,
`scripts/restore_db.sh --file F --identity KEYFILE --target-url postgresql://luna@HOST:PORT/luna_restored --create`,
password in `PGPASSWORD` or `~/.pgpass`, never in the URL. `--force` restores over a
non-empty database (objects from the backup are dropped and recreated); prefer a new
database and a rename.

## 6. Updates and rollback

**Images.** The stack builds `luna-api:local` from the checked-out source
(`up -d --build`); there is no registry. A "version" is therefore a git commit: tag each
release (`git tag -a v1.2.0 -m v1.2.0`) so you can go back to it.

**Update.**

1. `scripts/backup_db.sh --env-file deploy/backup.env` (exit `0`).
2. `git fetch --tags && git checkout v1.2.0` (the release you want).
3. `docker compose -f deploy/compose.prod.yml --env-file deploy/.env up -d --build`.
   The one-shot `migrate` job runs `python scripts/migrate.py` before the new API starts:
   it bootstraps an empty database or upgrades to the Alembic head under an advisory lock,
   and the API only starts if it succeeded (`service_completed_successfully`).
4. `deploy/smoke.sh api.example.com`.

If `migrate` fails, compose does not start the new API (it waits for `migrate` to
complete successfully); check what is running with
`docker compose -f deploy/compose.prod.yml --env-file deploy/.env ps` and read `docker compose -f deploy/compose.prod.yml --env-file deploy/.env logs migrate`
(rerun with `run --rm -e MIGRATE_DEBUG=1 migrate` for the full error).

**Rollback.** `migrate` only moves forward; there are no downgrade migrations, on purpose:
a downgrade drops or rewrites columns, which loses the data written since the upgrade, and
running old code against a newer schema can fail or silently misbehave.

- Release without schema changes: `git checkout v1.1.0`, `up -d --build`. Done.
- Rolling back the code of a release **with** schema changes without restoring the
  database does not work: the database is stamped with an Alembic revision the older code
  does not know, so `migrate` fails and the API does not start (compose waits for
  `migrate` to succeed).
- Release with schema changes: the safe rollback is **the backup from step 1 plus the
  previous release**: `git checkout v1.1.0`, then the restore procedure in
  [section 5](#5-restore-procedure-production) with that backup, then `up -d --build`.
  Data written since the update is lost; that is why the update backup is taken
  immediately before it.

## 7. Incident checklist

**Suspected key leak (`ENCRYPTION_KEYS`, `deploy/.env` or a backup with its keys).**
1. Rotate `ENCRYPTION_KEYS` ([section 3](#3-encryption-key-rotation)), and remove the leaked
   key from the server as soon as the rotation dry run reports `0` (do not wait 7 days).
   This protects future copies of the database; it does not protect copies that already
   leaked together with the key.
2. Rotate `SECRET_KEY` (signs everyone out), `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, SMTP
   and AI provider keys, and the Play service-account key if `deploy/` was exposed.
3. If the age private key leaked: new backup key pair, new recipient in
   `deploy/backup.env`, take a fresh backup, delete the old backups once a fresh restore
   drill passed.
4. Work out what was exposed and when; personal data breaches can have notification duties.

**Database corruption or lost data.** Stop the API (`stop api`), do not run anything that
writes, take a backup of the current state anyway (`scripts/backup_db.sh --env-file deploy/backup.env`,
it may help forensics), then [section 5](#5-restore-procedure-production).

**Provider outage.**
- AI (Groq / Hugging Face): calls time out (`AI_TOTAL_TIMEOUT`, `ANALYSIS_TOTAL_BUDGET`);
  analysis returns its fallback, chat answers 502. Nothing to do but wait.
- SMTP: sign-up verification and password reset e-mails fail. Switch `SMTP_*` to another
  provider in `deploy/.env` and `up -d` if it lasts.
- Google Play: verified entitlements are kept for `BILLING_OUTAGE_GRACE_HOURS` (24).
- Server / hosting: restore on a new server from the off-site backup (first deploy +
  section 5); you need `deploy/.env` values from the password manager.

**Rate-limit storm (many 429s, or one client hammering).** Check the Caddy access log
(`docker compose -f deploy/compose.prod.yml --env-file deploy/.env logs proxy`). If every
client gets 429, clients probably share one key: check `TRUSTED_PROXY_IPS` and the IPv4-only
notes in `deploy/README.md`. Limits (`AUTH_RATE_LIMIT`, `CHAT_RATE_LIMIT`, `CHAT_DAILY_LIMIT`)
are in `deploy/.env`; Redis down means limits fall back to per-process counters.

**Billing mismatch (users charged but not unlocked, or the reverse).** Set
`BILLING_MODE=off` in `deploy/.env` and `docker compose -f deploy/compose.prod.yml --env-file deploy/.env up -d`:
the AI features open for everyone and the plan screens disappear. Then follow
[`docs/superpowers/billing-owner-checklist.md`](billing-owner-checklist.md), "7. Rollback"
(Play subscriptions are not cancelled automatically).

## 8. Monitoring and alerts to add

Not set up by this repository; add them before launch:

- Uptime check on `https://api.example.com/ready` every minute (503 = database, Redis or
  schema not ready) and on `/health`.
- Backup age: alert if the newest `luna-*.dump.age` is older than 26 hours, or the cron job
  exits non-zero (exit `4` = upload failed, `5` = retention failed).
- Disk: the database volume and `BACKUP_DIR` above 80 %.
- Certificate expiry: Caddy renews automatically; alert at less than 14 days left.
- Error reporting: set `SENTRY_DSN` (optional, scrubbed; see `deploy/.env.example`).
- CI: the weekly dependency audit (`.github/workflows/audit.yml`) failing.

## 9. Pre-launch checklist

- [ ] All secrets from [section 2](#2-secrets-inventory) are in the password manager, twice.
- [ ] First backup taken, off-site copy works, one restore drill passed (section 4.3).
- [ ] `deploy/smoke.sh api.example.com` passes.
- [ ] Privacy Policy and Terms final, legal review done. Consent version: every consent is
      recorded with `PRIVACY_POLICY_VERSION` (`deploy/.env`); decide whether the final policy
      text needs a new version (the open follow-up in the billing checklist) and set it
      before launch.
- [ ] Hindi strings reviewed by a native speaker (`frontend/src/i18n/hi-review.md`, sheet
      from `npm run i18n:review` in `frontend/`).
- [ ] Play Console items from [`docs/superpowers/billing-owner-checklist.md`](billing-owner-checklist.md):
      subscription disclosures, release build without the plugin's token logs, Data safety
      form, grace period check, `BILLING_MODE` decided.
- [ ] Android application id final (`scripts/android/rename-app-id.sh`), release built with
      `scripts/android/release.sh`.
- [ ] Monitoring from [section 8](#8-monitoring-and-alerts-to-add) in place.
- [ ] Dependency audit findings triaged ([section 10](#10-ci)).
- [ ] Branch protection on `main` updated: `test.yml` is gone, so remove its old required
      check and require the **Backend** (`pytest (Python 3.11, PostgreSQL 16, Redis 7)`) and
      **Frontend** (`i18n, jest and build`) jobs. Do **not** require the Docker image or
      Dependency audit jobs: they are path-filtered, and a required check that does not run
      blocks the merge.

## 10. CI

Workflows in `.github/workflows/` (no secrets, `permissions: contents: read`, actions pinned
to commit SHAs, superseded PR runs cancelled):

| Workflow | Runs | Checks |
| --- | --- | --- |
| `backend.yml` | push / PR to `main`, `develop` | shellcheck of `scripts/*.sh` and `deploy/smoke.sh`; pytest with coverage (job summary) against PostgreSQL 16 and Redis 7 service containers, so the migration, rotation and backup/restore drills run; fails if any of them skipped |
| `frontend.yml` | push / PR to `main`, `develop` | `npm ci`, `npm run i18n:check`, jest, production build with at most 15 ESLint warnings (`frontend/scripts/check-build-warnings.js`) |
| `docker.yml` | push / PR touching `backend/`, `deploy/` | builds `backend/Dockerfile`, runs `backend/scripts/migrate.py` (twice) and the image's gunicorn with a generated production env; `/health` and `/ready` 200, `/docs` 404, wrong `Host` 400 |
| `audit.yml` | weekly, manual, PRs touching dependency files | `pip-audit` of `backend/requirements.lock` and `backend/requirements-dev.lock`, and `npm audit --omit=dev --audit-level=high`, judged by `scripts/ci/audit_gate.py` |

- **Backend lock files.** `backend.yml` installs `backend/requirements-dev.lock` with
  `--require-hashes --no-deps` and fails if either lock is out of date with its
  requirements file (`backend/tests/test_requirements_lock.py`); `docker.yml` checks that
  the image holds exactly `backend/requirements.lock`. See
  [section 12](#12-updating-dependencies).

- **Audit allowlist.** `.github/audit-allowlist.txt`: one advisory id per line with a
  `# justification` (why it does not apply or cannot be fixed yet, and when to look again).
  Prefer upgrading. Remove entries the gate reports as matching nothing.
- **Warning baseline.** The build had 15 ESLint warnings when the gate was added. Fixing
  warnings is welcome; lower `--max` in `frontend.yml` when you do. New code must not add any.
- **Node version.** `frontend/.nvmrc` (CI reads it).

## 11. Scripts

| Script | Purpose |
| --- | --- |
| `scripts/backup_db.sh` | encrypted backup + retention ([section 4](#4-backups)) |
| `scripts/restore_db.sh` | verified restore, direct or `--compose` ([sections 4.3](#43-monthly-restore-drill), [5](#5-restore-procedure-production)) |
| `backend/scripts/rotate_encryption_keys.py` | re-encrypt under the newest key ([section 3](#3-encryption-key-rotation)) |
| `backend/scripts/migrate.py` | schema bootstrap/upgrade; the compose `migrate` job (`--stamp-existing` for old `create_all` databases, see `deploy/README.md`) |
| `deploy/smoke.sh` | post-deploy checks through the proxy |
| `scripts/ci/audit_gate.py` | dependency audit allowlist gate (CI) |
| `scripts/android/setup-tooling.sh` | installs the Android build tooling in `.android-tooling/` |
| `scripts/android/env.sh` | environment for the Android scripts (sourced) |
| `scripts/android/rename-app-id.sh` | sets the final Android application id |
| `scripts/android/release.sh` | guarded, signed release build (`--check-only` to validate) |
| `scripts/android/test-release-guards.sh` | tests of the release guards |
| `scripts/android/test-launcher-aliases.sh` | checks the launcher aliases in a built APK |

## 12. Updating dependencies

The backend has two kinds of requirements files:

| File | Edited by | Contents |
| --- | --- | --- |
| `backend/requirements.txt` | you | direct runtime dependencies, each pinned exactly (`name==version`) |
| `backend/requirements-dev.txt` | you | `-r requirements.txt` plus the test and lock tools, pinned exactly |
| `backend/requirements.lock` | pip-compile | every runtime package (transitive ones included) with its version and sha256 hashes |
| `backend/requirements-dev.lock` | pip-compile | the same for runtime + dev |

The image installs `requirements.lock` with `pip install --require-hashes --no-deps
--only-binary=:all:` (`backend/Dockerfile`) and CI installs `requirements-dev.lock` the same
way, so a release that was not locked here can never be installed, and a package whose
files change on PyPI fails the hash check. Never edit a lock file by hand.

The locks are resolved for **Linux and Python 3.11** (the image and CI): pip-compile drops
packages whose environment markers do not match the machine it runs on (greenlet, a
SQLAlchemy dependency, is only installed on x86_64/aarch64 Linux), so a lock compiled on
macOS is wrong. Regenerate them in a throwaway `python:3.11-slim` container (or on a
Linux machine with Python 3.11 and `requirements-dev.lock` installed, running the two
`python -m piptools compile` commands from `backend/`).

1. Edit `backend/requirements.txt` (or `backend/requirements-dev.txt`): change the exact pin,
   add or remove a line. Read the release notes of everything you bump.
2. Regenerate both locks, from the repository root (pip-tools 7.6.2 is the version pinned
   in `backend/requirements-dev.txt`):

   ```sh
   docker run --rm -v "$PWD/backend:/src" -w /src -e HOME=/tmp -e PIP_DISABLE_PIP_VERSION_CHECK=1 \
     --user "$(id -u):$(id -g)" python:3.11-slim sh -ec '
       pip install --quiet --user pip-tools==7.6.2
       python -m piptools compile --quiet --generate-hashes --allow-unsafe --strip-extras \
         --output-file=requirements.lock requirements.txt
       python -m piptools compile --quiet --generate-hashes --allow-unsafe --strip-extras \
         --output-file=requirements-dev.lock requirements-dev.txt'
   ```

   This is slow: pip-tools 7.6.2 hashes every file of every locked release by downloading
   it (its PyPI JSON lookup does not match pypi.org's URLs), several gigabytes for numpy and
   scipy alone. Add `-v "$HOME/.cache/luna-pip:/tmp/.cache"` to the `docker run` line to
   keep the download cache between runs. pip-compile records every file PyPI lists for a
   release (all platforms, wheels and sdists), so the locks install on amd64 and arm64.
   pip-compile keeps every existing pin that still satisfies the inputs, so only what you
   changed (and what it needs) moves. To bump a transitive package without touching the
   inputs, add `--upgrade-package NAME` to both commands; `--upgrade` re-resolves everything
   to the newest releases (review the whole diff then).
3. Review `git diff backend/requirements*.lock`: only the packages you expected changed.
4. Audit both locks exactly as `audit.yml` does (pip-audit 2.10.1 in a scratch venv):

   ```sh
   pip-audit -r backend/requirements.lock --disable-pip -f json -o /tmp/pip-audit.json
   python3 scripts/ci/audit_gate.py pip /tmp/pip-audit.json --allowlist .github/audit-allowlist.txt
   pip-audit -r backend/requirements-dev.lock --disable-pip -f json -o /tmp/pip-audit-dev.json
   python3 scripts/ci/audit_gate.py pip /tmp/pip-audit-dev.json --allowlist .github/audit-allowlist.txt
   ```

5. Reinstall the dev venv from the lock and run the tests:

   ```sh
   cd backend
   .venv/bin/pip install --require-hashes --no-deps -r requirements-dev.lock && .venv/bin/pip check
   .venv/bin/python -m pytest -q
   ```

   `tests/test_requirements_lock.py` checks that every direct pin is locked at the same
   version and that both locks carry hashes; its re-lock comparison (pinned versions, no
   hashes, so it takes seconds) only runs on Linux with Python 3.11 (it skips on macOS, and
   runs in `backend.yml`).
6. Commit the requirements file(s) and both locks together. The Docker image workflow
   (`docker.yml`) builds the image from the new lock on the pull request.

## Untested here

Written and checked on a development Mac without Docker. Verified there: the backup and
restore scripts against a local PostgreSQL 16 (direct mode, and `--compose` / `BACKUP_MODE=compose`
through a stand-in for `docker` that runs the in-container commands on that server), the
rotation script on SQLite and PostgreSQL, `DRY_RUN` output, the CI gate scripts, the
frontend build gate on the real build output, `actionlint` on the workflows, and the
docker smoke checks' requests against the API run directly with gunicorn and the same
generated production environment. **Not run here:**

- Docker and Docker Compose: every `docker compose ...` command above, the image build,
  `docker run` drills, `--force-recreate`, the database rename.
- Caddy (TLS, redirects) and `deploy/smoke.sh` against a real domain.
- `age` from the Ubuntu/Debian packages (tested with age 1.2.1; Ubuntu 24.04 ships 1.1.1).
- cron, `rclone` or any other off-site upload command.
- GitHub Actions runs: the workflows were linted and parsed, and their commands run
  locally, but the first real run happens on the pull request.
