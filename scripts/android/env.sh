# Source me: exports JAVA_HOME, ANDROID_HOME, ANDROID_SDK_ROOT and extends PATH.
_LUNA_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." && pwd)"
_LUNA_TOOLS="$_LUNA_ROOT/.android-tooling"
_LUNA_JAVA="$(find "$_LUNA_TOOLS/jdk" -type d -path '*/Contents/Home' -maxdepth 4 2>/dev/null | head -1)"
if [ -n "$_LUNA_JAVA" ]; then
  export JAVA_HOME="$_LUNA_JAVA"
  export PATH="$JAVA_HOME/bin:$PATH"
fi
export ANDROID_HOME="$_LUNA_TOOLS/android-sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
unset _LUNA_ROOT _LUNA_TOOLS _LUNA_JAVA
