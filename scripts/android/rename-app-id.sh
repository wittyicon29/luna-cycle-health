#!/usr/bin/env bash
# Replace the placeholder Android application id everywhere it is live.
# Usage: bash scripts/android/rename-app-id.sh <new.app.id>
set -euo pipefail

OLD="app.placeholder.luna"
NEW="${1:-}"
ROOT="${LUNA_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

if [ -z "$NEW" ] || ! printf '%s' "$NEW" | grep -Eq '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'; then
  echo "Invalid app id '$NEW': use lowercase dotted segments such as org.example.luna" >&2; exit 1
fi
case "$NEW" in
  "$OLD"|com.example.*) echo "Refusing placeholder app id '$NEW'" >&2; exit 1 ;;
esac

ANDROID="$ROOT/frontend/android"
JAVA_ROOT="$ANDROID/app/src/main/java"
OLD_DIR="$JAVA_ROOT/$(printf %s "$OLD" | tr . /)"
NEW_DIR="$JAVA_ROOT/$(printf %s "$NEW" | tr . /)"

# Text references (config, gradle, string resources, generated asset copy, manifests, java).
FILES=$( { grep -rIl --exclude-dir=node_modules --exclude-dir=build --exclude-dir=.gradle \
    -F "$OLD" "$ANDROID" "$ROOT/frontend/capacitor.config.json" 2>/dev/null || true; } | sort -u)
for f in $FILES; do
  sed "s/${OLD//./\\.}/$NEW/g" "$f" > "$f.tmp.$$" && mv "$f.tmp.$$" "$f"
done

# Move the Java package directory.
if [ -d "$OLD_DIR" ] && [ "$OLD_DIR" != "$NEW_DIR" ]; then
  mkdir -p "$NEW_DIR"
  mv "$OLD_DIR"/* "$NEW_DIR"/
  d="$OLD_DIR"
  while [ "$d" != "$JAVA_ROOT" ] && rmdir "$d" 2>/dev/null; do d="$(dirname "$d")"; done
fi

echo "App id set to $NEW. Rebuild with: cd frontend && npm run android:sync"
echo "Remember to create the Android OAuth client with this id and your signing SHA-1."
