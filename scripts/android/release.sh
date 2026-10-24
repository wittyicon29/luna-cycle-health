#!/usr/bin/env bash
# Guarded release build: produces frontend/android/app/build/outputs/bundle/release/app-release.aab
# Usage: bash scripts/android/release.sh [--check-only]
# Needs: REACT_APP_API_BASE (https://...), LUNA_KEYSTORE, LUNA_KEYSTORE_PASSWORD,
#        LUNA_KEY_ALIAS, LUNA_KEY_PASSWORD. Passwords are never printed or written to disk.
set -euo pipefail

ROOT="${LUNA_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# shellcheck disable=SC1091
set +e +o pipefail; source "$ROOT/scripts/android/env.sh"; set -eo pipefail

CHECK_ONLY=0
[ "${1:-}" = "--check-only" ] && CHECK_ONLY=1

APP_ID="$(node -p "require('$ROOT/frontend/capacitor.config.json').appId")"
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

if [ "$CHECK_ONLY" = 1 ]; then
  echo "Release guards passed for $APP_ID"
  exit 0
fi

cd "$ROOT/frontend"
REACT_APP_API_BASE="$REACT_APP_API_BASE" npm run android:sync
cd android
./gradlew bundleRelease \
  -Pandroid.injected.signing.store.file="$LUNA_KEYSTORE" \
  -Pandroid.injected.signing.store.password="$LUNA_KEYSTORE_PASSWORD" \
  -Pandroid.injected.signing.key.alias="$LUNA_KEY_ALIAS" \
  -Pandroid.injected.signing.key.password="$LUNA_KEY_PASSWORD"
echo "Built: $ROOT/frontend/android/app/build/outputs/bundle/release/app-release.aab"
