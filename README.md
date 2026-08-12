# RoadSafe AI — Production Full-Stack Project

RoadSafe AI is a responsive road-risk decision-support application built from the validated UK 2025 STATS19 workflow.

## Production architecture

- `frontend/` — Next.js 16.3 responsive web application
- `backend/` — FastAPI ML service
- `backend/assets/roadsafe_uk_severity_champion.joblib` — trained HistGradientBoosting pipeline
- `backend/assets/historical_grid.csv.gz` — compact historical hotspot grid derived from UK STATS19 2025
- `vercel.json` — Vercel Services configuration that deploys Next.js + FastAPI together
- `research/` — supplied notebook, validation report, dataset pack, and UI reference

## User inputs

The public interface asks for only five understandable fields:

1. Country
2. State / Province
3. City
4. Road Type
5. Road Name

All technical features are generated automatically in the backend.

## Live data flow

Road selection → Nominatim geocoding → Open-Meteo current weather → TomTom traffic when configured → current-time feature engineering → historical hotspot context → trained ML severity model → Road Risk Index + conditional severity profile.

The application does **not** display a placeholder/dummy risk score before a real request. There is **no demo mode**.

## Current model scope

The deployed ML model is validated for the United Kingdom only. Requests for unvalidated countries must not be presented as real local ML predictions. Add a country-specific model before enabling another country in production.

## Local run

Backend:

```bash
cd backend
python -m venv .venv
# activate the environment
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Frontend in a second terminal:

```bash
cd frontend
npm install
# copy .env.example to .env.local if needed
npm run dev
```

Open `http://localhost:3000`.

## Optional live traffic

Set `TOMTOM_API_KEY` for the backend service. Without it, RoadSafe AI clearly shows traffic as unavailable and does not invent values.

See `DEPLOYMENT.md` for Vercel settings.
