// ============================================================================
//  STORM GLOBE  ·  main.js  ·  the GUI, the frame loop, the tour
// ----------------------------------------------------------------------------
//  boot: WebGPU device -> snapshot (data/live/, else data/sample/) ->
//  solver + renderer -> UI -> frame loop; then the live refresh (JTWC,
//  EONET, and GFS when the snapshot is older than STALE_H).
//
//  Time: ST.t is the slider time (epoch ms). The solver follows it: it
//  steps forward with the play clock (at most 2 steps a frame, dt <= 40
//  min), and a jump back or more than 6 h ahead re-starts it from the
//  target wind at the new time (then 4 spin-up steps). Paused, the field
//  holds still and the particles keep streaming through it.
//
//  The tour (tourTick) visits the stops in a nearest-neighbour order, so
//  the flights stay short. It flies on eased great circles with limited
//  angular speed and acceleration (camera.js flight, FLY), holds HOLD_S
//  on each with a slow turn, and follows a storm that moves while the
//  time plays through a critically damped spring (camera.js follow).
//  A drag, a pinch or a list tap stops it.
//
//  Framing: every automatic camera (tour, list tap, saver) frames at
//  least camera.js MIN_R_KM.auto of ground on the narrow side of the
//  clear area (frameAlt), and a pinch or the wheel stops at
//  MIN_R_KM.user. The clear area comes from occlusion(); the view offset
//  and the altitude floor follow it through springs, so a sheet or a
//  card that opens moves the globe smoothly, not in a jump.
//
//  grep -n targets
//    boot ............. "async function boot"
//    time ............. "function setTime", "function solverFollow"
//    frame loop ....... "function frame"
//    stops ............ "function buildStops"
//    card ............. "function showCard"
//    flights, tour .... "function flyTo", "function tourTick"
//    framing .......... "function occlusion", "function clearArea", "function frameAltFor"
//    particle speed ... "WIND_VIS"
//    input ............ "function bindPointer"
//    live refresh ..... "async function liveRefresh"
//    debug API ........ "window.__stormGlobe"
// ============================================================================
import { loadSnapshot, fetchLiveStorms, fetchLiveEvents, fetchLiveWinds, snapshotAgeH, STALE_H } from './data.js';
import { mergeStorms, dedupeEvents, eventScore, stormKind, category, KT, EONET_CATS } from './sources.js';
import { createSolver } from './solver.js';
import { createRenderer } from './render.js';
import * as CAM from './camera.js';
import * as TL from './timeline.js';
import { findLows, findJets, regionName } from './detect.js';
import * as COL from './colour.js';
import { installSaver } from './saver.js';

const $ = id => document.getElementById(id);
const H = 3600e3, D = Math.PI / 180;
const PHONE_Q = matchMedia('(max-width:760px), (max-height:520px) and (pointer:coarse)');
const LITE = PHONE_Q.matches || (navigator.hardwareConcurrency || 8) <= 4;
const SPEEDS = [1, 3, 6, 12];          // model hours per second
const HOLD_S = 10;                     // tour: seconds on each stop
// WIND_VIS: the particle streak speed on screen, as a share of the old
// look (2600 model s per frame at 60 fps); 2/3 keeps the flow calm. The
// solver and the data are not scaled. P_H (render.js) grew from 8 to 11
// positions, so the streaks keep their old length at the lower speed.
const WIND_VIS = 2 / 3;

const ST = {
  t: 0, t0: 0, t1: 0, dataTime: 0, playing: false, speed: 3,
  storms: [], events: [], lows: [], jets: [], stops: [], sel: null,
  cam: { lat: 18, lon: -60, alt: 2.4, tilt: 0, heading: 0 }, fly: null,
  tour: { on: false, i: -1, phase: 'idle', t0: 0, order: [] },
  layers: { particles: true, dye: false, tracks: true, cones: true, events: true, labels: true, magmaParticles: false, coast: true },
  field: 0, strength: 0.85, nudgeH: 6,
  off: { x: 0, y: 0 }, fade: 1, saver: false, viewOverride: null,
  live: { storms: 'pending', events: 'pending', winds: 'snapshot' },
};
let device, solver, renderer, snap, canvas, tSolver = null, frameKey = '', dirtyOverlays = true, lastOverlayT = -1;
const stats = { steps: 0, dt: 0, ms: 0 };

// ── boot ─────────────────────────────────────────────────────────────────
function progress(f, text) { $('lfill').style.width = Math.round(f * 100) + '%'; if (text) $('ltext').textContent = text; }
async function boot() {
  canvas = $('view');
  if (!navigator.gpu) return noGpu('navigator.gpu is missing.');
  let adapter;
  try { adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }); } catch (e) { return noGpu(e.message); }
  if (!adapter) return noGpu('No GPU adapter.');
  device = await adapter.requestDevice();
  device.lost.then(i => { if (i.reason !== 'destroyed') console.warn('storm-globe: GPU device lost: ' + i.message); });
  progress(0.08, 'Loading winds and storms…');
  snap = await loadSnapshot(['data/live/', 'data/sample/'], fetch, p => progress(0.08 + 0.6 * p));
  progress(0.72, 'Building the globe…');
  const world = await (await fetch('data/world.json')).json();
  const nx = LITE ? 256 : 512;
  const w = snap.meta.winds;
  solver = await createSolver(device, { nx, ny: nx / 2, fnx: w.grid.nx, fny: w.grid.ny });
  solver.set({ dyeRelax: 4 * 86400, tauBg: ST.nudgeH * 3600, tauStorm: 1800 });
  renderer = await createRenderer({ device, canvas, solver, lite: LITE });
  renderer.setWorld(world);
  adoptSnapshot();
  buildUI();
  resize();
  addEventListener('resize', resize);
  progress(1, '');
  $('loading').classList.add('done');
  setTimeout(() => $('hint').classList.add('gone'), 6000);
  requestAnimationFrame(frame);
  installSaver(SG);
  // start on a wide view of the strongest storm, then the tour
  const s0 = ST.stops[0];
  if (s0) { const p = stopPos(s0); ST.cam = { lat: p.lat * 0.6, lon: p.lon - 25, alt: wideAlt(), tilt: 0, heading: 0 }; }
  if (!location.hash.includes('notour')) setTimeout(() => { if (!ST.saver && !userTouched) startTour(); }, 1200);
  // #offline: no live requests (headless checks); #livegfs: force the
  // browser GFS path even with a fresh snapshot
  if (!location.hash.includes('offline')) liveRefresh();
}
function noGpu(msg) {
  $('loading').classList.add('done');
  $('nogpu').hidden = false;
  $('nogpuList').textContent = msg || '';
}

// A snapshot (or live winds) becomes the working data set.
function adoptSnapshot() {
  const m = snap.meta;
  ST.t0 = snap.times[0]; ST.t1 = snap.times[snap.times.length - 1];
  ST.dataTime = Date.parse(m.winds.cycle);
  ST.storms = m.storms.map(s => ({ ...s, _path: null }));
  ST.events = dedupeEvents(m.events || [], ST.storms);
  const now = Date.now();
  ST.t = Math.max(ST.t0, Math.min(ST.t1, now > ST.dataTime && now < ST.dataTime + 24 * H ? now : ST.dataTime));
  frameKey = ''; tSolver = null;
  detectExtremes();
  buildStops();
  if (renderer) { renderer.setCones(ST.layers.cones ? ST.storms : [], selStormId()); dirtyOverlays = true; }
}
function detectExtremes() {
  const k = Math.max(0, snap.times.findIndex(t => t >= ST.dataTime));
  const fr = snap.frames[k], g = snap.meta.winds.grid;
  const here = ST.storms.map(s => TL.stormAt(s, ST.dataTime) || { lat: s.lat, lon: s.lon }).filter(Boolean);
  ST.lows = findLows(fr, g, here, 5);
  ST.jets = findJets(fr, g, [...here, ...ST.lows], 3);
}

// ── stops (the list and the tour) ────────────────────────────────────────
function buildStops() {
  const out = [];
  for (const s of ST.storms) out.push({ id: 's:' + s.id, kind: 'storm', s, score: 200 + (s.vmax || 0) });
  for (const l of ST.lows) out.push({ id: `l:${l.lat.toFixed(1)},${l.lon.toFixed(1)}`, kind: 'low', l, score: 120 + (1000 - l.hpa) });
  for (const j of ST.jets) out.push({ id: `j:${j.lat.toFixed(1)},${j.lon.toFixed(1)}`, kind: 'jet', l: j, score: 90 + j.wind });
  // events: volcanoes, fires and floods of the last 14 days; EONET storms
  // only while active (last report within 3 days)
  const recent = ST.events.filter(e => e.cat === 'volcanoes' || e.t > ST.dataTime - (e.cat === 'severeStorms' ? 3 : 14) * 24 * H);
  recent.sort((a, b) => eventScore(b) - eventScore(a));
  for (const e of recent.slice(0, 10)) out.push({ id: 'e:' + e.id, kind: 'event', e, score: eventScore(e) });
  out.sort((a, b) => b.score - a.score);
  ST.stops = out;
  if (ST.sel && !out.find(o => o.id === ST.sel)) ST.sel = null;
  if ($('stops')) buildList();
}
function stopPos(o, t = ST.t) {
  if (o.kind === 'storm') {
    const st = TL.stormAt(o.s, t);
    if (st) return { lat: st.lat, lon: st.lon, st };
    const p = o.s._path || TL.stormPath(o.s), q = t < p[0].t ? p[0] : p[p.length - 1];
    return { lat: q.lat, lon: q.lon, st: null };
  }
  if (o.kind === 'event') return { lat: o.e.lat, lon: o.e.lon };
  return { lat: o.l.lat, lon: o.l.lon };
}
function stopTitle(o) {
  if (o.kind === 'storm') return stormKind(o.s.basin, o.s.vmax, o.s.cls, o.s.lat, o.s.lon) + ' ' + o.s.name;
  if (o.kind === 'low') return 'Deep low · ' + regionName(o.l.lat, o.l.lon);
  if (o.kind === 'jet') return 'Wind maximum · ' + regionName(o.l.lat, o.l.lon);
  return o.e.title;
}
function stopColour(o) {
  if (o.kind === 'storm') return COL.catColour(category(o.s.vmax));
  if (o.kind === 'low') return '#c9b8ff';
  if (o.kind === 'jet') return '#8cc4ff';
  return (EONET_CATS[o.e.cat] || EONET_CATS.manmade).color;
}
const fmtKt = kt => `${Math.round(kt)} kt`;
const fmtWind = kt => `${Math.round(kt)} kt · ${Math.round(kt * KT)} m/s · ${Math.round(kt * KT * 3.6)} km/h`;
function catLabel(kt) { const c = category(kt); return c < 0 ? 'TD' : c === 0 ? 'TS' : 'Cat ' + c; }

function buildList() {
  const ul = $('stops'); ul.innerHTML = '';
  const groups = [['storm', 'Tropical cyclones'], ['low', 'Deep lows (GFS)'], ['jet', 'Strongest winds (GFS)'], ['event', 'NASA EONET events']];
  for (const [k, name] of groups) {
    const list = ST.stops.filter(o => o.kind === k);
    if (!list.length) continue;
    const h = document.createElement('li'); h.className = 'head'; h.textContent = name; ul.appendChild(h);
    for (const o of list) {
      const li = document.createElement('li'); li.dataset.id = o.id; li.setAttribute('role', 'option');
      let v = '', sub = '';
      if (o.kind === 'storm') { v = fmtKt(o.s.vmax) + `<small>${catLabel(o.s.vmax)}${o.s.pmin ? ' · ' + o.s.pmin + ' hPa' : ''}</small>`; sub = `${o.s.basin} · ${o.s.source}`; }
      else if (o.kind === 'low') { v = Math.round(o.l.hpa) + ' hPa' + `<small>${Math.round(o.l.wind)} m/s</small>`; sub = `${fmtLL(o.l.lat, o.l.lon)}`; }
      else if (o.kind === 'jet') { v = Math.round(o.l.wind) + ' m/s' + `<small>${Math.round(o.l.wind * 3.6)} km/h</small>`; sub = `${fmtLL(o.l.lat, o.l.lon)}`; }
      else { v = o.e.mag ? `${Math.round(o.e.mag).toLocaleString('en')}<small>${o.e.unit || ''}</small>` : ''; sub = `${o.e.catTitle} · ${new Date(o.e.t).toISOString().slice(0, 10)}`; }
      li.innerHTML = `<i class="sw" style="background:${stopColour(o)}"></i><b></b><span class="v">${v}</span><span class="k"></span>`;
      li.querySelector('b').textContent = stopTitle(o); li.querySelector('.k').textContent = sub;
      li.onclick = () => { stopTour(); select(o.id, true); if (PHONE_Q.matches) setOpen(null); };
      if (o.id === ST.sel) li.classList.add('on');
      ul.appendChild(li);
    }
  }
  if (!ST.stops.length) ul.innerHTML = '<li class="head">No storms or events in this data set.</li>';
}
function fmtLL(lat, lon) { return `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`; }
function selStormId() { const o = ST.stops.find(q => q.id === ST.sel); return o && o.kind === 'storm' ? o.s.id : null; }

function select(id, fly = false, opt = {}) {
  ST.sel = id;
  for (const li of document.querySelectorAll('#stops li[data-id]')) li.classList.toggle('on', li.dataset.id === id);
  const o = ST.stops.find(q => q.id === id);
  showCard(o);
  renderer.setCones(ST.layers.cones ? ST.storms : [], selStormId());
  dirtyOverlays = true;
  if (o && fly) flyTo(stopCam(o), opt.dur);
}
// STOP_KM: the ground radius each kind of stop frames on the narrow side
// of the clear area (a storm and its surroundings, a low and its fronts)
const STOP_KM = { storm: 1200, event: 1100, low: 1700, jet: 1900 };
function stopCam(o, k = 0) {
  const p = stopPos(o);
  return { lat: p.lat, lon: p.lon, alt: frameAltFor(STOP_KM[o.kind] || 800), tilt: o.kind === 'storm' ? 34 : 24, heading: (k * 37) % 40 - 20 };
}

// ── the card ─────────────────────────────────────────────────────────────
function showCard(o) {
  const c = $('card'), b = $('cardBody');
  if (!o) { c.hidden = true; return; }
  c.hidden = false;
  const p = stopPos(o), esc = s => String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  let h = '';
  if (o.kind === 'storm') {
    const s = o.s, st = p.st, kt = st ? st.vmax : s.vmax, cat = category(kt);
    const kind = stormKind(s.basin, kt, s.cls, p.lat, p.lon);
    h += `<div class="c-kind"><span class="badge" style="background:${COL.catColour(cat)}">${catLabel(kt)}</span>${esc(kind)} · ${esc(s.basin)}</div>`;
    h += `<div class="c-title">${esc(s.name)}</div>`;
    h += `<div class="c-sub">${st ? (st.fc ? 'Forecast position at the slider time' : 'Observed track at the slider time') : 'Not active at the slider time'}</div>`;
    h += '<dl class="c-grid">';
    h += `<dt>Max wind</dt><dd>${fmtWind(kt)}</dd>`;
    const pm = st && st.pmin != null ? st.pmin : s.pmin;
    h += `<dt>Pressure</dt><dd>${pm ? Math.round(pm) + ' hPa' : '—'}</dd>`;
    h += `<dt>Position</dt><dd>${fmtLL(p.lat, p.lon)}</dd>`;
    const dir = st && st.dir != null ? st.dir : s.dir, spd = st && st.spdKt ? st.spdKt : s.spd;
    h += `<dt>Moving</dt><dd>${dir != null ? compass(dir) + ` (${Math.round(dir)}°)` : '—'}${spd ? ` at ${Math.round(spd)} kt` : ''}</dd>`;
    if (s.r34) h += `<dt>34 kt radii</dt><dd>${s.r34.join(' / ')} nm (NE SE SW NW)</dd>`;
    h += `<dt>Advisory</dt><dd>${new Date(s.time).toISOString().slice(0, 16).replace('T', ' ')} UTC</dd>`;
    h += '</dl>';
    if (s.forecast.length > 1) {
      h += '<table class="c-fc"><tr><th>Forecast</th><th>Position</th><th>Wind</th></tr>';
      for (const f of s.forecast.filter(f => [0, 24, 48, 72, 96, 120].includes(f.tau))) h += `<tr><td>${f.tau ? '+' + f.tau + ' h' : 'now'}</td><td>${fmtLL(f.lat, f.lon)}</td><td>${fmtKt(f.vmax)} ${catLabel(f.vmax)}</td></tr>`;
      h += '</table>';
    }
    h += `<div class="c-src">Source: ${esc(s.source)}. ${s.coneKind === 'nhc' ? 'Cone: NHC official.' : s.coneKind === 'derived' ? 'Cone: derived on this page from NHC track-error radii (not an agency product).' : ''}</div>`;
  } else if (o.kind === 'event') {
    const e = o.e;
    h += `<div class="c-kind"><span class="badge" style="background:${stopColour(o)}">${esc(e.catTitle)}</span>NASA EONET</div>`;
    h += `<div class="c-title">${esc(e.title)}</div><dl class="c-grid">`;
    h += `<dt>Latest</dt><dd>${new Date(e.t).toISOString().slice(0, 16).replace('T', ' ')} UTC</dd>`;
    if (e.t0 && e.t0 < e.t) h += `<dt>Since</dt><dd>${new Date(e.t0).toISOString().slice(0, 10)}</dd>`;
    h += `<dt>Position</dt><dd>${fmtLL(e.lat, e.lon)}</dd>`;
    if (e.mag) h += `<dt>Size</dt><dd>${Math.round(e.mag).toLocaleString('en')} ${esc(e.unit || '')}</dd>`;
    h += `</dl><div class="c-src">Source: ${esc(e.source || 'EONET')}${e.link ? ` · <a href="${esc(e.link)}" target="_blank" rel="noopener">EONET record</a>` : ''}</div>`;
  } else {
    const l = o.l;
    h += `<div class="c-kind"><span class="badge" style="background:${stopColour(o)}">${o.kind === 'low' ? 'Low' : 'Wind'}</span>Found in the GFS field</div>`;
    h += `<div class="c-title">${esc(stopTitle(o))}</div><dl class="c-grid">`;
    if (o.kind === 'low') h += `<dt>Central pressure</dt><dd>${Math.round(l.hpa)} hPa</dd>`;
    h += `<dt>Strongest wind near</dt><dd>${Math.round(l.wind)} m/s · ${Math.round(l.wind * 3.6)} km/h</dd>`;
    h += `<dt>Position</dt><dd>${fmtLL(l.lat, l.lon)}</dd>`;
    h += `</dl><div class="c-src">At data time, ${TL.fmtTime(ST.dataTime)}. ${o.kind === 'low' ? 'A sea-level pressure minimum below 990 hPa' : 'A 10 m wind maximum above 20 m/s'}, 900 km or more from a named storm.</div>`;
  }
  b.innerHTML = h;
}
function compass(d) { return ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(d / 22.5) % 16]; }

// ── time ─────────────────────────────────────────────────────────────────
function setTime(t) {
  ST.t = Math.max(ST.t0, Math.min(ST.t1, t));
  updateTimebar();
}
// the solver follows ST.t (see the header)
function setFramesFor(t) {
  const br = TL.bracket(snap.times, t), key = br.a + ':' + br.b;
  if (key !== frameKey) { solver.setFrames(snap.frames[br.a], snap.frames[br.b]); frameKey = key; }
  return br.f;
}
function vortices(t) {
  const cell = 2 * Math.PI / solver.nx, out = [];
  for (const s of ST.storms) { const st = TL.stormAt(s, t); if (st) out.push(TL.vortexFor(st, s, cell)); }
  return out;
}
function solverFollow(enc) {
  const t = ST.t;
  if (tSolver == null || t < tSolver - 60e3 || t - tSolver > 6 * H) {
    const f = setFramesFor(t);
    solver.setStorms(vortices(t));
    solver.set({ fmix: f, dt: 900, tauBg: ST.nudgeH * 3600 });
    solver.init();
    solver.step(4);
    tSolver = t; stats.steps = 4; stats.dt = 900;
    return;
  }
  const rem = t - tSolver;
  if (rem < 20e3) { stats.steps = 0; return; }
  // up to 2 steps of up to 40 min: the solver keeps up with 12 h/s at
  // 30 fps (semi-Lagrangian steps are stable at any Courant number)
  const n = Math.min(2, Math.ceil(rem / (1200e3)));
  const dt = Math.min(2400e3, rem / n);
  const mid = tSolver + dt * n / 2;
  solver.setStorms(vortices(mid));
  solver.set({ fmix: setFramesFor(mid), dt: dt / 1000, tauBg: ST.nudgeH * 3600 });
  solver.step(n, enc);
  tSolver += dt * n; stats.steps = n; stats.dt = dt / 1000;
}

// ── overlays: tracks and markers ─────────────────────────────────────────
function hexRGB(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
function buildOverlays() {
  const segs = [], marks = [], t = ST.t;
  if (ST.layers.tracks) {
    for (const s of ST.storms) {
      const p = s._path || (s._path = TL.stormPath(s)), sel = selStormId() === s.id;
      for (let i = 0; i + 1 < p.length; i++) {
        const A = p[i], B = p[i + 1], fc = B.fc, n = Math.max(1, Math.ceil(CAM.arc(A, B) / D / 0.8));
        const col = fc ? [1, 0.97, 0.92] : hexRGB(COL.catColour(category(A.vmax ?? s.vmax)));
        const ahead = B.t > t;
        for (let k = 0; k < n; k++) {
          if (fc && k % 2 === 1 && n > 1) continue;
          const a = CAM.slerp(A, B, k / n), b = CAM.slerp(A, B, (k + 1) / n);
          segs.push({ a: CAM.unit(a.lat, a.lon), b: CAM.unit(b.lat, b.lon), w: sel ? 2.6 : 1.8, col: [...col, (ahead ? 0.55 : 0.95) * (sel ? 1 : 0.8)] });
        }
      }
      // fix dots along the observed track
      for (const f of p) if (!f.fc && Math.abs(f.t - t) < 5 * 24 * H) marks.push({ p: CAM.unit(f.lat, f.lon), size: 2.2, col: [...hexRGB(COL.catColour(category(f.vmax ?? s.vmax))), 1], shape: 2, alpha: 0.85 });
    }
  }
  // cone outlines: crisp lines here; the fill is a soft texture layer
  if (ST.layers.cones) {
    for (const s of ST.storms) {
      if (!s.cone || s.cone.length < 3) continue;
      const sel = selStormId() === s.id, ring = s.cone;
      for (let i = 0; i < ring.length; i++) {
        const A = { lon: ring[i][0], lat: ring[i][1] }, B = { lon: ring[(i + 1) % ring.length][0], lat: ring[(i + 1) % ring.length][1] };
        const n = Math.max(1, Math.ceil(CAM.arc(A, B) / D / 0.8));
        for (let k = 0; k < n; k++) {
          const a = CAM.slerp(A, B, k / n), b = CAM.slerp(A, B, (k + 1) / n);
          segs.push({ a: CAM.unit(a.lat, a.lon), b: CAM.unit(b.lat, b.lon), w: sel ? 1.4 : 1.0, col: [1, 0.95, 0.88, sel ? 0.8 : 0.38] });
        }
      }
    }
  }
  const spin = performance.now() / 1000 * 1.6;
  for (const s of ST.storms) {
    const st = TL.stormAt(s, t); if (!st) continue;
    const c = category(st.vmax), sel = selStormId() === s.id;
    marks.push({ p: CAM.unit(st.lat, st.lon), size: 10 + Math.max(0, c) * 1.8, col: [...hexRGB(COL.catColour(c)), 1], shape: 0, spin: st.lat >= 0 ? -spin : spin, ring: sel ? 1 : 0, alpha: st.w });
  }
  if (ST.layers.events) {
    for (const e of ST.events) {
      const sel = ST.sel === 'e:' + e.id, cat = EONET_CATS[e.cat] || EONET_CATS.manmade;
      const old = e.t < t - 10 * 24 * H && e.cat !== 'volcanoes';
      marks.push({ p: CAM.unit(e.lat, e.lon), size: e.cat === 'wildfires' ? 4 + Math.min(4, Math.log10(1 + (e.mag || 0))) : 6, col: [...hexRGB(cat.color), 1], shape: cat.shape, ring: sel ? 1 : 0, alpha: old ? 0.45 : 0.95 });
    }
  }
  for (const o of ST.stops) if (o.kind === 'low' || o.kind === 'jet') marks.push({ p: CAM.unit(o.l.lat, o.l.lon), size: 9, col: [...hexRGB(stopColour(o)), 1], shape: o.kind === 'low' ? 5 : 2, ring: ST.sel === o.id ? 1 : 0, alpha: 0.9 });
  renderer.setTracks(segs);
  renderer.setMarkers(marks);
  dirtyOverlays = false; lastOverlayT = t;
}

// ── camera, flights, tour ────────────────────────────────────────────────
function aspect() { return canvas.clientWidth / Math.max(1, canvas.clientHeight); }
function clearFill() { const r = occlusion(); return Math.max(0.3, (r.b - r.t) / innerHeight); }
// the clear area in the form camera.js frameAlt reads
// In the saver the height is at least half the view: the subject sits in
// the plate's clear band, and its surroundings may run on under the plate.
function clearArea() {
  const r = occlusion(), H = canvas.clientHeight || innerHeight;
  return { w: Math.max(1, r.r - r.l), h: Math.max(1, r.b - r.t, ST.saver ? 0.5 * H : 0), H };
}
// the altitude that frames rKm, never below the automatic floor
function frameAltFor(rKm, clear = clearArea()) { return Math.max(CAM.frameAlt(rKm, clear), CAM.minAlt(clear, 'auto')); }
// the altitude at which the whole globe fits the clear area
function wideAlt(fill = clearFill() * 0.86) {
  const k = Math.tan(CAM.FOV * D / 2) * fill, s = k / Math.sqrt(1 + k * k);
  return 1 / s - 1;
}
function flyTo(target, dur, minDur) {
  const f = CAM.flight({ ...ST.cam }, target, { dur, minDur });
  ST.fly = { f, t0: performance.now(), target };
  return f.dur;
}
// the tour order: the strongest stop first, then always the nearest
// stop not yet visited (short, calm flights instead of zig-zags)
function tourOrder() {
  const n = ST.stops.length; if (!n) return [];
  const pos = ST.stops.map(o => stopPos(o)), left = new Set(ST.stops.map((_, i) => i)), out = [0];
  left.delete(0);
  while (left.size) {
    const a = pos[out[out.length - 1]]; let best = -1, bd = 1e9;
    for (const i of left) { const d = CAM.arc(a, pos[i]); if (d < bd) { bd = d; best = i; } }
    out.push(best); left.delete(best);
  }
  return out;
}
function startTour() {
  if (!ST.stops.length) return;
  ST.tour = { on: true, i: -1, phase: 'next', t0: performance.now(), order: tourOrder(), fol: null };
  $('tourBtn').classList.add('on'); $('tourBtn').textContent = '■ Stop the tour';
  $('dockTour').classList.add('on');
}
function stopTour() {
  ST.tour.on = false;
  $('tourBtn').classList.remove('on'); $('tourBtn').textContent = '▶ Tour every event';
  $('dockTour').classList.remove('on');
}
// tourTick runs each frame: next -> fly -> hold -> next
function tourTick(now) {
  const T = ST.tour; if (!T.on || ST.saver) return;
  if (T.phase === 'next') {
    T.i = (T.i + 1) % T.order.length;
    const o = ST.stops[T.order[T.i]]; if (!o) { stopTour(); return; }
    select(o.id, false);
    const d = flyTo(stopCam(o, T.i), 0, 3.2);
    T.phase = 'fly'; T.t0 = now; T.dur = d * 1000;
  } else if (T.phase === 'fly') {
    if (!ST.fly) { T.phase = 'hold'; T.t0 = now; T.fol = CAM.follower(ST.cam); }
  } else if (T.phase === 'hold') {
    const o = ST.stops[T.order[T.i]];
    if (o) followStop(o, T);
    ST.cam.heading += 1.6 * frameDt;
    if (now - T.t0 > HOLD_S * 1000) T.phase = 'next';
  }
}
// keep a moving storm in the centre while the time plays: a critically
// damped spring toward the storm, aimed ahead by the spring lag (2 / omega
// seconds of model time), so the camera neither trails nor jerks at a fix
const FOLLOW_W = 1.8;
function followStop(o, holder, omega = FOLLOW_W) {
  const lead = ST.playing ? (2 / omega) * ST.speed * H : 0;
  const p = stopPos(o, Math.min(ST.t1, ST.t + lead));
  holder.fol = holder.fol || CAM.follower(ST.cam);
  const c = CAM.follow(holder.fol, CAM.unit(p.lat, p.lon), omega, frameDt);
  ST.cam.lat = c.lat; ST.cam.lon = c.lon;
}

// ── framing: the clear area between the panels ───────────────────────────
function occlusion() {
  const W = innerWidth, Hh = innerHeight, r = { l: 0, r: W, t: 0, b: Hh };
  if (ST.saver) {
    if (ST.viewOverride) return ST.viewOverride;
    return r;
  }
  const vis = el => el && !el.hidden && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect();
  const tb = vis($('timebar')); if (tb && tb.width > W * 0.5) r.b = Math.min(r.b, tb.top - 6);
  if (!PHONE_Q.matches) {
    const p = vis($('panel')); if (p && p.right < W * 0.5) r.l = Math.max(r.l, p.right + 6);
    const c = vis($('card')); if (c && c.width > 0 && c.left > W * 0.5) r.r = Math.min(r.r, c.left - 6);
    const lg = vis($('legend')); if (lg && lg.top > Hh * 0.5) r.b = Math.min(r.b, lg.top - 4);
    if (!document.documentElement.classList.contains('in-frame')) r.t = 46;
  } else {
    const lg = vis($('legend')); if (lg && lg.bottom < Hh * 0.5) r.t = Math.max(r.t, lg.bottom + 4);
    const c = vis($('card')); if (c && c.bottom < Hh * 0.6) r.t = Math.max(r.t, c.bottom + 4);
    const p = $('panel'); if (p.classList.contains('open')) { const q = p.getBoundingClientRect(); if (q.width > W * 0.6) r.b = Math.min(r.b, q.top - 4); else r.r = Math.min(r.r, q.left - 4); }
  }
  return r;
}

// ── the frame loop ───────────────────────────────────────────────────────
let lastNow = 0, userTouched = false, frameDt = 1 / 60;
const offS = { x: { x: 0, v: 0 }, y: { x: 0, v: 0 } };
function frame(now) {
  requestAnimationFrame(frame);
  if (!solver) return;
  const dt = Math.min(0.1, (now - (lastNow || now)) / 1000); lastNow = now; frameDt = dt;
  if (ST.playing) {
    let t = ST.t + dt * ST.speed * H;
    if (t > ST.t1) t = ST.t0;
    setTime(t);
  }
  // camera: flight, tour, inertia
  if (ST.fly) {
    const k = (now - ST.fly.t0) / 1000 / ST.fly.f.dur;
    if (k >= 1) { Object.assign(ST.cam, ST.fly.target); ST.fly = null; }
    else Object.assign(ST.cam, ST.fly.f.at(k));
  }
  tourTick(now);
  SG.saverTick && SG.saverTick(now);
  inertia(dt);
  // framing: the view offset follows the clear area through a critically
  // damped spring (about 0.8 s), and the altitude floor of the clear area
  // pushes the camera out softly when a panel or the plate grows
  const W = canvas.clientWidth, Hh = canvas.clientHeight, r = occlusion();
  const goal = { x: ((r.l + r.r) / 2 / W) * 2 - 1, y: -(((r.t + r.b) / 2 / Hh) * 2 - 1) };
  ST.off.x = CAM.spring(offS.x, goal.x, 5, dt); ST.off.y = CAM.spring(offS.y, goal.y, 5, dt);
  const floor = CAM.minAlt(clearArea(), 'user');
  if (!ST.fly && ST.cam.alt < floor) ST.cam.alt += (floor - ST.cam.alt) * (1 - Math.exp(-dt * 3));
  const b = CAM.basis(ST.cam, aspect(), ST.off);
  const enc = device.createCommandEncoder();
  const t0 = performance.now();
  solverFollow(enc);
  if (dirtyOverlays || Math.abs(ST.t - lastOverlayT) > 0.25 * H || ((now / 1000) % 0.25 < dt)) buildOverlays();
  const sun = TL.subsolar(ST.t);
  const T = CAM.unit(ST.cam.lat, ST.cam.lon), horizon = Math.acos(1 / (1 + ST.cam.alt));
  const capR = Math.min(horizon, Math.atan(ST.cam.alt * Math.max(b.tanX, b.tanY) * 1.6) + 0.05);
  renderer.draw(b, {
    mode: ST.field, strength: ST.field === 3 ? 0 : ST.strength, dye: ST.layers.dye ? 1 : 0, cones: ST.layers.cones ? 1 : 0,
    grid: 1, coast: ST.layers.coast ? 1 : 0, fade: ST.fade, sun: CAM.unit(sun.lat, sun.lon), night: 0.25,
    tracks: ST.layers.tracks, markers: true,
  }, {
    on: ST.layers.particles, colour: ST.layers.magmaParticles, cap: [...T, Math.cos(capR)],
    // WIND_VIS, per second (not per frame), so a 120 Hz screen streams
    // at the same speed as a 60 Hz one
    secPerFrame: 2600 * WIND_VIS * Math.max(0.06, Math.min(3, ST.cam.alt)) * Math.max(0.5, Math.min(2, dt * 60)), life: 80, alpha: 0.32,
  }, enc);
  stats.ms = stats.ms * 0.95 + (performance.now() - t0) * 0.05;
  placeLabels(b);
  if ((now | 0) % 500 < 17) updateStats();
}
function updateStats() {
  const el = $('solverStats'); if (!el || el.offsetParent === null) return;
  el.textContent = `grid ${solver.nx}×${solver.ny} (${(360 / solver.nx).toFixed(2)}°) · ${stats.steps} step${stats.steps === 1 ? '' : 's'}/frame · dt ${Math.round(stats.dt)} s · encode ${stats.ms.toFixed(1)} ms`;
}

// ── labels (HTML) ────────────────────────────────────────────────────────
const labelEls = new Map();
function placeLabels(b) {
  const host = $('labels');
  if (!ST.layers.labels || ST.saver) { host.style.display = 'none'; return; }
  host.style.display = '';
  const W = canvas.clientWidth, Hh = canvas.clientHeight, seen = new Set();
  const want = ST.stops.filter(o => o.kind !== 'event' || ST.layers.events).slice(0, 18);
  for (const o of want) {
    const p = stopPos(o);
    if (o.kind === 'storm' && !p.st) continue;
    const q = CAM.project(b, CAM.unit(p.lat, p.lon));
    if (!q.front || Math.abs(q.x) > 1.1 || Math.abs(q.y) > 1.1) continue;
    let el = labelEls.get(o.id);
    if (!el) {
      el = document.createElement('div'); el.className = 'lbl' + (o.kind === 'event' ? ' ev' : '');
      el.onclick = () => { stopTour(); select(o.id, true); };
      host.appendChild(el); labelEls.set(o.id, el);
    }
    const txt = o.kind === 'storm' ? `<b>${o.s.name}</b><i>${catLabel(p.st.vmax)} ${Math.round(p.st.vmax)} kt</i>` : o.kind === 'low' ? `<b>L</b> <i>${Math.round(o.l.hpa)} hPa</i>` : o.kind === 'jet' ? `<i>${Math.round(o.l.wind)} m/s</i>` : `${o.e.title.length > 34 ? o.e.title.slice(0, 32) + '…' : o.e.title}`;
    if (el._t !== txt) { el.innerHTML = txt; el._t = txt; }
    el.classList.toggle('sel', o.id === ST.sel);
    el.style.transform = `translate(${((q.x + 1) / 2 * W).toFixed(1)}px, ${((1 - q.y) / 2 * Hh + 12).toFixed(1)}px) translate(-50%, 0)`;
    seen.add(o.id);
  }
  for (const [id, el] of labelEls) if (!seen.has(id)) { el.remove(); labelEls.delete(id); }
}

// ── input ────────────────────────────────────────────────────────────────
const drag = { on: false, x: 0, y: 0, vx: 0, vy: 0, pts: new Map(), pinch: 0, moved: 0, mode: 'turn' };
function userMoved() {
  userTouched = true; ST.fly = null;
  if (ST.tour.on) stopTour();
}
function turnBy(dx, dy) {
  // a drag moves the ground under the finger: degrees per pixel from the
  // altitude and the screen height
  const k = (ST.cam.alt * Math.tan(CAM.FOV * D / 2) * 2 / canvas.clientHeight) / D * 1.0;
  const h = (ST.cam.heading || 0) * D;
  const dn = dy * Math.cos(h) + dx * Math.sin(h), de = -dx * Math.cos(h) + dy * Math.sin(h);
  ST.cam.lat = Math.max(-85, Math.min(85, ST.cam.lat + dn * k));
  ST.cam.lon = ((ST.cam.lon + de * k / Math.max(0.2, Math.cos(ST.cam.lat * D)) + 540) % 360) - 180;
}
// the pinch and wheel limit: MIN_R_KM.user on the narrow side of the clear area
function zoomBy(f) { ST.cam.alt = Math.max(CAM.minAlt(clearArea(), 'user'), Math.min(4.5, ST.cam.alt * f)); }
function inertia(dt) {
  if (drag.on || (Math.abs(drag.vx) < 0.05 && Math.abs(drag.vy) < 0.05)) return;
  turnBy(drag.vx * dt * 60, drag.vy * dt * 60);
  drag.vx *= Math.pow(0.9, dt * 60); drag.vy *= Math.pow(0.9, dt * 60);
}
function bindPointer() {
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    drag.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    drag.on = true; drag.x = e.clientX; drag.y = e.clientY; drag.vx = drag.vy = 0; drag.moved = 0;
    drag.mode = e.button === 2 || e.shiftKey ? 'tilt' : 'turn';
    if (drag.pts.size === 2) { const [a, b] = [...drag.pts.values()]; drag.pinch = Math.hypot(a.x - b.x, a.y - b.y); drag.my = (a.y + b.y) / 2; }
    canvas.classList.add('drag');
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag.pts.has(e.pointerId)) return;
    drag.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (drag.pts.size === 2) {
      const [a, b] = [...drag.pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y), my = (a.y + b.y) / 2;
      if (drag.pinch > 0) { zoomBy(drag.pinch / d); userMoved(); }
      ST.cam.tilt = Math.max(0, Math.min(60, ST.cam.tilt + (my - drag.my) * 0.25));
      drag.pinch = d; drag.my = my; drag.moved += 10;
      return;
    }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.moved < 4) return;
    userMoved();
    if (drag.mode === 'tilt') { ST.cam.heading -= dx * 0.3; ST.cam.tilt = Math.max(0, Math.min(65, ST.cam.tilt + dy * 0.25)); return; }
    turnBy(dx, dy); drag.vx = dx; drag.vy = dy;
  });
  const up = e => {
    const was = drag.pts.has(e.pointerId);
    drag.pts.delete(e.pointerId);
    if (drag.pts.size === 0) { drag.on = false; canvas.classList.remove('drag'); }
    if (was && drag.moved < 5 && e.type === 'pointerup') pickAt(e.clientX, e.clientY);
    if (drag.pts.size < 2) drag.pinch = 0;
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('wheel', e => { e.preventDefault(); userMoved(); zoomBy(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
}
function pickAt(cx, cy) {
  const r = canvas.getBoundingClientRect(), b = CAM.basis(ST.cam, aspect(), ST.off);
  let best = null, bd = 26;
  for (const o of ST.stops) {
    const p = stopPos(o); if (o.kind === 'storm' && !p.st) continue;
    const q = CAM.project(b, CAM.unit(p.lat, p.lon)); if (!q.front) continue;
    const d = Math.hypot((q.x + 1) / 2 * r.width - (cx - r.left), (1 - q.y) / 2 * r.height - (cy - r.top));
    if (d < bd) { bd = d; best = o; }
  }
  if (best) { stopTour(); select(best.id, true); }
}

// ── UI ───────────────────────────────────────────────────────────────────
function setOpen(grp) {
  const p = $('panel');
  if (!PHONE_Q.matches) return;
  const same = p.classList.contains('open') && p.dataset.grp === grp;
  if (!grp || same) { p.classList.remove('open', 'full'); p.dataset.grp = ''; }
  else { p.classList.add('open'); p.dataset.grp = grp; }
  for (const g of p.querySelectorAll('.grp')) g.classList.toggle('show', g.dataset.grp === p.dataset.grp);
  for (const t of document.querySelectorAll('#dock .tab[data-grp]')) t.classList.toggle('on', t.dataset.grp === p.dataset.grp);
}
function buildUI() {
  buildList();
  $('tourBtn').onclick = () => { if (ST.tour.on) stopTour(); else { userTouched = false; startTour(); } };
  $('dockTour').onclick = () => { if (ST.tour.on) stopTour(); else { setOpen(null); startTour(); } };
  for (const t of document.querySelectorAll('#dock .tab[data-grp]')) t.onclick = () => setOpen(t.dataset.grp);
  $('panelClose').onclick = () => setOpen(null);
  // the sheet grip: drag up to full height, down to close
  { let y0 = null; const g = $('sheetGrip');
    g.addEventListener('pointerdown', e => { y0 = e.clientY; g.setPointerCapture(e.pointerId); });
    g.addEventListener('pointerup', e => { if (y0 == null) return; const d = e.clientY - y0; y0 = null; const p = $('panel');
      if (d < -30) p.classList.add('full'); else if (d > 30) { if (p.classList.contains('full')) p.classList.remove('full'); else setOpen(null); } }); }
  $('cardFold').onclick = () => $('card').classList.toggle('fold');
  if (PHONE_Q.matches) $('card').classList.add('fold');
  for (const btn of document.querySelectorAll('#fieldModes button')) btn.onclick = () => {
    ST.field = +btn.dataset.field;
    for (const q of document.querySelectorAll('#fieldModes button')) q.classList.toggle('on', q === btn);
    buildLegend();
  };
  for (const btn of document.querySelectorAll('[data-layer]')) btn.onclick = () => {
    const k = btn.dataset.layer; ST.layers[k] = !ST.layers[k]; btn.classList.toggle('on', ST.layers[k]);
    if (k === 'cones') renderer.setCones(ST.layers.cones ? ST.storms : [], selStormId());
    dirtyOverlays = true;
  };
  const sv = () => { $('strengthV').textContent = Math.round(ST.strength * 100) + '%'; };
  $('strength').oninput = e => { ST.strength = e.target.value / 100; sv(); }; sv();
  const nv = () => { $('nudgeV').textContent = ST.nudgeH + ' h'; };
  $('nudge').oninput = e => { ST.nudgeH = +e.target.value; nv(); }; nv();
  $('play').onclick = () => setPlaying(!ST.playing);
  $('speedBtn').onclick = () => { const i = (SPEEDS.indexOf(ST.speed) + 1) % SPEEDS.length; ST.speed = SPEEDS[i]; $('speedBtn').textContent = ST.speed + ' h/s'; };
  buildTimebar(); buildLegend(); bindPointer(); bindTrack();
  addEventListener('keydown', e => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.code === 'Space') { e.preventDefault(); setPlaying(!ST.playing); }
    if (e.key === 'ArrowRight') setTime(ST.t + (e.shiftKey ? 6 : 1) * H);
    if (e.key === 'ArrowLeft') setTime(ST.t - (e.shiftKey ? 6 : 1) * H);
    if (e.key === 't') { if (ST.tour.on) stopTour(); else startTour(); }
  });
  PHONE_Q.addEventListener('change', () => { setOpen(null); resize(); });
  updateDataNote();
}
function setPlaying(on) { ST.playing = on; $('play').classList.toggle('on', on); $('play').innerHTML = on ? '<i>❚❚</i>' : '<i>▶</i>'; }
function updateDataNote() {
  const m = snap.meta, sample = m.sample || snap.base.includes('sample');
  const age = snapshotAgeH(m);
  const st = ST.live;
  $('dataNote').innerHTML = `${sample ? '<b>Sample data</b> (committed with the page). ' : ''}Winds: GFS cycle ${TL.fmtTime(ST.dataTime)}${st.winds === 'live' ? ' (fetched live from AWS)' : age > 30 ? ` (${Math.round(age)} h old)` : ''}. Storms: ${ST.storms.length} (NHC${st.storms === 'live' ? ', JTWC live' : ', JTWC'}). Events: NASA EONET${st.events === 'live' ? ' (live)' : ''}. Snapshot made ${new Date(m.made).toISOString().slice(0, 16).replace('T', ' ')} UTC.`;
}

// ── time bar ─────────────────────────────────────────────────────────────
function xOf(t) { return (t - ST.t0) / (ST.t1 - ST.t0) * 100; }
function buildTimebar() {
  const sh = $('tShade'), dx = xOf(ST.dataTime);
  sh.innerHTML = `<div class="obs" style="width:${dx}%"></div><div class="fc" style="left:${dx}%"></div><span class="lab" style="left:0">observed</span><span class="lab" style="right:0">forecast</span>`;
  const tk = $('tTicks'); tk.innerHTML = '';
  for (const m of TL.ticks(ST.t0, ST.t1)) {
    const i = document.createElement('i'); i.className = m.kind; i.style.left = xOf(m.t) + '%'; tk.appendChild(i);
    if (m.label) { const s = document.createElement('span'); s.style.left = xOf(m.t) + '%'; s.textContent = m.label; tk.appendChild(s); }
  }
  $('tNow').style.left = dx + '%';
  updateTimebar();
}
function updateTimebar() {
  const x = xOf(ST.t);
  $('cursor').style.left = x + '%';
  $('cursorLab').textContent = TL.relLabel(ST.t, ST.dataTime);
  $('timeAbs').textContent = TL.fmtTime(ST.t);
  $('timeRel').textContent = (ST.t > ST.dataTime + 60e3 ? 'GFS forecast ' : ST.t < ST.dataTime - 60e3 ? 'GFS analysis ' : 'GFS analysis ') + TL.relLabel(ST.t, ST.dataTime);
  $('track').setAttribute('aria-valuenow', TL.timeToSlider(ST.t, ST.t0, ST.t1));
  $('track').setAttribute('aria-valuetext', TL.fmtTime(ST.t));
}
function bindTrack() {
  const tr = $('track'); let on = false;
  const at = e => { const r = tr.getBoundingClientRect(); setTime(TL.sliderToTime((e.clientX - r.left) / r.width * TL.SLIDER_MAX, ST.t0, ST.t1)); };
  tr.addEventListener('pointerdown', e => { on = true; tr.setPointerCapture(e.pointerId); at(e); });
  tr.addEventListener('pointermove', e => { if (on) at(e); });
  tr.addEventListener('pointerup', () => { on = false; });
  tr.addEventListener('keydown', e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') e.stopPropagation(); });
}

// ── legend ───────────────────────────────────────────────────────────────
function buildLegend() {
  const lg = $('legend'), bar = $('lgBar'), marks = $('lgMarks'), t1 = $('lgTicks'), t2 = $('lgTicks2');
  marks.innerHTML = t1.innerHTML = t2.innerHTML = '';
  const tick = (host, x, txt) => { const s = document.createElement('span'); s.style.left = (x * 100).toFixed(2) + '%'; s.textContent = txt; host.appendChild(s); };
  lg.hidden = ST.field === 3;
  lg.classList.toggle('withmarks', ST.field === 0);
  if (ST.field === 0) {
    $('lgTitle').innerHTML = '<span>Wind speed at 10 m, m/s (km/h below)</span><span>marks: Saffir-Simpson</span>';
    bar.style.background = COL.cssGradient(COL.magma);
    for (const v of [0, 5, 10, 20, 30, 40, 50, 60, 70]) tick(t1, COL.speedToX(v), v);
    for (const v of [25, 50, 100, 150, 200, 250]) tick(t2, COL.speedToX(v / 3.6), v);
    for (const m of COL.SS_MARKS) { const x = COL.speedToX(m.ms) * 100; marks.insertAdjacentHTML('beforeend', `<i style="left:${x}%"></i><b style="left:${x}%">${m.label}</b>`); }
  } else if (ST.field === 1) {
    $('lgTitle').innerHTML = '<span>Vorticity, 10⁻⁵ s⁻¹</span><span>anticyclonic · cyclonic</span>';
    bar.style.background = COL.cssGradient(COL.vortColour);
    for (const v of [-40, -10, -2, 0, 2, 10, 40]) tick(t1, COL.vortToX(v), (v > 0 ? '+' : '') + v);
  } else if (ST.field === 2) {
    $('lgTitle').innerHTML = '<span>Sea-level pressure, hPa</span><span>isobars every 4 hPa</span>';
    bar.style.background = COL.cssGradient(COL.presColour);
    for (const v of [950, 970, 990, 1010, 1030]) tick(t1, COL.presToX(v), v);
  }
}

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, LITE ? 1.5 : 2);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  renderer && renderer.resize(w, h, dpr);
}

// ── live refresh ─────────────────────────────────────────────────────────
async function liveRefresh() {
  const log = m => console.info('storm-globe: ' + m);
  const age = snapshotAgeH(snap.meta);
  // GFS from AWS when the snapshot is stale (the committed sample)
  if (age > STALE_H || location.hash.includes('livegfs')) {
    try {
      ST.live.winds = 'loading'; updateDataNote();
      const res = await fetchLiveWinds({ grid: snap.meta.winds.grid, past: 24, ahead: 72, concurrency: 4 });
      snap = { ...snap, base: 'live-gfs', frames: res.frames, times: res.times, meta: { ...snap.meta, sample: false, winds: { ...snap.meta.winds, cycle: new Date(res.cycle).toISOString(), times: res.times.map(t => new Date(t).toISOString()), kinds: res.kinds, source: 'NOAA GFS 1.0 deg (AWS open data), fetched in the browser' } } };
      ST.live.winds = 'live';
      // storms of the sample that end long before the new data window go
      const t0 = res.times[0];
      snap.meta.storms = snap.meta.storms.filter(s => { const p = TL.stormPath(s); return p.length && p[p.length - 1].t > t0; });
      adoptSnapshot(); buildTimebar(); updateDataNote();
      log('live GFS cycle ' + new Date(res.cycle).toISOString());
    } catch (e) { ST.live.winds = 'snapshot'; log('live GFS failed: ' + e.message); updateDataNote(); }
  }
  try {
    const js = await fetchLiveStorms(fetch, log);
    const t0 = ST.t0;
    const keep = js.filter(s => { const p = TL.stormPath(s); return p.length && p[p.length - 1].t > t0; });
    snap.meta.storms = mergeStorms(snap.meta.storms, keep);
    ST.storms = snap.meta.storms.map(s => ({ ...s, _path: null }));
    ST.live.storms = 'live';
  } catch (e) { ST.live.storms = 'snapshot'; log('JTWC failed: ' + e.message); }
  try {
    const ev = await fetchLiveEvents(fetch, log);
    if (ev.length) { snap.meta.events = ev; ST.events = dedupeEvents(ev, ST.storms); ST.live.events = 'live'; }
  } catch (e) { ST.live.events = 'snapshot'; log('EONET failed: ' + e.message); }
  detectExtremes(); buildStops();
  renderer.setCones(ST.layers.cones ? ST.storms : [], selStormId());
  dirtyOverlays = true; updateDataNote();
  if (ST.tour.on) ST.tour.order = tourOrder();
}

// ── debug and saver API ──────────────────────────────────────────────────
const SG = window.__stormGlobe = {
  ST, CAM, TL, COL, get solver() { return solver; }, get renderer() { return renderer; }, get snap() { return snap; }, get device() { return device; },
  canvas: () => canvas, setTime, select, flyTo, startTour, stopTour, stopPos, stopTitle, stopCam, wideAlt, buildLegend, catLabel, setPlaying,
  followStop, frameAltFor, clearArea, zoomBy, get frameDt() { return frameDt; },
  setField(m) { ST.field = m; buildLegend(); },
  booted: false, failed: null,
};
boot().then(() => { SG.booted = true; }).catch(e => {
  SG.failed = String(e && e.stack || e);
  console.error('storm-globe boot failed: ' + (e && e.message || e));
  $('loading').classList.add('done');
  noGpu('The page could not start: ' + (e && e.message || e));
});
