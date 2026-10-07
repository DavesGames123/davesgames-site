// ============================================================================
//  PHOTON CAUSTICS 2D  ·  main.js — layout, controls, the loop, the saver hook
// ----------------------------------------------------------------------------
//  One WebGL2 canvas (#gl) shows the 2D photon tracer. optics2d.js traces
//  photons on the CPU each frame; render2d.js adds their paths into a
//  light image. The photon count adapts to keep the trace near TRACE_MS.
//  A still scene converges (running mean); a moving one (waves, marbles,
//  a drag, the saver) keeps a short memory (A_LIVE in render2d.js).
//  The 3D pool is a separate page: ../photon-caustics-3d/.
//
//  FRAMING. clearRect() gives the part of the canvas that no panel, dock
//  or saver plate covers. The view fits the scene there.
//
//  SAVER. window.snSaver plays shots: the scenes with slow push-ins and
//  light turns, shuffled by the seed. A shot holds 7 to 10 s (calm 0 to
//  1) and cuts through black.
//
//  GREP MAP
//     grep -n 'function clearRect'   the part of the canvas that shows
//     grep -n 'function frame2d'     trace, accumulate, draw the view
//     grep -n 'function setScene'    load a scene and its defaults
//     grep -n 'function renderMath'  the equations for the current scene
//     grep -n 'function bindPointer' drag, zoom, tap
//     grep -n 'function setOpen'     the panel, the phone sheet, the dock
//     grep -n 'const SHOTS'          the saver shots
//     grep -n 'window.snSaver'       the screensaver hook
// ============================================================================
import { SCENES, makeScene, trace, outline, mulberry, refract as refract2d } from './optics2d.js';
import { createRender2D } from './render2d.js';
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
  playing: true, scene: 'cup',
  P: { ...SCENES[0].defaults, t: 0, mono: 0 },
  geom: true, curve: true, zoom: 1, pan: [0, 0], N: 4000, liveUntil: 0, viewKey: '',
  saver: null, last: 0,
};
const segs = new Float32Array(7 * 24000 * 9);
const bins = new Float32Array(BINS), curveAvg = new Float32Array(BINS);
let curveFrames = 0, outlineCache = null, outlineKey = '';
let r2d = null;

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
    r2d.resize(w, h);
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

// ── loop ────────────────────────────────────────────────────────────────────
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - (S.last || now)) / 1000); S.last = now;
  resize();
  let fade = 1;
  if (S.saver) fade = saverTick(now);
  frame2d(now, dt, fade);
}

// ── controls ────────────────────────────────────────────────────────────────
const SLIDERS2D = [['ang', v => v.toFixed(1) + '°'], ['n', v => v.toFixed(3)], ['dn', v => v.toFixed(3)], ['wave', v => v.toFixed(2)], ['exp', v => v.toFixed(2)]];

function syncSliders() {
  for (const [id, f] of SLIDERS2D) { $(id).value = S.P[id]; $(id + 'V').textContent = f(S.P[id]); }
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

function dockText() {
  $('dockName').textContent = SCENES.find(s => s.id === S.scene).name;
  $('dockGeom').classList.toggle('on', S.geom); $('dockGeom').setAttribute('aria-pressed', String(S.geom));
  $('dockPlay').textContent = S.playing ? '❚❚' : '▶';
  $('playBtn').textContent = S.playing ? 'Pause' : 'Play';
}

function setPlaying(p) { S.playing = p; dockText(); }
function setGeom(on) { S.geom = on; $('geomBtn').classList.toggle('on', on); dockText(); }
function clearAll() { r2d.reset(); curveFrames = 0; curveAvg.fill(0); }

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
  document.querySelectorAll('#specSeg button').forEach(b => b.addEventListener('click', () => {
    S.P.mono = +b.dataset.mono; document.querySelectorAll('#specSeg button').forEach(x => x.classList.toggle('on', x === b)); r2d.reset();
  }));
  $('geomBtn').addEventListener('click', () => setGeom(!S.geom));
  $('curveBtn').addEventListener('click', () => { S.curve = !S.curve; $('curveBtn').classList.toggle('on', S.curve); });
  $('playBtn').addEventListener('click', () => setPlaying(!S.playing));
  $('dockPlay').addEventListener('click', () => setPlaying(!S.playing));
  $('clearBtn').addEventListener('click', clearAll);
  $('dockScene').addEventListener('click', () => { const i = SCENES.findIndex(s => s.id === S.scene); setScene(SCENES[(i + 1) % SCENES.length].id); });
  $('dockGeom').addEventListener('click', () => setGeom(!S.geom));
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
    else if (/^[1-9]$/.test(k) && SCENES[+k - 1]) setScene(SCENES[+k - 1].id);
  });
}

// ── pointer ─────────────────────────────────────────────────────────────────
// A drag turns the light, wheel or pinch zooms about the pointer, a
// double-click resets.
function bindPointer() {
  const pts = new Map();
  let start = null, pinch0 = null;
  const world = (x, y) => {
    const cr = canvas.getBoundingClientRect(), scene = makeScene(S.scene, S.P), v = view2d(scene, clearRect());
    const dpr = v.dpr, px = (x - cr.left) * dpr, py = (y - cr.top) * dpr;
    return [v.cx + (px - v.px) / v.s, v.cy - (py - v.py) / v.s, v];
  };
  const zoomAt = (x, y, f) => {
    const [wx, wy] = world(x, y);
    S.zoom = clamp(S.zoom * f, 0.5, 12);
    const [wx2, wy2] = world(x, y);
    S.pan[0] += wx - wx2; S.pan[1] += wy - wy2;
  };
  canvas.addEventListener('pointerdown', e => {
    if (S.saver) return;
    try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* ok */ }
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) start = { x: e.clientX, y: e.clientY, ang: S.P.ang, moved: false, t: performance.now() };
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
    S.P.ang = clamp(start.ang + dx / w * 80, -40, 40);
    $('ang').value = S.P.ang; $('angV').textContent = S.P.ang.toFixed(1) + '°';
    S.liveUntil = performance.now() + 300;
  });
  const up = e => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch0 = null;
    if (!pts.size) { start = null; canvas.classList.remove('drag'); }
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => {
    if (S.saver) return;
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); S.liveUntil = performance.now() + 300;
  }, { passive: false });
  canvas.addEventListener('dblclick', () => { S.zoom = 1; S.pan = [0, 0]; });
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
};
const EQ_TEXT = {
  ray: 'x(ξ, s) = x₀(ξ) + s d(ξ),  J = det ∂x/∂(ξ, s) = 0', snell: 'n₁ sin θ₁ = n₂ sin θ₂,  E ∝ 1/|J|',
  cup: 'x = a/4 (3 cos t − cos 3t),  y = a/4 (3 sin t − sin 3t)', cardioid: 'r = 2a/3 (1 + cos φ)',
  drop: 'D(θ) = π + 2θ − 4 arcsin(sin θ / n),  D ≈ 138°', lens: 'f₀ = a / (n − 1),  f(y) < f₀',
  pool: 'E = E₀ / |1 + (1 − 1/n) d h″(x)|', prism: 'δ = θ₁ + θ₄ − α,  n(λ) ≈ A + B/λ²', marbles: 'f = n a / (2(n − 1))',
};
function mathKeys() { return ['ray', 'snell', S.scene]; }
function renderMath() {
  const k = mathKeys();
  ['eqA', 'eqB', 'eqC'].forEach((id, i) => typeset($(id), TEX[k[i]], { rules: RULES }));
}

// ── screensaver ─────────────────────────────────────────────────────────────
// A shot: scene, zoom from-to (toward the scene focus), light angle
// from-to, and parameter overrides.
const SHOTS = [
  { scene: 'cup', zoom: [1, 1.15], ang: [-8, 8] },
  { scene: 'cup', zoom: [1.5, 2.6], ang: [0, 0], sub: 'Close on the cusp: the paraxial rays meet at a / 2' },
  { scene: 'cardioid', zoom: [1, 1.2], ang: [-15, 15] },
  { scene: 'drop', zoom: [1, 1.2], ang: [-5, 5], P: { dn: 0.08 } },
  { scene: 'lens', zoom: [1.4, 2.5], ang: [0, 0], sub: 'The cusp of the lens caustic: edge rays cross the axis first' },
  { scene: 'pool', zoom: [1, 1.35], ang: [-6, 6] },
  { scene: 'prism', zoom: [1, 1.5], ang: [-3, 3] },
  { scene: 'marbles', zoom: [1, 1.2], ang: [-6, 6] },
];
function saverPlate() {
  const sv = S.saver; if (!sv || !sv.label || !sv.shot) return;
  const sh = sv.shot, f = (v, d = 3) => Number(v).toFixed(d);
  const def = SCENES.find(s => s.id === sh.scene), P = S.P;
  const params = [{ sym: 'n', name: 'index at 589 nm', value: f(P.n) }];
  if (P.dn > 0) params.push({ sym: '\\Delta n', name: 'index split, 400 to 700 nm', value: f(P.dn) });
  params.push({ sym: '\\theta', name: 'light angle', value: f(P.ang, 1) + '°' }, { sym: 'N', name: 'photons a frame', value: S.N.toLocaleString('en-US') });
  sv.label({ title: 'Photon Caustics 2D · ' + def.name, sub: sh.sub || def.sub, tex: [TEX.ray, TEX[sh.scene]], rules: RULES,
    eq: [EQ_TEXT.ray, EQ_TEXT[sh.scene]], params,
    code: { lang: 'js', name: 'optics2d.js · refract', text: refract2d.toString() } });
}

function nextShot(now) {
  const sv = S.saver;
  sv.i++;
  const sh = { ...sv.list[sv.i % sv.list.length] };
  sv.shot = sh; sv.t0 = now;
  setScene(sh.scene);
  Object.assign(S.P, sh.P || {});
  sh.ang0 = sh.ang[0] + (sv.rnd() - 0.5) * 6; sh.ang1 = sh.ang[1] + (sv.rnd() - 0.5) * 6;
  saverPlate();
}

function saverTick(now) {
  const sv = S.saver;
  if (sv.bandFn && now - sv.bandAt > 500) { sv.bandAt = now; try { sv.band = sv.bandFn(canvas.clientHeight); } catch (e) { sv.band = null; } }
  if (!sv.shot || now - sv.t0 >= sv.hold) nextShot(now);
  const sh = sv.shot, el = now - sv.t0, u = ease(clamp(el / sv.hold, 0, 1));
  const scene = makeScene(sh.scene, S.P), fz = scene.focus, v = scene.view;
  S.zoom = lerp(sh.zoom[0], sh.zoom[1], u);
  // pan toward the focus as the zoom grows past 1
  const k = clamp((S.zoom - 1) / 1.5, 0, 1);
  S.pan = [(fz.x - v.cx) * k, (fz.y - v.cy) * k];
  S.P.ang = lerp(sh.ang0, sh.ang1, u);
  if (now - sv.plateAt > 1000) { sv.plateAt = now; saverPlate(); }
  return clamp(Math.min(el / 600, (sv.hold - el) / 450), 0, 1);
}

window.snSaver = {
  enter(o = {}) {
    const calm = clamp(o.calm ?? 0.7, 0, 1), rnd = mulberry((o.seed >>> 0) || 1);
    const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    S.saver = { label: typeof o.label === 'function' ? o.label : null, rnd, list: shuffle(SHOTS),
      i: -1, shot: null, t0: 0, hold: (7 + 3 * calm) * 1000, plateAt: 0, bandFn: null, band: null, bandAt: 0,
      prev: { scene: S.scene, P: { ...S.P }, zoom: S.zoom, pan: S.pan.slice(), playing: S.playing, open: panel.classList.contains('open') } };
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
    S.playing = p.playing;
    setScene(p.scene); S.P = p.P; S.zoom = p.zoom; S.pan = p.pan; syncSliders(); dockText();
    setOpen(p.open);
  },
};

// ── boot ────────────────────────────────────────────────────────────────────
if (!gl) {
  $('nogl').hidden = false;
} else {
  const caps = floatCaps(gl);
  r2d = createRender2D(gl, caps);
  bindUI(); bindKeys(); bindPointer(); bindPanel();
  if (PHONE_Q.matches) setOpen(false);
  resize();
  setScene('cup');
  requestAnimationFrame(frame);
  window.__caustics = { S, setScene, SCENES, booted: true, float: caps.float };
}
