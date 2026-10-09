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
//  A shot with camEnd eases the altitude and tilt from cam to camEnd over
//  the shot (a push in or a pull back; it waits for the cut's flight). A
//  shot that follows the 'front' flies on to each new city that the
//  infection reaches (at most once per FRONT_GAP s, only if it is more
//  than FRONT_MIN_DEG away), at the calm flight caps.
//  Any user edit of the disease, policies, style or run stops Auto.
//
//  Stats: stats.js createStats reads the sim each frame (growth, exports,
//  tipping regions, the curve). view() hands them to the director, and
//  frame() hands the HUD values to the globe when the saver HUD is on.
//
//  Framing: occlusion() is the area that the panel, HUD, base bar and dock
//  leave clear (ui.clearRect). The globe centres in it by setViewOffset.
//  In the screensaver, saver.js gives the plate band instead.
//
//  Labels: only the few largest current outbreaks get a city label
//  (topOutbreaks, LABELS_DESKTOP or LABELS_PHONE). The set changes every
//  LABEL_EVERY seconds; the positions follow the globe each frame. A
//  label that would overlap another, or leave the clear rect, hides.
//
//  Release: render/globe.js disposes every GPU object and calls
//  forceContextLoss on pagehide. main.js also stops the frame loop there.
//
//  grep -n targets: "export function createApp", "export function pickSeedNode",
//    "export function hottestNode", "export function topRegion",
//    "export function topOutbreaks", "function bindLabels",
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
import { createStats } from './stats.js';
import { hudRect } from './render/hud.js';
import { phoneView } from './budget.js';
import { ease } from './camera.js';

export const DEFAULT_DISEASE = 'covid-ancestral';
export const MAX_DT = 0.1;         // s, the largest frame step
export const IDLE_S = 8;           // s without input before the slow turn
export const IDLE_DRIFT = 1.2;     // degrees of longitude per second
export const FLY = { maxDegPerSec: 18, maxTurnDegPerSec: 20, minDur: 2.5, hop: 0.2 };   // calm camera flights
export const MOVE_RATE = 0.8;      // 1/s, the ease of spin and drift to a new shot
export const CHART_EVERY = 0.25;   // s between chart redraws
export const ALT = { globe: [0.12, 5], flat: [0.25, 6] };
const SEED_POOL = 60;              // the random seed city is one of the largest 60
export const LABELS_DESKTOP = 4, LABELS_PHONE = 2;   // city labels on the globe
export const LABEL_MIN_PREV = 1e-4;                  // I/N below this gets no label
export const LABEL_EVERY = 0.75;                     // s between label set changes
export const FRONT_GAP = 3, FRONT_MIN_DEG = 8;       // the front follow of a shot

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

// The k nodes with the most infectious people, among the nodes whose
// prevalence I/N is at least minPrev. Sorted by I, largest first.
export function topOutbreaks(sim, pop, k = LABELS_DESKTOP, minPrev = LABEL_MIN_PREV) {
  const out = [];
  if (!sim || !(k > 0)) return out;
  for (let i = 0; i < sim.N; i++) {
    const v = sim.I[i];
    if (!(v > 0) || v / pop[i] < minPrev) continue;
    if (out.length < k) out.push(i);
    else if (v > sim.I[out[k - 1]]) out[k - 1] = i;
    else continue;
    out.sort((a, b) => sim.I[b] - sim.I[a] || a - b);
  }
  return out;
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
  const stats = createStats(D);
  let push = null, shotFollow = null, frontAt = -1e9, frontNode = -1, hudFocus = null;

  const mode = () => (globe.mode === 'flat' ? 'flat' : 'globe');
  const autoMode = () => (ctl ? ctl.mode : null);

  function newSim() {
    runSeedNode = st.seedNode >= 0 && st.seedNode < N ? st.seedNode : pickSeedNode(D, st.seed);
    sim = createSim({ D, net, disease: st.disease, policies: st.policies, seed: st.seed,
      seedNode: runSeedNode, startDayOfYear: st.startDayOfYear });
    cursor = 0; events = []; newestFirst = null; prev.fill(0);
    stats.reset(); frontNode = -1;
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
    const end = s && s.camEnd;
    push = end && Number.isFinite(end.alt)
      ? { a0: to.alt, a1: end.alt, t0: to.tilt || 0, t1: Number.isFinite(end.tilt) ? end.tilt : (to.tilt || 0), t: 0, dur: Math.max(3, (s.dur || 10) - (fl ? fl.dur : 0)) }
      : null;
    shotFollow = s && s.follow ? { ...s.follow } : null;
    frontAt = now; frontNode = shotFollow && shotFollow.kind === 'front' ? shotFollow.id : -1;
    hudFocus = (s && s.hud) || null;
    globe.setCamera(cam);
  }

  // the 'front' follow: fly on to the newest city reached
  function followFront() {
    if (!shotFollow || shotFollow.kind !== 'front' || fl || !newestFirst || !autoMode()) return;
    const i = newestFirst.to, n = D.nodes[i];
    if (!n || i === frontNode || now - frontAt < FRONT_GAP) return;
    frontNode = i;
    const R = Math.PI / 180, d = Math.acos(Math.max(-1, Math.min(1, Math.sin(cam.lat * R) * Math.sin(n.lat * R) + Math.cos(cam.lat * R) * Math.cos(n.lat * R) * Math.cos((cam.lon - n.lon) * R)))) / R;
    if (d < FRONT_MIN_DEG || d > 70) return;
    frontAt = now;
    fl = flight(cam, { ...cam, lat: n.lat, lon: n.lon }, { ...FLY, mode: mode() }); flT = 0;
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
      if (push && auto) {
        push.t = Math.min(push.dur, push.t + dt);
        const k = ease(push.t / push.dur);
        cam.alt = push.a0 + (push.a1 - push.a0) * k;
        cam.tilt = push.t0 + (push.t1 - push.t0) * k;
      }
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
      sim, growth: stats.growth(sim), exporter: stats.exporter(sim), tipped: stats.tipped(sim),
      curve: stats.curve(sim), hud: stats.hud(sim), regionStats: stats.regions(sim),
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
    stats.update(sim, events);
    for (let i = 0; i < N; i++) prev[i] = sim.I[i] / pop[i];
    followFront();
    updateCamera(dt);
    const hud = globe.hudOn ? { ...stats.hud(sim), series: sim.history.inc, curve: stats.curve(sim) } : null;
    if (globe.setHud && globe.hudOn && hudFocus !== hudShown) { hudShown = hudFocus; globe.setHud({ on: true, rect: hudBox(), focus: hudFocus }); }
    globe.update({ t, dt, sim, prev, events, mode: mode(), hud });
    if (ui) ui.update(sim, t * 1000);
    if (chart && t - chartAt >= CHART_EVERY) {
      chartAt = t;
      if (chart.setLog) chart.setLog(ui ? ui.chartLog : st.chartLog);
      chart.draw(sim.history, sim.active, st.disease);
    }
  }

  // the saver HUD box: the bottom-left of the clear band
  let hudBand = null, hudShown = null;
  const winOf = () => (typeof window !== 'undefined' ? window : null);
  function hudBox() {
    const w = winOf(), W = w ? w.innerWidth : 1280, H = w ? w.innerHeight : 800;
    return hudRect(hudBand, W, H, phoneView(w), hudFocus);
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
    setViewRect(r) { saverRect = r || null; layout(); if (globe.hudOn) { hudBand = saverRect; globe.setHud({ on: true, rect: hudBox(), focus: hudFocus }); } },
    // the on-canvas HUD (saver only): on, and the clear band it sits in
    setHud(o = {}) {
      if (!globe.setHud) return false;
      hudBand = o.band || saverRect || null; hudShown = hudFocus;
      return globe.setHud({ on: !!o.on, rect: o.on ? hudBox() : null, focus: hudFocus });
    },
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

// City labels for the largest current outbreaks. Returns frame(nowSec).
function bindLabels(box, app, globe, D) {
  const phone = matchMedia('(max-width:760px), (max-height:520px) and (pointer:coarse)').matches;
  const K = phone ? LABELS_PHONE : LABELS_DESKTOP;
  const pop = Float64Array.from(D.nodes, n => n.pop || 1);
  const pool = [];
  for (let k = 0; k < K; k++) {
    const e = document.createElement('div'); e.className = 'lbl fade';
    const name = document.createElement('span'), sub = document.createElement('small');
    e.append(name, sub); box.append(e); pool.push({ e, name, sub, i: -1 });
  }
  let setAt = -1e9, ids = [];
  return function frame(t) {
    const sim = app.sim;
    if (t - setAt >= LABEL_EVERY || t < setAt) { setAt = t; ids = topOutbreaks(sim, pop, K); }
    const r = app.occlusion() || { l: 0, r: innerWidth, t: 0, b: innerHeight };
    const placed = [];
    for (let k = 0; k < K; k++) {
      const L = pool[k], i = ids[k] ?? -1;
      let show = false;
      if (i >= 0) {
        const p = globe.project(i);
        const w = 110, h = 26, x = p.x + 6, y = p.y - 8;
        show = p.visible && x > r.l && x + w < r.r && y > r.t && y + h < r.b
          && !placed.some(q => Math.abs(q.x - x) < w && Math.abs(q.y - y) < h);
        if (show) {
          placed.push({ x, y });
          L.e.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
          if (L.i !== i) { L.i = i; L.name.textContent = D.nodes[i].name; }
          const txt = `${(sim.I[i] / pop[i] * 100).toFixed(sim.I[i] / pop[i] < 0.001 ? 3 : 2)} % infected`;
          if (L.txt !== txt) { L.txt = txt; L.sub.textContent = txt; }
        }
      }
      L.e.classList.toggle('fade', !show);
    }
  };
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
  const cityLabels = bindLabels(labels, app, globe, D);
  let tipT = 0, tip = null;
  const onTap = (x, y) => {
    const i = app.pick(x, y);
    if (tip) { tip.remove(); tip = null; }
    if (i < 0) return;
    const n = D.nodes[i], s = app.sim;
    tip = document.createElement('div');
    tip.className = 'tip';
    const W = innerWidth;
    tip.style.left = `${Math.min(x + 12, W - 220)}px`; tip.style.top = `${Math.max(8, y - 34)}px`;
    const pct = s.I[i] / n.pop * 100;
    const b = document.createElement('b'); b.textContent = `${n.name}, ${n.country} `;
    const sp = document.createElement('span'); sp.textContent = `· ${pct < 0.01 ? pct.toFixed(4) : pct.toFixed(2)} % infected now`;
    tip.append(b, sp);
    labels.append(tip);
    clearTimeout(tipT); tipT = setTimeout(() => { if (tip) { tip.remove(); tip = null; } }, 3500);
  };
  const unbind = bindPointer(canvas, app, onTap);

  let raf = 0, live = true;
  const loop = ms => { if (!live) return; raf = requestAnimationFrame(loop); app.frame(ms / 1000); cityLabels(ms / 1000); };
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
