// ============================================================================
//  POOL CAUSTICS 3D  ·  main.js — layout, controls, the loop, the saver hook
// ----------------------------------------------------------------------------
//  One WebGL2 canvas (#gl) shows a pool in the sun. pool3d.js steps the
//  waves, refracts a photon grid to the floor and draws the pool and its
//  caustics. The 2D photon tracer is a separate page: ../photon-caustics/.
//
//  FRAMING. clearRect() gives the part of the canvas that no panel, dock
//  or saver plate covers. frame() shifts the projection centre there and
//  widens the field of view, so the pool is centred in that part.
//
//  SLOW WAVES. S.q.ws (wave speed, 0..1 of the old speed) and S.q.ts (time
//  scale) go to pool3d.waveSteps. The defaults WS0 and TS0 make the water
//  move at about a fifth of the old speed.
//
//  SAVER. window.snSaver plays calm pool shots with slow camera moves, sun
//  moves and wave modes, shuffled by the seed. A shot holds 7 to 10 s
//  (calm 0 to 1) and cuts through black.
//
//  GREP MAP
//     grep -n 'function clearRect'   the part of the canvas that shows
//     grep -n 'function frame'       step and draw the pool
//     grep -n 'function renderMath'  the equations
//     grep -n 'function bindPointer' orbit, zoom, tap
//     grep -n 'function setOpen'     the panel, the phone sheet, the dock
//     grep -n 'const SHOTS'          the saver shots
//     grep -n 'window.snSaver'       the screensaver hook
// ============================================================================
import { createPool3D, CAUS_SRC, SIM_SRC, WAVE_V0 } from './pool3d.js';
import { floatCaps } from './gl.js';
import { typeset } from '../../lib/sci-math.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const LAND_Q = matchMedia('(max-height:500px) and (orientation:landscape) and (pointer:coarse)');
const RULES = [['n', 'm1'], ['\\lambda', 'm2'], ['\\Delta n', 'm2'], ['J', 'm3'], ['E', 'm4'], ['d', 'm5'], ['h', 'm5'], ['\\theta', 'm6']];
const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const ease = u => u * u * (3 - 2 * u);
const CAM0 = { yaw: 0.6, pitch: 0.85, dist: 2.8, ty: -0.35 };
// the default wave speed and time scale: 0.3 x 0.6 = 0.18 of the old speed
const WS0 = 0.3, TS0 = 0.6;

const canvas = $('gl'), panel = $('panel');
const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });

const S = {
  playing: true,
  q: { el: 58, az: 135, depth: 1, amp: 1, n: 1.333, dn: 0.02, exp: 1, mode: 'rain', rays: false, ws: WS0, ts: TS0 },
  cam: { ...CAM0 },
  saver: null, last: 0,
};
let pool = null;

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
    // the dock is position: fixed, so offsetParent is null: test the box
    if (dock.getClientRects().length) { const dr = dock.getBoundingClientRect(); if (dr.top < cr.bottom - 1) b = Math.max(b, cr.bottom - dr.top); }
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
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; pool.resize(w, h); }
}

// ── the loop ────────────────────────────────────────────────────────────────
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - (S.last || now)) / 1000); S.last = now;
  resize();
  const fade = S.saver ? saverTick(now) : 1;
  const c = clearRect(), q = S.q;
  const cw = Math.max(40, c.W - c.l - c.r), ch = Math.max(40, c.H - c.t - c.b);
  const shift = [((c.l + cw / 2) / c.W) * 2 - 1, 1 - ((c.t + ch / 2) / c.H) * 2];
  // widen the field so the pool fits the clear part, also when it is tall
  let tv = Math.tan(21 * DEG) * Math.max(1, 1.25 / (cw / ch)) * (c.H / ch);
  // the saver band is wide and short: the pool fills its height
  if (S.saver && S.saver.band) tv *= 0.55;
  pool.draw({ dt: S.playing ? dt : 0, cam: { ...S.cam, fov: 2 * Math.atan(tv) }, shift,
    sun: { el: q.el * DEG, az: q.az * DEG }, depth: q.depth, n: q.n, dn: q.dn,
    mode: S.playing ? q.mode : 'calm', amp: q.amp, rays: q.rays, exposure: q.exp, fade, wspeed: q.ws, tscale: q.ts });
  if (!S.saver && now - (S.capAt || 0) > 400) {
    S.capAt = now;
    $('caption').innerHTML = `<i>Pool</i> · sun <span class="n">${q.el.toFixed(0)}°</span> · depth <span class="n">${q.depth.toFixed(2)}</span> · ripples <span class="n">${(WAVE_V0 * q.ws * q.ts).toFixed(2)}</span> m/s`;
  }
}

// ── controls ────────────────────────────────────────────────────────────────
const SLIDERS = [['el', 'el', v => v.toFixed(1) + '°'], ['az', 'az', v => v.toFixed(0) + '°'], ['depth', 'depth', v => v.toFixed(2)],
  ['amp', 'amp', v => v.toFixed(2)], ['n3', 'n', v => v.toFixed(3)], ['dn3', 'dn', v => v.toFixed(3)], ['exp3', 'exp', v => v.toFixed(2)],
  ['ws', 'ws', v => (WAVE_V0 * v).toFixed(2) + ' m/s'], ['ts', 'ts', v => v.toFixed(2) + '×']];
const MODES = { rain: 'Rain', swell: 'Swell', calm: 'Calm' };

function syncSliders() { for (const [id, k, f] of SLIDERS) { $(id).value = S.q[k]; $(id + 'V').textContent = f(S.q[k]); } }

function dockText() {
  $('dockName').textContent = MODES[S.q.mode];
  $('dockGeom').classList.toggle('on', S.q.rays); $('dockGeom').setAttribute('aria-pressed', String(S.q.rays));
  $('dockPlay').textContent = S.playing ? '❚❚' : '▶';
  $('playBtn').textContent = S.playing ? 'Pause' : 'Play';
}

function setPlaying(p) { S.playing = p; dockText(); }
function setRays(on) { S.q.rays = on; $('raysBtn').classList.toggle('on', on); dockText(); }
function setMode(m) { S.q.mode = m; document.querySelectorAll('#waveSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === m)); dockText(); }
const splash = () => pool.drop((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, 0.12, 0.05 * S.q.amp);

function bindUI() {
  for (const [id, k, f] of SLIDERS) $(id).addEventListener('input', () => { S.q[k] = +$(id).value; $(id + 'V').textContent = f(S.q[k]); });
  $('slowBtn').addEventListener('click', () => { S.q.ws = WS0; S.q.ts = TS0; syncSliders(); });
  document.querySelectorAll('#waveSeg button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('raysBtn').addEventListener('click', () => setRays(!S.q.rays));
  $('splashBtn').addEventListener('click', splash);
  $('playBtn').addEventListener('click', () => setPlaying(!S.playing));
  $('dockPlay').addEventListener('click', () => setPlaying(!S.playing));
  $('clearBtn').addEventListener('click', () => pool.flatten());
  $('dockSplash').addEventListener('click', splash);
  $('dockScene').addEventListener('click', () => { const m = Object.keys(MODES); setMode(m[(m.indexOf(S.q.mode) + 1) % m.length]); });
  $('dockGeom').addEventListener('click', () => setRays(!S.q.rays));
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
    else if (k === 'c') pool.flatten();
    else if (k === 's') splash();
    else if (k === '1' || k === '2' || k === '3') setMode(Object.keys(MODES)[+k - 1]);
  });
}

// ── pointer ─────────────────────────────────────────────────────────────────
// A drag orbits, wheel or pinch zooms, a tap on the water drops a ripple,
// a double-click resets the camera.
function bindPointer() {
  const pts = new Map();
  let start = null, pinch0 = null;
  const zoom = f => { S.cam.dist = clamp(S.cam.dist / f, 1.1, 7); };
  canvas.addEventListener('pointerdown', e => {
    if (S.saver) return;
    try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* ok */ }
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) start = { x: e.clientX, y: e.clientY, yaw: S.cam.yaw, pitch: S.cam.pitch, moved: false, t: performance.now() };
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); start = null; }
    canvas.classList.add('drag');
  });
  canvas.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2 && pinch0) {
      const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      zoom(d / pinch0); pinch0 = d;
      return;
    }
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (Math.hypot(dx, dy) > 4) start.moved = true;
    if (!start.moved) return;
    S.cam.yaw = start.yaw - dx / canvas.clientWidth * 4;
    S.cam.pitch = clamp(start.pitch + dy / canvas.clientHeight * 2.5, 0.25, 1.5);
  });
  const up = e => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch0 = null;
    if (start && !start.moved && performance.now() - start.t < 500) {
      const cr = canvas.getBoundingClientRect();
      const hit = pool.pick((e.clientX - cr.left) / cr.width * 2 - 1, 1 - (e.clientY - cr.top) / cr.height * 2);
      if (hit) pool.drop(hit[0], hit[1], 0.06, 0.035 * Math.max(0.3, S.q.amp));
    }
    if (!pts.size) { start = null; canvas.classList.remove('drag'); }
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => { if (S.saver) return; e.preventDefault(); zoom(Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  canvas.addEventListener('dblclick', () => { S.cam = { ...CAM0 }; });
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
  w3: String.raw`v\leftarrow\gamma\left(v+K(\bar h-h)\right),\quad h\leftarrow h+v,\quad K=2s^2`,
  t3: String.raw`\mathbf{T}=\eta\,\mathbf{L}+\left(\eta\cos\theta_i-\cos\theta_t\right)\mathbf{N},\qquad \eta=\frac{1}{n}`,
  e3: String.raw`E=E_0\,T_F(\theta_i)\,\frac{|dA_0|}{|dA|}`,
};
const EQ_TEXT = {
  t3: 'T = η L + (η cos θi − cos θt) N,  η = 1/n', e3: 'E = E₀ T_F(θi) |dA₀| / |dA|', w3: 'v ← γ(v + K(h̄ − h)),  h ← h + v,  K = 2s²',
};
function renderMath() { ['t3', 'e3', 'w3'].forEach((k, i) => typeset($(['eqA', 'eqB', 'eqC'][i]), TEX[k], { rules: RULES })); }

// ── screensaver ─────────────────────────────────────────────────────────────
// A shot: camera from-to [yaw, pitch, dist, ty], sun from-to [el, az]
// (degrees, az added to a seeded bearing), waves, photon paths, dispersion.
// The moves are calm: small camera and sun turns, and slow water (ws, ts
// default to WS0, TS0). code: 'sim' shows the wave step on the plate.
const SHOTS = [
  { name: 'The net of light', sub: 'Each wave crest is a weak lens; where it focuses at the floor, a bright line', cam: [[0, 0.95, 2.9, -0.35], [0.18, 0.9, 2.65, -0.38]], sun: [[58, 0], [58, 8]], mode: 'rain' },
  { name: 'On the floor', sub: 'Close in: the folds of the light sheet, as lines and cusps', cam: [[0, 1.25, 1.9, -0.85], [0.08, 1.28, 1.55, -0.88]], sun: [[70, 0], [70, 5]], mode: 'rain' },
  { name: 'Low sun', sub: 'A low sun stretches the net and the wall throws a long shadow', cam: [[0, 0.62, 2.9, -0.35], [-0.15, 0.61, 2.8, -0.38]], sun: [[30, 0], [27, 10]], mode: 'rain' },
  { name: 'Photon paths', sub: 'Each ray from the sun bends at the surface, by Snell’s law, toward the floor', cam: [[0, 0.42, 3.1, -0.3], [0.15, 0.44, 3.0, -0.33]], sun: [[55, -10], [55, 10]], mode: 'swell', rays: true },
  { name: 'Colour fringes', sub: 'Each colour has its own index: the lines split into colour at their edges', cam: [[0, 1.3, 1.5, -0.9], [0.05, 1.31, 1.3, -0.92]], sun: [[62, 0], [62, 4]], mode: 'rain', dn: 0.09 },
  { name: 'High noon', sub: 'The sun nearly overhead: no wall shadow, the whole floor in play', cam: [[0, 1.0, 2.6, -0.4], [0.2, 1.02, 2.45, -0.42]], sun: [[85, 0], [84, 15]], mode: 'rain' },
  { name: 'A slow swell', sub: 'Long soft waves at a slow pace: the net of light drifts', cam: [[0, 0.8, 2.8, -0.4], [0.12, 0.78, 2.6, -0.42]], sun: [[50, 0], [52, 8]], mode: 'swell', ws: 0.22, ts: 0.5, code: 'sim' },
  { name: 'Nearly still', sub: 'The water almost stops; the caustics hold their shape and creep', cam: [[0, 1.15, 2.2, -0.7], [0.06, 1.17, 2.0, -0.72]], sun: [[64, 0], [64, 4]], mode: 'rain', ws: 0.12, ts: 0.35, code: 'sim' },
];

function saverPlate() {
  const sv = S.saver; if (!sv || !sv.label || !sv.shot) return;
  const sh = sv.shot, q = S.q, f = (v, d = 3) => Number(v).toFixed(d);
  const code = sh.code === 'sim'
    ? { lang: 'glsl', name: 'pool3d.js · one wave step', text: SIM_SRC.slice(SIM_SRC.indexOf('void main')).trim() }
    : { lang: 'glsl', name: 'pool3d.js · caustic area ratio', text: CAUS_SRC.slice(CAUS_SRC.indexOf('float area')).trim() };
  sv.label({ title: 'Pool Caustics 3D · ' + sh.name, sub: sh.sub, tex: sh.code === 'sim' ? [TEX.w3, TEX.e3] : [TEX.e3, TEX.t3], rules: RULES,
    eq: sh.code === 'sim' ? [EQ_TEXT.w3, EQ_TEXT.e3] : [EQ_TEXT.e3, EQ_TEXT.t3],
    params: [{ sym: '\\theta_s', name: 'sun height', value: f(q.el, 0) + '°' }, { sym: 'd', name: 'depth', value: f(q.depth, 2) },
      { sym: 'n', name: 'index of water', value: f(q.n) }, { sym: 'v', name: 'ripple speed', value: f(WAVE_V0 * q.ws * q.ts, 2) + ' m/s' }],
    code });
}

function nextShot(now) {
  const sv = S.saver;
  sv.i++;
  const sh = { ...sv.list[sv.i % sv.list.length] };
  sv.shot = sh; sv.t0 = now;
  sh.yaw0 = sv.rnd() * Math.PI * 2; sh.az0 = sv.rnd() * 360;
  S.q.mode = sh.mode; S.q.rays = !!sh.rays; S.q.dn = sh.dn ?? 0.02; S.q.depth = 1; S.q.amp = 1; S.q.n = 1.333; S.q.exp = 1;
  S.q.ws = sh.ws ?? WS0; S.q.ts = sh.ts ?? TS0;
  saverPlate();
}

function saverTick(now) {
  const sv = S.saver;
  if (sv.bandFn && now - sv.bandAt > 500) { sv.bandAt = now; try { sv.band = sv.bandFn(canvas.clientHeight); } catch (e) { sv.band = null; } }
  if (!sv.shot || now - sv.t0 >= sv.hold) nextShot(now);
  const sh = sv.shot, el = now - sv.t0, u = ease(clamp(el / sv.hold, 0, 1));
  const [c0, c1] = sh.cam, [s0, s1] = sh.sun;
  S.cam = { yaw: sh.yaw0 + lerp(c0[0], c1[0], u), pitch: lerp(c0[1], c1[1], u), dist: lerp(c0[2], c1[2], u), ty: lerp(c0[3], c1[3], u) };
  S.q.el = lerp(s0[0], s1[0], u); S.q.az = sh.az0 + lerp(s0[1], s1[1], u);
  if (now - sv.plateAt > 1000) { sv.plateAt = now; saverPlate(); }
  return clamp(Math.min(el / 600, (sv.hold - el) / 450), 0, 1);
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

window.snSaver = {
  enter(o = {}) {
    const calm = clamp(o.calm ?? 0.7, 0, 1), rnd = mulberry((o.seed >>> 0) || 1);
    const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    S.saver = { label: typeof o.label === 'function' ? o.label : null, rnd, list: shuffle(SHOTS),
      i: -1, shot: null, t0: 0, hold: (7 + 3 * calm) * 1000, plateAt: 0, bandFn: null, band: null, bandAt: 0,
      prev: { q: { ...S.q }, cam: { ...S.cam }, playing: S.playing, open: panel.classList.contains('open') } };
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
    syncSliders(); setMode(S.q.mode); setRays(S.q.rays); dockText();
    setOpen(p.open);
  },
};

// ── boot ────────────────────────────────────────────────────────────────────
if (!gl) {
  $('nogl').hidden = false;
} else {
  const caps = floatCaps(gl);
  pool = createPool3D(gl, caps, { phone: PHONE_Q.matches });
  bindUI(); bindKeys(); bindPointer(); bindPanel();
  if (PHONE_Q.matches) setOpen(false);
  resize(); syncSliders(); setMode(S.q.mode); renderMath(); dockText();
  requestAnimationFrame(frame);
  window.__pool3d = { S, pool, booted: true, float: caps.float };
}
