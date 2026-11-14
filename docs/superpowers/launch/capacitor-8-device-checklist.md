# Luna Health: phone test for the Capacitor 8 upgrade

For the owner. You need an Android phone and a few minutes per test. You do not need Android
Studio. The upgrade makes the app target Android 16 (API 36), which Google Play now requires. The
robot-checked parts passed in CI; only a real phone can show colours, bars and the keyboard.

## 1. Get the test app (APK)

1. Open the GitHub repository in a browser, then **Actions**.
2. Click the newest run named **Android** on the upgrade branch (pull request #23, branch
   `feat/capacitor-8`). It must have a green tick.
3. Scroll to **Artifacts** and download **luna-debug-apk**. It is a zip file.
4. Unzip it on your computer. Inside is `app-debug.apk`.
5. Move `app-debug.apk` to the phone: USB cable, a cloud drive, or e-mail it to yourself.
6. On the phone, open the file (Files app or the drive app). Android asks to allow installs from
   that app: tap **Settings**, switch on **Allow from this source**, go back, tap **Install**.
   Developer options are not needed. (If you want them anyway: Settings > About phone > tap
   Build number 7 times.)
7. To remove it later: long-press the Luna icon > App info > Uninstall. This deletes its data.

## 2. What works with this test app

This test app is built to talk to a placeholder server address (`https://api.example.com`) that
does not exist. So anything that needs a server cannot work, and that is expected, not a bug.
Tests marked **(needs backend)** need a build pointed at a real server (the Android Studio route
in `frontend/android/README.md`, section "Debug build on the emulator") or wait for the Play
closed test. **Do all the other tests first.** Mark a test you cannot do as "skipped".

## 3. Tests

Use the number as the reference when you report back. Tick one box per test.

**T1. Install over an older test app keeps your data** (needs a previous debug build that
already holds data; on a clean phone, skip and write "skipped").
1. With the older app installed and some data in it, install the new APK over it (step 6 above).
2. Open Luna.
Expected: you are still signed in and your data is still there. You are NOT asked to sign in
again. [ ] pass [ ] fail [ ] skipped

**T2. Launch and splash.**
1. Open Luna from the icon.
Expected: a short purple splash, then the first screen. No white flash, no crash.
[ ] pass [ ] fail

**T3. Top and bottom bars.** Look at the very top (clock and battery) and very bottom of the
screen, on the home screen of the app. Do it once with the phone set to light mode and once to
dark mode (Settings > Display).
Expected: both strips are the app's dark purple, not white or grey, and the clock, battery and
the bottom buttons or gesture line are light-coloured and readable.
[ ] pass [ ] fail

**T4. Bottom menu (dock) and the gesture bar.** Check your navigation mode in Settings > System >
Navigation (gestures, or 3 buttons). Test in the mode you use, then switch to the other and repeat.
Expected: the whole bottom menu is visible above the system bar, nothing is cut off, and every
item can be tapped. [ ] pass [ ] fail

**T5. Pop-ups and drawers.** Open the Day sheet (tap a day), the chat drawer, and any other
pop-up you can find.
Expected: the title and the footer buttons (Save, Close and so on) are fully visible and can be
tapped; nothing hides under the system bars. [ ] pass [ ] fail

**T6. Keyboard over a text box.** Tap the note box in the Day sheet, then the message box in the
chat. Type a few letters.
Expected: the box and the buttons next to it stay visible above the keyboard (the screen lifts or
shrinks; the keyboard never covers what you are typing). Closing the keyboard puts it back.
[ ] pass [ ] fail

**T7. Rotation** (only if your phone auto-rotates; otherwise skip). Turn the phone sideways and back.
Expected: nothing is cut off or stuck, and bars and menu are still correct. [ ] pass [ ] fail [ ] skipped

**T8. Largest text.** Settings > Display > Font size and Display size: set both to the largest.
Open Luna and look at the main screens and the Day sheet.
Expected: text is bigger but nothing important is cut off, and buttons can still be reached.
Set the sizes back afterwards. [ ] pass [ ] fail

**T9. Back button or gesture.** On the first screen of the app, go Back. Then open a nested
screen (for example Profile > a sub-page) and go Back.
Expected: on the first screen the app goes to the background (it does not close and ask
anything); on a nested screen Back returns to the previous screen. [ ] pass [ ] fail

**T10. Disguise icon.** Open Profile (the "Open profile" button at the top), then
**App appearance**. Pick another name and icon and confirm the change.
Expected: the icon and name on the home screen or app list change, and the app still opens from
the new icon. Switch it back to Luna Health at the end. [ ] pass [ ] fail

**T11. Reminder notification.** Profile > **Reminders**. Turn one on (for example "Daily check-in nudge"), allow notifications if asked,
and set the time two minutes ahead. Lock the phone and wait.
Expected: a notification arrives within a few minutes ("Time for your check-in." unless you chose
explicit wording). Delivery can be a few minutes late; that is by design. Android must not open
an "Alarms & reminders" settings screen at any point. [ ] pass [ ] fail

**T12. Share sheet.** Profile > **Privacy & data** > **Download my data** (this may need a signed-in
account: if it needs the backend, mark "skipped"; any other Share button also works).
Expected: the system share sheet opens. [ ] pass [ ] fail

**T13. Buzz.** Tap buttons with phone not on silent, and Quiet mode off.
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

## 5. What to send back

- A screenshot of every failed test (the tests that said "fail" and a line on what you saw).
  Note: Luna blocks screenshots on purpose. If the phone refuses, take a photo of the screen with
  another phone.
- The phone model and Android version: Settings > About phone (model, Android version).
- Whether you did T1, T17 and T18, and which tests you skipped.
