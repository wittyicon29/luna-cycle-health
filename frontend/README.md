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

## Notes

- Sign-up requires confirming age 18+ and accepting the Terms and Privacy Policy; the AI chat and insights additionally need the user's AI-processing consent (the API answers `403 consent_required` otherwise).
- `/privacy` and `/terms` currently hold a **draft** policy that must be reviewed by a lawyer before launch.
