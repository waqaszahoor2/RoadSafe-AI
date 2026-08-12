"use client";

import {
  Activity,
  AlertTriangle,
  Bell,
  Car,
  ChartNoAxesCombined,
  CheckCircle2,
  Clock3,
  CloudRain,
  Gauge,
  HeartHandshake,
  History,
  Info,
  LayoutDashboard,
  Map,
  MapPin,
  Menu,
  Moon,
  Navigation,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  Thermometer,
  TrafficCone,
  Umbrella,
  Wind,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

type RiskFactor = { label: string; impact: string };
type HourPoint = { hour: number; risk_score: number };
type Prediction = {
  status: string;
  prediction_generated_at: string;
  user_input: { country: string; state: string; city: string; road_type: string; road_name: string };
  location: { latitude: number; longitude: number; display_name?: string; source?: string };
  current_conditions: {
    local_prediction_time?: string;
    timezone?: string;
    weather?: string;
    temperature_c?: number;
    humidity_pct?: number;
    rain_mm?: number;
    rain_intensity?: string;
    visibility_km?: number;
    wind_speed_kmh?: number;
    road_surface_estimate?: string;
    rush_hour?: boolean;
    night?: boolean;
  };
  traffic: {
    available: boolean;
    source?: string;
    current_speed_kmh?: number;
    free_flow_speed_kmh?: number;
    confidence?: number;
    road_closure?: boolean;
    congestion_label?: string;
    reason?: string;
  };
  road_risk: {
    score: number;
    level: "Low" | "Moderate" | "High" | "Critical";
    interpretation: string;
    components: Record<string, number>;
  };
  severity_prediction: {
    predicted_class: string;
    probabilities_conditional_on_collision: Record<string, number>;
    model_certainty_percent: number;
    important_note: string;
  };
  historical_context: {
    historical_year: number;
    nearby_collision_count: number;
    fatal_count: number;
    serious_count: number;
    slight_count: number;
    hotspot_percentile: number;
    historical_rain_share: number;
    historical_rush_hour_share: number;
    historical_night_share: number;
    grid_match?: string;
  };
  top_risk_factors: RiskFactor[];
  hourly_profile: HourPoint[];
  data_freshness: {
    weather_source?: string;
    weather_updated?: string;
    traffic_source?: string;
    traffic_status?: string;
    historical_dataset?: string;
    historical_dataset_year?: number;
    model?: string;
    model_version?: string;
  };
};

type Units = "metric" | "imperial";
type Theme = "light" | "dark";

const navItems = [
  ["Dashboard", "top", LayoutDashboard],
  ["Live Risk Check", "risk-check", ShieldCheck],
  ["Live Map", "live-map", Map],
  ["Risk Forecast", "forecast", ChartNoAxesCombined],
  ["Hotspots", "live-map", MapPin],
  ["Alerts", "alerts", Bell],
  ["History", "history", History],
  ["Safety Tips", "safety", HeartHandshake],
  ["About Us", "about", Info],
  ["Settings", "settings", Settings],
] as const;

const roadTypes = ["Motorway", "A(M) Road", "A / Main Road", "B / Secondary Road", "C Road", "Local Road / Street"];

function riskColor(level?: string) {
  if (level === "Low") return "#22c55e";
  if (level === "Moderate") return "#f59e0b";
  if (level === "High") return "#f97316";
  return "#ef4444";
}

function formatTimeStamp(value?: string) {
  if (!value) return "Unavailable";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.replace("T", " ");
  return d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function Temperature({ celsius, units }: { celsius?: number; units: Units }) {
  if (celsius == null) return <>Unavailable</>;
  if (units === "imperial") return <>{Math.round(celsius * 9 / 5 + 32)}°F</>;
  return <>{Math.round(celsius)}°C</>;
}

function Distance({ km, units }: { km?: number; units: Units }) {
  if (km == null) return <>Unavailable</>;
  if (units === "imperial") return <>{(km * 0.621371).toFixed(1)} mi</>;
  return <>{km.toFixed(1)} km</>;
}

function GaugeCard({ prediction, loading }: { prediction: Prediction | null; loading: boolean }) {
  const score = prediction?.road_risk.score ?? 0;
  const degree = Math.min(180, Math.max(0, score * 1.8));
  const color = prediction ? riskColor(prediction.road_risk.level) : "#475569";
  return (
    <section className="riskCard" aria-live="polite">
      <div className="cardTopLine">
        <div>
          <span className="eyebrow darkEyebrow">Current Road Risk</span>
          <h2>{prediction ? prediction.road_risk.level + " Risk" : "Awaiting live check"}</h2>
        </div>
        {prediction && <span className={`riskBadge ${prediction.road_risk.level.toLowerCase()}`}>{prediction.road_risk.level} Risk</span>}
      </div>
      <div className="gaugeWrap">
        <div className="gaugeBase">
          <div
            className="gaugeFill"
            style={{
              background: `conic-gradient(from 270deg at 50% 100%, ${color} 0deg ${degree}deg, transparent ${degree}deg 180deg)`,
            }}
          />
          <div className="gaugeHole" />
          <div className="gaugeScore">
            {loading ? <span className="pulseText">Checking…</span> : prediction ? <><strong>{Math.round(score)}</strong><span>/100</span></> : <><strong>—</strong><span>/100</span></>}
          </div>
        </div>
      </div>
      <p className="riskMessage">
        {loading
          ? "Collecting the selected road, live weather and current traffic information."
          : prediction
            ? "Current conditions indicate elevated road risk. Please drive carefully."
            : "Select a real road above. No score is displayed until current data is collected."}
      </p>
      <div className="riskMetaGrid">
        <div><Clock3 size={17}/><span><small>Prediction Time</small>{prediction ? formatTimeStamp(prediction.current_conditions.local_prediction_time) : "Not generated"}</span></div>
        <div><CloudRain size={17}/><span><small>Weather Updated</small>{prediction?.data_freshness.weather_updated ? formatTimeStamp(prediction.data_freshness.weather_updated) : "Not fetched"}</span></div>
        <div><Car size={17}/><span><small>Traffic</small>{prediction?.traffic.available ? "Live" : prediction ? "Unavailable" : "Not checked"}</span></div>
      </div>
    </section>
  );
}

function SeverityDonut({ prediction }: { prediction: Prediction | null }) {
  const probs = prediction?.severity_prediction.probabilities_conditional_on_collision;
  const fatal = (probs?.Fatal ?? 0) * 100;
  const serious = (probs?.Serious ?? 0) * 100;
  const slight = (probs?.Slight ?? 0) * 100;
  const stop1 = fatal;
  const stop2 = fatal + serious;
  const bg = prediction
    ? `conic-gradient(#ef4444 0 ${stop1}%, #f59e0b ${stop1}% ${stop2}%, #22c55e ${stop2}% 100%)`
    : "conic-gradient(#e2e8f0 0 100%)";
  return (
    <section className="panel severityPanel">
      <div className="panelHeading"><div><span className="eyebrow">Collision Severity</span><h3>If a collision occurs</h3></div></div>
      <div className="severityBody">
        <div className="donut" style={{ background: bg }}><div className="donutHole"><ShieldCheck size={25}/></div></div>
        <div className="legendList">
          <div><i className="dot fatal"/><span>Fatal</span><strong>{prediction ? `${fatal.toFixed(1)}%` : "—"}</strong></div>
          <div><i className="dot serious"/><span>Serious</span><strong>{prediction ? `${serious.toFixed(1)}%` : "—"}</strong></div>
          <div><i className="dot slight"/><span>Slight</span><strong>{prediction ? `${slight.toFixed(1)}%` : "—"}</strong></div>
        </div>
      </div>
      <p className="finePrint">These probabilities are conditional on a collision occurring; they are not crash probabilities.</p>
    </section>
  );
}

function ForecastChart({ profile }: { profile?: HourPoint[] }) {
  const data = profile?.length ? profile : [];
  const width = 560;
  const height = 180;
  const left = 28;
  const right = 12;
  const top = 18;
  const bottom = 32;
  const usableW = width - left - right;
  const usableH = height - top - bottom;
  const max = Math.max(100, ...data.map(d => d.risk_score));
  const points = data.map((d, i) => {
    const x = left + (i / 23) * usableW;
    const y = top + usableH - (d.risk_score / max) * usableH;
    return `${x},${y}`;
  }).join(" ");
  const peak = data.reduce<HourPoint | null>((best, d) => !best || d.risk_score > best.risk_score ? d : best, null);
  return (
    <section className="panel forecastPanel" id="forecast">
      <div className="panelHeading">
        <div><span className="eyebrow">Risk Forecast</span><h3>Relative risk by time today</h3></div>
        {peak && <span className="peakBadge">Peak {String(peak.hour).padStart(2, "0")}:00 · {Math.round(peak.risk_score)}/100</span>}
      </div>
      {data.length ? (
        <div className="chartWrap">
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Hourly road risk profile">
            {[0, 25, 50, 75, 100].map(v => {
              const y = top + usableH - (v / max) * usableH;
              return <g key={v}><line x1={left} x2={width-right} y1={y} y2={y} className="gridLine"/><text x="0" y={y+4} className="axisText">{v}</text></g>;
            })}
            <polyline points={points} fill="none" className="riskLine" />
            {data.map((d, i) => {
              if (![0,6,12,18,23].includes(i)) return null;
              const x = left + (i / 23) * usableW;
              return <text key={i} x={x} y={height-7} textAnchor="middle" className="axisText">{i === 23 ? "23" : String(i).padStart(2,"0")}:00</text>;
            })}
          </svg>
          <p className="finePrint">Current weather is held constant to compare time-of-day effects. It is a relative decision-support profile, not a weather forecast.</p>
        </div>
      ) : <div className="emptyPanel"><ChartNoAxesCombined/><p>Run a live road check to generate the time profile.</p></div>}
    </section>
  );
}

function MapPanel({ prediction }: { prediction: Prediction | null }) {
  const mapUrl = useMemo(() => {
    if (!prediction) return null;
    const lat = prediction.location.latitude;
    const lon = prediction.location.longitude;
    const dLat = 0.035;
    const dLon = 0.055;
    const bbox = `${lon-dLon},${lat-dLat},${lon+dLon},${lat+dLat}`;
    return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${lat}%2C${lon}`;
  }, [prediction]);
  return (
    <section className="mapPanel panel" id="live-map">
      <div className="panelHeading"><div><span className="eyebrow">Live Risk Map</span><h3>{prediction ? prediction.user_input.road_name : "Selected road location"}</h3></div>{prediction && <span className="hotspotTag">Hotspot percentile {Math.round(prediction.historical_context.hotspot_percentile)}</span>}</div>
      <div className="mapFrame">
        {mapUrl ? <iframe title="Road location map" src={mapUrl} loading="lazy" referrerPolicy="no-referrer-when-downgrade" /> : <div className="mapEmpty"><Navigation size={32}/><strong>No location selected</strong><span>Your live road result will appear here.</span></div>}
        {prediction && <div className="mapRiskCallout"><MapPin size={17}/><span><strong>{prediction.user_input.road_name}</strong>{prediction.road_risk.level} risk zone</span></div>}
      </div>
    </section>
  );
}

export default function Dashboard({ initialSection }: { initialSection?: string }) {
  const [form, setForm] = useState({
    country: "United Kingdom",
    state: "West Midlands",
    city: "Birmingham",
    road_type: "A / Main Road",
    road_name: "Bristol Road",
  });
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [apiHealthy, setApiHealthy] = useState<boolean | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");
  const [units, setUnits] = useState<Units>("metric");
  const [history, setHistory] = useState<Prediction[]>([]);

  useEffect(() => {
    if (initialSection) {
      setTimeout(() => {
        document.getElementById(initialSection)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }, [initialSection]);

  useEffect(() => {
    const savedTheme = (localStorage.getItem("roadsafe:theme") as Theme) || "light";
    const savedUnits = (localStorage.getItem("roadsafe:units") as Units) || "metric";
    const savedHistory = localStorage.getItem("roadsafe:history");
    setTheme(savedTheme);
    setUnits(savedUnits);
    if (savedHistory) {
      try { setHistory(JSON.parse(savedHistory)); } catch { /* ignore corrupted local value */ }
    }
    fetch("/api/health", { cache: "no-store" })
      .then(r => { setApiHealthy(r.ok); })
      .catch(() => setApiHealthy(false));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("roadsafe:theme", theme);
  }, [theme]);

  useEffect(() => { localStorage.setItem("roadsafe:units", units); }, [units]);

  function scrollTo(id: string) {
    setMobileMenu(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/predict", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Live road prediction failed.");
      setPrediction(data);
      const next = [data, ...history.filter(h => h.user_input.road_name !== data.user_input.road_name || h.user_input.city !== data.user_input.city)].slice(0, 8);
      setHistory(next);
      localStorage.setItem("roadsafe:history", JSON.stringify(next));
      requestAnimationFrame(() => document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Prediction failed.");
    } finally {
      setLoading(false);
    }
  }

  const conditions = prediction?.current_conditions;
  const alerts = prediction ? [
    ...(prediction.road_risk.score >= 75 ? ["Critical road-risk conditions detected for the selected road."] : prediction.road_risk.score >= 50 ? ["Elevated road-risk conditions detected for the selected road."] : []),
    ...(conditions?.rain_mm && conditions.rain_mm > 0 ? [`${conditions.rain_intensity} rain is currently affecting road conditions.`] : []),
    ...(prediction.traffic.road_closure ? ["Live traffic source reports a road closure."] : []),
  ] : [];

  return (
    <div className="appShell" id="top">
      <aside className={`sidebar ${mobileMenu ? "open" : ""}`}>
        <div className="sidebarBrand"><div className="shieldLogo"><ShieldCheck size={27}/></div><div><strong>RoadSafe AI</strong><span>Drive Smart. Stay Safe.</span></div><button className="mobileClose" onClick={() => setMobileMenu(false)} aria-label="Close menu"><X/></button></div>
        <nav>
          {navItems.map(([label, id, Icon], i) => <button key={label} className={i === 0 ? "active" : ""} onClick={() => scrollTo(id)}><Icon size={19}/><span>{label}</span></button>)}
        </nav>
        <div className="sidebarSafety">
          <div className="safetyArtwork"><CloudRain/><Car/></div>
          <strong>{conditions?.rain_mm && conditions.rain_mm > 0 ? "Rain increases road risk" : "Live conditions matter"}</strong>
          <p>{conditions?.rain_mm && conditions.rain_mm > 0 ? "Slow down, increase following distance and avoid sudden braking." : "Check the selected road before you travel and adapt to current conditions."}</p>
          <button onClick={() => scrollTo("safety")}>View Safety Tips</button>
        </div>
      </aside>

      <div className="mainColumn">
        <header className="topbar">
          <button className="menuButton" onClick={() => setMobileMenu(true)} aria-label="Open menu"><Menu/></button>
          <div className={`liveStatus ${apiHealthy === false ? "offline" : ""}`}><i/>{prediction ? "Live Data" : apiHealthy ? "Live Service" : "Service unavailable"}<span>•</span><small>{prediction ? "Updated just now" : apiHealthy ? "Ready for road check" : "Try again"}</small></div>
          <div className="topWeather">{prediction ? <><CloudRain size={25}/><span><strong><Temperature celsius={conditions?.temperature_c} units={units}/></strong><small>{conditions?.weather}</small></span></> : <><Activity size={22}/><span><strong>Ready for road check</strong><small>Select a road below</small></span></>}</div>
          <div className="userChip"><div className="avatar">U</div><span>Hello, User</span></div>
        </header>

        <main className="content">
          <section className="heroRow" id="risk-check">
            <div className="checkArea">
              <div className="sectionTitle"><span className="eyebrow">Live Road Intelligence</span><h1>Check Current Road Risk</h1><p>Real-time road-risk decision support using current weather, optional live traffic and validated historical collision data.</p></div>
              <form className="riskForm" onSubmit={submit}>
                <label><span>Country</span><select value={form.country} onChange={e => setForm({ ...form, country: e.target.value })}><option>United Kingdom</option></select></label>
                <label><span>State / Province</span><input required value={form.state} onChange={e => setForm({ ...form, state: e.target.value })} placeholder="West Midlands"/></label>
                <label><span>City</span><input required value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} placeholder="Birmingham"/></label>
                <label><span>Road Type</span><select value={form.road_type} onChange={e => setForm({ ...form, road_type: e.target.value })}>{roadTypes.map(x => <option key={x}>{x}</option>)}</select></label>
                <label className="roadName"><span>Road Name</span><div className="inputWithIcon"><input required value={form.road_name} onChange={e => setForm({ ...form, road_name: e.target.value })} placeholder="Bristol Road"/><Search size={17}/></div></label>
                <button className="checkButton" disabled={loading || apiHealthy === false}>{loading ? "Collecting live data…" : "Check Current Risk"}<Navigation size={18}/></button>
              </form>
              {error && <div className="errorBox"><AlertTriangle size={19}/><div><strong>Could not generate a live prediction</strong><span>{error}</span></div></div>}
            </div>
            <GaugeCard prediction={prediction} loading={loading}/>
          </section>

          <section className="conditionsPanel panel" id="results">
            <div className="panelHeading"><div><span className="eyebrow">Live Conditions</span><h3>{prediction ? `${prediction.user_input.road_name}, ${prediction.user_input.city}` : "Waiting for a live road check"}</h3></div>{prediction && <span className="sourceTag"><CheckCircle2 size={14}/> Fresh data</span>}</div>
            <div className="conditionGrid">
              <div><CloudRain/><span><small>Weather</small><strong>{conditions?.weather ?? "Waiting for road check"}</strong><em>{conditions ? <Temperature celsius={conditions.temperature_c} units={units}/> : "—"}</em></span></div>
              <div><Umbrella/><span><small>Rain Intensity</small><strong>{conditions?.rain_intensity ?? "Waiting for road check"}</strong><em>{conditions ? `${conditions.rain_mm ?? 0} mm` : "—"}</em></span></div>
              <div><Gauge/><span><small>Visibility</small><strong>{conditions?.visibility_km != null ? (conditions.visibility_km < 10 ? "Reduced" : "Good") : conditions ? "Good" : "Waiting for road check"}</strong><em>{conditions ? <Distance km={conditions.visibility_km} units={units}/> : "—"}</em></span></div>
              <div><TrafficCone/><span><small>Traffic</small><strong>{prediction?.traffic.available ? prediction.traffic.congestion_label : prediction ? "Live traffic unavailable" : "Waiting for road check"}</strong><em>{prediction?.traffic.available ? `${Math.round(prediction.traffic.current_speed_kmh ?? 0)} km/h` : prediction?.traffic.reason ?? "—"}</em></span></div>
              <div><Wind/><span><small>Road Condition</small><strong>{conditions?.road_surface_estimate ?? "Waiting for road check"}</strong><em>{conditions?.rush_hour ? "Rush hour" : conditions?.night ? "Night" : conditions ? "Current period" : "—"}</em></span></div>
            </div>
          </section>

          <section className="analyticsGrid">
            <SeverityDonut prediction={prediction}/>
            <section className="panel factorsPanel"><div className="panelHeading"><div><span className="eyebrow">Top Risk Factors</span><h3>What is affecting the score</h3></div></div>{prediction ? <div className="factorList">{prediction.top_risk_factors.length ? prediction.top_risk_factors.map((f, i) => <div key={i}><span className="factorIcon">{i+1}</span><strong>{f.label}</strong><em className={`impact ${f.impact.toLowerCase()}`}>{f.impact}</em></div>) : <div className="emptyInline"><CheckCircle2/>No major live warning detected.</div>}</div> : <div className="emptyPanel"><Activity/><p>Risk factors appear after a live check.</p></div>}</section>
            <ForecastChart profile={prediction?.hourly_profile}/>
          </section>

          <section className="mapAboutGrid">
            <MapPanel prediction={prediction}/>
            <section className="panel aboutPrediction"><div className="panelHeading"><div><span className="eyebrow">About This Prediction</span><h3>Transparent data sources</h3></div></div><div className="aboutList"><div><ShieldCheck/><span><small>Model Used</small><strong>{prediction?.data_freshness.model ?? "HistGradientBoosting"} {prediction?.data_freshness.model_version ? `v${prediction.data_freshness.model_version}` : ""}</strong></span></div><div><History/><span><small>Historical Data</small><strong>{prediction ? `UK STATS19 (${prediction.data_freshness.historical_dataset_year})` : "UK STATS19 (2025)"}</strong></span></div><div><CloudRain/><span><small>Weather Source</small><strong>{prediction?.data_freshness.weather_source ?? "Open-Meteo"}</strong></span></div><div><Car/><span><small>Traffic Source</small><strong>{prediction?.traffic.available ? prediction.traffic.source : prediction ? "Unavailable" : "TomTom when configured"}</strong></span></div><div><Gauge/><span><small>Model Certainty</small><strong>{prediction ? `${prediction.severity_prediction.model_certainty_percent}%` : "—"}</strong></span></div></div><div className="transparencyNote"><CheckCircle2/><span>Road Risk Index is decision support, not a calibrated probability that a crash will occur.</span></div></section>
          </section>

          <section className="secondaryGrid">
            <section className="panel" id="alerts"><div className="panelHeading"><div><span className="eyebrow">Alerts</span><h3>Current road warnings</h3></div></div>{prediction ? alerts.length ? <div className="alertList">{alerts.map((a, i) => <div key={i}><AlertTriangle/><span>{a}</span></div>)}</div> : <div className="emptyInline"><CheckCircle2/>No additional high-priority alert from the current check.</div> : <div className="emptyPanel"><Bell/><p>Run a live road check to generate condition-based alerts.</p></div>}</section>
            <section className="panel" id="history"><div className="panelHeading"><div><span className="eyebrow">History</span><h3>Recent checks on this device</h3></div><button className="textButton" onClick={() => { setHistory([]); localStorage.removeItem("roadsafe:history"); }}>Clear</button></div>{history.length ? <div className="historyList">{history.map((h, i) => <button key={i} onClick={() => { setPrediction(h); scrollTo("results"); }}><MapPin/><span><strong>{h.user_input.road_name}</strong><small>{h.user_input.city} · {formatTimeStamp(h.current_conditions.local_prediction_time)}</small></span><em style={{color:riskColor(h.road_risk.level)}}>{Math.round(h.road_risk.score)}/100</em></button>)}</div> : <div className="emptyPanel"><History/><p>No saved road checks yet.</p></div>}</section>
          </section>

          <section className="secondaryGrid">
            <section className="panel" id="safety"><div className="panelHeading"><div><span className="eyebrow">Safety Tips</span><h3>Human-centered guidance</h3></div></div><div className="tipsGrid"><div><Umbrella/><strong>Rain</strong><p>Increase following distance, reduce speed smoothly and avoid sudden braking.</p></div><div><Moon/><strong>Night</strong><p>Use appropriate lights, reduce glare and allow more stopping distance.</p></div><div><TrafficCone/><strong>Congestion</strong><p>Keep lane discipline and avoid aggressive lane changes in stop-start traffic.</p></div><div><Sun/><strong>Clear roads</strong><p>Lower risk does not mean no risk. Stay attentive and follow posted limits.</p></div></div></section>
            <section className="panel" id="settings"><div className="panelHeading"><div><span className="eyebrow">Settings</span><h3>Display preferences</h3></div></div><div className="settingsList"><label><span><Thermometer/><strong>Units</strong></span><select value={units} onChange={e => setUnits(e.target.value as Units)}><option value="metric">Metric</option><option value="imperial">Imperial</option></select></label><label><span><Moon/><strong>Appearance</strong></span><select value={theme} onChange={e => setTheme(e.target.value as Theme)}><option value="light">Light</option><option value="dark">Dark</option></select></label></div></section>
          </section>

          <section className="aboutStrip" id="about"><div><CloudRain/><span><strong>Real-time Data</strong><small>Live weather and optional live traffic</small></span></div><div><ShieldCheck/><span><strong>AI Powered</strong><small>Validated ML severity model</small></span></div><div><HeartHandshake/><span><strong>Human Centered</strong><small>Five simple user inputs</small></span></div><div><AlertTriangle/><span><strong>Responsible Output</strong><small>Verified live outputs only</small></span></div></section>
        </main>

        <nav className="mobileBottomNav">
          <button onClick={() => scrollTo("top")}><LayoutDashboard/><span>Dashboard</span></button>
          <button onClick={() => scrollTo("live-map")}><Map/><span>Map</span></button>
          <button onClick={() => scrollTo("alerts")}><Bell/><span>Alerts</span></button>
          <button onClick={() => scrollTo("history")}><History/><span>History</span></button>
          <button onClick={() => setMobileMenu(true)}><Menu/><span>More</span></button>
        </nav>
      </div>
    </div>
  );
}
