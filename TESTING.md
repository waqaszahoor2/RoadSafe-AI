# RoadSafe AI QA Checklist

## Backend

- `GET /health` returns 200.
- ML model loads from `backend/assets`.
- Historical grid loads from `backend/assets`.
- Invalid road returns a clear 404 response.
- Non-UK model request returns 422 instead of silently using the UK model.
- Weather failure stops the live prediction; old weather is not substituted.
- Missing TomTom key leaves traffic unavailable without breaking the prediction.
- Severity probabilities sum to approximately 1.
- Hourly profile returns 24 relative-risk points.

## Frontend

- No 0–100 score is displayed before a real live check.
- No demo mode exists.
- Form exposes only Country, State/Province, City, Road Type, Road Name.
- Mobile layout has bottom navigation and responsive cards.
- Desktop layout has sidebar and dashboard panels.
- Live result updates weather, rain, visibility, traffic, risk factors, severity, map, history and alerts.
- History stores only the user's recent checks locally in the browser.
- Unit and appearance settings persist in localStorage.

## Deployment

- Vercel Root Directory is repository root.
- `/` loads after a fresh deployment and after browser refresh.
- `/api/health` reaches FastAPI through the internal service binding.
