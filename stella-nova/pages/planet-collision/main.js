// ============================================================================
//  PLANET COLLISION  ·  main.js — boot, the run, the frame loop, the bar
// ----------------------------------------------------------------------------
//  ONE RUN (fn startRun): build.js buildScenario -> sim.upload ->
//  ren.attach -> the relax (RELAX_STEPS damped steps, RELAX_PER_FRAME a
//  frame, drawn as it settles) -> sim.launch -> the run. The solver and the
//  renderer are made once, at the profile's particle cap (budget.js).
//
//  FRAME (fn frame): steps of the solver (S.steps, from the speed buttons
//  and the governor), then one render. Every STATS_EVERY frames an async
//  sim.stats() (fn onStats) feeds the numbers, the camera goal and the
//  events: first contact -> an impact flash, the atmospheres and the body
//  shadows fade (they are drawn, not simulated).
//
//  GOVERNOR. Every 10 frames: a smoothed frame time over 24 ms cuts the cap
//  on the steps per frame by a quarter, one under 17 ms raises it by one
//  (fn govern). The sim time per
//  frame also shrinks by itself at the impact (the CFL time step).
//
//  For step 3 (UI and screensaver): window.__pc = { S, startRun, frameOf }.
//
//  grep -n targets
//    boot ............ "async function boot"
//    one run ......... "function startRun"
//    frame loop ...... "function frame("
//    stats + events .. "function onStats"
//    camera input .... "function bindPointer"
//    caption ......... "function caption", "function numbers"
// ============================================================================
import { SphGPU, loadSphCode } from './engine.js';
import { buildScenario } from './build.js';
import { makeParams } from './sph.js';
import { PRESETS, presetByKey, randomScenario } from './scenarios.js';
import { pickProfile, renderBudget } from './budget.js';
import { Renderer, loadRenderCode, loadMaps, defaultFrame, norm } from './render.js';
import { makeView, frameTarget, stepView, eyeOf } from './view.js';
import { UNIT, SOURCES } from './data.js';

const RELAX_STEPS = 200, RELAX_PER_FRAME = 20, STATS_EVERY = 6;
const $ = id => document.getElementById(id);
const touch = matchMedia('(pointer: coarse)').matches;
const phone = touch && Math.min(screen.width, screen.height) < 600;

const S = {
  dev: null, ctx: null, sim: null, ren: null, prof: pickProfile({ phone, touch }),
  sc: null, setup: null, seed: 1, phase: 'idle', relaxDone: 0,
  paused: false, speed: 2, cap: 8, dtAvg: 16, lastNow: 0, frameNo: 0,
  stats: null, contact: null, peak: { P: 0, melt: 0, vap: 0, esc: 0 },
  view: makeView(), f: defaultFrame(), mode: 0, cut: false,
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
  window.__pc = { S, startRun, frameOf };
  const q = new URLSearchParams(location.search);
  if (q.has('seed')) startRun(randomScenario(+q.get('seed') | 0), +q.get('seed') | 0);
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
}

// ── one run ─────────────────────────────────────────────────────────────
function startRun(sc, seed = 1) {
  S.sc = sc; S.seed = seed;
  S.setup = buildScenario(sc, S.prof.N, seed);
  S.prm = makeParams(S.setup, { KG: S.prof.KG });
  S.sim.upload(S.setup, S.prm);
  S.ren.attach(S.sim, S.setup);
  S.phase = 'relax'; S.relaxDone = 0;
  S.stats = null; S.contact = null; S.peak = { P: 0, melt: 0, vap: 0, esc: 0 };
  S.f.flashes = [];
  S.f.bodies = [0, 1, 2, 3].map(() => ({ atm: 1, shadow: 1 }));
  const g = frameTarget(bodiesNow(), null, S.f.fov, innerWidth / innerHeight);
  S.view.target = g.target.slice(); S.view.dist = g.dist;
  caption();
  const sel = $('preset');
  sel.value = PRESETS.some(p => p.key === sc.key) ? sc.key : '';
  const u = new URL(location.href);
  u.searchParams.delete('run'); u.searchParams.delete('seed');
  if (sc.key.startsWith('random-')) u.searchParams.set('seed', String(seed)); else u.searchParams.set('run', sc.key);
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
  S.lastNow = now; S.frameNo++;
  govern(dt * 1000);
  let steps = 0;
  if (S.phase === 'relax') {
    S.sim.relaxSteps(RELAX_PER_FRAME); S.relaxDone += RELAX_PER_FRAME;
    $('busy').hidden = false; $('busyBar').style.width = (100 * S.relaxDone / RELAX_STEPS).toFixed(0) + '%';
    if (S.relaxDone >= RELAX_STEPS) { S.sim.launch(); S.phase = 'run'; $('busy').hidden = true; }
  } else if (S.phase === 'run' && !S.paused) {
    steps = Math.min(S.cap, 2 * S.speed);
    S.sim.step(steps);
  }
  if (S.frameNo % STATS_EVERY === 0 && S.phase === 'run') S.sim.stats().then(st => st && onStats(st, now));
  const f = frameOf(now, dt, steps);
  S.ren.render(f);
}
function govern(ms) {
  S.dtAvg += (ms - S.dtAvg) * 0.1;
  if (S.frameNo % 10) return;
  if (S.dtAvg > 24 && S.cap > 1) S.cap = Math.max(1, Math.floor(S.cap * 0.75));
  else if (S.dtAvg < 17 && S.cap < 8) S.cap++;
}
// The frame description for render.js (camera, events, display state).
function frameOf(now, dt, steps) {
  const f = S.f, aspect = innerWidth / innerHeight;
  const sinceH = S.contact && S.stats ? (S.stats.t - S.contact.simT) * UNIT.T / 3600 : null;
  stepView(S.view, frameTarget(bodiesNow(), sinceH, f.fov, aspect), dt, S.contact ? 1.2 : 0.6);
  f.eye = eyeOf(S.view); f.target = S.view.target; f.time = now / 1000;
  f.sun = norm([1, 0.25, 0.3]);
  f.mode = S.mode;
  f.cut = { on: S.cut, n: norm([f.eye[0] - f.target[0], f.eye[1] - f.target[1], f.eye[2] - f.target[2]]), d: 0 };
  f.cut.d = f.cut.n[0] * f.target[0] + f.cut.n[1] * f.target[1] + f.cut.n[2] * f.target[2];
  f.streakT = S.stats && steps ? S.stats.dt * steps : 0;
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
    S.contact = { wall: now, simT: st.t, I0: 5 };
    S.f.flashes = [{ p: [0, 1, 2].map(k => c0[k] + d[k] * B[0].R), r: 0.45 * R1, I: 5, T: 6500 }];
  }
  numbers();
}

// ── caption and numbers ─────────────────────────────────────────────────
function caption() {
  const sc = S.sc, im = S.setup.impact;
  $('capTitle').textContent = sc.title;
  $('capSub').textContent = sc.sub;
  $('capSrc').textContent = (sc.src === 'hypothetical' ? 'A hypothetical collision. ' : sc.src + '. ') +
    `Impact ${(im.vImp * UNIT.V / 1000).toFixed(1)} km/s at ${im.theta.toFixed(0)} degrees. ${S.sim.n.toLocaleString()} particles.`;
  numbers();
}
function numbers() {
  const st = S.stats, pk = S.peak, pct = x => (100 * x).toFixed(x < 0.1 ? 1 : 0) + ' %';
  const tH = st ? st.tSec / 3600 : 0;
  const cell = (k, v, hot) => `<div><b>${k}</b><span${hot ? ' class="hot"' : ''}>${v}</span></div>`;
  $('nums').innerHTML = cell('Time', `${Math.floor(tH)} h ${String(Math.floor((tH % 1) * 60)).padStart(2, '0')} min`) +
    cell('Molten', pct(pk.melt), pk.melt > 0.05) + cell('Vapour', pct(pk.vap)) +
    cell('Impact energy', sci(S.setup.impact.Ekin * UNIT.M * UNIT.V * UNIT.V) + ' J') + cell('Escaping mass', pct(pk.esc)) +
    cell('Step', st ? `${st.dtSec.toFixed(1)} s` : '-');
}

function sci(x) { const e = Math.floor(Math.log10(x)); return (x / 10 ** e).toFixed(1) + '×10' + String(e).split('').map(c => '⁰¹²³⁴⁵⁶⁷⁸⁹'[c] || (c === '-' ? '⁻' : c)).join(''); }

// ── the bar ─────────────────────────────────────────────────────────────
function buildUI() {
  const sel = $('preset');
  sel.innerHTML = PRESETS.map(p => `<option value="${p.key}">${p.title}</option>`).join('') + '<option value="" disabled>Random draw</option>';
  sel.onchange = () => sel.value && startRun(presetByKey(sel.value), 1);
  $('rollBtn').onclick = roll;
  $('resetBtn').onclick = () => S.sc && startRun(S.sc, S.seed);
  $('playBtn').onclick = togglePause;
  for (const b of $('speed').querySelectorAll('button')) b.onclick = () => setSpeed(+b.dataset.s);
  $('modeSel').onchange = e => { S.mode = +e.target.value; };
  $('cutBtn').onclick = toggleCut;
  $('infoBtn').onclick = () => { $('info').hidden = !$('info').hidden; };
  $('infoX').onclick = () => { $('info').hidden = true; };
  $('srcList').textContent = 'Sources: ' + SOURCES.join(' ');
  addEventListener('keydown', e => {
    if (e.target.tagName === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space') { e.preventDefault(); togglePause(); }
    else if (e.key === 'r' || e.key === 'R') S.sc && startRun(S.sc, S.seed);
    else if (e.key === 'n' || e.key === 'N') roll();
    else if (e.key === 'c' || e.key === 'C') toggleCut();
    else if (e.key === 'm' || e.key === 'M') { S.mode = (S.mode + 1) % 5; $('modeSel').value = String(S.mode); }
  });
}
function roll() { const seed = 1 + Math.floor(Math.random() * 1e6); startRun(randomScenario(seed), seed); }
function togglePause() { S.paused = !S.paused; const b = $('playBtn'); b.textContent = S.paused ? '▶' : '❚❚'; b.setAttribute('aria-label', S.paused ? 'Play' : 'Pause'); }
function setSpeed(s) { S.speed = s; for (const b of $('speed').querySelectorAll('button')) b.classList.toggle('on', +b.dataset.s === s); }
function toggleCut() { S.cut = !S.cut; const b = $('cutBtn'); b.classList.toggle('on', S.cut); b.setAttribute('aria-pressed', String(S.cut)); }

// ── camera input: drag to orbit, wheel or pinch to zoom, double tap resets
function bindPointer(el) {
  const pts = new Map();
  let pinch0 = 0, zoom0 = 1;
  el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); if (pts.size === 2) { pinch0 = spread(); zoom0 = S.view.zoom; } });
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
