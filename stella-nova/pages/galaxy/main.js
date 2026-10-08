// ============================================================================
//  GALAXY  ·  main.js — the page: UI, camera, frame loop
// ----------------------------------------------------------------------------
//  model.js builds a galaxy (in worker.js, off the main thread); engine.js
//  draws it. The orbit camera eases toward a goal with springs; drag,
//  wheel, pinch and W A S D move the goal. "Fly into the disk" plays the
//  saver's dive shot. saver.js is the screensaver hook (window.snSaver).
//
//  Sliders with data-p set one model parameter. Those with data-rebuild
//  change the stars, so they rebuild on release; the others repack the
//  galaxy blocks at once (E.setGals).
//
//  grep -n targets
//    "function rebuild"    build in the worker, upload
//    "function repack"     new uniforms only
//    "function occlusion"  the panel and dock margins that frame the view
//    "function frame"      the frame loop
//    "function bindUI"     every control
//    "const api"           what saver.js gets
// ============================================================================
import * as M from './model.js';
import { createEngine } from './engine.js';
import { galaxyBudget } from './budget.js';
import * as C from './camera.js';
import { shotCamera } from './saverplan.js';
import { typesetAll } from '../../lib/sci-math.js';
import { installSaver } from './saver.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const canvas = $('c');
let quality = PHONE_Q.matches ? 'low' : 'high';
let bud = null, E = null, built = null, P = M.presetParams('m51');
const st = { time: 520, speed: 6, playing: true, ev: 0, sky: true, bg: true, frame: 0, fps: 60 };
const cam = { target: [0, 0, 0], yaw: 0.6, pitch: C.inclToPitch(P.incl), dist: 60, fov: 40 };
const goal = { ...cam, target: [0, 0, 0] };
const vel = { yaw: 0, pitch: 0, dist: 0, fov: 0, t: [0, 0, 0] };
let anim = null;              // a camera move (fly into the disk)
const api = { saverCam: null, saverOff: null, saving: false };

// ── build ──────────────────────────────────────────────────────────────────
let worker = null;
try { worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); } catch (e) { worker = null; }
let wid = 0; const waits = new Map();
if (worker) {
  worker.onmessage = e => { const w = waits.get(e.data.id); if (!w) return; waits.delete(e.data.id); e.data.error ? w.reject(new Error(e.data.error)) : w.resolve(e.data.built); };
  worker.onerror = () => { worker = null; for (const w of waits.values()) w.retry(); waits.clear(); };
}
function buildAsync(Pb, opts) {
  const local = () => Promise.resolve(M.buildGalaxy(Pb, opts));
  if (!worker) return local();
  return new Promise((resolve, reject) => { const id = ++wid; waits.set(id, { resolve, reject, retry: () => local().then(resolve, reject) }); worker.postMessage({ id, P: Pb, opts }); });
}
let buildN = 0;
async function rebuild({ refit = false } = {}) {
  const n = ++buildN;
  $('hudStat').textContent = 'building…';
  let b;
  try { b = await buildAsync(JSON.parse(JSON.stringify(P)), { stars: bud.stars, sky: st.sky, bg: st.bg }); }
  catch (e) { console.error(e); b = M.buildGalaxy(P, { stars: bud.stars, sky: st.sky, bg: st.bg }); }
  if (n !== buildN) return built;
  built = b;
  E.setGalaxy(b);
  if (refit) fitGoal(true);
  showHud();
  return b;
}
// New galaxy blocks from P, the stars unchanged.
function repack() {
  if (!built) return;
  built.list[0].P = P;
  if (built.list.length > 1 && P.type === 'pair') built.list[1].P = Object.assign({}, built.list[1].P, { pitch: P.pitch, armAmp: P.armAmp, tau: P.tau, hii: P.hii, vflat: P.vflat, flocc: P.flocc });
  built.list.forEach((g, i) => M.packGalaxy(g, built.gals, i * M.GAL_FLOATS));
  E.setGals(built.gals, built.nGal);
  showHud();
}

// ── view ───────────────────────────────────────────────────────────────────
function ctx() { const R = built ? built.meta.R : P.Rd * 5.5; return { R, Rd: P.Rd, re: P.re, fit: C.fitDistance(R, 40, innerWidth / innerHeight) }; }
function fitGoal(snap) {
  const c = ctx();
  Object.assign(goal, { target: [0, 0, 0], dist: c.fit, pitch: C.inclToPitch(P.incl), fov: 40 });
  if (snap) { Object.assign(cam, goal, { target: [0, 0, 0] }); }
  syncView();
}
// Overlay margins (CSS px) that the view should avoid: the open panel and
// the phone dock. The galaxy centres in the clear part.
function occlusion() {
  const o = { l: 0, r: 0, t: 0, b: 0 }, W = innerWidth, H = innerHeight;
  if (api.saving) return o;
  const panel = $('panel'), dock = $('dock');
  if (panel.classList.contains('open')) {
    const q = panel.getBoundingClientRect();
    if (q.width < W * 0.9 && q.left > W * 0.4) o.r = Math.max(0, W - q.left); else if (q.top > H * 0.2) o.b = Math.max(0, H - q.top);
  }
  if (dock.offsetParent) o.b = Math.max(o.b, H - dock.getBoundingClientRect().top);
  return o;
}

function resize() {
  bud = galaxyBudget(innerWidth, innerHeight, devicePixelRatio || 1, { phone: PHONE_Q.matches, quality });
  canvas.width = bud.w; canvas.height = bud.h;
  if (E) E.resize(bud);
}

// ── HUD ────────────────────────────────────────────────────────────────────
function showHud() {
  const t = M.TYPES.find(x => x.key === P.type);
  $('hudType').textContent = (P.name || (t && t.name) || '') + (t ? ' · ' + t.hubble : '');
  const n = built ? built.count.toLocaleString('en') : '…';
  $('hudStat').textContent = `${n} stars · ${bud.w}×${bud.h} · ${st.fps} fps`;
  $('dockName').textContent = (M.PRESETS.find(p => p.key === P.preset) || { label: t ? t.name : 'Galaxy' }).label;
  document.querySelectorAll('#presets button').forEach(b => b.classList.toggle('on', b.dataset.key === P.preset));
  $('type').value = P.type; $('seed').value = P.seed || 1;
  syncSliders();
}
const fmt = { m: v => String(v), pitch: v => v.toFixed(1) + '°', armAmp: v => v.toFixed(2), flocc: v => v.toFixed(2), bar: v => (100 * v).toFixed(1) + ' %', BT: v => v.toFixed(2), n: v => v.toFixed(1), Rd: v => v.toFixed(1) + ' kpc', tau: v => v.toFixed(2), hii: v => v.toFixed(2), vflat: v => v.toFixed(0) + ' km/s' };
function syncSliders() {
  document.querySelectorAll('[data-p]').forEach(inp => { const k = inp.dataset.p; inp.value = P[k] ?? 0; inp.parentElement.querySelector('.val').textContent = fmt[k] ? fmt[k](+inp.value) : inp.value; });
}
function syncView() {
  const i = 90 - goal.pitch / C.DEG, a = ((goal.yaw / C.DEG + 540) % 360) - 180;
  $('incl').value = i; $('incl').parentElement.querySelector('.val').textContent = i.toFixed(0) + '°';
  $('azim').value = a; $('azim').parentElement.querySelector('.val').textContent = a.toFixed(0) + '°';
}

// ── controls ───────────────────────────────────────────────────────────────
function setPreset(key) { P = M.presetParams(key); return rebuild({ refit: true }); }
function setType(type, seed) { P = M.randomParams(type, seed); return rebuild({ refit: true }); }
function bindUI() {
  const pre = $('presets');
  for (const p of M.PRESETS) { const b = document.createElement('button'); b.textContent = p.label; b.dataset.key = p.key; b.onclick = () => setPreset(p.key); pre.appendChild(b); }
  for (const t of M.TYPES) { const o = document.createElement('option'); o.value = t.key; o.textContent = t.name; $('type').appendChild(o); }
  $('type').onchange = () => setType($('type').value, +$('seed').value || 1);
  $('seed').onchange = () => setType($('type').value, Math.max(1, Math.round(+$('seed').value || 1)));
  $('reroll').onclick = () => setType($('type').value, 1 + Math.floor(Math.random() * 99999));
  let reb = 0;
  document.querySelectorAll('[data-p]').forEach(inp => {
    const k = inp.dataset.p;
    inp.addEventListener('input', () => {
      P[k] = +inp.value; P.preset = null;
      inp.parentElement.querySelector('.val').textContent = fmt[k] ? fmt[k](+inp.value) : inp.value;
      if ('rebuild' in inp.dataset) { clearTimeout(reb); reb = setTimeout(() => rebuild(), 250); } else repack();
    });
  });
  $('incl').oninput = () => { goal.pitch = C.inclToPitch(+$('incl').value); anim = null; syncView(); };
  $('azim').oninput = () => { goal.yaw = +$('azim').value * C.DEG; anim = null; syncView(); };
  const val = (id, f) => { const i = $(id); const s = () => { i.parentElement.querySelector('.val').textContent = f(+i.value); }; i.addEventListener('input', s); s(); };
  $('speed').addEventListener('input', () => { st.speed = +$('speed').value; });
  val('speed', v => v.toFixed(1));
  $('ev').addEventListener('input', () => { st.ev = +$('ev').value; });
  val('ev', v => (v > 0 ? '+' : '') + v.toFixed(1));
  $('sky').onchange = () => { st.sky = $('sky').checked; rebuild(); };
  $('bg').onchange = () => { st.bg = $('bg').checked; rebuild(); };
  $('quality').value = quality;
  $('quality').onchange = () => { quality = $('quality').value; resize(); rebuild(); };
  $('fly').onclick = $('dockFly').onclick = fly;
  $('reset').onclick = () => { anim = null; fitGoal(false); };
  $('dockPrev').onclick = () => cyclePreset(-1);
  $('dockNext').onclick = () => cyclePreset(1);
  $('dockName').onclick = () => cyclePreset(1);
  $('dockPlay').onclick = () => { st.playing = !st.playing; $('dockPlay').textContent = st.playing ? '❚❚' : '▶'; };
  $('eqCollapse').onclick = () => { const c = $('eqPanel').classList.toggle('collapsed'); $('eqCollapse').textContent = c ? '+' : '–'; };

  // panel, phone sheet, dock (the wave-membrane pattern)
  const panel = $('panel'), dockPanel = $('dockPanel');
  const setOpen = open => {
    panel.classList.toggle('open', open); if (!open) panel.classList.remove('full');
    document.body.classList.toggle('panel-closed', !open);
    dockPanel.classList.toggle('on', open); dockPanel.setAttribute('aria-expanded', String(open));
  };
  $('gear').onclick = () => setOpen(true);
  $('panelClose').onclick = () => setOpen(false);
  dockPanel.onclick = () => setOpen(!panel.classList.contains('open'));
  setOpen(!PHONE_Q.matches && innerWidth > 900);
  PHONE_Q.addEventListener('change', e => { setOpen(!e.matches); quality = e.matches ? 'low' : quality; $('quality').value = quality; resize(); });
  const grip = $('sheetGrip'); let gy = null;
  grip.addEventListener('pointerdown', e => { gy = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) {} });
  grip.addEventListener('pointerup', e => {
    if (gy === null) return; const dy = e.clientY - gy; gy = null;
    if (Math.abs(dy) < 8) panel.classList.toggle('full');
    else if (dy < -40) panel.classList.add('full');
    else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
  });
  grip.addEventListener('pointercancel', () => { gy = null; });

  // orbit: one pointer drags, two pinch
  const pts = new Map(); let pinch0 = 0, dist0 = 0;
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); anim = null; $('hint').classList.add('gone'); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); dist0 = goal.dist; } });
  canvas.addEventListener('pointermove', e => {
    const p = pts.get(e.pointerId); if (!p) return;
    if (pts.size === 1) {
      goal.yaw -= (e.clientX - p[0]) * 0.006;
      goal.pitch = Math.max(-1.55, Math.min(1.55, goal.pitch + (e.clientY - p[1]) * 0.005));
      syncView();
    }
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch0 > 0) goal.dist = clampDist(dist0 * pinch0 / d); }
  });
  const up = e => { pts.delete(e.pointerId); pinch0 = 0; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => { e.preventDefault(); anim = null; goal.dist = clampDist(goal.dist * Math.exp(e.deltaY * 0.0012)); }, { passive: false });
  const keys = new Set();
  addEventListener('keydown', e => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return; keys.add(e.key.toLowerCase()); if (e.key === ' ') { st.playing = !st.playing; e.preventDefault(); } });
  addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  api.keys = keys;
}
const clampDist = d => Math.max(0.3, Math.min(ctx().fit * 4, d));
function cyclePreset(d) {
  const i = M.PRESETS.findIndex(p => p.key === P.preset);
  setPreset(M.PRESETS[(i + d + M.PRESETS.length) % M.PRESETS.length].key);
}
// Fly into the disk: the saver's dive shot, from the current view.
function fly() {
  const shot = { kind: 'dive', yaw0: goal.yaw, spin: 0.25, incl: Math.max(30, Math.min(70, 90 - goal.pitch / C.DEG)) };
  anim = { shot, p: 0, dur: 7, ctx: ctx() };
}

// ── loop ───────────────────────────────────────────────────────────────────
let last = performance.now(), fpsN = 0, fpsT = last;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (++fpsN && now - fpsT > 1000) { st.fps = Math.round(fpsN * 1000 / (now - fpsT)); fpsN = 0; fpsT = now; if (!api.saving) showHudStat(); }
  if (!E || !built) return;
  if (st.playing) st.time += st.speed * dt * (api.saving ? api.timeScale || 1 : 1);
  let c;
  if (api.saving && api.saverCam) c = api.saverCam(dt);
  else {
    if (anim) {
      anim.p = Math.min(1, anim.p + dt / anim.dur);
      const s = shotCamera(anim.shot, anim.p, anim.ctx);
      Object.assign(goal, s, { target: s.target.slice() });
      if (anim.p >= 1) anim = null;
      syncView();
    }
    const k = api.keys;
    if (k && k.size) {
      const b = C.basis(cam), sp = goal.dist * 0.7 * dt;
      const mv = (v, s) => { for (let i = 0; i < 3; i++) goal.target[i] += v[i] * s; };
      if (k.has('w')) mv(b.fwd, sp); if (k.has('s')) mv(b.fwd, -sp);
      if (k.has('d')) mv(b.right, sp); if (k.has('a')) mv(b.right, -sp);
      if (k.has('e')) mv(b.up, sp); if (k.has('q')) mv(b.up, -sp);
    }
    const w = anim ? 9 : 6;
    [cam.yaw, vel.yaw] = C.springAngle(cam.yaw, vel.yaw, goal.yaw, w, dt);
    [cam.pitch, vel.pitch] = C.spring(cam.pitch, vel.pitch, goal.pitch, w, dt);
    [cam.dist, vel.dist] = C.spring(cam.dist, vel.dist, goal.dist, w, dt);
    [cam.fov, vel.fov] = C.spring(cam.fov, vel.fov, goal.fov, w, dt);
    for (let i = 0; i < 3; i++) [cam.target[i], vel.t[i]] = C.spring(cam.target[i], vel.t[i], goal.target[i], w, dt);
    c = cam;
  }
  // frame the galaxy in the clear part of the window
  let off = [0, 0];
  if (api.saving && api.saverOff) off = api.saverOff();
  else { const o = occlusion(); off = [(o.l - o.r) / innerWidth, (o.b - o.t) / innerHeight]; }
  E.render({
    cam: C.frameUniform(c, bud.w / bud.h), off, time: st.time, wall: now / 1000, frame: st.frame++,
    exposure: Math.pow(2, st.ev) * (api.saving ? api.fade ?? 1 : 1), sbRef: M.refSB(P), skyGain: 1, autoKey: 0.09, autoRate: Math.min(1, dt * 2.5), bloom: 0.06,
    snapExposure: api.snap ? (api.snap = false, true) : false,
  });
}
function showHudStat() { if (built && bud) $('hudStat').textContent = `${built.count.toLocaleString('en')} stars · ${bud.w}×${bud.h} · ${st.fps} fps`; }

// ── boot ───────────────────────────────────────────────────────────────────
async function boot() {
  resize();
  bindUI();
  showHud();
  try { E = await createEngine({ canvas, mobile: PHONE_Q.matches }); }
  catch (e) {
    console.error(e);
    $('msg').hidden = false;
    $('msg').textContent = 'This page needs WebGPU. Use a current Safari, Chrome or Edge.';
    return;
  }
  E.onLost = info => { if (info && info.reason !== 'destroyed') { $('msg').hidden = false; $('msg').textContent = 'The GPU device was lost. Reload the page.'; } };
  E.resize(bud);
  addEventListener('resize', resize);
  await rebuild({ refit: true });
  cam.dist = goal.dist * 1.6;                 // a short glide in at the start
  requestAnimationFrame(frame);
  typesetAll(document);
  addEventListener('pagehide', () => { try { worker && worker.terminate(); } catch (e) {} });
}

// What saver.js may use.
Object.assign(api, {
  get E() { return E; }, get built() { return built; }, get P() { return P; }, st, cam, goal, ctx,
  setPreset, setType, rebuild, setParams(p) { P = p; return rebuild(); },
  canvas, resize, fitGoal, showHud,
});
installSaver(api);
window.__galaxy = api;
boot();
