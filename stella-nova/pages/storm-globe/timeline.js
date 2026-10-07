// ============================================================================
//  STORM GLOBE  ·  timeline.js  ·  the time axis, storms in time, the sun
// ----------------------------------------------------------------------------
//  No DOM. The time slider runs from the first wind frame (the observed
//  past) to the last (the forecast). The newest analysis is "data time";
//  frames after it are forecasts.
//
//  bracket(times, t) -> { a, b, f }   the two frames around t and the blend
//  sliderToTime / timeToSlider        slider 0..SLIDER_MAX <-> epoch ms
//  ticks(t0, t1)                      day and 6-hour marks for the bar
//  stormAt(storm, t)                  position, wind, pressure, motion at t
//                                     (great-circle steps between fixes)
//  vortexFor(state, cellRad)          solver vortex parameters for a storm
//  subsolar(t)                        the point under the sun (0.01 deg)
//
//  grep -n targets: "export function bracket", "export function stormAt",
//                   "export function vortexFor", "export function subsolar"
// ============================================================================
import { KT, category } from './sources.js';
import { slerp, arc } from './camera.js';

const H = 3600e3, D = Math.PI / 180, R_KM = 6371;
export const SLIDER_MAX = 1000;

export function bracket(times, t) {
  const n = times.length;
  if (n === 1 || t <= times[0]) return { a: 0, b: Math.min(1, n - 1), f: 0 };
  if (t >= times[n - 1]) return { a: n - 2, b: n - 1, f: 1 };
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (times[m] <= t) lo = m; else hi = m; }
  return { a: lo, b: hi, f: (t - times[lo]) / (times[hi] - times[lo]) };
}
export function sliderToTime(v, t0, t1) { return t0 + (t1 - t0) * Math.max(0, Math.min(1, v / SLIDER_MAX)); }
export function timeToSlider(t, t0, t1) { return Math.round(Math.max(0, Math.min(1, (t - t0) / (t1 - t0))) * SLIDER_MAX); }
// marks: { t, kind: 'day' | 'h6', label }
export function ticks(t0, t1) {
  const out = [];
  for (let t = Math.ceil(t0 / (6 * H)) * 6 * H; t <= t1; t += 6 * H) {
    const d = new Date(t), day = d.getUTCHours() === 0;
    out.push({ t, kind: day ? 'day' : 'h6', label: day ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '' });
  }
  return out;
}
// "+18 h" / "-6 h" / "now" relative to data time
export function relLabel(t, t0) {
  const h = Math.round((t - t0) / H);
  return h === 0 ? 'data time' : (h > 0 ? '+' : '−') + Math.abs(h) + ' h';
}

// The storm path: observed fixes, then forecast points after the last fix.
export function stormPath(s) {
  const pts = s.track.map(f => ({ ...f, fc: false }));
  const last = pts.length ? pts[pts.length - 1].t : -Infinity;
  for (const f of s.forecast) if (f.t > last + 60e3) pts.push({ ...f, fc: true });
  return pts;
}
// FADE_H: a storm fades in over the 6 h before its first fix and out over
// the 6 h after its last point.
const FADE_H = 6;
export function stormAt(s, t, path = null) {
  const p = path || s._path || (s._path = stormPath(s));
  if (!p.length) return null;
  const t0 = p[0].t, t1 = p[p.length - 1].t;
  if (t < t0 - FADE_H * H || t > t1 + FADE_H * H) return null;
  let w = 1;
  if (t < t0) w = 1 - (t0 - t) / (FADE_H * H);
  if (t > t1) w = 1 - (t - t1) / (FADE_H * H);
  const tc = Math.max(t0, Math.min(t1, t));
  let i = 0; while (i < p.length - 2 && p[i + 1].t < tc) i++;
  const A = p[i], B = p[Math.min(i + 1, p.length - 1)];
  const f = B.t > A.t ? (tc - A.t) / (B.t - A.t) : 0;
  const pos = slerp(A, B, f);
  const vmax = (A.vmax ?? s.vmax) * (1 - f) + (B.vmax ?? A.vmax ?? s.vmax) * f;
  const pa = A.p ?? null, pb = B.p ?? null;
  const pmin = pa != null && pb != null ? pa * (1 - f) + pb * f : (pa ?? pb);
  // motion from the segment (or the last one): bearing and speed
  const Q = B.t > A.t ? [A, B] : (i > 0 ? [p[i - 1], A] : [A, B]);
  let ue = 0, vn = 0, spdKt = 0, dir = null;
  if (Q[1].t > Q[0].t) {
    const dist = arc(Q[0], Q[1]) * R_KM * 1000, dt = (Q[1].t - Q[0].t) / 1000;
    const la1 = Q[0].lat * D, la2 = Q[1].lat * D, dl = (Q[1].lon - Q[0].lon) * D;
    const brg = Math.atan2(Math.sin(dl) * Math.cos(la2), Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl));
    const ms = dist / dt; ue = ms * Math.sin(brg); vn = ms * Math.cos(brg);
    spdKt = ms / KT; dir = ((brg / D) + 360) % 360;
  }
  return { lat: pos.lat, lon: pos.lon, vmax, pmin, w, ue, vn, spdKt, dir, fc: t > (s.track.length ? s.track[s.track.length - 1].t : -Infinity), cat: category(vmax) };
}

// Atkinson-Holliday (1977) wind-pressure relation, for storms without a
// reported central pressure: vmax_kt = 6.7 (1010 - pc)^0.644
export function pressureFromWind(kt) { return 1010 - Math.pow(Math.max(0, kt) / 6.7, 1 / 0.644); }

// Solver vortex for a storm state. The solver grid cannot hold a real
// radius of maximum wind (20-60 km), so rmax is at least 1.6 cells; the
// outer size comes from the 34 kt radii when known (an average of the four
// quadrants), else 300 km. alpha makes V(r34) = 34 kt when both are known.
export function vortexFor(st, s, cellRad) {
  const vms = st.vmax * KT;
  const rmax = Math.max(1.6 * cellRad, 35 / R_KM);
  const r34nm = s.r34 && s.r34.some(x => x > 0) ? s.r34.reduce((a, b) => a + b, 0) / s.r34.filter(x => x > 0).length : 0;
  const r34 = r34nm ? r34nm * 1.852 / R_KM : 0;
  const rout = Math.max(4 * cellRad, r34 ? r34 * 1.4 : 300 / R_KM, rmax * 2.5);
  let alpha = 0.5;
  if (r34 > rmax * 1.05 && st.vmax > 36) alpha = Math.max(0.3, Math.min(0.9, Math.log(st.vmax / 34) / Math.log(r34 / rmax)));
  const pc = st.pmin ?? pressureFromWind(st.vmax);
  return { lat: st.lat, lon: st.lon, vmax: vms, rmax, rout, alpha, pc, penv: 1010, ue: st.ue, vn: st.vn, w: st.w };
}

// The subsolar point at time t (deg): the low-precision solar position of
// the Astronomical Almanac (about 0.01 deg, 1950-2050). The NOAA
// fractional-year series was tried first and was 0.4 deg off at the 2026
// March equinox (tests.mjs).
export function subsolar(t) {
  const n = t / 86400e3 + 2440587.5 - 2451545.0;            // days from J2000.0
  const L = (280.460 + 0.9856474 * n) % 360, g = ((357.528 + 0.9856003 * n) % 360) * D;
  const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D, eps = (23.439 - 4e-7 * n) * D;
  const decl = Math.asin(Math.sin(eps) * Math.sin(lam));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) / D;
  const eot = ((L - ra + 540) % 360) - 180;                 // deg (4 min per deg)
  const d = new Date(t), utc = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const lon = 15 * (12 - utc) - eot;
  return { lat: decl / D, lon: ((lon + 540) % 360) - 180 };
}
export function fmtTime(t) {
  const d = new Date(t);
  return d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false }) + ' UTC';
}
