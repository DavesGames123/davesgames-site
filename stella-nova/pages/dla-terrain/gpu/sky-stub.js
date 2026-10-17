// ============================================================================
//  DLA TERRAIN  ·  gpu/sky-stub.js — stand-in for sky-state.js (no DOM)
// ----------------------------------------------------------------------------
//  main.js uses this only when SKY's sky-state.js is missing or fails. Same
//  API: skyState(tod, weatherId, season, latitude, t, over) -> the Globals
//  fields that SKY owns, and WEATHER, the list of weather presets.
//  The sun is a plain solar position (hour angle, declination from the
//  season) and a Kasten air mass for its colour. No clouds of its own.
//  World axes: x east, y up, z south (north is -z).
//  grep -n targets: "export const WEATHER", "export function skyState", "export function sunDirection"
// ============================================================================

export const WEATHER = [
  { id: 'clear', label: 'Clear', cover: 0.05, rain: 0, snow: 0, fog: 0.02, wind: 3, storm: 0 },
  { id: 'fair', label: 'Fair', cover: 0.3, rain: 0, snow: 0, fog: 0.04, wind: 4, storm: 0 },
  { id: 'cloudy', label: 'Cloudy', cover: 0.6, rain: 0, snow: 0, fog: 0.06, wind: 6, storm: 0.1 },
  { id: 'overcast', label: 'Overcast', cover: 0.9, rain: 0, snow: 0, fog: 0.1, wind: 6, storm: 0.2 },
  { id: 'fog', label: 'Fog', cover: 0.5, rain: 0, snow: 0, fog: 0.8, wind: 1, storm: 0 },
  { id: 'drizzle', label: 'Drizzle', cover: 0.85, rain: 0.3, snow: 0, fog: 0.2, wind: 5, storm: 0.2 },
  { id: 'rain', label: 'Rain', cover: 0.95, rain: 0.7, snow: 0, fog: 0.25, wind: 9, storm: 0.5 },
  { id: 'thunderstorm', label: 'Thunderstorm', cover: 1, rain: 1, snow: 0, fog: 0.3, wind: 15, storm: 1 },
  { id: 'snow', label: 'Snow', cover: 0.9, rain: 0, snow: 0.7, fog: 0.3, wind: 4, storm: 0.2 },
  { id: 'blizzard', label: 'Blizzard', cover: 1, rain: 0, snow: 1, fog: 0.7, wind: 18, storm: 0.7 },
  { id: 'golden-haze', label: 'Golden hour haze', cover: 0.15, rain: 0, snow: 0, fog: 0.35, wind: 2, storm: 0 },
];

const D2R = Math.PI / 180;

export function sunDirection(tod, season, latDeg) {
  const H = (tod - 0.5) * 2 * Math.PI;
  const dec = 23.44 * D2R * Math.sin(2 * Math.PI * season);
  const lat = latDeg * D2R;
  const east = -Math.cos(dec) * Math.sin(H);
  const north = Math.cos(lat) * Math.sin(dec) - Math.sin(lat) * Math.cos(dec) * Math.cos(H);
  const up = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const l = Math.hypot(east, north, up) || 1;
  return [east / l, up / l, -north / l];
}

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function skyState(tod = 0.5, weatherId = 'clear', season = 0.25, latitude = 45, t = 0, over = {}) {
  const w = { ...(WEATHER.find(x => x.id === weatherId) || WEATHER[0]), ...over };
  const sunDir = sunDirection(tod, season, latitude);
  const el = Math.asin(Math.max(-1, Math.min(1, sunDir[1])));
  const elDeg = el / D2R;
  const m = 1 / (Math.max(0, Math.sin(el)) + 0.50572 * Math.pow(Math.max(0.1, elDeg + 6.07995), -1.6364));
  const tau = [0.09, 0.18, 0.42];
  const vis = smooth(-2, 3, elDeg);
  const cloud = 1 - 0.85 * w.cover;
  const sunColor = tau.map(k => 7.5 * Math.exp(-k * m) * vis * cloud);
  const day = smooth(-8, 15, elDeg);
  const sky = [0.32, 0.48, 0.85].map((c, i) => c * 1.5 * day * (1 - 0.35 * w.cover) + [0.012, 0.014, 0.024][i]);
  const grey = (sky[0] + sky[1] + sky[2]) / 3;
  const ambient = sky.map(c => c + (grey - c) * w.cover * 0.8 + sunColor[1] * 0.04);
  const fogDensity = 2e-5 + w.fog * 8e-4 + w.rain * 1.5e-4 + w.snow * 3e-4;
  const fog = ambient.map((c, i) => c * 0.9 + sunColor[i] * 0.05);
  const moonDir = sunDirection((tod + 0.5) % 1, (season + 0.5) % 1, latitude);
  const ang = (w.dir ?? 0.7) + Math.sin(t * 0.03) * 0.2;
  const lightning = w.storm > 0.6 ? Math.max(0, Math.sin(t * 7.3) * Math.sin(t * 2.1) - 0.97) * 30 : 0;
  return {
    sunDir, sunIlluminance: vis * cloud, sunColor, tod,
    moonDir, moonIlluminance: Math.max(0, moonDir[1]) * 0.08,
    ambient, fog, fogDensity,
    wind: [Math.cos(ang) * w.wind, Math.sin(ang) * w.wind], gust: 0.3 + 0.5 * w.storm, windPhase: t,
    cover: w.cover, rain: w.rain, snow: w.snow, lightning: Math.min(1, lightning),
    wetness: Math.min(1, w.rain * 1.2), snowCover: Math.min(1, w.snow * 1.1 + (season > 0.62 && season < 0.88 ? 0.3 : 0)),
    storminess: w.storm, season, weather: w.id,
  };
}
