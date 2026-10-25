# Luna Health — frontend

React (Create React App) client for the Luna Health API.

## Setup

```bash
cd frontend
npm ci
cp .env.example .env.local   # then edit
npm start                    # http://localhost:3000
```

| Variable | Purpose |
|---|---|
| `REACT_APP_API_BASE` | API base URL including `/api/v1`. Defaults to `http://localhost:8000/api/v1` in development. **Required for production builds** (the app refuses to start without it). |
| `REACT_APP_SUPPORT_EMAIL` | Contact address shown in the Privacy Policy and Terms. |

## Tests

```bash
CI=true npm test -- --watchAll=false
```

## Translations

The app is available in English and Hindi (`src/i18n/`). English text lives in the code; Hindi lives in `src/i18n/catalogs/hi.json`, keyed by the English sentence. Wording rules and the glossary are in `src/i18n/HI-STYLE.md`.

Adding or changing user-visible text:

1. Wrap it with `t('Literal text')` or, for counts, `tn(n, '{count} day', '{count} days')`. The first argument must be a string literal; put variable parts in `{placeholders}` and pass them as the last argument. Mark a doubtful translation with a `// i18n-note: <why uncertain>` comment on the line above the call.
2. Add the Hindi to `hi.json` (same placeholders).
3. `npm run i18n:check` - fails on missing, unused, empty or placeholder-mismatched entries and on dynamic `t()` calls.
4. `npm run i18n:review` - regenerates `src/i18n/hi-review.md`, the sheet a Hindi reviewer reads. Commit it.

Adding a language: copy `hi.json` to `catalogs/<code>.json` and translate the values; register the code in `SUPPORTED` (and the catalog, plural rule and locale helpers) in `src/i18n/index.js`; add a font for the script and `:lang(<code>)` CSS rules; then run `npm run i18n:check`.

Before merging: `npm run i18n:check` passes, the tests pass (`src/hindiAudit.test.js` fails if a screen shows English in Hindi, and `src/i18nReviewSheet.test.js` fails if the review sheet is stale), and `hi-review.md` is current.

## Notes

- Sign-up requires confirming age 18+ and accepting the Terms and Privacy Policy; the AI chat and insights additionally need the user's AI-processing consent (the API answers `403 consent_required` otherwise).
- `/privacy` and `/terms` currently hold a **draft** policy that must be reviewed by a lawyer before launch.
