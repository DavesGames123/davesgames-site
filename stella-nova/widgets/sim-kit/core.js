// ============================================================================
//  SIM KIT CORE  ·  widgets/sim-kit/core.js
// ----------------------------------------------------------------------------
//  The pure part of the sim kit: no DOM, so node tests import it. The DOM
//  part (panel, dock, sheet, transport) is ui.js; the saver director is
//  saver.js. README.md next to this file has the full API and an example.
//
//  SCHEMA. A page declares its controls once:
//    { groups: [{ id, label, open?, random?: false, controls: [control] }] }
//    control = { key, type, label, value, ...type fields, random? }
//      range   min, max, step, unit?, digits?, fmt?(v)
//      toggle  (value is a boolean)
//      choice  options: [{ id, label }] (or strings), seg?: true for a
//              segmented row (default when 4 options or fewer)
//      swatch  options: [{ id, label, colors: ['#hex', ..] }]
//      color   value '#rrggbb'
//      cmap    value is a colour map id (ct-lab/colormaps/maps.js)
//      button  action: name of a handler in mount({ actions }); no state
//      buttons items: [{ id, label }], action(id); no state
//      note    text; no state
//    rebuild: true marks a control that needs a new scene (not a live set).
//    phone: v gives a lighter default on phones (applied by ui.js).
//
//  RANDOMIZER. Each control with state has a draw rule:
//    random: false                     never drawn (keeps its value)
//    random: { min, max }              range bounds for the draw
//    random: { dist: 'uniform' | 'log' | 'normal' | 'int' }
//    random: { p }                     toggle: chance of true
//    random: { weights: { id: w } }    choice/swatch: weighted pick
//    random: { pick: [ids] }           choice/swatch/cmap: draw from a list
//    random: { rnd: 0.3 }              swatch: chance of a generated palette
//  A scene is a pure function of (schema, seed): every key draws from its
//  own stream rng(seed ^ hash(key)), so a lock on one group does not change
//  the draws of the others. A guard(next, prev, rng) hook can clamp a draw
//  (return the fixed state) or veto it (return false: the kit draws again
//  from seed + 1, up to 8 times, then keeps prev).
//
//  HASH. encodeHash(schema, state, seed) writes only the keys that differ
//  from the defaults: "s=1234&count=1800&shape=drum". decodeHash reads it
//  back, clamps ranges and drops unknown keys or ids.
//
//  grep -n targets
//    seeded rng ........... "export function rng"
//    schema normalise ..... "export function normalize"
//    one draw ............. "function drawOne"
//    scene from seed ...... "export function scene"
//    group randomize ...... "export function randomize"
//    url hash ............. "export function encodeHash"
//    saver shot bag ....... "export function shotBag"
//    themes ............... "export const THEMES"
//    object palettes ...... "export const PALETTES"
//    random palette ....... "export function randomPalette"
// ============================================================================

// ---- seeded rng -------------------------------------------------------------
// mulberry32 with helpers. Same seed, same stream, on every engine.
export function rng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  const f = () => { s = (s + 0x6D2B79F5) >>> 0; let x = Math.imul(s ^ s >>> 15, 1 | s); x ^= x + Math.imul(x ^ x >>> 7, 61 | x); return ((x ^ x >>> 14) >>> 0) / 4294967296; };
  f.range = (a, b) => a + (b - a) * f();
  f.int = (a, b) => Math.floor(a + (b - a + 1) * f());
  f.pick = arr => arr[Math.floor(f() * arr.length)];
  f.chance = p => f() < p;
  f.normal = () => { let u = 0, v = 0; while (u === 0) u = f(); v = f(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  f.shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(f() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; };
  return f;
}

// FNV-1a 32 bit of a string, or a number to uint32.
export function hashSeed(v) {
  if (typeof v === 'number' && isFinite(v)) return v >>> 0;
  let h = 0x811c9dc5; const s = String(v);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export function newSeed(r = Math.random) { return 1 + Math.floor(r() * 999999); }

// ---- schema -----------------------------------------------------------------
const STATEFUL = new Set(['range', 'toggle', 'choice', 'swatch', 'color', 'cmap']);
export const isStateful = c => STATEFUL.has(c.type) && !!c.key;

export function normalize(schema) {
  if (schema && schema._norm) return schema;
  const groups = (schema.groups || []).map(g => ({
    id: g.id, label: g.label || g.id, open: g.open !== false, random: g.random !== false, hint: g.hint || '',
    controls: (g.controls || []).map(c => {
      const o = Object.assign({}, c, { group: g.id });
      if (o.type === 'choice' || o.type === 'swatch') o.options = (o.options || []).map(x => (typeof x === 'string' ? { id: x, label: x } : x));
      if (o.type === 'range') { o.step = o.step || (o.max - o.min) / 100; if (o.value == null) o.value = o.min; }
      if (o.type === 'toggle') o.value = !!o.value;
      if ((o.type === 'choice' || o.type === 'swatch') && o.value == null) o.value = o.options[0] && o.options[0].id;
      return o;
    }),
  }));
  const byKey = new Map();
  for (const g of groups) for (const c of g.controls) if (isStateful(c)) byKey.set(c.key, c);
  return { _norm: true, groups, byKey, guard: schema.guard || null, cmapIds: schema.cmapIds || null };
}

export function defaults(schema) {
  const S = normalize(schema), out = {};
  for (const [k, c] of S.byKey) out[k] = c.value;
  return out;
}

// Decimals of a step, also in exponent form (String(1e-12) is "1e-12"),
// up to 12 so a fine step (a fractal centre) keeps its precision.
const decimals = step => {
  const s = String(step), e = s.indexOf('e-');
  if (e >= 0) { const m = s.slice(0, e), i = m.indexOf('.'); return Math.min(12, +s.slice(e + 2) + (i < 0 ? 0 : m.length - i - 1)); }
  const i = s.indexOf('.'); return i < 0 ? 0 : Math.min(12, s.length - i - 1);
};
export function snap(c, v) {
  if (c.type !== 'range') return v;
  v = Math.max(c.min, Math.min(c.max, +v));
  if (!isFinite(v)) v = c.value;
  const n = Math.round((v - c.min) / c.step);
  return +Math.min(c.max, c.min + n * c.step).toFixed(decimals(c.step));
}

// Clamp or reject one value for a control. Returns undefined when invalid.
export function coerce(c, v) {
  switch (c.type) {
    case 'range': { const x = parseFloat(v); return isFinite(x) ? snap(c, x) : undefined; }
    case 'toggle': return v === true || v === 1 || v === '1' || v === 'true' ? true : v === false || v === 0 || v === '0' || v === 'false' ? false : undefined;
    case 'choice': return c.options.some(o => o.id === String(v)) ? String(v) : undefined;
    case 'swatch': return c.options.some(o => o.id === String(v)) || /^rnd-\d{1,9}$/.test(String(v)) ? String(v) : undefined;
    case 'color': { const s = String(v).replace(/^#?/, '#').toLowerCase(); return /^#[0-9a-f]{6}$/.test(s) ? s : undefined; }
    case 'cmap': return /^[a-z0-9-]{2,32}$/.test(String(v)) ? String(v) : undefined;
  }
  return undefined;
}

// ---- randomizer -------------------------------------------------------------
// The default list of colour maps a cmap control draws from (all non-grey).
export const CMAP_DRAW = ['viridis', 'magma', 'inferno', 'plasma', 'mako', 'rocket', 'cubehelix', 'turbo', 'ocean', 'ice', 'hot-iron', 'copper', 'coolwarm', 'berlin', 'vanimo', 'twilight', 'aurora', 'nebula', 'ember', 'glacier', 'synthwave', 'gold-leaf', 'cyanotype', 'forest', 'rose', 'orchid'];

function drawOne(c, r, cmapIds) {
  const R = c.random || {};
  switch (c.type) {
    case 'range': {
      const lo = R.min != null ? R.min : c.min, hi = R.max != null ? R.max : c.max;
      let v;
      if (R.dist === 'log' && lo > 0) v = Math.exp(r.range(Math.log(lo), Math.log(hi)));
      else if (R.dist === 'normal') { const m = R.mean != null ? R.mean : (lo + hi) / 2, sd = R.sd != null ? R.sd : (hi - lo) / 6; v = Math.max(lo, Math.min(hi, m + sd * r.normal())); }
      else if (R.dist === 'int') v = r.int(Math.ceil(lo), Math.floor(hi));
      else v = r.range(lo, hi);
      return snap(c, v);
    }
    case 'toggle': return r() < (R.p != null ? R.p : 0.5);
    case 'choice': case 'swatch': {
      if (c.type === 'swatch' && R.rnd && r() < R.rnd) return 'rnd-' + r.int(1, 999999);
      const ids = R.pick || c.options.map(o => o.id);
      if (R.weights) {
        const w = ids.map(id => (R.weights[id] != null ? R.weights[id] : 1));
        const tot = w.reduce((a, b) => a + b, 0); let x = r() * tot;
        for (let i = 0; i < ids.length; i++) { x -= w[i]; if (x < 0) return ids[i]; }
        return ids[ids.length - 1];
      }
      return r.pick(ids);
    }
    case 'color': { const h = r() * 360, s = 0.45 + 0.4 * r(), l = 0.45 + 0.2 * r(); return hslHex(h, s, l); }
    case 'cmap': return r.pick(R.pick || cmapIds || CMAP_DRAW);
  }
  return c.value;
}

const canDraw = (g, c) => g.random && c.random !== false && isStateful(c);
const keyStream = (seed, key) => rng((Math.imul(hashSeed(seed), 0x9e3779b1) ^ hashSeed(key)) >>> 0);

// The scene of a seed: every drawable key that is not locked gets a draw,
// the rest keep base. locks: a Set (or array) of group ids and keys.
export function scene(schema, seed, base, locks) {
  const S = normalize(schema), L = toSet(locks);
  const out = Object.assign(defaults(S), base || {});
  for (const g of S.groups) {
    if (L.has(g.id)) continue;
    for (const c of g.controls) if (canDraw(g, c) && !L.has(c.key)) out[c.key] = drawOne(c, keyStream(seed, c.key), S.cmapIds);
  }
  return out;
}

// Draw a scene, run the guard, retry on veto. Returns { seed, state, tries }.
// opts.group limits the draw to one group (the per-group dice button).
export function randomize(schema, seed, prev, opts = {}) {
  const S = normalize(schema), guard = opts.guard || S.guard;
  const locks = toSet(opts.locks);
  if (opts.group) for (const g of S.groups) if (g.id !== opts.group) locks.add(g.id);
  for (let k = 0; k < 8; k++) {
    const sd = (seed + k) >>> 0;
    let next = scene(S, sd, prev, locks);
    if (guard) {
      const res = guard(next, prev || defaults(S), keyStream(sd, '#guard'));
      if (res === false) continue;
      if (res && typeof res === 'object') next = res;
    }
    return { seed: sd, state: next, tries: k + 1 };
  }
  return { seed, state: Object.assign(defaults(S), prev || {}), tries: 8, vetoed: true };
}

function toSet(x) { return x instanceof Set ? new Set(x) : new Set(x || []); }

// ---- url hash ---------------------------------------------------------------
function enc(c, v) {
  if (c.type === 'toggle') return v ? '1' : '0';
  if (c.type === 'color') return String(v).replace('#', '');
  return String(v);
}
export function encodeHash(schema, state, seed, extra) {
  const S = normalize(schema), d = defaults(S), parts = [];
  if (seed != null) parts.push('s=' + (seed >>> 0));
  for (const [k, c] of S.byKey) if (state[k] !== undefined && state[k] !== d[k]) parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(enc(c, state[k])));
  if (extra) for (const k in extra) parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(extra[k]));
  return parts.join('&');
}
export function decodeHash(schema, str) {
  const S = normalize(schema), state = defaults(S), extra = {};
  let seed = null, n = 0;
  const s = String(str || '').replace(/^#/, '');
  if (!s) return { seed, state, extra, n };
  for (const kv of s.split('&')) {
    if (!kv) continue;
    const i = kv.indexOf('=');
    let k, v;
    try { k = decodeURIComponent(i < 0 ? kv : kv.slice(0, i)); v = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1)); } catch (e) { continue; }
    if (k === 's') { const x = parseInt(v, 10); if (isFinite(x)) seed = x >>> 0; continue; }
    const c = S.byKey.get(k);
    if (!c) { extra[k] = v; continue; }
    const x = coerce(c, v);
    if (x !== undefined) { state[k] = x; n++; }
  }
  return { seed, state, extra, n };
}

// ---- saver plan -------------------------------------------------------------
// A seeded bag of shot keys. A shot with weight w goes in the bag w times.
// Each draw takes a random key from the bag that is not the last key; the
// bag refills when it is empty. So no shot plays twice in a row (when
// there are two shot kinds or more), and every pass plays each shot.
export function shotBag(shots, r) {
  const keys = [];
  for (const s of shots) for (let k = 0; k < Math.max(1, Math.round(s.weight || 1)); k++) keys.push(s.key);
  let bag = [], last = null;
  return {
    next() {
      if (!bag.length) bag = keys.slice();
      let ok = [];
      for (let i = 0; i < bag.length; i++) if (bag[i] !== last) ok.push(i);
      // Only copies of the last key are left (a weighted shot): add the next
      // pass now, so the draw can take another key.
      if (!ok.length && keys.some(k => k !== last)) { bag = bag.concat(keys); ok = []; for (let i = 0; i < bag.length; i++) if (bag[i] !== last) ok.push(i); }
      const i = ok.length ? ok[Math.floor(r() * ok.length)] : Math.floor(r() * bag.length);
      last = bag.splice(i, 1)[0];
      return last;
    },
  };
}
// Shot length in seconds: 6-12 s, longer when calm is high.
export function shotSeconds(r, calm = 0.6, min = 6, max = 12) {
  const c = Math.max(0, Math.min(1, calm));
  const lo = min + (max - min) * 0.3 * c, hi = min + (max - min) * (0.55 + 0.45 * c);
  return lo + (hi - lo) * r();
}
// The first n cuts of a director, for tests: [{ key, sec, theme }].
export function planShots(shots, seed, n, calm = 0.6, themes = THEMES.map(t => t.id)) {
  const r = rng(seed), bag = shotBag(shots, r), out = [];
  let th = null;
  for (let i = 0; i < n; i++) {
    const key = bag.next(), sec = shotSeconds(r, calm);
    let t = r.pick(themes); if (themes.length > 1) while (t === th) t = r.pick(themes);
    th = t; out.push({ key, sec, theme: t });
  }
  return out;
}

// ---- colour -----------------------------------------------------------------
export function hexRgb(h) { const s = String(h).replace('#', ''); const n = parseInt(s.length === 3 ? s.replace(/./g, '$&$&') : s, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function rgbHex(r, g, b) { return '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join(''); }
export function mixHex(a, b, t) { const A = hexRgb(a), B = hexRgb(b); return rgbHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); }
export function hslHex(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return rgbHex(f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255);
}

// Background themes. bg/bg2 make the page gradient; ink is text on it; wall
// draws containers and obstacles; grid is a faint guide; dark says which
// UI glass to use.
export const THEMES = [
  { id: 'night', name: 'Night', bg: '#06080d', bg2: '#0d1420', ink: '#e6ebf2', dim: '#8a95a8', wall: '#c8d0dc', grid: 'rgba(160,190,230,0.06)', accent: '#7cc4ff', dark: true },
  { id: 'abyss', name: 'Abyss', bg: '#010409', bg2: '#04162a', ink: '#dcecff', dim: '#7c93b0', wall: '#8fb4d8', grid: 'rgba(90,160,255,0.07)', accent: '#4fd1ff', dark: true },
  { id: 'ember', name: 'Ember', bg: '#0c0605', bg2: '#22100a', ink: '#f6e6da', dim: '#ad8f7d', wall: '#e8b48a', grid: 'rgba(255,150,90,0.06)', accent: '#ff9a62', dark: true },
  { id: 'violet', name: 'Violet', bg: '#08050f', bg2: '#1a1030', ink: '#ece4fa', dim: '#9a8cb8', wall: '#c9b6ee', grid: 'rgba(190,150,255,0.07)', accent: '#b69cff', dark: true },
  { id: 'forest', name: 'Forest', bg: '#040a07', bg2: '#0c1d15', ink: '#e2f2e8', dim: '#86a493', wall: '#a9d4b8', grid: 'rgba(120,220,160,0.06)', accent: '#86dc7c', dark: true },
  { id: 'slate', name: 'Slate', bg: '#15181d', bg2: '#262b33', ink: '#eef1f5', dim: '#9aa3b0', wall: '#dfe4ea', grid: 'rgba(255,255,255,0.05)', accent: '#ffd666', dark: true },
  { id: 'paper', name: 'Paper', bg: '#f3efe6', bg2: '#e4ddcf', ink: '#1d2026', dim: '#6b665c', wall: '#3a3f48', grid: 'rgba(0,0,0,0.05)', accent: '#c2410c', dark: false },
  { id: 'blueprint', name: 'Blueprint', bg: '#0b2a52', bg2: '#123a6e', ink: '#eaf3ff', dim: '#9cc0ea', wall: '#e6f0ff', grid: 'rgba(220,235,255,0.10)', accent: '#ffe08a', dark: true },
  { id: 'studio', name: 'Studio', bg: '#dfe5ec', bg2: '#f7f9fb', ink: '#14181f', dim: '#5d6878', wall: '#2b3442', grid: 'rgba(20,40,80,0.06)', accent: '#2563eb', dark: false },
];
export const themeById = id => THEMES.find(t => t.id === id) || THEMES[0];
// The CSS custom properties ui.js writes on <html> for a theme.
export function themeVars(t) {
  t = typeof t === 'string' ? themeById(t) : t;
  return { '--sk-bg': t.bg, '--sk-bg2': t.bg2, '--sk-ink': t.ink, '--sk-dim': t.dim, '--sk-wall': t.wall, '--sk-grid': t.grid, '--sk-accent': t.accent, '--sk-scheme': t.dark ? 'dark' : 'light',
    '--sk-glass': t.dark ? 'rgba(9,12,19,0.74)' : 'rgba(250,250,252,0.80)', '--sk-glass2': t.dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.045)',
    '--sk-line': t.dark ? 'rgba(255,255,255,0.11)' : 'rgba(0,0,0,0.13)', '--sk-text': t.dark ? '#e8edf4' : '#151a22', '--sk-text2': t.dark ? '#97a2b3' : '#5a6372' };
}

// Object palettes: colours for bodies, balls, cloth panels and so on.
export const PALETTES = [
  { id: 'toybox', label: 'Toy box', colors: ['#ff5d5d', '#ffc94a', '#4ad991', '#4aa8ff', '#b07cff', '#ff8fc8'] },
  { id: 'harbour', label: 'Harbour', colors: ['#e63946', '#f1faee', '#a8dadc', '#457b9d', '#ffb703', '#8d5524'] },
  { id: 'driftwood', label: 'Driftwood', colors: ['#c19a6b', '#8b5a2b', '#deb887', '#6b4f3a', '#a0522d', '#e8d3b0'] },
  { id: 'neon', label: 'Neon', colors: ['#ff2a6d', '#05d9e8', '#d1f7ff', '#ff9f1c', '#a6ff00', '#b967ff'] },
  { id: 'pastel', label: 'Pastel', colors: ['#ffadad', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#bdb2ff'] },
  { id: 'mono', label: 'Mono', colors: ['#f5f5f5', '#c9c9c9', '#9a9a9a', '#6e6e6e', '#e0e0e0', '#b3b3b3'] },
  { id: 'sunset', label: 'Sunset', colors: ['#f94144', '#f3722c', '#f8961e', '#f9c74f', '#90be6d', '#577590'] },
  { id: 'rocks', label: 'Stone', colors: ['#7d7f86', '#5b5e66', '#9c8f80', '#4a4d55', '#b0a89c', '#6f6458'] },
];
// A harmonious palette of n colours from one rng: a base hue with an
// analogous, triadic or complementary spread.
export function randomPalette(r, n = 6) {
  const h0 = r() * 360, mode = r.pick(['analog', 'triad', 'comp', 'split']);
  const spread = { analog: [0, 25, -25, 50, -50, 12], triad: [0, 120, 240, 20, 140, 260], comp: [0, 180, 15, 195, -15, 165], split: [0, 150, 210, 20, 170, 230] }[mode];
  const out = [];
  for (let i = 0; i < n; i++) out.push(hslHex(h0 + spread[i % spread.length], 0.55 + 0.35 * r(), 0.48 + 0.2 * r()));
  return { id: 'random', label: 'Random', colors: out, mode };
}

// Colours of a swatch value: a palette id, or 'rnd-<n>' for the random
// palette of seed n (the dice on a swatch control makes these).
export function paletteColors(id, list = PALETTES) {
  const m = /^rnd-(\d+)$/.exec(String(id));
  if (m) return randomPalette(rng(+m[1])).colors;
  const p = list.find(x => x.id === id) || list[0];
  return p.colors;
}
// Ready-made controls for the theme and the object palette.
export function themeControl(value = 'night', extra = {}) {
  return Object.assign({ key: 'theme', type: 'choice', label: 'Background', seg: false, value, options: THEMES.map(t => ({ id: t.id, label: t.name, swatch: [t.bg2, t.accent] })) }, extra);
}
export function paletteControl(value = 'toybox', extra = {}) {
  return Object.assign({ key: 'palette', type: 'swatch', label: 'Object colours', value, options: PALETTES.map(p => ({ id: p.id, label: p.label, colors: p.colors })), dice: true }, extra);
}

// Format a range value for the live readout.
export function fmtValue(c, v) {
  if (c.fmt) return c.fmt(v);
  if (c.type !== 'range') return String(v);
  const d = c.digits != null ? c.digits : decimals(c.step);
  return (+v).toFixed(d) + (c.unit ? ' ' + c.unit : '');
}
