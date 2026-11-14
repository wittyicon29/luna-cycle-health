# Luna Health: phone test for the Capacitor 8 upgrade

For the owner. You need an Android phone and a few minutes per test. You do not need Android
Studio. The upgrade makes the app target Android 16 (API 36), which Google Play now requires. The
robot-checked parts passed in CI; only a real phone can show colours, bars and the keyboard.

## 1. Get the test app (APK)

1. Open the GitHub repository in a browser, then **Actions**.
2. Click the newest run named **Android** on the upgrade branch (the Capacitor 8 PR, branch
   `feat/capacitor-8`). It must have a green tick.
3. Scroll to **Artifacts** and download **luna-debug-apk**. It is a zip file.
4. Unzip it on your computer. Inside is `app-debug.apk`.
5. Move `app-debug.apk` to the phone: USB cable, a cloud drive, or e-mail it to yourself.
6. On the phone, open the file (Files app or the drive app). Android asks to allow installs from
   that app: tap **Settings**, switch on **Allow from this source**, go back, tap **Install**.
   Developer options are not needed for this. (They are needed for section 2b.)
7. To remove it later: long-press the Luna icon > App info > Uninstall. This deletes its data.

Test apps are signed with a fixed, public test key (it is in the repository on purpose and is
never used for the Play release). An APK from a later run therefore installs over an earlier one.
That only holds for APKs built after the key was added: an older test APK has a different key, so
Android refuses to install over it ("App not installed"). Uninstall the old one first; its data is
lost.

## 2. What works with the stock test app

The APK from an ordinary run talks to a placeholder server address (`https://api.example.com`)
that does not exist. You can see the landing screen and the sign-in screens, but you cannot sign
in. Anything past sign-in cannot work, and that is expected, not a bug.

With the stock APK, do only these: installing it (section 1), **T2**, **T3** (on the landing
screen), **T6** (keyboard in the sign-in fields), **T7**, **T8** (landing screen), **T9** (Back
from the sign-in screen and from the Privacy and Terms pages), and **T19**. Every other test is
marked **(needs backend)**: do it with a build from section 2b, or mark it "skipped".

## 2b. Testing the signed-in app

This route needs a computer running the app's backend and a phone connected to it with `adb`.

**Why not over plain Wi-Fi?** The app page runs at `https://localhost` and refuses plain-http
calls to any other address (Chromium blocks them as mixed content). Only `http://localhost` is
allowed, so the phone's port 8000 is forwarded to the computer with `adb reverse`, over a USB
cable or over Wi-Fi with Android's wireless debugging. Details: `frontend/android/README.md`,
"Debug build on the emulator" (the same rule applies to a phone).

1. **Backend on the computer.** Follow "Local Setup > 1) Backend" in the repository `README.md`
   (it needs PostgreSQL and Redis): create the venv, `pip install -r requirements-dev.txt`,
   `cp .env.example .env`, edit `backend/.env`, then from the project root
   `uvicorn app.main:app --reload --app-dir backend`. In `backend/.env`, add the app's origin
   to `ALLOWED_ORIGINS`, as `frontend/android/README.md` ("Backend settings") says:
   `ALLOWED_ORIGINS=http://localhost:3000,https://localhost`. Check
   <http://localhost:8000/docs> opens on the computer.
2. **adb on the computer.** `ANDROID_ACCEPT_LICENSES=yes scripts/android/setup-tooling.sh`
   installs it under `.android-tooling/`, then `source scripts/android/env.sh`.
3. **Connect the phone.** On the phone, turn on Developer options (Settings > About phone > tap
   Build number 7 times), then **USB debugging**, plug in the cable and accept the prompt.
   (Wireless instead: phone and computer on the same Wi-Fi, Developer options > **Wireless
   debugging** > Pair device with pairing code, then `adb pair <ip:port>` and
   `adb connect <ip:port>` with the addresses the phone shows.) `adb devices` must list the phone.
4. **Forward the port:** `adb reverse tcp:8000 tcp:8000`. Repeat it after every reconnect.
5. **Build an APK for that server.** On GitHub: **Actions** > **Android** > **Run workflow**,
   branch `feat/capacitor-8`, **api_base** = `http://localhost:8000/api/v1`, then **Run
   workflow**. When the run is green, download **luna-debug-apk** as in section 1. Debug builds
   may use plain http to `localhost` (`frontend/android/app/src/debug/AndroidManifest.xml`);
   release builds cannot.
6. Install it (section 1, or `adb install -r app-debug.apk`) and open Luna.

Limits of this setup, said plainly:
- **Google sign-in will not work** (it needs the app's Google client set up for this build).
- **E-mail sign-up may not complete.** The account is finished through a link in a
  verification e-mail that opens the web page, and neither e-mail sending nor the web page is set
  up locally. Signing in needs an account that already exists and is verified in the local
  database. The repository has no seed script or documented way to create such a test user yet:
  that is an **open item** for the engineer.
- Billing (T16) also needs a build in test billing mode.

## 3. Tests

Use the number as the reference when you report back. Tick one box per test.

**T1. Install over an older test app keeps your data (needs backend).** Only possible after two
installs that both use the fixed test key (section 1): the first one signed in with some data,
then a newer APK installed over it. Test APKs from before the key was added cannot be updated
this way; on a phone that only had those, skip and write "skipped".
1. With the older app installed and some data in it, install the new APK over it (step 6 above).
2. Open Luna.
Expected: you are still signed in and your data is still there. You are NOT asked to sign in
again. [ ] pass [ ] fail [ ] skipped

**T2. Launch and splash.**
1. Open Luna from the icon.
Expected: a short purple splash, then the first screen. No white flash, no crash.
[ ] pass [ ] fail

**T3. Top and bottom bars.** Look at the very top (clock and battery) and very bottom of the
screen, on the landing screen (with a signed-in build, also on the app's home screen). Do it once with the phone set to light mode and once to
dark mode (Settings > Display).
Expected: both strips are the app's dark purple, not white or grey, and the clock, battery and
the bottom buttons or gesture line are light-coloured and readable.
[ ] pass [ ] fail

**T4. Bottom menu (dock) and the gesture bar (needs backend).** Check your navigation mode in Settings > System >
Navigation (gestures, or 3 buttons). Test in the mode you use, then switch to the other and repeat.
Expected: the whole bottom menu is visible above the system bar, nothing is cut off, and every
item can be tapped. [ ] pass [ ] fail

**T5. Pop-ups and drawers (needs backend).** Open the Day sheet (tap a day), the chat drawer, and any other
pop-up you can find.
Expected: the title and the footer buttons (Save, Close and so on) are fully visible and can be
tapped; nothing hides under the system bars. [ ] pass [ ] fail

**T6. Keyboard over a text box.** With the stock APK: tap the e-mail and password fields on the
sign-in screen. With a signed-in build, also the note box in the Day sheet and the message box in
the chat. Type a few letters.
Expected: the box and the buttons next to it stay visible above the keyboard (the screen lifts or
shrinks; the keyboard never covers what you are typing). Closing the keyboard puts it back.
[ ] pass [ ] fail

**T7. Rotation** (only if your phone auto-rotates; otherwise skip). Turn the phone sideways and back.
Expected: nothing is cut off or stuck, and bars and menu are still correct. [ ] pass [ ] fail [ ] skipped

**T8. Largest text.** Settings > Display > Font size and Display size: set both to the largest.
Open Luna and look at the landing and sign-in screens (with a signed-in build, also the main
screens and the Day sheet).
Expected: text is bigger but nothing important is cut off, and buttons can still be reached.
Set the sizes back afterwards. [ ] pass [ ] fail

**T9. Back button or gesture.** On the first screen of the app, go Back. Then open a nested
screen (with the stock APK: the sign-in screen, or the Privacy or Terms page; with a signed-in
build also Profile > a sub-page) and go Back.
Expected: on the first screen the app goes to the background (it does not close and ask
anything); on a nested screen Back returns to the previous screen. [ ] pass [ ] fail

**T10. Disguise icon (needs backend).** Open Profile (the "Open profile" button at the top), then
**App appearance**. Pick another name and icon and confirm the change.
Expected: the icon and name on the home screen or app list change, and the app still opens from
the new icon. Switch it back to Luna Health at the end. [ ] pass [ ] fail

**T11. Reminder notification (needs backend).** Profile > **Reminders**. Turn one on (for example "Daily check-in nudge"), allow notifications if asked,
and set the time two minutes ahead. Lock the phone and wait.
Expected: a notification arrives within a few minutes ("Time for your check-in." unless you chose
explicit wording). Delivery can be a few minutes late; that is by design. Android must not open
an "Alarms & reminders" settings screen at any point. [ ] pass [ ] fail

**T12. Share sheet (needs backend).** Profile > **Privacy & data** > **Download my data** (any
other Share button also works).
Expected: the system share sheet opens. [ ] pass [ ] fail

**T13. Buzz (needs backend).** Tap buttons with phone not on silent, and Quiet mode off.
Expected: a light buzz on taps. [ ] pass [ ] fail [ ] skipped (phone cannot buzz)

**T14. Sign-in with e-mail and with Google (needs backend).**
Expected: you reach the app after signing in. [ ] pass [ ] fail [ ] skipped

**T15. Log offline, then sync (needs backend).** Sign in, switch on airplane mode, log a day,
switch it off.
Expected: the entry is kept and syncs when the network returns. [ ] pass [ ] fail [ ] skipped

**T16. Billing sheet (needs backend).** Needs a build in test billing mode. Open the paywall.
Expected: the Luna AI plan appears with its price and the Google Play sheet opens. [ ] pass [ ] fail [ ] skipped

## 4. Extra passes (only if you have the device)

**T17. An older phone or emulator, Android 14 or older.** Repeat T2, T3, T5 and T6.
Expected: status and bottom bars are purple with readable icons, no white or grey band, and the
keyboard does not cover the text box. [ ] pass [ ] fail [ ] skipped (no such device)

**T18. Android 15 or newer with 3-button navigation** (Settings > System > Navigation).
Android may draw a faint see-through shade behind the three buttons. That is cosmetic.
Expected: the bottom strip looks purple or only slightly shaded. If it looks wrong, send a
screenshot; the fix (an `enforceNavigationBarContrast=false` setting in a `values-v29` folder) is a
decision for the owner and the engineer after seeing the picture.
[ ] pass [ ] fail [ ] skipped

**T19. Android version (all phones).** Settings > About phone > Android version: write it down.
If it is **Android 16**, also do this with the back *swipe* (gesture navigation): swipe back on
the first screen, then on a nested screen.
Expected: the same as T9 (first screen: the app goes to the background; nested screen: back to
the previous screen). [ ] pass [ ] fail [ ] not Android 16

## 5. What to send back

- A screenshot of every failed test (the tests that said "fail" and a line on what you saw).
  Note: Luna blocks screenshots on purpose. If the phone refuses, take a photo of the screen with
  another phone.
- The phone model and Android version: Settings > About phone (model, Android version).
- Whether you did T1, T17 and T18, which tests you skipped, and whether you used the stock APK
  or a section 2b build.
