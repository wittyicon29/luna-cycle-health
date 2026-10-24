#!/usr/bin/env bash
# Guarded release build: produces frontend/android/app/build/outputs/bundle/release/app-release.aab
# Usage: bash scripts/android/release.sh [--check-only]
# Needs: REACT_APP_API_BASE (https://...), LUNA_KEYSTORE, LUNA_KEYSTORE_PASSWORD,
#        LUNA_KEY_ALIAS, LUNA_KEY_PASSWORD, REACT_APP_GOOGLE_WEB_CLIENT_ID (or LUNA_ALLOW_NO_GOOGLE=1).
# Optional: LUNA_VERSION_CODE (positive integer, default 1), LUNA_VERSION_NAME (default 1.0).
# Passwords are never printed or written to disk.
set -euo pipefail

ROOT="${LUNA_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# shellcheck disable=SC1091
set +e +o pipefail; source "$ROOT/scripts/android/env.sh"; set -eo pipefail

CHECK_ONLY=0
case "${1:-}" in
  "") ;;
  --check-only) CHECK_ONLY=1 ;;
  *) echo "Unknown argument '$1' (only --check-only is allowed)" >&2; exit 2 ;;
esac
[ "$#" -le 1 ] || { echo "Too many arguments (only --check-only is allowed)" >&2; exit 2; }

APP_ID="$(node -p "require('$ROOT/frontend/capacitor.config.json').appId")"
case "$APP_ID" in com.example.*) echo "Refusing to build: appId $APP_ID is an example id — run scripts/android/rename-app-id.sh <id>" >&2; exit 1 ;; esac
if [ "$APP_ID" = "app.placeholder.luna" ]; then
  echo "Refusing to build: appId is still the placeholder app.placeholder.luna — run scripts/android/rename-app-id.sh <id>" >&2
  exit 1
fi

case "${REACT_APP_API_BASE:-}" in
  https://?*) ;;
  *) echo "Refusing to build: REACT_APP_API_BASE must be an https:// URL" >&2; exit 1 ;;
esac

if [ -z "${LUNA_KEYSTORE:-}" ] || [ -z "${LUNA_KEYSTORE_PASSWORD:-}" ] \
   || [ -z "${LUNA_KEY_ALIAS:-}" ] || [ -z "${LUNA_KEY_PASSWORD:-}" ] \
   || [ ! -f "${LUNA_KEYSTORE:-}" ]; then
  echo "Refusing to build: signing keystore settings missing (set LUNA_KEYSTORE to an existing file, LUNA_KEYSTORE_PASSWORD, LUNA_KEY_ALIAS, LUNA_KEY_PASSWORD)" >&2
  exit 1
fi

JAVA_MAJOR=""
if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ]; then
  JAVA_MAJOR="$("$JAVA_HOME/bin/java" -version 2>&1 | sed -n '1s/.*version "\([0-9]*\).*/\1/p')"
fi
if ! [ "${JAVA_MAJOR:-0}" -ge 21 ] 2>/dev/null; then
  echo "Refusing to build: JAVA_HOME must point to a JDK 21 or newer (run scripts/android/setup-tooling.sh)" >&2
  exit 1
fi

if [ -z "${REACT_APP_GOOGLE_WEB_CLIENT_ID:-}" ] && [ "${LUNA_ALLOW_NO_GOOGLE:-}" != "1" ]; then
  echo "Refusing to build: REACT_APP_GOOGLE_WEB_CLIENT_ID is empty — native Google sign-in would always fail (set LUNA_ALLOW_NO_GOOGLE=1 to build without it)" >&2
  exit 1
fi

# Play rejects re-used versionCodes, so bump LUNA_VERSION_CODE for every upload.
VC="${LUNA_VERSION_CODE-1}"
case "$VC" in
  ''|*[!0-9]*|0|0[0-9]*) echo "Refusing to build: LUNA_VERSION_CODE must be a positive integer (got '$VC')" >&2; exit 1 ;;
esac
[ "${#VC}" -le 9 ] || { echo "Refusing to build: LUNA_VERSION_CODE is too large (got '$VC')" >&2; exit 1; }
VN="${LUNA_VERSION_NAME-1.0}"
case "$VN" in
  ''|*[!A-Za-z0-9._-]*) echo "Refusing to build: LUNA_VERSION_NAME may only contain letters, digits, '.', '_' and '-' (got '$VN')" >&2; exit 1 ;;
esac

if [ "$CHECK_ONLY" = 1 ]; then
  echo "Release guards passed for $APP_ID"
  exit 0
fi

cd "$ROOT/frontend"
REACT_APP_API_BASE="$REACT_APP_API_BASE" npm run android:sync
cd android
# Signing config is read by app/build.gradle from the exported LUNA_* variables.
export LUNA_KEYSTORE LUNA_KEYSTORE_PASSWORD LUNA_KEY_ALIAS LUNA_KEY_PASSWORD
export LUNA_VERSION_CODE="$VC" LUNA_VERSION_NAME="$VN"
./gradlew bundleRelease
echo "Built: $ROOT/frontend/android/app/build/outputs/bundle/release/app-release.aab"
