// ============================================================================
//  VOLUME NOISE  ·  main.js — state, controls, framing, frame loop, export
// ----------------------------------------------------------------------------
//  The entry module. It starts the GPU (gpu.js), generates the textures with
//  the main.cpp constants, binds the controls of index.html, and draws one
//  of four views each frame.
//
//  MODULE MAP
//    noise-ref.js ... the CPU reference port (also makes the hash table)
//    gpu.js ......... device, textures, generation, view pipelines, readback
//    shaders/ ....... noise.wgsl + gen.wgsl (compute), common.wgsl +
//                     views.wgsl / clouds.wgsl (render)
//
//  FRAMING. The panel, the phone dock and sheet, and the topbar cover parts
//  of the canvas. clearArea() measures them, and every view centres its
//  subject in the rest.
//
//  TEST HOOK. window.__vn = { ready, failed, gpu, S, generate, sample,
//  seamStats, roll, errors }. tests.mjs drives it over CDP.
//
//  grep -n: "const S ="  "function clearArea"  "function frame"  "function writeUniforms"
//           "function bindUI"  "function exportRaw"  "function exportPng"  "window.__vn"
// ============================================================================
import { createGPU, CHANNELS, CUBE_THR, UNI_FLOATS } from './gpu.js';
import { RECIPE } from './noise-ref.js';

const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const TOUCH = matchMedia('(hover:none)').matches;
const $ = id => document.getElementById(id);
const canvas = $('gl');
const VIEWS = ['slice', 'tiles', 'volume', 'clouds'];
// Pixel budget per view (backing pixels): the cloud march is the costly one.
const BUDGET = { slice: 4.0e6, tiles: 4.0e6, volume: 1.2e6, clouds: 0.5e6 };
const WIND_DIR = [Math.cos(0.6), Math.sin(0.6)];
const TIME_LAPSE = 30;   // the wind runs 30 times faster than real time

export const S = {
  view: 'slice', chan: 7,
  z: 0.5, sweep: true, seams: true, ice: false, span: 3,
  thr: CUBE_THR[7], gain: 1.2, cubeThr: CUBE_THR.slice(),
  cov: 0.5, dens: 1, ero: 0.3, sunEl: 24, sunAz: 200, wind: 18,
  prm: { ...RECIPE },
  playing: true, time: 0, fade: 1,
  orbit: { yaw: 0.7, pitch: 0.42, dist: 2.3 },
  look: { yaw: 3.3, pitch: 0.14, x: 0, z: 0, alt: 0.7 },
  windOff: [0, 0, 0, 0],
  tint: [1, 1, 1],
};

let gpu = null;
const uni = new Float32Array(UNI_FLOATS);
const area = { x: 0, y: 0, w: 1, h: 1, ok: false };

// ── framing ────────────────────────────────────────────────────────────────
function clearArea() {
  const W = innerWidth, H = innerHeight;
  let l = 0, t = 0, r = W, bot = H;
  const top = document.querySelector('.topbar');
  if (top && getComputedStyle(top).display !== 'none') t = top.getBoundingClientRect().bottom;
  for (const el of [$('panel'), $('dock')]) {
    const q = el.getBoundingClientRect();
    const x0 = Math.max(0, q.left), x1 = Math.min(W, q.right), y0 = Math.max(0, q.top), y1 = Math.min(H, q.bottom);
    if (x1 - x0 < 2 || y1 - y0 < 2) continue;
    if ((x1 - x0) > W * 0.5) { if (y0 > H * 0.25) bot = Math.min(bot, y0); else t = Math.max(t, y1); }
    else if ((y1 - y0) > H * 0.5) { if (x0 < 2) l = Math.max(l, x1); else r = Math.min(r, x0); }
  }
  t += 24;   // the HUD line
  return { x: l, y: t, w: Math.max(40, r - l), h: Math.max(40, bot - t) };
}

// ── uniforms ───────────────────────────────────────────────────────────────
function basis(fwd) {
  const n = v => { const l = Math.hypot(...v) || 1; return v.map(c => c / l); };
  const f = n(fwd);
  const r = n([-f[2], 0, f[0]]);   // cross(f, world up)
  const up = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];   // cross(r, f)
  return { f, r, up: n(up) };
}

function writeUniforms(sc) {
  const u = uni;
  const ax = area.x * sc, ay = area.y * sc, aw = area.w * sc, ah = area.h * sc;
  u.set([canvas.width, canvas.height, S.time, S.fade], 0);
  u.set([ax, ay, aw, ah], 4);
  u.set([S.chan, S.z, S.span, S.seams ? 1 : 0], 8);
  const m = Math.min(aw, ah);
  if (S.view === 'clouds') {
    const L = S.look, cp = Math.cos(L.pitch);
    const b = basis([cp * Math.sin(L.yaw), Math.sin(L.pitch), cp * Math.cos(L.yaw)]);
    const focal = 0.5 * canvas.height / Math.tan(0.5 * 1.05);
    u.set([L.x, L.alt, L.z, focal], 12);
    u.set([...b.r, 0], 16); u.set([...b.up, 0], 20); u.set([...b.f, 0], 24);
  } else {
    const O = S.orbit, cp = Math.cos(O.pitch);
    const eye = [O.dist * cp * Math.sin(O.yaw), O.dist * Math.sin(O.pitch), O.dist * cp * Math.cos(O.yaw)];
    const b = basis(eye.map(c => -c));
    const R = 0.87, focal = 0.46 * m * Math.sqrt(Math.max(0.01, O.dist * O.dist - R * R)) / R;
    u.set([...eye, focal], 12);
    u.set([...b.r, 0], 16); u.set([...b.up, 0], 20); u.set([...b.f, 0], 24);
  }
  const el = S.sunEl * Math.PI / 180, az = S.sunAz * Math.PI / 180;
  u.set([Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az), Math.max(0, Math.sin(el))], 28);
  u.set([S.cov, S.dens, S.ero, TOUCH ? 48 : 64], 32);
  u.set(S.windOff, 36);
  u.set([S.thr, S.gain, S.ice ? 1 : 0, S.prm.shapeRes], 40);
  u.set([1, 1, 1.1, 0], 44);
  u.set([...S.tint, 0], 48);
}

// ── frame loop ─────────────────────────────────────────────────────────────
let last = performance.now(), fpsN = 0, fpsT = 0, fps = 0, dragging = false;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  fpsN++; fpsT += dt; if (fpsT > 0.5) { fps = fpsN / fpsT; fpsN = 0; fpsT = 0; }
  if (S.playing) {
    S.time += dt;
    if (S.sweep && !dragging && S.view !== 'clouds') { S.z = (S.z + dt * 0.04) % 1; syncZ(); }
    if (S.view === 'volume' && !dragging) S.orbit.yaw += dt * 0.12;
  }
  if (S.playing) {
    const k = S.wind * dt * TIME_LAPSE / 1000;
    S.windOff[0] += WIND_DIR[0] * k; S.windOff[1] += WIND_DIR[1] * k;
    S.windOff[2] += WIND_DIR[0] * k * 1.6; S.windOff[3] += WIND_DIR[1] * k * 1.6;
  }
  // Canvas backing size: CSS size x dpr, cut to the view's pixel budget.
  const cw = innerWidth, ch = innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const sc = Math.min(dpr, Math.sqrt(BUDGET[S.view] / (cw * ch)));
  const W = Math.max(1, Math.round(cw * sc)), H = Math.max(1, Math.round(ch * sc));
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const goal = clearArea();
  const e = area.ok ? 0.2 : 1;
  for (const k of ['x', 'y', 'w', 'h']) area[k] += (goal[k] - area[k]) * e;
  area.ok = true;
  if (!gpu || !gpu.bg) return;
  writeUniforms(W / cw);
  gpu.render(S.view, uni);
  hud();
}

function hud() {
  const h = $('hud');
  h.style.left = area.x + 'px'; h.style.top = (area.y - 24) + 'px'; h.style.width = area.w + 'px';
  const c = CHANNELS[S.chan];
  let l;
  if (S.view === 'clouds') l = `cloud layer · coverage ${S.cov.toFixed(2)} · sun ${S.sunEl.toFixed(0)}°`;
  else if (S.view === 'tiles') l = `${c.name} · z ${S.z.toFixed(3)} · ${S.span.toFixed(2)} tiles`;
  else if (S.view === 'volume') l = `${c.name} · threshold ${S.thr.toFixed(2)}`;
  else l = `${c.name} · z ${S.z.toFixed(3)}`;
  $('hudL').textContent = l;
  $('hudR').textContent = `${S.prm.shapeRes}³ · ${gpu.genMs.toFixed(0)} ms · ${fps.toFixed(0)} fps`;
}

// ── generation ─────────────────────────────────────────────────────────────
// The cube threshold of each channel: the value that 72 % of the voxels lie
// under (from a read-back histogram), so about a quarter of the cube glows
// for any seed, frequency or channel. CUBE_THR is the start value.
async function cubeThresholds() {
  for (const tex of ['shape', 'parts', 'detail']) {
    const t = await gpu.readTexture(tex), n = t.data.length / 4;
    for (let c = 0; c < 4; c++) {
      const h = new Uint32Array(256);
      for (let i = c; i < t.data.length; i += 4) h[t.data[i]]++;
      let k = 0, acc = 0; while (k < 255 && acc + h[k] < 0.72 * n) acc += h[k++];
      const ch = CHANNELS.findIndex(q => q.tex === tex && q.c === c);
      S.cubeThr[ch] = Math.min(0.95, k / 255);
    }
  }
  S.thr = S.cubeThr[S.chan]; syncUI();
}
async function generate(prm) {
  const ms = await gpu.generate(prm);
  await cubeThresholds();
  return ms;
}
let genTimer = 0;
function regen(delay = 220) {
  clearTimeout(genTimer);
  genTimer = setTimeout(async () => {
    $('genStat').textContent = 'computing';
    try { const ms = await generate(S.prm); $('genStat').textContent = ms.toFixed(0) + ' ms'; }
    catch (e) { $('genStat').textContent = 'failed'; console.error(e); }
  }, delay);
}

// ── controls ───────────────────────────────────────────────────────────────
const SLIDERS = [
  ['z', 'z', v => v.toFixed(3)], ['span', 'span', v => v.toFixed(2)], ['thr', 'thr', v => v.toFixed(2)], ['gain', 'gain', v => v.toFixed(2)],
  ['cov', 'cov', v => v.toFixed(2)], ['dens', 'dens', v => v.toFixed(2)], ['ero', 'ero', v => v.toFixed(2)],
  ['sunEl', 'sunEl', v => v.toFixed(1) + '°'], ['sunAz', 'sunAz', v => v.toFixed(0) + '°'], ['wind', 'wind', v => v.toFixed(0) + ' m/s'],
];
const TEX_SLIDERS = [['pf', 'perlinFreq'], ['po', 'perlinOct'], ['pwc', 'pwCells'], ['gbc', 'gbaCells'], ['dtc', 'detailCells'], ['seed', 'seed']];

function syncZ() { const el = $('z'); if (el) { el.value = S.z; $('zv').textContent = S.z.toFixed(3); } }

export function syncUI() {
  for (const [id, key, f] of SLIDERS) { $(id).value = S[key]; $(id + 'v').textContent = f(S[key]); }
  for (const [id, key] of TEX_SLIDERS) { $(id).value = S.prm[key]; $(id + 'v').textContent = S.prm[key]; }
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === S.view));
  document.querySelectorAll('#res button').forEach(b => b.classList.toggle('on', +b.dataset.res === S.prm.shapeRes));
  document.querySelectorAll('#chans button').forEach(b => b.classList.toggle('on', +b.dataset.c === S.chan));
  document.querySelectorAll('[data-for]').forEach(el => { el.hidden = !el.dataset.for.split(' ').includes(S.view); });
  for (const [id, key] of [['sweep', 'sweep'], ['seams', 'seams'], ['ice', 'ice']]) $(id).setAttribute('aria-pressed', String(S[key]));
  $('chanNote').textContent = CHANNELS[S.chan].note;
  $('dockPlay').textContent = S.playing ? '❚❚' : '▶';
  $('dockPlay').setAttribute('aria-label', S.playing ? 'Pause' : 'Play');
}

export function setView(v) { if (VIEWS.includes(v)) { S.view = v; syncUI(); } }

function bindUI() {
  const cg = $('chans');
  let grp = '';
  CHANNELS.forEach((c, i) => {
    if (c.tex !== grp) { grp = c.tex; const g = document.createElement('div'); g.className = 'grp'; g.textContent = { shape: 'Shape texture (main.cpp noiseShape)', parts: 'Shape parts and packed', detail: 'Detail texture (main.cpp noiseErosion)' }[grp]; cg.appendChild(g); }
    const b = document.createElement('button'); b.type = 'button'; b.dataset.c = i; b.title = c.note;
    b.textContent = c.id.split('.')[1].toUpperCase() + ' · ' + c.name.replace('Worley FBM', 'FBM').replace('Detail ', '');
    b.addEventListener('click', () => { S.chan = i; S.thr = S.cubeThr[i]; syncUI(); });
    cg.appendChild(b);
  });
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  for (const [id, key, f] of SLIDERS) $(id).addEventListener('input', e => {
    S[key] = +e.target.value; $(id + 'v').textContent = f(S[key]);
    if (key === 'z') S.sweep = false, $('sweep').setAttribute('aria-pressed', 'false');
  });
  for (const [id, key] of TEX_SLIDERS) $(id).addEventListener('input', e => { S.prm[key] = +e.target.value; $(id + 'v').textContent = S.prm[key]; regen(); });
  document.querySelectorAll('#res button').forEach(b => b.addEventListener('click', () => { S.prm.shapeRes = +b.dataset.res; syncUI(); regen(0); }));
  for (const key of ['sweep', 'seams', 'ice']) $(key).addEventListener('click', () => { S[key] = !S[key]; syncUI(); });
  $('dice').addEventListener('click', () => { S.prm.seed = 1 + Math.floor(Math.random() * 999); syncUI(); regen(0); });
  $('reset').addEventListener('click', () => { S.prm = { ...RECIPE }; syncUI(); regen(0); });
  $('expRaw').addEventListener('click', exportRaw);
  $('expPng').addEventListener('click', exportPng);
  $('dockPlay').addEventListener('click', () => { S.playing = !S.playing; syncUI(); });
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
    const i = '1234'.indexOf(e.key); if (i >= 0) setView(VIEWS[i]);
    if (e.key === ' ') { S.playing = !S.playing; syncUI(); e.preventDefault(); }
  });

  // Panel, phone sheet and dock (the wave-membrane pattern).
  const panel = $('panel'), dockPanel = $('dockPanel');
  const setOpen = open => {
    panel.classList.toggle('open', open);
    if (!open) panel.classList.remove('full');
    document.body.classList.toggle('panel-closed', !open);
    dockPanel.classList.toggle('on', open);
    dockPanel.setAttribute('aria-expanded', String(open));
  };
  $('gear').addEventListener('click', () => setOpen(true));
  $('panelClose').addEventListener('click', () => setOpen(false));
  dockPanel.addEventListener('click', () => setOpen(!panel.classList.contains('open')));
  setOpen(!PHONE_Q.matches);
  PHONE_Q.addEventListener('change', e => setOpen(!e.matches));
  // The grip: a tap switches half and full height; a drag down closes.
  const grip = $('sheetGrip'); let gy = null;
  grip.addEventListener('pointerdown', e => { gy = e.clientY; grip.setPointerCapture(e.pointerId); });
  grip.addEventListener('pointerup', e => {
    if (gy === null) return; const d = e.clientY - gy; gy = null;
    if (Math.abs(d) < 8) panel.classList.toggle('full');
    else if (d < 0) panel.classList.add('full');
    else if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false);
  });
  syncUI();
}

// ── pointer: orbit, look, scrub z, zoom ────────────────────────────────────
function bindPointer() {
  const pts = new Map(); let pinch0 = 0;
  canvas.addEventListener('pointerdown', e => { pts.set(e.pointerId, [e.clientX, e.clientY]); canvas.setPointerCapture(e.pointerId); dragging = true; canvas.classList.add('drag'); });
  const end = e => { pts.delete(e.pointerId); pinch0 = 0; if (!pts.size) { dragging = false; canvas.classList.remove('drag'); } };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    const p = pts.get(e.pointerId), dx = e.clientX - p[0], dy = e.clientY - p[1];
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) {
      const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch0) zoom(pinch0 / d); pinch0 = d; return;
    }
    if (S.view === 'volume') { S.orbit.yaw -= dx * 0.008; S.orbit.pitch = Math.max(-1.45, Math.min(1.45, S.orbit.pitch + dy * 0.008)); }
    else if (S.view === 'clouds') { S.look.yaw -= dx * 0.004; S.look.pitch = Math.max(-0.35, Math.min(1.3, S.look.pitch + dy * 0.004)); }
    else { S.z = ((S.z + dx / Math.max(100, area.w)) % 1 + 1) % 1; S.sweep = false; syncZ(); $('sweep').setAttribute('aria-pressed', 'false'); }
  });
  canvas.addEventListener('wheel', e => { e.preventDefault(); zoom(Math.exp(e.deltaY * 0.0015)); }, { passive: false });
}
function zoom(k) {
  if (S.view === 'volume') S.orbit.dist = Math.max(1.2, Math.min(5, S.orbit.dist * k));
  else if (S.view === 'tiles') { S.span = Math.max(1, Math.min(3, S.span * k)); $('span').value = S.span; $('spanv').textContent = S.span.toFixed(2); }
  else if (S.view === 'clouds') S.look.alt = Math.max(0.1, Math.min(6, S.look.alt * k));
}

// ── export ─────────────────────────────────────────────────────────────────
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function texName() { const c = CHANNELS[S.chan]; return { c, base: `volume-noise-${c.tex}-${c.tex === 'detail' ? 32 : S.prm.shapeRes}-seed${S.prm.seed}` }; }
async function exportRaw() {
  const { c, base } = texName();
  const t = await gpu.readTexture(c.tex);
  download(new Blob([t.data], { type: 'application/octet-stream' }), base + '.raw');
}
// The z slices of one channel side by side in a grid, slice 0 at the top left.
async function exportPng() {
  const { c, base } = texName();
  const t = await gpu.readTexture(c.tex);
  const cols = 2 ** Math.ceil(Math.log2(Math.sqrt(t.d))), rows = Math.ceil(t.d / cols);
  const cv = document.createElement('canvas'); cv.width = cols * t.w; cv.height = rows * t.h;
  const g = cv.getContext('2d'), img = g.createImageData(cv.width, cv.height);
  for (let z = 0; z < t.d; z++) for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
    const v = t.data[((z * t.h + y) * t.w + x) * 4 + c.c];
    const o = (((Math.floor(z / cols) * t.h + y) * cv.width) + (z % cols) * t.w + x) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = v; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  cv.toBlob(b => download(b, `${base}-${c.id.replace('.', '-')}-atlas${cols}x${rows}.png`), 'image/png');
}

// ── test hook ──────────────────────────────────────────────────────────────
// sample(list): list of [tex, x, y, z] -> [r, g, b, a] bytes per entry.
async function sample(list) {
  const cache = {};
  const out = [];
  for (const [tex, x, y, z] of list) {
    const t = cache[tex] || (cache[tex] = await gpu.readTexture(tex));
    const o = (((z || 0) * t.h + y) * t.w + x) * 4;
    out.push(Array.from(t.data.subarray(o, o + 4)));
  }
  return out;
}
// Is the wrap seam an outlier? For each texture, channel and axis, take the
// mean absolute step across each plane i-1 -> i over all rows (plane 0 is
// the seam N-1 -> 0), and the same for the change of the step (the second
// difference). A seam in value or slope would put plane 0 far above the
// others and above its neighbours. Returns plane 0, the mean of planes
// 1, 2, N-1, N-2 (near), and the mean, deviation and max of planes 1..N-1. (A mean over the inner planes alone is not a fair reference: the
// Worley feature points sit on the cell diagonals, so the step size
// depends on the plane.)
async function seamStats() {
  const res = {};
  for (const tex of ['shape', 'parts', 'detail']) {
    const t = await gpu.readTexture(tex), N = t.w, D = t.data;
    const stride = [4, 4 * N, 4 * N * N];
    res[tex] = [];
    for (let c = 0; c < 4; c++) for (let a = 0; a < 3; a++) {
      const s1 = new Float64Array(N), s2 = new Float64Array(N);
      const ua = stride[a], ub = stride[(a + 1) % 3], uc = stride[(a + 2) % 3];
      for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
        const o = j * ub + k * uc + c;
        for (let i = 0; i < N; i++) {
          const v0 = D[o + i * ua], v1 = D[o + ((i + N - 1) % N) * ua], v2 = D[o + ((i + N - 2) % N) * ua];
          s1[i] += Math.abs(v0 - v1); s2[i] += Math.abs((v0 - v1) - (v1 - v2));
        }
      }
      const sum = s => { const r = Array.from(s.subarray(1)).map(v => v / (N * N)); const m = r.reduce((x, y) => x + y, 0) / r.length;
        const near = [1, 2, N - 1, N - 2].reduce((x, i) => x + s[i] / (N * N), 0) / 4;
        return { seam: s[0] / (N * N), near, mean: m, sd: Math.sqrt(r.reduce((x, y) => x + (y - m) ** 2, 0) / r.length), max: Math.max(...r) }; };
      res[tex].push({ c, axis: 'xyz'[a], step: sum(s1), change: sum(s2) });
    }
  }
  return res;
}

// roll(prm): generate prm, then generate it again with the texture
// coordinate moved by half a period on every axis. If the GPU noise repeats
// with period 1, the second texture is the first one rolled by N/2 on each
// axis, byte for byte. Voxel 0 then sits inside the texture, so the wrap
// seam of the first texture is an ordinary inner step of the second one.
// Restores S.prm at the end.
async function roll(prm) {
  const out = {};
  const read = async () => { const r = {}; for (const t of ['shape', 'parts', 'detail', 'weather']) r[t] = await gpu.readTexture(t); return r; };
  await gpu.generate({ ...prm, offset: [0, 0, 0] }); const A = await read();
  await gpu.generate({ ...prm, offset: [0.5, 0.5, 0.5] }); const B = await read();
  for (const t of Object.keys(A)) {
    const a = A[t], b = B[t], N = a.w, D = a.d, hz = D > 1 ? D / 2 : 0;
    let n = 0, eq = 0, max = 0;
    for (let z = 0; z < D; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const ob = ((z * N + y) * N + x) * 4;
      const oa = ((((z + hz) % D) * N + (y + N / 2) % N) * N + (x + N / 2) % N) * 4;
      for (let c = 0; c < 4; c++) { const d = Math.abs(a.data[oa + c] - b.data[ob + c]); n++; if (!d) eq++; if (d > max) max = d; }
    }
    out[t] = { n, eq, max, size: D > 1 ? `${N}^3` : `${N}^2` };
  }
  await gpu.generate(S.prm);
  return out;
}

window.__vn = { ready: false, failed: null, S, get gpu() { return gpu; }, CHANNELS, sample, seamStats, roll,
  generate: async prm => { Object.assign(S.prm, prm); syncUI(); return gpu.generate(S.prm); },
  get errors() { return gpu ? gpu.errors : []; } };

// ── boot ───────────────────────────────────────────────────────────────────
bindUI();
bindPointer();
requestAnimationFrame(frame);
const ready = (async () => {
  try {
    gpu = await createGPU(canvas);
    const ms = await generate(S.prm);
    $('genStat').textContent = ms.toFixed(0) + ' ms';
    window.__vn.ready = true;
    return gpu;
  } catch (e) {
    window.__vn.failed = String(e && e.message || e);
    console.error('volume-noise:', e);
    if (String(e.message).includes('no-webgpu')) $('nogpu').hidden = false;
    throw e;
  }
})();
