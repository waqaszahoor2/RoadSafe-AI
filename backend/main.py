from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any
import math
import os

import joblib
import numpy as np
import pandas as pd
import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
ASSETS = BASE_DIR / "assets"
MODEL_PATH = ASSETS / "roadsafe_uk_severity_champion.joblib"
GRID_PATH = ASSETS / "historical_grid.csv.gz"

SEVERITY_NAMES = {1: "Fatal", 2: "Serious", 3: "Slight"}
ROAD_CLASS_MAP = {
    "Motorway": 1,
    "A(M) Road": 2,
    "A / Main Road": 3,
    "B / Secondary Road": 4,
    "C Road": 5,
    "Local Road / Street": 6,
}
SUPPORTED_COUNTRIES = {"United Kingdom", "UK", "Great Britain"}
MODEL_FEATURES = [
    "latitude", "longitude", "first_road_class", "hour", "day_of_week",
    "month", "is_weekend", "is_rush_hour", "is_night", "hour_sin",
    "hour_cos", "month_sin", "month_cos", "rain_flag", "high_wind_flag",
    "fog_flag", "wet_surface_flag", "ice_snow_surface_flag", "daylight_flag",
]

app = FastAPI(title="RoadSafe AI API", version="2.1.0")

if not MODEL_PATH.exists() or not GRID_PATH.exists():
    raise RuntimeError("Required ML assets are missing from backend/assets")

model = joblib.load(MODEL_PATH)
historical_grid = pd.read_csv(GRID_PATH)
_grid_counts = historical_grid["collision_count"].to_numpy()


class PredictRequest(BaseModel):
    country: str = Field(min_length=2, max_length=80)
    state: str = Field(min_length=2, max_length=100)
    city: str = Field(min_length=2, max_length=100)
    road_type: str
    road_name: str = Field(min_length=2, max_length=140)


def clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return float(max(low, min(high, value)))


def weather_label(code: int | None) -> str:
    code = int(code) if code is not None else -1
    if code == 0:
        return "Clear"
    if code in {1, 2, 3}:
        return "Cloudy"
    if code in {45, 48}:
        return "Fog"
    if code in {51, 53, 55, 56, 57}:
        return "Drizzle"
    if code in {61, 63, 65, 66, 67, 80, 81, 82}:
        return "Rain"
    if code in {71, 73, 75, 77, 85, 86}:
        return "Snow"
    if code in {95, 96, 99}:
        return "Thunderstorm"
    return "Other"


def rain_intensity(rain_mm: float) -> str:
    if rain_mm <= 0:
        return "None"
    if rain_mm < 1:
        return "Light"
    if rain_mm < 3:
        return "Moderate"
    return "Heavy"


def geocode_road(req: PredictRequest) -> dict[str, Any]:
    url = "https://nominatim.openstreetmap.org/search"
    headers = {"User-Agent": "RoadSafeAI-Portfolio/2.1 (+https://vercel.app)"}
    structured = {
        "street": req.road_name,
        "city": req.city,
        "state": req.state,
        "country": req.country,
        "format": "jsonv2",
        "addressdetails": 1,
        "limit": 5,
    }
    try:
        response = requests.get(url, params=structured, headers=headers, timeout=12)
        response.raise_for_status()
        results = response.json()
        if not results:
            response = requests.get(
                url,
                params={
                    "q": f"{req.road_name}, {req.city}, {req.state}, {req.country}",
                    "format": "jsonv2",
                    "addressdetails": 1,
                    "limit": 5,
                },
                headers=headers,
                timeout=12,
            )
            response.raise_for_status()
            results = response.json()
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Road geocoding service unavailable: {exc}") from exc

    if not results:
        raise HTTPException(status_code=404, detail="Road/location could not be resolved. Check city and road name.")

    best = results[0]
    return {
        "latitude": float(best["lat"]),
        "longitude": float(best["lon"]),
        "display_name": best.get("display_name"),
        "address": best.get("address", {}),
        "source": "OpenStreetMap Nominatim",
    }


def fetch_weather(lat: float, lon: float) -> dict[str, Any]:
    current = ",".join([
        "temperature_2m", "relative_humidity_2m", "precipitation", "rain",
        "weather_code", "wind_speed_10m", "wind_gusts_10m", "visibility", "is_day",
    ])
    try:
        response = requests.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": lat,
                "longitude": lon,
                "current": current,
                "timezone": "auto",
                "forecast_days": 1,
            },
            timeout=12,
        )
        response.raise_for_status()
        payload = response.json()
    except requests.RequestException as exc:
        raise HTTPException(
            status_code=503,
            detail="Live weather is unavailable. Prediction stopped; historical weather was not substituted.",
        ) from exc

    c = payload.get("current") or {}
    if not c:
        raise HTTPException(status_code=503, detail="Live weather response did not contain current conditions.")

    rain_mm = float(c.get("rain") or 0)
    precipitation_mm = float(c.get("precipitation") or 0)
    visibility_m = c.get("visibility")
    return {
        "source": "Open-Meteo",
        "updated_time": c.get("time"),
        "timezone": payload.get("timezone"),
        "temperature_c": c.get("temperature_2m"),
        "humidity_pct": c.get("relative_humidity_2m"),
        "precipitation_mm": precipitation_mm,
        "rain_mm": rain_mm,
        "rain_intensity": rain_intensity(rain_mm),
        "weather_code": c.get("weather_code"),
        "weather_label": weather_label(c.get("weather_code")),
        "visibility_km": None if visibility_m is None else round(float(visibility_m) / 1000, 2),
        "wind_speed_kmh": float(c.get("wind_speed_10m") or 0),
        "wind_gusts_kmh": float(c.get("wind_gusts_10m") or 0),
        "is_day": int(c.get("is_day", 1)),
    }


def fetch_traffic(lat: float, lon: float) -> dict[str, Any]:
    api_key = os.getenv("TOMTOM_API_KEY")
    if not api_key:
        return {"available": False, "reason": "TOMTOM_API_KEY is not configured."}
    try:
        response = requests.get(
            "https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json",
            params={"key": api_key, "point": f"{lat},{lon}", "unit": "kmph"},
            timeout=12,
        )
        response.raise_for_status()
        flow = (response.json() or {}).get("flowSegmentData", {})
        current_speed = flow.get("currentSpeed")
        free_speed = flow.get("freeFlowSpeed")
        ratio = None
        if current_speed is not None and free_speed not in {None, 0}:
            ratio = clamp(1 - float(current_speed) / float(free_speed), 0, 1)
        if ratio is None:
            label = "Unknown"
        elif ratio < 0.15:
            label = "Free flowing"
        elif ratio < 0.35:
            label = "Moderate"
        elif ratio < 0.60:
            label = "Heavy"
        else:
            label = "Severe"
        return {
            "available": True,
            "source": "TomTom Traffic Flow",
            "current_speed_kmh": current_speed,
            "free_flow_speed_kmh": free_speed,
            "confidence": flow.get("confidence"),
            "road_closure": bool(flow.get("roadClosure", False)),
            "congestion_ratio": ratio,
            "congestion_label": label,
        }
    except requests.RequestException as exc:
        return {"available": False, "reason": f"Live traffic unavailable: {exc}"}


def env_flags(weather: dict[str, Any]) -> dict[str, int]:
    code = int(weather.get("weather_code") or -1)
    rain_codes = {51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82}
    snow_codes = {71, 73, 75, 77, 85, 86}
    rain_flag = int(float(weather.get("rain_mm") or 0) > 0 or code in rain_codes)
    precipitation = float(weather.get("precipitation_mm") or 0)
    wind = max(float(weather.get("wind_speed_kmh") or 0), float(weather.get("wind_gusts_kmh") or 0))
    temp = weather.get("temperature_c")
    return {
        "rain_flag": rain_flag,
        "high_wind_flag": int(wind >= 56.3),
        "fog_flag": int(code in {45, 48}),
        "wet_surface_flag": int(rain_flag == 1 or precipitation > 0),
        "ice_snow_surface_flag": int(code in snow_codes or (temp is not None and float(temp) <= 0 and precipitation > 0)),
        "daylight_flag": int(weather.get("is_day", 1) == 1),
    }


def build_model_row(lat: float, lon: float, road_type: str, weather: dict[str, Any], hour_override: int | None = None) -> pd.DataFrame:
    if road_type not in ROAD_CLASS_MAP:
        raise HTTPException(status_code=422, detail=f"Unsupported road type. Use one of: {', '.join(ROAD_CLASS_MAP)}")
    updated_time = weather.get("updated_time")
    if not updated_time:
        raise HTTPException(status_code=503, detail="Live weather did not include a local timestamp.")
    dt = datetime.fromisoformat(updated_time)
    hour = dt.hour if hour_override is None else int(hour_override)
    month = dt.month
    stats19_dow = ((dt.weekday() + 1) % 7) + 1
    env = env_flags(weather)
    if hour_override is not None:
        env = dict(env)
        env["daylight_flag"] = int(7 <= hour <= 19)
    row = {
        "latitude": lat,
        "longitude": lon,
        "first_road_class": ROAD_CLASS_MAP[road_type],
        "hour": hour,
        "day_of_week": stats19_dow,
        "month": month,
        "is_weekend": int(stats19_dow in {1, 7}),
        "is_rush_hour": int(7 <= hour <= 9 or 16 <= hour <= 19),
        "is_night": int(hour <= 5 or hour >= 22),
        "hour_sin": math.sin(2 * math.pi * hour / 24),
        "hour_cos": math.cos(2 * math.pi * hour / 24),
        "month_sin": math.sin(2 * math.pi * month / 12),
        "month_cos": math.cos(2 * math.pi * month / 12),
        **env,
    }
    return pd.DataFrame([row])[MODEL_FEATURES]


def historical_context(lat: float, lon: float) -> dict[str, Any]:
    lat_grid = round(lat, 2)
    lon_grid = round(lon, 2)
    exact = historical_grid[(historical_grid.lat_grid == lat_grid) & (historical_grid.lon_grid == lon_grid)]
    if exact.empty:
        distances = (historical_grid.lat_grid - lat_grid) ** 2 + (historical_grid.lon_grid - lon_grid) ** 2
        row = historical_grid.loc[distances.idxmin()]
        match = "nearest historical grid"
    else:
        row = exact.iloc[0]
        match = "exact historical grid"
    return {
        "historical_dataset": "dft_collisions_2025.csv",
        "historical_year": 2025,
        "grid_match": match,
        "nearby_collision_count": int(row.collision_count),
        "fatal_count": int(row.fatal_count),
        "serious_count": int(row.serious_count),
        "slight_count": int(row.slight_count),
        "historical_rain_share": round(float(row.rain_share), 4),
        "historical_rush_hour_share": round(float(row.rush_share), 4),
        "historical_night_share": round(float(row.night_share), 4),
        "hotspot_percentile": round(float(row.hotspot_percentile), 2),
    }


def weather_score(weather: dict[str, Any]) -> float:
    score = 0.0
    rain = float(weather.get("rain_mm") or 0)
    visibility = weather.get("visibility_km")
    wind = max(float(weather.get("wind_speed_kmh") or 0), float(weather.get("wind_gusts_kmh") or 0))
    if rain > 0:
        score += 35
    if rain >= 1:
        score += 10
    if rain >= 3:
        score += 10
    if visibility is not None:
        if visibility < 1:
            score += 30
        elif visibility < 5:
            score += 20
        elif visibility < 10:
            score += 10
    if wind >= 56.3:
        score += 20
    elif wind >= 35:
        score += 10
    if int(weather.get("is_day", 1)) == 0:
        score += 10
    return clamp(score)


def severity_score(probabilities: dict[str, float]) -> float:
    return clamp(100 * (
        probabilities.get("Fatal", 0) * 1.0
        + probabilities.get("Serious", 0) * 0.6
        + probabilities.get("Slight", 0) * 0.2
    ))


def traffic_score(traffic: dict[str, Any]) -> float | None:
    if not traffic.get("available"):
        return None
    if traffic.get("road_closure"):
        return 100.0
    ratio = traffic.get("congestion_ratio")
    return 0.0 if ratio is None else clamp(float(ratio) * 100)


def risk_index(probabilities: dict[str, float], historical: dict[str, Any], weather: dict[str, Any], traffic: dict[str, Any]) -> dict[str, Any]:
    components = {
        "severity_model": severity_score(probabilities),
        "historical_hotspot": clamp(float(historical["hotspot_percentile"])),
        "live_weather": weather_score(weather),
    }
    weights = {"severity_model": 0.45, "historical_hotspot": 0.35, "live_weather": 0.20}
    t_score = traffic_score(traffic)
    if t_score is not None:
        components["live_traffic"] = t_score
        weights = {"severity_model": 0.40, "historical_hotspot": 0.30, "live_weather": 0.15, "live_traffic": 0.15}
    score = sum(components[k] * weights[k] for k in weights) / sum(weights.values())
    score = round(clamp(score), 1)
    level = "Low" if score < 25 else "Moderate" if score < 50 else "High" if score < 75 else "Critical"
    return {"score": score, "level": level, "components": {k: round(v, 1) for k, v in components.items()}}


def model_probabilities(row: pd.DataFrame) -> dict[str, float]:
    proba = model.predict_proba(row)[0]
    return {SEVERITY_NAMES[int(cls)]: float(p) for cls, p in zip(model.classes_, proba)}


def risk_factors(row: pd.DataFrame, weather: dict[str, Any], traffic: dict[str, Any], historical: dict[str, Any]) -> list[dict[str, str]]:
    features = row.iloc[0]
    factors: list[dict[str, str]] = []
    if float(weather.get("rain_mm") or 0) > 0:
        factors.append({"label": f"{weather['rain_intensity']} current rain", "impact": "High"})
    if weather.get("visibility_km") is not None and float(weather["visibility_km"]) < 10:
        factors.append({"label": f"Reduced visibility ({weather['visibility_km']} km)", "impact": "High" if float(weather["visibility_km"]) < 5 else "Moderate"})
    if int(features["is_rush_hour"]) == 1:
        factors.append({"label": "Current rush-hour period", "impact": "High"})
    if int(features["is_night"]) == 1:
        factors.append({"label": "Night-time conditions", "impact": "Moderate"})
    if int(features["wet_surface_flag"]) == 1:
        factors.append({"label": "Estimated wet road surface", "impact": "High"})
    if float(historical["hotspot_percentile"]) >= 75:
        factors.append({"label": "Historically elevated collision hotspot", "impact": "Moderate"})
    if traffic.get("available"):
        if traffic.get("road_closure"):
            factors.append({"label": "Live road closure", "impact": "High"})
        elif traffic.get("congestion_label") in {"Heavy", "Severe"}:
            factors.append({"label": f"{traffic['congestion_label']} live congestion", "impact": "High"})
    return factors[:6]


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "RoadSafe AI API", "status": "ok", "version": "2.1.0"}


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "model_loaded": True,
        "model": "HistGradientBoosting",
        "historical_dataset": "dft_collisions_2025.csv",
        "historical_year": 2025,
        "traffic_configured": bool(os.getenv("TOMTOM_API_KEY")),
    }


@app.post("/predict")
def predict(req: PredictRequest) -> dict[str, Any]:
    if req.country not in SUPPORTED_COUNTRIES:
        raise HTTPException(status_code=422, detail=f"A validated country-specific model is not available for {req.country}. Current production model supports the United Kingdom only.")
    if req.road_type not in ROAD_CLASS_MAP:
        raise HTTPException(status_code=422, detail="Please select a supported road type.")

    location = geocode_road(req)
    weather = fetch_weather(location["latitude"], location["longitude"])
    traffic = fetch_traffic(location["latitude"], location["longitude"])
    row = build_model_row(location["latitude"], location["longitude"], req.road_type, weather)
    probabilities = model_probabilities(row)
    predicted_code = int(model.predict(row)[0])
    historical = historical_context(location["latitude"], location["longitude"])
    risk = risk_index(probabilities, historical, weather, traffic)

    profile = []
    for hour in range(24):
        hrow = build_model_row(location["latitude"], location["longitude"], req.road_type, weather, hour_override=hour)
        hprobs = model_probabilities(hrow)
        hrisk = risk_index(hprobs, historical, weather, traffic)
        profile.append({"hour": hour, "risk_score": hrisk["score"]})

    features = row.iloc[0]
    return {
        "status": "ok",
        "prediction_generated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "user_input": req.model_dump(),
        "location": location,
        "current_conditions": {
            "local_prediction_time": weather.get("updated_time"),
            "timezone": weather.get("timezone"),
            "weather": weather.get("weather_label"),
            "temperature_c": weather.get("temperature_c"),
            "humidity_pct": weather.get("humidity_pct"),
            "rain_mm": weather.get("rain_mm"),
            "rain_intensity": weather.get("rain_intensity"),
            "visibility_km": weather.get("visibility_km"),
            "wind_speed_kmh": weather.get("wind_speed_kmh"),
            "road_surface_estimate": "Wet" if int(features["wet_surface_flag"]) else "Dry",
            "rush_hour": bool(features["is_rush_hour"]),
            "night": bool(features["is_night"]),
        },
        "traffic": traffic,
        "road_risk": {
            **risk,
            "interpretation": "Decision-support Road Risk Index; not a calibrated probability that a collision will occur.",
        },
        "severity_prediction": {
            "predicted_class": SEVERITY_NAMES[predicted_code],
            "probabilities_conditional_on_collision": {k: round(v, 6) for k, v in probabilities.items()},
            "model_certainty_percent": round(max(probabilities.values()) * 100, 1),
            "important_note": "Fatal/Serious/Slight probabilities are conditional on a collision occurring.",
        },
        "historical_context": historical,
        "top_risk_factors": risk_factors(row, weather, traffic, historical),
        "hourly_profile": profile,
        "data_freshness": {
            "weather_source": weather.get("source"),
            "weather_updated": weather.get("updated_time"),
            "traffic_source": traffic.get("source") if traffic.get("available") else "Unavailable",
            "traffic_status": "Live" if traffic.get("available") else traffic.get("reason"),
            "historical_dataset": "dft_collisions_2025.csv",
            "historical_dataset_year": 2025,
            "model": "HistGradientBoosting",
            "model_version": "2.1.0",
        },
    }
