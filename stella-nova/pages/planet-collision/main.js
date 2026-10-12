// ============================================================================
//  PLANET COLLISION  ·  main.js — boot, the run, the frame loop, the bar,
//  the aim panel and the phone dock
// ----------------------------------------------------------------------------
//  ONE RUN (fn startRun): build.js buildScenario -> sim.upload ->
//  ren.attach -> the relax (RELAX_STEPS damped steps, RELAX_PER_FRAME a
//  frame, drawn as it settles) -> sim.launch -> the run. The solver and the
//  renderer are made once, at the profile's particle cap (budget.js).
//
//  FRAME (fn frame): steps of the solver, then one render, then the
//  preview arc on the 2D overlay. Steps per frame are 2 x the speed (¼ to
//  4; ¼ and ½ are slow motion, kept in S.acc as a fraction), under the
//  governor's cap. Every STATS_EVERY frames an async sim.stats() (fn
//  onStats) feeds the numbers, the camera goal and the events: first
//  contact -> an impact flash, the atmospheres and the body shadows fade
//  (they are drawn, not simulated). After contact, every OUTCOME_MS a
//  readback goes to analysis.js outcome() (fn analyse): the largest body,
//  the disk, the escaping mass and the 99th percentile temperature.
//
//  GOVERNOR. Every 10 frames: a smoothed frame time over 24 ms cuts the cap
//  on the steps per frame by a quarter, one under 17 ms raises it by one
//  (fn govern). The sim time per frame also shrinks by itself at the
//  impact (the CFL time step).
//
//  CAMERA (fn frameOf). view.js frames the bodies (Follow on), the user
//  orbits and zooms. fn clearBand gives the screen band that no GUI covers
//  (the saver plate, or on a phone the caption and the dock or the open
//  sheet); fn bandView moves the eye back and pans it so the subject
//  centres in that band. A director (S.dir, saver.js) can set the shot.
//
//  AIM (fn aimScenario). The aim panel builds a scenario from two bodies,
//  the angle (b = sin theta), the speed in v_esc, the target spin and the
//  impactor make-up; each change restarts the run (debounced) and the link
//  gets ?aim=. While the panel is open, arc.js draws the point-mass path.
//
//  SAVER. saver.js installSaver sets window.snSaver; its director is S.dir.
//  For the tests: window.__pc = { S, startRun, frameOf, setSpeed, SPEEDS }.
//
//  grep -n targets
//    boot ............ "async function boot"
//    one run ......... "function startRun"
//    frame loop ...... "function frame("
//    stats + events .. "function onStats", "function analyse"
//    camera .......... "function frameOf", "function clearBand", "function bandView"
//    arc overlay ..... "function drawArc"
//    aim panel ....... "function buildAim", "function aimScenario", "function drawDial"
//    caption ......... "function caption", "function numbers"
//    bar + dock ...... "function buildUI", "function setSpeed"
//    camera input .... "function bindPointer"
// ============================================================================
import { SphGPU, loadSphCode } from './engine.js';
import { buildScenario } from './build.js';
import { makeParams } from './sph.js';
import { PRESETS, presetByKey, randomScenario, composition, VARIANTS, titleOf } from './scenarios.js';
import { pickProfile, renderBudget } from './budget.js';
import { Renderer, loadRenderCode, loadMaps, defaultFrame, norm, cross, sub } from './render.js';
import { makeView, frameTarget, stepView, eyeOf } from './view.js';
import { UNIT, SOURCES, BODIES } from './data.js';
import { outcome, M_MOON } from './analysis.js';
import { previewArc } from './arc.js';
import { installSaver } from './saver.js';

const RELAX_STEPS = 200, RELAX_PER_FRAME = 20, STATS_EVERY = 6, OUTCOME_MS = 1500;
export const SPEEDS = [0.25, 0.5, 1, 2, 4];
const $ = id => document.getElementById(id);
const touch = matchMedia('(pointer: coarse)').matches;
const phone = touch && Math.min(screen.width, screen.height) < 600;
const PHONE_Q = matchMedia('(max-width: 768px), (max-height: 500px) and (pointer: coarse)');

export const S = {
  dev: null, ctx: null, sim: null, ren: null, prof: pickProfile({ phone, touch }),
  sc: null, setup: null, seed: 1, phase: 'idle', relaxDone: 0,
  paused: false, speed: 2, acc: 0, cap: 8, dtAvg: 16, lastNow: 0, frameNo: 0,
  stats: null, contact: null, peak: { P: 0, melt: 0, vap: 0, esc: 0, T99: 0 },
  out: null, outAt: 0, outBusy: false,
  view: makeView(), f: defaultFrame(), mode: 0, cut: false, follow: true,
  arc: null, aimOpen: false, dir: null, now: 0,
};

async function boot() {
  buildUI();
  if (!navigator.gpu) return fail(new Error('navigator.gpu is missing'));
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return fail(new Error('no GPU adapter'));
  S.dev = await adapter.requestDevice();
  S.dev.lost.then(i => { if (i.reason !== 'destroyed') fail(new Error('GPU device lost: ' + i.message)); });
  S.dev.addEventListener('uncapturederror', e => console.error('WebGPU:', e.error.message));
  const canvas = $('gpu');
  S.ctx = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  S.ctx.configure({ device: S.dev, format, alphaMode: 'opaque' });
  const [sphCode, rcode] = await Promise.all([loadSphCode(), loadRenderCode()]);
  S.sim = await SphGPU.create(S.dev, S.prof.N, sphCode);
  S.ren = new Renderer(S.dev, S.ctx, format, rcode);
  loadMaps().then(b => S.ren && S.ren.setMaps(b)).catch(e => console.warn('maps:', e.message));
  resize(); addEventListener('resize', resize);
  bindPointer(canvas);
  addEventListener('pagehide', release);
  window.__pc = { S, startRun, frameOf, setSpeed, SPEEDS };
  installSaver({ S, startRun, setSpeed });
  const q = new URLSearchParams(location.search);
  const aim = q.get('aim') && aimFromLink(q.get('aim'));
  if (aim) { setAim(aim); startRun(aimScenario(), 1); }
  else if (q.has('seed')) startRun(randomScenario(+q.get('seed') | 0), +q.get('seed') | 0);
  else startRun(presetByKey(q.get('run') || 'moon-earth'), 1);
  requestAnimationFrame(frame);
}
function fail(e) {
  console.error(e);
  $('nogpu').hidden = false;
  $('nogpuWhy').textContent = String(e && e.message || e);
}
function release() {
  if (S.sim) S.sim.destroy();
  if (S.ren) S.ren.destroy();
  if (S.dev) S.dev.destroy();
  S.sim = S.ren = S.dev = null;
}
function resize() {
  if (!S.ren) return;
  const c = $('gpu'), b = renderBudget({ cssW: innerWidth, cssH: innerHeight, dpr: devicePixelRatio, touch, phone });
  c.width = b.w; c.height = b.h;
  S.f.frags = b.frags; S.f.smooth = b.smooth;
  S.ren.resize(b.w, b.h);
  const a = $('arc'); a.width = Math.round(innerWidth * Math.min(2, devicePixelRatio || 1)); a.height = Math.round(innerHeight * Math.min(2, devicePixelRatio || 1));
}

// ── one run ─────────────────────────────────────────────────────────────
// sc: a scenario (scenarios.js); seed: the particle placement seed.
// o.N: fewer particles than the profile cap (the saver).
export function startRun(sc, seed = 1, o = {}) {
  S.sc = sc; S.seed = seed;
  S.setup = buildScenario(sc, Math.min(S.prof.N, o.N || S.prof.N), seed);
  S.prm = makeParams(S.setup, { KG: S.prof.KG });
  S.sim.upload(S.setup, S.prm);
  S.ren.attach(S.sim, S.setup);
  S.phase = 'relax'; S.relaxDone = 0; S.acc = 0;
  S.stats = null; S.contact = null; S.peak = { P: 0, melt: 0, vap: 0, esc: 0, T99: 0 };
  S.out = null; S.outAt = 0;
  S.arc = previewArc(S.setup);
  S.f.flashes = [];
  S.f.bodies = [0, 1, 2, 3].map(() => ({ atm: 1, shadow: 1 }));
  const g = frameTarget(bodiesNow(), null, S.f.fov, innerWidth / innerHeight);
  S.view.target = g.target.slice(); S.view.dist = g.dist;
  caption();
  if (o.link === false) return;
  const sel = $('preset');
  sel.value = PRESETS.some(p => p.key === sc.key) ? sc.key : '';
  const u = new URL(location.href);
  for (const k of ['run', 'seed', 'aim']) u.searchParams.delete(k);
  if (sc.key.startsWith('random-')) u.searchParams.set('seed', String(seed));
  else if (sc.key === 'aim') u.searchParams.set('aim', aimLink());
  else u.searchParams.set('run', sc.key);
  history.replaceState(null, '', u);
}
function bodiesNow() {
  const st = S.stats, B = S.setup.bodies;
  return B.map((b, i) => ({ c: st && st.com[i] ? st.com[i] : b.X, R: b.R }));
}

// ── the frame loop ──────────────────────────────────────────────────────
function frame(now) {
  requestAnimationFrame(frame);
  if (!S.sim || !S.ren) return;
  const dt = S.lastNow ? Math.min(0.1, (now - S.lastNow) / 1000) : 1 / 60;
  S.lastNow = now; S.now = now; S.frameNo++;
  govern(dt * 1000);
  if (S.dir) S.dir.tick(now, dt);
  let steps = 0;
  if (S.phase === 'relax') {
    S.sim.relaxSteps(RELAX_PER_FRAME); S.relaxDone += RELAX_PER_FRAME;
    if (!S.dir) { $('busy').hidden = false; $('busyBar').style.width = (100 * S.relaxDone / RELAX_STEPS).toFixed(0) + '%'; }
    if (S.relaxDone >= RELAX_STEPS) { S.sim.launch(); S.phase = 'run'; $('busy').hidden = true; }
  } else if (S.phase === 'run' && !S.paused) {
    S.acc = Math.min(S.acc + 2 * S.speed, S.cap + 1);
    steps = Math.min(S.cap, Math.floor(S.acc));
    S.acc -= steps;
    if (steps) S.sim.step(steps);
  }
  if (S.frameNo % STATS_EVERY === 0 && S.phase === 'run') S.sim.stats().then(st => st && S.sim && onStats(st, now));
  if (S.contact && !S.outBusy && now - S.outAt > OUTCOME_MS && S.phase === 'run') analyse(now);
  const f = frameOf(now, dt, steps);
  S.ren.render(f);
  drawArc();
}
function govern(ms) {
  S.dtAvg += (ms - S.dtAvg) * 0.1;
  if (S.frameNo % 10) return;
  if (S.dtAvg > 24 && S.cap > 1) S.cap = Math.max(1, Math.floor(S.cap * 0.75));
  else if (S.dtAvg < 17 && S.cap < 8) S.cap++;
}

// The screen band (CSS px from the top t and from the bottom b) that no
// GUI covers: the saver plate, or on a phone the caption and the dock or
// the open sheet. Desktop: the full frame.
export function clearBand() {
  if (S.dir && S.dir.band) return S.dir.band();
  if (!PHONE_Q.matches) return { t: 0, b: 0 };
  const H = innerHeight, cap = $('caption').getBoundingClientRect ? $('caption').getBoundingClientRect() : null;
  let t = cap && cap.bottom > 0 ? cap.bottom + 6 : 0, b = 0;
  for (const id of ['dock', 'aim', 'info']) {
    const e = $(id); if (!e || e.hidden || !e.getBoundingClientRect) continue;
    const r = e.getBoundingClientRect(); if (r.height > 0 && r.top > H * 0.25) b = Math.max(b, H - r.top + 6);
  }
  const room = 0.3 * H;
  if (H - t - b < room) { const k = (H - room) / (t + b); t *= k; b *= k; }
  return { t, b };
}
// eye and target for view v, fitted to the band (zoom back by H / band
// height, then pan along the camera's up so the target sits at the band
// centre).
export function bandView(v, band, fov) {
  const H = innerHeight, hb = Math.max(0.3 * H, H - band.t - band.b);
  const vv = Object.assign({}, v, { dist: v.dist * Math.min(2.5, H / hb) });
  let eye = eyeOf(vv), target = vv.target.slice();
  const fw = norm(sub(target, eye)), right = norm(cross(fw, [0, 0, 1])), up = cross(right, fw);
  const D = Math.hypot(...sub(target, eye)), s = (band.t - band.b) / 2 * 2 * D * Math.tan(fov / 2) / H;
  eye = eye.map((x, k) => x + up[k] * s); target = target.map((x, k) => x + up[k] * s);
  return { eye, target };
}
// The frame description for render.js (camera, events, display state).
export function frameOf(now, dt, steps) {
  const f = S.f, aspect = innerWidth / innerHeight;
  const sinceH = S.contact && S.stats ? (S.stats.t - S.contact.simT) * UNIT.T / 3600 : null;
  const goal = frameTarget(bodiesNow(), sinceH, f.fov, aspect);
  if (S.dir && S.dir.goal) S.dir.goal(goal);
  if (S.follow || S.dir) stepView(S.view, goal, dt, S.contact ? 1.2 : 0.6);
  const v = S.dir && S.dir.view ? S.dir.view(S.view, now) : S.view;
  const bv = bandView(v, clearBand(), f.fov);
  f.eye = bv.eye; f.target = bv.target; f.time = now / 1000;
  f.sun = S.dir && S.dir.sun ? S.dir.sun : norm([1, 0.25, 0.3]);
  f.mode = S.dir && S.dir.mode != null ? S.dir.mode : S.mode;
  const cutOn = S.dir && S.dir.cut != null ? S.dir.cut : S.cut;
  f.cut = { on: cutOn, n: norm([f.eye[0] - f.target[0], f.eye[1] - f.target[1], f.eye[2] - f.target[2]]), d: 0 };
  f.cut.d = f.cut.n[0] * f.target[0] + f.cut.n[1] * f.target[1] + f.cut.n[2] * f.target[2];
  f.streakT = S.stats && steps ? S.stats.dt * steps : 0;
  f.exposure = S.dir && S.dir.exposure != null ? S.dir.exposure : 1;
  // events: the flash decays, atmospheres and shadows fade after contact
  if (S.contact) {
    const s = (now - S.contact.wall) / 1000;
    for (let b = 0; b < 2; b++) f.bodies[b] = { atm: Math.max(0, 1 - s / 4), shadow: Math.max(0, 1 - s / 0.6) };
    if (f.flashes[0]) f.flashes[0].I = S.contact.I0 * Math.exp(-s / 0.5);
    if (s > 4) f.flashes = [];
  }
  return f;
}
function onStats(st, now) {
  S.stats = st;
  const n = S.sim.n, Mt = S.setup.bodies.reduce((a, b) => a + b.M, 0);
  S.peak.P = Math.max(S.peak.P, st.maxPGPa);
  S.peak.melt = Math.max(S.peak.melt, st.melt / n);
  S.peak.vap = Math.max(S.peak.vap, st.vapour / n);
  S.peak.esc = st.unboundMass / Mt;
  if (!S.contact && st.touching > 0) {
    const B = bodiesNow(), c0 = B[0].c, c1 = B[1] ? B[1].c : c0;
    const d = norm([c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]]);
    const R1 = S.setup.bodies[1] ? S.setup.bodies[1].R : B[0].R;
    const p = [0, 1, 2].map(k => c0[k] + d[k] * B[0].R);
    S.contact = { wall: now, simT: st.t, I0: 5, p };
    S.f.flashes = [{ p, r: 0.45 * R1, I: 5, T: 6500 }];
    if (S.dir && S.dir.event) S.dir.event('contact', now);
  }
  numbers();
}
// One readback -> analysis.js outcome (async, one at a time).
async function analyse(now) {
  S.outBusy = true; S.outAt = now;
  const sim = S.sim, key = S.sc && S.sc.key, seed = S.seed;
  try {
    const rb = await sim.readback(['pos', 'vel', 'grav', 'aux']);
    if (!rb || S.sim !== sim || !S.sc || S.sc.key !== key || S.seed !== seed || !S.contact) return;
    S.out = outcome(rb, sim.n, S.setup.bodies);
    S.peak.T99 = Math.max(S.peak.T99, S.out.T99);
    numbers();
  } catch (e) { console.warn('outcome:', e.message); }
  finally { S.outBusy = false; }
}

// ── the preview arc (2D overlay) ────────────────────────────────────────
function drawArc() {
  const c = $('arc'); if (!c.getContext) return;
  const g = c.getContext('2d'); if (!g || !g.clearRect) return;
  g.clearRect(0, 0, c.width, c.height);
  const a = S.arc;
  if (!a || !S.aimOpen || S.contact || S.dir) return;
  const W = innerWidth, H = innerHeight, k = c.width / W;
  const P = p => { const q = S.ren.project(p, W, H); return q ? [q.x * k, q.y * k] : null; };
  const path = (pts, col, w, dash) => {
    g.beginPath(); let on = false;
    for (const p of pts) { const q = P(p); if (!q) { on = false; continue; } if (on) g.lineTo(q[0], q[1]); else { g.moveTo(q[0], q[1]); on = true; } }
    g.setLineDash(dash.map(x => x * k)); g.strokeStyle = col; g.lineWidth = w * k; g.stroke();
  };
  path(a.tgt, 'rgba(150,200,255,0.55)', 1.25, []);
  path(a.imp, 'rgba(255,180,106,0.95)', 1.75, []);
  path(a.ghost, 'rgba(255,180,106,0.6)', 1.25, [5, 5]);
  const h = P(a.hit);
  if (h) { g.setLineDash([]); g.beginPath(); g.arc(h[0], h[1], 6 * k, 0, 2 * Math.PI); g.strokeStyle = '#ffb46a'; g.lineWidth = 1.5 * k; g.stroke(); }
}

// ── caption and numbers ─────────────────────────────────────────────────
function caption() {
  const sc = S.sc, im = S.setup.impact;
  $('capTitle').textContent = sc.title;
  $('capSub').textContent = sc.sub;
  $('capSrc').textContent = (sc.src === 'hypothetical' ? 'A hypothetical collision. ' : sc.src + '. ') +
    `Impact ${(im.vImp * UNIT.V / 1000).toFixed(1)} km/s (${(im.vImp / im.vesc).toFixed(2)} v_esc) at ${im.theta.toFixed(0)} degrees. ${S.sim.n.toLocaleString()} particles.`;
  numbers();
}
function numbers() {
  const st = S.stats, pk = S.peak, o = S.out, pct = x => (100 * x).toFixed(x < 0.1 ? 1 : 0) + ' %';
  const tH = st ? st.tSec / 3600 : 0;
  const cell = (k, v, hot) => `<div><b>${k}</b><span${hot ? ' class="hot"' : ''}>${v}</span></div>`;
  const disk = o ? (o.Md / M_MOON >= 0.01 ? (o.Md / M_MOON).toFixed(2) + ' M☾' : '0') : '-';
  $('nums').innerHTML =
    cell('Time', `${Math.floor(tH)} h ${String(Math.floor((tH % 1) * 60)).padStart(2, '0')} min${S.speed < 1 ? ' ·slow' : ''}`) +
    cell('Impact energy', sci(S.setup.impact.Ekin * UNIT.M * UNIT.V * UNIT.V) + ' J') +
    cell('Peak T (99 %)', pk.T99 ? Math.round(pk.T99).toLocaleString() + ' K' : '-', pk.T99 > 2000) +
    cell('Largest body', o ? pct(o.Mp / o.Mtot) : '-') + cell('Disk', disk) +
    cell('Escaping', o ? pct(o.Me / o.Mtot) : pct(pk.esc)) +
    cell('Molten', pct(pk.melt), pk.melt > 0.05) + cell('Vapour', pct(pk.vap)) +
    cell('Step', st ? `${st.dtSec.toFixed(1)} s` : '-');
}

export function sci(x) { const e = Math.floor(Math.log10(x)); return (x / 10 ** e).toFixed(1) + '×10' + String(e).split('').map(c => '⁰¹²³⁴⁵⁶⁷⁸⁹'[c] || (c === '-' ? '⁻' : c)).join(''); }

// ── the aim panel ───────────────────────────────────────────────────────
const AIM_BODIES = ['earth', 'protoEarth', 'venus', 'mars', 'theia', 'mercury', 'moon', 'pluto', 'charon', 'ceres', 'vesta'];
const COMP_NAME = { real: 'As measured', ironRich: 'Iron-rich', corePoor: 'Core-poor', basaltic: 'Basaltic', icy: 'Icy shell', dry: 'Dry rock' };
const A = { t: 'earth', i: 'mars', ang: 45, v: 1.1, spin: 'day', comp: 'real' };
const allowed = t => AIM_BODIES.filter(k => BODIES[k].mass <= BODIES[t].mass * 1.0001 && BODIES[k].mass >= BODIES[t].mass * 0.008);
function setAim(o) { Object.assign(A, o); syncAim(); }
function aimLink() { return [A.t, A.i, A.ang, A.v, A.spin, A.comp].join(','); }
function aimFromLink(s) {
  const p = s.split(',');
  if (!BODIES[p[0]] || !BODIES[p[1]]) return null;
  return { t: p[0], i: p[1], ang: Math.max(0, Math.min(85, +p[2] || 0)), v: Math.max(0.8, Math.min(4, +p[3] || 1)), spin: p[4] || '0', comp: VARIANTS.includes(p[5]) ? p[5] : 'real' };
}
// The scenario of the aim panel.
export function aimScenario(a = A) {
  const b = Math.sin(a.ang * Math.PI / 180), ratio = BODIES[a.i].mass / BODIES[a.t].mass;
  const spinH = a.spin === 'day' ? (BODIES[a.t].dayH && Math.abs(BODIES[a.t].dayH) < 200 ? BODIES[a.t].dayH : null) : (+a.spin || null);
  const c = composition(a.i, a.comp);
  const imp = Object.assign({ key: a.i }, c ? { layers: c.layers } : {});
  return {
    key: 'aim', title: titleOf({ t: a.t, i: a.i, adjT: spinH && Math.abs(spinH) < 8 ? ['fast-spinning'] : [], adjI: c ? [c.word] : [], theta: a.ang, vRel: a.v, twin: a.t === a.i }),
    sub: `aimed: ${a.ang} degrees, ${(+a.v).toFixed(2)} v_esc, mass ratio ${ratio < 0.01 ? ratio.toFixed(3) : ratio.toFixed(2)}`,
    bodies: [{ key: a.t, spinH }, imp], impact: { vRel: +a.v, b, d0: 1.3 }, fmin: ratio > 0.3 ? 0.3 : 0.12,
    src: 'hypothetical (aimed on this page)', tags: b > 0.6 ? ['graze'] : ['splash'],
  };
}
function buildAim() {
  const opt = k => `<option value="${k}">${BODIES[k].name}</option>`;
  $('aimT').innerHTML = AIM_BODIES.map(opt).join('');
  let timer = 0;
  const live = () => { syncAim(); clearTimeout(timer); timer = setTimeout(() => S.sim && startRun(aimScenario(), 1), 350); };
  $('aimT').onchange = e => { A.t = e.target.value; live(); };
  $('aimI').onchange = e => { A.i = e.target.value; live(); };
  $('aimAng').oninput = e => { A.ang = +e.target.value; live(); };
  $('aimV').oninput = e => { A.v = +e.target.value; live(); };
  $('aimSpin').onchange = e => { A.spin = e.target.value; live(); };
  $('aimComp').onchange = e => { A.comp = e.target.value; live(); };
  $('aimGo').onclick = () => { clearTimeout(timer); syncAim(); startRun(aimScenario(), 1); if (PHONE_Q.matches) openAim(false); };
  $('aimX').onclick = () => openAim(false);
  syncAim();
}
function syncAim() {
  const ok = allowed(A.t);
  if (!ok.includes(A.i)) A.i = ok.filter(k => k !== A.t)[0] || A.t;
  $('aimT').value = A.t;
  $('aimI').innerHTML = ok.map(k => `<option value="${k}">${BODIES[k].name}</option>`).join('');
  $('aimI').value = A.i;
  const comps = VARIANTS.filter(v => v === 'real' || composition(A.i, v));
  if (!comps.includes(A.comp)) A.comp = 'real';
  $('aimComp').innerHTML = comps.map(v => `<option value="${v}">${COMP_NAME[v]}</option>`).join('');
  $('aimComp').value = A.comp; $('aimSpin').value = A.spin;
  $('aimAng').value = A.ang; $('aimV').value = A.v;
  $('aimAngV').textContent = A.ang + '°';
  const Mt = BODIES[A.t].mass + BODIES[A.i].mass, Rs = radiusOf(A.t) + radiusOf(A.i);
  $('aimVV').textContent = `${(+A.v).toFixed(2)} v_esc · ${(A.v * Math.sqrt(2 * UNIT.G * Mt / Rs) / 1000).toFixed(1)} km/s`;
  drawDial();
}
// A real radius, or one at Earth's mean density for a model body.
function radiusOf(k) { const b = BODIES[k]; return b.radius || 6.371e6 * Math.cbrt(b.mass / 5.9722e24); }
// The dial: the target disc, the impactor disc at the angle, the path.
function drawDial() {
  const svg = $('aimDial'); if (!svg) return;
  const rT = radiusOf(A.t), rI = radiusOf(A.i), sc = 46 / (rT + rI), RT = rT * sc, RI = rI * sc;
  const cx = 70, cy = 64, b = Math.sin(A.ang * Math.PI / 180), off = b * (RT + RI);
  const ix = cx + Math.sqrt(Math.max(0, (RT + RI) ** 2 - off * off)) + 70, iy = cy - off;
  const hx = cx + Math.sqrt(Math.max(0, (RT + RI) ** 2 - off * off)), hy = cy - off;
  svg.innerHTML =
    `<line x1="${cx}" y1="${cy}" x2="215" y2="${cy}" stroke="rgba(150,190,240,0.25)" stroke-dasharray="3 3"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${RT.toFixed(1)}" fill="#24425f" stroke="#7fb2e0" stroke-width="1"/>` +
    `<line x1="${ix.toFixed(1)}" y1="${iy.toFixed(1)}" x2="${hx.toFixed(1)}" y2="${hy.toFixed(1)}" stroke="#ffb46a" stroke-width="1.5" stroke-dasharray="4 3"/>` +
    `<circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="${RI.toFixed(1)}" fill="none" stroke="#ffb46a" stroke-width="1" stroke-dasharray="2 2"/>` +
    `<circle cx="${ix.toFixed(1)}" cy="${iy.toFixed(1)}" r="${RI.toFixed(1)}" fill="#5a3a22" stroke="#ffb46a" stroke-width="1.25"/>` +
    `<line x1="${cx}" y1="${cy}" x2="${hx.toFixed(1)}" y2="${hy.toFixed(1)}" stroke="#ffd666" stroke-width="1"/>` +
    `<text x="${cx}" y="${(cy + RT + 13).toFixed(0)}" fill="#8a94a3" font-size="10" text-anchor="middle">${BODIES[A.t].name}</text>` +
    `<text x="${ix.toFixed(0)}" y="${Math.max(10, iy - RI - 4).toFixed(0)}" fill="#ffb46a" font-size="10" text-anchor="middle">${BODIES[A.i].name}</text>` +
    `<text x="214" y="114" fill="#ffd666" font-size="10" text-anchor="end">θ = ${A.ang}°  b = ${b.toFixed(2)}</text>`;
}
function openAim(on) {
  S.aimOpen = on; $('aim').hidden = !on;
  if (on) { $('info').hidden = true; $('moreMenu').classList.add('off'); }
  for (const id of ['aimBtn', 'dockAim']) { const b = $(id); b.classList.toggle('on', on); if (b.setAttribute) b.setAttribute('aria-pressed', String(on)); }
}

// ── the bar and the dock ────────────────────────────────────────────────
function buildUI() {
  const sel = $('preset');
  sel.innerHTML = PRESETS.map(p => `<option value="${p.key}">${p.title}</option>`).join('') + '<option value="" disabled>Random or aimed</option>';
  sel.onchange = () => sel.value && startRun(presetByKey(sel.value), 1);
  $('rollBtn').onclick = roll; $('dockRoll').onclick = roll;
  $('aimBtn').onclick = () => openAim(!S.aimOpen); $('dockAim').onclick = () => openAim(!S.aimOpen);
  $('resetBtn').onclick = restart; $('moreReset').onclick = () => { restart(); more(false); };
  $('playBtn').onclick = togglePause; $('dockPlay').onclick = togglePause;
  for (const b of $('speed').querySelectorAll('button')) b.onclick = () => setSpeed(+b.dataset.s);
  for (const b of $('dockSpeed').querySelectorAll('button')) b.onclick = () => stepSpeed(+b.dataset.d);
  $('modeSel').onchange = e => setMode(+e.target.value);
  $('moreMode').onclick = () => setMode((S.mode + 1) % 5);
  $('cutBtn').onclick = toggleCut; $('moreCut').onclick = toggleCut;
  $('followBtn').onclick = toggleFollow; $('moreFollow').onclick = toggleFollow;
  $('infoBtn').onclick = () => { $('info').hidden = !$('info').hidden; if (!$('info').hidden) openAim(false); };
  $('moreInfo').onclick = () => { $('info').hidden = false; openAim(false); more(false); };
  $('infoX').onclick = () => { $('info').hidden = true; };
  $('dockMore').onclick = () => more($('moreMenu').classList.contains('off'));
  $('srcList').textContent = 'Sources: ' + SOURCES.join(' ');
  // the call to action: a tagged store link (lib/wishlist.js)
  const W = window.snWishlist;
  for (const id of ['ctaCap', 'ctaInfo', 'ctaMore']) { const a = $(id); if (W && W.url) a.href = W.url('planet-collision', 'cta'); else a.hidden = true; }
  buildAim();
  addEventListener('keydown', e => {
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (S.dir) return;
    if (e.code === 'Space') { e.preventDefault(); togglePause(); }
    else if (e.key === 'r' || e.key === 'R') restart();
    else if (e.key === 'n' || e.key === 'N') roll();
    else if (e.key === 'a' || e.key === 'A') openAim(!S.aimOpen);
    else if (e.key === 'c' || e.key === 'C') toggleCut();
    else if (e.key === 'f' || e.key === 'F') toggleFollow();
    else if (e.key === 'm' || e.key === 'M') setMode((S.mode + 1) % 5);
    else if (e.key === '-') stepSpeed(-1);
    else if (e.key === '=' || e.key === '+') stepSpeed(1);
    else if (e.key === 'Escape') { openAim(false); $('info').hidden = true; more(false); }
  });
}
function restart() { if (S.sc) startRun(S.sc, S.seed); }
function roll() { const seed = 1 + Math.floor(Math.random() * 1e6); startRun(randomScenario(seed), seed); }
function more(on) { $('moreMenu').classList.toggle('off', !on); $('dockMore').classList.toggle('on', on); }
function togglePause() {
  S.paused = !S.paused;
  for (const id of ['playBtn', 'dockPlay']) { const b = $(id); b.textContent = S.paused ? '▶' : '❚❚'; b.setAttribute('aria-label', S.paused ? 'Play' : 'Pause'); }
}
export function setSpeed(s) {
  S.speed = s;
  for (const b of $('speed').querySelectorAll('button')) b.classList.toggle('on', +b.dataset.s === s);
  $('dockSpeedV').textContent = s < 1 ? (s === 0.25 ? '¼ slow' : '½ slow') : '×' + s;
}
function stepSpeed(d) { const i = SPEEDS.indexOf(S.speed); setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 3 : i) + d))]); }
function setMode(m) { S.mode = m; $('modeSel').value = String(m); $('moreMode').textContent = 'Colour: ' + ['real', 'temperature', 'origin body', 'speed', 'material'][m]; }
function toggleCut() { S.cut = !S.cut; for (const id of ['cutBtn', 'moreCut']) { const b = $(id); b.classList.toggle('on', S.cut); b.setAttribute('aria-pressed', String(S.cut)); } }
function toggleFollow() {
  S.follow = !S.follow;
  const b = $('followBtn'); b.classList.toggle('on', S.follow); b.setAttribute('aria-pressed', String(S.follow));
  $('moreFollow').textContent = 'Follow: ' + (S.follow ? 'on' : 'off');
}

// ── camera input: drag to orbit, wheel or pinch to zoom, double tap resets
function bindPointer(el) {
  const pts = new Map();
  let pinch0 = 0, zoom0 = 1;
  el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); if (pts.size === 2) { pinch0 = spread(); zoom0 = S.view.zoom; } more(false); });
  el.addEventListener('pointermove', e => {
    const p = pts.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p[0], dy = e.clientY - p[1];
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) { S.view.yaw -= dx * 0.006; S.view.pitch = Math.max(-1.45, Math.min(1.45, S.view.pitch + dy * 0.006)); }
    else if (pts.size === 2 && pinch0 > 0) S.view.zoom = clampZoom(zoom0 * pinch0 / Math.max(1, spread()));
  });
  const up = e => { pts.delete(e.pointerId); pinch0 = 0; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', e => { e.preventDefault(); S.view.zoom = clampZoom(S.view.zoom * Math.exp(e.deltaY * 0.0012)); }, { passive: false });
  el.addEventListener('dblclick', () => { const v = makeView(); S.view.yaw = v.yaw; S.view.pitch = v.pitch; S.view.zoom = 1; });
  function spread() { const a = [...pts.values()]; return Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]); }
}
function clampZoom(z) { return Math.max(0.2, Math.min(5, z)); }

boot().catch(e => fail(e));
