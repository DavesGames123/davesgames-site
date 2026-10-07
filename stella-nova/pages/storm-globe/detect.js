// ============================================================================
//  STORM GLOBE  ·  detect.js  ·  deep lows and wind maxima in a GFS frame
// ----------------------------------------------------------------------------
//  No DOM. Extreme weather that no agency names as a cyclone: deep
//  extratropical lows (local sea-level pressure minima below LOW_HPA, or
//  LOW_HPA_POLAR poleward of 50 deg; none past 65 deg) and
//  the strongest 10 m wind maxima. Both stay at least AWAY_KM from a named
//  storm, so the list does not repeat it. The tour visits them, and with
//  no active storms they are the whole tour.
//
//  findLows(frame, grid, storms) -> [{ kind:'low', lat, lon, hpa, wind }]
//  findJets(frame, grid, storms) -> [{ kind:'jet', lat, lon, wind }]
//  regionName(lat, lon) -> 'North Atlantic', ...
//
//  grep -n targets: "export function findLows", "export function findJets"
// ============================================================================
const D = Math.PI / 180, R_KM = 6371;
export const LOW_HPA = 990, LOW_HPA_POLAR = 970, JET_MS = 20, AWAY_KM = 900;

function distKm(a, b) {
  const c = Math.sin(a.lat * D) * Math.sin(b.lat * D) + Math.cos(a.lat * D) * Math.cos(b.lat * D) * Math.cos((a.lon - b.lon) * D);
  return Math.acos(Math.max(-1, Math.min(1, c))) * R_KM;
}
function cells(grid) {
  const dl = 360 / grid.nx, dp = 180 / (grid.ny - 1);
  return { dl, dp, lat: j => -90 + j * dp, lon: i => { const l = i * dl; return l > 180 ? l - 360 : l; } };
}
// local extrema of f (sign -1 = minima) over a (2k+1)^2 window, sorted
function extrema(f, grid, k, sign, keep) {
  const { nx, ny } = grid, out = [];
  for (let j = k; j < ny - k; j++) for (let i = 0; i < nx; i++) {
    const v = f[j * nx + i] * sign;
    if (!keep(f[j * nx + i], j, i)) continue;
    let best = true;
    for (let b = -k; b <= k && best; b++) for (let a = -k; a <= k; a++) {
      if (!a && !b) continue;
      const w = f[(j + b) * nx + ((i + a) % nx + nx) % nx] * sign;
      if (w > v || (w === v && (b < 0 || (b === 0 && a < 0)))) { best = false; break; }
    }
    if (best) out.push([j, i, f[j * nx + i]]);
  }
  return out.sort((x, y) => (y[2] - x[2]) * sign);
}
function spaced(list, minKm, max) {
  const out = [];
  for (const e of list) { if (out.every(o => distKm(o, e) > minKm)) out.push(e); if (out.length >= max) break; }
  return out;
}
function speedAt(frame, grid, j, i) { const k = j * grid.nx + i; return Math.hypot(frame.u[k], frame.v[k]); }
function maxWindNear(frame, grid, j, i, r) {
  let m = 0;
  for (let b = -r; b <= r; b++) for (let a = -r; a <= r; a++) {
    const jj = j + b; if (jj < 0 || jj >= grid.ny) continue;
    m = Math.max(m, speedAt(frame, grid, jj, ((i + a) % grid.nx + grid.nx) % grid.nx));
  }
  return m;
}
export function findLows(frame, grid, storms = [], max = 6) {
  const C = cells(grid), k = Math.max(2, Math.round(6 / C.dp));
  // Subpolar lows below 990 hPa are routine, and sea-level pressure over
  // the Antarctic and Greenland plateaus is extrapolated: poleward of 50
  // deg a low must be below LOW_HPA_POLAR, and none counts past 65 deg.
  const ex = extrema(frame.p, grid, k, -1, (v, j) => { const a = Math.abs(C.lat(j)); return a > 20 && a < 65 && v < (a > 50 ? LOW_HPA_POLAR : LOW_HPA); });
  const list = ex.map(([j, i, v]) => ({ kind: 'low', lat: C.lat(j), lon: C.lon(i), hpa: v, wind: maxWindNear(frame, grid, j, i, k) }))
    .filter(e => storms.every(s => distKm(s, e) > AWAY_KM));
  return spaced(list, 1500, max);
}
export function findJets(frame, grid, storms = [], max = 6) {
  const C = cells(grid), n = grid.nx * grid.ny, s = new Float32Array(n);
  for (let q = 0; q < n; q++) s[q] = Math.hypot(frame.u[q], frame.v[q]);
  const k = Math.max(2, Math.round(5 / C.dp));
  const ex = extrema(s, grid, k, 1, (v, j) => v > JET_MS && Math.abs(C.lat(j)) < 80);
  const list = ex.map(([j, i, v]) => ({ kind: 'jet', lat: C.lat(j), lon: C.lon(i), wind: v }))
    .filter(e => storms.every(st => distKm(st, e) > AWAY_KM));
  return spaced(list, 2000, max);
}
export function regionName(lat, lon) {
  if (lat > 66) return 'the Arctic';
  if (lat < -55) return 'the Southern Ocean';
  if (lat >= 0) {
    if (lon >= -10 && lon < 60 && lat > 35) return 'Europe';
    if (lon >= -130 && lon < -60 && lat > 25) return 'North America';
    if (lon >= -100 && lon < -10) return 'North Atlantic';
    if (lon >= -10 && lon < 40) return 'North Africa';
    if (lon >= 40 && lon < 100 && lat < 30) return 'Indian Ocean';
    if (lon >= 40 && lon < 145 && lat >= 30) return 'Asia';
    if (lon >= 100) return 'West Pacific';
    return 'North Pacific';
  }
  if (lon >= -70 && lon < 20) return 'South Atlantic';
  if (lon >= 110 && lon < 155 && lat > -40) return 'Australia';
  if (lon >= 20 && lon < 120) return 'Indian Ocean';
  return 'South Pacific';
}
