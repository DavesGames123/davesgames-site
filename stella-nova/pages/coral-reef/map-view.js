// ============================================================================
//  CORAL REEF  ·  map-view.js  ·  the large map of the explored seafloor
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "the minimap should be a whole nlot more
//  functional. i want to be able to click it to open an expanded view and
//  navigate".
//
//  A click or a tap on the minimap (squad-hud.js), Enter on it, or the key
//  M opens the large map (#xmap). Esc, M, the close button and the dim
//  backdrop close it. A wide screen: a box over most of the window; a
//  phone: the full screen (class "full"). While it is open, covers() is
//  true and main.js draws no 3D frame (the squad, the camera and the
//  streamer go on), so the map costs no GPU time.
//
//  MOVE  a drag pans, the wheel, a pinch and + - zoom about the pointer
//  (SPAN_MIN 60 m to SPAN_MAX 200 km across), "Fit all" shows every
//  explored cell, the ROVs and the camera, "Track" keeps the selected ROV
//  in the centre. Arrows pan, + - 0 zoom from the keyboard.
//
//  ACT  a click near an ROV arrow selects it (hud.select). Else the click
//  does the action of "Click to": "Send ROV n" (hud.sendTo: squad.goTo)
//  or "Move camera" (o.moveCam: the free camera goes there; the map
//  closes). Shift + click does the other action. "Follow" makes the
//  camera follow the selected ROV and closes the map. "Go to" has the
//  region shortcuts (o.goRegion, the same as the panel chips).
//
//  SHOW  the explored cells (depth colour, hill shade, contours, a tint of
//  the region; dark where not explored), the ROV arrows and their trails
//  since the page opened, the sent targets, the camera cone, markers for
//  big colonies and rock features (arches, pinnacles) near the ROVs, a
//  scale bar, the north arrow, a legend, and under the pointer the place,
//  the depth and the region (explored cells only). "History" plays the
//  exploration back: the cells and trails up to a time.
//
//  COST  createAtlas keeps world-anchored tiles (TILE px) at four
//  resolutions (LODS 3, 12, 48, 192 m a pixel). A tile is made when a view
//  needs it, and each explored cell is painted once into it from a queue
//  with a time budget (work(ms)). The map draws only when the view, the
//  data or a pose changes (at most 30 a second), and only while it is open.
//  At most MAX_TILES tiles (fewer on a phone) are kept; the oldest go.
//
//  PURE PARTS (tests/mapview.test.mjs): zoomAbout, panBy, fitBounds,
//  lodFor, tileOf, createAtlas (with no canvas), nearestRov, histCut.
//
//  grep -n targets
//    "export const LODS"             the resolutions
//    "export function zoomAbout"     zoom about a point; "panBy"
//    "export function fitBounds"     the "Fit all" view
//    "export function lodFor"        the resolution for a view
//    "export function createAtlas"   the tiles of the explored cells
//    "export function nearestRov"    the ROV under a click
//    "export function mountExploreMap"  the DOM part
//    "  function draw("  "  function onKey"  "  function record("
// ============================================================================
import { MAP_CELL, worldToMap, mapToWorld, depthColour, contourLevel, REGION_TINT, niceScale, coneOf, headingVec, cellKey, parseCell, LEGEND_STOPS } from './minimap.js';

export const LODS = [3, 12, 48, 192];     // m per pixel
export const TILE = 128;                  // px per tile side
export const MAX_TILES = 360;             // about 23 MB of RGBA
export const SPAN_MIN = 60, SPAN_MAX = 200000;
export const PICK_PX = 18;                // a click this near an ROV arrow selects it
export const REGIONS = [['shallows', 'Shallows'], ['reef', 'Reef'], ['twilight', 'Twilight'], ['abyss', 'Abyss'], ['trench', 'Trench']];
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ── view maths (minimap.js view: { cx, cz, k px per m, w, h }, north up) ──
export function kRange(w, h) { const s = Math.min(w, h) || 1; return [s / SPAN_MAX, s / SPAN_MIN]; }
export function zoomAbout(v, px, py, f) {
  const [a, b] = kRange(v.w, v.h), k = clamp(v.k * f, a, b);
  const [x, z] = mapToWorld(px, py, v);
  return { cx: x - (px - v.w / 2) / k, cz: z - (py - v.h / 2) / k, k, w: v.w, h: v.h };
}
export function panBy(v, dx, dy) { return { ...v, cx: v.cx - dx / v.k, cz: v.cz - dy / v.k }; }
// b = [x0, z0, x1, z1] world m -> the view that shows it (with a margin)
export function fitBounds(b, w, h, pad = 0.08) {
  const sx = Math.max(SPAN_MIN, b[2] - b[0]), sz = Math.max(SPAN_MIN, b[3] - b[1]);
  const [a, c] = kRange(w, h);
  const k = clamp(Math.min(w / (sx * (1 + 2 * pad)), h / (sz * (1 + 2 * pad))), a, c);
  return { cx: (b[0] + b[2]) / 2, cz: (b[1] + b[3]) / 2, k, w, h };
}
// the coarsest resolution that still has a pixel per device pixel (or the finest)
export function lodFor(k, dpr = 1) {
  const mpp = 1 / (k * dpr);
  let best = 0;
  for (let i = 0; i < LODS.length; i++) if (LODS[i] <= Math.max(LODS[0], mpp * 1.5)) best = i;
  return best;
}
export function tileOf(x, z, lod) { const s = TILE * LODS[lod]; return [Math.floor(x / s), Math.floor(z / s)]; }
// the ROV whose arrow is within r px of (px, py), or null
export function nearestRov(rovs, px, py, v, r = PICK_PX) {
  let best = null, bd = r;
  for (const q of rovs || []) { const [x, y] = worldToMap(q.p[0], q.p[2], v), d = Math.hypot(x - px, y - py); if (d <= bd) { bd = d; best = q; } }
  return best;
}
// history: the index of the last trail point at or before time t
export function histCut(pts, t) { let lo = 0, hi = pts.length; while (lo < hi) { const m = (lo + hi) >> 1; if (pts[m][2] <= t) lo = m + 1; else hi = m; } return lo; }

// ── the tiles of the explored cells ─────────────────────────────────────────
// o = { ground(x, z) -> y, region?(x, z) -> { id }, surfaceY, doc?, maxTiles?, now? }
export function createAtlas(o) {
  const surf = o.surfaceY ?? 55, doc = o.doc || null, maxTiles = o.maxTiles || MAX_TILES;
  const now = o.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const cells = new Map();            // key -> [i, j, t first seen]
  const order = [];                   // keys in the order seen
  const index = LODS.map(() => new Map());   // per lod: tile key -> [cell keys]
  const tiles = new Map();            // `${lod}:${ti},${tj}` -> tile
  const queue = [];                   // [tile, cell key]
  let bounds = null, use = 0;
  const A = {
    cells, order, tiles, index, get bounds() { return bounds; }, get pending() { return queue.length; },
    // new keys of the visited map (insertion order: the new ones are last)
    sync(visited, t) {
      if (!visited || visited.size <= order.length) return 0;
      let i = 0, n = 0;
      for (const k of visited.keys()) {
        if (i++ < order.length) continue;
        if (cells.has(k)) continue;
        add(k, t); n++;
      }
      return n;
    },
    add: (k, t) => add(k, t),
    // the tile (made on demand: every known cell in it goes to the queue)
    tile(lod, ti, tj) {
      const key = `${lod}:${ti},${tj}`;
      let T = tiles.get(key);
      if (T) { T.used = ++use; return T; }
      const list = index[lod].get(`${ti},${tj}`);
      if (!list) return null;
      T = { key, lod, ti, tj, px: new Uint8ClampedArray(TILE * TILE * 4), done: new Set(), canvas: null, ctx: null, img: null, dirty: null, used: ++use };
      if (doc && doc.createElement) {
        try { const c = doc.createElement('canvas'); c.width = c.height = TILE; const x = c.getContext && c.getContext('2d'); if (x && x.createImageData) { T.canvas = c; T.ctx = x; T.img = x.createImageData(TILE, TILE); } } catch { /* no canvas */ }
      }
      tiles.set(key, T);
      for (const k of list) queue.push([T, k]);
      if (tiles.size > maxTiles) evict();
      return T;
    },
    // paint queued cells for at most ms (or one cell with no clock)
    work(ms = 3) {
      const t0 = now();
      let n = 0;
      while (queue.length && (n === 0 || now() - t0 < ms)) { const [T, k] = queue.shift(); if (tiles.get(T.key) === T) paint(T, k); n++; }
      return n;
    },
    // put the painted pixels of a tile to its canvas
    flush(T) {
      if (!T || !T.dirty || !T.ctx) return;
      const [x0, y0, x1, y1] = T.dirty;
      T.img.data.set(T.px);
      T.ctx.putImageData(T.img, 0, 0, x0, y0, x1 - x0, y1 - y0);
      T.dirty = null;
    },
    // the tiles of lod that cover the view, made on demand
    tilesIn(v, lod) {
      const x0 = v.cx - v.w / 2 / v.k, x1 = v.cx + v.w / 2 / v.k, z0 = v.cz - v.h / 2 / v.k, z1 = v.cz + v.h / 2 / v.k;
      const [a, b] = tileOf(x0, z0, lod), [c, d] = tileOf(x1, z1, lod), out = [];
      if ((c - a + 1) * (d - b + 1) > 4000) return out;
      for (let j = b; j <= d; j++) for (let i = a; i <= c; i++) { if (!index[lod].has(`${i},${j}`)) continue; const T = A.tile(lod, i, j); if (T) out.push(T); }
      return out;
    },
    reset() { cells.clear(); order.length = 0; for (const m of index) m.clear(); tiles.clear(); queue.length = 0; bounds = null; },
  };
  function add(k, t) {
    const [i, j] = parseCell(k);
    if (!Number.isFinite(i) || !Number.isFinite(j)) return;
    cells.set(k, [i, j, t || 0]); order.push(k);
    const x = i * MAP_CELL, z = j * MAP_CELL;
    bounds = bounds ? [Math.min(bounds[0], x), Math.min(bounds[1], z), Math.max(bounds[2], x + MAP_CELL), Math.max(bounds[3], z + MAP_CELL)] : [x, z, x + MAP_CELL, z + MAP_CELL];
    for (let L = 0; L < LODS.length; L++) {
      const [ti, tj] = tileOf(x + MAP_CELL / 2, z + MAP_CELL / 2, L), tk = `${ti},${tj}`;
      let list = index[L].get(tk); if (!list) { list = []; index[L].set(tk, list); }
      list.push(k);
      const T = tiles.get(`${L}:${tk}`);
      if (T) queue.push([T, k]);
    }
  }
  function evict() {
    const a = [...tiles.values()].sort((p, q) => p.used - q.used);
    for (let n = 0; n < a.length && tiles.size > maxTiles * 0.85; n++) tiles.delete(a[n].key);
  }
  // one pixel: depth colour, shade, contour and region tint
  function shadePx(T, u, v, D, Dx, Dz, res, rg) {
    if (u < 0 || v < 0 || u >= TILE || v >= TILE) return;
    const c = depthColour(D), tint = rg && REGION_TINT[rg.id];
    const gx = (Dx - D) / res, gz = (Dz - D) / res;
    const shade = clamp(1 + 0.9 * (gx + gz) / Math.SQRT2, 0.55, 1.35);
    const on = Math.floor(contourLevel(Dx)) !== Math.floor(contourLevel(D)) || Math.floor(contourLevel(Dz)) !== Math.floor(contourLevel(D));
    const k = (on ? 0.62 : 1) * shade, q = (v * TILE + u) * 4;
    for (let ch = 0; ch < 3; ch++) T.px[q + ch] = clamp((tint ? c[ch] * 0.82 + tint[ch] * 0.18 : c[ch]) * k, 0, 255);
    T.px[q + 3] = 255;
  }
  function paint(T, k) {
    const cl = cells.get(k); if (!cl) return;
    const res = LODS[T.lod], ox = T.ti * TILE * res, oz = T.tj * TILE * res;
    const x0 = cl[0] * MAP_CELL, z0 = cl[1] * MAP_CELL;
    const dep = (x, z) => surf - o.ground(x, z);
    let u0, v0, u1, v1;
    if (res < MAP_CELL) {
      // a cell is (MAP_CELL / res)^2 pixels: each from its own sample
      const sub = MAP_CELL / res;
      u0 = Math.round((x0 - ox) / res); v0 = Math.round((z0 - oz) / res); u1 = u0 + sub; v1 = v0 + sub;
      const rg = o.region ? o.region(x0 + MAP_CELL / 2, z0 + MAP_CELL / 2) : null;
      for (let b = 0; b < sub; b++) for (let a = 0; a < sub; a++) {
        const x = x0 + (a + 0.5) * res, z = z0 + (b + 0.5) * res;
        shadePx(T, u0 + a, v0 + b, dep(x, z), dep(x + res, z), dep(x, z + res), res, rg);
      }
    } else {
      // a pixel holds (res / MAP_CELL)^2 cells: paint it once
      const u = Math.floor((x0 + MAP_CELL / 2 - ox) / res), v = Math.floor((z0 + MAP_CELL / 2 - oz) / res), pk = v * TILE + u;
      if (T.done.has(pk)) return;
      T.done.add(pk);
      const x = ox + (u + 0.5) * res, z = oz + (v + 0.5) * res;
      const rg = o.region ? o.region(x, z) : null;
      shadePx(T, u, v, dep(x, z), dep(x + res, z), dep(x, z + res), res, rg);
      u0 = u; v0 = v; u1 = u + 1; v1 = v + 1;
    }
    const r = [clamp(u0, 0, TILE), clamp(v0, 0, TILE), clamp(u1, 0, TILE), clamp(v1, 0, TILE)];
    T.dirty = T.dirty ? [Math.min(T.dirty[0], r[0]), Math.min(T.dirty[1], r[1]), Math.max(T.dirty[2], r[2]), Math.max(T.dirty[3], r[3])] : r;
  }
  return A;
}

// ── the DOM part ────────────────────────────────────────────────────────────
// o = { doc, win, getSquad, getField, getCam, camera() (three), canvas,
//   surfaceY, phoneQ, isSaver, flash, hud: { selected(), select(id, opt),
//   sendTo(xz), colourOf(id) }, goRegion(id)?, moveCam(x, z)?,
//   colonies()?, speciesLabel(id)?, regionNow()? }
export function mountExploreMap(o) {
  const doc = o.doc, win = o.win || doc.defaultView, H = o.hud;
  const $ = id => doc.getElementById(id);
  const root = doc.documentElement;
  const now = () => (win.performance ? win.performance.now() : Date.now());
  const phone = () => !!(o.phoneQ && o.phoneQ.matches);
  const dprOf = () => Math.min(3, win.devicePixelRatio || 1);
  const mk = (tag, cls, text, attrs) => {
    const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text;
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };
  const M = {
    open: false, view: null, track: false, act: 'send', dirty: true, lastDraw: -1e9, poseSig: '',
    atlas: null, squad: null, W: null, trails: new Map(), targets: new Map(), marks: new Map(), recT: 0, markT: 0, syncT: 1,
    hist: 1, read: '', actions: [], fitDone: false,
  };

  // ── DOM ──
  const box = mk('div', 'xmap', null, { id: 'xmap', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'xmTitle' });
  box.hidden = true;
  box.innerHTML = `
<div class="xm-back"></div>
<div class="xm-box">
  <header class="xm-head">
    <h2 id="xmTitle">Explored seafloor</h2><span id="xmSub" class="xm-sub"></span>
    <div class="xm-tools">
      <div class="xm-seg" role="group" aria-label="A click on the map">
        <button type="button" data-act="send" id="xmSend">Send ROV</button><button type="button" data-act="camera" id="xmCam">Move camera</button>
      </div>
      <button type="button" id="xmFit" title="Show all explored ground (0)">Fit all</button>
      <button type="button" id="xmTrack" aria-pressed="false" title="Keep the selected ROV in the centre">Track</button>
      <button type="button" id="xmIn" aria-label="Zoom in (+)">+</button>
      <button type="button" id="xmOut" aria-label="Zoom out (−)">−</button>
      <button type="button" id="xmSide" aria-label="Show or hide the map menu" aria-expanded="true" aria-controls="xmAside">☰</button>
      <button type="button" id="xmClose" aria-label="Close the map (Esc)">×</button>
    </div>
  </header>
  <div class="xm-body">
    <div class="xm-stage">
      <canvas id="xmCanvas" tabindex="0" role="application" aria-roledescription="map" aria-describedby="xmHelp"></canvas>
      <div id="xmRead" class="xm-read"></div>
      <p id="xmHelp" class="xm-help">Click an ROV to select it · click the map to send it there (or move the camera) · Shift-click: the other action · drag: pan · wheel or pinch: zoom · arrows, + − 0 from the keys</p>
    </div>
    <aside id="xmAside" class="xm-side" aria-label="Map menu">
      <section><h3>ROVs</h3><div id="xmRovs" class="xm-rovs"></div>
        <button type="button" id="xmFollow" class="xm-wide">Follow with the camera</button></section>
      <section><h3>Go to a region</h3><div id="xmRegions" class="xm-regions"></div></section>
      <section><h3>Found</h3><ul id="xmFound" class="xm-found"></ul></section>
      <section><h3>History</h3>
        <input type="range" id="xmHist" min="0" max="1000" value="1000" step="1" aria-label="Show the exploration up to this time">
        <div class="xm-histrow"><span id="xmHistT">now</span><button type="button" id="xmPlay">Play</button></div></section>
      <section><h3>Legend</h3><div id="xmLegend" class="xm-legend"></div></section>
    </aside>
  </div>
</div>`;
  doc.body.appendChild(box);
  const cv = $('xmCanvas'), ctx = cv.getContext ? cv.getContext('2d') : null;
  const q = s => box.querySelector(s);

  // the legend (static)
  {
    const L = $('xmLegend');
    const row = (sw, text) => { const r = mk('div', 'xm-lrow'); const s = mk('i', 'xm-sw'); s.style.background = sw; r.append(s, mk('span', '', text)); L.appendChild(r); };
    const stops = LEGEND_STOPS.map((d, i) => `rgb(${depthColour(d).join(',')}) ${Math.round(i / (LEGEND_STOPS.length - 1) * 100)}%`).join(',');
    const bar = mk('div', 'xm-ramp'); bar.style.background = `linear-gradient(90deg,${stops})`; L.appendChild(bar);
    L.appendChild(mk('div', 'xm-rampt', LEGEND_STOPS.map(d => (d >= 1000 ? `${d / 1000} km` : `${d} m`)).join(' · ')));
    row('rgba(0,0,0,0.45)', 'Depth contours: 5 m to 60 m deep, then 25, 100 and 250 m');
    for (const [id, name] of REGIONS) row(`rgb(${REGION_TINT[id].join(',')})`, `${name}: a light tint on the explored ground`);
    row('#02070c', 'Dark: not explored yet (fog of war)');
    row('linear-gradient(90deg,#ffb38a,#7fe0cf)', 'ROV arrows and their trails since the page opened');
    row('rgba(212,236,239,0.4)', 'The camera and its view');
    row('#ffd36b', 'Big coral colonies the squad passed');
    row('#c9b6ff', 'Rock features: arches and pinnacles');
    row('#ffffff', 'A point an ROV was sent to');
  }
  for (const [id, name] of REGIONS) {
    const b = mk('button', 'xm-chip', name, { type: 'button', 'data-region': id });
    b.addEventListener('click', () => { if (o.goRegion) { const okk = o.goRegion(id); if (okk !== false) { M.actions.push({ kind: 'region', id }); M.fitDone = false; close(); } } });
    $('xmRegions').appendChild(b);
  }

  // ── data ──
  function ensure() {
    const sq = o.getSquad(), W = o.getField();
    if (!sq || !W) return null;
    if (sq !== M.squad || W !== M.W) {
      M.squad = sq; M.W = W; M.trails.clear(); M.targets.clear(); M.marks.clear(); M.fitDone = false;
      M.atlas = createAtlas({ ground: (x, z) => W.ground(x, z), region: W.regionAt ? (x, z) => W.regionAt(x, z) : null, surfaceY: o.surfaceY, doc, maxTiles: phone() ? 140 : MAX_TILES });
    }
    return sq;
  }
  const simT = () => (M.squad && M.squad.stats ? M.squad.stats.t || 0 : 0);
  // the trails, the found things and the cells: every frame (cheap) at low rates
  function record(dt) {
    const sq = ensure(); if (!sq) return;
    const t = simT();
    if ((M.syncT += dt) > 1) { M.syncT = 0; if (M.atlas.sync(sq.visited, t)) M.dirty = true; }
    if ((M.recT += dt) > 1) {
      M.recT = 0;
      for (const v of sq.vehicles) {
        let T = M.trails.get(v.id); if (!T) { T = [[]]; M.trails.set(v.id, T); }
        let seg = T[T.length - 1];
        const p = [v.state.p[0], v.state.p[2], t], qq = seg[seg.length - 1];
        if (qq && Math.hypot(p[0] - qq[0], p[1] - qq[1]) > 80) { seg = []; T.push(seg); }        // a jump (a region move)
        if (!qq || Math.hypot(p[0] - qq[0], p[1] - qq[1]) > 2 || t - qq[2] > 20) seg.push(p);
        let n = T.reduce((a, s) => a + s.length, 0);
        while (n > 6000 && T.length) { T[0].shift(); n--; if (!T[0].length) T.shift(); }
        if (!T.length) T.push([]);
      }
      M.dirty = true;
    }
    if ((M.markT += dt) > 2) { M.markT = 0; findThings(sq, t); }
  }
  function findThings(sq, t) {
    const W = M.W, A = M.atlas;
    const seen = (x, z) => A.cells.has(cellKey(Math.floor(x / MAP_CELL), Math.floor(z / MAP_CELL)));
    if (o.colonies) {
      let cols = []; try { cols = o.colonies() || []; } catch { cols = []; }
      for (const c of cols) {
        if (!c || !c.base || !(c.size >= 2) || M.marks.has(c.key)) continue;
        if (!seen(c.base[0], c.base[2])) continue;
        const name = (o.speciesLabel && o.speciesLabel(c.id)) || 'Coral colony';
        M.marks.set(c.key, { kind: 'colony', x: c.base[0], z: c.base[2], size: c.size, label: name, t });
      }
    }
    if (W && typeof W.features === 'function') {
      for (const v of sq.vehicles.slice(0, 1)) {
        let fs = []; try { fs = W.features(v.state.p[0], v.state.p[2], 40) || []; } catch { fs = []; }
        for (const f of fs) {
          if (!f.id || M.marks.has(f.id) || !(f.kind === 'arch' || f.kind === 'pinnacle')) continue;
          M.marks.set(f.id, { kind: f.kind, x: f.center[0], z: f.center[2], size: f.size, label: f.kind === 'arch' ? 'Natural arch' : (f.hoodoo ? 'Hoodoo pinnacle' : 'Pinnacle'), t });
        }
      }
    }
    // keep the largest 300
    if (M.marks.size > 300) { const a = [...M.marks.entries()].sort((p, q2) => (q2[1].size || 0) - (p[1].size || 0)); M.marks = new Map(a.slice(0, 300)); }
    if (M.open) buildFound();
  }

  // ── open and close ──
  function open() {
    if (M.open || o.isSaver() || !ensure()) return false;
    M.open = true; clearTimeout(M.closeT); M.closeT = 0;
    if (o.onOpen) o.onOpen();
    box.hidden = false; box.classList.toggle('full', phone()); box.classList.remove('on');
    const go = () => { if (M.open) box.classList.add('on'); };
    if (win.requestAnimationFrame) win.requestAnimationFrame(() => win.requestAnimationFrame(go)); else setTimeout(go, 16);
    root.classList.add('xmap-open');
    const mm = $('mmCanvas'); if (mm) mm.setAttribute('aria-expanded', 'true');
    M.atlas.sync(M.squad.visited, simT());
    layout();
    if (!M.view || !M.fitDone) { fitAll(false); M.fitDone = true; }
    buildRovs(); buildFound(); syncAct(); syncHist();
    M.dirty = true; draw(true);
    try { cv.focus({ preventScroll: true }); } catch { /* old focus API */ }
    return true;
  }
  function close() {
    if (!M.open) return false;
    M.open = false; drag = null; pts.clear(); pinch = null; stopPlay();
    box.classList.remove('on'); root.classList.remove('xmap-open');
    const mm = $('mmCanvas'); if (mm) mm.setAttribute('aria-expanded', 'false');
    const tt = M.closeT = setTimeout(() => { if (!M.open && M.closeT === tt) box.hidden = true; }, 240);
    return true;
  }
  function layout() {
    const r = cv.getBoundingClientRect ? cv.getBoundingClientRect() : null;
    M.cw = Math.max(1, Math.round((r && r.width) || (phone() ? win.innerWidth : (win.innerWidth || 1280) * 0.66) || 800));
    M.ch = Math.max(1, Math.round((r && r.height) || (phone() ? win.innerHeight * 0.6 : (win.innerHeight || 800) * 0.78) || 600));
    const d = dprOf(), Wd = Math.round(M.cw * d), Hd = Math.round(M.ch * d);
    if (cv.width !== Wd || cv.height !== Hd) { cv.width = Wd; cv.height = Hd; }
    if (M.view) M.view = { ...M.view, w: M.cw, h: M.ch };
    M.dirty = true;
  }
  win.addEventListener('resize', () => { if (M.open) { box.classList.toggle('full', phone()); layout(); draw(true); } });
  function fitAll(redraw = true) {
    const sq = M.squad; if (!sq) return;
    let b = M.atlas.bounds ? M.atlas.bounds.slice() : null;
    const grow = (x, z) => { b = b ? [Math.min(b[0], x), Math.min(b[1], z), Math.max(b[2], x), Math.max(b[3], z)] : [x, z, x, z]; };
    for (const v of sq.vehicles) grow(v.state.p[0], v.state.p[2]);
    const cam = o.getCam(); if (cam && cam.eye) grow(cam.eye[0], cam.eye[2]);
    M.view = fitBounds(b, M.cw || 800, M.ch || 600);
    M.track = false; syncTrack();
    if (redraw) draw(true);
  }

  // ── what is on the map now ──
  const selId = () => (H.selected ? H.selected() : 1);
  function rovList() {
    const sq = M.squad; if (!sq) return [];
    return sq.vehicles.map(v => ({ id: v.id, p: v.state.p, yaw: v.state.yaw, colour: H.colourOf ? H.colourOf(v.id) : '#fff', sel: v.id === selId() }));
  }
  function poseSig() {
    const sq = M.squad, cam = o.getCam();
    const a = sq ? sq.vehicles.map(v => `${Math.round(v.state.p[0] * 2)},${Math.round(v.state.p[2] * 2)},${Math.round(v.state.yaw * 20)}`).join(';') : '';
    return `${a}|${cam ? Math.round(cam.eye[0]) + ',' + Math.round(cam.eye[2]) + ',' + Math.round(cam.look[0]) + ',' + Math.round(cam.look[2]) : ''}|${selId()}`;
  }

  // ── the draw ──
  function draw(force) {
    if (!M.open || !M.view || !ctx) return false;
    const t = now();
    if (!force && t - M.lastDraw < 33) { M.dirty = true; return false; }
    M.lastDraw = t; M.dirty = false;
    if (M.track && M.squad) { const v = M.squad.vehicles.find(q2 => q2.id === selId()); if (v) M.view = { ...M.view, cx: v.state.p[0], cz: v.state.p[2] }; }
    const v = M.view, d = dprOf(), A = M.atlas;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.fillStyle = '#02070c'; ctx.fillRect(0, 0, v.w, v.h);
    // a faint grid in the fog
    const g = niceScale(v.k, 110).m;
    ctx.strokeStyle = 'rgba(120,210,220,0.06)'; ctx.lineWidth = 1; ctx.beginPath();
    const gx0 = Math.ceil((v.cx - v.w / 2 / v.k) / g) * g, gz0 = Math.ceil((v.cz - v.h / 2 / v.k) / g) * g;
    for (let x = gx0; x < v.cx + v.w / 2 / v.k; x += g) { const p = worldToMap(x, 0, v)[0]; ctx.moveTo(Math.round(p) + 0.5, 0); ctx.lineTo(Math.round(p) + 0.5, v.h); }
    for (let z = gz0; z < v.cz + v.h / 2 / v.k; z += g) { const p = worldToMap(0, z, v)[1]; ctx.moveTo(0, Math.round(p) + 0.5); ctx.lineTo(v.w, Math.round(p) + 0.5); }
    ctx.stroke();
    // the explored ground: the coarser level first, then the level of the view
    const lod = lodFor(v.k, d), lods = lod + 1 < LODS.length ? [lod + 1, lod] : [lod];
    ctx.imageSmoothingEnabled = false;
    for (const L of lods) {
      for (const T of A.tilesIn(v, L)) {
        A.flush(T);
        if (!T.canvas) continue;
        const s = TILE * LODS[L], [x, y] = worldToMap(T.ti * s, T.tj * s, v);
        ctx.drawImage(T.canvas, x, y, s * v.k, s * v.k);
      }
    }
    // history: hide the cells seen after the cut
    const tCut = histTime();
    if (tCut < Infinity) {
      ctx.fillStyle = '#02070c';
      const cs = MAP_CELL * v.k + 0.6;
      for (const c of A.cells.values()) {
        if (c[2] <= tCut) continue;
        const [x, y] = worldToMap(c[0] * MAP_CELL, c[1] * MAP_CELL, v);
        if (x > v.w || y > v.h || x + cs < 0 || y + cs < 0) continue;
        ctx.fillRect(x - 0.3, y - 0.3, cs, cs);
      }
    }
    // found things
    for (const m of M.marks.values()) {
      if (m.t > tCut) continue;
      const [x, y] = worldToMap(m.x, m.z, v);
      if (x < -10 || y < -10 || x > v.w + 10 || y > v.h + 10) continue;
      ctx.fillStyle = m.kind === 'colony' ? '#ffd36b' : '#c9b6ff'; ctx.strokeStyle = 'rgba(2,7,12,0.9)'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (m.kind === 'colony') ctx.arc(x, y, clamp(m.size * v.k * 0.5, 3, 9), 0, TAU);
      else { ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y); ctx.closePath(); }
      ctx.fill(); ctx.stroke();
    }
    // the camera cone
    const cam = o.getCam(), tc = o.camera ? o.camera() : null;
    if (cam && cam.eye) {
      const fovH = 2 * Math.atan(Math.tan(((tc && tc.fov) || 50) * Math.PI / 360) * ((o.canvas && o.canvas.clientWidth) || 16) / ((o.canvas && o.canvas.clientHeight) || 9));
      const cone = coneOf(cam.eye, cam.look, fovH, Math.max(12, 70 / v.k));
      if (cone) {
        const P = cone.map(p => worldToMap(p[0], p[1], v));
        ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]); ctx.lineTo(P[1][0], P[1][1]); ctx.lineTo(P[2][0], P[2][1]); ctx.closePath();
        ctx.fillStyle = 'rgba(212,236,239,0.12)'; ctx.fill(); ctx.strokeStyle = 'rgba(212,236,239,0.5)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = 'rgba(212,236,239,0.95)'; ctx.beginPath(); ctx.arc(P[0][0], P[0][1], 3.5, 0, TAU); ctx.fill();
      }
    }
    // trails, targets, arrows
    const R = rovList();
    for (const r of R) {
      const T = M.trails.get(r.id); if (!T) continue;
      ctx.strokeStyle = r.colour; ctx.globalAlpha = r.sel ? 0.8 : 0.5; ctx.lineWidth = r.sel ? 2 : 1.4; ctx.lineJoin = 'round';
      for (const seg of T) {
        const n = tCut < Infinity ? histCut(seg, tCut) : seg.length;
        if (n < 2) continue;
        ctx.beginPath();
        for (let i = 0; i < n; i++) { const m = worldToMap(seg[i][0], seg[i][1], v); if (i) ctx.lineTo(m[0], m[1]); else ctx.moveTo(m[0], m[1]); }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    for (const [id, tg] of M.targets) {
      const [x, y] = worldToMap(tg[0], tg[1], v);
      ctx.strokeStyle = H.colourOf ? H.colourOf(id) : '#fff'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(x, y, 6, 0, TAU); ctx.moveTo(x - 10, y); ctx.lineTo(x + 10, y); ctx.moveTo(x, y - 10); ctx.lineTo(x, y + 10); ctx.stroke();
    }
    if (tCut === Infinity) {
      for (const r of R.sort((a, b) => (a.sel ? 1 : 0) - (b.sel ? 1 : 0))) {
        const [x, y] = worldToMap(r.p[0], r.p[2], v), [fx, fz] = headingVec(r.yaw), ang = Math.atan2(fz, fx), L = r.sel ? 11 : 8;
        ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
        ctx.beginPath(); ctx.moveTo(L, 0); ctx.lineTo(-L * 0.7, L * 0.62); ctx.lineTo(-L * 0.35, 0); ctx.lineTo(-L * 0.7, -L * 0.62); ctx.closePath();
        ctx.fillStyle = r.colour; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(2,7,12,0.9)'; ctx.stroke();
        ctx.restore();
        ctx.font = '600 11px ui-monospace, Menlo, Consolas, monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(2,7,12,0.85)'; ctx.strokeText(String(r.id), x + 12, y - 10); ctx.fillStyle = r.colour; ctx.fillText(String(r.id), x + 12, y - 10);
        if (r.sel) { ctx.strokeStyle = r.colour; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(x, y, 16, 0, TAU); ctx.stroke(); }
      }
    }
    // the scale bar and the north arrow
    const sc = niceScale(v.k, Math.min(140, v.w * 0.25)), sx1 = v.w - 14, sx0 = sx1 - sc.px, sy = v.h - 16;
    ctx.strokeStyle = 'rgba(2,7,12,0.8)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(sx0, sy); ctx.lineTo(sx1, sy); ctx.stroke();
    ctx.strokeStyle = 'rgba(212,236,239,0.95)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(sx0, sy); ctx.lineTo(sx1, sy); ctx.moveTo(sx0, sy - 4); ctx.lineTo(sx0, sy + 4); ctx.moveTo(sx1, sy - 4); ctx.lineTo(sx1, sy + 4); ctx.stroke();
    const st = sc.m >= 1000 ? `${+(sc.m / 1000).toFixed(1)} km` : `${sc.m} m`;
    ctx.font = '600 11px ui-monospace, Menlo, Consolas, monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(2,7,12,0.85)'; ctx.strokeText(st, sx1, sy - 5); ctx.fillStyle = 'rgba(212,236,239,0.95)'; ctx.fillText(st, sx1, sy - 5);
    northArrow(ctx, v.w - 22, 24, 1.4);
    M.scale = { m: sc.m, px: sc.px, text: st };
    M.poseSig = poseSig();
    $('xmSub').textContent = `${A.cells.size.toLocaleString('en')} cells of 12 m explored · ${M.marks.size} found`;
    cv.setAttribute('aria-label', `Large map of the explored seafloor, north up, ${Math.round(v.w / v.k)} m across, ${A.cells.size} cells explored. ROV ${selId()} is selected. A click sends it there.`);
    if (A.pending) M.dirty = true;
    return true;
  }
  function northArrow(c, x, y, s) {
    c.save();
    c.fillStyle = 'rgba(212,236,239,0.95)'; c.strokeStyle = 'rgba(2,7,12,0.85)'; c.lineWidth = 2 * s;
    c.beginPath(); c.moveTo(x, y - 9 * s); c.lineTo(x + 5 * s, y + 4 * s); c.lineTo(x, y + 1 * s); c.lineTo(x - 5 * s, y + 4 * s); c.closePath(); c.stroke(); c.fill();
    c.font = `600 ${Math.round(9 * s)}px ui-monospace, Menlo, monospace`; c.textAlign = 'center'; c.textBaseline = 'top';
    c.strokeText('N', x, y + 6 * s); c.fillText('N', x, y + 6 * s);
    c.restore();
  }
  // the readout under the pointer: explored cells only (fog of war)
  function readout(x, z) {
    const W = M.W, A = M.atlas;
    const ew = `${(Math.abs(x) / 1000).toFixed(2)} km ${x >= 0 ? 'E' : 'W'}, ${(Math.abs(z) / 1000).toFixed(2)} km ${z >= 0 ? 'S' : 'N'}`;
    const c = A && A.cells.get(cellKey(Math.floor(x / MAP_CELL), Math.floor(z / MAP_CELL)));
    if (!c || !W) return `${ew} · not explored yet`;
    const rg = W.regionAt ? W.regionAt(x, z) : null;
    const t = c[2], mm = Math.floor(t / 60), ss = Math.floor(t % 60);
    return `${ew} · ${Math.round(o.surfaceY - W.ground(x, z))} m deep${rg ? ' · ' + rg.name : ''} · seen at ${mm}:${String(ss).padStart(2, '0')}`;
  }

  // ── actions ──
  function act(px, py, alt) {
    const v = M.view, w = mapToWorld(px, py, v);
    const hit = nearestRov(rovList(), px, py, v);
    if (hit) { H.select(hit.id, { source: 'map', follow: false }); M.actions.push({ kind: 'select', id: hit.id }); buildRovs(); syncAct(); draw(true); return { kind: 'select', id: hit.id }; }
    const mode = alt ? (M.act === 'send' ? 'camera' : 'send') : M.act;
    if (mode === 'send') {
      const id = selId(), okk = H.sendTo(w);
      if (okk) M.targets.set(id, w.slice());
      M.actions.push({ kind: 'send', id, xz: w, ok: !!okk });
      draw(true);
      return { kind: 'send', id, xz: w, ok: !!okk };
    }
    if (o.moveCam) o.moveCam(w[0], w[1]);
    M.actions.push({ kind: 'camera', xz: w });
    close();
    return { kind: 'camera', xz: w };
  }

  // ── pointer ──
  const pts = new Map();
  let drag = null, pinch = null;
  const local = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('pointerdown', e => {
    if (!M.view) return;
    const p = local(e); pts.set(e.pointerId, p);
    try { cv.setPointerCapture(e.pointerId); } catch { /* jsdom */ }
    if (pts.size === 2) { drag = null; const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }; return; }
    drag = { x: p[0], y: p[1], lx: p[0], ly: p[1], moved: false, shift: !!e.shiftKey };
    e.preventDefault();
  });
  cv.addEventListener('pointermove', e => {
    if (!M.view) return;
    const p = local(e);
    if (pts.has(e.pointerId)) pts.set(e.pointerId, p);
    if (pinch && pts.size >= 2) {
      const [a, b] = [...pts.values()], dd = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      M.view = zoomAbout(panBy(M.view, m[0] - pinch.m[0], m[1] - pinch.m[1]), m[0], m[1], dd / pinch.d);
      pinch = { d: dd, m }; M.track = false; syncTrack(); draw(); return;
    }
    if (drag) {
      if (!drag.moved && Math.hypot(p[0] - drag.x, p[1] - drag.y) > 6) { drag.moved = true; M.track = false; syncTrack(); }
      if (drag.moved) { M.view = panBy(M.view, p[0] - drag.lx, p[1] - drag.ly); draw(); }
      drag.lx = p[0]; drag.ly = p[1];
    }
    const w = mapToWorld(p[0], p[1], M.view);
    M.read = readout(w[0], w[1]); $('xmRead').textContent = M.read;
  });
  const up = e => {
    pts.delete(e.pointerId);
    if (pinch) { if (pts.size < 2) pinch = null; drag = null; return; }
    const d = drag; drag = null;
    if (!d || d.moved || e.type === 'pointercancel') return;
    const p = local(e);
    act(p[0], p[1], d.shift || !!e.shiftKey);
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', e => {
    if (!M.view) return;
    e.preventDefault();
    const p = local(e), dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    M.view = zoomAbout(M.view, p[0], p[1], Math.exp(-clamp(dy, -400, 400) * 0.0018));
    draw();
  }, { passive: false });
  cv.addEventListener('contextmenu', e => e.preventDefault());

  // ── buttons ──
  const zoomBtn = f => { if (!M.view) return; M.view = zoomAbout(M.view, M.view.w / 2, M.view.h / 2, f); draw(true); };
  q('.xm-back').addEventListener('click', () => close());
  $('xmClose').addEventListener('click', () => close());
  $('xmFit').addEventListener('click', () => fitAll());
  $('xmIn').addEventListener('click', () => zoomBtn(1.6));
  $('xmOut').addEventListener('click', () => zoomBtn(1 / 1.6));
  $('xmTrack').addEventListener('click', () => { M.track = !M.track; syncTrack(); draw(true); });
  $('xmSide').addEventListener('click', () => { const h = box.classList.toggle('noside'); $('xmSide').setAttribute('aria-expanded', String(!h)); setTimeout(() => { layout(); draw(true); }, 0); });
  for (const b of box.querySelectorAll('[data-act]')) b.addEventListener('click', () => { M.act = b.dataset.act; syncAct(); });
  $('xmFollow').addEventListener('click', () => { const id = selId(); H.select(id, { source: 'map', follow: true }); M.actions.push({ kind: 'follow', id }); close(); });
  function syncTrack() { const b = $('xmTrack'); b.classList.toggle('on', M.track); b.setAttribute('aria-pressed', String(M.track)); }
  function syncAct() {
    for (const b of box.querySelectorAll('[data-act]')) { const on = b.dataset.act === M.act; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    $('xmSend').textContent = `Send ROV ${selId()}`;
    $('xmFollow').textContent = `Follow ROV ${selId()} with the camera`;
  }
  function buildRovs() {
    const el = $('xmRovs'); el.innerHTML = '';
    for (const r of rovList()) {
      const b = mk('button', 'xm-rov' + (r.sel ? ' on' : ''), null, { type: 'button', 'data-rov': String(r.id), 'aria-pressed': String(r.sel) });
      b.style.setProperty('--c', r.colour);
      b.appendChild(mk('i', 'xm-dot', null, { 'aria-hidden': 'true' })); b.appendChild(mk('span', '', `ROV ${r.id}`));
      b.addEventListener('click', () => { H.select(r.id, { source: 'map', follow: false }); buildRovs(); syncAct(); draw(true); });
      el.appendChild(b);
    }
  }
  function buildFound() {
    const ul = $('xmFound'); ul.innerHTML = '';
    const list = [...M.marks.values()].sort((a, b) => b.t - a.t).slice(0, 12);
    if (!list.length) { ul.appendChild(mk('li', 'xm-note', 'Big colonies and rock features show here when the squad passes them.')); return; }
    for (const m of list) {
      const li = mk('li');
      const b = mk('button', 'xm-go', null, { type: 'button', title: 'Show it on the map' });
      b.appendChild(mk('b', '', m.label)); b.appendChild(mk('i', '', m.kind === 'colony' ? `${m.size.toFixed(1)} m colony` : `${(m.size || 0).toFixed(0)} m`));
      b.addEventListener('click', () => { M.view = { ...M.view, cx: m.x, cz: m.z, k: Math.max(M.view.k, Math.min(M.cw, M.ch) / 240) }; M.track = false; syncTrack(); draw(true); });
      li.appendChild(b); ul.appendChild(li);
    }
  }
  // history: the slider 0..1000 of the session time; 1000 is now
  const hist = $('xmHist');
  const histTime = () => (M.hist >= 1 ? Infinity : simT() * M.hist);
  function syncHist() {
    hist.value = String(Math.round(M.hist * 1000));
    const t = histTime();
    $('xmHistT').textContent = t === Infinity ? 'now' : `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')} of ${Math.floor(simT() / 60)}:${String(Math.floor(simT() % 60)).padStart(2, '0')}`;
  }
  hist.addEventListener('input', () => { M.hist = clamp(+hist.value / 1000, 0, 1); syncHist(); draw(true); });
  let playT = 0;
  function stopPlay() { clearInterval(playT); playT = 0; const b = $('xmPlay'); if (b) b.textContent = 'Play'; }
  $('xmPlay').addEventListener('click', () => {
    if (playT) { stopPlay(); return; }
    if (M.hist >= 1) M.hist = 0;
    $('xmPlay').textContent = 'Pause';
    playT = setInterval(() => { M.hist = Math.min(1, M.hist + 0.01); syncHist(); draw(true); if (M.hist >= 1) stopPlay(); }, 80);
  });

  // ── keys (capture on the document: before input.js and the HUD keys) ──
  const typing = e => { const t = e.target; return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '')); };
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!M.open) {
      if (e.code === 'KeyM' && !e.repeat && !typing(e) && !o.isSaver()) { if (open()) { e.preventDefault(); e.stopPropagation(); } }
      return;
    }
    if (e.key === 'Tab') { trap(e); return; }
    if (typing(e) && e.key !== 'Escape') { e.stopPropagation(); return; }
    const st = 0.12 * Math.min(M.view ? M.view.w : 600, M.view ? M.view.h : 400);
    let used = true;
    if (e.key === 'Escape' || e.code === 'KeyM') close();
    else if (!M.view) used = false;
    else if (e.key === 'ArrowLeft') { M.view = panBy(M.view, st, 0); M.track = false; draw(true); }
    else if (e.key === 'ArrowRight') { M.view = panBy(M.view, -st, 0); M.track = false; draw(true); }
    else if (e.key === 'ArrowUp') { M.view = panBy(M.view, 0, st); M.track = false; draw(true); }
    else if (e.key === 'ArrowDown') { M.view = panBy(M.view, 0, -st); M.track = false; draw(true); }
    else if (e.key === '+' || e.key === '=') zoomBtn(1.4);
    else if (e.key === '-' || e.key === '_') zoomBtn(1 / 1.4);
    else if (e.key === '0') fitAll();
    else if (/^[1-4]$/.test(e.key)) { H.select(+e.key, { source: 'key', follow: false }); buildRovs(); syncAct(); draw(true); }
    else if (e.key === 'Enter' && e.target === cv) act(M.view.w / 2, M.view.h / 2, e.shiftKey);
    else used = false;
    syncTrack();
    if (used) e.preventDefault();
    e.stopPropagation();
  }
  function trap(e) {
    const f = [...box.querySelectorAll('button, input, canvas[tabindex]')].filter(x => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const i = f.indexOf(doc.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
    e.stopPropagation();
  }
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('keyup', e => { if (M.open && !e.ctrlKey && !e.metaKey) e.stopPropagation(); }, true);

  // each frame (squad-hud.js tick)
  function tick(dt) {
    record(dt);
    if (!M.open) return;
    if (o.isSaver()) { close(); return; }
    if (M.atlas.pending) { M.atlas.work(phone() ? 2 : 4); M.dirty = true; }
    const s = poseSig();
    if (M.dirty || s !== M.poseSig || M.track) draw();
  }
  // squad-hud.js sendTo (the minimap or here): a target mark
  function noteTarget(id, xz) { M.targets.set(id, xz.slice()); M.dirty = true; }

  return {
    open, close, toggle: () => (M.open ? close() : open()), tick, act, fitAll, noteTarget,
    get isOpen() { return M.open; }, covers: () => M.open,
    get view() { return M.view; }, set view(v) { M.view = v; M.dirty = true; },
    set mode(m) { M.act = m; syncAct(); },
    debug: () => ({ open: M.open, full: box.classList.contains('full'), view: M.view && { ...M.view }, act: M.act, track: M.track, cells: M.atlas ? M.atlas.cells.size : 0, tiles: M.atlas ? M.atlas.tiles.size : 0, pending: M.atlas ? M.atlas.pending : 0, marks: [...M.marks.values()].map(m => m.kind), trails: [...M.trails.entries()].map(([id, T]) => [id, T.reduce((a, s) => a + s.length, 0)]), actions: M.actions.slice(), read: M.read, hist: M.hist, scale: M.scale || null }),
  };
}
