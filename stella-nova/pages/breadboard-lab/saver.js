// ============================================================================
//  BREADBOARD LAB  ·  saver.js — the screensaver director (window.snSaver)
// ----------------------------------------------------------------------------
//  installSaver(ctx) -> { enter(opts), exit(), cut(), debug() }. main.js puts
//  it on window.snSaver (lib/screensaver.js protocol). enter(opts) with
//  { calm, seconds, seed, label } hides the panels, loads a seeded reel of
//  example benches and runs each one live, with a calm camera. It returns
//  { canvas, warmupMs } with the page canvas (#gl, in the document).
//
//  REEL. A seeded shuffle of REEL; the first bench is the chaser or the
//  shift-register scanner (CONTRACT 9). Each bench plays two or three
//  shots of 5-12 s. DRIVE turns the live knobs of some benches (a pot that
//  sweeps, a stick that circles, a temperature that rises and falls), and
//  the example's own script runs at its sim times, so every bench moves.
//
//  SHOTS (shotPose): 'bench' frames the whole bench; 'top' looks down at
//  the boards; 'active' follows the busiest part (activePart: the brightest
//  LED, a spinning motor, a sounding buzzer, the LCD), gliding to it as it
//  changes. Moves are a 1.8 s glide, then a slow yaw drift and push-in.
//
//  FRAMING. lib/saver-clear.js plateBand(h) gives the clear band between
//  the plate texts and the visible column width (100 vw or the 9:16
//  column). fitDistance sizes the camera distance so the subject fits the
//  band height and the column width; the camera view offset moves the
//  image centre into the band. tests.mjs checks both 16:9 and 9:16 frames.
//
//  The saver writes no autosave: Storage.setItem ignores the bblab:
//  autosave and layout keys while it runs. enter() keeps the user's bench
//  (store.snapshot: the document with undo and redo, the camera, the flow
//  dots, the run state and speed); exit() gives all of it back before it
//  lifts the guard, so the next autosave writes the user's bench.
//
//  GREP MAP
//    REEL / DRIVE / EQ ...... the benches, their knob motions, the relations
//    mulberry / shuffle ..... the seeded random source
//    docBox / partBox ....... boxes from the document (pure, node-tested)
//    fitDistance / shotPose . framing maths (pure, node-tested)
//    activePart ............. the busiest part in a frame
//    installSaver ........... enter / exit; loadBench, camera loop, plate
//    saved .................. the user's bench while the saver runs
// ============================================================================
import { plateBand } from '../../lib/saver-clear.js';

export const REEL = ['chaser-4017', 'uno-595', 'blink-555', 'uno-7seg', 'esp32-traffic', 'uno-lcd-thermo',
  'thermostat', 'mosfet-pwm', 'uno-servo', 'nano-joystick', 'relay-lamp', 'first-led'];
export const FIRST = ['chaser-4017', 'uno-595'];

const TAU = Math.PI * 2;
// live knob motions per bench: (t seconds) -> [[partLabel, key, value], ...]
export const DRIVE = {
  'uno-servo': t => [['Pot', 'pos', 0.5 + 0.4 * Math.sin(TAU * t / 7)]],
  'nano-joystick': t => [['Stick', 'x', 0.5 + 0.45 * Math.cos(TAU * t / 6)], ['Stick', 'y', 0.5 + 0.45 * Math.sin(TAU * t / 6)]],
  'thermostat': t => [['NTC', 'tempC', 31 + 9 * Math.sin(TAU * t / 12)]],
  'mosfet-pwm': t => [['Duty', 'pos', 0.5 + 0.35 * Math.sin(TAU * t / 9)]],
  'uno-lcd-thermo': t => [['NTC', 'tempC', 24 + 6 * Math.sin(TAU * t / 10)]],
  'relay-lamp': t => [['S1', 'pos', Math.floor(t / 4) % 2 ? 0 : 1]],
};
export const EQ = {
  'first-led': ['I = (Vs − Vf) / R'],
  'blink-555': ['f = 1.44 / ((R1 + 2·R2) · C)'],
  'chaser-4017': ['f = 1.44 / ((R1 + 2·R2) · C)', 'one of Q0 … Q9 high per clock'],
  'uno-595': ['shiftOut: 8 clock edges, then one latch edge'],
  'uno-7seg': ['segments = DIGITS[n], bits a … g'],
  'esp32-traffic': ['V_high ≈ 3.3 V − I · 30 Ω'],
  'uno-lcd-thermo': ['1/T = 1/T₂₅ + ln(R/R₂₅) / β'],
  'thermostat': ['V+ = 5 V · R1 / (R1 + R_NTC(T))', 'fan on when V+ > V_set'],
  'mosfet-pwm': ['duty ≈ (R1 + Ra) / (R1 + R_pot)'],
  'uno-servo': ['angle = map(analogRead(A0), 0, 1023, 0, 180)'],
  'nano-joystick': ['brightness = |raw − 512| / 2'],
  'relay-lamp': ['coil pulls in above 3.75 V, drops out below 1.5 V'],
};

export function mulberry(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function shuffle(a, rnd) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// The reel order for a seed: one of FIRST, then the rest shuffled.
export function reelOrder(seed) {
  const rnd = mulberry(seed);
  const first = FIRST[Math.floor(rnd() * FIRST.length)];
  return [first, ...shuffle(REEL.filter(k => k !== first), rnd)];
}

// The shot list of one bench: 2 or 3 shots, never the same kind twice in a row.
export function shotsFor(rnd) {
  const n = rnd() < 0.5 ? 2 : 3;
  const out = [];
  for (let i = 0; i < n; i++) {
    const kinds = ['bench', 'active', 'active', 'top'].filter(k => k !== out[i - 1] && !(i === 0 && k === 'top'));
    out.push(kinds[Math.floor(rnd() * kinds.length)]);
  }
  return out;
}

// ── boxes from the document (world mm) ─────────────────────────────────────
const PROBE_SIZE = { dmm: [84, 34, 160], scope: [190, 120, 100], logic: [56, 13, 34] };
export function partBox(doc, part, def, geo) {
  const pins = geo.partPinsWorld(doc, part, def);
  if (!pins.length) return null;
  const xs = pins.map(p => p.x), zs = pins.map(p => p.z), on = !!(part.place && part.place.on);
  const pad = on ? 4 : 14;
  return { min: [Math.min(...xs) - pad, 0, Math.min(...zs) - pad], max: [Math.max(...xs) + pad, on ? 22 : 30, Math.max(...zs) + pad] };
}
export function docBox(doc, registry, geo, { probes = false } = {}) {
  const min = [Infinity, 0, Infinity], max = [-Infinity, 12, -Infinity];
  const add = (x, y, z) => { min[0] = Math.min(min[0], x); max[0] = Math.max(max[0], x); max[1] = Math.max(max[1], y); min[2] = Math.min(min[2], z); max[2] = Math.max(max[2], z); };
  for (const b of doc.boards || []) {
    const [w, , d] = geo.BOARD_TYPES[b.type].size;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const p = geo.boardToWorld(b, sx * w / 2, sz * d / 2); add(p.x, 12, p.z); }
  }
  for (const p of doc.parts || []) {
    let def = null;
    try { def = registry.get(p.def); } catch (e) { def = null; }
    if (!def) continue;
    const bx = partBox(doc, p, def, geo);
    if (bx) { add(bx.min[0], bx.max[1], bx.min[2]); add(bx.max[0], bx.max[1], bx.max[2]); }
  }
  if (probes) for (const m of doc.probes || []) { const s = PROBE_SIZE[m.type] || [60, 20, 60]; add(m.place.x - s[0] / 2, s[1], m.place.z - s[2]); add(m.place.x + s[0] / 2, s[1], m.place.z); }
  if (!Number.isFinite(min[0])) return { min: [-90, 0, -40], max: [90, 12, 40] };
  return { min, max };
}

// ── framing ────────────────────────────────────────────────────────────────
// frame = { w, h, fov (deg, vertical), band: { t, b, w } | null }
export function clearArea(frame) {
  const { w, h, band } = frame;
  if (!band) return { top: 0, bottom: h, left: 0, right: w, bandH: h, colW: w };
  const colW = Math.min(w, band.w || w);
  return { top: band.t, bottom: h - band.b, left: (w - colW) / 2, right: (w + colW) / 2, bandH: Math.max(1, h - band.t - band.b), colW };
}
// camera distance at which a sphere of `radius` fills `fill` of the clear area
export function fitDistance(radius, frame, fill = 0.8) {
  const { h, fov } = frame;
  const A = clearArea(frame);
  const th = Math.tan(fov * Math.PI / 360);
  const half = fill * th * Math.min(A.bandH, A.colW) / h;
  return radius / Math.sin(Math.atan(half));
}
// the view offset (px) that puts the image centre in the middle of the band
export function bandOffset(frame) {
  const A = clearArea(frame);
  return { x: frame.w / 2 - (A.left + A.right) / 2, y: frame.h / 2 - (A.top + A.bottom) / 2 };
}
// rig state for a shot of `box`: { target, dist, yaw, pitch }
export function shotPose(kind, box, frame, yaw, pitch) {
  const c = [0, 1, 2].map(i => (box.min[i] + box.max[i]) / 2);
  const ext = [0, 1, 2].map(i => Math.max(1, box.max[i] - box.min[i]));
  const radius = Math.hypot(ext[0], ext[1], ext[2]) / 2;
  const fill = kind === 'active' ? 0.6 : 0.86;
  const p = kind === 'top' ? 1.32 : pitch;
  return { target: [c[0], kind === 'top' ? 0 : c[1] * 0.5, c[2]], dist: fitDistance(radius, frame, fill), yaw: kind === 'top' ? yaw * 0.3 : yaw, pitch: p };
}
export function posOf(s) {
  return [s.target[0] + s.dist * Math.cos(s.pitch) * Math.sin(s.yaw), s.target[1] + s.dist * Math.sin(s.pitch), s.target[2] + s.dist * Math.cos(s.pitch) * Math.cos(s.yaw)];
}

// ── the busiest part ───────────────────────────────────────────────────────
export function activePart(frame, doc, registry) {
  let best = null, score = 0.05;
  const parts = (frame && frame.parts) || {};
  for (const p of doc.parts || []) {
    const pf = parts[p.id];
    const v = pf && pf.vis;
    if (!v) continue;
    let s = 0;
    if (typeof v.b === 'number') s = Math.max(s, v.b);
    if (v.leds) { const vals = Object.values(v.leds); s = Math.max(s, Math.min(1.2, vals.reduce((a, b) => a + b, 0) / 3)); }
    if (v.omega) s = Math.max(s, Math.min(1.3, Math.abs(v.omega) / 400));
    if (v.freq) s = Math.max(s, 1.1);
    if (v.rows) s = Math.max(s, 1.25);
    if (typeof v.angle === 'number' && !v.omega) s = Math.max(s, 1.15);
    let def = null;
    try { def = registry.get(p.def); } catch (e) { def = null; }
    if (def && def.category === 'mcu') s *= 0.5;
    if (s > score) { score = s; best = p.id; }
  }
  return best;
}

// ── the director ───────────────────────────────────────────────────────────
export function installSaver(ctx) {
  const { store, view, realView, sim, bus, registry, normalizeDoc, loadExample, geo } = ctx;
  let on = false, rnd = Math.random, calm = 0.7, label = () => {}, seconds = 60;
  // the user's bench while the saver borrows the page: the document with
  // its undo history, the camera, the flow dots and the run state
  let saved = null;
  let raf = null, timers = [], offs = [], styleEl = null, restoreSet = null;
  let order = [], bench = -1, shots = [], shotI = 0, shotKind = 'bench', shotEnd = 0, glide = null;
  let frame = null, frameAt = 0, fresh = false, scriptI = 0, meta = null, driveAt = 0, band = null, bandAt = 0;
  let activeId = null, activeTarget = null, lastLabelAt = 0, cuts = 0;

  const canvas = () => view.canvas || document.getElementById('gl');
  const rig = () => (realView ? realView.rig : null);
  const frameInfo = () => {
    const c = canvas();
    const w = (c && c.clientWidth) || innerWidth, h = (c && c.clientHeight) || innerHeight;
    const fov = (rig() && rig().state.fov) || 38;
    return { w, h, fov, band };
  };
  const later = (ms, fn) => { const id = setTimeout(fn, ms); timers.push(id); return id; };
  const labelOf = id => { const p = (store.doc.parts || []).find(x => x.id === id); return p ? (p.label || p.def) : id; };
  const partByLabel = l => (store.doc.parts || []).find(p => p.label === l);

  function readBand() {
    try { band = plateBand(frameInfo().h); } catch (e) { band = null; }
    const cam = realView && realView.camera;
    if (!cam) return;
    const f = frameInfo(), off = bandOffset(f);
    if (Math.abs(off.x) < 0.5 && Math.abs(off.y) < 0.5) { if (cam.view && cam.view.enabled) cam.clearViewOffset(); }
    else cam.setViewOffset(f.w, f.h, off.x, off.y, f.w, f.h);
  }

  function boxFor(kind) {
    if (kind === 'active' && activeId) {
      const p = (store.doc.parts || []).find(x => x.id === activeId);
      let def = null;
      try { def = p && registry.get(p.def); } catch (e) { def = null; }
      const bx = p && def ? partBox(store.doc, p, def, geo) : null;
      if (bx) {
        // a little context around the part: at least 70 mm across
        const c = [0, 2].map(i => (bx.min[i] + bx.max[i]) / 2);
        for (const [k, i] of [[0, 0], [1, 2]]) { const half = Math.max(35, (bx.max[i] - bx.min[i]) / 2); bx.min[i] = c[k] - half; bx.max[i] = c[k] + half; }
        return bx;
      }
    }
    return docBox(store.doc, registry, geo);
  }

  function startShot(kind, hard) {
    shotKind = kind;
    const R = rig();
    if (!R) return;
    const yaw = (rnd() - 0.5) * 1.1, pitch = 0.82 + rnd() * 0.25;
    if (kind === 'active') activeId = activePart(frame, store.doc, registry) || activeId;
    const pose = shotPose(kind, boxFor(kind), frameInfo(), yaw, pitch);
    activeTarget = pose.target.slice();
    const s = R.state;
    const from = { target: s.target.slice(), dist: s.dist, yaw: s.yaw, pitch: s.pitch };
    glide = { from: hard ? null : from, to: pose, t0: performance.now(), ms: hard ? 0 : 1800 + 800 * calm, drift: (rnd() < 0.5 ? -1 : 1) * (0.02 + 0.02 * (1 - calm)), push: 0.012 * (1 - 0.5 * calm) };
    const hold = Math.max(5, Math.min(12, seconds / 8)) * 1000 * (0.85 + 0.3 * rnd());
    shotEnd = performance.now() + hold;
    cuts++;
  }

  function applyCamera(now, dt) {
    const R = rig();
    if (!R || !glide) return;
    const s = R.state, g = glide;
    if (shotKind === 'active' && frame) {
      const id = activePart(frame, store.doc, registry);
      if (id && id !== activeId) activeId = id;
      const bx = boxFor('active');
      const c = [(bx.min[0] + bx.max[0]) / 2, 0, (bx.min[2] + bx.max[2]) / 2];
      const k = Math.min(1, dt * 0.8);
      for (const i of [0, 2]) g.to.target[i] += (c[i] - g.to.target[i]) * k;
    }
    g.to.yaw += g.drift * dt;
    g.to.dist *= 1 - g.push * dt;
    const u = g.from && g.ms > 0 ? Math.min(1, (now - g.t0) / g.ms) : 1;
    const e = u * u * (3 - 2 * u);
    const F = g.from || g.to;
    for (let i = 0; i < 3; i++) s.target[i] = F.target[i] + (g.to.target[i] - F.target[i]) * e;
    s.dist = Math.exp(Math.log(F.dist) + (Math.log(g.to.dist) - Math.log(F.dist)) * e);
    s.yaw = F.yaw + (g.to.yaw - F.yaw) * e;
    s.pitch = F.pitch + (g.to.pitch - F.pitch) * e;
    if (performance.now() - frameAt > 120) realView.render();
  }

  function plate(force) {
    if (!meta) return;
    const lines = [];
    const id = activeId || activePart(frame, store.doc, registry);
    const pf = id && frame && frame.parts ? frame.parts[id] : null;
    if (pf) {
      const v = pf.vis || {};
      const name = labelOf(id);
      if (v.rows) lines.push(`${name}: "${String(v.rows[0] || '').trim()}"`);
      else if (v.omega) lines.push(`${name}: ${Math.round(Math.abs(v.omega) * 60 / TAU)} rpm`);
      else if (v.freq) lines.push(`${name}: ${Math.round(v.freq)} Hz`);
      else if (typeof v.angle === 'number') lines.push(`${name}: ${v.angle.toFixed(0)}°`);
      else if (Math.abs(pf.i) > 1e-5) lines.push(`${name}: ${(Math.abs(pf.i) * 1e3).toFixed(1)} mA`);
    }
    if (frame) lines.push(`t = ${frame.t.toFixed(1)} s of circuit time`);
    label({ title: meta.title, sub: meta.blurb, lines, eq: EQ[meta.key] || [] });
    void force;
  }

  async function loadBench() {
    bench = (bench + 1) % order.length;
    const key = order[bench];
    let ex;
    try { ex = await loadExample(key); } catch (e) { later(500, loadBench); return; }
    if (!on) return;
    const c = canvas();
    if (c) c.style.opacity = '0';
    await new Promise(r => later(500, r));
    if (!on) return;
    const { doc } = normalizeDoc(ex.doc, { registry });
    delete doc.view;
    meta = ex.meta;
    scriptI = 0; fresh = true; driveAt = 0; activeId = null; frame = null;
    store.load(doc);
    sim.setSpeed(1);
    sim.start();
    shots = shotsFor(rnd); shotI = 0;
    startShot(shots[0], true);
    plate(true);
    later(350, () => { if (c) c.style.opacity = '1'; });
  }

  function step(now) {
    if (!on) return;
    raf = requestAnimationFrame(step);
    const dt = Math.min(0.1, (now - (step.last || now)) / 1000);
    step.last = now;
    if (now - bandAt > 500) { bandAt = now; readBand(); }
    applyCamera(now, dt);
    if (now - lastLabelAt > 1000) { lastLabelAt = now; plate(false); }
    if (now > shotEnd && glide) {
      shotI++;
      if (shotI < shots.length) startShot(shots[shotI], false);
      else { glide = null; loadBench(); }
    }
  }

  function onFrame(f) {
    // frames of the previous bench can arrive after store.load: wait for
    // the new engine, which starts at t = 0
    if (fresh) { if (f.t > 0.5) return; fresh = false; }
    frame = f; frameAt = performance.now();
    if (!on || !meta) return;
    const t = f.t;
    const script = meta.script || [];
    while (scriptI < script.length && script[scriptI].at <= t) {
      const s = script[scriptI++];
      if ((store.doc.parts || []).some(p => p.id === s.part)) store.apply({ op: 'set', id: s.part, path: 'params.' + s.key, value: s.value }, { history: false });
    }
    const drive = DRIVE[meta.key];
    if (drive && t - driveAt >= 0.4) {
      driveAt = t;
      for (const [lab, key, value] of drive(t)) {
        const p = partByLabel(lab);
        if (p) store.apply({ op: 'set', id: p.id, path: 'params.' + key, value: typeof value === 'number' ? +value.toFixed(3) : value }, { history: false });
      }
    }
  }

  // A real Storage gets the guard on its prototype (an own property on a
  // Storage object would become a stored item); any other storage object
  // (a test double) gets it on itself.
  function guardStorage() {
    if (restoreSet) return;
    let ls = null;
    try { ls = globalThis.localStorage; } catch (e) { ls = null; }
    if (!ls) return;
    const proto = typeof Storage !== 'undefined' && ls instanceof Storage;
    const host = proto ? Storage.prototype : ls;
    const had = Object.prototype.hasOwnProperty.call(host, 'setItem');
    const orig = host.setItem;
    host.setItem = function (k, v) { if (/^bblab:(autosave|ui)$/.test(String(k))) return undefined; return orig.call(this, k, v); };
    restoreSet = () => { if (had) host.setItem = orig; else delete host.setItem; restoreSet = null; };
  }

  const api = {
    enter(o = {}) {
      if (on) return { canvas: canvas(), warmupMs: 1500 };
      on = true;
      calm = Math.max(0, Math.min(1, o.calm ?? 0.7));
      seconds = o.seconds || 60;
      rnd = mulberry((o.seed >>> 0) || ((Math.random() * 2 ** 32) >>> 0));
      label = typeof o.label === 'function' ? o.label : () => {};
      if (ctx.setSaverOn) ctx.setSaverOn(true);
      saved = {
        snap: store.snapshot ? store.snapshot() : { doc: store.doc },
        cam: (() => { try { return realView ? realView.getCamera() : null; } catch (e) { return null; } })(),
        flow: (() => { try { return realView && realView.getFlow ? realView.getFlow() : null; } catch (e) { return null; } })(),
        run: ctx.runState ? ctx.runState() : null,
      };
      guardStorage();
      styleEl = document.createElement('style');
      styleEl.textContent = '#bar,#leftCol,#rightCol,#instrDock,#status,#toasts,#tip,#dock,#sheet,#nogl,.menu,#sn-wishlist-chip{display:none!important}#stage{inset:0!important;bottom:0!important}#gl{cursor:none;transition:opacity .5s ease}';
      document.head.appendChild(styleEl);
      offs.push(bus.on('sim:frame', onFrame));
      try { if (realView) realView.setFlow(true); } catch (e) { /* no flow */ }
      try { if (realView && realView.setControlRims) realView.setControlRims(false); } catch (e) { /* no rims */ }
      order = reelOrder(rnd() * 2 ** 32);
      bench = -1; cuts = 0;
      readBand();
      loadBench();
      raf = requestAnimationFrame(step);
      return { canvas: canvas(), warmupMs: 1500 };
    },
    exit() {
      if (!on) return;
      on = false;
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      for (const t of timers) clearTimeout(t);
      timers = [];
      for (const off of offs) { try { off(); } catch (e) { /* gone */ } }
      offs = [];
      if (styleEl) styleEl.remove();
      styleEl = null;
      const c = canvas();
      if (c) c.style.opacity = '';
      try { if (realView && realView.camera.view && realView.camera.view.enabled) realView.camera.clearViewOffset(); } catch (e) { /* gone */ }
      // give the bench back while the storage guard still holds: the load
      // reschedules the autosave, and that timer then writes the user's doc
      if (saved) {
        const sv = saved;
        saved = null;
        if (store.restore) store.restore(sv.snap); else store.load(sv.snap.doc);
        try { if (realView && sv.cam) realView.cameraTo(sv.cam, 0); } catch (e) { /* gone */ }
        try { if (realView && sv.flow !== null) realView.setFlow(sv.flow); } catch (e) { /* no flow */ }
        try { if (realView && realView.setControlRims) realView.setControlRims(true); } catch (e) { /* no rims */ }
        if (sv.run) {
          sim.setSpeed(sv.run.speed || 1);
          if (sv.run.running) sim.start(); else sim.pause();
        }
      }
      meta = null; frame = null;
      if (restoreSet) restoreSet();
      if (ctx.setSaverOn) ctx.setSaverOn(false);
      label(null);
    },
    // force the next shot (for checks by hand in the console)
    cut() { shotEnd = 0; },
    debug() { return { on, bench: order[bench], shot: shotKind, active: activeId, cuts, band, t: frame && frame.t }; },
  };
  return api;
}
