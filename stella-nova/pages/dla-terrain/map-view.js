// ============================================================================
//  DLA TERRAIN  ·  map-view.js — the map inset and the large map (MAP)
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "the minimap should be a whole nlot more
//  functional. i want to be able to click it to open an expanded view and
//  navigate".
//
//  SMALL MAP (#map, #mapCanvas). The map inset of ui.js. It draws at the
//  device pixel ratio, with a north arrow and the camera cone. A click, a
//  tap, Enter or the key M opens the large map. The hint "Click to expand"
//  shows on hover and focus (always on a touch screen).
//
//  LARGE MAP (#atlas, made here). Most of the window on a wide screen, the
//  full screen on a phone (class "full"). Open and close fade and scale
//  (CSS .on, map-view.css). Esc, the close button and M close it. While it
//  is open, covers() is true and main.js draws no GPU frame (the last 3D
//  frame stays dim behind it), so the map costs no GPU time.
//    Move:  a drag pans; the wheel, a pinch and the + and - buttons zoom
//           about the pointer; Fit shows the whole terrain; the arrows pan
//           and + - 0 zoom from the keyboard.
//    Act:   a click flies the camera there (app.flyView, else app.flyTo).
//           Shift + drag, or a hold of HOLD_MS then a drag, from a point
//           flies there and turns the view to the drag direction. Enter
//           flies to the centre. A flight closes the map.
//    Go to: the named features of the terrain (findFeatures): the highest
//           peak, the largest lake, the river mouth, the longest river
//           source, the main ridge.
//    Bookmarks: "Save this view" keeps the camera pose per terrain (sig)
//           in localStorage (createBookmarks; every access in try/catch,
//           so a throwing storage keeps them in memory only).
//    Legend: colour by biome or elevation, hillshade, contours, rivers,
//           grid; the biome swatches of this terrain, the elevation ramp.
//    Readout: the world point under the pointer (km east and south of the
//           centre), the height (or the water depth) and the biome.
//
//  COST. The map image is made from the height grid that the page has
//  (renderLevel: biome or elevation colour, hillshade, sea, lakes, river
//  field, contours) into offscreen canvases at a few sizes (LEVELS 256 to
//  2048, at most the grid size, 1024 on a phone). A level is made when a
//  view first needs it and again only when the terrain or a layer changes
//  (at most every 0.5 s while a terrain forms). The rivers are vectors in
//  screen space. A draw is one drawImage and a few paths, and happens only
//  when the view, the data or the camera pose changes (at most 30 a s).
//
//  PURE PARTS (tests/mapview.test.mjs): fitView, toScreen, toWorld,
//  zoomAbout, panBy, clampView, pickLevel, niceScale, aimYaw, stepAim,
//  viewOfCamera, findFeatures, terrainSig, createBookmarks, renderLevel.
//
//  grep -n targets
//    "export function fitView"         the view of the whole terrain
//    "export function zoomAbout"       a zoom that keeps a point fixed
//    "export function pickLevel"       the cache level for a view
//    "export function aimYaw"          a map direction -> orbit yaw
//    "export function stepAim"         the eased turn after a flight
//    "export function findFeatures"    the "Go to" places
//    "export function createBookmarks" the saved views
//    "export function renderLevel"     the map pixels
//    "export function mountMapView"    the DOM part
//    "  function drawBig"  "  function drawMini"  "  function onKey"
// ============================================================================

export const LEVELS = [256, 512, 1024, 2048];
export const HOLD_MS = 380;            // a still press this long, then a drag, aims
export const DRAG_PX = 6;              // a move past this is a drag, not a click
export const MIN_SPAN = 300;           // m: the closest zoom shows this much
export const BOOKMARK_KEY = 'dla-terrain-bookmarks';
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = a => a - TAU * Math.floor((a + Math.PI) / TAU);

// ── view maths ──────────────────────────────────────────────────────────────
// A view: { cx, cz (world m at the centre), k (CSS px per m), w, h (CSS px) }.
// North (-z) is up: +x right, +z down (as ui.js worldToMap).
export function fitView(ws, w, h, pad = 0.04) { return { cx: 0, cz: 0, k: Math.min(w, h) / (ws * (1 + pad)), w, h }; }
export function toScreen(x, z, v) { return [(x - v.cx) * v.k + v.w / 2, (z - v.cz) * v.k + v.h / 2]; }
export function toWorld(px, py, v) { return [v.cx + (px - v.w / 2) / v.k, v.cz + (py - v.h / 2) / v.k]; }
export function kLimits(ws, w, h) { const f = fitView(ws, w, h).k; return [f * 0.7, Math.max(f * 2, Math.min(w, h) / MIN_SPAN)]; }
// zoom by f about the screen point (px, py): that world point stays there
export function zoomAbout(v, px, py, f, ws) {
  const [a, b] = kLimits(ws, v.w, v.h);
  const k = clamp(v.k * f, a, b);
  const [x, z] = toWorld(px, py, v);
  return clampView({ cx: x - (px - v.w / 2) / k, cz: z - (py - v.h / 2) / k, k, w: v.w, h: v.h }, ws);
}
export function panBy(v, dx, dy, ws) { return clampView({ ...v, cx: v.cx - dx / v.k, cz: v.cz - dy / v.k }, ws); }
// the centre stays over the terrain
export function clampView(v, ws) { const l = ws / 2; return { ...v, cx: clamp(v.cx, -l, l), cz: clamp(v.cz, -l, l) }; }
// the smallest cache level that has a pixel for each device pixel
export function pickLevel(v, ws, dpr = 1, maxL = 2048) {
  const need = v.k * dpr * ws;
  const L = LEVELS.filter(s => s <= Math.max(LEVELS[0], maxL));
  return L.find(s => s >= need) || L[L.length - 1];
}
// a scale bar near target px: { m, px } with m in 1, 2, 5 x 10^n
export function niceScale(k, target = 90) {
  const raw = target / k, p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = [1, 2, 5, 10].map(f => f * p).reduce((a, b) => (Math.abs(b - raw) < Math.abs(a - raw) ? b : a));
  return { m, px: m * k, text: m >= 1000 ? `${+(m / 1000).toFixed(1)} km` : `${m} m` };
}
// a direction on the map (dx, dz world) -> the orbit yaw that looks that
// way (camera.js: forward = forwardOf(yaw + PI); yawOf(f) = atan2(f.x, -f.z))
export function aimYaw(dx, dz) { return wrap(Math.atan2(dx, -dz) - Math.PI); }
export function viewYaw(forward) { return Math.atan2(forward[0], -forward[2]); }
// the eased turn after a flight: aim { yaw?, pitch?, t0 } -> aim or null
// (done, the camera left orbit, or the user moved after t0)
export function stepAim(cam, aim, dt, lastInput = -Infinity) {
  if (!aim || !cam || cam.mode !== 'orbit' || lastInput > aim.t0 + 1) return null;
  const o = cam.orbit, k = 1 - Math.exp(-3.2 * dt);
  let rest = 0;
  if (aim.yaw != null) { const d = wrap(aim.yaw - o.yaw); o.yaw += d * k; rest = Math.max(rest, Math.abs(d * (1 - k))); }
  if (aim.pitch != null) { const d = aim.pitch - o.pitch; o.pitch += d * k; rest = Math.max(rest, Math.abs(d * (1 - k))); }
  if (rest < 1e-3) { if (aim.yaw != null) o.yaw = wrap(aim.yaw); if (aim.pitch != null) o.pitch = aim.pitch; return null; }
  return aim;
}
// a bookmark pose from the camera: the orbit, or the ground point ahead
export function viewOfCamera(cam, heightAt) {
  if (cam.mode === 'orbit' && cam.orbit) {
    const o = cam.orbit;
    return { x: o.target[0], z: o.target[2], yaw: o.yaw, pitch: o.pitch, dist: o.dist };
  }
  const p = cam.pos, f = cam.forward, h = heightAt || (() => 0);
  let d = 500;
  for (let s = 20; s < 20000; s *= 1.15) { if (p[1] + f[1] * s <= h(p[0] + f[0] * s, p[2] + f[2] * s)) { d = s; break; } }
  const pitch = clamp(Math.asin(clamp(f[1], -1, 1)), -1.53, -0.03);
  return { x: p[0] + f[0] * d, z: p[2] + f[2] * d, yaw: wrap(viewYaw(f) - Math.PI), pitch, dist: Math.max(40, d) };
}

// ── features ────────────────────────────────────────────────────────────────
// The named places of a terrain (the lib Terrain: height, n, worldSize,
// seaLevel, lakes, rivers, ridges). [{ id, label, x, z, h?, dist }]
export function findFeatures(t) {
  const out = [];
  if (!t || !t.height) return out;
  const n = t.n || Math.round(Math.sqrt(t.height.length)), ws = t.worldSize || 1, H = t.height, cell = ws / n;
  const at = (i, j) => [(i + 0.5) * cell - ws / 2, (j + 0.5) * cell - ws / 2];
  let bi = 0;
  for (let k = 1; k < H.length; k++) if (H[k] > H[bi]) bi = k;
  const [px, pz] = at(bi % n, Math.floor(bi / n));
  const sea = Number.isFinite(t.seaLevel) ? t.seaLevel : 0;
  out.push({ id: 'peak', label: 'Highest peak', x: px, z: pz, h: H[bi], text: `${Math.round(H[bi] - Math.max(0, sea))} m`, dist: clamp(ws * 0.09, 700, 3200) });
  const lakes = (t.lakes || []).filter(l => Number.isFinite(l.x) && Number.isFinite(l.z));
  if (lakes.length) {
    const L = lakes.reduce((a, b) => ((b.area || 0) > (a.area || 0) ? b : a));
    const r = Math.sqrt(Math.max(1, L.area || cell * cell) / Math.PI);
    out.push({ id: 'lake', label: 'Largest lake', x: L.x, z: L.z, text: L.area ? `${(L.area / 1e6).toFixed(L.area < 1e6 ? 2 : 1)} km²` : '', dist: clamp(r * 3.2, 400, ws * 0.35) });
  }
  const rivers = (t.rivers || []).filter(r => r.pts && r.pts.length >= 4);
  const last = a => (a && a.length ? a[a.length - 1] : 0);
  const toSea = rivers.filter(r => r.end === 'sea');
  const pool = toSea.length ? toSea : rivers.filter(r => r.end !== 'join');
  if (pool.length) {
    const R = pool.reduce((a, b) => (last(b.flow) > last(a.flow) ? b : a));
    const p = R.pts;
    out.push({ id: 'mouth', label: toSea.length ? 'River mouth' : 'River end', x: p[p.length - 2], z: p[p.length - 1], text: toSea.length ? 'the largest river at the sea' : 'the largest river', dist: clamp(ws * 0.05, 500, 2000) });
  }
  if (rivers.length) {
    const lenOf = r => { let s = 0; const p = r.pts; for (let i = 2; i < p.length; i += 2) s += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return s; };
    let R = rivers[0], best = -1;
    for (const r of rivers) { const s = lenOf(r); if (s > best) { best = s; R = r; } }
    out.push({ id: 'source', label: 'Longest river source', x: R.pts[0], z: R.pts[1], text: `${(best / 1000).toFixed(1)} km long`, dist: clamp(ws * 0.05, 500, 2000) });
  }
  const ridges = (t.ridges || []).filter(r => r.pts && r.pts.length >= 4);
  if (ridges.length) {
    const R = ridges.reduce((a, b) => (b.pts.length > a.pts.length ? b : a));
    const m = Math.floor(R.pts.length / 4) * 2;
    out.push({ id: 'ridge', label: 'Main ridge', x: R.pts[m], z: R.pts[m + 1], text: '', dist: clamp(ws * 0.12, 900, 4000) });
  }
  return out;
}

// A short id of the terrain: the options (seed, preset, size, ...).
export function terrainSig(opts, ws) {
  const o = opts || {};
  const s = JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]])) + '|' + Math.round(ws || 0);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

// ── bookmarks ───────────────────────────────────────────────────────────────
// storage: a Storage-like object or a function that returns one (or
// throws). Every read and write is in try/catch: a throwing storage keeps
// the list in memory for this page life.
export function createBookmarks(storage, key = BOOKMARK_KEY, max = 60) {
  const S = () => { try { return typeof storage === 'function' ? storage() : storage; } catch { return null; } };
  let mem = null, ok = true;
  function load() {
    if (mem) return mem;
    mem = [];
    try { const s = S(); const a = s ? JSON.parse(s.getItem(key) || '[]') : []; if (Array.isArray(a)) mem = a.filter(b => b && Number.isFinite(b.x) && Number.isFinite(b.z)); }
    catch { ok = false; }
    return mem;
  }
  function save() {
    try { const s = S(); if (!s) { ok = false; return false; } s.setItem(key, JSON.stringify(mem)); ok = true; return true; }
    catch { ok = false; return false; }
  }
  return {
    get stored() { return ok; },
    all: () => load().slice(),
    list: sig => load().filter(b => b.sig === sig),
    add(b) {
      load();
      const id = 'b' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
      const rec = { id, name: String(b.name || 'View').slice(0, 60), sig: b.sig, x: +b.x, z: +b.z, yaw: +b.yaw || 0, pitch: Number.isFinite(b.pitch) ? b.pitch : -0.4, dist: Number.isFinite(b.dist) ? b.dist : 1500, t: Date.now() };
      mem.push(rec);
      while (mem.length > max) mem.shift();
      save();
      return rec;
    },
    remove(id) { load(); const n = mem.length; mem = mem.filter(b => b.id !== id); if (mem.length !== n) save(); return mem.length !== n; },
    rename(id, name) { load(); const b = mem.find(q => q.id === id); if (!b) return false; b.name = String(name).slice(0, 60); save(); return true; },
  };
}

// ── the map pixels ──────────────────────────────────────────────────────────
function rgbOf(b) {
  const c = b && b.color;
  if (Array.isArray(c)) return c.map(x => Math.round(x <= 1 ? x * 255 : x));
  if (typeof c === 'string' && /^#?[0-9a-f]{6}$/i.test(c)) { const h = c.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); }
  return [128, 128, 128];
}
export const ELEV_STOPS = [[0, [72, 118, 70]], [0.12, [110, 146, 82]], [0.3, [170, 168, 108]], [0.5, [164, 128, 92]], [0.72, [132, 118, 112]], [0.88, [196, 194, 196]], [1, [246, 246, 250]]];
export function elevColour(t) {
  const S = ELEV_STOPS;
  t = clamp(t, 0, 1);
  for (let i = 1; i < S.length; i++) if (t <= S[i][0]) { const u = (t - S[i - 1][0]) / (S[i][0] - S[i - 1][0]); return [0, 1, 2].map(c => S[i - 1][1][c] + (S[i][1][c] - S[i - 1][1][c]) * u); }
  return S[S.length - 1][1].slice();
}
export function contourStep(span) {
  const raw = Math.max(1, span / 12), p = Math.pow(10, Math.floor(Math.log10(raw)));
  return [1, 2, 2.5, 5, 10].map(f => f * p).find(s => s >= raw) || 10 * p;
}
// snap = { n, height, seaLevel, worldSize, biome?, river?, water? }
// layers = { colour: 'biome' | 'elev', shade, contours, rivers }
// -> { px: Uint8ClampedArray size x size RGBA, lo, hi, sea, step }
export function renderLevel(snap, size, BIOMES, layers = {}) {
  const px = new Uint8ClampedArray(size * size * 4);
  const out = { px, lo: 0, hi: 0, sea: 0, step: 0 };
  if (!snap || !snap.height) return out;
  const H = snap.height, n = snap.n || Math.round(Math.sqrt(H.length)), ws = snap.worldSize || 1, cell = ws / n;
  const sea = snap.seaLevel ?? 0;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < H.length; i += 5) { const h = H[i]; if (h < lo) lo = h; if (h > hi) hi = h; }
  const base = Math.max(lo, sea), span = Math.max(1, hi - base);
  const step = layers.contours ? contourStep(hi - lo) : 0;
  Object.assign(out, { lo, hi, sea, step });
  const pal = (BIOMES || []).map(rgbOf), useBiome = layers.colour !== 'elev' && snap.biome && pal.length;
  const at = (i, j) => H[clamp(j, 0, n - 1) * n + clamp(i, 0, n - 1)];
  const ix = new Int32Array(size);
  for (let x = 0; x < size; x++) ix[x] = Math.min(n - 1, Math.floor((x + 0.5) * n / size));
  const d1 = Math.max(1, Math.round(n / size));
  for (let y = 0; y < size; y++) {
    const j = ix[y];
    for (let x = 0; x < size; x++) {
      const i = ix[x], k = j * n + i, h = H[k];
      let c;
      const bio = snap.biome ? snap.biome[k] : -1;
      if (useBiome) c = pal[bio] || [128, 128, 128];
      else c = elevColour((h - base) / span);
      let shade = 1;
      if (layers.shade !== false) {
        const dx = (at(i + d1, j) - at(i - d1, j)) / (2 * d1 * cell), dz = (at(i, j + d1) - at(i, j - d1)) / (2 * d1 * cell);
        const l = Math.hypot(dx, 1, dz);
        shade = Math.max(0.28, ((-dx * -0.6 + 0.7 + -dz * -0.4) / l) * 1.15);
      }
      let r = c[0] * shade, g = c[1] * shade, b = c[2] * shade;
      if (h < sea) {
        const d = Math.min(1, (sea - h) / (span * 0.25));
        r = 26 + (1 - d) * 46; g = 62 + (1 - d) * 70; b = 104 + (1 - d) * 60;
      } else if (bio === 13 || (snap.water && snap.water[k] > 0.6 && !(snap.river && snap.river[k] > 0.25))) {
        r = 52; g = 108; b = 156;                     // a lake
      } else if (layers.rivers !== false && snap.river && snap.river[k] > 0.25) {
        const a = Math.min(1, (snap.river[k] - 0.25) * 2);
        r = r * (1 - a) + 60 * a; g = g * (1 - a) + 124 * a; b = b * (1 - a) + 176 * a;
      }
      if (step && h >= sea) {
        const L = Math.floor(h / step);
        const right = H[j * n + ix[Math.min(size - 1, x + 1)]], down = H[ix[Math.min(size - 1, y + 1)] * n + i];
        if (Math.floor(right / step) !== L || Math.floor(down / step) !== L) { const m = L % 5 === 4 ? 0.55 : 0.75; r *= m; g *= m; b *= m; }
      }
      const o = (y * size + x) * 4;
      px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
    }
  }
  return out;
}

// ── the DOM part ────────────────────────────────────────────────────────────
// o = { doc, win, app, phoneQ (a MediaQueryList), toast(text), storage? }
// app: flyView(x, z, { yaw, pitch, dist })? flyTo(x, z), cam, world
// { heightAt, size, seaLevel }, terrain, opts, saverRun
export function mountMapView(o) {
  const doc = o.doc, win = o.win || doc.defaultView || globalThis, app = o.app;
  const $ = id => doc.getElementById(id);
  const root = doc.documentElement;
  const now = () => (win.performance ? win.performance.now() : Date.now());
  const mini = $('mapCanvas'), mapEl = $('map');
  const dprOf = () => Math.min(3, win.devicePixelRatio || 1);
  const phone = () => !!(o.phoneQ && o.phoneQ.matches);
  const storage = o.storage || (() => win.localStorage);
  const marks = createBookmarks(storage);
  const mk = (tag, cls, text, attrs) => {
    const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text;
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };
  const canvas2d = (w, h) => { try { const c = doc.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext && c.getContext('2d'); return x ? { c, x } : null; } catch { return null; } };
  const saverOn = () => root.classList.contains('sn-saver') || root.classList.contains('dt-saver') || !!app.saverRun;

  // state
  const M = {
    snap: null, BIOMES: null, terrain: null, ws: 1, n: 0, ver: 0, stage: '',
    layers: { colour: 'biome', shade: true, contours: false, rivers: true, grid: false },
    levels: new Map(),       // size -> { c, x, ver, sig, meta }
    features: [], open: false, closing: 0, view: null, dirty: true, lastDraw: -1e9, lastPose: '',
    aimPin: null, hover: null, readText: '', flights: [],
  };
  try { const s = storage(); const l = s && JSON.parse(s.getItem('dla-terrain-map-layers') || 'null'); if (l && typeof l === 'object') Object.assign(M.layers, l); } catch { /* defaults */ }
  const layerSig = () => `${M.layers.colour}${M.layers.shade ? 's' : ''}${M.layers.contours ? 'c' : ''}${M.layers.rivers ? 'r' : ''}`;
  const maxLevel = () => Math.min(phone() ? 1024 : 2048, Math.max(256, M.n || 256));
  const sig = () => terrainSig(app.genOpts || app.opts, M.ws);

  // ── the small map: hint, keys, open ──
  if (mini) {
    mini.tabIndex = 0;
    mini.setAttribute('role', 'button');
    mini.setAttribute('aria-label', 'Map of the terrain. Click, or press Enter or M, to open the large map.');
    mini.setAttribute('aria-keyshortcuts', 'M');
    mini.setAttribute('aria-haspopup', 'dialog');
    mini.style.cursor = 'zoom-in';
    mini.addEventListener('click', e => { e.preventDefault(); open(); });
    mini.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    if (mapEl) { const h = mk('span', 'map-hint', 'Click to expand · M', { 'aria-hidden': 'true' }); mapEl.appendChild(h); }
  }

  // ── the large map DOM ──
  const box = mk('div', 'atlas', null, { id: 'atlas', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'atTitle', 'data-saver-hide': '' });
  box.hidden = true;
  box.innerHTML = `
<div class="at-back" data-close="1"></div>
<div class="at-box">
  <header class="at-head">
    <h2 id="atTitle">Map</h2><span id="atSub" class="at-sub"></span>
    <div class="at-tools">
      <button type="button" id="atFit" title="Show the whole terrain (0)">Fit</button>
      <button type="button" id="atIn" aria-label="Zoom in (+)">+</button>
      <button type="button" id="atOut" aria-label="Zoom out (−)">−</button>
      <button type="button" id="atSide" aria-label="Show or hide the map menu" aria-expanded="true" aria-controls="atAside">☰</button>
      <button type="button" id="atClose" aria-label="Close the map (Esc)">×</button>
    </div>
  </header>
  <div class="at-body">
    <div class="at-stage">
      <canvas id="atCanvas" tabindex="0" role="application" aria-roledescription="map" aria-describedby="atHelp"></canvas>
      <div id="atRead" class="at-read"></div>
      <p id="atHelp" class="at-help">Click: fly there · Drag: pan · Wheel or pinch: zoom · Shift-drag, or hold then drag: fly there and face that way · Arrows pan, + − 0 zoom, Enter flies to the centre</p>
    </div>
    <aside id="atAside" class="at-side" aria-label="Map menu">
      <section><h3>Go to</h3><div id="atFeat" class="at-feat"></div></section>
      <section><h3>Bookmarks</h3>
        <button type="button" id="atSave" class="at-wide">Save this view</button>
        <ul id="atMarks" class="at-marks"></ul><p id="atMarkNote" class="at-note" hidden></p></section>
      <section><h3>Layers</h3>
        <div class="at-seg" role="group" aria-label="Colour by"><button type="button" data-colour="biome">Biomes</button><button type="button" data-colour="elev">Elevation</button></div>
        <div class="at-toggles"><button type="button" data-layer="shade">Hillshade</button><button type="button" data-layer="contours">Contours</button><button type="button" data-layer="rivers">Rivers</button><button type="button" data-layer="grid">Grid</button></div></section>
      <section><h3>Legend</h3><div id="atLegend" class="at-legend"></div></section>
    </aside>
  </div>
</div>`;
  (doc.getElementById('stage') || doc.body).appendChild(box);
  const big = $('atCanvas'), bctx = big.getContext ? big.getContext('2d') : null;
  const q = sel => box.querySelector(sel);

  function open() {
    if (M.open || saverOn() || !M.snap) return false;
    M.open = true; M.closing = 0;
    box.hidden = false;
    box.classList.toggle('full', phone());
    box.classList.remove('on');
    // two frames: the first lays out with the start style, then .on fades in
    const go = () => { if (M.open) box.classList.add('on'); };
    if (win.requestAnimationFrame) win.requestAnimationFrame(() => win.requestAnimationFrame(go)); else setTimeout(go, 16);
    root.classList.add('atlas-open');
    if (mini) mini.setAttribute('aria-expanded', 'true');
    layout();
    if (!M.view) M.view = fitView(M.ws, M.cw, M.ch);
    else M.view = clampView({ ...M.view, w: M.cw, h: M.ch }, M.ws);
    buildFeatures(); buildMarks(); syncLayers(); buildLegend();
    M.dirty = true; drawBig(true);
    try { big.focus({ preventScroll: true }); } catch { /* old focus API */ }
    return true;
  }
  function close(why) {
    if (!M.open) return false;
    M.open = false; M.aimPin = null; drag = null; pts.clear(); clearTimeout(holdT);
    box.classList.remove('on');
    root.classList.remove('atlas-open');
    if (mini) mini.setAttribute('aria-expanded', 'false');
    const t = M.closing = setTimeout(() => { if (!M.open && M.closing === t) box.hidden = true; }, 240);
    if (why !== 'fly' && mini && mini.offsetParent !== null) { try { mini.focus({ preventScroll: true }); } catch { /* old focus API */ } }
    return true;
  }
  const toggle = () => (M.open ? close() : open());

  function layout() {
    const r = big.getBoundingClientRect ? big.getBoundingClientRect() : null;
    M.cw = Math.max(1, Math.round((r && r.width) || big.clientWidth || (phone() ? win.innerWidth : (win.innerWidth || 1280) * 0.62) || 800));
    M.ch = Math.max(1, Math.round((r && r.height) || big.clientHeight || (phone() ? win.innerHeight * 0.6 : (win.innerHeight || 800) * 0.8) || 600));
    const d = dprOf(), W = Math.round(M.cw * d), H = Math.round(M.ch * d);
    if (big.width !== W || big.height !== H) { big.width = W; big.height = H; }
    if (M.view) M.view = clampView({ ...M.view, w: M.cw, h: M.ch }, M.ws);
    M.dirty = true;
  }
  win.addEventListener('resize', () => { if (M.open) { box.classList.toggle('full', phone()); layout(); drawBig(true); } });

  // ── data ──
  function setTerrain(snap, BIOMES, terrain) {
    if (!snap || !snap.height) return;
    const wsNew = snap.worldSize || M.ws;
    if (Math.abs(wsNew - M.ws) > 1) M.view = null;
    M.snap = snap; M.BIOMES = BIOMES; M.ws = wsNew; M.n = snap.n || Math.round(Math.sqrt(snap.height.length)); M.stage = snap.stage || '';
    M.ver++;
    if (terrain) { M.terrain = terrain; M.features = findFeatures(terrain); }
    else if (M.terrain && M.terrain.height !== snap.height && snap.stage !== 'done') { M.terrain = null; M.features = []; }
    // the small map level now (as before: one 256 image per snapshot)
    level(256, true);
    M.dirty = true;
    if (M.open) { buildFeatures(); buildMarks(); buildLegend(); drawBig(true); }
  }
  // the cache level of size s: made when missing or old (a forming
  // terrain makes it again at most every 0.5 s)
  function level(s, force) {
    let L = M.levels.get(s);
    const ls = layerSig();
    const old = !L || L.ver !== M.ver || L.sig !== ls;
    if (!old) return L;
    if (L && !force && L.sig === ls && now() - L.at < 500) return L;
    if (!L) { const cv = canvas2d(s, s); L = { c: cv && cv.c, x: cv && cv.x, ver: -1, sig: '', at: -1e9, meta: null }; M.levels.set(s, L); }
    const r = renderLevel(M.snap, s, M.BIOMES, s === 256 ? { ...M.layers, contours: false } : M.layers);
    L.meta = r; L.ver = M.ver; L.sig = ls; L.at = now();
    if (L.x && win.ImageData) {
      try { L.x.putImageData(new win.ImageData(r.px, s, s), 0, 0); } catch { /* no image data */ }
      if (s === 256) drawRivers(L.x, { cx: 0, cz: 0, k: s / M.ws, w: s, h: s }, 0.6, 2.5);
    }
    return L;
  }
  function drawRivers(ctx, v, wMin, wMax) {
    const T = M.terrain;
    if (!T || !T.rivers || !M.layers.rivers) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(120,190,240,0.9)'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const x0 = v.cx - v.w / 2 / v.k, x1 = v.cx + v.w / 2 / v.k, z0 = v.cz - v.h / 2 / v.k, z1 = v.cz + v.h / 2 / v.k;
    for (const r of T.rivers) {
      const p = r.pts; if (!p || p.length < 4) continue;
      const w = r.width && r.width.length ? r.width[r.width.length - 1] : 10;
      ctx.lineWidth = clamp(w * v.k * 1.4, wMin, wMax);
      ctx.beginPath();
      let on = false;
      for (let i = 0; i < p.length; i += 2) {
        const inside = p[i] > x0 - 200 && p[i] < x1 + 200 && p[i + 1] > z0 - 200 && p[i + 1] < z1 + 200;
        const s = toScreen(p[i], p[i + 1], v);
        if (inside) { on ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1]); on = true; } else on = false;
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── camera on the map ──
  function camPose() {
    const c = app.cam;
    if (!c || !c.pos || !c.forward) return null;
    const aspect = (win.innerWidth || 16) / (win.innerHeight || 9);
    const hf = 2 * Math.atan(Math.tan((c.fovY || 0.87) / 2) * aspect);
    const len = c.mode === 'orbit' && c.orbit ? Math.max(200, Math.min(M.ws * 0.4, c.orbit.dist * 1.2)) : M.ws * 0.08;
    return { x: c.pos[0], z: c.pos[2], a: Math.atan2(c.forward[2], c.forward[0]), hf: Math.min(2.6, hf), len, mode: c.mode, target: c.mode === 'orbit' && c.orbit ? c.orbit.target : null };
  }
  function drawCam(ctx, v, p, s = 1) {
    if (!p) return;
    const [x, y] = toScreen(p.x, p.z, v), L = Math.max(18 * s, p.len * v.k);
    ctx.save();
    ctx.fillStyle = 'rgba(255,240,200,0.20)'; ctx.strokeStyle = 'rgba(255,233,184,0.75)'; ctx.lineWidth = 1 * s;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, L, p.a - p.hf / 2, p.a + p.hf / 2); ctx.closePath(); ctx.fill(); ctx.stroke();
    if (p.target) {
      const [tx, ty] = toScreen(p.target[0], p.target[2], v);
      ctx.strokeStyle = 'rgba(255,233,184,0.9)'; ctx.lineWidth = 1.2 * s;
      ctx.beginPath(); ctx.moveTo(tx - 5 * s, ty); ctx.lineTo(tx + 5 * s, ty); ctx.moveTo(tx, ty - 5 * s); ctx.lineTo(tx, ty + 5 * s); ctx.stroke();
    }
    ctx.fillStyle = '#ffe9b8'; ctx.strokeStyle = '#1a1208'; ctx.lineWidth = 1.5 * s;
    ctx.beginPath(); ctx.arc(x, y, 4.5 * s, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  function drawNorth(ctx, x, y, s = 1) {
    ctx.save();
    ctx.fillStyle = 'rgba(228,232,227,0.92)'; ctx.strokeStyle = 'rgba(6,8,10,0.85)'; ctx.lineWidth = 2 * s;
    ctx.beginPath(); ctx.moveTo(x, y - 9 * s); ctx.lineTo(x + 5 * s, y + 4 * s); ctx.lineTo(x, y + 1 * s); ctx.lineTo(x - 5 * s, y + 4 * s); ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.font = `600 ${Math.round(9 * s)}px Inter, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.strokeText('N', x, y + 6 * s); ctx.fillText('N', x, y + 6 * s);
    ctx.restore();
  }

  // ── the small map draw ──
  let miniSig = '';
  function drawMini(cam) {
    if (!mini || !mapEl || mapEl.classList.contains('min') || mapEl.offsetParent === null) return false;
    const ctx = mini.getContext ? mini.getContext('2d') : null;
    if (!ctx) return false;
    const css = mini.clientWidth || 220, d = dprOf(), W = Math.round(css * d);
    if (mini.width !== W) { mini.width = W; mini.height = W; }
    const p = camPose();
    const s = `${M.ver}|${W}|${p ? [p.x, p.z, p.a, p.len].map(v => Math.round(v * 10)).join() : ''}|${M.open}`;
    if (s === miniSig) return false;
    miniSig = s;
    const lv = M.n > 256 && W > 300 ? 512 : 256, L = level(lv);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    if (L && L.c) ctx.drawImage(L.c, 0, 0, W, W);
    if (lv !== 256 && L && L.x) { /* rivers are baked in 256 only */ drawRivers(ctx, { cx: 0, cz: 0, k: W / M.ws, w: W, h: W }, 0.6 * d, 2.5 * d); }
    const v = { cx: 0, cz: 0, k: W / M.ws, w: W, h: W };
    drawCam(ctx, v, p, d);
    drawNorth(ctx, W - 12 * d, 14 * d, d);
    return true;
  }

  // ── the large map draw ──
  function drawBig(force) {
    if (!M.open || !bctx || !M.view) return false;
    const t = now();
    if (!force && t - M.lastDraw < 33) { M.dirty = true; return false; }
    M.lastDraw = t; M.dirty = false;
    const d = dprOf(), v = M.view, ctx = bctx;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.fillStyle = '#05080a'; ctx.fillRect(0, 0, v.w, v.h);
    const want = pickLevel(v, M.ws, d, maxLevel());
    const L = level(want) || level(256);
    if (L && L.c) {
      const s = L.c.width, pk = s / M.ws;
      const wx0 = v.cx - v.w / 2 / v.k, wz0 = v.cz - v.h / 2 / v.k;
      ctx.imageSmoothingEnabled = v.k * d > pk * 1.5 ? false : true;
      const sx = (wx0 + M.ws / 2) * pk, sz = (wz0 + M.ws / 2) * pk, sw = v.w / v.k * pk, sh = v.h / v.k * pk;
      // only the part inside the image (drawImage with a rect outside it fails in some browsers)
      const cx0 = Math.max(0, sx), cz0 = Math.max(0, sz), cx1 = Math.min(s, sx + sw), cz1 = Math.min(s, sz + sh);
      if (cx1 > cx0 && cz1 > cz0) ctx.drawImage(L.c, cx0, cz0, cx1 - cx0, cz1 - cz0, (cx0 - sx) / pk * v.k, (cz0 - sz) / pk * v.k, (cx1 - cx0) / pk * v.k, (cz1 - cz0) / pk * v.k);
    }
    // the edge of the terrain
    const a = toScreen(-M.ws / 2, -M.ws / 2, v), b = toScreen(M.ws / 2, M.ws / 2, v);
    ctx.strokeStyle = 'rgba(150,220,180,0.35)'; ctx.lineWidth = 1; ctx.strokeRect(a[0] + 0.5, a[1] + 0.5, b[0] - a[0], b[1] - a[1]);
    if (M.layers.grid) {
      const g = niceScale(v.k, 120).m;
      ctx.strokeStyle = 'rgba(228,232,227,0.14)'; ctx.beginPath();
      for (let x = Math.ceil(-M.ws / 2 / g) * g; x <= M.ws / 2; x += g) { const s = toScreen(x, 0, v)[0]; ctx.moveTo(Math.round(s) + 0.5, Math.max(0, a[1])); ctx.lineTo(Math.round(s) + 0.5, Math.min(v.h, b[1])); }
      for (let z = Math.ceil(-M.ws / 2 / g) * g; z <= M.ws / 2; z += g) { const s = toScreen(0, z, v)[1]; ctx.moveTo(Math.max(0, a[0]), Math.round(s) + 0.5); ctx.lineTo(Math.min(v.w, b[0]), Math.round(s) + 0.5); }
      ctx.stroke();
    }
    drawRivers(ctx, v, 0.8, 7);
    // features and bookmarks
    ctx.font = '600 11px Inter, system-ui, sans-serif'; ctx.textBaseline = 'middle';
    for (const f of M.features) {
      const [x, y] = toScreen(f.x, f.z, v);
      if (x < -20 || y < -20 || x > v.w + 20 || y > v.h + 20) continue;
      ctx.fillStyle = f.id === 'peak' ? '#f2c27a' : f.id === 'lake' ? '#7cc0f0' : f.id === 'ridge' ? '#d9c8b0' : '#9bd3f5';
      ctx.strokeStyle = 'rgba(6,8,10,0.9)'; ctx.lineWidth = 2;
      ctx.beginPath();
      if (f.id === 'peak' || f.id === 'ridge') { ctx.moveTo(x, y - 6); ctx.lineTo(x + 6, y + 5); ctx.lineTo(x - 6, y + 5); ctx.closePath(); }
      else ctx.arc(x, y, 4.5, 0, TAU);
      ctx.stroke(); ctx.fill();
      ctx.textAlign = 'left'; ctx.strokeText(f.label, x + 9, y); ctx.fillStyle = '#e4e8e3'; ctx.fillText(f.label, x + 9, y);
    }
    for (const bm of marks.list(sig())) {
      const [x, y] = toScreen(bm.x, bm.z, v);
      if (x < -20 || y < -20 || x > v.w + 20 || y > v.h + 20) continue;
      ctx.fillStyle = '#8fd6a0'; ctx.strokeStyle = 'rgba(6,8,10,0.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 5, y - 9); ctx.arc(x, y - 10, 5, Math.PI, 0); ctx.lineTo(x, y); ctx.closePath(); ctx.stroke(); ctx.fill();
      ctx.textAlign = 'left'; ctx.strokeText(bm.name, x + 8, y - 10); ctx.fillStyle = '#cfe9d6'; ctx.fillText(bm.name, x + 8, y - 10);
    }
    drawCam(ctx, v, camPose(), 1.3);
    // the aim: a pin and an arrow
    if (M.aimPin) {
      const [x, y] = toScreen(M.aimPin.x, M.aimPin.z, v);
      ctx.strokeStyle = '#f2c27a'; ctx.fillStyle = '#f2c27a'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, y, 7, 0, TAU); ctx.stroke();
      if (M.aimPin.to) {
        const [ex, ey] = M.aimPin.to, an = Math.atan2(ey - y, ex - x);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - 12 * Math.cos(an - 0.4), ey - 12 * Math.sin(an - 0.4)); ctx.lineTo(ex - 12 * Math.cos(an + 0.4), ey - 12 * Math.sin(an + 0.4)); ctx.closePath(); ctx.fill();
      }
    }
    // the scale bar (lower right) and the north arrow (upper right)
    const sc = niceScale(v.k, Math.min(140, v.w * 0.25));
    const x1 = v.w - 14, x0 = x1 - sc.px, y0 = v.h - 16;
    ctx.strokeStyle = 'rgba(6,8,10,0.8)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke();
    ctx.strokeStyle = 'rgba(228,232,227,0.95)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.moveTo(x0, y0 - 4); ctx.lineTo(x0, y0 + 4); ctx.moveTo(x1, y0 - 4); ctx.lineTo(x1, y0 + 4); ctx.stroke();
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(6,8,10,0.85)';
    ctx.strokeText(sc.text, x1, y0 - 5); ctx.fillStyle = '#e4e8e3'; ctx.fillText(sc.text, x1, y0 - 5);
    drawNorth(ctx, v.w - 22, 22, 1.4);
    M.lastScale = sc;
    const p = camPose(); M.lastPose = p ? [p.x, p.z, p.a].map(x => Math.round(x * 10)).join() : '';
    big.setAttribute('aria-label', `Large map of the terrain, north up, ${sc.text} scale bar, ${Math.round(v.w / v.k / 100) / 10} km across. The camera is at ${fmtXZ(p ? p.x : 0, p ? p.z : 0)}.`);
    return true;
  }
  const fmtKm = (v, pos, neg) => `${(Math.abs(v) / 1000).toFixed(2)} km ${v >= 0 ? pos : neg}`;
  const fmtXZ = (x, z) => `${fmtKm(x, 'E', 'W')}, ${fmtKm(z, 'S', 'N')}`;
  function readout(x, z) {
    const w = app.world, h = w && w.heightAt ? w.heightAt(x, z) : NaN, sea = w && Number.isFinite(w.seaLevel) ? w.seaLevel - 0.4 : 0;
    const S = M.snap;
    let bio = '';
    if (S && S.biome && M.BIOMES) {
      const n = M.n, i = clamp(Math.floor((x / M.ws + 0.5) * n), 0, n - 1), j = clamp(Math.floor((z / M.ws + 0.5) * n), 0, n - 1);
      const b = M.BIOMES[S.biome[j * n + i]]; if (b) bio = b.name || b.key || '';
    }
    const ht = !Number.isFinite(h) ? '' : h < sea ? `${Math.round(sea - h)} m under the sea` : `${Math.round(h - Math.max(0, sea))} m`;
    return [fmtXZ(x, z), ht, bio].filter(Boolean).join(' · ');
  }
  function setRead(text) { M.readText = text; const r = $('atRead'); if (r) r.textContent = text; }

  // ── flights ──
  function fly(x, z, opt = {}, why = 'click') {
    const l = M.ws / 2;
    x = clamp(x, -l, l); z = clamp(z, -l, l);
    const rec = { x, z, ...opt, why };
    M.flights.push(rec);
    if (app.flyView) app.flyView(x, z, opt);
    else if (app.flyTo) app.flyTo(x, z);
    close('fly');
    return rec;
  }

  // ── pointer and wheel on the large map ──
  const pts = new Map();
  let drag = null, pinch = null, holdT = 0;
  const local = e => { const r = big.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  big.addEventListener('pointerdown', e => {
    if (!M.view) return;
    const p = local(e);
    pts.set(e.pointerId, p);
    try { big.setPointerCapture(e.pointerId); } catch { /* jsdom */ }
    if (pts.size === 2) {
      clearTimeout(holdT); drag = null; M.aimPin = null;
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
      return;
    }
    const w = toWorld(p[0], p[1], M.view);
    drag = { x: p[0], y: p[1], lx: p[0], ly: p[1], w, moved: false, aim: !!e.shiftKey, t: now() };
    if (drag.aim) { M.aimPin = { x: w[0], z: w[1], to: null }; drawBig(true); }
    clearTimeout(holdT);
    holdT = setTimeout(() => { if (drag && !drag.moved && !drag.aim) { drag.aim = true; M.aimPin = { x: drag.w[0], z: drag.w[1], to: null }; drawBig(true); } }, HOLD_MS);
    e.preventDefault();
  });
  big.addEventListener('pointermove', e => {
    if (!M.view) return;
    const p = local(e);
    if (pts.has(e.pointerId)) pts.set(e.pointerId, p);
    if (pinch && pts.size >= 2) {
      const [a, b] = [...pts.values()];
      const dd = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      M.view = panBy(M.view, m[0] - pinch.m[0], m[1] - pinch.m[1], M.ws);
      M.view = zoomAbout(M.view, m[0], m[1], dd / pinch.d, M.ws);
      pinch = { d: dd, m };
      drawBig();
      return;
    }
    if (drag) {
      if (!drag.moved && Math.hypot(p[0] - drag.x, p[1] - drag.y) > DRAG_PX) { drag.moved = true; clearTimeout(holdT); }
      if (drag.aim) { if (drag.moved) { M.aimPin.to = p; drawBig(); } }
      else if (drag.moved) { M.view = panBy(M.view, p[0] - drag.lx, p[1] - drag.ly, M.ws); drawBig(); }
      drag.lx = p[0]; drag.ly = p[1];
    }
    const w = toWorld(p[0], p[1], M.view);
    M.hover = w; setRead(readout(w[0], w[1]));
  });
  const up = e => {
    pts.delete(e.pointerId);
    clearTimeout(holdT);
    if (pinch) { if (pts.size < 2) pinch = null; drag = null; return; }
    const d = drag; drag = null;
    if (!d || e.type === 'pointercancel') { M.aimPin = null; return; }
    const p = local(e);
    if (d.aim) {
      const end = toWorld(p[0], p[1], M.view), dx = end[0] - d.w[0], dz = end[1] - d.w[1];
      M.aimPin = null;
      if (Math.hypot(p[0] - d.x, p[1] - d.y) > DRAG_PX * 2) fly(d.w[0], d.w[1], { yaw: aimYaw(dx, dz), pitch: -0.32 }, 'aim');
      else fly(d.w[0], d.w[1], {}, 'click');
    } else if (!d.moved) fly(d.w[0], d.w[1], {}, 'click');
  };
  big.addEventListener('pointerup', up);
  big.addEventListener('pointercancel', up);
  big.addEventListener('pointerleave', () => { if (!drag) setRead(''); });
  big.addEventListener('wheel', e => {
    if (!M.view) return;
    e.preventDefault();
    const p = local(e), dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    M.view = zoomAbout(M.view, p[0], p[1], Math.exp(-clamp(dy, -400, 400) * 0.0018), M.ws);
    drawBig();
  }, { passive: false });
  big.addEventListener('contextmenu', e => e.preventDefault());

  // ── buttons ──
  const zoomBtn = f => { if (!M.view) return; M.view = zoomAbout(M.view, M.view.w / 2, M.view.h / 2, f, M.ws); drawBig(true); };
  const fit = () => { M.view = fitView(M.ws, M.cw || 800, M.ch || 600); drawBig(true); };
  q('#atFit').addEventListener('click', fit);
  q('#atIn').addEventListener('click', () => zoomBtn(1.6));
  q('#atOut').addEventListener('click', () => zoomBtn(1 / 1.6));
  q('#atClose').addEventListener('click', () => close());
  q('.at-back').addEventListener('click', () => close());
  q('#atSide').addEventListener('click', () => {
    const hid = box.classList.toggle('noside');
    q('#atSide').setAttribute('aria-expanded', String(!hid));
    setTimeout(() => { layout(); drawBig(true); }, 0);
  });
  for (const b of box.querySelectorAll('[data-colour]')) b.addEventListener('click', () => { M.layers.colour = b.dataset.colour; layersChanged(); });
  for (const b of box.querySelectorAll('[data-layer]')) b.addEventListener('click', () => { M.layers[b.dataset.layer] = !M.layers[b.dataset.layer]; layersChanged(); });
  function layersChanged() {
    try { const s = storage(); if (s) s.setItem('dla-terrain-map-layers', JSON.stringify(M.layers)); } catch { /* memory only */ }
    syncLayers(); buildLegend(); miniSig = ''; drawBig(true);
  }
  function syncLayers() {
    for (const b of box.querySelectorAll('[data-colour]')) { const on = b.dataset.colour === M.layers.colour; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    for (const b of box.querySelectorAll('[data-layer]')) { const on = !!M.layers[b.dataset.layer]; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  }
  function buildFeatures() {
    const el = $('atFeat'); if (!el) return;
    el.innerHTML = '';
    if (!M.features.length) { el.appendChild(mk('p', 'at-note', M.terrain ? 'No named places on this terrain.' : 'The places come when the terrain is done.')); return; }
    for (const f of M.features) {
      const b = mk('button', 'at-chip', null, { type: 'button', 'data-feat': f.id });
      b.appendChild(mk('b', '', f.label)); if (f.text) b.appendChild(mk('i', '', f.text));
      b.addEventListener('click', () => fly(f.x, f.z, { dist: f.dist }, 'feature'));
      el.appendChild(b);
    }
  }
  function buildMarks() {
    const ul = $('atMarks'), note = $('atMarkNote'); if (!ul) return;
    ul.innerHTML = '';
    const s = sig(), mine = marks.list(s), other = marks.all().length - mine.length;
    for (const bm of mine) {
      const li = mk('li');
      const go = mk('button', 'at-go', bm.name, { type: 'button', 'data-mark': bm.id, title: `Fly to ${bm.name}` });
      go.addEventListener('click', () => fly(bm.x, bm.z, { yaw: bm.yaw, pitch: bm.pitch, dist: bm.dist }, 'bookmark'));
      const del = mk('button', 'at-del', '×', { type: 'button', 'aria-label': `Delete the bookmark ${bm.name}`, 'data-del': bm.id });
      del.addEventListener('click', () => { marks.remove(bm.id); buildMarks(); drawBig(true); });
      li.append(go, del); ul.appendChild(li);
    }
    if (!mine.length) ul.appendChild(mk('li', 'at-note', 'No saved views on this terrain yet.'));
    const txt = [other > 0 ? `${other} more on other terrains.` : '', marks.stored ? '' : 'This browser does not keep them: they last until the page closes.'].filter(Boolean).join(' ');
    note.hidden = !txt; note.textContent = txt;
  }
  q('#atSave').addEventListener('click', () => saveView());
  function saveView(name) {
    if (!app.cam) return null;
    const p = viewOfCamera(app.cam, app.world && app.world.heightAt);
    const h = app.world && app.world.heightAt ? app.world.heightAt(p.x, p.z) : 0;
    const n = marks.list(sig()).length + 1;
    const rec = marks.add({ ...p, sig: sig(), name: name || `View ${n} · ${Math.round(h)} m` });
    buildMarks(); drawBig(true);
    if (o.toast) o.toast(marks.stored ? `Saved "${rec.name}"` : `Saved "${rec.name}" for this visit only`);
    return rec;
  }
  function buildLegend() {
    const el = $('atLegend'); if (!el) return;
    el.innerHTML = '';
    const L = M.levels.get(256), meta = L && L.meta;
    const row = (sw, text) => { const r = mk('div', 'at-lrow'); const s = mk('i', 'at-sw'); s.style.background = sw; r.append(s, mk('span', '', text)); el.appendChild(r); };
    if (M.layers.colour === 'elev' || !(M.snap && M.snap.biome)) {
      const g = ELEV_STOPS.map(([t, c]) => `rgb(${c.map(Math.round).join(',')}) ${Math.round(t * 100)}%`).join(',');
      const bar = mk('div', 'at-ramp'); bar.style.background = `linear-gradient(90deg,${g})`; el.appendChild(bar);
      if (meta) { const base = Math.max(meta.lo, meta.sea); el.appendChild(mk('div', 'at-rampt', `${Math.round(base - Math.max(0, meta.sea))} m · ${Math.round(meta.hi - Math.max(0, meta.sea))} m`)); }
    } else if (M.BIOMES) {
      const cnt = new Map(), B = M.snap.biome;
      for (let i = 0; i < B.length; i += 7) cnt.set(B[i], (cnt.get(B[i]) || 0) + 1);
      const tot = Math.ceil(B.length / 7);
      for (const b of M.BIOMES) { const c = cnt.get(b.id) || 0; if (c / tot >= 0.003) row(`rgb(${rgbOf(b).join(',')})`, `${b.name} ${Math.round(c / tot * 100)}%`); }
    }
    row('rgb(40,90,140)', 'Sea, darker when deep');
    row('rgb(52,108,156)', 'Lakes');
    row('rgb(120,190,240)', 'Rivers');
    if (M.layers.shade) row('linear-gradient(135deg,#ddd,#333)', 'Hillshade, light from the north-west');
    const step = meta ? contourStep(meta.hi - meta.lo) : 0;
    if (M.layers.contours && step) row('rgba(0,0,0,0.5)', `Contours every ${step} m, a darker line every ${step * 5} m`);
    row('rgba(255,233,184,0.8)', 'Camera and its view; + the orbit point');
    row('#8fd6a0', 'Bookmarks');
    row('#f2c27a', 'Named places');
  }

  // ── keys ──
  const typing = e => { const t = e.target; return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '')); };
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || typing(e)) return;
    if (!M.open) {
      if (e.code === 'KeyM' && !e.repeat && !saverOn()) { if (open()) { e.preventDefault(); e.stopPropagation(); } }
      return;
    }
    // the map is open: its keys, and no camera keys reach the page
    if (e.key === 'Tab') { trap(e); return; }
    const inMap = e.target === big || e.target === doc.body || e.target === box || !box.contains(e.target) || e.target === null;
    let used = true;
    const st = 0.12 * Math.min(M.view ? M.view.w : 600, M.view ? M.view.h : 400);
    if (e.key === 'Escape' || e.code === 'KeyM') close();
    else if (!M.view || !inMap) used = e.key === 'Escape';
    else if (e.key === 'ArrowLeft') { M.view = panBy(M.view, st, 0, M.ws); drawBig(true); }
    else if (e.key === 'ArrowRight') { M.view = panBy(M.view, -st, 0, M.ws); drawBig(true); }
    else if (e.key === 'ArrowUp') { M.view = panBy(M.view, 0, st, M.ws); drawBig(true); }
    else if (e.key === 'ArrowDown') { M.view = panBy(M.view, 0, -st, M.ws); drawBig(true); }
    else if (e.key === '+' || e.key === '=') zoomBtn(1.4);
    else if (e.key === '-' || e.key === '_') zoomBtn(1 / 1.4);
    else if (e.key === '0') fit();
    else if (e.key === 'Enter' && e.target === big) fly(M.view.cx, M.view.cz, {}, 'key');
    else used = false;
    if (used) e.preventDefault();
    e.stopPropagation();
  }
  function trap(e) {
    const f = [...box.querySelectorAll('button, canvas[tabindex], [tabindex="0"]')].filter(x => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const i = f.indexOf(doc.activeElement);
    if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
    e.stopPropagation();
  }
  // capture on the document: before main.js and input.js (window, bubble)
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('keyup', e => { if (M.open && !e.ctrlKey && !e.metaKey) e.stopPropagation(); }, true);

  // ── each frame (ui.drawMap): the small map, the open map when the pose moved ──
  function tick(cam) {
    if (M.open && saverOn()) close();
    if (M.open) {
      const p = camPose(), s = p ? [p.x, p.z, p.a].map(x => Math.round(x * 10)).join() : '';
      if (M.dirty || s !== M.lastPose) drawBig();
    }
    return drawMini(cam);
  }

  return {
    setTerrain, tick, drawMini, open, close, toggle, fly, saveView, marks,
    get isOpen() { return M.open; },
    // the large map hides the 3D view: main.js draws no GPU frame
    covers: () => M.open,
    get view() { return M.view; }, set view(v) { M.view = v; M.dirty = true; },
    debug: () => ({ open: M.open, full: box.classList.contains('full'), view: M.view && { ...M.view }, levels: [...M.levels.keys()], features: M.features.map(f => f.id), flights: M.flights.slice(), read: M.readText, layers: { ...M.layers }, sig: sig(), aim: M.aimPin }),
  };
}
