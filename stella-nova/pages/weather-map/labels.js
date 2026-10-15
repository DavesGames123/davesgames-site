// ============================================================================
//  WEATHER MAP  ·  labels.js — city temperature labels and pressure marks
// ----------------------------------------------------------------------------
//  DOM labels over the globe canvas. A city label pops in (scale and fade)
//  when the camera comes near enough for its rank, and its temperature
//  counts up to the value in both units ("72°F · 22°C", order from
//  app.units). Labels declutter by rank and screen overlap; a label that
//  is already on screen keeps its place first, so labels do not flicker.
//  H and L pressure centres come from the fronts bulletin; isobar values
//  and other marks come in through setMarks(). Clicking a label calls the
//  pick handlers with the city.
//
//  The pure parts load in node (no DOM at import) and the tests use them:
//  maxRankFor(alt)                  the highest rank shown at an altitude
//  labelSize(city) -> { w, h }      the estimated label box (CSS px)
//  declutter(cands, opts) -> [ids]  greedy, deterministic, no overlap
//  fmtTemp(c, units) -> '72°F · 22°C'; cToF(c)
//  countUp(from, to, u)             the eased count-up value
//  cityTempAt(app, city, t)         °C now, or now plus the model change
//  iconFor(app, city, t)            a codeText icon name
//  ICONS                            inline SVG per icon name
//  createLabels(root, app) -> { update(m, dt), onPick(fn), setMarks(list),
//                               refresh(), destroy() }
//
//  grep -n targets: "export function declutter", "export function maxRankFor",
//  "export function cityTempAt", "export const ICONS",
//  "export function createLabels", "── POOL", "── MARKS"
// ============================================================================
import { project } from './camera.js';
import { CITIES } from './data/cities.js';
import { codeText } from './data/forecast.js';
import { sampleGrid, gridBounds } from './data/grid.js';
import { frontsAt } from './data/fronts.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ── PURE ─────────────────────────────────────────────────────────────────
// Rank 1 shows from any altitude, rank 2 from the regional view down,
// rank 3 only close in. A narrow (portrait) view gets the same density
// per pixel, so the thresholds scale with the view width.
export function maxRankFor(alt, w = 1600) {
  const k = clamp(w / 1600, 0.35, 1.5);
  if (alt <= 0.22 * k) return 3;
  if (alt <= 0.62 * k) return 2;
  return 1;
}

export const cToF = c => c * 9 / 5 + 32;

export function fmtTemp(c, units = 'F') {
  if (!Number.isFinite(c)) return '—';
  const f = `${Math.round(cToF(c))}°F`, s = `${Math.round(c)}°C`;
  return units === 'C' ? `${s} · ${f}` : `${f} · ${s}`;
}

// easeOutCubic between from and to, u in 0..1
export function countUp(from, to, u) {
  const v = 1 - Math.pow(1 - clamp(u, 0, 1), 3);
  return from + (to - from) * v;
}

// The label box, measured from the dot at (0, 0): the label body sits to
// the right of the dot and a little above it. Widths follow Inter at the
// sizes labels.css sets (name 12 px, temperature 15 px semibold).
// Compact labels (narrow views) put the name beside the temperature in
// 10.5 px type, so their width is the sum.
export function labelSize(city, compact = false) {
  const n = (city.name || '').length;
  if (compact) return { w: Math.ceil(22 + 34 + n * 5.8 + 6), h: 22 };
  return { w: Math.ceil(26 + Math.max(n * 6.6 + 8, 104)), h: 36 };
}
export const LABEL_DX = 9, LABEL_DY = -18;

// cands: [{ id, x, y, rank, pop, w, h, dy?, shown }]. Order of priority: on
// screen already, then rank (1 first), then population, then id. Accept a
// label when its box (with pad) does not hit an accepted box or dot.
// The result does not depend on the order of cands.
export function declutter(cands, opts = {}) {
  const pad = opts.pad ?? 4;
  const list = cands.slice().sort((a, b) =>
    (b.shown ? 1 : 0) - (a.shown ? 1 : 0) || a.rank - b.rank || b.pop - a.pop || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const taken = [], out = [];
  for (const c of list) {
    const dy = c.dy ?? LABEL_DY;
    const box = { x0: c.x + LABEL_DX - 6 - pad, y0: c.y + dy - pad, x1: c.x + LABEL_DX + c.w + pad, y1: c.y + dy + c.h + pad };
    const dot = { x0: c.x - 5, y0: c.y - 5, x1: c.x + 5, y1: c.y + 5 };
    let hit = false;
    for (const t of taken) {
      if (box.x0 < t.x1 && box.x1 > t.x0 && box.y0 < t.y1 && box.y1 > t.y0) { hit = true; break; }
      if (dot.x0 < t.x1 && dot.x1 > t.x0 && dot.y0 < t.y1 && dot.y1 > t.y0) { hit = true; break; }
    }
    if (hit) continue;
    taken.push(box, dot);
    out.push(c.id);
    if (opts.max && out.length >= opts.max) break;
  }
  return out;
}

const inGrid = (g, lat, lon) => {
  if (!g || !g.fields) return false;
  const b = gridBounds(g);
  return lat >= b.lat0 && lat <= b.lat1 && lon >= b.lon0 && lon <= b.lon1;
};

// The temperature at time t (°C). The current observation anchors it; the
// model grid adds its change from now to t, so the time-lapse moves the
// value without a jump at t = now. Outside the grid: the current value.
// No current value: the grid alone.
export function cityTempAt(app, city, t) {
  const cur = app.data && app.data.current && app.data.current.get ? app.data.current.get(city.id) : null;
  const g = app.data && app.data.grid;
  const now = Number.isFinite(app.tBase) ? app.tBase : (cur && Number.isFinite(cur.time) ? cur.time : t);
  const c0 = cur && Number.isFinite(cur.t2m) ? cur.t2m : NaN;
  if (!inGrid(g, city.lat, city.lon)) return c0;
  const gt = sampleGrid(g, 't2m', city.lat, city.lon, t);
  if (!Number.isFinite(c0)) return gt;
  if (Math.abs(t - now) < 60e3) return c0;
  return c0 + (gt - sampleGrid(g, 't2m', city.lat, city.lon, now));
}

// The icon at time t: the observed weather code near now, else a code
// made from the grid cloud, precipitation and snow.
export function iconFor(app, city, t) {
  const cur = app.data && app.data.current && app.data.current.get ? app.data.current.get(city.id) : null;
  const now = Number.isFinite(app.tBase) ? app.tBase : t;
  const g = app.data && app.data.grid;
  if (cur && Number.isFinite(cur.code) && (Math.abs(t - now) < 90 * 60e3 || !inGrid(g, city.lat, city.lon))) return codeText(cur.code, cur.isDay !== false).icon;
  if (!inGrid(g, city.lat, city.lon)) return 'unknown';
  const cl = sampleGrid(g, 'cloud', city.lat, city.lon, t), pr = sampleGrid(g, 'precip', city.lat, city.lon, t);
  const sn = sampleGrid(g, 'snow', city.lat, city.lon, t);
  let code = cl > 0.85 ? 3 : cl > 0.45 ? 2 : cl > 0.15 ? 1 : 0;
  if (pr > 0.2) code = sn > 0.1 ? (pr > 3 ? 75 : 71) : pr > 4 ? 65 : 61;
  const hUTC = new Date(t).getUTCHours() + city.lon / 15;
  const hl = ((hUTC % 24) + 24) % 24;
  return codeText(code, hl >= 6.5 && hl < 18.5).icon;
}

// Small line icons, 20 x 20, currentColor strokes plus sun and rain fills.
const SUN = '<circle cx="10" cy="10" r="3.6" fill="#ffd34d" stroke="none"/><g stroke="#ffd34d"><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/></g>';
const MOON = '<path d="M13.5 13.6A5.6 5.6 0 0 1 8 3.6a5.6 5.6 0 1 0 5.5 10z" fill="#d9e2f2" stroke="none"/>';
const CLOUD = (y = 0) => `<path d="M6 ${15 + y}h8.4a3.1 3.1 0 0 0 .2-6.2A4.4 4.4 0 0 0 6.2 9.6 2.8 2.8 0 0 0 6 ${15 + y}z" fill="#e8edf5" stroke="none"/>`;
const SMALL_SUN = '<circle cx="6.5" cy="6.5" r="2.8" fill="#ffd34d"/><g stroke="#ffd34d"><path d="M6.5 1.6v1.2M1.6 6.5h1.2M3 3l.9.9M10 3l-.9.9"/></g>';
const SMALL_MOON = '<path d="M8.6 9.1A3.8 3.8 0 0 1 5 2.2a3.8 3.8 0 1 0 3.6 6.9z" fill="#d9e2f2"/>';
const DROPS = (n, c = '#5fb4ff') => `<g stroke="${c}">${[5.5, 9.5, 13.5].slice(0, n).map(x => `<path d="M${x} 15.8l-1 2.4"/>`).join('')}</g>`;
const FLAKES = n => `<g fill="#ffffff">${[6, 10, 14].slice(0, n).map(x => `<circle cx="${x}" cy="17.2" r="1.1"/>`).join('')}</g>`;
const BOLT = '<path d="M10.4 12.4l-2 3.4h2.4l-1.4 3" stroke="#ffd34d" stroke-width="1.5"/>';
const svg = b => `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">${b}</svg>`;
export const ICONS = {
  'clear-day': svg(SUN),
  'clear-night': svg(MOON),
  'mostly-clear-day': svg(SUN + '<path d="M9 16h6.6a2.2 2.2 0 0 0 0-4.4 3 3 0 0 0-5.6.6A1.9 1.9 0 0 0 9 16z" fill="#e8edf5" stroke="none"/>'),
  'mostly-clear-night': svg(MOON + '<path d="M9 16h6.6a2.2 2.2 0 0 0 0-4.4 3 3 0 0 0-5.6.6A1.9 1.9 0 0 0 9 16z" fill="#e8edf5" stroke="none"/>'),
  'partly-cloudy-day': svg(SMALL_SUN + CLOUD()),
  'partly-cloudy-night': svg(SMALL_MOON + CLOUD()),
  overcast: svg('<path d="M4.4 11.6h7a2.6 2.6 0 0 0 0-5.2 3.6 3.6 0 0 0-6.7.9 2.2 2.2 0 0 0-.3 4.3z" fill="#9aa6b8" stroke="none"/>' + CLOUD()),
  fog: svg('<g stroke="#c7cfdb"><path d="M3 7h14M4.5 10.5h11M3 14h14M5.5 17.5h9"/></g>'),
  drizzle: svg(CLOUD(-3) + DROPS(2, '#8cc8ff')),
  rain: svg(CLOUD(-3) + DROPS(3)),
  'heavy-rain': svg(CLOUD(-3) + '<g stroke="#3d9bff" stroke-width="1.8"><path d="M5.5 15.4l-1.4 3M9.5 15.4l-1.4 3M13.5 15.4l-1.4 3"/></g>'),
  'freezing-rain': svg(CLOUD(-3) + '<g stroke="#5fb4ff"><path d="M6 15.8l-1 2.4"/></g><circle cx="10.5" cy="17.2" r="1.1" fill="#fff"/><g stroke="#5fb4ff"><path d="M14.5 15.8l-1 2.4"/></g>'),
  snow: svg(CLOUD(-3) + FLAKES(2)),
  'heavy-snow': svg(CLOUD(-3) + FLAKES(3)),
  'showers-day': svg(SMALL_SUN + CLOUD(-2) + DROPS(2)),
  'showers-night': svg(SMALL_MOON + CLOUD(-2) + DROPS(2)),
  thunder: svg(CLOUD(-4) + BOLT),
  'thunder-hail': svg(CLOUD(-4) + BOLT + '<circle cx="5.5" cy="17" r="1" fill="#fff"/><circle cx="14.5" cy="17" r="1" fill="#fff"/>'),
  unknown: svg('<circle cx="10" cy="10" r="2" fill="#9aa6b8" stroke="none"/>'),
};

// The TV temperature ramp for the label chip (°C -> CSS colour).
const RAMP = [[-30, '#c7b8ff'], [-15, '#8a7dff'], [-5, '#4f8dff'], [0, '#52c6ff'], [8, '#53e0b4'], [15, '#9be35a'], [21, '#ffe14d'], [27, '#ffab38'], [33, '#ff6a3a'], [40, '#e0335e']];
export function tempColor(c) {
  if (!Number.isFinite(c)) return '#8b95a5';
  let k = 0;
  while (k < RAMP.length - 1 && c > RAMP[k + 1][0]) k++;
  return RAMP[k][1];
}

// ── DOM ──────────────────────────────────────────────────────────────────
// opts: { cities (default CITIES), maxLabels, popSeconds, countSeconds }
export function createLabels(root, app, opts = {}) {
  const doc = root.ownerDocument;
  const cities = opts.cities || CITIES;
  const popS = opts.popSeconds ?? 0.35, countS = opts.countSeconds ?? 0.9;
  const layer = doc.createElement('div');
  layer.className = 'wxl-layer';
  root.appendChild(layer);
  const handlers = [];
  const pool = new Map(); // ── POOL: id -> state
  let marks = [], markEls = [], lastUnits = null, extMarks = [];
  let shown = new Set();

  function make(city) {
    const el = doc.createElement('button');
    el.type = 'button';
    el.className = 'wxl';
    el.hidden = true;
    el.setAttribute('aria-label', `${city.name}, ${city.state}: open the forecast`);
    el.innerHTML = '<span class="wxl-dot"></span><span class="wxl-body"><span class="wxl-icon"></span><span class="wxl-text"><span class="wxl-temp"></span><span class="wxl-name"></span></span></span>';
    el.querySelector('.wxl-name').textContent = city.name;
    el.addEventListener('pointerdown', e => e.stopPropagation());
    el.addEventListener('click', e => { e.stopPropagation(); for (const fn of handlers) fn(city, e); });
    layer.appendChild(el);
    return {
      city, el, tempEl: el.querySelector('.wxl-temp'), iconEl: el.querySelector('.wxl-icon'),
      on: false, a: 0, from: NaN, to: NaN, u: 1, val: NaN, text: '', icon: '', color: '', x: 0, y: 0,
    };
  }

  function setTarget(s, c) {
    if (!Number.isFinite(c)) { s.to = NaN; return; }
    if (!Number.isFinite(s.to) || Math.abs(c - s.to) > 0.05) {
      // a new pop counts up from 10 °C below; a change counts from the shown value
      s.from = Number.isFinite(s.val) && s.on ? s.val : c - 10;
      s.to = c; s.u = 0;
    }
  }

  // ── MARKS ── H / L from fronts plus external marks (isobar values)
  function frontMarks() {
    const set = app.data && app.data.fronts ? frontsAt(app.data.fronts, app.t) : null;
    if (!set) return [];
    const out = [];
    for (const p of set.highs || []) out.push({ kind: 'H', lat: p.lat, lon: p.lon, text: p.hPa ? String(Math.round(p.hPa)) : '' });
    for (const p of set.lows || []) out.push({ kind: 'L', lat: p.lat, lon: p.lon, text: p.hPa ? String(Math.round(p.hPa)) : '' });
    return out;
  }

  function syncMarks() {
    const want = [...frontMarks(), ...extMarks];
    const key = JSON.stringify(want);
    if (key === marks.key) return;
    for (const e of markEls) e.remove();
    markEls = want.map(mk => {
      const e = doc.createElement('div');
      e.className = `wxm wxm-${mk.kind === 'H' ? 'h' : mk.kind === 'L' ? 'l' : 'iso'}`;
      e.innerHTML = mk.kind === 'H' || mk.kind === 'L' ? `<b>${mk.kind}</b><small></small>` : '<small></small>';
      e.querySelector('small').textContent = mk.text || '';
      e.hidden = true;
      layer.appendChild(e);
      return e;
    });
    marks = want; marks.key = key;
  }

  const api = {
    onPick(fn) { if (typeof fn === 'function') handlers.push(fn); return api; },
    // list: [{ kind:'H'|'L'|'iso', lat, lon, text }]
    setMarks(list) { extMarks = Array.isArray(list) ? list.slice() : []; marks.key = null; },
    refresh() { for (const s of pool.values()) s.to = NaN; },
    destroy() { layer.remove(); pool.clear(); },
    update(m, dt = 1 / 60) {
      if (!m || !(m.w > 0)) return;
      const visible = !app.layers || app.layers.labels !== false;
      layer.hidden = !visible;
      if (!visible) return;
      const alt = app.cam ? app.cam.alt : 1;
      const maxRank = maxRankFor(alt, m.w);
      const compact = m.w < 520;
      const t = app.t;
      // candidates: in view, rank allowed
      const cands = [];
      for (const c of cities) {
        if (c.rank > maxRank) continue;
        const q = project(m, c.lat, c.lon, 1.0026);
        if (!q.visible) continue;
        if (q.x < -20 || q.x > m.w - 30 || q.y < 10 || q.y > m.h - 10) continue;
        const sz = labelSize(c, compact);
        cands.push({ id: c.id, x: q.x, y: q.y, rank: c.rank, pop: c.pop, w: sz.w, h: sz.h, dy: compact ? -11 : LABEL_DY, shown: shown.has(c.id), c });
      }
      const keep = new Set(declutter(cands, { max: opts.maxLabels ?? 60 }));
      const byId = new Map(cands.map(k => [k.id, k]));
      const unitsChanged = lastUnits !== app.units;
      lastUnits = app.units;
      for (const id of keep) if (!pool.has(id)) pool.set(id, make(byId.get(id).c));
      for (const [id, s] of pool) {
        const k = byId.get(id);
        const want = keep.has(id) && !!k;
        if (want && !s.on) { s.on = true; s.to = NaN; s.val = NaN; }
        if (!want) s.on = false;
        s.a = clamp(s.a + (s.on ? dt : -dt) / popS, 0, 1);
        if (s.a <= 0) { if (!s.el.hidden) s.el.hidden = true; continue; }
        if (k) { s.x = k.x; s.y = k.y; }
        if (s.on) {
          setTarget(s, cityTempAt(app, s.city, t));
          const ic = iconFor(app, s.city, t);
          if (ic !== s.icon) { s.icon = ic; s.iconEl.innerHTML = ICONS[ic] || ICONS.unknown; }
        }
        s.u = Math.min(1, s.u + dt / countS);
        s.val = Number.isFinite(s.to) ? countUp(s.from, s.to, s.u) : NaN;
        const txt = compact ? (Number.isFinite(s.val) ? `${Math.round(app.units === 'C' ? s.val : cToF(s.val))}°` : '—') : fmtTemp(s.val, app.units);
        if (txt !== s.text || unitsChanged) { s.text = txt; s.tempEl.textContent = txt; }
        const col = tempColor(s.to);
        if (col !== s.color) { s.color = col; s.el.style.setProperty('--wxl-c', col); }
        if (s.el.hidden) s.el.hidden = false;
        // pop: overshoot scale on the way in
        const a = s.a, sc = s.on ? 0.6 + 0.4 * (1 + 2.2 * Math.pow(a - 1, 3) + 1.2 * Math.pow(a - 1, 2)) : 0.85 + 0.15 * a;
        s.el.style.opacity = a.toFixed(3);
        s.el.style.transform = `translate3d(${s.x.toFixed(1)}px,${s.y.toFixed(1)}px,0) scale(${sc.toFixed(3)})`;
        s.el.classList.toggle('wxl-compact', compact);
        s.el.style.zIndex = String(10 - s.city.rank);
      }
      shown = keep;
      // marks
      syncMarks();
      marks.forEach((mk, i) => {
        const e = markEls[i];
        const q = project(m, mk.lat, mk.lon, 1.0026);
        const layerOn = mk.kind === 'iso' ? !app.layers || app.layers.isobars !== false : true;
        const on = layerOn && q.visible;
        e.hidden = !on;
        if (on) e.style.transform = `translate3d(${q.x.toFixed(1)}px,${q.y.toFixed(1)}px,0)`;
      });
    },
  };
  return api;
}
