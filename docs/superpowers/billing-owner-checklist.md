# Luna AI plan billing: owner checklist

Everything here is done by the owner in Google Play Console, the server environment and a test phone. No ids,
secrets or addresses are stored in this repo: wherever you see `<your app ID>`, `<service account file path>` or
`<license tester account>`, use your own value. The app ID is not chosen yet.

## 0. Facts to know first

1. The Android plugin reports no billing period. The app guesses the period from the Play **base plan ID**, so name base
   plans `monthly` / `yearly` (or `p1m` / `p1y`). A plan whose id the app cannot map is NOT offered.
2. The plugin buys the first Play offer for the base plan and cannot choose an offer token. The offers come back in
   the same order Play uses for the purchase, so the app reads the **first** entry of each base plan:
   - the base plan first: its regular price is shown, with no trial line (a later free offer would not be applied);
   - a free-trial offer first: "Free trial available" plus the regular price;
   - a paid introductory offer first: the plan is dropped from the paywall (not offered), because the app cannot
     show the intro price truthfully.
   For a free trial, create a single new-customer-eligible trial offer on the base plan, and test which offer Play
   applies.
3. The app never acknowledges purchases itself. The server acknowledges within 3 days, or Google refunds the purchase.
4. A user cancel and a Play failure look identical to the app: it shows the neutral "The purchase wasn't completed."
5. minSdk is now 24 (Android 7.0). Phones older than that cannot install the app.
6. `BILLING_ACCOUNT_SECRET` must be set once before launch and never changed. `APP_ENV` must be set in production.
7. The server's `/billing/status` is cache-only (it never calls Google). `/billing/refresh` is authoritative.
8. Rollback is `BILLING_MODE=off` (see section 7).

## 1. Play Console

1. Create the app in Play Console with `<your app ID>` (it cannot be changed later).
2. Complete the store listing, content rating, target audience (18+) and the declarations Play asks for.
3. Create the subscription products:
   - `luna_ai_monthly` with one base plan whose id is `monthly` (or `p1m`).
   - `luna_ai_yearly` with one base plan whose id is `yearly` (or `p1y`).
4. Set INR pricing on every base plan (add other regions only if you want them). Activate the base plans.
5. Optional free trial: add ONE offer to the base plan, eligibility "new customer acquisition", phase type free trial.
   Do not add several offers to a base plan: the plugin buys the first one. Install a test build and check which offer
   Play applies.
6. Upload a build to the **internal testing** track; add testers by email list in Play Console.
7. Add each tester under Setup > License testing as a `<license tester account>`.

## 2. Service account and API access

1. In Google Cloud, create a service account for the app. Create a JSON key and store it outside the repo.
2. Enable the Google Play Android Developer API for that project.
3. In Play Console > Users and permissions (or Setup > API access), invite the service account and grant it the
   permissions to view financial data and manage orders and subscriptions for this app.
4. Expect permission changes to take some time to apply before verification calls succeed.

## 3. Server environment

Set these on the server (never in git). Billing turns on with `BILLING_MODE=google`:

| Variable | Value |
| --- | --- |
| `BILLING_MODE` | `google` |
| `GOOGLE_PLAY_PACKAGE_NAME` | `<your app ID>` |
| `BILLING_PRODUCT_IDS` | `luna_ai_monthly,luna_ai_yearly` |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_FILE` | `<service account file path>` |
| `BILLING_ACCOUNT_SECRET` | a long random value, set once and NEVER changed |
| `APP_ENV` | `production` |

Changing `BILLING_ACCOUNT_SECRET` later breaks the link between existing purchases and accounts. Keep a copy in your
secret manager.

## 4. Grace period check (do this before launch)

When a renewal payment fails Play puts the subscription in `IN_GRACE_PERIOD`. With a license tester and a test card that
declines, verify that Google extends `expiryTime` during the grace period. If it does not, users in grace lose access at
the original expiry. Record the result here and decide whether to change the server before launch.

## 5. Play requirements

### Subscription disclosure checklist

- [ ] The paywall shows the price and billing period from Play (it does) and says the plan renews automatically until
      cancelled.
- [ ] It says how to cancel (Google Play, Manage subscription).
- [ ] When the first Play offer of the base plan is the free trial, the paywall shows "Free trial available" and the
      regular price. It cannot show the trial length (the plugin does not report it); Play's own purchase sheet shows
      the binding trial terms before payment. If the base plan is listed first, no trial line is shown. A plan whose
      first offer is a paid introductory offer is not offered at all (see section 0, item 2).
- [ ] Cycle tracking is free and works without the plan; the plan only adds Insights and Chat.
- [ ] Privacy Policy and Terms mention the plan (they do) and are linked in the store listing.
- [ ] The Play listing description does not promise features the plan does not include.

### Release build: strip the plugin's token logs (REQUIRED before uploading a release)

The billing plugin (`ee.forgr.nativepurchases.NativePurchasesPlugin`, 7.19.3) writes purchase tokens to logcat with
`Log.d` / `Log.i`, and the release build currently has `minifyEnabled false`, so those calls ship. This was NOT changed
in the repo because no Android SDK was available to build and test a minified release. Before the first release:

1. In `frontend/android/app/build.gradle`, in `buildTypes { release { ... } }`, set:

   ```gradle
   minifyEnabled true
   proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
   ```

   Use `proguard-android-optimize.txt`, not `proguard-android.txt`: the plain file disables optimisation, and
   `-assumenosideeffects` then has no effect.
2. Append to `frontend/android/app/proguard-rules.pro`:

   ```proguard
   # Strip debug/info/verbose logging (the billing plugin logs purchase tokens).
   -assumenosideeffects class android.util.Log {
       public static int d(...);
       public static int i(...);
       public static int v(...);
   }

   # Capacitor bridge and plugins (Capacitor also ships consumer rules; these are belt and braces).
   -keep public class * extends com.getcapacitor.Plugin
   -keep @com.getcapacitor.annotation.CapacitorPlugin public class * {
       @com.getcapacitor.annotation.PluginMethod public <methods>;
       @com.getcapacitor.PluginMethod public <methods>;
   }
   -keep class com.getcapacitor.** { *; }
   -keepclassmembers class * {
       @android.webkit.JavascriptInterface <methods>;
   }

   # The billing plugin (called by name from the bridge).
   -keep class ee.forgr.nativepurchases.** { *; }
   ```
3. Build the release (`./gradlew assembleRelease` or the bundle) and, on a license-tester phone with
   `adb logcat | grep -i NativePurchases`, buy and restore: no purchase token may appear. Then run the manual test
   script in section 6 on that minified build (sign-in with Google, reminders, offline sync, billing), because R8 can
   break reflection-based code that is not kept.

### Data safety form

- Data types: **Purchase history** (and purchase tokens). Collected: yes.
- Purpose: **app functionality** (unlocking the AI features). Not used for advertising or analytics.
- Shared with third parties: **no**.
- Encrypted in transit: **yes**. Encrypted at rest: **yes** (the purchase token is stored encrypted).
- Users can request deletion: **yes** (Profile > Privacy & data > Delete my account, and the web deletion page).
- Card or UPI details: not collected (Google Play handles payment).

### Follow-ups for the owner

- [ ] `PRIVACY_POLICY_VERSION` was NOT changed in this release. Decide whether the new purchase paragraphs need users to
      consent again; if so, bump it in a separate change.
- [ ] Have a native Hindi reviewer check the new Hindi strings (see `frontend/src/i18n/hi-review.md`). The Privacy
      Policy and Terms pages stay English-only, as before.
- [ ] Legal review of the new Privacy Policy and Terms paragraphs.

## 6. Manual test script

Use a license tester on an internal-testing build. Test subscriptions renew on a short schedule, so a day passes in
minutes. Tick each line.

1. **Buy.** Free account, open Insights, Subscribe to the monthly plan with a test payment method. Expect the plan to
   unlock, Profile shows "Active until ...".
2. **Cancel.** Profile > Manage subscription > cancel in Play. Expect the plan to stay active until the end date, then
   return to free.
3. **Resubscribe.** After it ends, buy again. Expect it to unlock again.
4. **Refund.** Refund or revoke the test order in Play Console. Expect access to end after the next refresh (open the
   app, or Restore purchases).
5. **Grace period.** Use the test payment methods that decline on renewal ("test card, always declines"). Expect
   access to continue during grace (see section 4) and to end after the grace period.
6. **App killed mid-purchase.** Start a purchase, force-stop the app while the Play sheet or the check is running,
   reopen it. Expect the plan to unlock (or Restore purchases to unlock it) without being charged twice.
7. **Restore on a second device.** Sign in with the same Luna account on a second phone with the same Google account;
   tap Restore purchases. Expect the plan to unlock.
8. **Account switch on one phone.** Buy on Luna account A, sign out, sign in as Luna account B on the same phone.
   Expect B to be on the free plan and not to inherit A's purchase; A still has the plan after signing back in.
9. **Offline paywall.** Turn on airplane mode and open the paywall. Expect "You're offline. Connect to the internet to
   subscribe." and no purchase starts.
10. **Failure and cancel.** Cancel at the Play sheet. Expect "The purchase wasn't completed." and no crash.
11. **Delete account with an active plan.** Expect the notice that deleting the account does not cancel the Google Play
    subscription, with a Manage subscription button that opens Play.

## 7. Rollback

Set `BILLING_MODE=off` and restart the server. The AI features open for everyone again and the plan screens disappear
from the app. Existing Play subscriptions are not cancelled: tell paying users, and cancel or refund them in Play
Console if needed.
