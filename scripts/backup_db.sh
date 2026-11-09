#!/usr/bin/env bash
# Encrypted PostgreSQL backup for Luna Health.
#
#   scripts/backup_db.sh [--env-file FILE]      take a backup, then apply retention
#   scripts/backup_db.sh [--env-file FILE] --prune-only
#   scripts/backup_db.sh --help
#
# The dump is streamed `pg_dump -Fc | age -r RECIPIENT` into BACKUP_DIR: no unencrypted
# dump ever touches the disk. Each run writes two files, both mode 0600 in a 0700 directory:
#   luna-YYYYmmddTHHMMSSZ.dump.age     the age-encrypted custom-format dump
#   luna-YYYYmmddTHHMMSSZ.counts.json  row count per table (table -> rows), read by
#                                      scripts/restore_db.sh to verify a restore
# Both come from one snapshot: a REPEATABLE READ, READ ONLY psql session exports it with
# pg_export_snapshot(), counts the rows inside it, and stays open while
# `pg_dump --snapshot=<id>` runs. While a run is in progress the dump is written as
# `<name>.dump.age.partial` and renamed only after every step succeeded; on any failure
# or signal the partial files are removed.
#
# Settings (environment variables; --env-file reads KEY=value lines for the same names,
# without executing anything, and a variable already set in the environment wins):
#   BACKUP_DIR               REQUIRED. Absolute path where backups are kept (mode 0700).
#   BACKUP_AGE_RECIPIENT     REQUIRED for a backup. age public key (age1...) or an SSH
#                            public key ("ssh-ed25519 AAAA..."). The private key is never
#                            needed here; keep it off this server.
#   BACKUP_MODE              direct (default): connect with DATABASE_URL.
#                            compose: run psql/pg_dump in the compose `db` container:
#                            docker compose -f COMPOSE_FILE --env-file COMPOSE_ENV_FILE exec -T db ...
#   DATABASE_URL             direct mode: postgresql://user:password@host:port/dbname[?sslmode=...]
#                            (a +driver suffix such as postgresql+psycopg2 is accepted). The URL is
#                            split into PGHOST/PGPORT/PGUSER/PGDATABASE/PGPASSWORD, so the password
#                            is never on a command line or in the output. Without a password in
#                            the URL, an inherited PGPASSWORD or ~/.pgpass is used.
#   COMPOSE_FILE             compose mode: default deploy/compose.prod.yml in this repository.
#   COMPOSE_ENV_FILE         compose mode: default deploy/.env in this repository.
#   COMPOSE_DB_SERVICE       compose mode: default db.
#   COMPOSE_DB_USER          compose mode: default luna.
#   COMPOSE_DB_NAME          compose mode: default luna.
#   BACKUP_KEEP_LAST         keep at most this many backups (default 14).
#   BACKUP_KEEP_DAYS         delete backups older than this many days (default 30).
#                            Both limits apply; the newest backup is never deleted.
#   BACKUP_UPLOAD_CMD        optional. Run with `sh -c` after a successful backup, with the
#                            dump path as $1 and the counts path as $2 (e.g. an rclone or
#                            scp command). PGPASSWORD is removed from its environment.
#   BACKUP_SNAPSHOT_TIMEOUT  seconds to wait for the snapshot session (default 60).
#   BACKUP_LOCK_WAIT_TIMEOUT how long pg_dump (and the snapshot session) wait for a table
#                            lock before giving up: 1-999999 followed by ms, s or min
#                            (default 60s). The snapshot session holds read locks on every
#                            table while the dump runs; a concurrent ALTER TABLE (a deploy's
#                            migration) queues behind them, and pg_dump's own locks would
#                            queue behind the ALTER forever. With this timeout the backup
#                            fails (exit 1, nothing left behind) and the ALTER proceeds.
#                            Do not deploy or migrate during the backup window.
#   DRY_RUN                  1: validate the settings and print the commands (password
#                            redacted) without connecting or writing anything.
#
# Retention only considers regular files named luna-YYYYmmddTHHMMSSZ.dump.age directly in
# BACKUP_DIR (and their .counts.json); symlinks, subdirectories and other files are never
# touched. It also removes stale .partial files and manifests without a dump. It runs
# after a successful backup (never after a failed one) or with --prune-only.
#
# Exit codes:
#   0  success
#   1  the backup failed (database, pg_dump, age, disk); no partial file is left
#   2  usage or configuration error, detected before contacting the database
#   3  another backup holds the lock on BACKUP_DIR
#   4  the backup succeeded but BACKUP_UPLOAD_CMD failed (the local backup is kept)
#   5  the backup succeeded but retention failed
#   129/130/143  interrupted by SIGHUP/SIGINT/SIGTERM (cleaned up)

set -euo pipefail
umask 077

SCRIPT_DIR="$(cd -P "$(dirname "$0")" && pwd -P)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

DUMP_GLOB='luna-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z.dump.age'
COUNTS_GLOB='luna-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z.counts.json'
AGE_MAGIC='age-encryption.org/v1'
ENV_KEYS=" BACKUP_MODE DATABASE_URL COMPOSE_FILE COMPOSE_ENV_FILE COMPOSE_DB_SERVICE COMPOSE_DB_USER COMPOSE_DB_NAME BACKUP_DIR BACKUP_AGE_RECIPIENT BACKUP_KEEP_LAST BACKUP_KEEP_DAYS BACKUP_UPLOAD_CMD BACKUP_SNAPSHOT_TIMEOUT BACKUP_LOCK_WAIT_TIMEOUT DRY_RUN "

# Row count of every user table, as "COUNT<TAB>table<TAB>rows" lines. Tables outside the
# public schema are written schema.table. scripts/restore_db.sh runs the same query.
COUNT_SQL="SELECT 'COUNT' || chr(9) || CASE WHEN n.nspname = 'public' THEN c.relname::text ELSE n.nspname || '.' || c.relname END || chr(9) || (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast|temp)' ORDER BY 1;"

log() { printf 'backup: %s\n' "$*"; }
warn() { printf 'backup: %s\n' "$*" >&2; }
die() {
    local code="$1"
    shift
    printf 'backup: error: %s\n' "$*" >&2
    exit "$code"
}

usage() {
    sed -n '2,/^# Exit codes/p' "$0" | sed -e 's/^# \{0,1\}//' -e '$d'
    printf '%s\n' "Exit codes: 0 ok, 1 backup failed, 2 usage/config, 3 locked, 4 upload failed, 5 retention failed."
}

# --- settings -------------------------------------------------------------------------

load_env_file() {
    local file="$1" line key value n=0
    [ -f "$file" ] && [ -r "$file" ] || die 2 "--env-file: cannot read the file"
    while IFS= read -r line || [ -n "$line" ]; do
        n=$((n + 1))
        line="${line%$'\r'}"
        case "$line" in
            '' | '#'*) continue ;;
        esac
        if [[ ! "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]]; then
            die 2 "--env-file line $n: expected KEY=value"
        fi
        key="${BASH_REMATCH[1]}"
        value="${BASH_REMATCH[2]}"
        case "$ENV_KEYS" in
            *" $key "*) ;;
            *) die 2 "--env-file line $n: unknown setting $key" ;;
        esac
        if [[ "$value" =~ ^\'(.*)\'$ ]] || [[ "$value" =~ ^\"(.*)\"$ ]]; then
            value="${BASH_REMATCH[1]}"
        fi
        if [ -z "${!key+set}" ]; then
            export "$key=$value"
        fi
    done < "$file"
}

positive_int() {
    # positive_int NAME VALUE
    [[ "$2" =~ ^[1-9][0-9]{0,5}$ ]] || die 2 "$1 must be a whole number from 1 to 999999"
}

valid_recipient() {
    local r="$1" bech='[023456789acdefghjklmnpqrstuvwxyz]'
    [[ "$r" =~ ^age1${bech}{58}$ ]] && return 0
    [[ "$r" =~ ^age1[a-z0-9]+1${bech}{6,}$ ]] && return 0
    [[ "$r" =~ ^(ssh-ed25519|ssh-rsa)\ [A-Za-z0-9+/]{16,}={0,3}(\ [[:print:]]*)?$ ]] && return 0
    return 1
}

urldecode() {
    local s="${1//\\/\\\\}"
    s="${s//%/\\x}"
    printf '%b' "$s"
}

# Split a postgresql:// URL into libpq environment variables.
parse_db_url() {
    local url="$1" rest userinfo="" hostport path="" query="" host port="" pair key value
    local re='^postgres(ql)?(\+[A-Za-z0-9_]+)?://(.*)$'
    [[ "$url" =~ $re ]] || die 2 "DATABASE_URL must be a postgresql:// URL"
    rest="${BASH_REMATCH[3]}"
    if [[ "$rest" == *\?* ]]; then
        query="${rest#*\?}"
        rest="${rest%%\?*}"
    fi
    if [[ "$rest" == *@* ]]; then
        userinfo="${rest%@*}"
        rest="${rest##*@}"
    fi
    hostport="${rest%%/*}"
    if [[ "$rest" == */* ]]; then
        path="${rest#*/}"
    fi
    if [[ "$hostport" == \[* ]]; then
        host="${hostport%%]*}"
        host="${host#\[}"
        rest="${hostport#*]}"
        [ -z "$rest" ] || port="${rest#:}"
    else
        host="${hostport%%:*}"
        [[ "$hostport" != *:* ]] || port="${hostport#*:}"
    fi
    [ -z "$port" ] || [[ "$port" =~ ^[0-9]{1,5}$ ]] || die 2 "DATABASE_URL has an invalid port"

    unset PGHOST PGHOSTADDR PGPORT PGUSER PGDATABASE PGSSLMODE PGSSLROOTCERT PGCONNECT_TIMEOUT PGSERVICE
    if [ -n "$host" ]; then
        PGHOST="$(urldecode "$host")"
        export PGHOST
    fi
    if [ -n "$port" ]; then
        export PGPORT="$port"
    fi
    if [ -n "$path" ]; then
        PGDATABASE="$(urldecode "$path")"
        export PGDATABASE
    fi
    if [ -n "$userinfo" ]; then
        PGUSER="$(urldecode "${userinfo%%:*}")"
        export PGUSER
        if [[ "$userinfo" == *:* ]]; then
            PGPASSWORD="$(urldecode "${userinfo#*:}")"
            export PGPASSWORD
        fi
    fi
    while [ -n "$query" ]; do
        pair="${query%%&*}"
        if [[ "$query" == *"&"* ]]; then
            query="${query#*&}"
        else
            query=""
        fi
        [ -n "$pair" ] || continue
        key="${pair%%=*}"
        value="$(urldecode "${pair#*=}")"
        case "$key" in
            sslmode) export PGSSLMODE="$value" ;;
            sslrootcert) export PGSSLROOTCERT="$value" ;;
            connect_timeout) export PGCONNECT_TIMEOUT="$value" ;;
            *) die 2 "DATABASE_URL parameter not supported here: $key (use sslmode, sslrootcert or connect_timeout)" ;;
        esac
    done
    [ -n "${PGDATABASE:-}" ] || die 2 "DATABASE_URL must name the database"
}

is_true() {
    case "${1:-}" in
        1 | true | yes | on) return 0 ;;
        *) return 1 ;;
    esac
}

quote_cmd() {
    # Shell-quoted command line for display.
    local out
    out="$(printf '%q ' "$@")"
    printf '%s' "${out% }"
}

# --- state used by the cleanup trap ---------------------------------------------------

work=""
lock=""
lock_held=0
session_pid=""
session_open=0
session_status=0
pipeline_pid=""
partial=""
counts_partial=""
counts_final=""
finished=0

# shellcheck disable=SC2329 # called from the EXIT/signal traps
stop_dump() {
    local pid="" tries=0
    while [ "$tries" -lt 50 ]; do
        if [ -n "$work" ] && [ -s "$work/dump-process.pid" ]; then
            pid="$(cat "$work/dump-process.pid")"
            break
        fi
        kill -0 "$pipeline_pid" 2> /dev/null || break
        sleep 0.1
        tries=$((tries + 1))
    done
    if [[ "$pid" =~ ^[0-9]+$ ]]; then
        kill -TERM "$pid" 2> /dev/null || true
    fi
    wait "$pipeline_pid" 2> /dev/null || true
    pipeline_pid=""
}

close_session() {
    local tries=0
    if [ "$session_open" = 1 ]; then
        exec 3>&-
        session_open=0
    fi
    if [ -n "$session_pid" ]; then
        while kill -0 "$session_pid" 2> /dev/null && [ "$tries" -lt 30 ]; do
            sleep 0.1
            tries=$((tries + 1))
        done
        kill -TERM "$session_pid" 2> /dev/null || true
        session_status=0
        wait "$session_pid" 2> /dev/null || session_status=$?
        session_pid=""
    fi
}

# shellcheck disable=SC2329 # called from the EXIT/signal traps
release_lock() {
    if [ "$lock_held" = 1 ]; then
        rm -rf -- "$lock"
        lock_held=0
    fi
}

# shellcheck disable=SC2329 # called from the EXIT/signal traps
cleanup() {
    local rc=$?
    trap - EXIT INT TERM HUP
    [ -z "$pipeline_pid" ] || stop_dump
    close_session
    if [ "$finished" != 1 ]; then
        [ -z "$partial" ] || rm -f -- "$partial"
        [ -z "$counts_partial" ] || rm -f -- "$counts_partial"
        [ -z "$counts_final" ] || rm -f -- "$counts_final"
    fi
    [ -z "$work" ] || rm -rf -- "$work"
    release_lock
    exit "$rc"
}

# shellcheck disable=SC2329 # called from the EXIT/signal traps
on_signal() {
    warn "interrupted by SIG$1; cleaning up"
    exit "$2"
}

trap cleanup EXIT
trap 'on_signal INT 130' INT
trap 'on_signal TERM 143' TERM
trap 'on_signal HUP 129' HUP

# --- directory, lock and retention ----------------------------------------------------

prepare_dir() {
    mkdir -p -- "$BACKUP_DIR" || die 1 "cannot create BACKUP_DIR"
    chmod 700 "$BACKUP_DIR" || die 1 "cannot set BACKUP_DIR to mode 0700"
    dir="$(cd -P -- "$BACKUP_DIR" && pwd -P)" || die 1 "cannot enter BACKUP_DIR"
}

acquire_lock() {
    local other
    lock="$dir/.backup.lock"
    if ! mkdir -- "$lock" 2> /dev/null; then
        other="$(cat -- "$lock/pid" 2> /dev/null || true)"
        if [[ "$other" =~ ^[0-9]+$ ]]; then
            if kill -0 "$other" 2> /dev/null; then
                die 3 "another backup is running (pid $other); lock: $lock"
            fi
        elif [ -z "$(find "$lock" -maxdepth 0 -mmin +1440 2> /dev/null)" ]; then
            die 3 "another backup is starting (lock without a pid): $lock"
        fi
        warn "removing a stale lock left by pid ${other:-unknown}"
        rm -rf -- "$lock"
        mkdir -- "$lock" 2> /dev/null || die 3 "could not take the lock: $lock"
    fi
    lock_held=1
    printf '%s\n' "$$" > "$lock/pid"
}

prune() {
    local path index=0 kept=0 deleted=0 reason counts minutes
    minutes=$((BACKUP_KEEP_DAYS * 1440))
    # Leftovers of runs that were killed with SIGKILL (encrypted, but incomplete).
    find "$dir" -maxdepth 1 -type f \( -name "$DUMP_GLOB.partial" -o -name "$COUNTS_GLOB.partial" \) -exec rm -f -- {} +
    while IFS= read -r path; do
        [ -n "$path" ] || continue
        index=$((index + 1))
        reason=""
        if [ "$index" -gt 1 ]; then
            if [ "$index" -gt "$BACKUP_KEEP_LAST" ]; then
                reason="more than BACKUP_KEEP_LAST=$BACKUP_KEEP_LAST"
            elif [ -n "$(find "$path" -maxdepth 0 -type f -mmin "+$minutes")" ]; then
                reason="older than BACKUP_KEEP_DAYS=$BACKUP_KEEP_DAYS"
            fi
        fi
        if [ -z "$reason" ]; then
            kept=$((kept + 1))
            continue
        fi
        counts="${path%.dump.age}.counts.json"
        rm -f -- "$path"
        if [ -f "$counts" ] && [ ! -L "$counts" ]; then
            rm -f -- "$counts"
        fi
        log "retention: deleted ${path##*/} ($reason)"
        deleted=$((deleted + 1))
    done < <(find "$dir" -maxdepth 1 -type f -name "$DUMP_GLOB" | LC_ALL=C sort -r)
    # Manifests whose dump is gone.
    while IFS= read -r path; do
        [ -n "$path" ] || continue
        if [ ! -f "${path%.counts.json}.dump.age" ] || [ -L "${path%.counts.json}.dump.age" ]; then
            rm -f -- "$path"
        fi
    done < <(find "$dir" -maxdepth 1 -type f -name "$COUNTS_GLOB")
    log "retention: kept $kept, deleted $deleted (BACKUP_KEEP_LAST=$BACKUP_KEEP_LAST, BACKUP_KEEP_DAYS=$BACKUP_KEEP_DAYS)"
}

# --- snapshot session -------------------------------------------------------------------

try_send_sql() {
    # Writes to the session; returns non-zero (instead of killing the script) if it is gone.
    (
        trap '' PIPE
        printf '%s\n' "$@" >&3
    ) 2> /dev/null
}

send_sql() {
    try_send_sql "$@" || session_failed
}

session_failed() {
    local status=0
    if [ -n "$session_pid" ]; then
        wait "$session_pid" 2> /dev/null || status=$?
        session_pid=""
    fi
    warn "the snapshot session failed (psql exit $status):"
    if [ -s "$work/session.err" ]; then
        sed 's/^/backup:   /' "$work/session.err" >&2
    fi
    die 1 "could not read the database"
}

open_snapshot_session() {
    local tries=0 limit line
    mkfifo "$work/session.fifo"
    "${psql_cmd[@]}" < "$work/session.fifo" > "$work/session.out" 2> "$work/session.err" &
    session_pid=$!
    exec 3> "$work/session.fifo"
    session_open=1
    # Session settings first: a server- or role-level idle_in_transaction_session_timeout
    # (common on managed Postgres) would end this transaction, and with it the exported
    # snapshot, while pg_dump is still starting. statement_timeout is off because the waits
    # are bounded here (BACKUP_SNAPSHOT_TIMEOUT) and lock waits by lock_timeout.
    send_sql "SET idle_in_transaction_session_timeout = 0;" \
        "SET statement_timeout = 0;" \
        "SET lock_timeout = '$BACKUP_LOCK_WAIT_TIMEOUT';" \
        "BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY;" \
        "SELECT 'SNAPSHOT' || chr(9) || pg_export_snapshot();" \
        "$COUNT_SQL" \
        '\echo LUNA_COUNTS_DONE'
    limit=$((BACKUP_SNAPSHOT_TIMEOUT * 10))
    until grep -qx 'LUNA_COUNTS_DONE' "$work/session.out" 2> /dev/null; do
        kill -0 "$session_pid" 2> /dev/null || session_failed
        tries=$((tries + 1))
        if [ "$tries" -gt "$limit" ]; then
            warn "no answer from the database within BACKUP_SNAPSHOT_TIMEOUT=$BACKUP_SNAPSHOT_TIMEOUT s"
            die 1 "could not read the database"
        fi
        sleep 0.1
    done
    snapshot=""
    while IFS= read -r line; do
        case "$line" in
            SNAPSHOT$'\t'*) snapshot="${line#SNAPSHOT$'\t'}" ;;
        esac
    done < "$work/session.out"
    [[ "$snapshot" =~ ^[0-9A-Fa-f]+(-[0-9A-Fa-f]+)+$ ]] || die 1 "the database did not export a snapshot"
}

write_manifest() {
    local line name rows first=1 tables=0
    {
        printf '{\n'
        while IFS= read -r line; do
            case "$line" in
                COUNT$'\t'*) ;;
                *) continue ;;
            esac
            line="${line#COUNT$'\t'}"
            name="${line%$'\t'*}"
            rows="${line##*$'\t'}"
            [[ "$rows" =~ ^[0-9]+$ ]] || die 1 "unexpected row count output"
            [[ "$name" != *[[:cntrl:]]* ]] || die 1 "a table name contains control characters"
            name="${name//\\/\\\\}"
            name="${name//\"/\\\"}"
            [ "$first" = 1 ] || printf ',\n'
            printf '  "%s": %s' "$name" "$rows"
            first=0
            tables=$((tables + 1))
        done < "$work/session.out"
        [ "$first" = 1 ] || printf '\n'
        printf '}\n'
    } > "$counts_partial"
    table_count="$tables"
}

run_dump() {
    local status=0
    (
        set -o pipefail
        # The snapshot session's pipe must not leak into pg_dump/age.
        exec 3>&-
        {
            "${dump_cmd[@]}" &
            printf '%s\n' "$!" > "$work/dump-process.pid"
            wait "$!"
        } | age -r "$BACKUP_AGE_RECIPIENT" -o "$partial"
    ) &
    pipeline_pid=$!
    wait "$pipeline_pid" || status=$?
    pipeline_pid=""
    return "$status"
}

# --- main ---------------------------------------------------------------------------------

prune_only=0
while [ "$#" -gt 0 ]; do
    case "$1" in
        --env-file)
            [ "$#" -ge 2 ] || die 2 "--env-file needs a path"
            load_env_file "$2"
            shift 2
            ;;
        --prune-only)
            prune_only=1
            shift
            ;;
        -h | --help)
            usage
            exit 0
            ;;
        *) die 2 "unknown argument: $1 (see --help)" ;;
    esac
done

BACKUP_DIR="${BACKUP_DIR:-}"
BACKUP_MODE="${BACKUP_MODE:-direct}"
BACKUP_KEEP_LAST="${BACKUP_KEEP_LAST:-14}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
BACKUP_SNAPSHOT_TIMEOUT="${BACKUP_SNAPSHOT_TIMEOUT:-60}"
BACKUP_LOCK_WAIT_TIMEOUT="${BACKUP_LOCK_WAIT_TIMEOUT:-60s}"
BACKUP_AGE_RECIPIENT="${BACKUP_AGE_RECIPIENT:-}"
BACKUP_UPLOAD_CMD="${BACKUP_UPLOAD_CMD:-}"

[ -n "$BACKUP_DIR" ] || die 2 "BACKUP_DIR is not set"
[[ "$BACKUP_DIR" == /* ]] || die 2 "BACKUP_DIR must be an absolute path"
positive_int BACKUP_KEEP_LAST "$BACKUP_KEEP_LAST"
positive_int BACKUP_KEEP_DAYS "$BACKUP_KEEP_DAYS"
positive_int BACKUP_SNAPSHOT_TIMEOUT "$BACKUP_SNAPSHOT_TIMEOUT"
[[ "$BACKUP_LOCK_WAIT_TIMEOUT" =~ ^[1-9][0-9]{0,5}(ms|s|min)$ ]] ||
    die 2 "BACKUP_LOCK_WAIT_TIMEOUT must be 1-999999 followed by ms, s or min (e.g. 60s)"

if [ "$prune_only" = 1 ]; then
    prepare_dir
    acquire_lock
    prune || die 5 "retention failed"
    exit 0
fi

# Everything below is checked before the database is contacted.
[ -n "$BACKUP_AGE_RECIPIENT" ] || die 2 "BACKUP_AGE_RECIPIENT is not set: refusing to write a backup that is not encrypted"
valid_recipient "$BACKUP_AGE_RECIPIENT" || die 2 "BACKUP_AGE_RECIPIENT is not an age (age1...) or SSH public key recipient"

case "$BACKUP_MODE" in
    direct)
        [ -n "${DATABASE_URL:-}" ] || die 2 "DATABASE_URL is not set (or use BACKUP_MODE=compose)"
        parse_db_url "$DATABASE_URL"
        psql_cmd=(psql -X -q -At -w -v ON_ERROR_STOP=1)
        dump_cmd=(pg_dump -w -Fc "--lock-wait-timeout=$BACKUP_LOCK_WAIT_TIMEOUT" "--snapshot=SNAPSHOT_ID")
        ;;
    compose)
        COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/deploy/compose.prod.yml}"
        COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-$REPO_ROOT/deploy/.env}"
        COMPOSE_DB_SERVICE="${COMPOSE_DB_SERVICE:-db}"
        COMPOSE_DB_USER="${COMPOSE_DB_USER:-luna}"
        COMPOSE_DB_NAME="${COMPOSE_DB_NAME:-luna}"
        compose=(docker compose -f "$COMPOSE_FILE" --env-file "$COMPOSE_ENV_FILE" exec -T "$COMPOSE_DB_SERVICE")
        psql_cmd=("${compose[@]}" psql -U "$COMPOSE_DB_USER" -d "$COMPOSE_DB_NAME" -X -q -At -w -v ON_ERROR_STOP=1)
        dump_cmd=("${compose[@]}" pg_dump -U "$COMPOSE_DB_USER" -d "$COMPOSE_DB_NAME" -Fc "--lock-wait-timeout=$BACKUP_LOCK_WAIT_TIMEOUT" "--snapshot=SNAPSHOT_ID")
        # The container authenticates over its local socket; no password leaves this host.
        unset PGPASSWORD
        ;;
    *) die 2 "BACKUP_MODE must be direct or compose" ;;
esac

if is_true "${DRY_RUN:-}"; then
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    log "DRY_RUN: nothing is contacted or written"
    if [ "$BACKUP_MODE" = direct ]; then
        password_state="<unset>"
        [ -z "${PGPASSWORD:-}" ] || password_state="<redacted>"
        log "DRY_RUN: environment PGHOST=${PGHOST:-} PGPORT=${PGPORT:-} PGUSER=${PGUSER:-} PGDATABASE=${PGDATABASE:-} PGSSLMODE=${PGSSLMODE:-} PGPASSWORD=$password_state"
    fi
    log "DRY_RUN: snapshot session: $(quote_cmd "${psql_cmd[@]}")"
    log "DRY_RUN:   BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY; SELECT pg_export_snapshot(); <row count per table>"
    log "DRY_RUN: dump: $(quote_cmd "${dump_cmd[@]}") | age -r $BACKUP_AGE_RECIPIENT -o $(quote_cmd "$BACKUP_DIR/luna-$stamp.dump.age.partial")"
    log "DRY_RUN: then rename to luna-$stamp.dump.age and luna-$stamp.counts.json, upload hook: $([ -n "$BACKUP_UPLOAD_CMD" ] && printf 'set' || printf 'none'), retention: keep $BACKUP_KEEP_LAST, $BACKUP_KEEP_DAYS days"
    exit 0
fi

command -v age > /dev/null || die 2 "age is not installed"
if [ "$BACKUP_MODE" = direct ]; then
    command -v psql > /dev/null || die 2 "psql is not installed"
    command -v pg_dump > /dev/null || die 2 "pg_dump is not installed"
else
    command -v docker > /dev/null || die 2 "docker is not installed"
    [ -f "$COMPOSE_FILE" ] || die 2 "COMPOSE_FILE not found"
    [ -f "$COMPOSE_ENV_FILE" ] || die 2 "COMPOSE_ENV_FILE not found"
fi
# age itself checks the recipient (checksum, key type) before anything is read.
age -r "$BACKUP_AGE_RECIPIENT" -o /dev/null < /dev/null 2> /dev/null ||
    die 2 "age rejected BACKUP_AGE_RECIPIENT (not a valid public key)"

prepare_dir
acquire_lock
work="$(mktemp -d "${TMPDIR:-/tmp}/luna-backup.XXXXXX")"

name=""
for _ in 1 2 3 4 5; do
    name="luna-$(date -u +%Y%m%dT%H%M%SZ)"
    if [ ! -e "$dir/$name.dump.age" ] && [ ! -e "$dir/$name.counts.json" ]; then
        break
    fi
    name=""
    sleep 1
done
[ -n "$name" ] || die 1 "could not pick a new backup name"
final="$dir/$name.dump.age"
partial="$final.partial"
counts_final="$dir/$name.counts.json"
counts_partial="$counts_final.partial"
counts_final_reserved="$counts_final"
counts_final=""

log "starting $name (mode $BACKUP_MODE)"
open_snapshot_session
write_manifest
dump_cmd=("${dump_cmd[@]/--snapshot=SNAPSHOT_ID/--snapshot=$snapshot}")

if ! run_dump; then
    die 1 "pg_dump or age failed (a lock wait over BACKUP_LOCK_WAIT_TIMEOUT=$BACKUP_LOCK_WAIT_TIMEOUT ends it too); the partial backup was removed"
fi
# pg_dump imported the snapshot when it started and has finished: the dump is complete
# and consistent even if the snapshot session has ended since (server timeout, admin).
session_ok=1
kill -0 "$session_pid" 2> /dev/null && try_send_sql "COMMIT;" '\q' || session_ok=0
close_session
if [ "$session_ok" != 1 ] || [ "$session_status" != 0 ]; then
    warn "warning: the snapshot session ended before the dump finished (psql exit $session_status); the dump itself completed and is kept"
fi

[ -s "$partial" ] || die 1 "the encrypted dump is empty"
[ "$(head -c "${#AGE_MAGIC}" "$partial")" = "$AGE_MAGIC" ] || die 1 "the output is not an age file"
chmod 600 "$partial" "$counts_partial"
counts_final="$counts_final_reserved"
mv -f -- "$counts_partial" "$counts_final"
mv -f -- "$partial" "$final"
finished=1
partial=""
counts_partial=""
log "wrote ${final##*/} and ${counts_final##*/} ($table_count tables)"

status=0
if [ -n "$BACKUP_UPLOAD_CMD" ]; then
    if env -u PGPASSWORD sh -c "$BACKUP_UPLOAD_CMD" luna-backup-upload "$final" "$counts_final"; then
        log "upload hook: ok"
    else
        warn "upload hook failed (exit $?); the local backup is kept"
        status=4
    fi
fi
if ! prune; then
    warn "retention failed"
    [ "$status" != 0 ] || status=5
fi
exit "$status"
