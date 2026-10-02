// ============================================================================
//  CHLADNI PLATE  ·  main.js — state, controls, the loop, the screensaver
// ----------------------------------------------------------------------------
//  Data path:
//    solveFor(key) -> worker solver.js -> modes of one plate (cached by key)
//    usePlate()    -> sim.js (response + sand), render.js (textures)
//    frame()       -> glide or sweep the frequency, sim.field, sim.step,
//                     render.trail, render.draw, labels
//  The solve key holds what changes the mode shapes: the shape, the
//  bracing, the edge, the arch and the stiffness ratios of the material.
//  The thickness and the density change only the frequencies (f ~ t), so
//  they do not start a new solve.
//
//  grep -n targets
//    state ............ "const st ="
//    solve queue ...... "function solveFor"
//    plate swap ....... "function usePlate"
//    mask raster ...... "function maskCanvas"
//    response chart ... "function refreshCurve"
//    mode names ....... "function modeName"
//    labels ........... "function labels"
//    equations ........ "function setEq"      MathJax SVG, CP_RULES colors
//    layout ........... "function clearRect"
//    loop ............. "function frame"
//    controls ......... "function buildUI"
//    screensaver ...... "snSaver"
// ============================================================================
import { makeSim } from './sim.js';
import { createRenderer } from './render.js';
import { makeCurve } from './curve.js';
import { typeset, typesetAll } from '../../lib/sci-math.js';

// Math colors (lib/sci.css): displacement w m1, flexural rigidity D, D_x,
// D_y m2, twist rigidity H m3, density rho m4, thickness h m5, angular
// frequency omega, omega_n and the drive frequency f m6. phi, F, zeta, E,
// nu and g keep the default color. The slider symbols ([data-tex] in
// #panel) use the same rules.
const CP_RULES = [['f', 'm6'], ['w', 'm1'], ['D_x', 'm2'], ['D_y', 'm2'], ['D', 'm2'], ['H', 'm3'], ['\\rho', 'm4'], ['h', 'm5'], ['\\omega_n', 'm6'], ['\\omega', 'm6']];
typesetAll(document.getElementById('panel'), CP_RULES).catch(err => console.error('[math]', err));

const CP = window.CPlates;
const $ = id => document.getElementById(id);
const PHONE_Q = window.matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const K_MODES = 24, NODES = 5200, HOP = 1.6;
const SAND_RGB = [0.91, 0.835, 0.66];
const KIND = { alu: 0, brass: 1, glass: 2, spruce: 3, maple: 4 };
// Typical loss factors: metal and glass ring much longer than wood.
const ZETA = { alu: 0.0025, brass: 0.0025, glass: 0.003, spruce: 0.008, maple: 0.008 };
// The drive force is scaled with zeta, so the Drive slider sets the height
// of a resonance peak, and the Damping slider sets its width (and so how
// much the other modes blur the pattern).
const gEff = () => st.G0 * st.zeta / 0.008;

// ------------------------------------------------------------------ state
const st = {
  shape: 'violinTop', bracing: 'none', bc: 'free', arch: 1, material: 'spruce', t: 2.9,
  f: 300, zeta: 0.008, G0: 2.0, sand: PHONE_Q.matches ? 45000 : 70000,
  view: 'top', motion: false, tone: false, sweeping: false, sweepDir: 1,
  drive: null, glide: null, fade: 1, yaw: 0,
};
let R = null;              // renderer
let cur = null;            // { key, res, sim, mask, geo }
let curve = null;
let saver = null;          // the screensaver tour, or null
const cache = new Map();   // key -> worker result
const masks = new Map();   // shape -> { canvas, bits, w, h } for one grid

// ---------------------------------------------------------------- solving
let worker = null, pending = new Map(), queue = [], busyKey = null;
function solveKey(o) {
  const c = CP.stiffness(o.material, 0.001);
  return [o.shape, o.bracing, o.bc, c.iso ? 0 : o.arch ? 1 : 0, c.cxx.toFixed(4), c.c12.toFixed(4), c.c66.toFixed(4)].join('|');
}
function startWorker() {
  try {
    worker = new Worker(new URL('solver.js', import.meta.url));
    worker.onmessage = e => {
      const m = e.data, key = m.ok ? m.r.key : m.key;
      busyKey = null;
      if (m.ok) cache.set(key, m.r); else console.error('solver', m.error);
      const cbs = pending.get(key) || []; pending.delete(key);
      cbs.forEach(cb => cb(m.ok ? m.r : null));
      pump();
    };
    worker.onerror = e => { console.error('solver worker', e.message); worker = null; busyKey = null; pump(); };
  } catch (e) { worker = null; }
}
// Main-thread fallback: load solver.js as a classic script once.
let inline = null;
function inlineSolver() {
  if (!inline) inline = new Promise((ok, no) => {
    const s = document.createElement('script'); s.src = 'solver.js'; s.onload = () => ok(window.CSolver); s.onerror = no;
    document.head.appendChild(s);
  });
  return inline;
}
function pump() {
  if (busyKey || !queue.length) return;
  const req = queue.shift();
  if (cache.has(req.key)) { const cbs = pending.get(req.key) || []; pending.delete(req.key); cbs.forEach(cb => cb(cache.get(req.key))); pump(); return; }
  busyKey = req.key;
  if (worker) worker.postMessage(req);
  else inlineSolver().then(S => setTimeout(() => {
    let r = null; try { r = S.solve(req); cache.set(req.key, r); } catch (e) { console.error(e); }
    busyKey = null; const cbs = pending.get(req.key) || []; pending.delete(req.key); cbs.forEach(cb => cb(r)); pump();
  }, 30));
}
// Ask for a plate. urgent puts it before the background work.
function solveFor(o, cb, urgent) {
  const key = solveKey(o);
  if (cache.has(key)) { cb && cb(cache.get(key)); return key; }
  if (!pending.has(key)) {
    pending.set(key, []);
    const req = { key, shape: o.shape, bracing: o.bracing, bc: o.bc, arch: o.arch, material: o.material, nodes: NODES, k: K_MODES };
    if (urgent) queue.unshift(req); else queue.push(req);
  } else if (urgent) {
    const i = queue.findIndex(q => q.key === key); if (i > 0) queue.unshift(queue.splice(i, 1)[0]);
  }
  if (cb) pending.get(key).push(cb);
  pump();
  return key;
}

// ------------------------------------------------------------ mask raster
// The outline and the holes on a 2D canvas over the grid rect, one pixel
// per sand texel. White = plate. The same pixels give the GL mask and the
// grain test.
function maskCanvas(res, long, bracing) {
  const geo = CP.geometry(res.shape), gw = (res.nx - 1) * res.h, gh = (res.ny - 1) * res.h;
  const w = gw >= gh ? long : Math.round(long * gw / gh), h = gw >= gh ? Math.round(long * gh / gw) : long;
  const key = res.shape + '|' + (bracing || 'none') + '|' + w + 'x' + h + '|' + res.x0.toFixed(3) + '|' + res.y0.toFixed(3);
  if (masks.has(key)) return masks.get(key);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true }), s = w / gw;
  const X = x => (x - res.x0) * s, Y = y => (y - res.y0) * s;
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#fff'; g.beginPath();
  geo.outline.forEach((p, i) => i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])));
  g.closePath(); g.fill();
  g.fillStyle = '#000'; g.strokeStyle = '#000';
  for (const hh of geo.holes) {
    if (hh.kind === 'circle') { g.beginPath(); g.arc(X(hh.c[0]), Y(hh.c[1]), hh.r * s, 0, 7); g.fill(); }
    else {
      const f = hh.f; g.lineWidth = 2 * f.w * s; g.lineCap = 'round'; g.beginPath();
      f.stem.forEach((p, i) => i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))); g.stroke();
      for (const e of f.eyes) { g.beginPath(); g.arc(X(e[0]), Y(e[1]), e[2] * s, 0, 7); g.fill(); }
    }
  }
  // braces in the green channel (0 under a brace), for a faint shadow
  const B = CP.braces(res.shape, bracing || 'none');
  if (B.length) {
    g.globalCompositeOperation = 'multiply'; g.strokeStyle = '#ff00ff'; g.lineCap = 'round';
    for (const b of B) { g.lineWidth = b[4] * s; g.beginPath(); g.moveTo(X(b[0]), Y(b[1])); g.lineTo(X(b[2]), Y(b[3])); g.stroke(); }
    g.globalCompositeOperation = 'source-over';
  }
  const px = g.getImageData(0, 0, w, h).data, bits = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) bits[i] = px[i * 4] > 140 ? 1 : 0;
  const m = { canvas: c, bits, w, h };
  masks.set(key, m);
  return m;
}

// ------------------------------------------------------------- plate swap
const ampBytes = { u8: null };
function usePlate(res, keepDrive) {
  const long = PHONE_Q.matches ? 768 : 1024;
  const mask = maskCanvas(res, long, res.bracing || st.bracing);
  const sim = makeSim(res, mask.bits, mask.w, mask.h);
  const geo = CP.geometry(res.shape);
  cur = { key: res.key, res, sim, mask, geo };
  const S = CP.SHAPES[res.shape];
  if (!keepDrive || !st.drive) st.drive = S.drive.slice();
  const [u, v] = toGrid(st.drive);
  if (!sim.onPlate(u, v)) st.drive = S.drive.slice();
  sim.setDrive(...toGrid(st.drive));
  rescale();
  sim.resize(st.sand);
  ampBytes.u8 = new Uint8Array(res.nx * res.ny);
  cur.long = long;
  bindPlate();
  fieldDirty = true;
  refreshCurve();
  labels(true);
  $('busy').hidden = true;
}
function bindPlate() {
  if (!R || !cur) return;
  const res = cur.res, geo = cur.geo;
  R.setPlate({ nx: res.nx, ny: res.ny, x0: res.x0, y0: res.y0, h: res.h, mask: cur.mask.canvas, sandLong: cur.long, cy: (geo.bbox[1] + geo.bbox[3]) / 2 });
}
function toGrid(p) { return [(p[0] - cur.res.x0) / cur.res.h, (p[1] - cur.res.y0) / cur.res.h]; }
function rescale() {
  if (!cur) return;
  const c = CP.stiffness(st.material, st.t / 1000), m = CP.MATERIALS[st.material];
  cur.sim.setScale(c.Dref, m.rho, st.t / 1000, cur.res.h / 100);
  fieldDirty = true;
}

// -------------------------------------------------------- frequency range
function fRange() {
  const F = cur.sim.freq;
  return [Math.max(5, F[0] * 0.72), F[K_MODES - 1] * 1.04];
}
function fToSlider(f) { const [a, b] = fRange(); return Math.round(1000 * Math.log(f / a) / Math.log(b / a)); }
function sliderToF(x) { const [a, b] = fRange(); return a * Math.pow(b / a, x / 1000); }

// ---------------------------------------------------------- response chart
let curveData = null, peaks = [];
function refreshCurve() {
  if (!cur || !curve) return;
  const [a, b] = fRange();
  curveData = cur.sim.curve(a, b, PHONE_Q.matches ? 260 : 420, st.zeta, gEff());
  peaks = [];
  for (let m = 0; m < K_MODES; m++) {
    const f = cur.sim.freq[m];
    let best = 0;
    for (let q = 0; q < curveData.F.length; q++) if (Math.abs(Math.log(curveData.F[q] / f)) < 0.02) best = Math.max(best, curveData.A[q]);
    peaks.push({ n: m + 1, f, a: best });
  }
  const marks = CP.SHAPES[st.shape].violin ? { 1: 1, 2: 1, 5: 1 } : {};
  curve.set(curveData, peaks, marks);
  curve.cursor(st.f);
  luthier();
}
function peakAt(m) { return peaks[m] ? peaks[m].a : 0; }

// --------------------------------------------------------------- naming
// The mode nearest to f, and whether f is on its resonance peak.
function nearestMode(f) {
  const F = cur.sim.freq; let m = 0, d = 1e9;
  for (let i = 0; i < K_MODES; i++) { const e = Math.abs(Math.log(f / F[i])); if (e < d) { d = e; m = i; } }
  return { m, on: d < Math.max(2.2 * st.zeta, 0.004) };
}
function modeName(m) {
  const info = cur.res.info[m], S = CP.SHAPES[st.shape];
  const n = m + 1;
  if (st.shape === 'circle' && info.d != null) return { title: `Mode (${info.d}, ${info.c})`, tag: info.d === 0 ? 'rings' : info.c === 0 ? 'diameters' : '', sub: `${info.d} diameter${info.d === 1 ? '' : 's'}, ${info.c} circle${info.c === 1 ? '' : 's'}` };
  let tag = '';
  if (S.violin && st.bc === 'free') {
    if (n === 1) tag = 'twisting mode';
    else if (n === 2) tag = 'bending mode';
    else if (n === 5) tag = info.rings ? 'ring mode' : 'tap tone 5';
  } else if (info.rings && info.rings === info.lines) tag = 'ring';
  const sub = `nodal lines ≈ ${info.lines} · regions ${info.domains}`;
  return { title: `Mode ${n}`, tag, sub };
}

// ---------------------------------------------------------------- labels
const fmtHz = f => f >= 1000 ? (f / 1000).toFixed(2) + ' kHz' : f.toFixed(f < 100 ? 1 : 0) + ' Hz';
let lastLabel = 0, lastSaverLabel = '';
// plain: Unicode lines for the saver plate. Otherwise TeX for #eqPlate and
// #eqD (MathJax SVG through setEq).
function eqText(plain) {
  const c = CP.stiffness(st.material, st.t / 1000), m = CP.MATERIALS[st.material];
  const t = st.t.toFixed(1) + ' mm';
  if (c.iso) {
    return plain ? ['D ∇⁴w = ρh ω² w', `D = Eh³/12(1−ν²) = ${c.Dref.toFixed(2)} N·m`, `${m.name} ${t}: E ${m.E} GPa, ρ ${m.rho} kg/m³, ν ${m.nu}`]
      : { plate: String.raw`D\,\nabla^4 w=\rho h\,\omega^2 w`,
        d: String.raw`D=\frac{E h^3}{12(1-\nu^2)}=${c.Dref.toFixed(2)}\ \text{N·m}`, note: `${m.name} ${t}` };
  }
  const H = c.D12 + 2 * c.D66;
  return plain ? ['Dₓ wₓₓₓₓ + 2H wₓₓᵧᵧ + D_y wᵧᵧᵧᵧ = ρh ω² w', `D_y ${c.DL.toFixed(2)}, Dₓ ${c.DR.toFixed(2)}, H ${H.toFixed(2)} N·m`, `${m.name} ${t}, grain along the body`]
    : { plate: String.raw`D_x\,\partial_x^4 w+2H\,\partial_x^2\partial_y^2 w+D_y\,\partial_y^4 w=\rho h\,\omega^2 w`,
      d: String.raw`D_y=${c.DL.toFixed(2)},\ D_x=${c.DR.toFixed(2)},\ H=${H.toFixed(2)}\ \text{N·m}`,
      note: `${m.name} ${t}${st.arch && !c.iso ? ', arched' : ''}` };
}
// The driven response: the panel TeX (#eqResp), also on the saver plate.
const SAVER_RESP = String.raw`w(\mathbf{x})=\sum_n \frac{\varphi_n(\mathbf{x})\,\varphi_n(\mathbf{x}_d)\,F}{\omega_n^2-\omega^2+2i\zeta\,\omega_n\,\omega}`;
// The plate on screen, for the shell's label plate: the corners of the grid
// rect through R.toScreen (the render camera), in page CSS px. Centre is
// the middle of their screen box, r the larger half side (the outlines do
// not fill the corners). pts: the plate centre and the drive point.
function plateAnchor() {
  if (!cur || !R || !R.toScreen) return null;
  const cv = $('view'), rc = cv.getBoundingClientRect(), w = cv.clientWidth, h = cv.clientHeight;
  const q = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => R.toScreen(u, v, w, h));
  if (q.some(p => !p)) return null;
  const xs = q.map(p => p[0]), ys = q.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pts = [{ x: rc.left + (x0 + x1) / 2, y: rc.top + (y0 + y1) / 2 }];
  if (st.drive) {
    const [gu, gv] = toGrid(st.drive), d = R.toScreen(gu / (cur.res.nx - 1), gv / (cur.res.ny - 1), w, h);
    if (d) pts.push({ x: rc.left + d[0], y: rc.top + d[1] });
  }
  return { x: pts[0].x, y: pts[0].y, r: Math.max(x1 - x0, y1 - y0) / 2, pts };
}
// The driven response and the lift condition do not change: typeset once.
let eqStatic = null;
function staticEqs() {
  return eqStatic || (eqStatic = Promise.all([
    setEq('eqResp', String.raw`w(\mathbf{x})=\sum_n \frac{\varphi_n(\mathbf{x})\,\varphi_n(\mathbf{x}_d)\,F}{\omega_n^2-\omega^2+2i\zeta\,\omega_n\,\omega}`),
    setEq('eqLift', String.raw`\omega^2\,|w|>g`, false)]));
}
// Typeset tex into #id only when it changed (labels() runs every 120 ms).
// Resolves when the box is up to date.
function setEq(id, tex, display = true) {
  const el = $(id);
  if (el.dataset.tex === tex) return Promise.resolve();
  return typeset(el, tex, { display, rules: CP_RULES });
}
function labels(force) {
  if (!cur) return;
  const now = performance.now();
  if (!force && now - lastLabel < 120) return;
  lastLabel = now;
  const S = CP.SHAPES[st.shape], nm = nearestMode(st.f), name = modeName(nm.m);
  const amax = cur.sim.ampMax;
  $('cPlate').textContent = `${S.name} · ${CP.MATERIALS[st.material].name} ${st.t.toFixed(1)} mm`;
  if (nm.on) {
    $('cMode').textContent = name.title;
    $('cTag').hidden = !name.tag; $('cTag').textContent = name.tag;
    $('cSub').textContent = name.sub + (amax < 1 ? ' · drive too weak to lift sand' : '');
  } else {
    const F = cur.sim.freq, lo = st.f < F[nm.m] ? nm.m : nm.m + 1;
    $('cMode').textContent = lo <= 0 ? 'Below mode 1' : lo >= K_MODES ? `Above mode ${K_MODES}` : `Between ${lo} and ${lo + 1}`;
    $('cTag').hidden = true;
    $('cSub').textContent = amax < 1 ? 'off resonance: the sand rests' : 'off resonance: a mix of modes';
  }
  $('cFreq').textContent = fmtHz(st.f);
  $('cG').textContent = 'peak ' + (amax < 10 ? amax.toFixed(1) : amax.toFixed(0)) + ' g';
  $('dModeT').textContent = (nm.on ? name.title : $('cMode').textContent) + ' · ' + fmtHz(st.f);
  $('freqV').textContent = fmtHz(st.f);
  const E = eqText(false);
  $('eqNote').textContent = E.note;
  // The phone sheet shows a copy of #eq, made after the boxes are typeset.
  if ($('eqPlate').dataset.tex !== E.plate || $('eqD').dataset.tex !== E.d)
    Promise.all([staticEqs(), setEq('eqPlate', E.plate), setEq('eqD', E.d)]).then(() => { $('eqPhone').innerHTML = $('eq').innerHTML; });
  if (saver && saver.label) {
    const sub = nm.on ? `${name.title}${name.tag ? ' · ' + name.tag : ''} · ${fmtHz(cur.sim.freq[nm.m])}` : `sweeping · ${fmtHz(st.f)}`;
    const key = S.name + sub;
    if (key !== lastSaverLabel) {
      lastSaverLabel = key;
      const c = CP.stiffness(st.material, st.t / 1000), M = CP.MATERIALS[st.material];
      const params = [{ sym: 'f', name: 'drive frequency', value: fmtHz(st.f), cls: 'm6' },
        { sym: 'h', name: 'thickness', value: st.t.toFixed(1) + ' mm', cls: 'm5' },
        c.iso ? { sym: 'D', name: 'flexural rigidity', value: c.Dref.toFixed(2) + ' N·m', cls: 'm2' }
          : { sym: 'D_y / D_x', name: 'grain stiffness ratio', value: (c.DL / c.DR).toFixed(1), cls: 'm2' },
        { sym: '\\rho', name: 'density', value: M.rho + ' kg/m³', cls: 'm4' },
        { sym: 'Q', name: 'quality factor', value: (1 / (2 * st.zeta)).toFixed(0) }];
      saver.label({ title: S.name, sub: sub.charAt(0).toUpperCase() + sub.slice(1), params,
        lines: [nm.on ? name.sub : 'Between resonances', `${M.name}, ${st.bc} edges`],
        tex: [E.plate, SAVER_RESP, String.raw`\omega^2\,|w|>g`], rules: CP_RULES,
        eq: eqText(true).slice(0, 2).concat(['sand lifts where ω²|w| > g']), anchor: plateAnchor });
    }
  }
}

// The luthier's tap tones: modes 1, 2 and 5 of a free violin plate.
function luthier() {
  const S = CP.SHAPES[st.shape], el = $('luth');
  if (!cur) return;
  const F = cur.sim.freq;
  if (S.violin && st.bc === 'free') {
    const r52 = F[4] / F[1];
    el.innerHTML = `<table>
      <tr><td><button data-m="0">Mode 1</button> twisting</td><td>${fmtHz(F[0])}</td></tr>
      <tr><td><button data-m="1">Mode 2</button> bending</td><td>${fmtHz(F[1])}</td></tr>
      <tr><td><button data-m="4">Mode 5</button> ring mode</td><td>${fmtHz(F[4])}</td></tr>
      <tr><td>mode 5 ⁄ mode 2</td><td>${r52.toFixed(2)}</td></tr></table>
      <p>A maker holds a free plate at a node and taps it, or puts it over a speaker with sand on it, then scrapes wood away and tests again. A common guide (C. M. Hutchins) is to tune mode 5 of the top and the back to near one pitch, and mode 2 to about an octave below mode 5.</p>
      <p>On a real arched plate, thicker in the middle, mode 5 has one closed nodal ring: the “ring mode”. This model is a flat plate of one thickness with an estimate of the arch, and its mode 5 ring stays open at the ends. That gap is the work that the arching and the graduation do.</p>`;
    el.querySelectorAll('button[data-m]').forEach(b => b.addEventListener('click', () => glideTo(+b.dataset.m)));
  } else if (st.shape === 'guitar' || st.shape === 'ukulele') {
    el.innerHTML = `<p>A guitar maker taps the top while it is still free, and listens. The braces change which modes ring and where the nodal lines run: fan braces stiffen the lower bout along the grain, X braces stiffen it on the diagonals. Compare the lowest modes with and without the braces.</p>
      <table><tr><td>Mode 1</td><td>${fmtHz(F[0])}</td></tr><tr><td>Mode 2</td><td>${fmtHz(F[1])}</td></tr><tr><td>Mode 3</td><td>${fmtHz(F[2])}</td></tr></table>`;
  } else {
    el.innerHTML = `<p>Chladni drew these figures in 1787 with a violin bow on a brass plate. Luthiers use the same test on violin and guitar plates: pick a violin plate above to see modes 1, 2 and 5.</p>`;
  }
}

// --------------------------------------------------------------- tuning
function setF(f, fromSlider) {
  const [a, b] = fRange();
  st.f = Math.min(b, Math.max(a, f));
  fieldDirty = true;
  if (!fromSlider) $('freq').value = fToSlider(st.f);
  if (curve) curve.cursor(st.f);
  if (audio) audio.osc.frequency.setTargetAtTime(st.f, audio.ctx.currentTime, 0.03);
}
function glideTo(m, dur) {
  if (!cur) return;
  m = Math.max(0, Math.min(K_MODES - 1, m));
  setSweep(false);
  st.glide = { from: Math.log(st.f), to: Math.log(cur.sim.freq[m]), t: 0, dur: dur || 1.4 };
}
function stepMode(d) {
  if (!cur) return;
  const nm = nearestMode(st.f), F = cur.sim.freq;
  let m = nm.on ? nm.m + d : (d > 0 ? (st.f < F[nm.m] ? nm.m : nm.m + 1) : (st.f > F[nm.m] ? nm.m : nm.m - 1));
  // skip the modes that the drive point cannot excite
  while (m >= 0 && m < K_MODES && peakAt(m) < 1.2 && Math.abs(m - nm.m) < K_MODES) m += d;
  if (m < 0 || m >= K_MODES) m = Math.max(0, Math.min(K_MODES - 1, nm.m + d));
  glideTo(m);
}
function setSweep(on) {
  st.sweeping = on;
  $('sweep').classList.toggle('on', on); $('dMode').classList.toggle('on', on);
  $('dModeS').textContent = on ? 'sweeping · tap to stop' : 'tap to sweep';
  if (on) st.glide = null;
}

// --------------------------------------------------------------- audio
let audio = null;
function setTone(on) {
  st.tone = on;
  $('tone').classList.toggle('on', on);
  if (on && !audio) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = st.f; gain.gain.value = 0;
      osc.connect(gain).connect(ctx.destination); osc.start();
      audio = { ctx, osc, gain };
    } catch (e) { st.tone = false; $('tone').classList.remove('on'); return; }
  }
  if (audio) { if (on) audio.ctx.resume(); audio.gain.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.05); }
}

// --------------------------------------------------------------- layout
// The part of the canvas that no panel, card or chart covers, in CSS px.
function clearRect() {
  const cv = $('view'), W = cv.clientWidth, H = cv.clientHeight, top0 = cv.getBoundingClientRect().top;
  // Saver: keep room for the shell label plate, at the right of a wide
  // screen and at the base of a tall one, so the plate sits beside the
  // sand figure and not on it.
  if (document.documentElement.classList.contains('sn-saver')) {
    if (W > H * 1.2) { const k = Math.min(440, W * 0.36); return { x: W * 0.03, y: H * 0.05, w: W * 0.94 - k, h: H * 0.9 }; }
    if (H > W * 1.2) { const k = Math.min(340, H * 0.4); return { x: W * 0.04, y: H * 0.03, w: W * 0.92, h: H * 0.95 - k }; }
    return { x: W * 0.04, y: H * 0.05, w: W * 0.92, h: H * 0.9 };
  }
  let x0 = 0, x1 = W, y0 = 0, y1 = H;
  const panel = $('panel'), open = panel.classList.contains('open');
  const pr = panel.getBoundingClientRect();
  if (open && pr.width > 0) {
    if (pr.height > H * 0.8 + top0 * 0 && pr.left < 10) x0 = Math.max(x0, pr.right);
    else if (pr.left > W / 2) x1 = Math.min(x1, pr.left);
    else if (pr.top - top0 > H * 0.25) y1 = Math.min(y1, pr.top - top0);
  }
  const card = $('card').getBoundingClientRect(), resp = $('resp').getBoundingClientRect();
  if (card.width > (x1 - x0) * 0.6) y0 = Math.max(y0, card.bottom - top0 + 4);
  else y0 = Math.max(y0, 12);
  y1 = Math.min(y1, resp.top - top0 - 6);
  return { x: x0 + 6, y: y0, w: Math.max(40, x1 - x0 - 12), h: Math.max(40, y1 - y0) };
}

// ---------------------------------------------------------------- loop
let fieldDirty = true, lastT = 0, simTime = 0, frames = 0;
function resize() {
  const cv = $('view'), dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(cv.clientWidth * dpr)), h = Math.max(1, Math.round(cv.clientHeight * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  if (curve) curve.resize();
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0.001, (now - (lastT || now)) / 1000)); lastT = now;
  simTime += dt; frames++;
  if (saver) saverTick(dt);
  if (cur) {
    if (st.glide) {
      const g = st.glide; g.t += dt / g.dur;
      const e = g.t >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * g.t);
      setF(Math.exp(g.from + (g.to - g.from) * e));
      if (g.t >= 1) st.glide = null;
    } else if (st.sweeping) {
      // slower on a peak, so the sand can draw it
      const a = cur.sim.ampMax, rate = 0.07 * (0.18 + 0.82 / (1 + (a / 2.5) * (a / 2.5)));
      let lf = Math.log2(st.f) + st.sweepDir * rate * dt;
      const [lo, hi] = fRange();
      if (lf > Math.log2(hi)) { lf = Math.log2(hi); st.sweepDir = -1; }
      if (lf < Math.log2(lo)) { lf = Math.log2(lo); st.sweepDir = 1; }
      setF(Math.pow(2, lf));
    }
    if (fieldDirty) {
      cur.sim.field(2 * Math.PI * st.f, st.zeta, gEff());
      if (st.motion) { cur.sim.ampBytes(ampBytes.u8); R && R.setAmp(ampBytes.u8); }
      fieldDirty = false;
    }
    cur.sim.step(dt, HOP);
    if (R) {
      R.grains(cur.sim.buf, cur.sim.count);
      R.trail(Math.pow(0.86, dt * 60), 0.085 * Math.min(1.6, dt * 60));
    }
    if (audio && st.tone) {
      const a = cur.sim.ampMax, v = 0.02 + 0.10 * Math.min(1, a / 12);
      audio.gain.gain.setTargetAtTime(v, audio.ctx.currentTime, 0.08);
    }
    labels(false);
  }
  if (R) {
    resize();
    const cv = $('view');
    if (cur) R.camera(st.view, clearRect(), cv.clientWidth, cv.clientHeight, st.yaw);
    const dpr = cv.width / Math.max(1, cv.clientWidth);
    R.draw({
      sandCol: SAND_RGB, kind: KIND[st.material], showAmp: st.motion ? 1 : 0,
      drive: cur && st.drive ? [toGrid(st.drive)[0] / (cur.res.nx - 1), toGrid(st.drive)[1] / (cur.res.ny - 1)] : [0, 0],
      fade: st.fade, gain: 1.9, hop: st.view === 'tilt' ? 0.7 : 0.25, time: simTime, grainPx: Math.max(1.5, 1.4 * dpr),
    });
  }
}

// ------------------------------------------------------------- controls
function choosePlate(id, urgent) {
  const S = CP.SHAPES[id];
  st.shape = id; st.bracing = 'none'; st.material = S.material; st.t = S.t; st.arch = S.arch || 0; setZeta(ZETA[S.material]);
  syncUI();
  requestPlate(true);
}
function requestPlate(resetF) {
  const want = { shape: st.shape, bracing: st.bracing, bc: st.bc, arch: CP.MATERIALS[st.material].E ? 0 : st.arch, material: st.material };
  const key = solveKey(want);
  if (!cache.has(key)) { $('busy').hidden = false; }
  solveFor(want, res => {
    if (!res || solveKey({ shape: st.shape, bracing: st.bracing, bc: st.bc, arch: CP.MATERIALS[st.material].E ? 0 : st.arch, material: st.material }) !== key) return;
    const keep = cur && cur.res.shape === res.shape;
    const prevF = st.f;
    usePlate(res, keep);
    if (resetF || !keep) {
      R && R.clearSand(); cur.sim.scatter();
      // start on a strong mode, but not the lowest; a violin starts on
      // mode 5, the ring mode
      let m = 0; for (let i = 0; i < K_MODES; i++) if (peakAt(i) > 3) { m = i; if (i >= 2) break; }
      if (CP.SHAPES[st.shape].violin && st.bc === 'free' && peakAt(4) > 2) m = 4;
      setF(cur.sim.freq[m]);
    } else setF(prevF);
    $('freq').value = fToSlider(st.f);
  }, true);
}
function syncUI() {
  const S = CP.SHAPES[st.shape];
  document.querySelectorAll('#shapes button').forEach(b => b.classList.toggle('on', b.dataset.shape === st.shape));
  const br = $('bracing'); br.innerHTML = '';
  const opts = Object.entries(S.bracing);
  br.hidden = opts.length < 2;
  for (const [k, v] of opts) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = v; b.dataset.k = k;
    b.classList.toggle('on', k === st.bracing);
    b.addEventListener('click', () => { st.bracing = k; syncUI(); requestPlate(false); });
    br.appendChild(b);
  }
  document.querySelectorAll('#edges button').forEach(b => b.classList.toggle('on', b.dataset.bc === st.bc));
  const wood = !CP.MATERIALS[st.material].E;
  $('arches').hidden = !wood;
  document.querySelectorAll('#arches button').forEach(b => b.classList.toggle('on', +b.dataset.arch === st.arch));
  document.querySelectorAll('#mats button').forEach(b => b.classList.toggle('on', b.dataset.m === st.material));
  $('thick').value = Math.round(st.t * 10); $('thickV').textContent = st.t.toFixed(1) + ' mm';
  $('shapeNote').textContent = S.note;
  const m = CP.MATERIALS[st.material];
  $('matNote').textContent = m.E ? `${m.name}: E ${m.E} GPa, ρ ${m.rho} kg/m³, ν ${m.nu}. The same stiffness in every direction.`
    : `${m.name}: E ${m.EL} GPa along the grain, ${m.ER} GPa across it, ρ ${m.rho} kg/m³. The grain runs along the body.`;
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === st.view));
  $('dampV').textContent = 'Q ' + (1 / (2 * st.zeta)).toFixed(0);
  $('driveV').textContent = st.G0.toFixed(2);
  $('sandV').textContent = Math.round(st.sand / 1000) + 'k';
}
function buildUI() {
  const shapes = $('shapes');
  for (const id of CP.ORDER) {
    const S = CP.SHAPES[id], b = document.createElement('button');
    b.type = 'button'; b.dataset.shape = id;
    b.innerHTML = `${S.short}<small>${S.L} cm</small>`;
    b.addEventListener('click', () => choosePlate(id));
    shapes.appendChild(b);
  }
  const mats = $('mats');
  for (const k of ['brass', 'alu', 'glass', 'spruce', 'maple']) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.m = k; b.textContent = CP.MATERIALS[k].name;
    b.addEventListener('click', () => { st.material = k; setZeta(ZETA[k]); syncUI(); requestPlate(false); });
    mats.appendChild(b);
  }
  document.querySelectorAll('#edges button').forEach(b => b.addEventListener('click', () => { st.bc = b.dataset.bc; syncUI(); requestPlate(false); }));
  document.querySelectorAll('#arches button').forEach(b => b.addEventListener('click', () => { st.arch = +b.dataset.arch; syncUI(); requestPlate(false); }));
  document.querySelectorAll('#views button').forEach(b => b.addEventListener('click', () => { st.view = b.dataset.view; syncUI(); }));
  $('dView').addEventListener('click', () => { st.view = st.view === 'top' ? 'tilt' : 'top'; syncUI(); });
  $('freq').addEventListener('input', e => { setSweep(false); st.glide = null; if (cur) setF(sliderToF(+e.target.value), true); });
  // damping: zeta from 0.002 to 0.05 on a log slider
  const zOf = x => 0.002 * Math.pow(25, x / 1000), xOfZ = z => Math.round(1000 * Math.log(z / 0.002) / Math.log(25));
  $('damp').value = xOfZ(st.zeta);
  $('damp').addEventListener('input', e => { st.zeta = zOf(+e.target.value); fieldDirty = true; syncUI(); curveSoon(); });
  const gOf = x => 0.1 * Math.pow(50, x / 1000), xOfG = g => Math.round(1000 * Math.log(g / 0.1) / Math.log(50));
  $('drive').value = xOfG(st.G0);
  $('drive').addEventListener('input', e => { st.G0 = gOf(+e.target.value); fieldDirty = true; syncUI(); curveSoon(); });
  $('thick').addEventListener('input', e => { st.t = +e.target.value / 10; syncUI(); const f0 = st.f; const r = cur ? cur.sim.freq[0] : 0; rescale(); if (cur && r) setF(f0 * cur.sim.freq[0] / r); curveSoon(); });
  $('sand').value = Math.round(st.sand / 1000);
  $('sand').addEventListener('input', e => { st.sand = +e.target.value * 1000; syncUI(); if (cur) { cur.sim.resize(Math.max(st.sand, 1)); cur.sim.count = st.sand; } });
  $('reset').addEventListener('click', () => { if (cur) { cur.sim.scatter(); R && R.clearSand(); } });
  $('motion').addEventListener('click', () => { st.motion = !st.motion; $('motion').classList.toggle('on', st.motion); fieldDirty = true; });
  $('tone').addEventListener('click', () => setTone(!st.tone));
  $('prev').addEventListener('click', () => stepMode(-1));
  $('next').addEventListener('click', () => stepMode(1));
  $('dPrev').addEventListener('click', () => stepMode(-1));
  $('dNext').addEventListener('click', () => stepMode(1));
  $('sweep').addEventListener('click', () => setSweep(!st.sweeping));
  $('dMode').addEventListener('click', () => setSweep(!st.sweeping));

  // the panel, the phone sheet and the dock (the wave-membrane pattern)
  const panel = $('panel'), dockPanel = $('dockPanel');
  function setOpen(open) {
    panel.classList.toggle('open', open);
    if (!open) panel.classList.remove('full');
    document.body.classList.toggle('panel-closed', !open);
    dockPanel.classList.toggle('on', open);
    dockPanel.setAttribute('aria-expanded', String(open));
    setTimeout(() => curve && curve.resize(), 320);
  }
  const toggle = () => setOpen(!panel.classList.contains('open'));
  $('gear').addEventListener('click', toggle);
  dockPanel.addEventListener('click', toggle);
  $('panelClose').addEventListener('click', () => setOpen(false));
  setOpen(!PHONE_Q.matches);
  PHONE_Q.addEventListener('change', e => setOpen(!e.matches));
  const grip = $('sheetGrip'); let gripY = null;
  grip.addEventListener('pointerdown', e => { gripY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) {} });
  grip.addEventListener('pointerup', e => {
    if (gripY === null) return;
    const dy = e.clientY - gripY; gripY = null;
    if (Math.abs(dy) < 8) panel.classList.toggle('full');
    else if (dy < -40) panel.classList.add('full');
    else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
  });
  grip.addEventListener('pointercancel', () => { gripY = null; });

  // a tap on the plate moves the drive point
  const cv = $('view'); let down = null;
  cv.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  cv.addEventListener('pointerup', e => {
    if (!down || !cur || !R) return;
    const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]); down = null;
    if (moved > 8) return;
    const r = cv.getBoundingClientRect(), uv = R.pick(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
    if (!uv) return;
    const u = uv[0] * (cur.res.nx - 1), v = uv[1] * (cur.res.ny - 1);
    if (!cur.sim.onPlate(u, v)) return;
    st.drive = [cur.res.x0 + u * cur.res.h, cur.res.y0 + v * cur.res.h];
    cur.sim.setDrive(u, v); fieldDirty = true; curveSoon();
    $('hint').classList.add('gone');
  });
  window.addEventListener('resize', () => { resize(); });
  syncUI();
}
let curveTimer = 0;
function setZeta(z) { st.zeta = z; $('damp').value = Math.round(1000 * Math.log(z / 0.002) / Math.log(25)); fieldDirty = true; }
function curveSoon() { clearTimeout(curveTimer); curveTimer = setTimeout(refreshCurve, 60); }

// ------------------------------------------------------------ screensaver
// lib/screensaver.js has the protocol. The tour: glide to a resonance,
// hold while the sand settles, glide to the next one. After a few modes
// the plate fades out and the next shape fades in. opts.seed picks the
// shapes and the modes, calm 1 is the slowest.
function rng(seed) { let s = (seed >>> 0) || 7; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }
function saverPlan(seed) {
  const r = rng(seed * 2654435761 + 1), order = CP.ORDER.slice();
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  return { order, r };
}
function saverPlate(id) {
  const S = CP.SHAPES[id];
  return { shape: id, bracing: id === 'guitar' ? (saver.r() < 0.5 ? 'fan' : 'none') : 'none', bc: 'free', arch: S.arch || 0, material: S.material, t: S.t };
}
function saverModes() {
  // modes that lift the sand well, in rising order; a violin shows 1, 2, 5
  const S = CP.SHAPES[st.shape];
  if (S.violin) return [0, 1, 4].filter(m => peakAt(m) > 1.5).concat([6, 8].filter(m => peakAt(m) > 3)).slice(0, 4);
  const good = []; for (let m = 0; m < 16; m++) if (peakAt(m) > 6) good.push(m);
  // a degenerate pair has one frequency: keep one mode of each pair
  const F = cur.sim.freq, pick = [];
  while (good.length && pick.length < 4) {
    const m = good.splice(Math.floor(saver.r() * good.length), 1)[0];
    if (pick.every(q => Math.abs(Math.log(F[q] / F[m])) > 0.03)) pick.push(m);
  }
  return pick.sort((a, b) => a - b);
}
function saverSwap() {
  const id = saver.order[saver.si % saver.order.length]; saver.si++;
  const o = saverPlate(id);
  Object.assign(st, { shape: o.shape, bracing: o.bracing, bc: o.bc, arch: o.arch, material: o.material, t: o.t, sweeping: false, glide: null });
  setZeta(ZETA[o.material]);
  st.view = saver.r() < 0.45 ? 'tilt' : 'top';
  saver.phase = 'wait';
  solveFor(o, res => {
    if (!saver) return;
    usePlate(res, false);
    R && R.clearSand(); cur.sim.scatter();
    saver.modes = saverModes();
    if (!saver.modes.length) saver.modes = [2];
    saver.mi = 0;
    setF(cur.sim.freq[saver.modes[0]]);
    // let the sand find the first pattern before the fade in
    cur.sim.field(2 * Math.PI * st.f, st.zeta, gEff()); fieldDirty = false;
    for (let i = 0; i < 160; i++) cur.sim.step(1 / 60, HOP);
    saver.phase = 'fadein'; saver.t = 0;
    // solve the next shape in the background
    solveFor(saverPlate(saver.order[saver.si % saver.order.length]));
  }, true);
}
function saverTick(dt) {
  const s = saver, slow = 0.6 + 0.8 * s.calm;
  s.t += dt;
  st.yaw = st.view === 'tilt' ? 0.18 * Math.sin(simTime * 0.05 * (1.2 - s.calm)) : 0;
  if (s.phase === 'fadein') { st.fade = Math.min(1, s.t / 1.6); if (s.t >= 1.6) { s.phase = 'hold'; s.t = 0; } }
  else if (s.phase === 'hold') { if (s.t > 9 * slow) { s.mi++; if (s.mi >= s.modes.length) { s.phase = 'fadeout'; s.t = 0; } else { glideTo(s.modes[s.mi], 4.5 * slow); s.phase = 'glide'; s.t = 0; } } }
  else if (s.phase === 'glide') { if (!st.glide) { s.phase = 'hold'; s.t = 0; } }
  else if (s.phase === 'fadeout') { st.fade = Math.max(0, 1 - s.t / 1.4); if (s.t >= 1.4) { st.fade = 0; saverSwap(); } }
}
window.snSaver = {
  enter(o) {
    o = o || {};
    const calm = o.calm != null ? o.calm : 0.7, plan = saverPlan(o.seed || 1);
    document.documentElement.classList.add('sn-saver');
    setSweep(false); setTone(false);
    saver = { calm, order: plan.order, r: plan.r, si: 0, phase: 'wait', t: 0, modes: [], mi: 0, label: typeof o.label === 'function' ? o.label : null };
    lastSaverLabel = '';
    st.fade = 0;
    st.G0 = 2.0;
    saverSwap();
    return { canvas: $('view'), warmupMs: 2500 };
  },
  exit() {
    saver = null; st.fade = 1; st.yaw = 0;
    document.documentElement.classList.remove('sn-saver');
  },
};

// ----------------------------------------------------------------- boot
async function boot() {
  buildUI();
  startWorker();
  curve = makeCurve($('curve'), (f, end) => { setSweep(false); st.glide = null; if (cur) setF(f); });
  try {
    R = await createRenderer($('view'));
  } catch (e) {
    console.error(e); $('nogl').hidden = false;
  }
  resize();
  if (cur) bindPlate(); else if (!saver) requestPlate(true);
  // warm the cache: the other plates in the background
  for (const id of CP.ORDER) { const S = CP.SHAPES[id]; solveFor({ shape: id, bracing: 'none', bc: 'free', arch: S.arch || 0, material: S.material }); }
  setTimeout(() => $('hint').classList.add('gone'), 9000);
  requestAnimationFrame(frame);
}
window.__chladni = { st, get cur() { return cur; }, cache, setF, glideTo, stepMode, choosePlate, get R() { return R; }, labels: () => labels(true) };
boot();
