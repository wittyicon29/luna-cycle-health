#!/usr/bin/env bash
# Restore a backup written by scripts/backup_db.sh and verify it.
#
#   scripts/restore_db.sh --file luna-YYYYmmddTHHMMSSZ.dump.age --identity KEYFILE \
#       --target-url postgresql://user@host:port/dbname [--create] [--force] [--manifest FILE]
#
#   --file F            the encrypted dump (.dump.age)
#   --identity KEYFILE  the age identity (private key) file, or an SSH private key matching
#                       the backup's recipient. It is only read by `age -d`, never copied.
#   --target-url URL    the database to restore into (or set RESTORE_TARGET_URL). Leave the
#                       password out of the URL and use PGPASSWORD or ~/.pgpass: a command
#                       line is visible to other users of the machine while the script runs.
#   --create            create the target database first (it must not exist). It is dropped
#                       again if the restore fails. Needs CREATEDB; the server's `postgres`
#                       database is used for this (--maintenance-db NAME to change it).
#   --force             restore into a database that is not empty: objects that are in the
#                       backup are dropped and recreated (pg_restore --clean --if-exists);
#                       other objects stay and show up as count mismatches.
#   --manifest FILE     the row count manifest (default: the .counts.json next to --file).
#
# Without --create the target must exist and be empty. Steps:
#   1. The target is checked (read-only): with --create it must not exist, otherwise it
#      must be empty unless --force.
#   2. `age -d` decrypts the whole file to /dev/null: a wrong identity or a damaged file
#      fails here, before the target is touched.
#   3. `age -d -i KEYFILE F | pg_restore --no-owner --no-acl --single-transaction` streams
#      the dump into the target (no plaintext file); a failure rolls the whole restore back.
#   4. The row count of every table is compared with the manifest; the summary lists table
#      names and counts only, never row contents.
#
# Exit codes:
#   0  restored, and every table's row count matches the manifest
#   1  decryption, connection or pg_restore failed (nothing is left behind: the restore
#      runs in one transaction, and a database created by --create is dropped)
#   2  usage error, missing file or tool, malformed manifest (nothing was contacted)
#   3  refused: the target is not empty (no --force), or exists while --create was given
#   4  restored, but the row counts differ from the manifest (the database is kept for
#      inspection; drop it yourself if it was a drill)
#   129/130/143  interrupted by SIGHUP/SIGINT/SIGTERM (cleaned up as in 1)

set -euo pipefail
umask 077

# Same query as scripts/backup_db.sh (a test checks that they are identical).
COUNT_SQL="SELECT 'COUNT' || chr(9) || CASE WHEN n.nspname = 'public' THEN c.relname::text ELSE n.nspname || '.' || c.relname END || chr(9) || (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast|temp)' ORDER BY 1;"
# Objects that make a database "not empty".
OBJECTS_SQL="SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast|temp)') + (SELECT count(*) FROM pg_extension WHERE extname <> 'plpgsql') + (SELECT count(*) FROM pg_namespace WHERE nspname NOT IN ('public', 'information_schema') AND nspname !~ '^pg_');"

log() { printf 'restore: %s\n' "$*"; }
warn() { printf 'restore: %s\n' "$*" >&2; }
die() {
    local code="$1"
    shift
    printf 'restore: error: %s\n' "$*" >&2
    exit "$code"
}

usage() {
    sed -n '2,/^# Exit codes/p' "$0" | sed -e 's/^# \{0,1\}//' -e '$d'
    printf '%s\n' "Exit codes: 0 ok, 1 failed, 2 usage, 3 refused (target not empty / exists), 4 count mismatch."
}

urldecode() {
    local s="${1//\\/\\\\}"
    s="${s//%/\\x}"
    printf '%b' "$s"
}

# Split a postgresql:// URL into libpq environment variables (same rules as backup_db.sh).
parse_db_url() {
    local url="$1" rest userinfo="" hostport path="" query="" host port="" pair key value
    local re='^postgres(ql)?(\+[A-Za-z0-9_]+)?://(.*)$'
    [[ "$url" =~ $re ]] || die 2 "--target-url must be a postgresql:// URL"
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
    [ -z "$port" ] || [[ "$port" =~ ^[0-9]{1,5}$ ]] || die 2 "--target-url has an invalid port"

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
            url_had_password=1
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
            *) die 2 "--target-url parameter not supported here: $key (use sslmode, sslrootcert or connect_timeout)" ;;
        esac
    done
    [ -n "${PGDATABASE:-}" ] || die 2 "--target-url must name the database"
}

absolute() {
    case "$1" in
        /*) printf '%s' "$1" ;;
        *) printf '%s/%s' "$PWD" "$1" ;;
    esac
}

# psql against the target (or another database on the same server with -d NAME);
# the SQL comes on stdin so that :'var' / :"var" interpolation quotes values safely.
run_psql() {
    psql -X -q -At -w -v ON_ERROR_STOP=1 "$@"
}

# --- arguments --------------------------------------------------------------------------

file=""
identity=""
target_url="${RESTORE_TARGET_URL:-}"
manifest=""
maintenance_db="postgres"
create=0
force=0
url_had_password=0

need_value() {
    [ "$2" -ge 2 ] || die 2 "$1 needs a value"
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --file)
            need_value "$1" "$#"
            file="$2"
            shift 2
            ;;
        --identity)
            need_value "$1" "$#"
            identity="$2"
            shift 2
            ;;
        --target-url)
            need_value "$1" "$#"
            target_url="$2"
            shift 2
            ;;
        --manifest)
            need_value "$1" "$#"
            manifest="$2"
            shift 2
            ;;
        --maintenance-db)
            need_value "$1" "$#"
            maintenance_db="$2"
            shift 2
            ;;
        --create)
            create=1
            shift
            ;;
        --force)
            force=1
            shift
            ;;
        -h | --help)
            usage
            exit 0
            ;;
        *) die 2 "unknown argument: $1 (see --help)" ;;
    esac
done

[ -n "$file" ] || die 2 "--file is required"
[ -n "$identity" ] || die 2 "--identity is required"
[ -n "$target_url" ] || die 2 "--target-url is required"
[ -f "$file" ] && [ -r "$file" ] || die 2 "--file: cannot read the backup file"
[ -f "$identity" ] && [ -r "$identity" ] || die 2 "--identity: cannot read the identity file"
file="$(absolute "$file")"
identity="$(absolute "$identity")"
if [ -z "$manifest" ]; then
    case "$file" in
        *.dump.age) manifest="${file%.dump.age}.counts.json" ;;
        *) manifest="$file.counts.json" ;;
    esac
fi
[ -f "$manifest" ] && [ -r "$manifest" ] ||
    die 2 "the row count manifest is missing: ${manifest##*/} (expected next to the backup, or pass --manifest)"

parse_db_url "$target_url"
target_db="$PGDATABASE"
# pg_restore/psql would read a name containing '=' as a connection string.
[[ "$target_db" =~ ^[A-Za-z_][A-Za-z0-9_$-]{0,62}$ ]] ||
    die 2 "the target database name must be letters, digits, _, \$ or - (max 63)"
[[ "$maintenance_db" =~ ^[A-Za-z_][A-Za-z0-9_$-]{0,62}$ ]] || die 2 "--maintenance-db: invalid name"
[ "$create" = 0 ] || [ "$maintenance_db" != "$target_db" ] || die 2 "--create: the target cannot be the maintenance database"
if [ "$url_had_password" = 1 ]; then
    warn "warning: the target URL contains a password; prefer PGPASSWORD or ~/.pgpass"
fi
if [ -n "$(find "$identity" -maxdepth 0 -perm -004 2> /dev/null)" ]; then
    warn "warning: the identity file is readable by other users; chmod 600 it"
fi

for tool in age pg_restore psql; do
    command -v "$tool" > /dev/null || die 2 "$tool is not installed"
done

# Manifest: the line-oriented JSON object written by backup_db.sh.
m_names=()
m_counts=()
while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    if [[ "$line" =~ ^[[:space:]]*[{}][[:space:]]*$ ]] || [[ "$line" =~ ^[[:space:]]*$ ]]; then
        continue
    fi
    if [[ "$line" =~ ^[[:space:]]*\"(([^\"\\]|\\.)*)\"[[:space:]]*:[[:space:]]*([0-9]+)[[:space:]]*,?[[:space:]]*$ ]]; then
        m_names+=("${BASH_REMATCH[1]}")
        m_counts+=("${BASH_REMATCH[3]}")
    else
        die 2 "the manifest is malformed: ${manifest##*/}"
    fi
done < "$manifest"
[ "${#m_names[@]}" -gt 0 ] || die 2 "the manifest lists no tables: ${manifest##*/}"

# --- cleanup ------------------------------------------------------------------------------

created=0
pipeline_pid=""
finished=0

# shellcheck disable=SC2329 # called from the EXIT trap
drop_created() {
    if [ "$created" = 1 ]; then
        if printf '%s\n' 'DROP DATABASE IF EXISTS :"target" WITH (FORCE);' |
            run_psql -d "$maintenance_db" -v target="$target_db"; then
            warn "dropped the database this run created: $target_db"
        else
            warn "could not drop the database this run created: $target_db (drop it by hand)"
        fi
        created=0
    fi
}

# shellcheck disable=SC2329 # called from the EXIT/signal traps
cleanup() {
    local rc=$?
    trap - EXIT INT TERM HUP
    if [ -n "$pipeline_pid" ]; then
        pkill -TERM -P "$pipeline_pid" 2> /dev/null || kill -TERM "$pipeline_pid" 2> /dev/null || true
        wait "$pipeline_pid" 2> /dev/null || true
    fi
    if [ "$finished" != 1 ]; then
        drop_created
    fi
    exit "$rc"
}

# shellcheck disable=SC2329 # called from the signal traps
on_signal() {
    warn "interrupted by SIG$1; cleaning up"
    exit "$2"
}

trap cleanup EXIT
trap 'on_signal INT 130' INT
trap 'on_signal TERM 143' TERM
trap 'on_signal HUP 129' HUP

# --- 1. target state (read-only checks) -----------------------------------------------------

if [ "$create" = 1 ]; then
    exists="$(printf '%s\n' "SELECT 1 FROM pg_database WHERE datname = :'target';" |
        run_psql -d "$maintenance_db" -v target="$target_db")" || die 1 "cannot connect to the server"
    [ -z "$exists" ] || die 3 "the target database already exists; drop it, or restore without --create into an empty database"
    objects=0
else
    objects="$(printf '%s\n' "$OBJECTS_SQL" | run_psql)" || die 1 "cannot connect to the target database"
    [[ "$objects" =~ ^[0-9]+$ ]] || die 1 "unexpected answer from the target database"
    if [ "$objects" != 0 ] && [ "$force" != 1 ]; then
        die 3 "the target database is not empty ($objects objects); use an empty or new database (--create), or --force"
    fi
fi

# --- 2. decrypt check (target untouched) -----------------------------------------------------

log "checking that ${file##*/} decrypts with the identity"
if ! age_err="$(age -d -i "$identity" "$file" 2>&1 > /dev/null)"; then
    [ -z "$age_err" ] || printf 'restore:   %s\n' "$age_err" >&2
    die 1 "cannot decrypt the backup with this identity (wrong key, or a damaged/incomplete file); the target was not touched"
fi

if [ "$create" = 1 ]; then
    printf '%s\n' 'CREATE DATABASE :"target";' | run_psql -d "$maintenance_db" -v target="$target_db" ||
        die 1 "could not create the target database"
    created=1
    log "created database $target_db"
fi
restore_cmd=(pg_restore --no-owner --no-acl --exit-on-error --single-transaction -d "$target_db")
if [ "$objects" != 0 ]; then
    warn "target is not empty ($objects objects): --force, objects from the backup are dropped and recreated"
    restore_cmd+=(--clean --if-exists)
fi

# --- 3. restore ------------------------------------------------------------------------------

log "restoring into $target_db"
status=0
(
    set -o pipefail
    age -d -i "$identity" "$file" | "${restore_cmd[@]}"
) &
pipeline_pid=$!
wait "$pipeline_pid" || status=$?
pipeline_pid=""
if [ "$status" != 0 ]; then
    die 1 "pg_restore failed (exit $status); the restore was rolled back"
fi
finished=1
log "restore complete; comparing row counts"

# --- 4. verify ---------------------------------------------------------------------------------

counts="$(printf '%s\n' "$COUNT_SQL" | run_psql)" || die 1 "cannot count the restored rows"
t_names=()
t_counts=()
while IFS= read -r line; do
    case "$line" in
        COUNT$'\t'*) ;;
        *) continue ;;
    esac
    line="${line#COUNT$'\t'}"
    name="${line%$'\t'*}"
    name="${name//\\/\\\\}"
    name="${name//\"/\\\"}"
    t_names+=("$name")
    t_counts+=("${line##*$'\t'}")
done < <(printf '%s\n' "$counts")

mismatches=0
checked=0
printf 'restore: %-40s %12s %12s\n' "table" "expected" "restored"
i=0
while [ "$i" -lt "${#m_names[@]}" ]; do
    name="${m_names[$i]}"
    expected="${m_counts[$i]}"
    actual="-"
    j=0
    while [ "$j" -lt "${#t_names[@]}" ]; do
        if [ "${t_names[$j]}" = "$name" ]; then
            actual="${t_counts[$j]}"
            break
        fi
        j=$((j + 1))
    done
    mark="ok"
    if [ "$actual" != "$expected" ]; then
        mark="MISMATCH"
        mismatches=$((mismatches + 1))
    fi
    printf 'restore: %-40s %12s %12s  %s\n' "$name" "$expected" "$actual" "$mark"
    checked=$((checked + 1))
    i=$((i + 1))
done
j=0
while [ "$j" -lt "${#t_names[@]}" ]; do
    name="${t_names[$j]}"
    found=0
    i=0
    while [ "$i" -lt "${#m_names[@]}" ]; do
        if [ "${m_names[$i]}" = "$name" ]; then
            found=1
            break
        fi
        i=$((i + 1))
    done
    if [ "$found" = 0 ]; then
        printf 'restore: %-40s %12s %12s  %s\n' "$name" "-" "${t_counts[$j]}" "MISMATCH (not in the manifest)"
        mismatches=$((mismatches + 1))
    fi
    j=$((j + 1))
done

if [ "$mismatches" != 0 ]; then
    warn "row count mismatch in $mismatches table(s); the restored database $target_db is kept for inspection"
    exit 4
fi
log "$checked tables, all row counts match the manifest"
exit 0
