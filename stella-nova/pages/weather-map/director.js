// ============================================================================
//  WEATHER MAP  ·  director.js — the news-program camera (no DOM)
// ----------------------------------------------------------------------------
//  The director moves app.cam the way a TV weather segment does: hold on a
//  region, zoom out, slide across the country, zoom in on the next region.
//  While it holds in Tour or Follow-fronts mode, it runs a forecast
//  time-lapse and gives the offset to main.js as lapseHours.
//
//  REGIONS  [{ id, name, cam, cities:[ids], states }]  cam is the 16:9 fit.
//           Two auto entries: 'fronts' (Follow fronts) and 'tour' (Tour).
//  REGION_BY_ID  Map(id -> region)
//  fitCam(points, opts) -> cam   the lowest camera that shows every point
//           (and its label) inside the clear box of a w x h view
//  regionCam(region, view) -> cam   fitCam for one region and one view
//  frontShots(frontSet, view) -> [{ id, name, cam, type }]  one shot per
//           major front, longest first
//  tourOrder(seed) -> [region ids]  a seeded tour that returns to National
//  createDirector(app, opts) -> director
//     goTo(regionId | cityId | { lat, lon, alt? })  fly there
//     tour(on)      the automatic tour (Tour chip, screensaver)
//     follow(on)    Follow fronts
//     stop()        give the camera back to the user (call it on a drag)
//     tick(dt) -> cam   advance; main.js copies the result to app.cam
//     busy, mode, lapseHours, target, view(w, h, inset)
//
//  grep -n targets: "export const REGIONS", "export function fitCam",
//  "export function regionCam", "export function frontShots",
//  "export function tourOrder", "export function createDirector",
//  "── REGION TABLE", "── LAPSE"
// ============================================================================
import { camState, viewProj, project, pick, flight, flightSeconds, ALT_MIN, ALT_MAX } from './camera.js';
import { latLonToXYZ, xyzToLatLon } from './astro.js';
import { CITIES, CITY_BY_ID, nearestCity } from './data/cities.js';
import { frontsAt } from './data/fronts.js';
import { labelSize, LABEL_DX } from './labels.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// The news view: a small tilt so the globe curve shows, north up.
export const NEWS_TILT = 0.3;
// The default view for fits made at load time (16:9).
export const VIEW_16x9 = Object.freeze({ w: 1600, h: 900 });

// ── REGION TABLE ─────────────────────────────────────────────────────────
// Each region names states (all cities in them) plus extra city ids, and
// optionally the ranks to frame. National frames the CONUS rank-1 cities.
const CONUS_X = new Set(['AK', 'HI', 'PR']);
const REGION_DEFS = [
  { id: 'national', name: 'National', ranks: [1], filter: c => !CONUS_X.has(c.state) },
  { id: 'northeast', name: 'Northeast', states: ['ME', 'NH', 'VT', 'MA', 'RI', 'CT', 'NY'] },
  { id: 'mid-atlantic', name: 'Mid-Atlantic', states: ['NJ', 'PA', 'DE', 'MD', 'DC', 'VA', 'WV'] },
  { id: 'southeast', name: 'Southeast', states: ['NC', 'SC', 'GA', 'AL', 'MS', 'TN', 'KY', 'AR', 'LA'] },
  { id: 'florida', name: 'Florida', states: ['FL'] },
  { id: 'great-lakes', name: 'Great Lakes', states: ['MI', 'OH', 'WI'], extra: ['chi', 'buf', 'roc', 'syr', 'dul', 'ind', 'mil'] },
  { id: 'midwest', name: 'Midwest', states: ['MN', 'IA', 'MO', 'IL', 'IN', 'WI'] },
  { id: 'plains', name: 'Plains', states: ['ND', 'SD', 'NE', 'KS', 'OK'] },
  { id: 'texas', name: 'Texas', states: ['TX'] },
  { id: 'southwest', name: 'Southwest', states: ['AZ', 'NM'], extra: ['lv', 'stg', 'elp', 'psp'] },
  { id: 'rockies', name: 'Rockies', states: ['CO', 'UT', 'WY', 'MT', 'ID'] },
  { id: 'california', name: 'California', states: ['CA'], extra: ['rno'] },
  { id: 'pacific-northwest', name: 'Pacific Northwest', states: ['WA', 'OR'], extra: ['boi'] },
  { id: 'alaska', name: 'Alaska', states: ['AK'] },
  { id: 'hawaii', name: 'Hawaii', states: ['HI'] },
  { id: 'puerto-rico', name: 'Puerto Rico', states: ['PR'] },
];

function citiesOf(def) {
  const out = new Set();
  for (const c of CITIES) {
    if (def.ranks && !def.ranks.includes(c.rank)) continue;
    if (def.filter && !def.filter(c)) continue;
    if (def.states && !def.states.includes(c.state)) continue;
    out.add(c.id);
  }
  for (const id of def.extra || []) if (CITY_BY_ID.has(id)) out.add(id);
  return [...out];
}

// ── FITTING ──────────────────────────────────────────────────────────────
// The clear box: the view minus the UI insets and a pad that scales with
// the view size. boxOf adds each point's label width on the right.
export function clearBox(view) {
  const { w, h } = view, ins = view.inset || {};
  const s = Math.min(w, h);
  const pad = clamp(s * 0.05, 12, 48);
  return {
    l: (ins.l || 0) + pad, r: w - (ins.r || 0) - pad,
    t: (ins.t || 0) + pad + clamp(s * 0.03, 10, 24), b: h - (ins.b || 0) - pad,
  };
}

function centroid(points) {
  let x = 0, y = 0, z = 0;
  for (const p of points) { const v = latLonToXYZ(p.lat, p.lon); x += v[0]; y += v[1]; z += v[2]; }
  return xyzToLatLon([x, y, z]);
}

// The screen box of the points; x1r also holds the right edge of each
// point's label (points with a name; front points have none).
function boxOf(m, points) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, x1r = -Infinity, all = true;
  const compact = m.w < 520;
  for (const p of points) {
    const q = project(m, p.lat, p.lon);
    if (!q.visible) { all = false; continue; }
    x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
    x1r = Math.max(x1r, p.name ? q.x + LABEL_DX + labelSize(p, compact).w : q.x);
  }
  return { x0, x1, y0, y1, x1r, all };
}

const inside = (b, c) => b.all && b.x0 >= c.l && b.x1r <= c.r && b.y0 >= c.t && b.y1 <= c.b;

// fitCam(points, { w, h, inset:{t,r,b,l}, tilt, heading, minAlt })
// Bisects the altitude (log scale) for the lowest camera that shows every
// point in the clear box, then moves the target so that the points sit in
// the middle of the clear box. Three rounds of centre-then-fit.
export function fitCam(points, opts = {}) {
  const view = { w: opts.w || VIEW_16x9.w, h: opts.h || VIEW_16x9.h, inset: opts.inset };
  const tilt = opts.tilt ?? NEWS_TILT, heading = opts.heading ?? 0;
  const minAlt = Math.max(ALT_MIN, opts.minAlt ?? 0.05);
  const box = clearBox(view);
  if (box.r - box.l < 8 || box.b - box.t < 8) { box.l = 0; box.r = view.w; box.t = 0; box.b = view.h; }
  let ll = centroid(points);
  let cam = camState(ll.lat, ll.lon, 1, tilt, heading);
  const fits = alt => inside(boxOf(viewProj({ ...cam, alt }, view.w, view.h), points), box);
  for (let round = 0; round < 4; round++) {
    let lo = Math.log(minAlt), hi = Math.log(ALT_MAX);
    if (fits(minAlt)) hi = lo;
    else if (!fits(ALT_MAX)) lo = hi;
    else for (let i = 0; i < 26; i++) { const mid = (lo + hi) / 2; if (fits(Math.exp(mid))) hi = mid; else lo = mid; }
    cam = camState(cam.lat, cam.lon, Math.exp(hi), tilt, heading);
    if (round === 3) break;
    // centre the point box in the clear box
    const m = viewProj(cam, view.w, view.h), b = boxOf(m, points);
    if (!b.all) break;
    const dx = (b.x0 + b.x1r) / 2 - (box.l + box.r) / 2, dy = (b.y0 + b.y1) / 2 - (box.t + box.b) / 2;
    if (Math.abs(dx) + Math.abs(dy) < 0.5) break;
    const p = pick(m, view.w / 2 + dx, view.h / 2 + dy);
    if (!p) break;
    ll = p;
    cam = camState(p.lat, p.lon, cam.alt, tilt, heading);
  }
  // a small margin above the tightest fit so labels breathe
  cam.alt = clamp(cam.alt * (opts.slack ?? 1.04), ALT_MIN, ALT_MAX);
  return cam;
}

const tzNear = (lat, lon) => { const c = nearestCity(lat, lon, 25); return c ? c.tz : null; };

const pointsOf = ids => ids.map(id => CITY_BY_ID.get(id)).filter(Boolean);

export function regionCam(region, view = VIEW_16x9) {
  if (!region || !region.cities || !region.cities.length) return null;
  return fitCam(pointsOf(region.cities), { ...view, minAlt: region.minAlt });
}

export const REGIONS = Object.freeze([
  ...REGION_DEFS.map(def => {
    const r = { id: def.id, name: def.name, states: def.states || null, cities: citiesOf(def), minAlt: def.id === 'puerto-rico' ? 0.06 : 0.08 };
    r.cam = regionCam(r, VIEW_16x9);
    return Object.freeze(r);
  }),
  Object.freeze({ id: 'fronts', name: 'Follow fronts', auto: true, cities: [], cam: null }),
  Object.freeze({ id: 'tour', name: 'Tour', auto: true, cities: [], cam: null }),
]);
export const REGION_BY_ID = new Map(REGIONS.map(r => [r.id, r]));

// ── FRONTS ───────────────────────────────────────────────────────────────
const FRONT_NAME = { COLD: 'Cold front', WARM: 'Warm front', STNRY: 'Stationary front', OCFNT: 'Occluded front', TROF: 'Trough', DRYLINE: 'Dry line', SQLN: 'Squall line' };
const FRONT_MAJOR = new Set(['COLD', 'WARM', 'STNRY', 'OCFNT']);
const inUS = p => p[0] >= 18 && p[0] <= 58 && p[1] >= -135 && p[1] <= -55;

function arcLen(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = latLonToXYZ(pts[i - 1][0], pts[i - 1][1]), b = latLonToXYZ(pts[i][0], pts[i][1]);
    s += Math.acos(clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1));
  }
  return s;
}

// One shot per major front with at least 4 deg of track over the US,
// longest first, at most `max`. Each shot frames the front's US part.
export function frontShots(set, view = VIEW_16x9, max = 5) {
  const fr = (set && set.fronts) || [];
  const cand = [];
  fr.forEach((f, k) => {
    if (!FRONT_MAJOR.has(f.type) || !f.pts) return;
    const pts = f.pts.filter(inUS);
    if (pts.length < 2) return;
    const len = arcLen(pts);
    if (len < 4 * Math.PI / 180) return;
    cand.push({ k, f, pts, len });
  });
  cand.sort((a, b) => b.len - a.len || a.k - b.k);
  return cand.slice(0, max).map(({ k, f, pts }) => ({
    id: `front-${k}`, type: f.type, name: FRONT_NAME[f.type] || f.type,
    cam: fitCam(pts.map(([lat, lon]) => ({ lat, lon })), { ...view, minAlt: 0.12, slack: 1.12 }),
    at: centroid(pts.map(([lat, lon]) => ({ lat, lon }))),
  }));
}

// ── TOUR ─────────────────────────────────────────────────────────────────
function rng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// National, then the CONUS regions in a seeded order with National after
// every fourth stop, then Alaska and Hawaii, then National again. The
// order sorts the shuffled stops west to east inside each group of four,
// so the camera slides across the country instead of zig-zagging.
export function tourOrder(seed = 1) {
  const conus = REGIONS.filter(r => !r.auto && !['national', 'alaska', 'hawaii', 'puerto-rico'].includes(r.id)).map(r => r.id);
  const R = rng(seed);
  for (let i = conus.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [conus[i], conus[j]] = [conus[j], conus[i]]; }
  const west = R() < 0.5;
  const out = ['national'];
  for (let i = 0; i < conus.length; i += 4) {
    const g = conus.slice(i, i + 4).sort((a, b) => (REGION_BY_ID.get(a).cam.lon - REGION_BY_ID.get(b).cam.lon) * (west ? 1 : -1));
    out.push(...g, 'national');
  }
  out.push(R() < 0.5 ? 'alaska' : 'hawaii', 'national');
  return out;
}

// ── DIRECTOR ─────────────────────────────────────────────────────────────
// opts: { view() -> { w, h, inset }, hold (s), lapseSpan (h), seed,
//         cityAlt, onArrive(stop) }
export function createDirector(app, opts = {}) {
  const hold = opts.hold ?? 9, frontHold = opts.frontHold ?? 8;
  const cityAlt = opts.cityAlt ?? 0.09;
  let view = { w: VIEW_16x9.w, h: VIEW_16x9.h, inset: null };
  let fl = null;          // { fn, u, dur, to, stop }
  let mode = 'idle';      // 'idle' | 'goto' | 'tour' | 'fronts'
  let queue = [], qi = 0, holdT = 0, seed = opts.seed ?? ((Date.now() / 1000) | 0);
  let cur = app.cam ? { ...app.cam } : camState(38.5, -97, 1, NEWS_TILT, 0);
  let lapse = 0, lapseFrom = 0, target = null;

  const getView = () => {
    const v = typeof opts.view === 'function' ? opts.view() : null;
    if (v && v.w > 0 && v.h > 0) return v;
    const m = app.core && app.core.lastFrame && app.core.lastFrame.m;
    if (m && m.w > 0 && m.h > 0) return { w: m.w, h: m.h, inset: view.inset };
    return view;
  };

  // A stop: { id, name, cam, lat, lon, tz, kind }
  function stopFor(x) {
    const v = getView();
    if (x && typeof x === 'object' && Number.isFinite(x.lat)) {
      const c = camState(x.lat, x.lon, x.alt ?? Math.min(cur.alt, cityAlt * 2), x.tilt ?? NEWS_TILT, x.heading ?? 0);
      return { id: x.id || 'point', name: x.name || '', cam: c, lat: x.lat, lon: x.lon, tz: x.tz || tzNear(x.lat, x.lon), kind: 'point' };
    }
    const r = REGION_BY_ID.get(x);
    if (r && !r.auto) {
      const first = CITY_BY_ID.get(r.cities[0]);
      const cam = regionCam(r, v) || r.cam;
      return { id: r.id, name: r.name, cam, lat: cam.lat, lon: cam.lon, tz: first ? first.tz : null, kind: 'region' };
    }
    const c = CITY_BY_ID.get(x);
    if (c) return { id: c.id, name: `${c.name}, ${c.state}`, cam: camState(c.lat, c.lon, cityAlt, NEWS_TILT, 0), lat: c.lat, lon: c.lon, tz: c.tz, kind: 'city' };
    return null;
  }

  function fly(stop) {
    if (!stop) return false;
    const from = { ...cur }, to = stop.cam;
    const dur = opts.fast ? 0.5 : flightSeconds(from, to);
    fl = { fn: flight(from, to), u: 0, dur, stop };
    lapseFrom = lapse;
    target = stop;
    return true;
  }

  function arrive(stop) {
    if (app) app.focus = { id: stop.id, name: stop.name, lat: stop.lat, lon: stop.lon, tz: stop.tz, kind: stop.kind };
    if (typeof opts.onArrive === 'function') opts.onArrive(stop);
  }

  function buildQueue() {
    if (mode === 'tour') return tourOrder(seed++).map(stopFor).filter(Boolean);
    if (mode === 'fronts') {
      const set = app.data && app.data.fronts ? frontsAt(app.data.fronts, app.t) : null;
      const shots = frontShots(set, getView());
      if (!shots.length) return [stopFor('national')];
      return shots.map(s => ({ id: s.id, name: s.name, cam: s.cam, lat: s.at.lat, lon: s.at.lon, tz: tzNear(s.at.lat, s.at.lon), kind: 'front' }));
    }
    return [];
  }

  function startAuto(m) {
    mode = m; queue = buildQueue(); qi = 0; holdT = 0;
    if (queue.length) fly(queue[0]);
  }

  // ── LAPSE ──
  // While holding in an auto mode the forecast runs ahead by up to
  // lapseSpan hours; during the next flight it eases back to now.
  function lapseSpan() {
    let span = opts.lapseSpan ?? 18;
    const g = app.data && app.data.grid;
    if (g && g.times && g.times.length && Number.isFinite(app.tBase)) span = clamp((g.times[g.times.length - 1] - app.tBase) / 3.6e6, 0, span);
    return span;
  }

  const d = {
    get busy() { return !!fl; },
    get mode() { return mode; },
    get lapseHours() { return lapse; },
    get target() { return target; },
    get touring() { return mode === 'tour' || mode === 'fronts'; },
    view(w, h, inset) { view = { w, h, inset: inset || null }; },
    goTo(x) {
      if (x === 'tour') { d.tour(true); return true; }
      if (x === 'fronts') { d.follow(true); return true; }
      mode = 'goto';
      return fly(stopFor(x));
    },
    tour(on = true) { if (on) startAuto('tour'); else if (mode === 'tour') d.stop(); },
    follow(on = true) { if (on) startAuto('fronts'); else if (mode === 'fronts') d.stop(); },
    stop() { fl = null; mode = 'idle'; queue = []; lapse = 0; },
    // Sync with a camera the user moved by hand.
    setCam(c) { cur = { ...c }; },
    tick(dt) {
      dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.25);
      if (!fl && mode === 'idle' && app.cam) cur = { ...app.cam };
      if (fl) {
        fl.u = Math.min(1, fl.u + dt / fl.dur);
        // camera.flight lifts the altitude by H sin(pi u), which lands at a
        // finite rate; a sine ease of u brings the rate to zero at both ends
        cur = fl.fn(0.5 - 0.5 * Math.cos(Math.PI * fl.u));
        lapse = lapseFrom * (1 - fl.u * fl.u * (3 - 2 * fl.u));
        if (fl.u >= 1) {
          const s = fl.stop;
          fl = null; lapse = 0; holdT = 0;
          arrive(s);
          if (mode === 'goto') mode = 'idle';
        }
      } else if (mode === 'tour' || mode === 'fronts') {
        const h = mode === 'fronts' ? frontHold : hold;
        holdT += dt;
        const u = clamp(holdT / h, 0, 1);
        lapse = lapseSpan() * u * u * (3 - 2 * u);
        if (holdT >= h) {
          qi++;
          if (qi >= queue.length) {
            const last = queue[queue.length - 1];
            queue = buildQueue(); qi = 0;
            if (queue.length > 1 && last && queue[0].id === last.id) qi = 1;
          }
          if (queue.length) fly(queue[qi]);
        }
      }
      return { ...cur };
    },
  };
  return d;
}
