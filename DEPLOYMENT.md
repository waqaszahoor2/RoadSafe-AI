# Vercel Deployment — 404-Safe Configuration

## Important root-directory rule

**Import/deploy the repository root. Do not set the Vercel Root Directory to `frontend/`, `backend/`, `apps/web`, or another subfolder.**

The repository root contains `vercel.json`, which defines both services:

- `web` → `frontend/` → Next.js
- `api` → `backend/` → FastAPI

The top-level rewrite sends every public route to the Next.js frontend. The FastAPI service is reached privately through a Vercel service binding.

### Vercel Project Settings

- Root Directory: **leave blank / repository root (`.`)**
- Framework preset: **do not override the service configuration**
- Build Command: **leave automatic**
- Output Directory: **leave automatic**
- Install Command: **leave automatic**

## Why this avoids the previous 404 problem

1. `vercel.json` is at repository root.
2. Public requests use the top-level catch-all rewrite to the `web` service.
3. `frontend/app/page.tsx` defines `/`.
4. Next.js App Router handles production routes normally; the project is not configured as a static export.
5. `frontend/app/not-found.tsx` handles valid application 404 pages instead of a broken deployment root.
6. The Python backend is not expected to serve the frontend.

## Environment variable

Optional:

```text
TOMTOM_API_KEY=your_tomtom_key
```

Add it to the Vercel project environment for Production and Preview if live traffic is required.

No frontend public API key is required for Open-Meteo or Nominatim in this build; those services are called server-side from FastAPI.

## Production verification after deploy

Check these routes:

- `/` → RoadSafe AI dashboard
- `/api/health` → JSON health response
- submit a real UK road → live prediction result
- refresh `/` → must not return Vercel 404

If the deployment itself returns `404: NOT_FOUND`, verify that Vercel imported the **repository root** and is reading the root `vercel.json`.
