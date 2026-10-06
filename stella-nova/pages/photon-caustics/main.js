// ============================================================================
//  PHOTON CAUSTICS  ·  main.js — layout, controls, the loop, the saver hook
// ----------------------------------------------------------------------------
//  One WebGL2 canvas (#gl) shows one of two views:
//    2D  optics2d.js traces photons on the CPU each frame; render2d.js adds
//        their paths into a light image. The photon count adapts to keep
//        the trace near TRACE_MS. A still scene converges (running mean);
//        a moving one (waves, marbles, a drag, the saver) keeps a short
//        memory (A_LIVE in render2d.js).
//    3D  pool3d.js steps the waves and draws the pool and its caustics.
//
//  FRAMING. clearRect() gives the part of the canvas that no panel, dock
//  or saver plate covers. The 2D view fits the scene there. The 3D view
//  shifts the projection centre there and widens the field of view, so
//  the pool is centred in that part.
//
//  SAVER. window.snSaver plays shots: 2D scenes with slow push-ins and
//  light turns, and 3D shots with camera moves, sun moves and wave
//  modes. The 2D and the 3D lists are shuffled by the seed and taken in
//  turn. A shot holds 7 to 10 s (calm 0 to 1) and cuts through black.
//
//  GREP MAP
//     grep -n 'function clearRect'   the part of the canvas that shows
//     grep -n 'function frame2d'     trace, accumulate, draw the 2D view
//     grep -n 'function frame3d'     step and draw the pool
//     grep -n 'function setView'     switch 2D and 3D
//     grep -n 'function setScene'    load a 2D scene and its defaults
//     grep -n 'function renderMath'  the equations for the current view
//     grep -n 'function bindPointer' drag, zoom, tap
//     grep -n 'function setOpen'     the panel, the phone sheet, the dock
//     grep -n 'const SHOTS2D'        the saver shots
//     grep -n 'window.snSaver'       the screensaver hook
// ============================================================================
import { SCENES, makeScene, trace, outline, mulberry, refract as refract2d } from './optics2d.js';
import { createRender2D } from './render2d.js';
import { createPool3D, CAUS_SRC } from './pool3d.js';
import { floatCaps } from './gl.js';
import { typeset } from '../../lib/sci-math.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const LAND_Q = matchMedia('(max-height:500px) and (orientation:landscape) and (pointer:coarse)');
const RULES = [['n', 'm1'], ['\\lambda', 'm2'], ['\\Delta n', 'm2'], ['J', 'm3'], ['E', 'm4'], ['d', 'm5'], ['h', 'm5'], ['\\theta', 'm6']];
const DEG = Math.PI / 180;
const TRACE_MS = PHONE_Q.matches ? 4 : 7;
const BINS = 96;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const ease = u => u * u * (3 - 2 * u);

const canvas = $('gl'), panel = $('panel');
const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });

const S = {
  view: '2d', playing: true, scene: 'cup',
  P: { ...SCENES[0].defaults, t: 0, mono: 0 },
  geom: true, curve: true, zoom: 1, pan: [0, 0], N: 4000, liveUntil: 0, viewKey: '',
  q: { el: 58, az: 135, depth: 1, amp: 1, n: 1.333, dn: 0.02, exp: 1, mode: 'rain', rays: false },
  cam: { yaw: 0.6, pitch: 0.85, dist: 2.8, ty: -0.35 },
  saver: null, last: 0,
};
const segs = new Float32Array(7 * 24000 * 9);
const bins = new Float32Array(BINS), curveAvg = new Float32Array(BINS);
let curveFrames = 0, outlineCache = null, outlineKey = '';
let r2d = null, pool = null;

// ── framing ─────────────────────────────────────────────────────────────────
// The clear part of the canvas, as insets in CSS px from each edge.
function clearRect() {
  const cr = canvas.getBoundingClientRect(), W = cr.width, H = cr.height;
  let l = 0, t = 0, r = 0, b = 0;
  if (S.saver) {
    const band = S.saver.band;
    if (band) { t = band.t; b = band.b; }
  } else {
    if (panel.classList.contains('open')) {
      const pr = panel.getBoundingClientRect();
      if (LAND_Q.matches) r = Math.max(0, cr.right - pr.left);
      else if (PHONE_Q.matches) b = Math.max(0, cr.bottom - pr.top);
      else l = Math.max(0, pr.right - cr.left);
    }
    const dock = $('dock');
    if (dock.offsetParent) { const dr = dock.getBoundingClientRect(); if (dr.top < cr.bottom - 1) b = Math.max(b, cr.bottom - dr.top); }
  }
  // a panel never leaves less than a third of the canvas (the saver
  // plate band can be smaller: about 240 px of 800)
  if (!S.saver && W - l - r < W / 3) { l = 0; r = 0; }
  if (!S.saver && H - t - b < H / 3) { t = 0; b = 0; }
  return { l, t, r, b, W, H };
}

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
    r2d.resize(w, h); pool.resize(w, h);
  }
}

// ── 2D ──────────────────────────────────────────────────────────────────────
function view2d(scene, c) {
  const v = scene.view, cw = Math.max(40, c.W - c.l - c.r), ch = Math.max(40, c.H - c.t - c.b);
  const dpr = canvas.width / Math.max(1, c.W);
  return { cx: v.cx + S.pan[0], cy: v.cy + S.pan[1], s: Math.min(cw / v.w, ch / v.h) * S.zoom * dpr,
    px: (c.l + cw / 2) * dpr, py: (c.t + ch / 2) * dpr, dpr };
}

function frame2d(now, dt, fade) {
  const P = S.P;
  const def = SCENES.find(s => s.id === S.scene);
  if (S.playing) P.t += dt;
  const scene = makeScene(S.scene, P);
  const c = clearRect(), view = view2d(scene, c);
  const key = [canvas.width, canvas.height, view.cx.toFixed(4), view.cy.toFixed(4), view.s.toFixed(3), view.px | 0, view.py | 0].join();
  const moving = key !== S.viewKey;
  if (moving && !S.saver && now > S.liveUntil) r2d.reset();
  if (moving) { S.viewKey = key; S.liveUntil = Math.max(S.liveUntil, now + 300); curveFrames = 0; }
  const live = scene.animated && S.playing || now < S.liveUntil || !!S.saver;
  // a still scene that has converged needs no more photons
  if (!live && r2d.frames > 900) return;
  if (scene.detector) { bins.fill(0); scene.detector.bins = bins; }
  const t0 = performance.now();
  const ns = trace(scene, S.N, Math.random, segs, P);
  const ms = performance.now() - t0;
  S.N = Math.round(clamp(S.N * clamp(Math.sqrt(TRACE_MS / Math.max(0.2, ms)), 0.8, 1.25), 800, 24000));
  const L = scene.light, width = L.type === 'beam' ? L.width : (L.a1 - L.a0) * 0.5;
  const oKey = scene.animated ? '' : S.scene + P.ang + P.n;
  if (scene.animated || oKey !== outlineKey) { outlineCache = outline(scene); outlineKey = oKey; }
  let curve = null;
  if (S.curve && !S.saver && scene.detector) curve = detectorCurve(scene, live);
  r2d.draw({ segs, ns, view, gain: width * view.s / S.N, exposure: P.exp, live, outline: outlineCache, geom: S.geom,
    curve, fade, marker: L.type === 'point' ? [L.x, L.y] : null });
  if (!S.saver && now - (S.capAt || 0) > 400) {
    S.capAt = now;
    $('caption').innerHTML = `<i>${def.name}</i> · <span class="n">${S.N.toLocaleString('en-US')}</span> photons a frame`;
  }
}

// The irradiance along the detector (floor or screen): a running mean of
// the bins, drawn as a curve that rises from the detector into the scene.
function detectorCurve(scene, live) {
  curveFrames++;
  const a = live ? 0.15 : Math.max(0.02, 1 / curveFrames);
  let mean = 0;
  for (let i = 0; i < BINS; i++) { curveAvg[i] += (bins[i] - curveAvg[i]) * a; mean += curveAvg[i] / BINS; }
  if (mean <= 0) return null;
  const d = scene.detector, v = scene.view;
  let nx = -(d.y1 - d.y0), ny = d.x1 - d.x0; const l = Math.hypot(nx, ny); nx /= l; ny /= l;
  const mx = (d.x0 + d.x1) / 2, my = (d.y0 + d.y1) / 2;
  if (nx * (v.cx - mx) + ny * (v.cy - my) < 0) { nx = -nx; ny = -ny; }
  const unit = 0.035 * v.h, top = 0.3 * v.h, pts = [];
  for (let i = 0; i < BINS; i++) {
    const u = (i + 0.5) / BINS, hgt = Math.min(top, curveAvg[i] / mean * unit);
    pts.push(d.x0 + (d.x1 - d.x0) * u + nx * hgt, d.y0 + (d.y1 - d.y0) * u + ny * hgt);
  }
  return pts;
}

// ── 3D ──────────────────────────────────────────────────────────────────────
function frame3d(now, dt, fade) {
  const c = clearRect(), q = S.q;
  const cw = Math.max(40, c.W - c.l - c.r), ch = Math.max(40, c.H - c.t - c.b);
  const shift = [((c.l + cw / 2) / c.W) * 2 - 1, 1 - ((c.t + ch / 2) / c.H) * 2];
  // widen the field so the pool fits the clear part, also when it is tall
  let tv = Math.tan(21 * DEG) * Math.max(1, 1.25 / (cw / ch)) * (c.H / ch);
  // the saver band is wide and short: the pool fills its height
  if (S.saver && S.saver.band) tv *= 0.55;
  pool.draw({ dt: S.playing ? dt : 0, cam: { ...S.cam, fov: 2 * Math.atan(tv) }, shift,
    sun: { el: q.el * DEG, az: q.az * DEG }, depth: q.depth, n: q.n, dn: q.dn,
    mode: S.playing ? q.mode : 'calm', amp: q.amp, rays: q.rays, exposure: q.exp, fade });
  if (!S.saver && now - (S.capAt || 0) > 400) {
    S.capAt = now;
    $('caption').innerHTML = `<i>Pool</i> · sun <span class="n">${q.el.toFixed(0)}°</span> · depth <span class="n">${q.depth.toFixed(2)}</span>`;
  }
}

// ── loop ────────────────────────────────────────────────────────────────────
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - (S.last || now)) / 1000); S.last = now;
  resize();
  let fade = 1;
  if (S.saver) fade = saverTick(now);
  if (S.view === '2d') frame2d(now, dt, fade); else frame3d(now, dt, fade);
}

// ── controls ────────────────────────────────────────────────────────────────
const SLIDERS2D = [['ang', v => v.toFixed(1) + '°'], ['n', v => v.toFixed(3)], ['dn', v => v.toFixed(3)], ['wave', v => v.toFixed(2)], ['exp', v => v.toFixed(2)]];
const SLIDERS3D = [['el', 'el', v => v.toFixed(1) + '°'], ['az', 'az', v => v.toFixed(0) + '°'], ['depth', 'depth', v => v.toFixed(2)],
  ['amp', 'amp', v => v.toFixed(2)], ['n3', 'n', v => v.toFixed(3)], ['dn3', 'dn', v => v.toFixed(3)], ['exp3', 'exp', v => v.toFixed(2)]];

function syncSliders() {
  for (const [id, f] of SLIDERS2D) { $(id).value = S.P[id]; $(id + 'V').textContent = f(S.P[id]); }
  for (const [id, k, f] of SLIDERS3D) { $(id).value = S.q[k]; $(id + 'V').textContent = f(S.q[k]); }
  $('waveRow').hidden = S.scene !== 'pool';
}

function setScene(id, keepParams) {
  const def = SCENES.find(s => s.id === id) || SCENES[0];
  S.scene = def.id;
  if (!keepParams) S.P = { ...def.defaults, t: S.P.t, mono: S.P.mono };
  S.zoom = 1; S.pan = [0, 0]; curveFrames = 0; curveAvg.fill(0); outlineKey = '';
  r2d.reset();
  document.querySelectorAll('#scenes .card').forEach(b => b.classList.toggle('on', b.dataset.id === def.id));
  $('sceneSub').textContent = def.sub;
  syncSliders(); renderMath(); dockText();
}

function setView(v) {
  S.view = v;
  document.querySelectorAll('#viewSeg button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  $('ctl2d').hidden = v !== '2d'; $('ctl3d').hidden = v !== '3d';
  if (v === '2d') { r2d.reset(); S.viewKey = ''; }
  renderMath(); dockText();
}

function dockText() {
  $('dockView').textContent = S.view === '2d' ? '3D' : '2D';
  $('dockName').textContent = S.view === '2d' ? SCENES.find(s => s.id === S.scene).name : { rain: 'Rain', swell: 'Swell', calm: 'Calm' }[S.q.mode];
  const on = S.view === '2d' ? S.geom : S.q.rays;
  $('dockGeom').classList.toggle('on', on); $('dockGeom').setAttribute('aria-pressed', String(on));
  $('dockGeom').setAttribute('aria-label', S.view === '2d' ? 'Outlines' : 'Photon paths');
  $('dockPlay').textContent = S.playing ? '❚❚' : '▶';
  $('playBtn').textContent = S.playing ? 'Pause' : 'Play';
}

function setPlaying(p) { S.playing = p; dockText(); }
function setGeom(on) { S.geom = on; $('geomBtn').classList.toggle('on', on); dockText(); }
function setRays(on) { S.q.rays = on; $('raysBtn').classList.toggle('on', on); dockText(); }
function setMode(m) { S.q.mode = m; document.querySelectorAll('#waveSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === m)); dockText(); }
function clearAll() { if (S.view === '2d') { r2d.reset(); curveFrames = 0; curveAvg.fill(0); } else pool.flatten(); }

function bindUI() {
  const box = $('scenes');
  for (const s of SCENES) {
    const b = document.createElement('button'); b.className = 'card'; b.dataset.id = s.id; b.textContent = s.name;
    b.addEventListener('click', () => setScene(s.id)); box.append(b);
  }
  for (const [id, f] of SLIDERS2D) $(id).addEventListener('input', () => {
    S.P[id] = +$(id).value; $(id + 'V').textContent = f(S.P[id]); S.liveUntil = performance.now() + 300; outlineKey = '';
    if (id === 'n' || id === 'dn') renderMath();
  });
  for (const [id, k, f] of SLIDERS3D) $(id).addEventListener('input', () => { S.q[k] = +$(id).value; $(id + 'V').textContent = f(S.q[k]); });
  document.querySelectorAll('#viewSeg button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  document.querySelectorAll('#specSeg button').forEach(b => b.addEventListener('click', () => {
    S.P.mono = +b.dataset.mono; document.querySelectorAll('#specSeg button').forEach(x => x.classList.toggle('on', x === b)); r2d.reset();
  }));
  document.querySelectorAll('#waveSeg button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('geomBtn').addEventListener('click', () => setGeom(!S.geom));
  $('curveBtn').addEventListener('click', () => { S.curve = !S.curve; $('curveBtn').classList.toggle('on', S.curve); });
  $('raysBtn').addEventListener('click', () => setRays(!S.q.rays));
  $('splashBtn').addEventListener('click', () => pool.drop((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, 0.12, 0.05 * S.q.amp));
  $('playBtn').addEventListener('click', () => setPlaying(!S.playing));
  $('dockPlay').addEventListener('click', () => setPlaying(!S.playing));
  $('clearBtn').addEventListener('click', clearAll);
  $('dockView').addEventListener('click', () => setView(S.view === '2d' ? '3d' : '2d'));
  $('dockScene').addEventListener('click', () => {
    if (S.view === '2d') { const i = SCENES.findIndex(s => s.id === S.scene); setScene(SCENES[(i + 1) % SCENES.length].id); }
    else { const m = ['rain', 'swell', 'calm']; setMode(m[(m.indexOf(S.q.mode) + 1) % 3]); }
  });
  $('dockGeom').addEventListener('click', () => { if (S.view === '2d') setGeom(!S.geom); else setRays(!S.q.rays); });
  for (const el of document.querySelectorAll('.sci-sym[data-tex]')) {
    const tex = el.dataset.tex, cls = RULES.find(q => q[0] === tex);
    typeset(el, tex, { display: false, rules: cls ? [cls] : null });
  }
}

function bindKeys() {
  addEventListener('keydown', e => {
    if (S.saver || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input,select,textarea') && e.key !== ' ') return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); setPlaying(!S.playing); }
    else if (k === 'c') clearAll();
    else if (k === 'v') setView(S.view === '2d' ? '3d' : '2d');
    else if (/^[1-7]$/.test(k)) { setView('2d'); setScene(SCENES[+k - 1].id); }
  });
}

// ── pointer ─────────────────────────────────────────────────────────────────
// 2D: a drag turns the light, wheel or pinch zooms about the pointer, a
// double-click resets. 3D: a drag orbits, wheel or pinch zooms, a tap on
// the water drops a ripple.
function bindPointer() {
  const pts = new Map();
  let start = null, pinch0 = null;
  const world = (x, y) => {
    const cr = canvas.getBoundingClientRect(), scene = makeScene(S.scene, S.P), v = view2d(scene, clearRect());
    const dpr = v.dpr, px = (x - cr.left) * dpr, py = (y - cr.top) * dpr;
    return [v.cx + (px - v.px) / v.s, v.cy - (py - v.py) / v.s, v];
  };
  const zoomAt = (x, y, f) => {
    if (S.view === '3d') { S.cam.dist = clamp(S.cam.dist / f, 1.1, 7); return; }
    const [wx, wy] = world(x, y);
    S.zoom = clamp(S.zoom * f, 0.5, 12);
    const [wx2, wy2] = world(x, y);
    S.pan[0] += wx - wx2; S.pan[1] += wy - wy2;
  };
  canvas.addEventListener('pointerdown', e => {
    if (S.saver) return;
    try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* ok */ }
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) start = { x: e.clientX, y: e.clientY, ang: S.P.ang, yaw: S.cam.yaw, pitch: S.cam.pitch, moved: false, t: performance.now() };
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); start = null; }
    canvas.classList.add('drag');
  });
  canvas.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2 && pinch0) {
      const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, d / pinch0); pinch0 = d; S.liveUntil = performance.now() + 300;
      return;
    }
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (Math.hypot(dx, dy) > 4) start.moved = true;
    if (!start.moved) return;
    const w = canvas.clientWidth;
    if (S.view === '2d') {
      S.P.ang = clamp(start.ang + dx / w * 80, -40, 40);
      $('ang').value = S.P.ang; $('angV').textContent = S.P.ang.toFixed(1) + '°';
      S.liveUntil = performance.now() + 300;
    } else {
      S.cam.yaw = start.yaw - dx / w * 4;
      S.cam.pitch = clamp(start.pitch + dy / canvas.clientHeight * 2.5, 0.25, 1.5);
    }
  });
  const up = e => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch0 = null;
    if (start && !start.moved && S.view === '3d' && performance.now() - start.t < 500) {
      const cr = canvas.getBoundingClientRect();
      const hit = pool.pick((e.clientX - cr.left) / cr.width * 2 - 1, 1 - (e.clientY - cr.top) / cr.height * 2);
      if (hit) pool.drop(hit[0], hit[1], 0.06, 0.035 * Math.max(0.3, S.q.amp));
    }
    if (!pts.size) { start = null; canvas.classList.remove('drag'); }
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => {
    if (S.saver) return;
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); S.liveUntil = performance.now() + 300;
  }, { passive: false });
  canvas.addEventListener('dblclick', () => { if (S.view === '2d') { S.zoom = 1; S.pan = [0, 0]; } else S.cam = { yaw: 0.6, pitch: 0.85, dist: 2.8, ty: -0.35 }; });
}

// ── panel ───────────────────────────────────────────────────────────────────
function setOpen(open) {
  panel.classList.toggle('open', open);
  if (!open) panel.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  $('dockPanel').classList.toggle('on', open);
  $('dockPanel').setAttribute('aria-expanded', String(open));
}
function bindPanel() {
  const toggle = () => setOpen(!panel.classList.contains('open'));
  $('gear').addEventListener('click', toggle);
  $('dockPanel').addEventListener('click', toggle);
  $('panelClose').addEventListener('click', () => setOpen(false));
  PHONE_Q.addEventListener('change', e => setOpen(!e.matches));
  // The grip of the phone sheet: a tap switches half and full height, a
  // drag up gives full height, a drag down gives half height, then closes.
  const grip = $('sheetGrip'); let gy = null;
  grip.addEventListener('pointerdown', e => { gy = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* ok */ } });
  grip.addEventListener('pointerup', e => {
    if (gy === null) return;
    const dy = e.clientY - gy; gy = null;
    if (Math.abs(dy) < 8) panel.classList.toggle('full');
    else if (dy < -40) panel.classList.add('full');
    else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
  });
  grip.addEventListener('pointercancel', () => { gy = null; });
}

// ── equations ───────────────────────────────────────────────────────────────
const TEX = {
  ray: String.raw`\mathbf{x}(\xi,s)=\mathbf{x}_0(\xi)+s\,\hat{\mathbf{d}}(\xi),\qquad J=\det\frac{\partial\mathbf{x}}{\partial(\xi,s)}=0`,
  snell: String.raw`n_1\sin\theta_1=n_2\sin\theta_2,\qquad E\propto\frac{1}{|J|}`,
  cup: String.raw`x=\tfrac{a}{4}\left(3\cos t-\cos 3t\right),\quad y=\tfrac{a}{4}\left(3\sin t-\sin 3t\right)`,
  cardioid: String.raw`r=\tfrac{2a}{3}\left(1+\cos\phi\right)\quad\text{(from the source)}`,
  drop: String.raw`D(\theta)=\pi+2\theta-4\arcsin\frac{\sin\theta}{n},\qquad \frac{dD}{d\theta}=0\;\Rightarrow\;D\approx 138^\circ`,
  lens: String.raw`f_0=\frac{a}{n-1},\qquad f(y)<f_0\ \text{for rays at height } y`,
  pool: String.raw`E=\frac{E_0}{\left|1+\left(1-\frac{1}{n}\right)d\,h''(x)\right|}`,
  prism: String.raw`\delta=\theta_1+\theta_4-\alpha,\qquad n(\lambda)\approx A+\frac{B}{\lambda^2}`,
  marbles: String.raw`f=\frac{n\,a}{2(n-1)}\quad\text{(from the centre of a ball)}`,
  t3: String.raw`\mathbf{T}=\eta\,\mathbf{L}+\left(\eta\cos\theta_i-\cos\theta_t\right)\mathbf{N},\qquad \eta=\frac{1}{n}`,
  e3: String.raw`E=E_0\,T_F(\theta_i)\,\frac{|dA_0|}{|dA|}`,
  w3: String.raw`v\leftarrow\gamma\left(v+2(\bar h-h)\right),\qquad h\leftarrow h+v`,
};
const EQ_TEXT = {
  ray: 'x(ξ, s) = x₀(ξ) + s d(ξ),  J = det ∂x/∂(ξ, s) = 0', snell: 'n₁ sin θ₁ = n₂ sin θ₂,  E ∝ 1/|J|',
  cup: 'x = a/4 (3 cos t − cos 3t),  y = a/4 (3 sin t − sin 3t)', cardioid: 'r = 2a/3 (1 + cos φ)',
  drop: 'D(θ) = π + 2θ − 4 arcsin(sin θ / n),  D ≈ 138°', lens: 'f₀ = a / (n − 1),  f(y) < f₀',
  pool: 'E = E₀ / |1 + (1 − 1/n) d h″(x)|', prism: 'δ = θ₁ + θ₄ − α,  n(λ) ≈ A + B/λ²', marbles: 'f = n a / (2(n − 1))',
  t3: 'T = η L + (η cos θi − cos θt) N,  η = 1/n', e3: 'E = E₀ T_F(θi) |dA₀| / |dA|', w3: 'v ← γ(v + 2(h̄ − h)),  h ← h + v',
};
function mathKeys() { return S.view === '2d' ? ['ray', 'snell', S.scene] : ['t3', 'e3', 'w3']; }
function renderMath() {
  const k = mathKeys();
  ['eqA', 'eqB', 'eqC'].forEach((id, i) => typeset($(id), TEX[k[i]], { rules: RULES }));
}

// ── screensaver ─────────────────────────────────────────────────────────────
// 2D shots: scene, zoom from-to (toward the scene focus), light angle
// from-to, and parameter overrides. 3D shots: camera from-to, sun from-to
// (degrees), waves, photon paths, dispersion.
const SHOTS2D = [
  { scene: 'cup', zoom: [1, 1.15], ang: [-8, 8] },
  { scene: 'cup', zoom: [1.5, 2.6], ang: [0, 0], sub: 'Close on the cusp: the paraxial rays meet at a / 2' },
  { scene: 'cardioid', zoom: [1, 1.2], ang: [-15, 15] },
  { scene: 'drop', zoom: [1, 1.2], ang: [-5, 5], P: { dn: 0.08 } },
  { scene: 'lens', zoom: [1.4, 2.5], ang: [0, 0], sub: 'The cusp of the lens caustic: edge rays cross the axis first' },
  { scene: 'pool', zoom: [1, 1.35], ang: [-6, 6] },
  { scene: 'prism', zoom: [1, 1.5], ang: [-3, 3] },
  { scene: 'marbles', zoom: [1, 1.2], ang: [-6, 6] },
];
const SHOTS3D = [
  { name: 'The net of light', sub: 'Each wave crest is a weak lens; where it focuses at the floor, a bright line', cam: [[0, 0.95, 2.9, -0.35], [0.35, 0.85, 2.5, -0.4]], sun: [[58, 0], [58, 15]], mode: 'rain' },
  { name: 'On the floor', sub: 'Close in: the folds of the light sheet, as lines and cusps', cam: [[0, 1.25, 2.0, -0.85], [0.15, 1.3, 1.35, -0.9]], sun: [[70, 0], [70, 10]], mode: 'rain' },
  { name: 'Low sun', sub: 'A low sun stretches the net and the wall throws a long shadow', cam: [[0, 0.62, 2.9, -0.35], [-0.3, 0.6, 2.7, -0.4]], sun: [[30, 0], [24, 20]], mode: 'rain' },
  { name: 'Photon paths', sub: 'Each ray from the sun bends at the surface, by Snell’s law, toward the floor', cam: [[0, 0.42, 3.1, -0.3], [0.3, 0.46, 2.9, -0.35]], sun: [[55, -20], [55, 20]], mode: 'swell', rays: true },
  { name: 'Colour fringes', sub: 'Each colour has its own index: the lines split into colour at their edges', cam: [[0, 1.3, 1.5, -0.9], [0.1, 1.32, 1.15, -0.95]], sun: [[62, 0], [62, 8]], mode: 'rain', dn: 0.09 },
  { name: 'High noon', sub: 'The sun nearly overhead: no wall shadow, the whole floor in play', cam: [[0, 1.0, 2.6, -0.4], [0.4, 1.05, 2.3, -0.45]], sun: [[85, 0], [84, 30]], mode: 'rain' },
];

function saverPlate() {
  const sv = S.saver; if (!sv || !sv.label || !sv.shot) return;
  const sh = sv.shot, f = (v, d = 3) => Number(v).toFixed(d);
  if (sh.view === '2d') {
    const def = SCENES.find(s => s.id === sh.scene), P = S.P;
    const params = [{ sym: 'n', name: 'index at 589 nm', value: f(P.n) }];
    if (P.dn > 0) params.push({ sym: '\\Delta n', name: 'index split, 400 to 700 nm', value: f(P.dn) });
    params.push({ sym: '\\theta', name: 'light angle', value: f(P.ang, 1) + '°' }, { sym: 'N', name: 'photons a frame', value: S.N.toLocaleString('en-US') });
    sv.label({ title: 'Photon Caustics · ' + def.name, sub: sh.sub || def.sub, tex: [TEX.ray, TEX[sh.scene]], rules: RULES,
      eq: [EQ_TEXT.ray, EQ_TEXT[sh.scene]], params,
      code: { lang: 'js', name: 'optics2d.js · refract', text: refract2d.toString() } });
  } else {
    const q = S.q, body = CAUS_SRC.slice(CAUS_SRC.indexOf('float area'));
    sv.label({ title: 'Photon Caustics · ' + sh.name, sub: sh.sub, tex: [TEX.e3, TEX.t3], rules: RULES, eq: [EQ_TEXT.e3, EQ_TEXT.t3],
      params: [{ sym: '\\theta_s', name: 'sun height', value: f(q.el, 0) + '°' }, { sym: 'd', name: 'depth', value: f(q.depth, 2) },
        { sym: 'n', name: 'index of water', value: f(q.n) }, { sym: '\\Delta n', name: 'index split (shown large)', value: f(q.dn) }],
      code: { lang: 'glsl', name: 'pool3d.js · caustic area ratio', text: body.trim() } });
  }
}

function nextShot(now) {
  const sv = S.saver;
  sv.i++;
  const want = (sv.i + sv.first) % 2 === 0 ? '2d' : '3d';
  const list = want === '2d' ? sv.list2 : sv.list3, sh = { ...list[Math.floor(sv.i / 2) % list.length], view: want };
  sv.shot = sh; sv.t0 = now;
  if (want === '2d') {
    setView('2d'); setScene(sh.scene);
    Object.assign(S.P, sh.P || {});
    sh.ang0 = sh.ang[0] + (sv.rnd() - 0.5) * 6; sh.ang1 = sh.ang[1] + (sv.rnd() - 0.5) * 6;
  } else {
    setView('3d');
    sh.yaw0 = sv.rnd() * Math.PI * 2; sh.az0 = sv.rnd() * 360;
    S.q.mode = sh.mode; S.q.rays = !!sh.rays; S.q.dn = sh.dn ?? 0.02; S.q.depth = 1; S.q.amp = 1; S.q.n = 1.333; S.q.exp = 1;
  }
  saverPlate();
}

function saverTick(now) {
  const sv = S.saver;
  if (sv.bandFn && now - sv.bandAt > 500) { sv.bandAt = now; try { sv.band = sv.bandFn(canvas.clientHeight); } catch (e) { sv.band = null; } }
  if (!sv.shot || now - sv.t0 >= sv.hold) nextShot(now);
  const sh = sv.shot, el = now - sv.t0, u = ease(clamp(el / sv.hold, 0, 1));
  if (sh.view === '2d') {
    const scene = makeScene(sh.scene, S.P), fz = scene.focus, v = scene.view;
    S.zoom = lerp(sh.zoom[0], sh.zoom[1], u);
    // pan toward the focus as the zoom grows past 1
    const k = clamp((S.zoom - 1) / 1.5, 0, 1);
    S.pan = [(fz.x - v.cx) * k, (fz.y - v.cy) * k];
    S.P.ang = lerp(sh.ang0, sh.ang1, u);
  } else {
    const [c0, c1] = sh.cam, [s0, s1] = sh.sun;
    S.cam = { yaw: sh.yaw0 + lerp(c0[0], c1[0], u), pitch: lerp(c0[1], c1[1], u), dist: lerp(c0[2], c1[2], u), ty: lerp(c0[3], c1[3], u) };
    S.q.el = lerp(s0[0], s1[0], u); S.q.az = sh.az0 + lerp(s0[1], s1[1], u);
  }
  if (now - sv.plateAt > 1000) { sv.plateAt = now; saverPlate(); }
  return clamp(Math.min(el / 600, (sv.hold - el) / 450), 0, 1);
}

window.snSaver = {
  enter(o = {}) {
    const calm = clamp(o.calm ?? 0.7, 0, 1), rnd = mulberry((o.seed >>> 0) || 1);
    const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    S.saver = { label: typeof o.label === 'function' ? o.label : null, rnd, list2: shuffle(SHOTS2D), list3: shuffle(SHOTS3D),
      first: rnd() < 0.5 ? 0 : 1, i: -1, shot: null, t0: 0, hold: (7 + 3 * calm) * 1000, plateAt: 0, bandFn: null, band: null, bandAt: 0,
      prev: { view: S.view, scene: S.scene, P: { ...S.P }, q: { ...S.q }, cam: { ...S.cam }, playing: S.playing, open: panel.classList.contains('open') } };
    document.documentElement.classList.add('saver');
    S.playing = true;
    import('../../lib/saver-clear.js').then(m => { if (S.saver) S.saver.bandFn = m.plateBand; }).catch(() => { /* no band: centre */ });
    return { canvas, warmupMs: 1500 };
  },
  exit() {
    const sv = S.saver; if (!sv) return;
    if (sv.label) sv.label(null);
    S.saver = null;
    document.documentElement.classList.remove('saver');
    const p = sv.prev;
    S.q = p.q; S.cam = p.cam; S.playing = p.playing;
    setView(p.view); setScene(p.scene); S.P = p.P; syncSliders(); setMode(S.q.mode); setRays(S.q.rays);
    setOpen(p.open);
  },
};

// ── boot ────────────────────────────────────────────────────────────────────
if (!gl) {
  $('nogl').hidden = false;
} else {
  const caps = floatCaps(gl);
  r2d = createRender2D(gl, caps);
  pool = createPool3D(gl, caps, { phone: PHONE_Q.matches });
  bindUI(); bindKeys(); bindPointer(); bindPanel();
  if (PHONE_Q.matches) setOpen(false);
  resize();
  setScene('cup');
  setView(/3d/i.test(location.hash) ? '3d' : '2d');
  requestAnimationFrame(frame);
  window.__caustics = { S, setScene, setView, SCENES, booted: true, float: caps.float };
}
