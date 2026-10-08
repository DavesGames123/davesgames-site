// ============================================================================
//  OUTBREAK  ·  main.js — boot, frame loop and the wiring of every module
// ----------------------------------------------------------------------------
//  boot() loads the nodes (data.js), builds the travel network
//  (network.js), imports three.js, makes the globe (render/globe.js), the
//  controls (ui.js), the chart (charts.js) and the Auto runner and
//  screensaver hook (saver.js). Then it runs one requestAnimationFrame loop.
//
//  createApp({ D, net, globe, canvas, ... }) -> App holds the state and has
//  no DOM, so a node test can drive it with a stub globe:
//    app.api      the object ui.js createUI(api) binds (CONTRACT.md "UI")
//    app.saverApp the object saver.js installSaver(app) uses
//    app.frame(nowSec)   one frame: Auto runner, model step, events,
//                        prevalence, camera, globe.update, HUD, chart
//    app.drag(dx, dy, h), app.zoom(f), app.touch()   pointer input
//    app.attach({ ui, chart, ctl })   connects the DOM parts after boot
//  The model runs only while playing, at `speed` days per wall second,
//  with a frame step capped at MAX_DT, so a slow frame does not jump.
//
//  Camera: the user drags and zooms the camera.js state. After IDLE_S
//  seconds without input, the globe turns slowly (IDLE_DRIFT). In Auto
//  and in the screensaver, the director shots set the camera (an eased
//  flight at FLY.maxDegPerSec for a near cut, a jump behind a fade for a
//  far cut) and add spin and drift. The spin and drift rates ease to
//  each new shot's values (MOVE_RATE), so a cut never starts a turn at
//  full speed.
//  Any user edit of the disease, policies, style or run stops Auto.
//
//  Framing: occlusion() is the area that the panel, HUD, base bar and dock
//  leave clear (ui.clearRect). The globe centres in it by setViewOffset.
//  In the screensaver, saver.js gives the plate band instead.
//
//  Release: render/globe.js disposes every GPU object and calls
//  forceContextLoss on pagehide. main.js also stops the frame loop there.
//
//  grep -n targets: "export function createApp", "export function pickSeedNode",
//    "export function hottestNode", "export function topRegion",
//    "function newSim", "function setShot", "function updateCamera",
//    "function frame", "function occlusion", "async function boot",
//    "function bindPointer", "const api", "const saverApp"
// ============================================================================
import { loadNodes } from './data.js';
import { buildNetwork } from './network.js';
import { createSim } from './model.js';
import { getDisease } from './diseases.js';
import { defaultPolicies } from './policies.js';
import { flight } from './camera.js';
import { wrapLon } from './geo.js';
import { makeRng } from './rng.js';
import { texFor, RULES } from './equations.js';
import { createGlobe } from './render/globe.js';
import { createUI } from './ui.js';
import { createChart } from './charts.js';
import { installSaver } from './saver.js';

export const DEFAULT_DISEASE = 'covid-ancestral';
export const MAX_DT = 0.1;         // s, the largest frame step
export const IDLE_S = 8;           // s without input before the slow turn
export const IDLE_DRIFT = 1.2;     // degrees of longitude per second
export const FLY = { maxDegPerSec: 18, maxTurnDegPerSec: 20, minDur: 2.5, hop: 0.2 };   // calm camera flights
export const MOVE_RATE = 0.8;      // 1/s, the ease of spin and drift to a new shot
export const CHART_EVERY = 0.25;   // s between chart redraws
export const ALT = { globe: [0.12, 5], flat: [0.25, 6] };
const SEED_POOL = 60;              // the random seed city is one of the largest 60

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// A large city for a run with no chosen seed city. Same seed, same city.
export function pickSeedNode(D, seed) {
  const big = D.nodes.slice().sort((a, b) => b.cityPop - a.cityPop || a.i - b.i).slice(0, SEED_POOL);
  const rng = makeRng(((seed >>> 0) ^ 0x51ed5eed) >>> 0);
  return big[rng.int(big.length)].i;
}

// The node with the most infectious people, or -1.
export function hottestNode(sim) {
  let best = -1, bv = 0;
  for (let i = 0; i < sim.N; i++) if (sim.I[i] > bv) { bv = sim.I[i]; best = i; }
  return best;
}

// The region with the most infectious people on the last recorded day, or -1.
export function topRegion(sim) {
  const h = sim.history.regionI, ri = h[h.length - 1];
  if (!ri) return -1;
  let best = -1, bv = 0;
  for (let k = 0; k < ri.length; k++) if (ri[k] > bv) { bv = ri[k]; best = k; }
  return best;
}

export function createApp({ D, net, globe, canvas = null, disease = DEFAULT_DISEASE, seed = 1, startDayOfYear = 0 }) {
  const N = D.nodes.length;
  const pop = Float64Array.from(D.nodes, n => n.pop || 1);
  const prev = new Float32Array(N);
  const st = {
    disease: getDisease(disease), policies: defaultPolicies(), style: 'night',
    playing: true, speed: 3, seed: (seed >>> 0) || 1, seedNode: -1, startDayOfYear, chartLog: true,
  };
  let sim = null, cursor = 0, events = [], newestFirst = null, runSeedNode = -1;
  let cam = { lat: 20, lon: 10, alt: 2.2, tilt: 0, heading: 0 };
  let fl = null, flT = 0, move = { spin: 0, drift: 0 }, vel = { spin: 0, drift: 0, idle: 0 };
  let ui = null, chart = null, ctl = null, saverRect = null;
  let lastT = null, now = 0, idleAt = 0, chartAt = -1e9;

  const mode = () => (globe.mode === 'flat' ? 'flat' : 'globe');
  const autoMode = () => (ctl ? ctl.mode : null);

  function newSim() {
    runSeedNode = st.seedNode >= 0 && st.seedNode < N ? st.seedNode : pickSeedNode(D, st.seed);
    sim = createSim({ D, net, disease: st.disease, policies: st.policies, seed: st.seed,
      seedNode: runSeedNode, startDayOfYear: st.startDayOfYear });
    cursor = 0; events = []; newestFirst = null; prev.fill(0);
    if (chart && chart.invalidate) chart.invalidate();
  }

  // The user's own camera move to a city (not in Auto).
  function flyTo(i, alt = 1.3) {
    const n = D.nodes[i];
    if (!n || autoMode()) return;
    const to = { lat: n.lat, lon: n.lon, alt: mode() === 'flat' ? Math.max(alt, 1.2) : alt, tilt: 0, heading: 0 };
    fl = flight(cam, to, { ...FLY, mode: mode() }); flT = 0; move = { spin: 0, drift: 0 };
  }

  function stopAuto() {
    if (autoMode() === 'button') { ctl.auto(false); move = { spin: 0, drift: 0 }; }
  }

  function setShot(s, { fly = false } = {}) {
    const to = { lat: 20, lon: 0, alt: 2, tilt: 0, heading: 0, ...(s && s.cam) };
    move = { spin: +(s && s.spin) || 0, drift: +(s && s.drift) || 0 };
    if (fly) { fl = flight(cam, to, { ...FLY, mode: mode() }); flT = 0; }
    else { fl = null; cam = to; vel = { spin: 0, drift: 0, idle: 0 }; }
    globe.setCamera(cam);
  }

  function updateCamera(dt) {
    const k = 1 - Math.exp(-MOVE_RATE * dt);
    const auto = !!autoMode(), idle = !auto && now - idleAt > IDLE_S && mode() === 'globe';
    vel.spin += ((auto && !fl ? move.spin : 0) - vel.spin) * k;
    vel.drift += ((auto && !fl ? move.drift : 0) - vel.drift) * k;
    vel.idle += ((idle && !fl ? IDLE_DRIFT : 0) - vel.idle) * k;
    if (fl) {
      flT += dt; cam = fl.at(Math.min(flT, fl.dur));
      if (flT >= fl.dur) fl = null;
    } else {
      cam.heading = ((cam.heading || 0) + vel.spin * dt) % 360;
      if (mode() === 'globe') cam.lon = wrapLon(cam.lon + (vel.drift + vel.idle) * dt);
    }
    globe.setCamera(cam);
  }

  // The clear rect in CSS px, edges from the top-left, or null.
  function occlusion() {
    if (saverRect) return saverRect;
    return ui && ui.clearRect ? ui.clearRect() : null;
  }
  function layout() {
    const r = occlusion();
    if (r) globe.setViewOffset(r.l, r.r, r.t, r.b);
    else globe.setViewOffset(null, null, null, null);
  }

  function view() {
    return {
      day: sim.day, burnedOut: sim.burnedOut, totals: sim.totals(), reff: sim.reffGlobal(),
      hottest: hottestNode(sim), newestFirst, topRegion: topRegion(sim), active: sim.active, D,
    };
  }

  function frame(t) {
    now = t;
    const dt = lastT === null ? 0 : clamp(t - lastT, 0, MAX_DT);
    lastT = t;
    if (ctl) ctl.frame(t);
    if (st.playing && !sim.burnedOut && dt > 0) sim.step(st.speed * dt);
    const ev = sim.eventsSince(cursor);
    cursor = ev.cursor; events = ev.list;
    for (const e of events) if (e.first && !e.blocked) newestFirst = e;
    for (let i = 0; i < N; i++) prev[i] = sim.I[i] / pop[i];
    updateCamera(dt);
    globe.update({ t, dt, sim, prev, events, mode: mode() });
    if (ui) ui.update(sim, t * 1000);
    if (chart && t - chartAt >= CHART_EVERY) {
      chartAt = t;
      if (chart.setLog) chart.setLog(ui ? ui.chartLog : st.chartLog);
      chart.draw(sim.history, sim.active, st.disease);
    }
  }

  // ── the ui.js api ──────────────────────────────────────────────────────
  const api = {
    getState: () => ({
      disease: st.disease, policies: st.policies, style: globe.style || st.style, playing: st.playing,
      speed: st.speed, auto: !!autoMode(), seedNode: st.seedNode, D, styles: globe.styles,
    }),
    setDisease(x) {
      stopAuto();
      const d = typeof x === 'string' ? getDisease(x) : x;
      if (!d) return;
      st.disease = d; newSim();
    },
    setPolicies(p) { stopAuto(); st.policies = p; sim.setPolicies(p); },
    setStyle(id) { stopAuto(); st.style = id; globe.setStyle(id); },
    play(b) { st.playing = !!b; },
    setSpeed(v) { if (v > 0) st.speed = +v; },
    restart(s) {
      stopAuto();
      if (s !== undefined && s !== null) st.seed = (s >>> 0) || 1;
      newSim(); flyTo(runSeedNode);
    },
    seedAt(i) { stopAuto(); st.seedNode = i >= 0 && i < N ? i | 0 : -1; newSim(); flyTo(runSeedNode); },
    auto(on) {
      if (!ctl) return;
      if (on) ctl.auto(true); else stopAuto();
      layout();
    },
    setChartLog(b) { st.chartLog = !!b; if (chart && chart.setLog) chart.setLog(!!b); },
    onLayout: () => layout(),
  };

  // ── the saver.js app ───────────────────────────────────────────────────
  const saverApp = {
    canvas, globe, D, texFor, rules: RULES,
    get styles() { return globe.styles; },
    view, disease: () => st.disease,
    startRun(r) {
      st.disease = getDisease(r.diseaseId) || st.disease;
      st.policies = r.policies || defaultPolicies();
      st.seedNode = r.seedNode >= 0 ? r.seedNode : -1;
      if (r.seed !== undefined) st.seed = (r.seed >>> 0) || 1;
      st.startDayOfYear = r.startDayOfYear | 0;
      if (r.style) { st.style = r.style; globe.setStyle(r.style); }
      newSim();
    },
    setSpeed: v => { st.speed = Math.max(0, +v || 0); },
    play: b => { st.playing = !!b; },
    setShot,
    setViewRect(r) { saverRect = r || null; layout(); },
    saveState: () => ({ ...st, style: globe.style || st.style, cam: { ...cam } }),
    restoreState(s) {
      if (!s) return;
      Object.assign(st, { disease: s.disease, policies: s.policies, style: s.style, playing: s.playing,
        speed: s.speed, seed: s.seed, seedNode: s.seedNode, startDayOfYear: s.startDayOfYear, chartLog: s.chartLog });
      globe.setStyle(st.style); globe.setFade(1);
      fl = null; move = { spin: 0, drift: 0 }; cam = { ...s.cam };
      newSim();
      if (ui && ui.sync) ui.sync();
    },
  };

  newSim();
  if (globe.setStyle) globe.setStyle(st.style);
  globe.setCamera(cam);

  return {
    api, saverApp, frame, layout, occlusion, view,
    get sim() { return sim; },
    get cam() { return cam; },
    get seedNode() { return runSeedNode; },
    get state() { return st; },
    attach(parts = {}) {
      if (parts.ui) ui = parts.ui;
      if (parts.chart) chart = parts.chart;
      if (parts.ctl) ctl = parts.ctl;
      layout();
    },
    // pointer input: dx, dy in CSS px, h = the view height in CSS px
    touch() { idleAt = now; stopAuto(); fl = null; vel = { spin: 0, drift: 0, idle: 0 }; },
    drag(dx, dy, h) {
      if (autoMode() === 'saver') return;
      idleAt = now; stopAuto(); fl = null; vel = { spin: 0, drift: 0, idle: 0 };
      const k = (mode() === 'flat' ? 57 : 45) * cam.alt / Math.max(1, h);
      const hd = (cam.heading || 0) * Math.PI / 180, ch = Math.cos(hd), sh = Math.sin(hd);
      const dE = k * (-dx * ch + dy * sh), dN = k * (dx * sh + dy * ch);
      const latMax = mode() === 'flat' ? 70 : 85;
      cam.lat = clamp(cam.lat + dN, -latMax, latMax);
      const lon = cam.lon + (mode() === 'flat' ? dE : dE / Math.max(0.2, Math.cos(cam.lat * Math.PI / 180)));
      cam.lon = mode() === 'flat' ? clamp(lon, -180, 180) : wrapLon(lon);
    },
    zoom(f) {
      if (autoMode() === 'saver' || !(f > 0)) return;
      idleAt = now; stopAuto(); fl = null; vel = { spin: 0, drift: 0, idle: 0 };
      const [lo, hi] = ALT[mode()];
      cam.alt = clamp(cam.alt * f, lo, hi);
    },
    pick(x, y) { return globe.pick(x, y); },
    flyTo,
  };
}

// ── the browser part ───────────────────────────────────────────────────────

function bindPointer(canvas, app, onTap) {
  const pts = new Map();
  let pinch = 0, moved = 0;
  const ac = new AbortController(), sig = { signal: ac.signal };
  const hint = document.getElementById('hint');
  const gone = () => { if (hint) hint.classList.add('gone'); };
  canvas.addEventListener('pointerdown', e => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    moved = 0; pinch = 0;
  }, sig);
  canvas.addEventListener('pointermove', e => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pts.size === 1) {
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 4) { app.drag(dx, dy, canvas.clientHeight || innerHeight); gone(); }
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0 && d > 0) app.zoom(pinch / d);
      pinch = d; moved = 99; gone();
    }
  }, sig);
  const up = e => {
    if (pts.size === 1 && moved <= 4 && e.type === 'pointerup') onTap(e.clientX, e.clientY);
    pts.delete(e.pointerId); pinch = 0;
  };
  canvas.addEventListener('pointerup', up, sig);
  canvas.addEventListener('pointercancel', up, sig);
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    app.zoom(Math.exp(clamp(e.deltaY, -120, 120) * 0.0015)); gone();
  }, { passive: false, signal: ac.signal });
  return () => ac.abort();
}

async function boot() {
  const $ = id => document.getElementById(id);
  const say = (txt, f) => { if ($('ltext')) $('ltext').textContent = txt; if ($('lfill')) $('lfill').style.width = `${Math.round(f * 100)}%`; };
  const canvas = $('view');
  say('Loading cities and travel routes…', 0.1);
  const D = await loadNodes();
  say('Building the air and land network…', 0.4);
  await new Promise(r => setTimeout(r, 0));
  const net = buildNetwork(D);
  say('Starting the globe…', 0.7);
  let THREE, globe;
  try {
    THREE = await import('three');
    globe = createGlobe(canvas, { D, net, THREE });
  } catch (e) {
    console.warn('outbreak: WebGL', e);
    $('nogl').hidden = false; $('loading').classList.add('done');
    return;
  }
  const doy = Math.floor((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 1)) / 864e5);
  const app = createApp({ D, net, globe, canvas, seed: (Math.random() * 2 ** 32) >>> 0, startDayOfYear: doy });
  const ctl = installSaver(app.saverApp);
  const ui = createUI(app.api);
  let chart = null;
  try { chart = createChart($('chart'), { log: ui.chartLog }); } catch (e) { console.warn('outbreak: chart', e); }
  app.attach({ ui, chart, ctl });
  app.flyTo(app.seedNode, 1.4);

  // a tap on a city: its name and counts for a few seconds
  const labels = $('labels');
  let tipT = 0;
  const onTap = (x, y) => {
    const i = app.pick(x, y);
    labels.textContent = '';
    if (i < 0) return;
    const n = D.nodes[i], s = app.sim, tip = document.createElement('div');
    tip.className = 'tip';
    tip.style.cssText = `position:absolute;left:${x + 12}px;top:${y - 8}px;padding:4px 8px;border-radius:6px;background:rgba(10,12,20,.85);color:#e6e9f0;font-size:12px;white-space:nowrap`;
    const pct = s.I[i] / n.pop * 100;
    tip.textContent = `${n.name}, ${n.country} · ${pct < 0.01 ? pct.toFixed(4) : pct.toFixed(2)} % infected now`;
    labels.append(tip);
    clearTimeout(tipT); tipT = setTimeout(() => { labels.textContent = ''; }, 3500);
  };
  const unbind = bindPointer(canvas, app, onTap);

  let raf = 0, live = true;
  const loop = ms => { if (!live) return; raf = requestAnimationFrame(loop); app.frame(ms / 1000); };
  addEventListener('resize', () => { globe.resize(); app.layout(); });
  addEventListener('pagehide', () => {
    live = false; cancelAnimationFrame(raf); unbind();
    if (ctl.mode) ctl.auto(false);
    ui.dispose(); if (chart) chart.dispose();
    globe.dispose();
  });
  setTimeout(() => app.layout(), 400);   // after the panel transitions
  say('Ready', 1);
  $('loading').classList.add('done');
  raf = requestAnimationFrame(loop);
  window.__outbreak = app;
}

if (typeof document !== 'undefined' && document.getElementById('view')) {
  boot().catch(e => {
    console.error('outbreak: boot', e);
    const t = document.getElementById('ltext');
    if (t) t.textContent = 'The page could not start: ' + (e && e.message);
  });
}
