# Luna Health - Android shell

The React app in `frontend/` wrapped with Capacitor 7. The Android project lives here
(`frontend/android`). The application id is currently a placeholder (see `appId` in `frontend/capacitor.config.json`);
see "Deciding the app ID later".

## Tooling

Capacitor 7 needs **JDK 21**. Install JDK 21 (Temurin), the Android SDK and an emulator image
in user space under `.android-tooling/`:

```bash
ANDROID_ACCEPT_LICENSES=yes bash scripts/android/setup-tooling.sh
source scripts/android/env.sh   # exports JAVA_HOME, ANDROID_HOME, PATH
```

## Always build through npm

Build with `npm run android:sync` / `npm run android:debug` from `frontend/`, not a bare
`./gradlew`. The social-login plugin's `capacitor:sync:before` hook rewrites its
`gradle.properties` (providers: Google only, from `plugins.SocialLogin.providers` in
`capacitor.config.json`); after a fresh `npm install` a bare Gradle build fails.

Notes on the project configuration:

- `android/build.gradle` pins `androidx.browser` to 1.8.0 (newer versions need compileSdk 36 /
  AGP 8.9.1+).
- `adjustMarginsForEdgeToEdge: "auto"` in `capacitor.config.json` keeps content clear of the
  system bars on Android 15.
- Screenshots and the recents thumbnail are blocked (`FLAG_SECURE`). Verify on the emulator via
  WebView DevTools or `adb logcat`, not screenshots.

Capacitor logging is off (`"loggingBehavior": "none"` in `capacitor.config.json`) so session tokens never reach logcat; keep it that way.

## Debug build on the emulator

The app page is served from `https://localhost`, so Chromium treats `http://10.0.2.2` (the
emulator's alias for the host) as Mixed Content and blocks it ("Failed to fetch"). Loopback
`http://localhost` is exempt, so forward the emulator's port 8000 to the host with
`adb reverse` and point the app at `localhost`. Real deployments must use an https API.

```bash
source scripts/android/env.sh
cd frontend
REACT_APP_API_BASE=http://localhost:8000/api/v1 \
REACT_APP_GOOGLE_WEB_CLIENT_ID=<web-client-id> npm run android:debug

# start the emulator headless
emulator -avd luna_test -no-window -no-audio -no-snapshot -gpu swiftshader_indirect &
adb wait-for-device
adb reverse tcp:8000 tcp:8000   # lets the app reach the host API at http://localhost:8000
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n <app-id>/.MainActivity
```

Use the real application id in the last command (see `capacitor.config.json`).

## Release keystore

Create a keystore **outside the repository** and back it up. Losing it blocks app updates
unless you use Play App Signing.

```bash
keytool -genkeypair -v -storetype PKCS12 -keystore ~/luna-release.keystore \
  -alias luna -keyalg RSA -keysize 2048 -validity 10000
```

Never commit a keystore or its passwords.

## Release build

Set the signing environment variables (Gradle reads them from the environment, so they are
never printed, written to disk or visible in `ps`; do not run the script with `bash -x`):

| Variable | Meaning |
| --- | --- |
| `LUNA_KEYSTORE` | path to the keystore file |
| `LUNA_KEYSTORE_PASSWORD` | keystore password |
| `LUNA_KEY_ALIAS` | key alias (e.g. `luna`) |
| `LUNA_KEY_PASSWORD` | key password |

```bash
REACT_APP_API_BASE=https://api.example.org \
REACT_APP_GOOGLE_WEB_CLIENT_ID=<web-client-id> \
bash scripts/android/release.sh
```

Output: `frontend/android/app/build/outputs/bundle/release/app-release.aab`.

`release.sh` refuses to build when the app id is still the placeholder, when
`REACT_APP_API_BASE` is not an `https://` URL, or when the signing settings are missing.
`bash scripts/android/release.sh --check-only` runs only the guards, and
`bash scripts/android/test-release-guards.sh` tests them (and the rename script) on temp copies.

## Backend settings

The app is served from the Capacitor origin `https://localhost`, which the backend must allow:

```
ALLOWED_ORIGINS=http://localhost:3000,https://localhost
GOOGLE_ID_TOKEN_AUDIENCES=<web-client-id>
```

## Google sign-in

In Google Cloud Console create a **Web** OAuth client and an **Android** OAuth client (with the
final application id and the signing SHA-1). The **Web client ID** is the value of both
`GOOGLE_ID_TOKEN_AUDIENCES` (backend) and `REACT_APP_GOOGLE_WEB_CLIENT_ID` (web build).

## Email links

A link in an email opens in the browser, not in the app. Log in inside the app afterwards.

## Deciding the app ID later

Until the id is chosen, debug builds use the placeholder id and release builds are refused.
To set the final id:

```bash
bash scripts/android/rename-app-id.sh org.yourorg.luna
cd frontend && npm run android:sync
```

The script validates the id, then updates `capacitor.config.json`, `applicationId` and
`namespace` in `android/app/build.gradle`, the string resources, and the `MainActivity` package
line and directory. Documentation (including this file) is not modified. Afterwards the old placeholder id no longer appears in
any non-Markdown file under `frontend/android` or in `capacitor.config.json` (build outputs excluded). Create the Android OAuth client with the same id and your signing SHA-1.
