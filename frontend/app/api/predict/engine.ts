import modelAssets from "./assets/model_assets.json";
import historicalGridData from "./assets/historical_grid.json";

export interface PredictRequest {
  country: string;
  state: string;
  city: string;
  road_type: string;
  road_name: string;
}

const ROAD_CLASS_MAP: Record<string, number> = {
  "Motorway": 1,
  "A(M) Road": 2,
  "A / Main Road": 3,
  "B / Secondary Road": 4,
  "C Road": 5,
  "Local Road / Street": 6,
};

const SEVERITY_NAMES: Record<number, string> = {
  1: "Fatal",
  2: "Serious",
  3: "Slight",
};

interface TreeNode {
  v: number;
  f: number;
  t: number;
  m: boolean;
  l: number;
  r: number;
  leaf: boolean;
}

interface ModelAssets {
  baseline: number[];
  classes: number[];
  trees: TreeNode[][][];
}

const assets = modelAssets as unknown as ModelAssets;

interface GridRow {
  lat_grid: number;
  lon_grid: number;
  collision_count: number;
  fatal_count: number;
  serious_count: number;
  slight_count: number;
  rain_share: number;
  rush_share: number;
  night_share: number;
  hotspot_percentile: number;
}

const gridList: GridRow[] = (historicalGridData as number[][]).map((r) => ({
  lat_grid: r[0],
  lon_grid: r[1],
  collision_count: r[2],
  fatal_count: r[3],
  serious_count: r[4],
  slight_count: r[5],
  rain_share: r[6],
  rush_share: r[7],
  night_share: r[8],
  hotspot_percentile: r[9],
}));

function clamp(val: number, low = 0.0, high = 100.0): number {
  return Math.max(low, Math.min(high, val));
}

function weatherLabel(code?: number | null): string {
  const c = code != null ? Number(code) : -1;
  if (c === 0) return "Clear";
  if ([1, 2, 3].includes(c)) return "Cloudy";
  if ([45, 48].includes(c)) return "Fog";
  if ([51, 53, 55, 56, 57].includes(c)) return "Drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(c)) return "Rain";
  if ([71, 73, 75, 77, 85, 86].includes(c)) return "Snow";
  if ([95, 96, 99].includes(c)) return "Thunderstorm";
  return "Other";
}

function rainIntensity(rainMm: number): string {
  if (rainMm <= 0) return "None";
  if (rainMm < 1) return "Light";
  if (rainMm < 3) return "Moderate";
  return "Heavy";
}

export async function geocodeRoad(req: PredictRequest) {
  const url = "https://nominatim.openstreetmap.org/search";
  const headers = { "User-Agent": "RoadSafeAI/2.1 (+https://vercel.app)" };

  const query1 = new URLSearchParams({
    street: req.road_name,
    city: req.city,
    state: req.state,
    country: req.country,
    format: "jsonv2",
    addressdetails: "1",
    limit: "5",
  });

  try {
    let res = await fetch(`${url}?${query1.toString()}`, { headers, cache: "no-store" });
    let results = res.ok ? await res.json() : [];

    if (!Array.isArray(results) || results.length === 0) {
      const query2 = new URLSearchParams({
        q: `${req.road_name}, ${req.city}, ${req.state}, ${req.country}`,
        format: "jsonv2",
        addressdetails: "1",
        limit: "5",
      });
      res = await fetch(`${url}?${query2.toString()}`, { headers, cache: "no-store" });
      results = res.ok ? await res.json() : [];
    }

    if (!Array.isArray(results) || results.length === 0) {
      throw new Error(`Road could not be located. Check city (${req.city}) and road name (${req.road_name}).`);
    }

    const best = results[0];
    return {
      latitude: parseFloat(best.lat),
      longitude: parseFloat(best.lon),
      display_name: best.display_name,
      address: best.address || {},
      source: "OpenStreetMap Nominatim",
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes("could not be located")) {
      throw err;
    }
    throw new Error("Geocoding service unavailable. Please check your road selection.");
  }
}

export async function fetchWeather(lat: number, lon: number) {
  const currentParams = [
    "temperature_2m",
    "relative_humidity_2m",
    "precipitation",
    "rain",
    "weather_code",
    "wind_speed_10m",
    "wind_gusts_10m",
    "visibility",
    "is_day",
  ].join(",");

  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    current: currentParams,
    timezone: "auto",
    forecast_days: "1",
  });

  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Live weather request failed");
    const payload = await res.json();
    const c = payload.current;
    if (!c) throw new Error("Weather response missing current conditions");

    const rainMm = parseFloat(c.rain || 0);
    const precipMm = parseFloat(c.precipitation || 0);
    const visM = c.visibility;

    return {
      source: "Open-Meteo",
      updated_time: c.time,
      timezone: payload.timezone,
      temperature_c: c.temperature_2m,
      humidity_pct: c.relative_humidity_2m,
      precipitation_mm: precipMm,
      rain_mm: rainMm,
      rain_intensity: rainIntensity(rainMm),
      weather_code: c.weather_code,
      weather_label: weatherLabel(c.weather_code),
      visibility_km: visM != null ? Math.round((parseFloat(visM) / 1000) * 100) / 100 : null,
      wind_speed_kmh: parseFloat(c.wind_speed_10m || 0),
      wind_gusts_kmh: parseFloat(c.wind_gusts_10m || 0),
      is_day: Number(c.is_day ?? 1),
    };
  } catch {
    throw new Error("Live weather temporarily unavailable.");
  }
}

export async function fetchTraffic(lat: number, lon: number) {
  const apiKey = process.env.TOMTOM_API_KEY || "sMPHPXv4BUyuYirFGrnoYJs6nJXn0Ldj";
  if (!apiKey) {
    return { available: false, reason: "Live traffic unavailable (TOMTOM_API_KEY not configured)." };
  }

  const url = `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?key=${apiKey}&point=${lat},${lon}&unit=kmph`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { available: false, reason: "Live traffic unavailable." };
    const data = await res.json();
    const flow = data?.flowSegmentData || {};
    const currentSpeed = flow.currentSpeed;
    const freeSpeed = flow.freeFlowSpeed;

    let ratio: number | null = null;
    if (currentSpeed != null && freeSpeed && freeSpeed > 0) {
      ratio = clamp(1 - parseFloat(currentSpeed) / parseFloat(freeSpeed), 0, 1);
    }

    let label = "Unknown";
    if (ratio != null) {
      if (ratio < 0.15) label = "Free flowing";
      else if (ratio < 0.35) label = "Moderate";
      else if (ratio < 0.60) label = "Heavy";
      else label = "Severe";
    }

    return {
      available: true,
      source: "TomTom Traffic Flow",
      current_speed_kmh: currentSpeed,
      free_flow_speed_kmh: freeSpeed,
      confidence: flow.confidence,
      road_closure: Boolean(flow.roadClosure),
      congestion_ratio: ratio,
      congestion_label: label,
    };
  } catch {
    return { available: false, reason: "Live traffic unavailable." };
  }
}

function computeEnvFlags(weather: Record<string, any>) {
  const code = Number(weather.weather_code ?? -1);
  const rainCodes = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82]);
  const snowCodes = new Set([71, 73, 75, 77, 85, 86]);
  const rainFlag = parseFloat(weather.rain_mm || 0) > 0 || rainCodes.has(code) ? 1 : 0;
  const precip = parseFloat(weather.precipitation_mm || 0);
  const wind = Math.max(parseFloat(weather.wind_speed_kmh || 0), parseFloat(weather.wind_gusts_kmh || 0));
  const temp = weather.temperature_c;

  return {
    rain_flag: rainFlag,
    high_wind_flag: wind >= 56.3 ? 1 : 0,
    fog_flag: [45, 48].includes(code) ? 1 : 0,
    wet_surface_flag: rainFlag === 1 || precip > 0 ? 1 : 0,
    ice_snow_surface_flag: snowCodes.has(code) || (temp != null && parseFloat(temp) <= 0 && precip > 0) ? 1 : 0,
    daylight_flag: Number(weather.is_day ?? 1) === 1 ? 1 : 0,
  };
}

function constructFeatureVector(
  lat: number,
  lon: number,
  roadType: string,
  weather: Record<string, any>,
  hourOverride?: number,
): { features: number[]; is_rush_hour: number; is_night: number; wet_surface_flag: number } {
  const classCode = ROAD_CLASS_MAP[roadType] || 3;
  const dt = weather.updated_time ? new Date(weather.updated_time) : new Date();

  const hour = hourOverride ?? dt.getUTCHours();
  const month = dt.getUTCMonth() + 1;
  const stats19Dow = ((dt.getUTCDay() + 1) % 7) + 1;

  const env = computeEnvFlags(weather);
  if (hourOverride != null) {
    env.daylight_flag = hour >= 7 && hour <= 19 ? 1 : 0;
  }

  const is_rush_hour = (hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 19) ? 1 : 0;
  const is_night = hour <= 5 || hour >= 22 ? 1 : 0;
  const is_weekend = [1, 7].includes(stats19Dow) ? 1 : 0;

  const hourSin = Math.sin((2 * Math.PI * hour) / 24);
  const hourCos = Math.cos((2 * Math.PI * hour) / 24);
  const monthSin = Math.sin((2 * Math.PI * month) / 12);
  const monthCos = Math.cos((2 * Math.PI * month) / 12);

  const features = [
    lat,
    lon,
    hour,
    stats19Dow,
    month,
    is_weekend,
    is_rush_hour,
    is_night,
    hourSin,
    hourCos,
    monthSin,
    monthCos,
    env.rain_flag,
    env.high_wind_flag,
    env.fog_flag,
    env.wet_surface_flag,
    env.ice_snow_surface_flag,
    env.daylight_flag,
    classCode === 1 ? 1 : 0,
    classCode === 2 ? 1 : 0,
    classCode === 3 ? 1 : 0,
    classCode === 4 ? 1 : 0,
    classCode === 5 ? 1 : 0,
    classCode === 6 ? 1 : 0,
  ];

  return { features, is_rush_hour, is_night, wet_surface_flag: env.wet_surface_flag };
}

function evaluateModelProbabilities(features: number[]): Record<string, number> {
  const rawPred = [...assets.baseline];

  for (const iteration of assets.trees) {
    for (let cIdx = 0; cIdx < iteration.length; cIdx++) {
      const nodes = iteration[cIdx];
      let idx = 0;
      while (!nodes[idx].leaf) {
        const node = nodes[idx];
        const val = features[node.f];
        if (Number.isNaN(val)) {
          idx = node.m ? node.l : node.r;
        } else if (val <= node.t) {
          idx = node.l;
        } else {
          idx = node.r;
        }
      }
      rawPred[cIdx] += nodes[idx].v;
    }
  }

  const maxVal = Math.max(...rawPred);
  const expVals = rawPred.map((v) => Math.exp(v - maxVal));
  const sumExp = expVals.reduce((a, b) => a + b, 0);
  const probs = expVals.map((v) => v / sumExp);

  const res: Record<string, number> = {};
  assets.classes.forEach((clsCode, i) => {
    const name = SEVERITY_NAMES[clsCode] || `Class_${clsCode}`;
    res[name] = probs[i];
  });
  return res;
}

function lookupHistoricalGrid(lat: number, lon: number) {
  const latGrid = Math.round(lat * 100) / 100;
  const lonGrid = Math.round(lon * 100) / 100;

  let exact = gridList.find((g) => Math.abs(g.lat_grid - latGrid) < 0.001 && Math.abs(g.lon_grid - lonGrid) < 0.001);
  let match = "exact historical grid";

  if (!exact) {
    match = "nearest historical grid";
    let minDist = Infinity;
    for (const g of gridList) {
      const dist = (g.lat_grid - latGrid) ** 2 + (g.lon_grid - lonGrid) ** 2;
      if (dist < minDist) {
        minDist = dist;
        exact = g;
      }
    }
  }

  const row = exact || {
    collision_count: 5,
    fatal_count: 0,
    serious_count: 1,
    slight_count: 4,
    rain_share: 0.15,
    rush_share: 0.25,
    night_share: 0.20,
    hotspot_percentile: 50.0,
  };

  return {
    historical_dataset: "dft_collisions_2025.csv",
    historical_year: 2025,
    grid_match: match,
    nearby_collision_count: row.collision_count,
    fatal_count: row.fatal_count,
    serious_count: row.serious_count,
    slight_count: row.slight_count,
    historical_rain_share: row.rain_share,
    historical_rush_hour_share: row.rush_share,
    historical_night_share: row.night_share,
    hotspot_percentile: row.hotspot_percentile,
  };
}

function weatherScore(weather: Record<string, any>): number {
  let score = 0;
  const rain = parseFloat(weather.rain_mm || 0);
  const vis = weather.visibility_km;
  const wind = Math.max(parseFloat(weather.wind_speed_kmh || 0), parseFloat(weather.wind_gusts_kmh || 0));

  if (rain > 0) score += 35;
  if (rain >= 1) score += 10;
  if (rain >= 3) score += 10;

  if (vis != null) {
    if (vis < 1) score += 30;
    else if (vis < 5) score += 20;
    else if (vis < 10) score += 10;
  }

  if (wind >= 56.3) score += 20;
  else if (wind >= 35) score += 10;

  if (Number(weather.is_day ?? 1) === 0) score += 10;

  return clamp(score);
}

function severityScore(probs: Record<string, number>): number {
  return clamp(100 * ((probs["Fatal"] || 0) * 1.0 + (probs["Serious"] || 0) * 0.6 + (probs["Slight"] || 0) * 0.2));
}

function trafficScore(traffic: Record<string, any>): number | null {
  if (!traffic.available) return null;
  if (traffic.road_closure) return 100.0;
  return traffic.congestion_ratio != null ? clamp(traffic.congestion_ratio * 100) : 0.0;
}

function calculateRiskIndex(
  probs: Record<string, number>,
  historical: Record<string, any>,
  weather: Record<string, any>,
  traffic: Record<string, any>,
) {
  const components: Record<string, number> = {
    severity_model: severityScore(probs),
    historical_hotspot: clamp(historical.hotspot_percentile),
    live_weather: weatherScore(weather),
  };

  let weights: Record<string, number> = {
    severity_model: 0.45,
    historical_hotspot: 0.35,
    live_weather: 0.20,
  };

  const tScore = trafficScore(traffic);
  if (tScore != null) {
    components.live_traffic = tScore;
    weights = { severity_model: 0.40, historical_hotspot: 0.30, live_weather: 0.15, live_traffic: 0.15 };
  }

  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  const rawScore = Object.keys(weights).reduce((sum, k) => sum + components[k] * weights[k], 0) / totalWeight;
  const score = Math.round(clamp(rawScore) * 10) / 10;

  const level = score < 25 ? "Low" : score < 50 ? "Moderate" : score < 75 ? "High" : "Critical";

  const roundedComp: Record<string, number> = {};
  for (const k of Object.keys(components)) {
    roundedComp[k] = Math.round(components[k] * 10) / 10;
  }

  return { score, level, components: roundedComp };
}

function generateRiskFactors(
  vec: { is_rush_hour: number; is_night: number; wet_surface_flag: number },
  weather: Record<string, any>,
  traffic: Record<string, any>,
  historical: Record<string, any>,
) {
  const factors: { label: string; impact: string }[] = [];

  if (parseFloat(weather.rain_mm || 0) > 0) {
    factors.push({ label: `${weather.rain_intensity} current rain`, impact: "High" });
  }
  if (weather.visibility_km != null && weather.visibility_km < 10) {
    factors.push({
      label: `Reduced visibility (${weather.visibility_km} km)`,
      impact: weather.visibility_km < 5 ? "High" : "Moderate",
    });
  }
  if (vec.is_rush_hour === 1) {
    factors.push({ label: "Current rush-hour period", impact: "High" });
  }
  if (vec.is_night === 1) {
    factors.push({ label: "Night-time conditions", impact: "Moderate" });
  }
  if (vec.wet_surface_flag === 1) {
    factors.push({ label: "Estimated wet road surface", impact: "High" });
  }
  if (historical.hotspot_percentile >= 75) {
    factors.push({ label: "Historically elevated collision hotspot", impact: "Moderate" });
  }
  if (traffic.available) {
    if (traffic.road_closure) {
      factors.push({ label: "Live road closure", impact: "High" });
    } else if (["Heavy", "Severe"].includes(traffic.congestion_label)) {
      factors.push({ label: `${traffic.congestion_label} live congestion`, impact: "High" });
    }
  }

  return factors.slice(0, 6);
}

export async function runPredictionPipeline(req: PredictRequest) {
  const location = await geocodeRoad(req);
  const weather = await fetchWeather(location.latitude, location.longitude);
  const traffic = await fetchTraffic(location.latitude, location.longitude);

  const vec = constructFeatureVector(location.latitude, location.longitude, req.road_type, weather);
  const probabilities = evaluateModelProbabilities(vec.features);
  const historical = lookupHistoricalGrid(location.latitude, location.longitude);
  const risk = calculateRiskIndex(probabilities, historical, weather, traffic);

  let topProbClass = "Slight";
  let maxProb = -1;
  for (const [cls, p] of Object.entries(probabilities)) {
    if (p > maxProb) {
      maxProb = p;
      topProbClass = cls;
    }
  }

  const profile: { hour: number; risk_score: number }[] = [];
  for (let hour = 0; hour < 24; hour++) {
    const hVec = constructFeatureVector(location.latitude, location.longitude, req.road_type, weather, hour);
    const hProbs = evaluateModelProbabilities(hVec.features);
    const hRisk = calculateRiskIndex(hProbs, historical, weather, traffic);
    profile.push({ hour, risk_score: hRisk.score });
  }

  return {
    status: "ok",
    prediction_generated_at: new Date().toISOString(),
    user_input: req,
    location,
    current_conditions: {
      local_prediction_time: weather.updated_time,
      timezone: weather.timezone,
      weather: weather.weather_label,
      temperature_c: weather.temperature_c,
      humidity_pct: weather.humidity_pct,
      rain_mm: weather.rain_mm,
      rain_intensity: weather.rain_intensity,
      visibility_km: weather.visibility_km,
      wind_speed_kmh: weather.wind_speed_kmh,
      road_surface_estimate: vec.wet_surface_flag === 1 ? "Wet" : "Dry",
      rush_hour: vec.is_rush_hour === 1,
      night: vec.is_night === 1,
    },
    traffic,
    road_risk: {
      ...risk,
      interpretation: "Decision-support Road Risk Index; not a calibrated probability that a collision will occur.",
    },
    severity_prediction: {
      predicted_class: topProbClass,
      probabilities_conditional_on_collision: probabilities,
      model_certainty_percent: Math.round(maxProb * 1000) / 10,
      important_note: "Fatal/Serious/Slight probabilities are conditional on a collision occurring.",
    },
    historical_context: historical,
    top_risk_factors: generateRiskFactors(vec, weather, traffic, historical),
    hourly_profile: profile,
    data_freshness: {
      weather_source: weather.source,
      weather_updated: weather.updated_time,
      traffic_source: traffic.available ? traffic.source : "Unavailable",
      traffic_status: traffic.available ? "Live" : traffic.reason,
      historical_dataset: "dft_collisions_2025.csv",
      historical_dataset_year: 2025,
      model: "HistGradientBoosting",
      model_version: "2.1.0",
    },
  };
}
