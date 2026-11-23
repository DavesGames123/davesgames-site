// ============================================================================
//  THUNDER ACOUSTICS  ·  main.js — state, tools, the run loop, audio, panel
// ----------------------------------------------------------------------------
//  Owns the page state S and the grid g. The pure modules do the work:
//    channel.js  tortuous()  ->  S.channel
//    thunder.js  synthesize()  ->  S.synth (p(t) at M), spectrogram -> S.spec
//    fdtd.js     createGrid / inject / step  ->  the field in panel (a)
//    render.js   layout / drawField / drawScene / drawRecord
//  Strike: clear the grid, inject the channel, start the clock at t = 0
//  and play S.synth from t = 0 (real time only), so the sound and the
//  field share one clock (the audio clock when it plays).
//
//  grep -n: "const S ="  "function rebuild"  "function makeChannel"
//           "function resynth"  "function strike"  "function frame"
//           "function onDown"  "function buildPanel"  "function numbers"
//           "function playAudio"  "window.snSaver"
// ============================================================================
import { tortuous, autoStroke, fewRadius } from './channel.js';
import { createScene, applyPreset, PRESETS, PROFILES, surfaceAt, groundAt, cAt, brush, settle } from './scene.js';
import { createGrid, setScene, clear, inject, step, probe } from './fdtd.js';
import { synthesize } from './thunder.js';
import { layout, toWorld, toScreen, drawField, drawScene, drawRecord, spectrogram, drawProfile } from './render.js';

export const PHONE_Q = '(max-width:768px), (max-height:500px) and (pointer:coarse)';
const $ = id => document.getElementById(id);
const phone = window.matchMedia(PHONE_Q);
const TOOL_NAMES = { channel: 'Draw a channel', mic: 'Move the microphone', raise: 'Raise the ground', lower: 'Lower the ground', building: 'Building' };
const TOOL_ORDER = ['channel', 'mic', 'raise', 'lower', 'building'];

const S = {
  sc: createScene(), preset: 'plain', stroke: null, seed: 11,
  El: 5e5, sigma: 16, pBranch: 0.012, channel: null, nearest: null,
  mic: [9500, 2], micOnGround: true,
  view: 'p', dx: 16, speed: 1, tog: { auto: true, front: true, grid: true, norm: false }, sound: true,
  tool: 'channel', t: 0, running: false, synth: null, spec: null,
  trace: { t: new Float32Array(4096), v: new Float32Array(4096), n: 0 },
  drawing: null, hover: null, saver: false, showFront: true, showGrid: true,
};
let g = null, L = null, dpr = 1, ref = 0.4, autoRef = 0.4;
const fig = $('fig'), ctx = fig.getContext('2d');

// ── scene and channel ──
function rebuild() { g = createGrid(S.sc, S.dx); S.t = 0; S.running = false; S.trace.n = 0; }
function placeMic() { const s = surfaceAt(S.sc, S.mic[0]); S.mic[1] = S.micOnGround ? s + 2 : Math.max(S.mic[1], s + 2); }
function makeChannel() {
  if (!S.stroke) { S.channel = null; S.nearest = null; return; }
  S.channel = tortuous(S.stroke, { seed: S.seed, sigmaDeg: S.sigma, pBranch: S.pBranch, ground: x => surfaceAt(S.sc, x), W: S.sc.W, H: S.sc.H });
  let best = Infinity;
  for (const s of S.channel.segs) for (const [x, z] of [[s.x0, s.z0], [s.x1, s.z1]]) {
    const d = Math.hypot(x - S.mic[0], z - S.mic[1]);
    if (d < best) { best = d; S.nearest = [x, z]; }
  }
}
let synthTimer = 0, audioBuf = null;
function resynth(now = false) {
  clearTimeout(synthTimer);
  const go = () => {
    if (!S.channel || !S.channel.segs.length) { S.synth = null; S.spec = null; numbers(); return; }
    S.synth = synthesize({ segs: S.channel.segs, El: S.El, sc: S.sc, mic: S.mic });
    S.spec = spectrogram(S.synth.signal, S.synth.fs);
    audioBuf = null;
    numbers();
  };
  if (now) go(); else synthTimer = setTimeout(go, 90);
}
function sceneChanged() {
  settle(S.sc); setScene(g, S.sc); placeMic(); makeChannel(); stopRun(); clear(g); S.t = 0; S.trace.n = 0; resynth();
  drawProfile($('cprof'), z => cAt(S.sc, z), S.sc.H, dpr);
}
function loadPreset(key) {
  const P = applyPreset(S.sc, key);
  S.preset = key; S.stroke = P.stroke.map(p => p.slice()); S.seed = P.seed;
  S.mic = [P.mic[0], surfaceAt(S.sc, P.mic[0]) + P.mic[1]]; S.micOnGround = true;
  rebuild(); makeChannel(); resynth(true); syncPanel();
  drawProfile($('cprof'), z => cAt(S.sc, z), S.sc.H, dpr);
}
function newChannel() {
  S.seed = (S.seed * 1103515245 + 12345) % 2147483647;
  S.stroke = autoStroke(S.seed, { W: S.sc.W, ground: x => surfaceAt(S.sc, x), xMin: 1500, xMax: S.sc.W - 1500 });
  makeChannel(); stopRun(); clear(g); S.t = 0; resynth(true);
}

// ── run and audio ──
let ac = null, src = null, audioT0 = 0, lastWall = 0;
function audioCtx() {
  if (!ac) { const A = window.AudioContext || window.webkitAudioContext; if (A) ac = new A(); }
  if (ac && ac.state === 'suspended') ac.resume();
  return ac;
}
function playAudio() {
  stopAudio();
  if (!S.sound || S.speed !== 1 || !S.synth || S.saver) return false;
  const a = audioCtx(); if (!a) return false;
  if (!audioBuf || audioBuf.sampleRate !== S.synth.fs) {
    const sy = S.synth, buf = a.createBuffer(1, sy.signal.length, sy.fs), ch = buf.getChannelData(0);
    const gain = S.tog.norm ? 0.9 / Math.max(sy.peak, 1e-9) : 0.9 / Math.max(sy.peak, 6);
    for (let i = 0; i < ch.length; i++) ch[i] = sy.signal[i] * gain;
    audioBuf = buf;
  }
  src = a.createBufferSource(); src.buffer = audioBuf; src.connect(a.destination);
  audioT0 = a.currentTime + 0.03; src.start(audioT0);
  return true;
}
function stopAudio() { if (src) { try { src.stop(); } catch (e) { /* already stopped */ } src.disconnect(); src = null; } }
function stopRun() { S.running = false; stopAudio(); syncPanel(); }
function strike() {
  if (!S.channel) newChannel();
  if (!S.synth) resynth(true);
  clear(g); inject(g, S.channel.segs, 1); S.t = 0; S.trace.n = 0; autoRef = 0.4;
  S.running = true; lastWall = performance.now();
  playAudio();
  syncPanel();
}
function reset() { stopRun(); clear(g); S.t = 0; S.trace.n = 0; }
function pushTrace(t, v) {
  const tr = S.trace;
  if (tr.n >= tr.t.length) { const nt = new Float32Array(tr.t.length * 2), nv = new Float32Array(tr.t.length * 2); nt.set(tr.t); nv.set(tr.v); tr.t = nt; tr.v = nv; }
  tr.t[tr.n] = t; tr.v[tr.n] = v; tr.n++;
}
function advance(now) {
  const wall = Math.min(0.1, (now - lastWall) / 1000); lastWall = now;
  if (!S.running) return;
  const target = src && ac ? Math.max(0, ac.currentTime - audioT0) : S.t + wall * S.speed;
  let budget = 40;
  while (g.t < target && budget-- > 0) { step(g); pushTrace(g.t, probe(g, S.mic[0], S.mic[1])); }
  S.t = g.t;
  const end = S.synth ? S.synth.dur : 30;
  if (S.t >= end) { S.running = false; syncPanel(); }
}

// ── drawing ──
function box() {
  const W = innerWidth, H = innerHeight, ph = phone.matches;
  const P = $('panel');
  if (S.saver) return { x: 0, y: 12, w: W, h: H - 12 };
  if (ph) {
    const top = document.querySelector('.topbar').getBoundingClientRect().bottom || 44;
    const dock = $('dock').getBoundingClientRect().height || 64;
    const land = innerHeight <= 500 && innerWidth > innerHeight;
    if (land) { const pw = P.classList.contains('open') ? P.getBoundingClientRect().width : 0; return { x: 0, y: 8, w: W - pw, h: H - 8 - dock }; }
    const sheet = P.classList.contains('open') ? P.getBoundingClientRect().height : 0;
    return { x: 0, y: top + 4, w: W, h: H - top - 4 - dock - sheet };
  }
  const pl = P.classList.contains('open') ? P.getBoundingClientRect().width : 0;
  const inFrame = document.documentElement.classList.contains('in-frame');
  const y = inFrame ? 52 : 96;
  return { x: pl, y, w: W - pl, h: H - y - 30 };
}
function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  fig.width = Math.round(innerWidth * dpr); fig.height = Math.round(innerHeight * dpr);
}
function frame(now) {
  advance(now);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, innerWidth, innerHeight);
  L = layout(box(), S.sc.W, S.sc.H, phone.matches || innerWidth < 900);
  if (S.tog.auto && S.running && g.steps % 4 === 0) {
    let m = 0; const p = g.p;
    for (let j = 0; j < p.length; j += 3) { const v = Math.abs(p[j]); if (v > m) m = v; }
    autoRef = Math.max(0.004, autoRef * 0.9 + m * 0.75 * 0.1);
  }
  ref = S.tog.auto ? autoRef : 0.4;
  S.showFront = S.tog.front; S.showGrid = S.tog.grid;
  drawField(ctx, L, g, S.view, 1, ref);
  drawScene(ctx, L, S);
  drawRecord(ctx, L, S);
  status();
  requestAnimationFrame(frame);
}

// ── pointer tools ──
let drag = null, brushT = 0;
function world(e) { const r = fig.getBoundingClientRect(); return toWorld(L, e.clientX - r.left, e.clientY - r.top); }
function inField(e) { const r = fig.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, F = L.field; return x >= F.x && x <= F.x + F.w && y >= F.y && y <= F.y + F.h; }
function nearMic(e) {
  const r = fig.getBoundingClientRect(), [mx, my] = toScreen(L, S.mic[0], S.mic[1]);
  return Math.hypot(e.clientX - r.left - mx, e.clientY - r.top - (my - 10)) < (phone.matches ? 26 : 16);
}
function onDown(e) {
  if (!L || !inField(e)) return;
  fig.setPointerCapture(e.pointerId);
  audioCtx();
  const [x, z] = world(e);
  if (S.tool === 'mic' || nearMic(e)) { drag = 'mic'; moveMic(x, z); return; }
  if (S.tool === 'channel') { drag = 'channel'; S.drawing = [[x, z]]; return; }
  if (S.tool === 'raise' || S.tool === 'lower') { drag = S.tool; brushT = performance.now(); brush(S.sc, x, S.tool === 'raise' ? 1 : -1, 500, 30); placeMic(); return; }
  if (S.tool === 'building') {
    const B = S.sc.buildings, i = B.findIndex(b => Math.abs(x - b.x) <= b.w / 2 + 20 && z <= b.base + b.h + 30);
    if (i >= 0) B.splice(i, 1);
    else B.push({ x, w: 120, h: 45, base: groundAt(S.sc, x) });
    sceneChanged();
  }
}
function moveMic(x, z) {
  const sx = Math.max(100, Math.min(S.sc.W - 100, x)), s = surfaceAt(S.sc, sx);
  S.micOnGround = z - s < 150;
  S.mic = [sx, S.micOnGround ? s + 2 : Math.min(S.sc.H - 200, z)];
}
function onMove(e) {
  if (!L) return;
  const [x, z] = world(e);
  S.hover = inField(e) ? [x, z] : null;
  const pr = $('probe');
  if (S.hover && !phone.matches) {
    pr.hidden = false;
    pr.style.left = (e.clientX + 14) + 'px'; pr.style.top = (e.clientY + 14) + 'px';
    pr.textContent = `x ${(x / 1000).toFixed(2)} km  z ${(z / 1000).toFixed(2)} km  c ${cAt(S.sc, z).toFixed(1)} m/s`;
  } else pr.hidden = true;
  if (!drag) return;
  if (drag === 'mic') { moveMic(x, z); return; }
  if (drag === 'channel') { const l = S.drawing[S.drawing.length - 1]; if (Math.hypot(x - l[0], z - l[1]) > 60) S.drawing.push([x, Math.max(0, z)]); return; }
  if (drag === 'raise' || drag === 'lower') {
    const now = performance.now(), k = Math.min(3, (now - brushT) / 16); brushT = now;
    brush(S.sc, x, drag === 'raise' ? 1 : -1, 500, 12 * k); placeMic();
  }
}
function onUp() {
  if (!drag) return;
  const d = drag; drag = null;
  if (d === 'mic') { makeChannel(); reset(); resynth(); return; }
  if (d === 'raise' || d === 'lower') { sceneChanged(); return; }
  if (d === 'channel') {
    const pts = S.drawing; S.drawing = null;
    if (!pts || pts.length < 2) return;
    let span = 0; for (let i = 1; i < pts.length; i++) span += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (span < 300) return;
    let w = pts[0][1] < pts[pts.length - 1][1] ? pts.slice().reverse() : pts.slice();
    // keep a waypoint about every 250 m of the stroke
    const keep = [w[0]]; let acc = 0;
    for (let i = 1; i < w.length; i++) { acc += Math.hypot(w[i][0] - w[i - 1][0], w[i][1] - w[i - 1][1]); if (acc > 250) { keep.push(w[i]); acc = 0; } }
    const last = w[w.length - 1];
    if (keep[keep.length - 1] !== last) keep.push(last);
    const ge = surfaceAt(S.sc, last[0]);
    if (last[1] - ge < 350) keep[keep.length - 1] = [last[0], ge];
    S.stroke = keep; S.seed = (S.seed * 48271) % 2147483647;
    makeChannel(); resynth(true); strike();
  }
}
fig.addEventListener('pointerdown', onDown);
fig.addEventListener('pointermove', onMove);
fig.addEventListener('pointerup', onUp);
fig.addEventListener('pointercancel', onUp);
fig.addEventListener('pointerleave', () => { S.hover = null; $('probe').hidden = true; });

// ── panel ──
const PARAMS = [
  // key, label html, min, max, step, to slider, from slider, format
  ['El', '<b class="m4">E<sub>l</sub></b> energy per length', 4, 6.3, 0.01, v => Math.log10(v), s => Math.pow(10, s), v => (v / 1e5).toFixed(1) + '×10⁵ J/m', 'disc'],
  ['sigma', '<b class="m6">σ</b> tortuosity', 0, 32, 0.5, v => v, s => s, v => v.toFixed(1) + '°', 'disc'],
  ['pBranch', 'Branching', 0, 0.04, 0.001, v => v, s => s, v => (v * 100).toFixed(1) + ' % per step', 'disc'],
  ['T0', '<b class="m1">T<sub>0</sub></b> ground temperature', -15, 38, 0.5, v => v, s => s, v => v.toFixed(1) + ' °C', 'air'],
  ['RH', 'Relative humidity', 5, 100, 1, v => v, s => s, v => v.toFixed(0) + ' %', 'air'],
];
function buildPanel() {
  const pre = $('presets');
  for (const [k, P] of Object.entries(PRESETS)) {
    const b = document.createElement('button'); b.textContent = P.name; b.dataset.preset = k;
    b.onclick = () => { loadPreset(k); }; pre.appendChild(b);
  }
  const prof = $('profiles');
  for (const [k, P] of Object.entries(PROFILES)) {
    const b = document.createElement('button'); b.textContent = P.name.replace('Standard atmosphere', 'Standard'); b.dataset.profile = k;
    b.onclick = () => { S.sc.atm.profile = k; sceneChanged(); syncPanel(); }; prof.appendChild(b);
  }
  for (const [k, label, min, max, st, to, from, fmt, where] of PARAMS) {
    const row = document.createElement('div'); row.className = 'prm';
    row.innerHTML = `<span class="nm">${label}</span><span class="val"></span><input type="range" min="${min}" max="${max}" step="${st}">`;
    const inp = row.querySelector('input'), val = row.querySelector('.val');
    const get = () => where === 'air' ? S.sc.atm[k] : S[k];
    inp.setAttribute('aria-label', row.querySelector('.nm').textContent);
    inp.value = to(get()); val.textContent = fmt(get());
    inp.oninput = () => {
      const v = from(+inp.value); if (!Number.isFinite(v)) return;
      if (where === 'air') { S.sc.atm[k] = v; } else S[k] = v;
      val.textContent = fmt(v);
      if (k === 'sigma' || k === 'pBranch') { makeChannel(); reset(); }
      if (k === 'T0') { setScene(g, S.sc); drawProfile($('cprof'), z => cAt(S.sc, z), S.sc.H, dpr); }
      resynth();
    };
    row.sync = () => { inp.value = to(get()); val.textContent = fmt(get()); };
    $(where === 'air' ? 'airParams' : 'params').appendChild(row);
  }
  document.querySelectorAll('#views button').forEach(b => b.onclick = () => { S.view = b.dataset.view; syncPanel(); });
  document.querySelectorAll('#grids button').forEach(b => b.onclick = () => { S.dx = +b.dataset.dx; rebuild(); syncPanel(); numbers(); });
  document.querySelectorAll('#speeds button').forEach(b => b.onclick = () => { S.speed = +b.dataset.speed; if (S.running) { if (S.speed !== 1) stopAudio(); lastWall = performance.now(); } syncPanel(); });
  document.querySelectorAll('#togs button').forEach(b => b.onclick = () => { S.tog[b.dataset.tog] = !S.tog[b.dataset.tog]; if (b.dataset.tog === 'norm') audioBuf = null; syncPanel(); });
  document.querySelectorAll('#tools button').forEach(b => b.onclick = () => setTool(b.dataset.tool));
  $('newChannel').onclick = newChannel;
  $('strike').onclick = () => { audioCtx(); strike(); };
  $('dockStrike').onclick = () => { audioCtx(); strike(); };
  $('reset').onclick = reset;
  const snd = () => { S.sound = !S.sound; if (!S.sound) stopAudio(); syncPanel(); };
  $('sound').onclick = snd; $('dockSound').onclick = snd;
  $('dockView').onclick = () => { S.view = S.view === 'p' ? 'e' : 'p'; syncPanel(); };
  $('dockTool').onclick = () => setTool(TOOL_ORDER[(TOOL_ORDER.indexOf(S.tool) + 1) % TOOL_ORDER.length]);
  $('dockPanel').onclick = () => setPanel(!$('panel').classList.contains('open'));
  $('panelClose').onclick = () => setPanel(false);
  $('gear').onclick = () => setPanel(true);
  const grip = $('sheetGrip'); let y0 = null;
  grip.addEventListener('pointerdown', e => { y0 = e.clientY; grip.setPointerCapture(e.pointerId); });
  grip.addEventListener('pointerup', e => {
    if (y0 == null) return;
    const dy = e.clientY - y0, P = $('panel'); y0 = null;
    if (dy > 60) { if (P.classList.contains('full')) P.classList.remove('full'); else setPanel(false); }
    else if (dy < -40) P.classList.add('full');
    else if (Math.abs(dy) < 8) P.classList.toggle('full');
  });
  addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space') { e.preventDefault(); audioCtx(); strike(); }
    else if (e.key === 'r' || e.key === 'R') reset();
    else if (e.key === 's' || e.key === 'S') $('sound').click();
    else if (e.key >= '1' && e.key <= '5') setTool(TOOL_ORDER[+e.key - 1]);
  });
}
function setTool(t) { S.tool = t; syncPanel(); }
function setPanel(open) {
  const P = $('panel');
  P.classList.toggle('open', open); if (!open) P.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open && !phone.matches);
  $('dockPanel').setAttribute('aria-expanded', String(open));
}
function syncPanel() {
  document.querySelectorAll('#presets button').forEach(b => b.classList.toggle('on', b.dataset.preset === S.preset));
  $('presetNote').textContent = (PRESETS[S.preset] || {}).note || '';
  document.querySelectorAll('#profiles button').forEach(b => b.classList.toggle('on', b.dataset.profile === S.sc.atm.profile));
  $('profileNote').textContent = (PROFILES[S.sc.atm.profile] || {}).note || '';
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === S.view));
  document.querySelectorAll('#grids button').forEach(b => b.classList.toggle('on', +b.dataset.dx === S.dx));
  document.querySelectorAll('#speeds button').forEach(b => b.classList.toggle('on', +b.dataset.speed === S.speed));
  document.querySelectorAll('#togs button').forEach(b => b.classList.toggle('on', !!S.tog[b.dataset.tog]));
  document.querySelectorAll('#tools button').forEach(b => b.classList.toggle('on', b.dataset.tool === S.tool));
  document.querySelectorAll('.prm').forEach(r => r.sync && r.sync());
  fig.className = 't-' + S.tool;
  $('dockName').textContent = TOOL_NAMES[S.tool];
  $('sound').textContent = S.sound ? 'Sound on' : 'Sound off';
  $('sound').setAttribute('aria-pressed', String(S.sound)); $('dockSound').setAttribute('aria-pressed', String(S.sound));
  $('dockView').textContent = S.view === 'p' ? 'p′' : '⟨p²⟩';
  $('strike').textContent = S.running ? 'Strike again' : 'Strike';
}
const km = m => (m / 1000).toFixed(2) + ' km';
function numbers() {
  const sy = S.synth, ch = S.channel, rows = [];
  rows.push(['Energy per length', (S.El / 1e5).toFixed(1) + '×10⁵ J/m']);
  rows.push(['Channel radius R₀', fewRadius(S.El).toFixed(2) + ' m']);
  if (ch) rows.push(['Channel length', km(ch.mainLength) + ' + ' + km(ch.length - ch.mainLength) + ' branches']);
  if (sy) {
    rows.push(['Spectral peak f_m', sy.fm.toFixed(0) + ' Hz']);
    rows.push(['Sound speed at M', sy.c0.toFixed(1) + ' m/s']);
    rows.push(['Nearest point', km(sy.rMin) + ' → ' + sy.tFirst.toFixed(2) + ' s']);
    rows.push(['3 s per km rule', (sy.rMin / 1000 * 3).toFixed(1) + ' s']);
    rows.push(['Last direct arrival', sy.tLast.toFixed(2) + ' s']);
    rows.push(['Rumble length', (sy.tLast - sy.tFirst).toFixed(2) + ' s']);
    rows.push(['Peak pressure at M', (sy.peak >= 1 ? sy.peak.toFixed(2) : sy.peak.toFixed(3)) + ' Pa, ' + sy.splPeak.toFixed(1) + ' dB']);
    rows.push(['Leq over the rumble', sy.Leq.toFixed(1) + ' dB']);
    rows.push(['Pieces behind a ridge', (100 * sy.nShadow / sy.nPieces).toFixed(0) + ' % of ' + sy.nPieces]);
  }
  if (g) rows.push(['Grid', g.nx + ' × ' + g.nz + ', Δt ' + (g.dt * 1000).toFixed(1) + ' ms, f < ' + g.fMax.toFixed(1) + ' Hz']);
  $('nums').innerHTML = rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('');
}
function status() {
  if (phone.matches) return;
  $('stMain').textContent = (PRESETS[S.preset] || {}).name + ' · ' + (PROFILES[S.sc.atm.profile] || {}).name;
  $('stRight').textContent = `grid ${g.nx}×${g.nz} · Δx ${S.dx} m · t ${S.t.toFixed(2)} s · ${S.running ? (src ? 'playing' : 'running ' + S.speed + '×') : 'stopped'}`;
}

// ── screensaver hook: scenarios in turn, a strike each, no UI ──
let saverTimer = 0;
window.snSaver = {
  enter(opts = {}) {
    S.saver = true; document.documentElement.classList.add('ta-saver');
    const keys = Object.keys(PRESETS);
    let i = Math.floor(((opts.seed ?? Math.random() * 1e6) % keys.length + keys.length) % keys.length);
    const shot = () => {
      loadPreset(keys[i++ % keys.length]); S.view = Math.random() < 0.5 ? 'p' : 'e'; S.speed = 2;
      S.seed = Math.floor(Math.random() * 1e6); makeChannel(); resynth(true); strike();
      saverTimer = setTimeout(shot, Math.max(6000, Math.min(14000, (S.synth ? S.synth.dur / 2 : 8) * 1000)));
    };
    shot();
    return { canvas: fig, warmupMs: 1200 };
  },
  exit() { clearTimeout(saverTimer); S.saver = false; S.speed = 1; document.documentElement.classList.remove('ta-saver'); syncPanel(); },
};

// ── boot ──
resize();
addEventListener('resize', resize);
buildPanel();
if (phone.matches) setPanel(false);
loadPreset('plain');
numbers();
requestAnimationFrame(t => { lastWall = t; frame(t); });
