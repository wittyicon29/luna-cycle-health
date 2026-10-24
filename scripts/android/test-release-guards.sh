#!/usr/bin/env bash
# Guard tests for release.sh and rename-app-id.sh. Runs on temp copies; never builds.
# Usage: bash scripts/android/test-release-guards.sh
set -uo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILS=0

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAILS=$((FAILS+1)); }

make_copy() {
  local d="$1"
  mkdir -p "$d/scripts/android" "$d/frontend/android/app/src/main/res/values" \
           "$d/frontend/android/app/src/main/java/app/placeholder/luna"
  cp "$SRC"/scripts/android/{env.sh,release.sh,rename-app-id.sh} "$d/scripts/android/"
  cp "$SRC/frontend/capacitor.config.json" "$d/frontend/"
  cp "$SRC/frontend/android/app/build.gradle" "$d/frontend/android/app/"
  cp "$SRC/frontend/android/app/src/main/res/values/strings.xml" "$d/frontend/android/app/src/main/res/values/"
  cp "$SRC/frontend/android/app/src/main/java/app/placeholder/luna/MainActivity.java" \
     "$d/frontend/android/app/src/main/java/app/placeholder/luna/"
  cp "$SRC/frontend/android/README.md" "$d/frontend/android/README.md"
  mkdir -p "$d/frontend/android/app/src/main/assets"
  echo '{"appId":"app.placeholder.luna"}' > "$d/frontend/android/app/src/main/assets/capacitor.config.json"
  echo "// dotfile" > "$d/frontend/android/app/src/main/java/app/placeholder/luna/.hidden"
  # Placeholder text in a README must survive a rename untouched.
  echo "mentions app.placeholder.luna" >> "$d/frontend/android/README.md"
}

# Fake JDK 21 so the JDK guard passes without a real toolchain.
mkdir -p "$TMP/jdk21/bin" "$TMP/jdk17/bin"
for v in 21 17; do
  cat > "$TMP/jdk$v/bin/java" <<EOF
#!/bin/sh
echo 'openjdk version "$v.0.4" 2024-07-16' >&2
EOF
done
chmod +x "$TMP/jdk21/bin/java" "$TMP/jdk17/bin/java"

# expect_fail <name> <expected-message-substring> <env assignments...>
run_release() { # dir, then env pairs
  local d="$1"; shift
  env -i HOME="$HOME" PATH="$PATH" LUNA_ROOT="$d" "$@" bash "$d/scripts/android/release.sh" --check-only 2>&1
}
expect_fail() {
  local name="$1" msg="$2" dir="$3"; shift 3
  local out rc
  out="$(run_release "$dir" "$@")"; rc=$?
  if [ $rc -ne 0 ] && printf '%s' "$out" | grep -qF "$msg"; then pass "$name"; else fail "$name (rc=$rc: $out)"; fi
}

echo "== Section 1: release guards =="
A="$TMP/a"; make_copy "$A"
touch "$TMP/ks.p12"
GOOD=(JAVA_HOME="$TMP/jdk21" REACT_APP_API_BASE=https://api.example.org LUNA_KEYSTORE="$TMP/ks.p12" LUNA_KEYSTORE_PASSWORD=x LUNA_KEY_ALIAS=k LUNA_KEY_PASSWORD=y)

expect_fail "placeholder appId rejected" "appId is still the placeholder" "$A" "${GOOD[@]}"

sed 's/app\.placeholder\.luna/org.example.luna/' "$A/frontend/capacitor.config.json" > "$A/c.tmp" \
  && mv "$A/c.tmp" "$A/frontend/capacitor.config.json"

expect_fail "empty API base rejected" "REACT_APP_API_BASE must be an https:// URL" "$A" \
  JAVA_HOME="$TMP/jdk21" LUNA_KEYSTORE="$TMP/ks.p12" LUNA_KEYSTORE_PASSWORD=x LUNA_KEY_ALIAS=k LUNA_KEY_PASSWORD=y
expect_fail "http API base rejected" "REACT_APP_API_BASE must be an https:// URL" "$A" \
  REACT_APP_API_BASE=http://api.example.org LUNA_KEYSTORE="$TMP/ks.p12" LUNA_KEYSTORE_PASSWORD=x LUNA_KEY_ALIAS=k LUNA_KEY_PASSWORD=y
expect_fail "missing keystore vars rejected" "signing keystore settings missing" "$A" JAVA_HOME="$TMP/jdk21" REACT_APP_API_BASE=https://api.example.org
expect_fail "missing keystore password rejected" "signing keystore settings missing" "$A" \
  JAVA_HOME="$TMP/jdk21" REACT_APP_API_BASE=https://api.example.org LUNA_KEYSTORE="$TMP/ks.p12" LUNA_KEY_ALIAS=k LUNA_KEY_PASSWORD=y
expect_fail "JDK 17 rejected" "JDK 21" "$A" "${GOOD[@]}" JAVA_HOME="$TMP/jdk17"
expect_fail "JAVA_HOME unset rejected" "JDK 21" "$A" REACT_APP_API_BASE=https://api.example.org LUNA_KEYSTORE="$TMP/ks.p12" LUNA_KEYSTORE_PASSWORD=x LUNA_KEY_ALIAS=k LUNA_KEY_PASSWORD=y
out="$(env -i HOME="$HOME" PATH="$PATH" LUNA_ROOT="$A" "${GOOD[@]}" bash "$A/scripts/android/release.sh" --bogus 2>&1)"; rc=$?
if [ $rc -ne 0 ] && printf '%s' "$out" | grep -q "Unknown argument"; then pass "unknown argument rejected"; else fail "unknown argument rejected ($out)"; fi
expect_fail "missing keystore file rejected" "signing keystore settings missing" "$A" \
  JAVA_HOME="$TMP/jdk21" REACT_APP_API_BASE=https://api.example.org LUNA_KEYSTORE="$TMP/nope.p12" LUNA_KEYSTORE_PASSWORD=x LUNA_KEY_ALIAS=k LUNA_KEY_PASSWORD=y

cp "$A/frontend/capacitor.config.json" "$TMP/good-config.json"
sed 's/org\.example\.luna/com.example.luna/' "$TMP/good-config.json" > "$A/frontend/capacitor.config.json"
expect_fail "com.example appId rejected" "example id" "$A" "${GOOD[@]}"
cp "$TMP/good-config.json" "$A/frontend/capacitor.config.json"
P="$TMP/p"; make_copy "$P"
expect_fail "precedence: appId message before API base" "appId is still the placeholder" "$P" JAVA_HOME="$TMP/jdk17" REACT_APP_API_BASE=http://x

out="$(run_release "$A" "${GOOD[@]}")"; rc=$?
if [ $rc -eq 0 ]; then pass "all guards satisfied passes"; else fail "all guards satisfied passes ($out)"; fi

echo "== Section 2: rename-app-id =="
B="$TMP/b"; make_copy "$B"
README_SUM="$(shasum "$B/frontend/android/README.md")"
for bad in "org.class.luna" "org.realco.int" "app.placeholder.luna.sub" "Bad.Id" "single" "app.placeholder.luna" "com.example.luna" "1abc.def" ""; do
  out="$(LUNA_ROOT="$B" bash "$B/scripts/android/rename-app-id.sh" "$bad" 2>&1)"; rc=$?
  if [ $rc -ne 0 ]; then pass "rejects '$bad'"; else fail "accepts bad id '$bad'"; fi
done
if grep -rqF --exclude='*.md' app.placeholder.luna "$B/frontend"; then :; else fail "bad ids must not modify files"; fi

LUNA_ROOT="$B" bash "$B/scripts/android/rename-app-id.sh" org.realco.luna >/dev/null 2>&1 \
  && pass "accepts org.realco.luna" || fail "rejects good id"
if grep -rqF --exclude='*.md' app.placeholder.luna "$B/frontend"; then fail "placeholder remains in non-md files"; else pass "no placeholder left in non-md files"; fi
[ "$README_SUM" = "$(shasum "$B/frontend/android/README.md")" ] && pass "README untouched" || fail "README modified"
grep -q org.realco.luna "$B/frontend/android/app/src/main/assets/capacitor.config.json" \
  && pass "assets config updated" || fail "assets config not updated"
[ -f "$B/frontend/android/app/src/main/java/org/realco/luna/.hidden" ] && pass "dotfile moved" || fail "dotfile not moved"
[ -f "$B/frontend/android/app/src/main/java/org/realco/luna/MainActivity.java" ] \
  && pass "MainActivity moved" || fail "MainActivity not moved"
[ -d "$B/frontend/android/app/src/main/java/app" ] && fail "old package dir remains" || pass "old package dir removed"
grep -q '^package org.realco.luna;' "$B/frontend/android/app/src/main/java/org/realco/luna/MainActivity.java" \
  && pass "package line updated" || fail "package line not updated"

echo
if [ $FAILS -eq 0 ]; then echo "ALL PASSED"; else echo "$FAILS FAILED"; exit 1; fi
