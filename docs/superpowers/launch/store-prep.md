# Luna Health: Google Play store preparation

What to enter in Google Play Console for the first release, and what has to be true in the product
before those answers are honest. Every statement about the product was checked against the code
on `main` at commit `73a0733` (file references are given). Every statement about Google Play was
checked on **2026-11-10** against the source linked next to it; Play changes its forms often, so
where the exact wording of a question could not be seen without a Play Console login, the text
says **verify in the console**.

This document does not change any code. Items that need a code change are collected in
[7.3 Must be finished in code first](#73-must-be-finished-in-code-first).

Placeholders: `<app ID>` (not chosen yet, see the owner setup guide), `api.example.com` (API
domain), `app.example.com` (web frontend domain), `support@example.com` (support address),
`<developer name>` (as it will appear on Google Play).

Companion documents: [`owner-setup-guide.md`](owner-setup-guide.md) (accounts, keys, hosting),
[`../billing-owner-checklist.md`](../billing-owner-checklist.md),
[`../offline-emulator-checklist.md`](../offline-emulator-checklist.md),
[`../runbook.md`](../runbook.md).

## Contents

1. [Data safety form](#1-data-safety-form)
2. [Other App content declarations](#2-other-app-content-declarations)
3. [Account deletion: in-app path and web resource](#3-account-deletion-in-app-path-and-web-resource)
4. [Privacy policy: changes needed for Play](#4-privacy-policy-changes-needed-for-play)
5. [Store listing copy, graphics and categories](#5-store-listing-copy-graphics-and-categories)
6. [Permissions rationale](#6-permissions-rationale)
7. [Pre-launch checklist](#7-pre-launch-checklist)
8. [Sources](#8-sources)

---

## 1. Data safety form

Source for the definitions used below: Play Console Help, "Provide information for Google Play's
Data safety section" (<https://support.google.com/googleplay/android-developer/answer/10787469>,
checked 2026-11-10). Key definitions from that page:

- **Collect** = data transmitted off the device by the app (including its libraries and WebView).
  Data processed only on the device is not collected.
- **Share** = transfer of collected data to a third party. Not sharing: transfers to a **service
  provider** that processes the data only on your behalf; transfers the user initiates or
  consents to after a prominent disclosure; legal transfers; fully anonymised data.
- **Ephemeral processing** (held in memory only for the request) is still answered in the form but
  not shown on the listing.
- **Optional** only if every user can avoid that collection; data needed for the primary function
  is **required**.

### 1.1 What the app actually transmits (facts the answers rest on)

| Data | Where it goes | Stored? | Code |
| --- | --- | --- | --- |
| Email address, password (stored only as a bcrypt hash, `backend/app/core/security.py`), consent records with policy version and date | Luna API | Yes, until account deletion | `backend/app/models/models.py` (`User`, `ConsentRecord`), `backend/app/services/consent_service.py` |
| Google ID token (Google sign-in). The plugin requests the `email` and `profile` scopes, so the token can carry name and picture URL; the server reads only the email | Luna API | Email only | `frontend/src/nativeGoogle.js`, `backend/app/services/google_id_token.py` |
| Period records: start/end date, cycle length, flow, pain level, symptoms, note | Luna API | Yes. Note encrypted at rest (Fernet column); dates, flow, pain, symptoms are not column-encrypted | `models.py` `Period` |
| Daily logs: mood 1-5, symptoms, flow, sleep hours, water glasses, medications taken, note | Luna API | Yes, whole entry encrypted at rest | `models.py` `DailyLog`, `schemas.py` `DailyLogData` |
| Medication names | Luna API | Yes, encrypted | `models.py` `Medication` |
| Health profile (questionnaire): age (18-100), biological sex, weight, height, last period date, cycle pattern, bleeding volume, products per day, clots, intermenstrual bleeding, pain and PMS answers, optional free-text notes | Luna API | Yes, encrypted | `backend/app/schemas/simplified_questionnaire.py`, `models.py` `Questionnaire` |
| AI analyses (generated text and scores) | Luna API | Yes; `llm_response` and `input_data` encrypted, structured fields (predictions, insights, risk flags, score) not column-encrypted | `models.py` `Analysis` |
| Chat messages (user question and AI reply) | Luna API, then AI provider (see 1.3) | Yes, encrypted | `models.py` `ChatMessage`, `backend/app/api/chat.py` |
| Play purchase token, product id, state, expiry | Luna API (verified with Google Play Developer API) | Yes; token encrypted, plus a SHA-256 hash for lookup | `models.py` `Subscription` |
| Refresh-token hashes | Luna API | Yes, until account deletion | `models.py` `RefreshToken` |
| Client IP address and request path | Caddy access log (stdout, JSON); request headers, query `code`/`token` and bodies are dropped | Docker log, **no rotation configured** | `deploy/Caddyfile`, `deploy/compose.prod.yml` |
| Reminder preferences, discreet-mode choice, offline cache and outbox | **Device only** (offline cache encrypted with a key in Android secure storage) | Not collected | `frontend/android/README.md` "Reminders", `frontend/src/offline/vault.js` |

Not present in the app (checked in `frontend/package.json` and the manifest): no ads SDK, no
analytics SDK, no crash-reporting SDK, no location, contacts, camera, microphone or files access.
`reportWebVitals()` is called without a handler, so nothing is sent. Web fonts are self-hosted
(PR #20), so no font request goes to Google.

### 1.2 Answers, question by question

The form is filled under **Policy > App content > Data safety**. The question order below follows
the Help Center article; exact wording **verify in the console**.

| # | Question | Answer | Notes |
| --- | --- | --- | --- |
| 1 | Does your app collect or share any of the required user data types? | **Yes** | |
| 2 | Is all of the user data collected by your app encrypted in transit? | **Yes** | The API is HTTPS only (Caddy, HSTS); `android:usesCleartextTraffic="false"`; `scripts/android/release.sh` refuses a non-`https://` API base. |
| 3 | Account creation methods | **Username/email and password**, **OAuth: Sign in with Google** | Wording of the options: verify in the console. |
| 4 | Account deletion URL | `https://api.example.com/account-deletion` (or the web frontend page, see [section 3](#3-account-deletion-in-app-path-and-web-resource)) | The page exists in code but its text must be corrected first. |
| 5 | Can users request deletion of some data without deleting the account? | **Yes** (optional to answer) | Individual periods, day logs and medications can be deleted in the app (`DELETE /periods/{id}`, `/logs/{date}`, `/medications/{id}`), AI consent can be withdrawn. Chat history has no separate delete: verify before claiming "chat history" here. |
| 6 | Do you provide a way for users to request that their data is deleted? | **Yes** | In-app: Profile → Privacy & data → Delete my account. Web: deletion page. |
| 7 | Independent security review (MASA) | **No** | Optional, paid. |
| 8 | UPI badge (India) | **Not applicable** | Payments go through Google Play billing. |

**Data types.** Answer "Collected" and "Shared" per type. "Shared" for the AI-related rows depends
on an owner decision, see [1.3](#13-owner-decision-are-the-ai-providers-shared-or-service-providers).

| Category > type | Collected | Shared | Ephemeral | Required / optional | Purposes | Basis |
| --- | --- | --- | --- | --- | --- | --- |
| Personal info > Email address | Yes | No (the SMTP provider sends verification/reset mail on our behalf: service provider) | No | Required | Account management, App functionality | Sign-up, verification, password reset |
| Personal info > User IDs | Yes | No | No | Required | Account management, App functionality | Server account id; a keyed hash of it is passed to Google Play as the obfuscated account id at purchase (user-initiated) |
| Personal info > Name | **Decision**: Yes if the `profile` scope stays (then mark it ephemeral and optional), No if engineering drops the scope | No | Yes | Optional (Google sign-in only) | Account management | The ID token may carry the name; it is never stored |
| Personal info > Other info | Yes (age, biological sex in the health profile) | **See 1.3** (sent to Hugging Face for Insights) | No | Optional, if the health profile can be skipped: **verify in the app** that onboarding can be completed without it | App functionality, Personalization | Questionnaire |
| Health and fitness > Health info | Yes | **See 1.3** | No | **Required** (cycle logging is the core function) | App functionality, Personalization | Periods, daily logs, symptoms, mood, sleep, water, medications, notes, health profile, analyses |
| Health and fitness > Fitness info | No | | | | | Sleep hours and water are declared under Health info |
| Financial info > Purchase history | Yes | No | No | Optional (subscribers only) | App functionality | Purchase token and plan status |
| Financial info > User payment info | No | | | | | Card/UPI details stay with Google Play |
| Messages > Other in-app messages | Yes (chat with Luna AI) | **See 1.3** (sent to Groq) | No | Optional (AI consent and plan) | App functionality | Chat history is stored encrypted |
| App activity > Other user-generated content | Yes (free-text notes in periods, day logs, health profile) | **See 1.3** (the health-profile note is sent to Hugging Face; period and day-log notes are not sent to any AI provider) | No | Optional | App functionality | Declared separately from Health info to be safe |
| App activity > App interactions | **Decision**, recommended **No** | No | | | | No analytics. Caddy logs IP + path for security only; keep it that way and rotate logs (see 7.3). If logs are kept long or linked to accounts, revisit. |
| App info and performance > Crash logs / Diagnostics | **No** while `SENTRY_DSN` is empty (default). **Decision** if Sentry is enabled | No (Sentry/GlitchTip would be a service provider) | | | | Server-side only and scrubbed to exception class, stack frames and request id (`backend/app/core/error_reporting.py`). The app itself ships no crash SDK. If enabled, the conservative answer is Diagnostics = collected, not shared, required, purpose App functionality; decide with legal review. |
| Device or other IDs | No | | | | | No advertising id use (check the merged manifest for `AD_ID`, see section 6) |
| Location, Contacts, Calendar, Photos and videos, Audio, Files and docs, Web browsing, Installed apps, Search history | No | | | | | The data export file is written on the device and shared by the user via the share sheet: user-initiated, not collection |

### 1.3 Owner decision: are the AI providers "shared" or service providers?

Exactly what leaves the server when (and only when) the user has granted the `ai_processing`
consent (enforced server-side by `require_plan("ai")` → `require_consent("ai_processing")` in
`backend/app/api/billing.py`, also when `BILLING_MODE=off`):

**Chat** (`POST /api/v1/chat/ask`, `backend/app/api/chat.py`) → **Groq** (`api.groq.com`, model
`QWEN_MODEL`, default `qwen/qwen3-32b`):

- the user's message (max 1000 characters);
- because the app always sends `include_context: true` (`frontend/src/App.js`), a context block:
  average cycle length, cycle variation, health score, next predicted period date, number of
  cycles tracked; from the latest health profile: age, pain severity, whether PMS interferes
  with daily life; from the latest analysis: up to two health insights, the risk flags (AI-flagged
  risk factors) and the cycle health score. (The code also tries to send BMI, but
  `backend/app/api/chat.py` reads a property that is not stored, so Groq always receives
  "BMI: N/A"; weight and height are not sent by chat.)
- Not sent: email, account id, name, previous chat messages, period or day-log notes,
  medication names.

**Insights** (`POST /api/v1/analysis/`, `backend/app/services/llm_service.py`
`analyze_cycle_health`):

1. → **Hugging Face** (`api-inference.huggingface.co/models/<MEDGEMMA_MODEL>`, default
   `google/medgemma-1.5-4b-it`): cycle statistics, prediction range and confidence, up to the six
   latest periods (start/end date, cycle length, flow, pain level, symptoms; **not** notes), and
   the **complete latest health profile JSON**, including age, biological sex, weight, height,
   all symptom answers and the optional free-text note (this input is also stored, encrypted, as
   `Analysis.input_data`).
2. → **Groq**: the Hugging Face result, the health-score breakdown, statistics, prediction range,
   confidence and probabilistic notes (no raw period records, no profile).

The in-app consent text (`frontend/src/AiConsentModal.js`) says "your messages, a summary of
your recent cycle data and your health profile". For Insights, "summary" understates what is
sent (the last six period records and the whole profile including the free-text note): see
[4.2](#42-proposed-replacement-sections) for clearer wording.

**The choice.**

- *Option A, declare as shared* (Health info, Other info, Other in-app messages, Other
  user-generated content: Shared = Yes, purpose App functionality). The listing then shows
  "Data shared with third parties". Always accurate.
- *Option B, declare as not shared* using the service-provider exception. Only defensible if the
  provider contractually processes the data only on Luna's behalf (no training, limited
  retention). Groq's own data page (<https://console.groq.com/docs/your-data>, checked 2026-11-10)
  says Groq does not retain inference data by default, may log inputs/outputs up to 30 days for
  reliability or abuse investigation unless Zero Data Retention is enabled, and stores customer
  data in Google Cloud buckets in the United States; it does not state the training position on
  that page. The Hugging Face side is less clear: see the endpoint concern in 7.3 (the request
  may be routed to a third-party inference provider with its own terms).

**Recommendation: Option A at launch.** Over-disclosure is never a policy violation; an
inaccurate "not shared" is. Revisit once both providers' data-processing terms are confirmed in
writing (enable Groq Zero Data Retention either way).

---

## 2. Other App content declarations

All under **Policy > App content** in Play Console.

### 2.1 Privacy policy

- URL on a public page without login (Play Console Help, "Prepare your app for review",
  <https://support.google.com/googleplay/android-developer/answer/9859455>, checked 2026-11-10).
- Candidate: `https://app.example.com/privacy` (React route in `frontend/src/AppRouter.js`).
  **Blocker:** the production stack in `deploy/` serves only the API; the web frontend is not
  hosted anywhere yet. The same hosting is needed for `/verify-email` and `/reset-password`, which
  the verification and reset e-mails link to (`FRONTEND_URL`, `backend/app/api/email_verification.py`,
  `backend/app/services/auth_service.py`). See 7.3.
- It must also be reachable in the app: it is (Profile → Privacy & data → Privacy Policy link,
  `frontend/src/PrivacyPanel.js`).
- The Health Content and Services policy additionally requires the policy link in the designated
  Play Console field and in the app, and a comprehensive disclosure of health data handling
  (<https://support.google.com/googleplay/android-developer/answer/16679511>, checked 2026-11-10).

### 2.2 App access (sign-in details for reviewers)

All features sit behind a login, so instructions are required (answer/9859455 above; up to five
sets of instructions). Account requirements found in the code:

- Email/password login is refused until the address is verified (`backend/app/api/auth.py`), so
  create the reviewer account in advance with a mailbox you control and click the verification
  link.
- Complete onboarding once (consents, optionally the health profile) and log 3-4 past periods so
  the calendar, predictions and Insights have data (Insights returns "insufficient data" without
  periods).
- **Paid features:** with `BILLING_MODE=google` the reviewer needs an active Luna AI plan to reach
  Insights and Chat. The code has no way to grant a plan to a specific account. Choose one (owner
  decision, see 7.3): a Play promotional code for the subscription (availability and flow:
  **verify in the console**), or a small server-side reviewer allowlist (code change), or explain
  that the paid features are reached through the normal purchase flow.

Draft text for the "Any other instructions" field:

```text
Sign in with email and password (fields on the first screen):
  Email: <reviewer-account>@example.com
  Password: <password>
The account is verified and already contains sample cycle data.

Main areas: Today (home), Calendar (tap a day to log mood, symptoms, flow and a note),
Profile (avatar button) > Privacy & data (download data, delete account, AI consent),
Profile > Reminders, Profile > App appearance (discreet mode: changes the launcher icon and
name to a neutral one; this is documented in the store description).

AI features (Insights and Chat) are optional, need the user's explicit AI consent and the
Luna AI plan subscription. <How the reviewer gets the plan.>

Screenshots are blocked inside the app on purpose (FLAG_SECURE) to protect health data.
```

### 2.3 Ads

**No.** No ads SDK in `frontend/package.json`, nothing in the manifest.

### 2.4 Advertising ID

Apps targeting API 33+ must declare whether they use the advertising ID (form under App content;
**verify in the console**). Answer **No**. Before answering, check the merged manifest of the
release build for `com.google.android.gms.permission.AD_ID`; if a library adds it, remove it with
`tools:node="remove"` (code change) so the declaration matches. The Facebook SDK (the usual
`AD_ID` source) is excluded only when building through `npm run android:sync` (the social-login
hook writes `socialLogin.facebook.include=false`); never build a release with a bare `./gradlew`.

### 2.5 Content rating (IARC questionnaire)

Policy: every app needs an IARC rating from the questionnaire
(<https://support.google.com/googleplay/android-developer/answer/9898843>, checked 2026-11-10).
The individual questions are only visible in the console; the answers below are for the topics
the questionnaire is known to cover. **Verify each question's wording in the console.**

| Topic | Answer | Why |
| --- | --- | --- |
| Category | "Utility, Productivity, Communication, or Other" (category names: verify in the console) | Personal tracker, not a game, not social |
| Violence, fear, blood | No | |
| Sexuality, nudity | No | Menstrual health information is not sexual content. The AI chat is instructed to stay on cycle health and general conversation (`backend/app/api/chat.py` system prompt) but cannot be guaranteed: mention generative AI where the questionnaire asks |
| Language (profanity) | No | Same caveat for AI replies |
| Controlled substances | No | Medication names are user-entered diary items; no drug references |
| Gambling (real or simulated) | No | |
| Users can interact or exchange content with other users | No | No user-to-user features; the chat is with an AI |
| Shares user's location with other users | No | |
| Digital purchases | **Yes** | Luna AI plan subscription |
| Unrestricted internet / web browser | No | |
| Generative AI content | **Yes** if asked | Chat and Insights |

Expect a low age rating from IARC; that is independent of the 18+ target audience below.

### 2.6 Target audience and content

- Target age group: **18 and over only** (Play Console Help, "Target audience and content",
  <https://support.google.com/googleplay/android-developer/answer/9867159>, checked 2026-11-10).
  Matches the product: age consent `age_18_plus` at sign-up, questionnaire age `ge=18`, Privacy
  Policy and Terms "18 and over".
- **Enable "Restrict Minor Access"** (available only when 18+ is the only group): users Google
  determines to be under 18 cannot find, download or buy the app. Recommended.
- "Appeals to children": No. Check that store graphics do not use childish characters (the
  playful moon/companion art should read as adult and calm).

### 2.7 Health apps declaration

Required for every app (<https://support.google.com/googleplay/android-developer/answer/14738291>,
checked 2026-11-10).

- Tick **Health and fitness > Period Tracking** (console description: "Tools that empower users
  to monitor and manage their menstrual health"; Luna also shows estimated cycle phases,
  including an estimated ovulation phase/date in the journey and Insights).
- **Medical > Medication and Treatment Management: probably do not tick.** The console describes
  it as managing medication schedules, pharmacy services and treatment adherence; Luna only logs
  intake (medication list and a "medications taken" field in day logs).
- Do **not** tick Medical Device Apps: Luna is not regulated as a medical device (Terms: "not
  a medical device").
- The Health Content and Services policy requires, for apps not approved by a health authority,
  a clear disclaimer **in the app description** that the app is not a medical device and does not
  diagnose, treat, cure, or prevent any medical condition, and a reminder to consult a healthcare
  professional (answer/16679511, checked 2026-11-10). The listing copy in section 5 includes it.

### 2.8 Financial features

Required for every app, including those with none (Play Console Help answer 13849271, found via
search 2026-11-10: <https://support.google.com/googleplay/android-developer/answer/13849271>).
Answer **"My app doesn't provide any financial features"**. A Play Billing subscription is not a
financial feature.

### 2.9 News apps, government apps, COVID-19 apps

- News and magazine apps: **No**.
- Government apps: **No**.
- COVID-19 contact tracing and status apps: **No** / not applicable. Google folded COVID-19 apps
  into the Health apps policy; the section may no longer be shown (search result 2026-11-10;
  **verify in the console**).

### 2.10 Generative AI (policy, not a form)

The AI-Generated Content policy requires apps with generative AI to "contain in-app user
reporting or flagging features" so users can flag offensive content without leaving the app
(<https://support.google.com/googleplay/android-developer/answer/13985936>, checked 2026-11-10).
**Luna has no such feature today** (no report/flag control in the chat or Insights UI). This is a
code blocker, see 7.3.

### 2.11 Discreet mode and the Deceptive Behavior / Impersonation policies

Discreet mode switches the launcher label and icon to Notes, Daily Planner, Journal, Checklist or
Organizer (`frontend/android/app/src/main/AndroidManifest.xml`, `res/values/strings.xml`). No Play
rule found that names launcher-icon switching, but the Deceptive Behavior policy prohibits
hidden or undocumented features and the Impersonation policy prohibits icons/names that suggest
another app (search 2026-11-10, policy pages linked in [section 8](#8-sources)). To stay clear:

- describe discreet mode in the full description and in the reviewer notes (done in the drafts);
- make sure no alternative icon resembles a specific real app (e.g. Google Keep or a system app);
- the real name remains visible in Settings > Apps and notifications (documented in
  `frontend/android/README.md`): keep it that way.

---

## 3. Account deletion: in-app path and web resource

### 3.1 Requirement

From "Understanding Google Play's app account deletion requirements"
(<https://support.google.com/googleplay/android-developer/answer/13327111>, checked 2026-11-10):

- apps that let users create an account must offer an **in-app path** to delete the account and
  its data, and enter a **web link** in the Data safety form where users can request deletion
  without reinstalling the app;
- the web page must name the app or developer **as on the store listing**, show the deletion
  steps prominently, let the user request deletion without going back to the app (link, e-mail
  or form), state which data is deleted and which is kept (and for how long), and outline extra
  steps such as cancelling a subscription;
- data shared with service providers should be deleted and providers asked to do the same.

### 3.2 What exists

| Requirement | Status | Where |
| --- | --- | --- |
| In-app deletion | **Done**: Profile → Privacy & data → Delete my account → type DELETE → Delete forever. Immediate cascade delete of the user and all linked rows | `frontend/src/PrivacyPanel.js`, `backend/app/api/account.py` |
| Subscription warning before deletion | **Done** (notice + Manage subscription button when a plan is active) | `PrivacyPanel.js` |
| Data export | **Done** (JSON; purchase token excluded) | `account.py` `/account/export` |
| Web deletion page | **Exists** at `https://api.example.com/account-deletion` (served by the API, outside `/api/v1`), linked from the Privacy Policy | `backend/app/api/legal.py`, `frontend/src/legalContent.js` |

### 3.3 Problems with the current web page (fix before submitting)

1. Wrong in-app path: it says "Profile → Delete account"; the real path is **Profile → Privacy &
   data → Delete my account**.
2. It does not say what is **kept**: encrypted database backups (default retention up to 30 days,
   `BACKUP_KEEP_DAYS`/`BACKUP_KEEP_LAST` in `deploy/backup.env.example`, plus whatever the off-site
   copy keeps), proxy access logs (no rotation configured today), records Google Play keeps about
   purchases, and AI-provider retention (Groq up to 30 days for abuse/troubleshooting unless Zero
   Data Retention is on). Note that the backup script never deletes the newest backup and does
   not prune off-site copies: set an expiry (lifecycle rule) on the off-site bucket.
3. It does not mention that **deleting the account does not cancel a Google Play subscription**.
4. It does not show the developer name, and it falls back to "our support team" if
   `SUPPORT_EMAIL` is empty (production refuses to start without it, so this is only a dev issue).
5. English only. Add Hindi (the app is bilingual).
6. The e-mail route promises deletion "within 30 days and confirm by email": keep that promise
   realistic and identical in the Privacy Policy.

### 3.4 Proposed page content (for engineering to put into `legal.py`; Markdown here only)

> **Delete your Luna Health account**
>
> Luna Health is published on Google Play by `<developer name>`.
>
> **Delete in the app (immediate).** Open Luna Health → tap your avatar (Profile) → **Privacy &
> data** → **Delete my account** → type `DELETE` → **Delete forever**. Your account and all
> linked data are erased from our database at once.
>
> **Delete without the app.** E-mail `support@example.com` from the address you signed up with,
> subject "Delete account". We confirm by e-mail and delete within 30 days (usually much sooner).
> We may ask you to confirm the request from that address.
>
> **Before you delete: subscriptions.** Deleting your account does not cancel a Luna AI plan
> bought on Google Play. Cancel it first in Google Play → Payments & subscriptions →
> Subscriptions. Refunds follow Google Play policy.
>
> **What is deleted:** your e-mail address and password hash, consent records, period records,
> daily logs, medication list, health profile answers, AI analyses, chat messages, subscription
> record (purchase token) and sign-in sessions.
>
> **What is kept, and for how long:**
> - Encrypted database backups made before the deletion are kept until they expire, at most
>   `<N>` days, then deleted. They are not used except to restore the service after a failure.
> - Server access logs (IP address and requested address, no health data) are kept for `<N>` days
>   for security.
> - Google Play keeps its own records of purchases under Google's privacy policy.
> - If you used AI features, messages sent to our AI providers may be retained by them for up to
>   `<N>` days under their terms (`<provider terms links>`).
>
> **Download a copy first:** Profile → Privacy & data → Download my data.
>
> Hindi version of the same text below (native review required).

The `<N>` values must match the real configuration (backup retention, log rotation, provider
settings) and the Privacy Policy.

---

## 4. Privacy policy: changes needed for Play

**Legal review is required before any of this is published.** The text below is a proposal for
`frontend/src/legalContent.js` written as Markdown; nobody should paste it into code without that
review and without deciding whether `PRIVACY_POLICY_VERSION` (`deploy/.env`) must be bumped so
users consent again (open follow-up in the billing checklist).

### 4.1 Gaps in the current text (`frontend/src/legalContent.js`, dated 2026-10-24)

| Gap | Why it matters |
| --- | --- |
| No hosted URL yet (web frontend not deployed) | Play needs a public URL (2.1) |
| No identity of the data fiduciary/controller or developer name; contact falls back to "the support address listed in the app store listing" when `REACT_APP_SUPPORT_EMAIL` is empty | Users and Play need a real contact; set `REACT_APP_SUPPORT_EMAIL` in the build |
| No retention periods (account data, backups, logs, deleted accounts, unverified accounts) | Required by the account deletion policy ("clearly inform users about your data retention practices") |
| Processors not listed: hosting provider, e-mail provider, Google (sign-in, Play billing), optional error reporting | Comprehensive disclosure required by the Health Content and Services policy |
| AI section says "a summary of your recent cycle data" | Insights sends the last six period records and the full health profile incl. free-text note (1.3) |
| Encryption claim lists notes, chat, profile, analysis text | Accurate but incomplete: daily logs, medication names and purchase tokens are also encrypted; period dates/flow/symptoms are not column-encrypted. Do not overstate |
| Health profile fields not listed (age, biological sex, weight, height) | Disclosure |
| Device-only data not described (reminders, offline cache, discreet mode) | A privacy-first strength worth stating precisely |
| No mention of where data is hosted | Depends on the owner's hosting region decision |

### 4.2 Proposed replacement sections

**Who we are** (new, first section)

> Luna Health is a personal project published on Google Play by `<developer name>` ("we"). For
> privacy questions, data requests and grievances, contact `support@example.com`. `<If required
> after legal review: name and contact of a grievance officer.>`

**What we collect** (replace)

> - **Account:** your e-mail address, a hashed password (none if you only use Google sign-in), and
>   when you joined. If you sign in with Google, Google sends us a sign-in token; we keep only
>   your e-mail address from it.
> - **What you log:** period dates, flow, pain level, symptoms and notes; daily check-ins (mood,
>   symptoms, flow, sleep hours, glasses of water, medications taken, note); your medication list.
> - **Health profile (optional):** age, biological sex, weight, height, cycle pattern, bleeding,
>   pain and premenstrual symptom answers, and an optional note.
> - **AI features (optional):** your chat messages, Luna's replies and generated insights.
> - **Luna AI plan:** the purchase token Google Play gives us, the plan, its status and dates.
> - **Consents:** what you agreed to or withdrew, when, and under which policy version.
> - **Security logs:** our server records the IP address and the address requested for each
>   connection, without health data.
>
> **Kept only on your phone (never sent to us):** reminder settings, the app appearance (discreet
> mode) choice, and an encrypted offline copy of your data so the app works without a connection.
> Signing out deletes the offline copy and its key.

**AI features and third-party processing** (replace)

> AI features are optional and off until you allow them. If you allow them:
> - **Chat:** your message, together with a short summary of your cycle (average length,
>   variation, next expected period, number of cycles tracked), a few health-profile values (age,
>   pain severity, whether premenstrual symptoms affect daily life) and the latest insight
>   results, including any flagged risk factors, is sent to **Groq** to write a reply.
> - **Insights:** your last six periods (dates, cycle length, flow, pain, symptoms; not your notes)
>   and your full health profile, including its optional note, are sent to **Hugging Face**
>   `<or the inference provider that actually serves the model>`; its result, with statistics
>   and the prediction range, is then sent to **Groq** to write the report.
> - We do not send your e-mail address or account id to these services. They may process the data
>   on servers outside India (Groq states its servers are in the United States). `<Retention and
>   training terms of each provider, once confirmed.>`
> - Withdraw at any time in Profile → Privacy & data. Chat and Insights then stop; data already
>   sent cannot be recalled from the provider, but we stop sending new data.

**Who processes data for us** (new)

> We use these service providers, only to run Luna:
> - `<hosting provider>`, `<region>`: servers and database.
> - `<e-mail provider>`: verification and password-reset e-mails (your e-mail address).
> - Google: Sign in with Google (if you use it) and Google Play billing (purchases).
> - Groq and Hugging Face: AI features, only with your consent (see above).
> - `<Only if SENTRY_DSN is set:>` `<error-reporting provider>`: technical error reports that
>   contain no personal or health data.
>
> We do not sell your data, use it for advertising, or share it with data brokers.

**How long we keep data** (new)

> - While your account exists, we keep what you logged so the app can show your history.
> - When you delete your account, it is erased from our database immediately. Encrypted backups
>   made before that are deleted when they expire, within `<N>` days.
> - Security logs are kept for `<N>` days.
> - Accounts that are never verified are deleted after `<N>` days `<only once engineering adds a
>   purge job; today they are kept>`.
> - Data sent to AI providers is kept by them according to their terms (up to `<N>` days).

**How we protect your data** (replace)

> All connections use encryption in transit (HTTPS). In our database, your notes, daily
> check-ins, health profile, medication list, chat messages, AI analysis text and purchase token
> are additionally encrypted with keys kept outside the database. Database backups are encrypted.
> No system is perfectly secure; if a breach affects your data we will tell you and the
> authorities as the law requires.

**Your choices and rights** (keep, fix the deletion link to the final URL and add)

> - Delete individual entries (a period, a day, a medication) at any time in the app.

**Children** (keep "Who this is for"; 18+ only).

---

## 5. Store listing copy, graphics and categories

Limits (Play Console Help, "Add preview assets" and "Add product details",
<https://support.google.com/googleplay/android-developer/answer/9866151> and
<https://support.google.com/googleplay/android-developer/answer/9859152>, checked 2026-11-10):
title ≤ 30 characters, short description ≤ 80, full description ≤ 4000. Metadata policy
(<https://support.google.com/googleplay/android-developer/answer/9898842>, checked 2026-11-10): no
ranking or promotional terms, emojis or repeated special characters in the title, icon or
developer name; no anonymous testimonials; no repetitive or unrelated keywords.

Content rules applied to every draft: no diagnosis, contraception, fertility or "get pregnant"
claims; predictions described as estimates; the required not-a-medical-device disclaimer; the
paid plan described exactly as built (Insights and Chat; tracking free); discreet mode described
honestly. The Hindi text is a draft for a native speaker's review, like the in-app strings.

### 5.1 App name options

| Option | Length | Notes |
| --- | --- | --- |
| **Luna Health: Cycle Tracker** | 26 | Recommended. Matches the in-app name and launcher label "Luna Health"; neutral |
| Luna: Private Period Tracker | 28 | "Private" is a factual feature claim, not ranking; acceptable but avoid if review objects |
| Luna Cycle Diary | 16 | Most discreet; weaker search match |
| Hindi listing title: **Luna: पीरियड और साइकिल ट्रैकर** | 29 | Native review |

Check trademark conflicts for "Luna" in India before committing (many apps use the name).

### 5.2 Short description (≤ 80)

English:

```text
Private period and cycle tracker. Works offline. Optional AI insights.
```

Hindi:

```text
निजी पीरियड और साइकिल ट्रैकर। ऑफ़लाइन भी चलता है। AI सलाह वैकल्पिक।
```

### 5.3 Full description (≤ 4000)

English:

```text
Luna Health is a calm, private place to keep track of your cycle. Log your period, how you feel and your symptoms, and see your cycle as a journey through its phases.

TRACK YOUR CYCLE
- Log period start and end, flow, pain and symptoms.
- Daily check-in: mood, symptoms, sleep, water, medications taken and a private note.
- Calendar and journey map of your cycle, with an estimate of your next period based on your own history. Estimates can be wrong, especially when cycles vary.
- Optional reminders: period expected soon, a daily check-in nudge, and a late-period check-in. Reminder text is neutral by default.

PRIVATE BY DESIGN
- No ads. We do not sell your data or use it for advertising.
- Your notes, check-ins, health profile and chat are encrypted on our servers, and all connections are encrypted.
- Screenshots are blocked inside the app.
- Discreet mode: change the app's icon and name on your home screen to a neutral one such as "Journal" or "Planner". Android still shows the real name in Settings and notifications.
- Works offline: log without a connection; changes sync when you are back online.
- Download all your data, or delete your account and all its data, from Profile > Privacy & data.

OPTIONAL: LUNA AI PLAN
Cycle tracking is free. The optional Luna AI plan, a subscription through Google Play, adds Insights (a written report on your cycle patterns) and Chat (ask questions about your cycle). AI features only run after you allow them; they send the data needed for a reply to third-party AI services (Groq and Hugging Face). You can withdraw that consent at any time. The price and billing period are shown in Google Play before you pay; the plan renews automatically until you cancel in Google Play.

ENGLISH AND HINDI
Use Luna in English or Hindi.

FOR ADULTS
Luna Health is for people aged 18 and over.

IMPORTANT
Luna Health is not a medical device and does not diagnose, treat, cure, or prevent any medical condition. Predictions and AI replies are estimates and can be wrong. It is not a method of contraception. Always consult a healthcare professional for medical advice, diagnosis or treatment, and seek urgent care in an emergency.
```

Hindi:

```text
Luna Health आपके साइकिल का हिसाब रखने की एक शांत और निजी जगह है। अपना पीरियड, अपना मूड और लक्षण दर्ज करें, और अपने साइकिल को उसके चरणों की यात्रा की तरह देखें।

अपना साइकिल ट्रैक करें
- पीरियड की शुरुआत और अंत, फ़्लो, दर्द और लक्षण दर्ज करें।
- रोज़ का चेक-इन: मूड, लक्षण, नींद, पानी, ली गई दवाएँ और एक निजी नोट।
- कैलेंडर और आपके साइकिल का यात्रा-नक्शा, और आपके अपने इतिहास के आधार पर अगले पीरियड का अनुमान। अनुमान गलत हो सकते हैं, ख़ासकर जब साइकिल बदलता रहता हो।
- वैकल्पिक रिमाइंडर: पीरियड जल्द आने वाला है, रोज़ के चेक-इन की याद, और पीरियड देर होने पर चेक-इन। रिमाइंडर का टेक्स्ट डिफ़ॉल्ट रूप से सामान्य रहता है।

शुरू से निजी
- कोई विज्ञापन नहीं। हम आपका डेटा न बेचते हैं, न विज्ञापन के लिए इस्तेमाल करते हैं।
- आपके नोट, चेक-इन, हेल्थ प्रोफ़ाइल और चैट हमारे सर्वर पर एन्क्रिप्टेड रहते हैं, और हर कनेक्शन एन्क्रिप्टेड होता है।
- ऐप के अंदर स्क्रीनशॉट नहीं लिए जा सकते।
- डिस्क्रीट मोड: होम स्क्रीन पर ऐप का आइकन और नाम किसी सामान्य नाम जैसे "Journal" या "Planner" में बदलें। Android की सेटिंग्स और नोटिफ़िकेशन में असली नाम दिखता रहता है।
- ऑफ़लाइन भी चलता है: बिना इंटरनेट के दर्ज करें; ऑनलाइन होते ही बदलाव सिंक हो जाते हैं।
- Profile > Privacy & data से अपना सारा डेटा डाउनलोड करें, या अपना अकाउंट और उसका सारा डेटा डिलीट करें।

वैकल्पिक: Luna AI प्लान
साइकिल ट्रैकिंग मुफ़्त है। वैकल्पिक Luna AI प्लान, Google Play के ज़रिए एक सब्सक्रिप्शन, Insights (आपके साइकिल के पैटर्न पर एक लिखित रिपोर्ट) और Chat (अपने साइकिल के बारे में सवाल पूछें) जोड़ता है। AI सुविधाएँ आपकी अनुमति के बाद ही चलती हैं; जवाब के लिए ज़रूरी डेटा तीसरे पक्ष की AI सेवाओं (Groq और Hugging Face) को भेजा जाता है। आप यह अनुमति कभी भी वापस ले सकती हैं। कीमत और बिलिंग अवधि भुगतान से पहले Google Play में दिखती है; प्लान तब तक अपने-आप रिन्यू होता है जब तक आप Google Play में उसे रद्द न करें।

अंग्रेज़ी और हिंदी
Luna को अंग्रेज़ी या हिंदी में इस्तेमाल करें।

वयस्कों के लिए
Luna Health 18 वर्ष और उससे अधिक उम्र के लोगों के लिए है।

ज़रूरी सूचना
Luna Health कोई मेडिकल डिवाइस नहीं है और किसी भी बीमारी या स्थिति का निदान, इलाज, उपचार या रोकथाम नहीं करता। अनुमान और AI के जवाब सिर्फ़ अनुमान हैं और गलत हो सकते हैं। यह गर्भनिरोध का तरीका नहीं है। चिकित्सा सलाह, निदान या इलाज के लिए हमेशा किसी स्वास्थ्य विशेषज्ञ से सलाह लें, और आपात स्थिति में तुरंत चिकित्सा सहायता लें।
```

Character counts of the drafts (Python `len`, code points; checked when this file was written):
English short 70, Hindi short 67; English full 2,174, Hindi full 2,243; release notes 203 and
193. All within limits; re-check after every edit.

Notes for the reviewer of the Hindi text: "आप ... सकती हैं" uses the feminine form like the in-app
copy style (`frontend/src/i18n/HI-STYLE.md`); confirm. Section labels (Profile > Privacy & data)
are left in English because the Hindi UI labels must match exactly: replace them with the
reviewed Hindi UI strings from the catalog.

### 5.4 What's new (first release)

Release notes limit: 500 characters per language (**verify in the console**).

```text
First release of Luna Health: period and daily check-in logging, calendar and journey map, reminders, offline mode, discreet mode, English and Hindi, and the optional Luna AI plan with Insights and Chat.
```

```text
Luna Health का पहला संस्करण: पीरियड और रोज़ के चेक-इन दर्ज करना, कैलेंडर और यात्रा-नक्शा, रिमाइंडर, ऑफ़लाइन मोड, डिस्क्रीट मोड, अंग्रेज़ी और हिंदी, और वैकल्पिक Luna AI प्लान (Insights और Chat)।
```

### 5.5 Keywords guidance

Play has no keyword field; ranking uses the title, short and full description. Use each term
naturally once or twice, never as a list.

- English: period tracker, cycle tracker, menstrual cycle, symptoms, mood, private, offline.
- Hindi: पीरियड ट्रैकर, मासिक धर्म, माहवारी, साइकिल, लक्षण, मूड.
- Avoid: fertility, ovulation calculator, pregnancy, contraception, "best", "#1", "free" in the
  title, competitor names.

### 5.6 Graphics

Specs from "Add preview assets to showcase your app"
(<https://support.google.com/googleplay/android-developer/answer/9866151>, checked 2026-11-10):

| Asset | Spec | Source in repo / plan |
| --- | --- | --- |
| App icon | 512 x 512, 32-bit PNG with alpha, ≤ 1024 KB | Render from `frontend/resources/icon.svg` (the launcher icon source). **Do not use `frontend/public/logo512.png`: it is the default Create React App logo** (8-bit colormap) |
| Feature graphic | 1024 x 500, JPEG or 24-bit PNG, no alpha | Dark background `#1A0F2E`, moon mark, "Luna Health". Keep key elements centred, no device frames, no store badges, no text implying ranking |
| Phone screenshots | JPEG or 24-bit PNG, no alpha, each side 320-3840 px, long side ≤ 2x short side; min 2 to publish, max 8 per device type. For recommendation eligibility: at least 4, portrait 9:16, min 1080 x 1920 | Plan below |
| Taglines on screenshots | ≤ 20 % of the image | Optional short caption per shot |

**Screenshot capture problem.** `MainActivity` sets `FLAG_SECURE`
(`frontend/android/app/src/main/java/app/placeholder/luna/MainActivity.java`), so `adb screencap`
and the phone's screenshot button produce black images. Options:

1. **Recommended:** a local, never-uploaded debug build with the `FLAG_SECURE` line removed on a
   throwaway branch, run on an emulator at 1080 x 1920 (e.g. a Pixel profile, status bar
   cleaned up as Play asks: no carrier name, full battery and signal).
2. The web build in desktop Chrome device emulation at 1080 x 1920. Same React UI, but native-only
   parts (offline status line, reminders permission, launcher appearance) differ. Play asks for
   screenshots of the actual app, so prefer option 1.

The pre-launch report's screenshots will also be black for the same reason; that is expected.

**Theme.** The app has a single dark theme (no light mode exists in the code), so capture dark
only. "Quiet" (playful effects off) changes animation, not colours.

**Shot list** (portrait 1080 x 1920, same sequence in English and in Hindi; Hindi screenshots go
on the Hindi listing; use a seeded demo account, never real data):

| # | Screen | State to set up | Caption idea (EN) |
| --- | --- | --- | --- |
| 1 | Home / Today card with the journey map | 4+ past periods, mid-cycle | Your cycle as a journey |
| 2 | Calendar month | Logged period days and check-ins visible | Everything at a glance |
| 3 | Day sheet (log a day) | Mood, two symptoms, flow, short neutral note | Log in seconds |
| 4 | Profile > Reminders | Two reminders on, neutral wording | Gentle, discreet reminders |
| 5 | Profile > App appearance (discreet mode) | Picker visible, "Journal" selected | Discreet mode |
| 6 | Profile > Privacy & data | AI consent shown, export and delete buttons | Your data, your control |
| 7 | Insights report (Luna AI plan) | Generated report incl. its disclaimer | Optional AI insights |
| 8 | Chat (Luna AI plan) | One neutral question and reply, no medical claims | Ask about your cycle |

Optional: a 7-inch/10-inch tablet set is not required; the app is phone-first.

### 5.7 Category, tags, contact details

- App or game: **App**. Category: **Health & Fitness** (not Medical: Luna is not a medical tool).
- Tags: choose up to the console's maximum from its fixed list, closest to period tracking,
  women's health, health tracking, journal (tag names: **verify in the console**).
- Contact e-mail: `support@example.com` (shown publicly). Website: `https://app.example.com`
  (optional). Privacy policy: the hosted URL from 2.1.
- Free app with in-app products: **Free** (the subscription is set up separately; see the
  billing checklist).
- Countries: start with **India**; add others only after the privacy policy and AI-provider terms
  are checked for them.

---

## 6. Permissions rationale

Declared in `frontend/android/app/src/main/AndroidManifest.xml`, plus permissions added by
plugins (documented in `frontend/android/README.md`). Plugin manifests were re-derived from `frontend/node_modules`
on 2026-11-14 for the Capacitor 8 plugin set (the status-bar plugin was removed; its manifest was empty); **confirm the final list from the merged manifest of the release bundle**
(Android Studio "Merged Manifest", or `bundletool dump manifest --bundle app-release.aab`).

| Permission | Source | Why Luna needs it | Runtime prompt | Play declaration |
| --- | --- | --- | --- | --- |
| `android.permission.INTERNET` | App manifest | Talk to the Luna API | No | None |
| `android.permission.ACCESS_NETWORK_STATE` | App manifest | Know when the phone is offline so logging goes to the offline queue and syncs later | No | None |
| `com.android.vending.BILLING` | App manifest | Google Play Billing for the Luna AI plan | No | None (Data safety covers purchase history) |
| `android.permission.POST_NOTIFICATIONS` | `@capacitor/local-notifications` 8.2.1 | Show reminders; requested only when the user turns a reminder on (Android 13+) | Yes | None |
| `android.permission.RECEIVE_BOOT_COMPLETED` | `@capacitor/local-notifications` (non-exported boot receiver) | Re-create scheduled reminders after a reboot | No | None |
| `android.permission.WAKE_LOCK` | `@capacitor/local-notifications` | Deliver alarms while the device is idle | No | None |
| `android.permission.VIBRATE` | `@capacitor/haptics` (confirmed in its manifest) | Haptic feedback (turned off by "Quiet") | No | None |
| `android.permission.USE_CREDENTIALS` | `@capgo/capacitor-social-login` | Google sign-in via Credential Manager | No | None |
| `android.permission.USE_BIOMETRIC`, `android.permission.USE_FINGERPRINT` | Transitive Google sign-in / credentials libraries | Not used by Luna | No | None; optionally remove with `tools:node="remove"` after testing sign-in |
| `<app ID>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | androidx.core | Signature-level, internal to the app | No | None |
| `com.google.android.gms.permission.AD_ID` | Must **not** be present (**verify in merged manifest**) | Not used | | Advertising ID declaration: No (2.4) |

Held plugin versions (guarded by `frontend/src/pluginPins.test.js`, which fails if they move):

- `@capacitor/local-notifications` is held at **8.2.1**. From 8.3.0 the plugin adds
  `SCHEDULE_EXACT_ALARM` and `schedule()` opens the system "Alarms & reminders" settings screen on
  every call unless exact alarms are granted. That contradicts the decision below that reminders do
  not use exact alarms. Before bumping: rework `reminderScheduler.js` (pass `isExactNotification: false`,
  remove the permission with `tools:node="remove"`), re-check this table, then raise the pin in the test.
- `@capgo/native-purchases` is held at **8.6.0**. From 8.6.1 each offer's price is the recurring
  phase price, so a free-trial offer no longer reports price 0 and `toPlans()` in
  `frontend/src/billing/billingClient.js` would drop the product from the paywall. Before bumping:
  change `toPlans()` to recognise trial offers by their phases, test on a device with a trial offer, then
  raise the pin in the test.

Not requested: `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` (reminders are inexact on purpose, so
no exact-alarm declaration is needed), location, camera, storage, contacts, phone, SMS. Other
manifest facts reviewers may ask about: `android:allowBackup="false"` (health data is never in
Android cloud backups), `FLAG_SECURE` (no screenshots), `usesCleartextTraffic="false"`,
`MainActivity` not exported; in the app manifest only the six launcher aliases are exported
(libraries add two permission-protected exported components: Google sign-in's revocation service
and androidx `ProfileInstallReceiver`); FileProvider not exported (used for the data export share
sheet); `dataExtractionRules` also excludes device-to-device transfer.

---

## 7. Pre-launch checklist

Ordered by dependency: an item can start when everything above it that it depends on is done.
Owner-only steps are detailed in [`owner-setup-guide.md`](owner-setup-guide.md).

### 7.1 Google Play facts that set the order

| Fact | Source (checked 2026-11-10) |
| --- | --- |
| New apps and updates must target **Android 16 (API 36)** since 2026-08-31; the extension option ran only to 2026-11-01, already past. Luna now targets **API 36** (`frontend/android/variables.gradle`, asserted by the `Android` CI workflow; device checklist pending: [`capacitor-8-device-checklist.md`](capacitor-8-device-checklist.md)). Verified again by the fact-check 2026-11-10 | <https://developer.android.com/google/play/requirements/target-sdk>, <https://support.google.com/googleplay/android-developer/answer/11926878> |
| New personal accounts (created after 2023-11-13) need a closed test with **at least 12 testers opted in for the last 14 continuous days** before applying for production; that review "usually takes seven days or less". Verified again by the fact-check 2026-11-10 | <https://support.google.com/googleplay/android-developer/answer/14151465> |
| A personal account that monetises shows the developer's **full address** on Google Play. Verified by the fact-check 2026-11-10 | <https://support.google.com/googleplay/android-developer/answer/13628312> |
| Internal testing: up to 100 testers, builds arrive within minutes, may skip full review | <https://support.google.com/googleplay/android-developer/answer/9845334> |
| New apps are enrolled in Play App Signing by default (Google holds the app signing key; you keep the upload key, which Google can reset) | <https://support.google.com/googleplay/android-developer/answer/9842756> |
| Pre-launch report runs automatically on bundle upload where capacity permits; test credentials go under Pre-launch report > Settings | <https://support.google.com/googleplay/android-developer/answer/9842757> |

### 7.2 Ordered checklist

**A. Decisions and accounts (owner)**

- [ ] Application id chosen and applied with `scripts/android/rename-app-id.sh <app ID>`.
- [ ] Play developer account created and verified (personal vs organisation, public address
      implications: owner guide 2).
- [ ] Domain, DNS A record, hosting, SMTP, Groq/Hugging Face accounts, support mailbox
      (owner guide 5).
- [ ] Upload keystore created and backed up twice (owner guide 4).

**B. Code work that blocks any upload (engineering, see 7.3)**

- [x] targetSdk 36 (Capacitor 8.6.0 upgrade, draft PR #23; pending the owner's device checklist, [`capacitor-8-device-checklist.md`](capacitor-8-device-checklist.md)).
- [ ] R8 minify + log stripping in the release build.
- [ ] In-app AI content reporting.
- [ ] Web frontend hosted (privacy, terms, verify-email, reset-password).
- [ ] Account-deletion page and privacy policy text updated after legal review.

**C. Backend live**

- [ ] Production stack deployed per `deploy/README.md`, `deploy/smoke.sh` all PASS, first backup
      and restore drill done (`docs/superpowers/runbook.md` 1, 4).
- [ ] `SUPPORT_EMAIL`, `FRONTEND_URL`, `ALLOWED_ORIGINS` (add the web origin), `GOOGLE_ID_TOKEN_AUDIENCES`
      set; `BILLING_MODE=off` until D is done.

**D. Play Console app shell**

- [ ] App created with the final `<app ID>` (permanent).
- [ ] App content: privacy policy URL, app access, ads, advertising ID, content rating, target
      audience (18+, Restrict Minor Access), Data safety, health apps, financial features,
      government/news (sections 1-2).
- [ ] Store listing (section 5) in English, Hindi translation added.
- [ ] Subscriptions `luna_ai_monthly` / `luna_ai_yearly`, base plans `monthly` / `yearly`, INR
      prices, activated (billing checklist 1).
- [ ] Service account + API access for the backend (billing checklist 2), then `BILLING_MODE=google`.

**E. Builds and testing tracks**

- [ ] versionCode policy: every upload uses a new, higher `LUNA_VERSION_CODE` (Play rejects reuse;
      `frontend/android/app/build.gradle` enforces a positive integer). Use a plain counter
      (1, 2, 3 ...) and tag each upload in git (`v1.0.0-vc3`). `LUNA_VERSION_NAME` is cosmetic.
- [ ] First signed bundle with `scripts/android/release.sh` → **internal testing**.
- [ ] Copy the **app signing key** SHA-1 (and upload key SHA-1) from Play Console into the Android
      OAuth client (owner guide 3); Google sign-in on Play installs fails until this is done.
- [ ] Pre-launch report: test credentials entered; review stability/accessibility findings
      (screenshots will be black: `FLAG_SECURE`).
- [ ] Device runs on the **minified** build: `offline-emulator-checklist.md` (all sections),
      billing manual test script (billing checklist 6) with a license tester, grace-period check
      (billing checklist 4), Google sign-in, reminders, discreet mode.
- [ ] **Closed testing** with at least 12 testers opted in for 14 continuous days (personal
      account), feedback triaged.
- [ ] Apply for production access; then a staged production rollout (e.g. 10 % → 50 % → 100 %).

**F. Launch day and after**

- [ ] Monitoring from runbook 8 in place; support mailbox watched.
- [ ] Data safety answers re-checked against the shipped build.

### 7.3 Must be finished in code first

| # | Item | Why | Blocks |
| --- | --- | --- | --- |
| 1 | **Done by this PR (Capacitor 8.6.0, targetSdk 36, asserted by CI); pending the owner's device checklist** ([`capacitor-8-device-checklist.md`](capacitor-8-device-checklist.md)). Was: raise `compileSdkVersion`/`targetSdkVersion` to 36 (Capacitor documents target SDK 36 for Android 8.x: <https://capacitorjs.com/docs/next/android/setting-target-sdk>, checked 2026-11-10). The `androidx.browser` pin is lifted, edge-to-edge is handled by the `SystemBars` plugin (`adjustMarginsForEdgeToEdge` is gone), and the keyboard inset is handled by `SystemBars` too | Play refuses API 35 uploads for new apps since 2026-08-31 | Any upload |
| 2 | R8: `minifyEnabled true`, `proguard-android-optimize.txt`, `-assumenosideeffects` for `Log.d/i/v`, keep rules (exact text in `billing-owner-checklist.md` "Release build") | The billing plugin logs purchase tokens | Release |
| 3 | In-app "report this reply" (or flag) control for Chat and Insights, sending the message id and reason to the backend, stored for review | Play AI-Generated Content policy | Release |
| 4 | Host the web frontend build (e.g. a second Caddy site for `app.example.com` serving `frontend/build` with SPA fallback, or static hosting) and add its origin to `ALLOWED_ORIGINS` | Privacy URL; e-mail sign-up cannot complete at all: the password is chosen on the web `/verify-email` page (`auth.py` register stores an empty hash) and the app has no App Links; password reset also opens a web route | Sign-up works at all; Play listing |
| 5 | Fix `/account-deletion` text (3.3, 3.4), add Hindi | Play account deletion policy | Data safety |
| 6 | Apply the reviewed privacy policy text (section 4) and AI consent text (accuracy of what Insights sends); decide the `PRIVACY_POLICY_VERSION` bump | Disclosure accuracy | Release |
| 7 | Hugging Face endpoint: the code calls `https://api-inference.huggingface.co/models/...`. Community reports (search 2026-11-10, e.g. <https://discuss.huggingface.co/t/error-https-api-inference-huggingface-co-is-no-longer-supported-please-use-https-router-huggingface-co-hf-inference-instead/169870/1>) say that host now answers 410 and the router `https://router.huggingface.co` replaces it; not confirmed from official Hugging Face docs here. Test with the real key: if it fails, the MedGemma step is skipped silently (`llm_service.py`: empty medical analysis) and Groq still writes a report from statistics alone, so the user is not told. Official Hugging Face docs (<https://huggingface.co/docs/inference-providers/providers/hf-inference>, checked 2026-11-10) say HF Inference now focuses on CPU models and list no text-generation task, so MedGemma is likely not served there at all. Options: a third-party provider that serves it (named in the policy), a dedicated Inference Endpoint, or dropping the step. If migrating, check which provider serves the model, because that provider then receives the data and must be named in the policy | Insights quality and disclosure accuracy | Insights |
| 8 | Docker log rotation (`logging: driver json-file, options max-size/max-file`) for `proxy` and `api` in `deploy/compose.prod.yml`, matching the retention stated in the policy | Retention promise | Policy text |
| 9 | Merged-manifest check; remove `AD_ID` if any library adds it. The Facebook SDK (the usual `AD_ID` source) is excluded only when building through `npm run android:sync` (the social-login hook writes `socialLogin.facebook.include=false`); never build a release with a bare `./gradlew` | Advertising ID declaration | Release |
| 10 | Optional: request only the `email` scope in `nativeGoogle.js` (drop `profile`) so no name reaches the server | Simpler Data safety | No |
| 12 | Optional: purge never-verified accounts after N days; replace the React default `public/logo192.png`, `logo512.png`, `favicon.ico` | Retention; web polish | No |
| 13 | Reviewer access to paid features (2.2): promo code or a server-side allowlist | Review of Insights/Chat | Review |
| 14 | Device runs of the offline and billing checklists on the minified build (not yet done on a device) | Known follow-up | Release |
| 15 | Native Hindi review of in-app strings (`frontend/src/i18n/hi-review.md`, `npm run i18n:review`) and of the Hindi listing copy | Known follow-up | Release |

### 7.4 Confirmed product blockers and gaps

De-duplicated list after an independent fact-check against the code (2026-11-10), in priority
order. Details for each are in 7.3 and the sections referenced.

**Blockers (no release until fixed)**

1. ~~`targetSdk` 35 vs the required 36~~ (Play refuses new uploads since 2026-08-31,
   <https://developer.android.com/google/play/requirements/target-sdk>): **done by this PR
   (Capacitor 8.6.0, targetSdk 36, asserted by CI)**, pending the owner's device checklist
   ([`capacitor-8-device-checklist.md`](capacitor-8-device-checklist.md)).
2. Web frontend not hosted: e-mail sign-up and password reset cannot complete (the password is
   chosen on the web `/verify-email` page), no public privacy URL, no App Links.
3. No in-app report/flag control for AI output (Play AI-Generated Content policy,
   <https://support.google.com/googleplay/android-developer/answer/13985936>).
4. `/account-deletion` page (`backend/app/api/legal.py:21-26`) gives the wrong in-app path (real:
   Profile → Privacy & data → Delete my account), no developer name, no retention/retained-data
   text, no subscription note (Play account deletion requirement,
   <https://support.google.com/googleplay/android-developer/answer/13327111>).
5. Release build logs purchase tokens (`minifyEnabled false`; billing plugin `Log` calls).

**Should fix before launch**

6. Hugging Face MedGemma step probably dead and silently degraded (7.3 #7).
7. AI consent text and privacy policy understate what is sent: Insights sends up to six raw period
   records plus the full profile including the free-text note, weight, height and sex; Groq also
   gets analysis data; chat gets AI risk flags.
8. Privacy policy lacks retention statements, a processors list and developer identity; it says
   "deleted immediately" while backups are kept up to 30 days.
9. No log rotation (Caddy IP/path logs kept indefinitely).
10. Unverified registrations are never purged.
11. No reviewer access mechanism for paid features.
12. Chat "BMI" is always N/A (bug in `backend/app/api/chat.py`).

**Nice to have**

13. Create React App default `logo192.png` / `logo512.png` / `favicon.ico` in `frontend/public/`
    (render the 512 Play icon from `frontend/resources/icon.svg`).
14. `FLAG_SECURE` makes store and pre-launch screenshots black (use a local build without it for
    captures).
15. The Google `profile` scope is not needed (the server reads only the email).
16. Google sign-in accepts only `@gmail.com` addresses (`backend/app/services/google_oauth.py:127`),
    so Google Workspace testers cannot use it.
17. Remove the transitive `USE_BIOMETRIC` / `USE_FINGERPRINT` permissions after testing sign-in.

---

## 8. Sources

All checked 2026-11-10.

- Data safety: <https://support.google.com/googleplay/android-developer/answer/10787469>
- Account deletion: <https://support.google.com/googleplay/android-developer/answer/13327111>
- Prepare your app for review (privacy policy, app access, ads, target audience, ratings):
  <https://support.google.com/googleplay/android-developer/answer/9859455>
- Content ratings: <https://support.google.com/googleplay/android-developer/answer/9898843>,
  <https://support.google.com/googleplay/android-developer/answer/9859655>
- Target audience: <https://support.google.com/googleplay/android-developer/answer/9867159>
- Health apps declaration: <https://support.google.com/googleplay/android-developer/answer/14738291>
- Health Content and Services policy: <https://support.google.com/googleplay/android-developer/answer/16679511>
- Financial features declaration: <https://support.google.com/googleplay/android-developer/answer/13849271> (via search result; page not opened)
- AI-Generated Content policy: <https://support.google.com/googleplay/android-developer/answer/13985936>
- Metadata policy: <https://support.google.com/googleplay/android-developer/answer/9898842>
- Deceptive Behavior / Impersonation (search summaries only):
  <https://support.google.com/googleplay/android-developer/answer/9888077>,
  <https://support.google.com/googleplay/android-developer/answer/9888374>
- Preview assets: <https://support.google.com/googleplay/android-developer/answer/9866151>
- Product details (text limits): <https://support.google.com/googleplay/android-developer/answer/9859152>
- Target API level: <https://developer.android.com/google/play/requirements/target-sdk>,
  <https://support.google.com/googleplay/android-developer/answer/11926878>
- Testing requirements for new personal accounts: <https://support.google.com/googleplay/android-developer/answer/14151465>
- Testing tracks: <https://support.google.com/googleplay/android-developer/answer/9845334>
- Play App Signing: <https://support.google.com/googleplay/android-developer/answer/9842756>
- Pre-launch report: <https://support.google.com/googleplay/android-developer/answer/9842757>
- Groq data handling: <https://console.groq.com/docs/your-data>
- Hugging Face Inference Providers: <https://huggingface.co/docs/inference-providers/index>,
  <https://huggingface.co/docs/inference-providers/providers/hf-inference>
- Account information / public address: <https://support.google.com/googleplay/android-developer/answer/13628312>
- Capacitor target SDK: <https://capacitorjs.com/docs/next/android/setting-target-sdk>
