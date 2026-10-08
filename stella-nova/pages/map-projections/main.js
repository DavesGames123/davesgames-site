// ============================================================================
//  MAP PROJECTIONS  ·  main.js — state, panel, pointer input, linking
// ----------------------------------------------------------------------------
//  One state object S holds the view: projection, centre, aspect, conic
//  parallels, tools. Every change goes through set() or setProjection(),
//  which redraw the map (fast now, full 160 ms later), the tools layer, the
//  globe, the card, the hash (#p=..&c=..) and the gallery.
//
//  MORPH. setProjection() with morph on runs 900 ms of eased frames. Both
//  maps clip the geometry (geo.js), and the lat edges and azimuthal edges
//  of both maps open or close smoothly (morphRects), so nothing pops in at
//  either end.
//  FRAMING. frameBox() is the part of the stage the map should fill: below
//  the hud, and above the bottom sheet on a phone. The map re-fits when the
//  sheet opens, so a control change is always in view.
//
//  GREP MAP
//    grep -n 'function setProjection'  pick a projection (morph)
//    grep -n 'function set('           any other change
//    grep -n 'function frameBox'       the clear part of the stage
//    grep -n 'function drawOverlay'    tools over the map
//    grep -n 'function onPointer'      drag, hover, the tools
//    grep -n 'function runGo'          story buttons
//    grep -n 'function openSheet'      phone dock and sheet
//    grep -n 'installSaver'            the screensaver hook (saver.js)
// ============================================================================
import { PROJ, BY_KEY, HOME, D, PI, HALF, distortion, utm, makeMap } from './proj.js';
import { pointAt } from './geo.js';
import { MapView, loadData, THEME } from './render.js';
import * as T from './tools.js';
import { buildGallery } from './gallery.js';
import { CARDS, FAMILY, PROPS, LEFT_OUT } from './cards.js';
import { typeset, typesetAll } from '../../lib/sci-math.js';
import { installSaver } from './saver.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const CITIES = {
  'New York': [-74.006, 40.7128], London: [-0.1276, 51.5072], Tokyo: [139.6917, 35.6895], Sydney: [151.2093, -33.8688],
  'Los Angeles': [-118.2437, 34.0522], Singapore: [103.8198, 1.3521], Dubai: [55.2708, 25.2048], 'São Paulo': [-46.6333, -23.5505],
  Johannesburg: [28.0473, -26.2041], Moscow: [37.6173, 55.7558], Beijing: [116.4074, 39.9042], Mumbai: [72.8777, 19.076],
  Cairo: [31.2357, 30.0444], Anchorage: [-149.9003, 61.2181], Reykjavík: [-21.9426, 64.1466], 'Buenos Aires': [-58.3816, -34.6037],
  Honolulu: [-157.8583, 21.3069], Perth: [115.8605, -31.9505], 'Cape Town': [18.4241, -33.9249], Santiago: [-70.6693, -33.4489],
};

// ── state ──────────────────────────────────────────────────────────────────
const S = {
  key: 'winkel-tripel', lon: 0, lat: 0, roll: 0, aspect: 'normal', lat0: 0, lat1: 30, lat2: 60, clip: null,
  tissot: 'off', heat: 'off', tool: 'pan', morph: true,
  ts: { country: 'Greenland', target: null },
  rt: { a: 'New York', b: 'Tokyo', A: CITIES['New York'], B: CITIES.Tokyo },
  ms: [], hover: null, zoom: 1, globe: true,
};
let cardOpen = false;
let data = null, view = null, globe = null, gallery = null, anim = null, heatJob = null, fullTimer = 0, frameQueued = false, saverOn = false;
const mapC = $('map'), overC = $('over'), og = overC.getContext('2d');

const stOf = (s = S) => ({ key: s.key, lon: s.lon, lat: s.lat, roll: s.roll, aspect: s.aspect, lat0: s.lat0, lat1: s.lat1, lat2: s.lat2, clip: s.clip ?? undefined });
const stateKey = () => JSON.stringify([stOf(), S.zoom, view && view.box]);

// ── framing ────────────────────────────────────────────────────────────────
function frameBox() {
  const r = $('stage').getBoundingClientRect(), hud = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hud-h')) || 56;
  let bottom = r.height;
  if (PHONE_Q.matches && document.body.classList.contains('sheet-open') && !matchMedia('(orientation:landscape)').matches) {
    const p = $('panel').getBoundingClientRect(); bottom = Math.min(bottom, p.top - r.top);
  }
  let right = r.width;
  if (PHONE_Q.matches && document.body.classList.contains('sheet-open') && matchMedia('(orientation:landscape)').matches) {
    const p = $('panel').getBoundingClientRect(); right = Math.min(right, p.left - r.left);
  }
  const top = saverOn ? 0 : hud;
  return { x: 6, y: top, w: Math.max(40, right - 12), h: Math.max(40, bottom - top - 6), align: saverOn || PHONE_Q.matches ? 'centre' : 'top' };
}
function resize() {
  const r = $('stage').getBoundingClientRect();
  view.resize(r.width, r.height);
  overC.width = Math.round(r.width * view.dpr); overC.height = Math.round(r.height * view.dpr);
  view.setBox(frameBox());
  if (globe) { const g = $('globeBox').getBoundingClientRect(); if (g.width) globe.resize(g.width, g.height); }
  refresh();
}

// ── drawing ────────────────────────────────────────────────────────────────
function refresh(lod = 'fast') {
  if (!view) return;
  if (!anim) view.setState(stOf());
  queueDraw(lod);
  if (lod !== 'full') { clearTimeout(fullTimer); fullTimer = setTimeout(() => queueDraw('full'), 160); }
}
let pendingLod = 'fast';
function queueDraw(lod) {
  if (lod === 'full') pendingLod = 'full';
  if (frameQueued) return; frameQueued = true;
  requestAnimationFrame(() => { frameQueued = false; const l = pendingLod; pendingLod = 'fast'; draw(l); });
}
function draw(lod) {
  const heatOK = view.heat && view.heat.key === stateKey() && S.heat !== 'off' && !anim;
  view.draw(lod, { heat: heatOK });
  drawOverlay();
  if (!anim && S.heat !== 'off' && !heatOK && lod === 'full') startHeat();
}
function drawOverlay() {
  const g = og, s = view.dpr, F = view.frames; if (!F) return;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, overC.width, overC.height); g.setTransform(s, 0, 0, s, 0, 0);
  const clip = view.edgePath;
  if (view.heat && view.heat.key === stateKey() && S.heat !== 'off' && !anim) T.drawIso(g, view.heat, clip);
  if (S.tissot !== 'off') T.drawTissot(g, F, { step: +S.tissot, radius: +S.tissot === 15 ? 3 : 5, clip, axes: +S.tissot === 30, latMax: S.key.includes('mercator') && S.aspect === 'normal' ? 75 : 75 });
  if (S.tool === 'truesize') drawTrueSize(g);
  if (S.tool === 'routes') T.drawRoutes(g, F, S.rt.A, S.rt.B, { labels: [S.rt.a, S.rt.b] });
  if (S.tool === 'measure') drawMeasure(g);
  if (S.hover) {
    const p = pointAt(F, S.hover[0], S.hover[1]);
    if (p) { g.beginPath(); g.arc(p[0], p[1], 5, 0, 2 * PI); g.lineWidth = 2; g.strokeStyle = '#fff'; g.stroke(); g.beginPath(); g.arc(p[0], p[1], 1.6, 0, 2 * PI); g.fillStyle = '#fff'; g.fill(); }
  }
}
function country(name = S.ts.country) { return data.countries.find(c => c.name === name) || data.countries[0]; }
function drawTrueSize(g) {
  const c = country(), tgt = S.ts.target || [c.lx, c.ly];
  T.drawCountry(g, view.frames, { rings: c.rings, lines: c.lines }, { fill: 'rgba(255,255,255,0.08)', stroke: 'rgba(255,255,255,0.55)', lineWidth: 1 });
  T.drawCountry(g, view.frames, T.moveRings(c, tgt));
  const p = pointAt(view.frames, tgt[0] * D, tgt[1] * D);
  if (p) T.label(g, c.name, p[0] + 8, p[1]);
  const ref = mapCentre();
  const fHere = T.areaFactor(view.frames, tgt[0], tgt[1], ref), fHome = T.areaFactor(view.frames, c.lx, c.ly, ref);
  const area = T.countryArea(c);
  $('tsRead').innerHTML = `<b>${c.name}</b>: <span class="num">${fmtArea(area)}</span> km² on the ground.<br>` +
    (fHere != null ? `Here it is drawn <b class="num">${fHere.toFixed(2)}×</b> the area it would have at the map centre` : 'Here it is off the map') +
    (fHome != null ? `; at home, <b class="num">${fHome.toFixed(2)}×</b>.` : '.');
}
function mapCentre() {
  // The world point at the centre of the map (raw origin), degrees.
  const m = view.map; if (!m) return [0, 0];
  const ll = m.inv(0, 0); return ll ? [ll[0] / D, ll[1] / D] : [S.lon, 0];
}
function drawMeasure(g) {
  const F = view.frames, pts = S.ms.map(p => pointAt(F, p[0] * D, p[1] * D));
  if (S.ms.length === 2) {
    T.drawRoutes(g, F, S.ms[0], S.ms[1], { rhumb: false, gcColor: '#7fe0c0' });
    if (pts[0] && pts[1]) { g.save(); g.setLineDash([3, 4]); g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); g.lineTo(pts[1][0], pts[1][1]); g.stroke(); g.restore(); }
    const r = T.measure(S.ms[0], S.ms[1], pts[0], pts[1], view.screen.k / S.zoom);
    $('msRead').innerHTML = `True distance (WGS84): <b class="num">${fmtKm(r.trueKm)}</b><br>On a sphere: <span class="num">${fmtKm(r.sphereKm)}</span><br>` +
      (r.mapKm != null ? `Straight line on this map at its nominal scale: <b class="num">${fmtKm(r.mapKm)}</b> (<span class="num">${(r.ratio * 100).toFixed(1)}%</span> of true)<br><span class="hint">The dashed line is the map's straight line; the green curve is the true shortest path.</span>` : '');
  } else {
    for (const p of pts) if (p) { g.beginPath(); g.arc(p[0], p[1], 6, 0, 2 * PI); g.fillStyle = '#0b0f16'; g.fill(); g.lineWidth = 2.4; g.strokeStyle = '#7fe0c0'; g.stroke(); }
    $('msRead').textContent = S.ms.length ? 'Now tap the second point.' : 'No points yet.';
  }
}
const fmtKm = v => v == null ? '–' : `${Math.round(v).toLocaleString('en-US')} km`;
const fmtArea = v => Math.round(v).toLocaleString('en-US');

// ── heatmap ────────────────────────────────────────────────────────────────
function startHeat() {
  if (heatJob) heatJob.stop = true;
  const token = heatJob = { stop: false }, key = stateKey();
  const r = $('stage').getBoundingClientRect();
  const slow = !view.map.rawInv;
  T.buildHeat(view.map, view.screen, r.width, r.height, S.heat, token, slow ? 4 : 3).then(h => {
    if (!h || token.stop || key !== stateKey()) return;
    h.key = key; view.heat = h; queueDraw('full');
  });
  showLegend();
}
function showLegend() {
  const el = $('legend');
  if (S.heat === 'off' || saverOn) { el.hidden = true; return; }
  const L = T.HEAT_LEGEND[S.heat], lo = L.stops[0][0], hi = L.stops[L.stops.length - 1][0];
  const grad = L.stops.map(([v]) => `${T.legendColor(S.heat, v)} ${((v - lo) / (hi - lo) * 100).toFixed(1)}%`).join(',');
  el.innerHTML = `<div>${L.label}</div><div class="bar" style="background:linear-gradient(90deg,${grad})"></div><div class="ticks">${L.ticks.map(([v, t]) => `<span style="left:${((v - lo) / (hi - lo) * 100).toFixed(1)}%">${t}</span>`).join('')}</div>`;
  el.hidden = false;
}

// ── card, hud ──────────────────────────────────────────────────────────────
function renderCard() {
  const def = BY_KEY[S.key], c = CARDS[S.key], P = PROPS[def.prop];
  $('pname').textContent = PHONE_Q.matches ? (def.short || def.name) : def.name;
  $('pchips').innerHTML = `<span><i class="dot ${P.cls}"></i>${P.name}</span><span>${FAMILY[def.family].name}</span>`;
  const html = `<h2>${def.name}</h2><div class="who">${c.who}</div>
    <dl><dt>Keeps</dt><dd>${c.keeps}</dd><dt class="more">Distorts</dt><dd class="more">${c.bends}</dd><dt class="more">Used for</dt><dd class="more">${c.use}</dd></dl>
    <div class="sci-eq" data-tex="${c.tex.replace(/"/g, '&quot;')}"></div>
    <button type="button" class="moreBtn">${cardOpen ? 'Less' : 'Distorts, used for…'}</button>`;
  for (const id of ['cardDesk', 'cardPhone']) {
    const el = $(id); el.innerHTML = html; typesetAll(el);
    el.querySelector('.moreBtn').addEventListener('click', () => { cardOpen = !cardOpen; renderCard(); });
  }
  $('card').classList.toggle('open', cardOpen);
}
function syncControls() {
  const def = BY_KEY[S.key];
  document.querySelectorAll('#aspectSeg button').forEach(b => { b.classList.toggle('on', b.dataset.aspect === S.aspect); b.disabled = !!def.noAspect && b.dataset.aspect !== 'normal'; });
  const set = (id, v, unit = '°') => { $(id).value = v; $(id + 'V').textContent = `${Math.round(v * 10) / 10}${unit}`; };
  set('lon', S.lon); set('lat', S.lat); set('roll', S.roll);
  set('lat1', S.lat1); set('lat2', S.lat2); set('lat0', S.lat0);
  $('conicRows').hidden = !def.conic;
  $('lat2Row').hidden = def.conic === 'one' || def.conic === 'zero';
  $('lat1').closest('.row').hidden = def.conic === 'zero';
  const clipDef = def.clip; $('clipRow').hidden = !clipDef;
  if (clipDef) { const mx = def.key === 'gnomonic' ? 80 : def.key === 'orthographic' ? 90 : def.key === 'stereographic' ? 150 : 180; $('clip').max = mx; set('clip', S.clip ?? clipDef); }
  $('lat').disabled = S.aspect !== 'oblique' && !(def.family === 'azimuthal' && S.aspect === 'normal');
  $('roll').disabled = S.aspect !== 'oblique';
  $('aspectHint').textContent = def.noAspect ? 'Goode homolosine is shown in its normal aspect only: its lobes are cut along fixed meridians.'
    : S.aspect === 'normal' ? (def.family === 'azimuthal' ? 'Normal aspect of an azimuthal map is polar: the centre is a pole.' : 'Normal aspect: the axis of the projection is the axis of the Earth. Drag to change the central meridian.')
      : S.aspect === 'transverse' ? (def.family === 'azimuthal' ? 'Transverse (equatorial) aspect: the centre is on the equator.' : 'Transverse aspect: the globe is turned 90°, so the projection runs along a meridian.')
        : 'Oblique aspect: drag the map or the globe to put any point at the centre.';
  document.querySelectorAll('#tissotSeg button').forEach(b => b.classList.toggle('on', b.dataset.tissot === String(S.tissot)));
  document.querySelectorAll('#heatSeg button').forEach(b => b.classList.toggle('on', b.dataset.heat === S.heat));
  document.querySelectorAll('#toolSeg button').forEach(b => b.classList.toggle('on', b.dataset.tool === S.tool));
  document.querySelectorAll('.toolbox').forEach(b => { b.hidden = b.dataset.for !== S.tool; });
  mapC.className = 'tool-' + S.tool;
  $('country').value = S.ts.country; $('from').value = S.rt.a; $('to').value = S.rt.b;
  if (gallery) gallery.setActive(S.key);
}
let hashTimer = 0;
function writeHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const h = `#p=${S.key}&c=${Math.round(S.lon * 10) / 10},${Math.round(S.lat * 10) / 10},${Math.round(S.roll)}&a=${S.aspect}` + (BY_KEY[S.key].conic ? `&s=${S.lat0},${S.lat1},${S.lat2}` : '');
    try { history.replaceState(null, '', h); } catch (e) {}
  }, 300);
}
function readHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  const p = q.get('p'); if (!p || !BY_KEY[p]) return false;
  S.key = p;
  const c = (q.get('c') || '').split(',').map(Number);
  if (c.length >= 2 && c.every(isFinite)) { S.lon = c[0]; S.lat = c[1]; S.roll = c[2] || 0; }
  const a = q.get('a'); if (['normal', 'transverse', 'oblique'].includes(a)) S.aspect = a;
  const s = (q.get('s') || '').split(',').map(Number); if (s.length === 3 && s.every(isFinite)) [S.lat0, S.lat1, S.lat2] = s;
  return true;
}

// ── changes ────────────────────────────────────────────────────────────────
function changed(opts = {}) {
  view.heat = null; if (heatJob) heatJob.stop = true;
  refresh(opts.lod || 'fast');
  if (globe && !anim) globe.setMap(view.map);
  syncControls(); writeHash(); showLegend();
  if (gallery) gallery.setLon(S.lon);
}
function set(patch, opts) { Object.assign(S, patch); changed(opts); }
function homeOf(key, keepLon = true) {
  const h = HOME[key] || {}, def = BY_KEY[key];
  const st = { key, aspect: h.aspect || 'normal', lon: h.lon ?? (keepLon ? S.lon : 0), lat: h.lat ?? 0, roll: 0, lat0: h.lat0 ?? 0, lat1: h.lat1 ?? 30, lat2: h.lat2 ?? 60, clip: null };
  if (def.noAspect) st.aspect = 'normal';
  return st;
}
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
// The lat edges of a map's rects, opened toward the poles by w (0..1).
// The lobe edges of an interrupted map (at the equator, between rects)
// stay. A single rect always opens, even at lat 0: that is the horizon of
// the orthographic map in its clip frame. Used by the morph.
export function morphRects(m, w) {
  const lobes = m.rects.length > 1;
  return m.rects.map(r => {
    const out = r.slice();
    if (!(lobes && Math.abs(r[2]) < 1e-9) && r[2] > -HALF + 1e-9) out[2] = r[2] + (-HALF - r[2]) * w;
    if (!(lobes && Math.abs(r[3]) < 1e-9) && r[3] < HALF - 1e-9) out[3] = r[3] + (HALF - r[3]) * w;
    return out;
  });
}
function setProjection(key, opts = {}) {
  if (!BY_KEY[key]) return;
  const from = stOf(), to = Object.assign(homeOf(key, opts.keepLon !== false), opts.state || {});
  const doMorph = S.morph && opts.morph !== false && !document.hidden && from.key !== key;
  Object.assign(S, to);
  if (S.tool === 'routes' && key !== 'gnomonic' && from.key === 'gnomonic') { /* keep */ }
  renderCard();
  if (!doMorph) { changed(); return; }
  runMorph(from, stOf(), opts.dur ?? 900, () => changed({ lod: 'full' }));
  syncControls(); writeHash();
}
// Plays a morph from state a to state b; calls done at the end.
export function runMorph(a, b, dur, done, onFrame) {
  const mA = makeMap(a.key, a), mB = makeMap(b.key, b);
  view.heat = null; showLegend();
  const t0 = performance.now();
  if (anim) cancelAnimationFrame(anim.raf);
  anim = { raf: 0 };
  const step = now => {
    const u = Math.min(1, (now - t0) / dur), e = ease(u);
    view.setMorph(a, b, e, morphRects(mA, ease(Math.min(1, u * 1.15))), morphRects(mB, 1 - ease(Math.max(0, u * 1.15 - 0.15))));
    view.draw('fast');
    drawOverlay();
    if (onFrame) onFrame(e);
    if (u < 1) anim.raf = requestAnimationFrame(step);
    else { anim = null; view.setState(b); if (globe) globe.setMap(view.map); if (done) done(); }
  };
  anim.raf = requestAnimationFrame(step);
}

// ── pointer input ──────────────────────────────────────────────────────────
const ptrs = new Map();
let drag = null, pinch = null;
function evXY(e) { const r = mapC.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
function invAt(x, y) {
  const s = view.screen, m = view.map; if (!s || !m || anim) return null;
  return m.inv((x - s.x) / s.k, -(y - s.y) / s.k);
}
function onPointer(e) {
  if (e.type === 'pointerdown') {
    e.preventDefault();
    mapC.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, evXY(e));
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: S.zoom }; drag = null; return; }
    const [x, y] = evXY(e), ll = invAt(x, y);
    drag = { x, y, x0: x, y0: y, lon: S.lon, lat: S.lat, moved: false, mode: 'pan' };
    if (S.tool === 'routes') {
      for (const end of ['A', 'B']) { const p = pointAt(view.frames, S.rt[end][0] * D, S.rt[end][1] * D); if (p && Math.hypot(p[0] - x, p[1] - y) < 24) drag.mode = 'route' + end; }
    } else if (S.tool === 'truesize' && ll) {
      const c = country(), tgt = S.ts.target || [c.lx, c.ly];
      drag.mode = 'country'; drag.grab = [ll[0] / D, ll[1] / D]; drag.tgt0 = tgt.slice();
      const hit = hitCountry(ll[0] / D, ll[1] / D);
      if (hit && hit.name !== c.name && !insideMoved(ll)) { S.ts.country = hit.name; S.ts.target = [hit.lx, hit.ly]; drag.tgt0 = S.ts.target.slice(); syncControls(); }
    }
    mapC.classList.add('drag');
    return;
  }
  if (e.type === 'pointermove') {
    const [x, y] = evXY(e);
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, [x, y]);
    if (pinch && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      S.zoom = Math.max(0.6, Math.min(12, pinch.z * d / pinch.d)); view.zoom = S.zoom; refresh(); return;
    }
    if (!drag) { hoverAt(x, y); return; }
    const dx = x - drag.x0, dy = y - drag.y0;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    if (drag.mode === 'pan') {
      // Turn the globe under the map: right drag shows more of the west,
      // down drag more of the north (oblique only).
      const k = view.screen.k, def = BY_KEY[S.key], tv = view.map.rot90;
      const dl = (tv ? dy : -dx) / k / D, dp = (tv ? 0 : dy) / k / D;
      const patch = { lon: ((drag.lon + dl + 540) % 360) - 180 };
      if (S.aspect === 'oblique') patch.lat = Math.max(def.family === 'azimuthal' ? -90 : -89, Math.min(def.family === 'azimuthal' ? 90 : 89, drag.lat + dp));
      Object.assign(S, patch);
      changed();
    } else if (drag.mode === 'country') {
      const ll = invAt(x, y); if (!ll) return;
      S.ts.target = [drag.tgt0[0] + (ll[0] / D - drag.grab[0]), Math.max(-85, Math.min(85, drag.tgt0[1] + (ll[1] / D - drag.grab[1])))];
      drawOverlay();
    } else if (drag.mode.startsWith('route')) {
      const ll = invAt(x, y); if (!ll) return;
      const end = drag.mode.slice(5); S.rt[end] = [ll[0] / D, ll[1] / D]; S.rt[end === 'A' ? 'a' : 'b'] = fmtLL(S.rt[end]);
      drawOverlay(); routeRead();
    }
    return;
  }
  if (e.type === 'pointerup' || e.type === 'pointercancel') {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (drag && !drag.moved && e.type === 'pointerup' && S.tool === 'measure') {
      const ll = invAt(drag.x, drag.y);
      if (ll) { if (S.ms.length >= 2) S.ms = []; S.ms.push([ll[0] / D, ll[1] / D]); drawOverlay(); }
    }
    if (drag && !drag.moved && e.type === 'pointerup' && e.pointerType !== 'mouse') hoverAt(drag.x, drag.y);
    drag = null; mapC.classList.remove('drag');
    queueDraw('full');
  }
}
function insideMoved(ll) {
  // Is the pointer on the moved copy of the current country? (point in polygon after moving back)
  const c = country(), tgt = S.ts.target || [c.lx, c.ly];
  const back = T.rotTo([Math.cos(tgt[1] * D) * Math.cos(tgt[0] * D), Math.cos(tgt[1] * D) * Math.sin(tgt[0] * D), Math.sin(tgt[1] * D)],
    [Math.cos(c.ly * D) * Math.cos(c.lx * D), Math.cos(c.ly * D) * Math.sin(c.lx * D), Math.sin(c.ly * D)]);
  const v = back([Math.cos(ll[1]) * Math.cos(ll[0]), Math.cos(ll[1]) * Math.sin(ll[0]), Math.sin(ll[1])]);
  const lo = Math.atan2(v[1], v[0]) / D, la = Math.asin(v[2]) / D;
  return inCountry(c, lo, la);
}
function inCountry(c, lo, la) {
  let inside = false;
  for (const r of c.flat) for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
    const xi = r[2 * i] / 100, yi = r[2 * i + 1] / 100, xj = r[2 * j] / 100, yj = r[2 * j + 1] / 100;
    if ((yi > la) !== (yj > la) && lo < (xj - xi) * (la - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function hitCountry(lo, la) { return data.countries.find(c => inCountry(c, lo, la)) || null; }
const fmtLL = p => `${Math.abs(p[1]).toFixed(1)}° ${p[1] >= 0 ? 'N' : 'S'}, ${Math.abs(p[0]).toFixed(1)}° ${p[0] >= 0 ? 'E' : 'W'}`;

function hoverAt(x, y) {
  const ll = invAt(x, y);
  S.hover = ll ? [ll[0], ll[1]] : null;
  readout();
  if (globe) globe.setMarker(S.hover);
  drawOverlay();
}
function readout() {
  const el = $('readout');
  if (!S.hover || saverOn) { el.hidden = true; return; }
  const [lo, la] = S.hover, m = view.map;
  const o = m.inv(0, 0), t = distortion(m, lo, la), c0 = (o && distortion(m, o[0], Math.max(-1.5691, Math.min(1.5691, o[1])))) || t;
  const dms = v => { const a = Math.abs(v / D), d = Math.floor(a), mi = Math.round((a - d) * 60); return `${d}°${String(mi === 60 ? 59 : mi).padStart(2, '0')}′`; };
  let html = `<div><span class="v">${dms(la)} ${la >= 0 ? 'N' : 'S'}  ${dms(lo)} ${lo >= 0 ? 'E' : 'W'}</span></div>`;
  const hit = hitCountry(lo / D, la / D); if (hit) html += `<div>${hit.name}</div>`;
  if (t && c0) {
    html += `<div><span class="k">Scale</span> <span class="v">a ${(t.a / Math.sqrt(c0.s)).toFixed(3)} · b ${(t.b / Math.sqrt(c0.s)).toFixed(3)}</span></div>`;
    html += `<div><span class="k">Area</span> <span class="v">${(t.s / c0.s).toFixed(3)}×</span> <span class="k">Angle error</span> <span class="v">${(t.w / D).toFixed(1)}°</span></div>`;
  }
  if (S.key === 'transverse-mercator' || S.key === 'mercator' || S.key === 'web-mercator') {
    if (Math.abs(la / D) < 84) { const u = utm(lo, la); html += `<div><span class="k">UTM</span> <span class="v">${u.zone}${u.hemi} ${Math.round(u.e).toLocaleString('en-US')} E ${Math.round(u.n).toLocaleString('en-US')} N</span></div>`; }
  }
  el.innerHTML = html; el.hidden = false;
}
function routeRead() {
  const r = T.routeInfo(S.rt.A, S.rt.B);
  $('rtRead').innerHTML = `<b class="gcol">Great circle</b>: <span class="num">${fmtKm(r.geoKm ?? r.gcKm)}</span> (WGS84), start bearing <span class="num">${r.gcBearing.toFixed(0)}°</span><br>` +
    `<b class="rcol">Rhumb line</b>: <span class="num">${fmtKm(r.rhumbKm)}</span> (sphere), bearing <span class="num">${r.rhumbBearing.toFixed(0)}°</span> all the way<br>` +
    `The rhumb line is <span class="num">${((r.rhumbKm / r.gcKm - 1) * 100).toFixed(1)}%</span> longer.`;
}

// ── story buttons ──────────────────────────────────────────────────────────
function runGo(cfg) {
  // A story button sets the whole tool state: what it does not name is off.
  const patch = { tissot: cfg.tissot != null ? String(cfg.tissot) : 'off', heat: cfg.heat || 'off', tool: cfg.tool || 'pan' };
  if (cfg.country) { S.ts.country = cfg.country; S.ts.target = cfg.target || null; }
  if (cfg.route) { S.rt.a = cfg.route[0]; S.rt.b = cfg.route[1]; S.rt.A = CITIES[cfg.route[0]]; S.rt.B = CITIES[cfg.route[1]]; routeRead(); }
  if (cfg.tool === 'measure') S.ms = cfg.points || [CITIES['New York'], CITIES.London];
  Object.assign(S, patch);
  const state = {};
  for (const k of ['aspect', 'lon', 'lat']) if (cfg[k] != null) state[k] = cfg[k];
  if (cfg.key !== S.key) setProjection(cfg.key, { state });
  else set(state);
  if (cfg.country && cfg.target) {
    // slide it from home to the target, so the change in size is visible
    const c = country(), from = [c.lx, c.ly], to = cfg.target, t0 = performance.now();
    S.ts.target = from.slice();
    const step = now => {
      const u = Math.min(1, (now - t0 - 700) / 1600); if (u > 0) { const e = ease(u); S.ts.target = [from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e]; drawOverlay(); }
      if (u < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  syncControls();
}

// ── panel, dock and sheet ──────────────────────────────────────────────────
function showTab(tab) {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('section.tab').forEach(s => { s.hidden = s.dataset.tab !== tab; });
  document.querySelectorAll('#dock [data-open]').forEach(b => b.classList.toggle('on', document.body.classList.contains('sheet-open') && b.dataset.open === tab));
  if (tab === 'proj' && gallery) gallery.apply();
  $('panel').scrollTop = 0;
}
function openSheet(tab) {
  const open = document.body.classList.contains('sheet-open'), cur = document.querySelector('.tabs button.on')?.dataset.tab;
  if (open && cur === tab) document.body.classList.remove('sheet-open');
  else { document.body.classList.add('sheet-open'); showTab(tab); }
  document.querySelectorAll('#dock [data-open]').forEach(b => b.classList.toggle('on', document.body.classList.contains('sheet-open') && b.dataset.open === (tab)));
  setTimeout(() => { view.setBox(frameBox()); refresh(); if (globe) { const g = $('globeBox').getBoundingClientRect(); if (g.width) globe.resize(g.width, g.height); } }, 300);
}

function bindUI() {
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  document.querySelectorAll('#dock [data-open]').forEach(b => b.addEventListener('click', () => openSheet(b.dataset.open)));
  $('dockGlobe').addEventListener('click', () => { S.globe = !S.globe; $('optGlobe').checked = S.globe; $('globeBox').classList.toggle('off', !S.globe); $('dockGlobe').classList.toggle('on', S.globe); });
  // sheet grip: drag down to close
  let gy = null;
  $('sheetGrip').addEventListener('pointerdown', e => { e.preventDefault(); gy = e.clientY; $('sheetGrip').setPointerCapture(e.pointerId); });
  $('sheetGrip').addEventListener('pointerup', e => { if (gy != null && e.clientY - gy > 30) { document.body.classList.remove('sheet-open'); document.querySelectorAll('#dock button').forEach(b => b.classList.remove('on')); setTimeout(() => { view.setBox(frameBox()); refresh(); }, 300); } gy = null; });
  document.querySelectorAll('#aspectSeg button').forEach(b => b.addEventListener('click', () => {
    const a = b.dataset.aspect, def = BY_KEY[S.key];
    const patch = { aspect: a };
    if (a === 'oblique' && S.aspect !== 'oblique') { patch.lat = def.family === 'azimuthal' ? (S.aspect === 'normal' ? 60 : 30) : 30; patch.roll = 0; }
    if (a !== 'oblique') patch.roll = 0;
    if (a === 'normal' && def.family === 'azimuthal') patch.lat = S.lat < 0 ? -90 : 90;
    set(patch);
  }));
  for (const id of ['lon', 'lat', 'roll', 'lat0', 'lat1', 'lat2', 'clip']) $(id).addEventListener('input', e => set({ [id]: +e.target.value }));
  $('optMorph').addEventListener('change', e => { S.morph = e.target.checked; });
  $('optGrat').addEventListener('change', e => { view.opts.graticule = e.target.checked; view.stKey = null; refresh(); });
  $('optBorders').addEventListener('change', e => { view.opts.borders = e.target.checked; view.stKey = null; refresh(); });
  $('optGlobe').addEventListener('change', e => { S.globe = e.target.checked; $('globeBox').classList.toggle('off', !S.globe); });
  $('resetView').addEventListener('click', () => { S.zoom = 1; view.zoom = 1; set(homeOf(S.key, false)); });
  $('zoomIn').addEventListener('click', () => { S.zoom = Math.min(12, S.zoom * 1.4); view.zoom = S.zoom; refresh(); });
  $('zoomOut').addEventListener('click', () => { S.zoom = Math.max(0.6, S.zoom / 1.4); view.zoom = S.zoom; refresh(); });
  document.querySelectorAll('#tissotSeg button').forEach(b => b.addEventListener('click', () => { S.tissot = b.dataset.tissot; syncControls(); drawOverlay(); }));
  document.querySelectorAll('#heatSeg button').forEach(b => b.addEventListener('click', () => { S.heat = b.dataset.heat; syncControls(); view.heat = null; showLegend(); queueDraw('full'); }));
  document.querySelectorAll('#toolSeg button').forEach(b => b.addEventListener('click', () => {
    S.tool = b.dataset.tool; if (S.tool === 'routes') routeRead(); syncControls(); drawOverlay();
  }));
  document.querySelectorAll('.seg, .tabs, #dock, .btnrow, .gos, #hud').forEach(el => el.addEventListener('pointerdown', e => { if (e.target.closest('button')) e.preventDefault(); }));
  const opts = names => names.map(n => `<option>${n}</option>`).join('');
  $('country').innerHTML = opts(data.countries.map(c => c.name));
  $('country').addEventListener('change', e => { S.ts.country = e.target.value; S.ts.target = null; drawOverlay(); });
  $('from').innerHTML = opts(Object.keys(CITIES)); $('to').innerHTML = opts(Object.keys(CITIES));
  $('from').addEventListener('change', e => { S.rt.a = e.target.value; S.rt.A = CITIES[S.rt.a]; routeRead(); drawOverlay(); });
  $('to').addEventListener('change', e => { S.rt.b = e.target.value; S.rt.B = CITIES[S.rt.b]; routeRead(); drawOverlay(); });
  $('tsHome').addEventListener('click', () => { S.ts.target = null; drawOverlay(); });
  $('tsEquator').addEventListener('click', () => { const c = country(); runGo({ key: S.key, country: c.name, target: [c.lx, 0], tool: 'truesize' }); });
  const midRoute = () => { const a = S.rt.A, b = S.rt.B; const v = [0, 0, 0]; for (const p of [a, b]) { v[0] += Math.cos(p[1] * D) * Math.cos(p[0] * D); v[1] += Math.cos(p[1] * D) * Math.sin(p[0] * D); v[2] += Math.sin(p[1] * D); } return [Math.atan2(v[1], v[0]) / D, Math.atan2(v[2], Math.hypot(v[0], v[1])) / D]; };
  $('rtGnom').addEventListener('click', () => { const c = midRoute(); runGo({ key: 'gnomonic', aspect: 'oblique', lon: c[0], lat: c[1], tool: 'routes' }); });
  $('rtMerc').addEventListener('click', () => runGo({ key: 'mercator', tool: 'routes' }));
  $('prevP').addEventListener('click', () => step(-1));
  $('nextP').addEventListener('click', () => step(1));
  $('cardToggle').addEventListener('click', () => { const c = $('card'); c.classList.toggle('min'); $('cardToggle').textContent = c.classList.contains('min') ? '+' : '–'; });
  document.querySelectorAll('.go').forEach(b => b.addEventListener('click', () => { try { runGo(JSON.parse(b.dataset.go)); } catch (e) { console.error(e); } }));
  document.querySelectorAll('.toc a').forEach(a => a.addEventListener('click', e => { e.preventDefault(); const t = document.querySelector(a.getAttribute('href')); if (t) $('panel').scrollTo({ top: t.offsetTop - 60, behavior: 'smooth' }); }));
  $('leftOut').textContent = LEFT_OUT;
  for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) mapC.addEventListener(t, onPointer);
  mapC.addEventListener('pointerleave', () => { if (!drag) { S.hover = null; readout(); if (globe) globe.setMarker(null); drawOverlay(); } });
  mapC.addEventListener('wheel', e => { e.preventDefault(); S.zoom = Math.max(0.6, Math.min(12, S.zoom * Math.exp(-e.deltaY * 0.0015))); view.zoom = S.zoom; refresh(); }, { passive: false });
  mapC.addEventListener('dblclick', () => { S.zoom = 1; view.zoom = 1; refresh(); });
  mapC.addEventListener('contextmenu', e => e.preventDefault());
  addEventListener('keydown', e => {
    if (e.target.closest('input,select,textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowRight') step(1); else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 't') { S.tissot = S.tissot === 'off' ? '30' : 'off'; syncControls(); drawOverlay(); }
  });
  addEventListener('resize', resize);
  PHONE_Q.addEventListener('change', resize);
  // Selection only in prose; selectstart targets are often text nodes.
  document.addEventListener('selectstart', e => {
    const el = e.target && (e.target.nodeType === 1 ? e.target : e.target.parentElement);
    if (!el || !el.closest('.prose') || el.closest('button')) e.preventDefault();
  });
}
function step(d) { const i = PROJ.findIndex(p => p.key === S.key); setProjection(PROJ[(i + d + PROJ.length) % PROJ.length].key); }

// ── globe ──────────────────────────────────────────────────────────────────
async function initGlobe() {
  try {
    const { Globe } = await import('./globe.js');
    globe = new Globe($('globe'), data, { texture: new URL('../ancient-earth/data/present/color-2k.jpg', import.meta.url).href });
    const g = $('globeBox').getBoundingClientRect(); globe.resize(g.width || 240, g.height || 240);
    globe.setMap(view.map);
    const box = $('globeBox');
    let gd = null;
    box.addEventListener('pointerdown', e => { e.preventDefault(); box.setPointerCapture(e.pointerId); gd = { x: e.clientX, y: e.clientY, lon: S.lon, lat: S.lat }; });
    box.addEventListener('pointermove', e => {
      const r = box.getBoundingClientRect();
      if (gd) {
        const k = r.width / 2.4, def = BY_KEY[S.key];
        const lon = gd.lon - (e.clientX - gd.x) / k / D * 0.9;
        const patch = { lon: ((lon + 540) % 360) - 180 };
        const freeLat = S.aspect === 'oblique' || def.family === 'azimuthal';
        if (freeLat) { patch.lat = Math.max(-90, Math.min(90, gd.lat + (e.clientY - gd.y) / k / D * 0.9)); if (def.family === 'azimuthal' && S.aspect === 'normal') patch.aspect = 'oblique'; }
        set(patch);
        return;
      }
      const ll = globe.pick(e.clientX - r.left, e.clientY - r.top);
      S.hover = ll; readout(); globe.setMarker(ll); drawOverlay();
    });
    box.addEventListener('pointerup', () => { gd = null; queueDraw('full'); });
    box.addEventListener('pointercancel', () => { gd = null; });
    box.addEventListener('pointerleave', () => { if (!gd) { S.hover = null; readout(); globe.setMarker(null); drawOverlay(); } });
  } catch (e) {
    console.warn('globe unavailable', e && e.message);
    $('globeBox').classList.add('off');
  }
}

// ── boot ───────────────────────────────────────────────────────────────────
async function boot() {
  const fromHash = readHash();
  if (!fromHash) Object.assign(S, homeOf(S.key, false));
  data = await loadData(new URL('./', import.meta.url));
  view = new MapView(mapC, data);
  gallery = buildGallery($('gallery'), data, key => setProjection(key));
  bindUI();
  if (PHONE_Q.matches) document.body.classList.remove('sheet-open');
  resize();
  renderCard(); changed({ lod: 'full' });
  showTab('proj');
  routeRead();
  $('loading').classList.add('gone');
  setTimeout(() => $('hint').classList.add('gone'), 6000);
  $('hint').textContent = 'Drag to turn the globe under the map · scroll to zoom · arrow keys change projection';
  typesetAll(document.querySelector('section[data-tab="guide"]'));
  typesetAll($('conicRows'));
  initGlobe();
  installSaver(api);
  window.__mp = api;
}
const api = {
  S, get view() { return view; }, get data() { return data; }, get globe() { return globe; },
  setProjection, set, changed, runMorph, morphRects, drawOverlay, refresh, queueDraw, frameBox, homeOf, CITIES, country,
  setSaver(on) { saverOn = on; showLegend(); readout(); if (view) { view.setBox(frameBox()); } },
  resize, renderCard, syncControls, get anim() { return anim; },
};
boot().catch(e => { console.error(e); $('loading').textContent = 'The map data did not load.'; });
