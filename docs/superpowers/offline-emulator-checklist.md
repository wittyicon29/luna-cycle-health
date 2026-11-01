# Offline mode: emulator / device checklist

Run these on an Android emulator or a real phone with a debug build. Use airplane mode (or the emulator's
Extended controls > Cellular/Wi-Fi off) to go offline. Offline caching is native-only; the web build has no offline
behaviour and is not covered here.

Wherever a command shows `<your app ID>`, use the application ID of the build you installed (it is not chosen yet).
Use a throwaway test account. Allow about a minute for background sync, or bring the app to the foreground to force one.

What "good" looks like in the app:

- Status line: the first part of the small summary line on the Today card. Offline shows "Offline"; waiting changes show
  "N change(s) waiting to sync"; both show "Offline · 2 changes waiting to sync". Nothing extra when online and synced.
- Notices: one dismissible line under the summary (see scenario 10). The close button is easy to tap.
- Pending markers: a small clock icon next to the date in the day sheet, and a small mark on calendar days that are
  waiting to sync. They disappear on their own once a background sync has finished (no need to reopen the screen);
  a waiting period turns into the server's period without a second copy.

## 0. Setup

1. Install the build, sign in online, open Home, the Calendar and one day so data is cached.
2. Log at least one period and one check-in online so there is something to compare against.
3. Note the numbers shown on the Today card and in the Calendar (the "before" picture).

## 1. Cold start offline

1. Force-stop the app. Turn on airplane mode.
2. Open the app.
3. Expect: you are still signed in, Home loads, the Calendar and past days show your cached data, the summary line starts
   with "Offline". No error screen, no sign-out.

## 2. Log a period offline

1. Stay offline. Log a new period (start date, optional details).
2. Expect: it appears at once in the list/journey and the Calendar, marked as waiting to sync. The status line shows
   "Offline · 1 change waiting to sync".
3. Delete is not offered for the waiting period.
4. Force-stop and reopen the app (still offline): the period and the count are still there.

## 3. Check-in offline

1. Stay offline. Tap a weather mood on the Today card.
2. Expect: the check-in shows as saved, today's calendar cell shows the waiting mark, the count goes up by one.
3. Tap a different mood the same day: the count does not grow beyond one change for that day, and the last mood wins.

## 4. Save a day offline

1. Open a day from the Calendar, change mood/symptoms/note, save.
2. Expect: it closes as saved; reopening the day shows your edits and the "Waiting to sync" icon beside the date.
3. Clear a day entirely offline and save; it should read as empty and be counted as a waiting change.

## 5. Reconnect and verify no duplicates

1. Turn airplane mode off.
2. Within about a minute (or after bringing the app to the foreground) the "waiting" count falls to nothing and the
   "Offline" part disappears. The pending marks vanish.
3. Verify against the server (web app or API): exactly one period for the one you logged, one entry per day you
   changed with your latest values. No duplicate periods, no doubled check-ins.
4. Repeat with the app killed while offline-then-online mid-sync (turn the network on, force-stop immediately, reopen):
   still no duplicates.

## 6. Sign out with pending changes

1. Go offline, make one change, then open Sign out.
2. Expect: a prompt saying "1 change hasn't synced yet and will be lost if you sign out", with "Stay signed in" and
   "Sign out anyway".
3. Choose "Stay signed in": nothing is lost, the change still syncs later.
4. Choose "Sign out anyway" on a second attempt: you are signed out. Sign in again online: the lost change is not
   resurrected.
5. If the app cannot tell how many changes are waiting, it must ask before signing out and never sign out silently.

## 7. Session expiry

1. With pending changes, let the session expire (revoke the session on the server, or wait for the token to lapse).
2. Expect: you land on the sign-in screen with a message; pending changes are kept for that account.
3. Sign in again as the same user: the waiting changes are sent right away and the count clears.
4. Sign in as a different user instead: the first user's cached data and queue are not visible to the second user.

## 8. Wipe verification after sign-out

After "Sign out anyway" (or a normal sign-out with nothing pending), check the device kept nothing readable.
Run the commands from your computer; `run-as` works only on debug builds.

Primary check (DevTools on the debug WebView):

1. Before signing out: open `chrome://inspect` in desktop Chrome, inspect the app's WebView, and run
   `Object.keys(localStorage).filter(k => k.startsWith('luna_offline_'))`. Expect a list of keys (values are encrypted
   blobs, never readable JSON).
2. Sign out in the app, inspect the WebView again (reopen the inspector if needed) and run the same line.
   Expect `[]`.

Vault key check (the encryption key must be gone too):

```
adb shell "run-as <your app ID> ls shared_prefs"
```

Inspect the secure-storage preferences file listed there (`adb exec-out "run-as <your app ID> cat shared_prefs/<file>.xml"`).
Before sign-out it holds the offline vault key entry; after sign-out that entry must be gone.

Secondary check (readable text only): LevelDB can keep removed keys in its `.log`/`.ldb` files until it compacts, so a
leftover key name here is not by itself a failure. What must never appear is readable account data.

```
adb shell "run-as <your app ID> ls -R 'app_webview/Default/Local Storage'"
adb exec-out "run-as <your app ID> sh -c 'cat app_webview/Default/Local\ Storage/leveldb/*'" | strings | grep luna_offline_
```

`strings` runs on your computer (the second command pipes the raw bytes out of the phone). Expect no email address, note
text or mood values in the output, only opaque encrypted data under key names.

## 9. Session problems while replaying

Rejected refresh (401):

1. Go offline, make two changes, go online.
2. Revoke the session on the server just before reconnecting, so the token refresh is rejected.
3. Expect: you land on the sign-in screen; nothing is dropped. Sign in again as the same user: the two changes are
   replayed and the count clears, with no duplicates on the server.

Paused sync (403 or a storage error):

1. Go offline, make a change, then (on the server or another device) remove a required consent so replaying answers 403
   (or fill the phone's storage so offline writes fail).
2. Go online. Expect the change to stay queued (count unchanged, nothing dropped) and, after a moment, the notice
   "Syncing is paused. We'll keep trying." (a storage failure shows "Couldn't save offline data on this phone.").
3. Dismiss the notice. It must not return on the 60-second timer. It may return after the next forced retry (bring the
   app back to the foreground or toggle airplane mode) if the sync stops on the error again.
4. Fix the cause (restore the consent). The change syncs and the count clears.

## 10. Status line and notices

| Situation | What you should see |
| --- | --- |
| Online, nothing waiting | Normal summary, no extra text, no extra row. |
| Offline | Summary starts with "Offline". |
| 1 / 2+ changes waiting | "1 change waiting to sync" / "2 changes waiting to sync", first in the line. |
| Offline and waiting | "Offline · 2 changes waiting to sync". |
| A change was refused by the server or the queue overflowed | One line: "N change(s) couldn't be saved." with a close button. |
| Stored offline data could not be read | "Offline data couldn't be read, so changes waiting to sync were lost." |
| Phone storage write failed | "Couldn't save offline data on this phone." |
| Sync stuck on an error | "Syncing is paused. We'll keep trying." |

Check each of these:

1. The notice can be dismissed with the close button, and the close button is at least 44 px tall and wide.
2. Dismissing a notice acknowledges only that one: if several are active, the next one appears. A dismissed notice does
   not come back on its own; "Syncing is paused" may come back only after a forced retry (foreground, reconnect) stops on
   an error again, and the others only for a new problem.
3. With a screen reader on, going offline or changing the waiting count is announced once, politely, and only the status
   part is read, not the whole summary line.
4. In Hindi, the same lines are in Hindi and not cut off; the status text is always the first thing in the line.
5. In Quiet appearance mode nothing animates.
