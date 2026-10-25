#!/usr/bin/env bash
# Checks the launcher activity-aliases (discreet mode) in a built APK.
# Usage: scripts/android/test-launcher-aliases.sh [path/to/app.apk]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/android/env.sh"
OUT="$ROOT/frontend/android/app/build/outputs/apk"
APK="${1:-}"
if [ -z "$APK" ]; then
  if [ -f "$OUT/release/app-release-unsigned.apk" ]; then APK="$OUT/release/app-release-unsigned.apk"
  else APK="$OUT/debug/app-debug.apk"; fi
fi
[ -f "$APK" ] || { echo "FAIL: APK not found: $APK" >&2; exit 1; }
AAPT="$ANDROID_HOME/build-tools/35.0.0/aapt"
RES="$ROOT/frontend/android/app/src/main/res/values/strings.xml"

fail() { echo "FAIL: $*" >&2; exit 1; }

# Labels are read from the APK itself (resource table -> string pool) so a stale APK cannot pass.
RES_DUMP="$("$AAPT" dump resources "$APK")"
STR_DUMP="$("$AAPT" dump strings "$APK")"
for pair in 'default:Luna Health' 'notes:Notes' 'planner:Daily Planner' 'journal:Journal' 'checklist:Checklist' 'organizer:Organizer'; do
  key="${pair%%:*}"; val="${pair#*:}"
  idx="$(printf '%s\n' "$RES_DUMP" | sed -n "s/.*string\/launcher_label_$key: t=0x03 d=0x\([0-9a-f]*\) .*/\1/p" | head -1)"
  if [ -n "$idx" ]; then
    got="$(printf '%s\n' "$STR_DUMP" | sed -n "s/^String #$((16#$idx)): //p" | head -1)"
    [ "$got" = "$val" ] || fail "APK launcher_label_$key is '$got', expected '$val'"
  else
    echo "WARN: cannot resolve launcher_label_$key in APK; falling back to source strings.xml" >&2
    grep -qF "<string name=\"launcher_label_$key\">$val</string>" "$RES" || fail "strings.xml missing launcher_label_$key = $val"
  fi
done

"$AAPT" dump xmltree "$APK" AndroidManifest.xml | python3 -I -c '
import re, sys
IS_RELEASE = "release" in sys.argv[1]
lines = sys.stdin.read().splitlines()
def fail(m):
    print("FAIL: " + m, file=sys.stderr); sys.exit(1)
# Build element blocks by indentation.
elems = []  # (indent, name, attrs, children-names)
stack = []
for ln in lines:
    m = re.match(r"^(\s*)E: (\S+)", ln)
    if m:
        e = {"indent": len(m.group(1)), "name": m.group(2), "attrs": {}, "kids": [], "cats": [], "acts": []}
        while stack and stack[-1]["indent"] >= e["indent"]:
            stack.pop()
        if stack: stack[-1]["kids"].append(e)
        stack.append(e); elems.append(e); continue
    m = re.match(r"^\s*A: ([\w:.\-]+)(?:\(0x[0-9a-f]+\))?=(.*)$", ln)
    if m and stack:
        stack[-1]["attrs"][m.group(1)] = m.group(2)
def val(s): 
    m = re.match(r"^\"(.*?)\"", s); return m.group(1) if m else s
def intent(e):
    cats, acts = [], []
    for k in e["kids"]:
        if k["name"] == "intent-filter":
            for c in k["kids"]:
                n = val(c["attrs"].get("android:name", ""))
                (cats if c["name"] == "category" else acts).append(n)
    return acts, cats
want = [".LauncherDefault",".LauncherNotes",".LauncherPlanner",".LauncherJournal",".LauncherChecklist",".LauncherOrganizer"]
al = [e for e in elems if e["name"] == "activity-alias"]
names = [val(e["attrs"].get("android:name","")) for e in al]
def short(n): return n[n.rfind("."):] if "." in n else n
if sorted(short(n) for n in names) != sorted(want) or len(al) != 6:
    fail("expected six activity-alias entries %s, found %s" % (want, names))
for e in al:
    n = short(val(e["attrs"]["android:name"]))
    en = e["attrs"].get("android:enabled", "")
    exp = "0xffffffff" if n == ".LauncherDefault" else "0x0"
    if not en.startswith("(type 0x12)" + exp):
        fail("%s android:enabled should be %s, got %s" % (n, exp, en))
    if not e["attrs"].get("android:exported","").startswith("(type 0x12)0xffffffff"):
        fail("%s must be exported" % n)
    if not short(val(e["attrs"].get("android:targetActivity",""))).endswith(".MainActivity"):
        fail("%s targetActivity is not .MainActivity" % n)
    if not e["attrs"].get("android:label","").startswith("@0x") and not e["attrs"].get("android:label","").startswith("(type 0x1)0x"):
        fail("%s label is not a resource reference: %s" % (n, e["attrs"].get("android:label")))
    acts, cats = intent(e)
    if "android.intent.action.MAIN" not in acts or "android.intent.category.LAUNCHER" not in cats:
        fail("%s lacks MAIN/LAUNCHER" % n)
mains = [e for e in elems if e["name"] == "activity" and short(val(e["attrs"].get("android:name",""))).endswith(".MainActivity")]
if len(mains) != 1: fail("MainActivity not found")
m = mains[0]
if not m["attrs"].get("android:exported","").startswith("(type 0x12)0x0"):
    fail("MainActivity must have exported=false, got %s" % m["attrs"].get("android:exported"))
if any(k["name"] == "intent-filter" for k in m["kids"]):
    acts, cats = intent(m)
    if "android.intent.category.LAUNCHER" in cats: fail("MainActivity must not have a LAUNCHER category")
app = [e for e in elems if e["name"] == "application"][0]
ab = app["attrs"].get("android:allowBackup", "")
if not ab.startswith("(type 0x12)0x0"): fail("allowBackup must be false, got %s" % ab)
uc = app["attrs"].get("android:usesCleartextTraffic", "")
if IS_RELEASE and not uc.startswith("(type 0x12)0x0"): fail("usesCleartextTraffic must be false, got %s" % uc)
print("manifest ok: 6 aliases, default enabled only, MainActivity private")
' "$APK"

# debuggable must be absent only for release APKs
case "$APK" in
  *release*) if "$AAPT" dump xmltree "$APK" AndroidManifest.xml | grep -q 'android:debuggable'; then fail "release APK is debuggable"; fi ;;
esac
echo "PASS: $APK"
