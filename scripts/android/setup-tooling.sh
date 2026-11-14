#!/usr/bin/env bash
# Installs JDK 21 + Android SDK + emulator image in user space under .android-tooling/.
set -euo pipefail

if [ "${ANDROID_ACCEPT_LICENSES:-}" != "yes" ]; then
  echo "Refusing to run: set ANDROID_ACCEPT_LICENSES=yes to accept the Android SDK licences." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TOOLS="$ROOT/.android-tooling"
mkdir -p "$TOOLS"

case "$(uname -m)" in
  arm64|aarch64) JDK_ARCH=aarch64; ABI=arm64-v8a ;;
  x86_64)        JDK_ARCH=x64;     ABI=x86_64 ;;
  *) echo "Unsupported arch $(uname -m)" >&2; exit 1 ;;
esac

# 1. JDK 21 (>= 21 required by Capacitor 8)
find_java() { find "$TOOLS/jdk" -type d -path '*/Contents/Home' -maxdepth 4 2>/dev/null | head -1; }
java_major() {
  "$1/bin/java" -version 2>&1 | sed -n '1s/.*version "\([0-9]*\).*/\1/p'
}
CUR="$(find_java)"
if [ -n "$CUR" ] && [ "$(java_major "$CUR")" -ge 21 ] 2>/dev/null; then
  echo "JDK $(java_major "$CUR") already present."
else
  if [ -d "$TOOLS/jdk" ]; then
    OLD="$TOOLS/jdk-old-$(date +%Y%m%d%H%M%S)"
    echo "Moving older/unusable JDK aside to $OLD"
    mv "$TOOLS/jdk" "$OLD"
  fi
  echo "Downloading Temurin 21 ($JDK_ARCH)..."
  curl -fSL --retry 3 --no-progress-meter -o "$TOOLS/jdk.tar.gz" \
    "https://api.adoptium.net/v3/binary/latest/21/ga/mac/${JDK_ARCH}/jdk/hotspot/normal/eclipse"
  rm -rf "$TOOLS/jdk-extract"; mkdir -p "$TOOLS/jdk-extract"
  tar -xzf "$TOOLS/jdk.tar.gz" -C "$TOOLS/jdk-extract"
  mv "$TOOLS/jdk-extract" "$TOOLS/jdk"
  rm -f "$TOOLS/jdk.tar.gz"
fi
JAVA_HOME="$(find_java)"
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"

# 2. Android command-line tools
SDK="$TOOLS/android-sdk"
if [ ! -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ]; then
  echo "Downloading Android command-line tools..."
  curl -fSL --retry 3 --no-progress-meter -o "$TOOLS/cmdline-tools.zip" \
    "https://dl.google.com/android/repository/commandlinetools-mac-11076708_latest.zip"
  rm -rf "$TOOLS/cmdline-extract"; mkdir -p "$TOOLS/cmdline-extract" "$SDK/cmdline-tools"
  unzip -q "$TOOLS/cmdline-tools.zip" -d "$TOOLS/cmdline-extract"
  rm -rf "$SDK/cmdline-tools/latest"
  mv "$TOOLS/cmdline-extract/cmdline-tools" "$SDK/cmdline-tools/latest"
  rm -rf "$TOOLS/cmdline-extract" "$TOOLS/cmdline-tools.zip"
else
  echo "cmdline-tools already present."
fi
export ANDROID_HOME="$SDK" ANDROID_SDK_ROOT="$SDK"
export PATH="$SDK/cmdline-tools/latest/bin:$SDK/platform-tools:$SDK/emulator:$PATH"

# 3. Licences + packages
yes | sdkmanager --licenses >/dev/null || true
# Capacitor 8 compiles and targets API 36. build-tools 35.0.0 stays: test-launcher-aliases.sh uses its aapt.
IMG="system-images;android-36;google_apis;${ABI}"
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" "build-tools;35.0.0" "emulator" "$IMG"

# 4. Emulator AVD (recreated when it still uses an older system image; it holds only test data)
AVD_CONFIG="${ANDROID_AVD_HOME:-$HOME/.android/avd}/luna_test.avd/config.ini"
if avdmanager list avd -c | grep -qx luna_test; then
  if grep -q "system-images/android-36/" "$AVD_CONFIG" 2>/dev/null; then
    echo "AVD luna_test already present (API 36)."
  else
    echo "AVD luna_test uses an older system image; recreating it on API 36."
    avdmanager delete avd -n luna_test
    echo no | avdmanager create avd -n luna_test -k "$IMG" -d pixel_6
  fi
else
  echo no | avdmanager create avd -n luna_test -k "$IMG" -d pixel_6
fi
echo "Done. Use: source scripts/android/env.sh"
