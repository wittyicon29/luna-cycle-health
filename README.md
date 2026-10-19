# Luna Health

Luna Health is a wellness-first cycle tracking and fertility health app designed to help people understand their hormonal patterns, track symptoms, and make more informed health decisions with the support of AI-powered insights.

The app combines a React frontend with a FastAPI backend to provide a modern, private, and intuitive experience for cycle mapping, daily tracking, health questionnaires, and conversational guidance.

## Overview

Luna helps users:

- Track menstrual cycles and per-day phase changes
- View their journey map and cycle history over time
- Log symptoms, health observations, and personal context
- Complete a structured health profile to improve recommendations
- Receive AI-generated cycle analysis and personalized suggestions
- Explore their fertile window, predictions, and wellness guidance
- Maintain a private, secure wellness journal

## Key Features

- Interactive cycle journey map and phase tracking
- AI-powered health chat and analysis
- Personalized symptom and health profiling
- Fertility and cycle prediction experience
- Email verification and account authentication flow
- Responsive frontend designed for mobile and desktop experiences

## Tech Stack

- Frontend: React, React Router, Create React App
- Backend: FastAPI, SQLAlchemy, Pydantic
- Database: PostgreSQL
- Cache/queue: Redis
- AI/analysis: Hugging Face / Groq / model-based health analysis
- Auth: JWT-based auth with email verification support

## Project Structure

```text
.
├── backend/
│   ├── app/
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   ├── public/
│   └── package.json
├── docs/
├── .gitignore
├── README.md
└── .github/
```

## Prerequisites

Before running the app locally, install:

- Node.js 18+
- npm
- Python 3.11+
- PostgreSQL
- Redis

## Local Setup

### 1) Backend

From the project root:

```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
# source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env
```

Update `backend/.env` with your local values before starting the backend.

To run the backend tests with coverage from the `backend` directory:

```bash
pytest tests/ -v --cov=app --cov-report=xml --cov-report=term
```

Start the API:

```bash
uvicorn app.main:app --reload --app-dir backend
```

The API will be available at:

- http://localhost:8000
- API docs: http://localhost:8000/docs

### 2) Frontend

From the project root:

```bash
cd frontend
npm install
npm start
```

The frontend will run on:

- http://localhost:3000

## Environment Variables

The backend uses environment-based configuration for database, security, AI, and email settings.

Example values are documented in `backend/.env.example`.

Required variables typically include:

- `DATABASE_URL`
- `SECRET_KEY`
- `ALGORITHM`
- `ACCESS_TOKEN_EXPIRE_MINUTES`
- `REFRESH_TOKEN_EXPIRE_DAYS`
- `REDIS_URL`
- `APP_ENV`
- `ALLOWED_ORIGINS`
- `SMTP_*` values for email verification
- AI API keys such as `HUGGINGFACE_API_KEY` and `GROQ_API_KEY`

## Security Note

This project includes authentication, email verification, and AI integrations. For production, use strong environment secrets, rotate keys regularly, and avoid committing real credentials to version control.

## Development Notes

- The backend creates database tables automatically in development mode.
- The app is designed around a private health and cycle-tracking workflow.
- `docs/` contains additional setup guidance, including email verification setup.

## Roadmap

Planned improvements may include:

- Expanded analytics and cycle trend insights
- More robust production deployment configuration
- Containerization and infrastructure automation
- Greater user-data privacy and consent controls
- Improved onboarding and wellness coaching experience

## License

This project is currently intended for personal or internal use unless a repository-level license is added by the project owner.

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss the proposed improvements.
