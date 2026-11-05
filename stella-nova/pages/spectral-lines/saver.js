// ============================================================================
//  SPECTRAL LINES  ·  saver.js — the screensaver hook and its director
// ----------------------------------------------------------------------------
//  This module sets window.snSaver = { enter(opts), exit() } (the protocol is
//  in lib/screensaver.js). index.html loads it with
//  <script type="module" src="saver.js">.
//
//  enter({ calm, seconds, caption, seed, label }) -> { canvas, warmupMs }
//      Sets window.snSaverActive = true and sends the window event
//      'sn-saver-enter', so main.js can stop its own loop. Hides the page
//      GUI with one style element and puts a full-frame canvas in the
//      document. The director draws on that canvas with its own code.
//  exit()   stops the frame loop, removes the canvas and the style, clears
//      the plate, sets window.snSaverActive = false and sends 'sn-saver-exit'.
//
//  The data is window.SPECTRA (data/lines.js). When the page did not load
//  it, enter() adds the script. The element names come from
//  ../periodic-table/data/elements.js; the symbol is the fallback.
//
//  Shot kinds (a seeded bag, 5 to 12 s each, no kind twice in a row):
//    band      one emission band fills in line by line, strongest first,
//              then the view zooms on the strongest visible line
//    levels    the energy-level diagram: random weighted transitions, the
//              electron drops, a photon leaves in the line colour
//    stack     a slow pan along the rows of all spectra, sorted by Z
//    temp      a Boltzmann temperature sweep; the line weights and the
//              lamp colour of the discharge tube change
//    compare   two elements, band over band; near lines (0.5 nm) linked
//
//  Pure parts (no DOM, node tests in saver-tests.mjs):
//    wlRGB(nm), cmf(nm), lampRGB(lines, w), boltz(spec, T), termKey(label)
//    planShots(seed, spectra, n, { calm }) -> [shot]
//    plateFor(shot, k, names) -> label plate payload (no code)
//    makeDirector(spectra, opts) -> { tick(dt), draw(g, W, H, band), ... }
//    installHook(win) -> sets win.snSaver
//
//  GREP MAP
//    export function wlRGB ........ CIE 1931 fit -> sRGB of a wavelength
//    export function boltz ........ LTE line weights at temperature T
//    export function planShots .... the seeded bag
//    export function plateFor ..... the plate of a shot
//    const DRAW = ................. the drawing of each shot kind
//    export function makeDirector . cuts, fades, frame
//    export function installHook .. the browser hook (enter, exit)
// ============================================================================
import { plateBand } from '../../lib/saver-clear.js';

export const KINDS = ['band', 'levels', 'stack', 'temp', 'compare'];
export const DUR = [5, 12];
export const KB = 8.617333e-5;          // Boltzmann constant, eV/K
export const HC = 1239.84193;           // h c, eV nm
export const CREDIT = 'Line data: NIST Atomic Spectra Database (ver. 5.12), Kramida, Ralchenko, Reader and NIST ASD Team';
export const TEX = {
  photon: String.raw`E = \frac{hc}{\lambda}`,
  boltz: String.raw`I \propto \frac{g_k A_{ki}}{\lambda}\, e^{-E_k / kT}`,
};
const VIS = [380, 750];

// ── colour ────────────────────────────────────────────────────────────────
// CIE 1931 2-degree colour-matching functions, the multi-lobe Gaussian fit
// of Wyman, Sloan and Shirley (2013).
const lobe = (x, m, s1, s2) => { const t = (x - m) / (x < m ? s1 : s2); return Math.exp(-0.5 * t * t); };
export function cmf(nm) {
  return [
    1.056 * lobe(nm, 599.8, 37.9, 31.0) + 0.362 * lobe(nm, 442.0, 16.0, 26.7) - 0.065 * lobe(nm, 501.1, 20.4, 26.2),
    0.821 * lobe(nm, 568.8, 46.9, 40.5) + 0.286 * lobe(nm, 530.9, 16.3, 31.1),
    1.217 * lobe(nm, 437.0, 11.8, 36.0) + 0.681 * lobe(nm, 459.0, 26.0, 13.8),
  ];
}
const xyz2lin = ([X, Y, Z]) => [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.2040 * Y + 1.0570 * Z];
const gam = v => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
// Linear sRGB to a display colour: lift the negative channel (desaturate
// to the gamut), set the largest channel to 1, then the sRGB gamma.
function toDisplay(lin) {
  const m = Math.min(0, lin[0], lin[1], lin[2]);
  const c = lin.map(v => v - m), mx = Math.max(c[0], c[1], c[2]) || 1;
  return c.map(v => gam(Math.max(0, v / mx)));
}
const MUTED_UV = [0.50, 0.36, 0.78], MUTED_IR = [0.62, 0.16, 0.12];
// The display colour of a wavelength, gamma-encoded 0..1. UV and IR give
// the muted violet and deep red. Near the ends of the visible range the
// colour fades, as the eye sees it.
export function wlRGB(nm) {
  if (nm < VIS[0]) return MUTED_UV.slice();
  if (nm > VIS[1]) return MUTED_IR.slice();
  const c = toDisplay(xyz2lin(cmf(nm)));
  const f = nm < 420 ? 0.35 + 0.65 * (nm - 380) / 40 : nm > 690 ? 0.35 + 0.65 * (750 - nm) / 60 : 1;
  return c.map(v => v * f);
}
const RGB_LUT = new Map();
export function wlCSS(nm, a = 1) {
  const k = Math.round(nm * 2);
  let c = RGB_LUT.get(k);
  if (!c) { c = wlRGB(k / 2).map(v => Math.round(v * 255)); RGB_LUT.set(k, c); }
  return `rgba(${c[0]},${c[1]},${c[2]},${a < 0 ? 0 : a > 1 ? 1 : +a.toFixed(3)})`;
}
const isUV = nm => nm < VIS[0], isIR = nm => nm > VIS[1];

// The perceived lamp colour: sum the lines through the CIE functions.
// w(line) is the weight of a line (linear). Returns gamma sRGB 0..1.
export function lampRGB(lines, w) {
  let X = 0, Y = 0, Z = 0;
  for (let i = 0; i < lines.length; i++) { const l = lines[i], c = cmf(l[0]), k = w(l, i); X += k * c[0]; Y += k * c[1]; Z += k * c[2]; }
  if (!(X + Y + Z > 0)) return [0.4, 0.4, 0.45];
  return toDisplay(xyz2lin([X, Y, Z]));
}
// strength01 is a log rank: 1 is the strongest line. This gives a linear
// display weight over three decades.
export const linW = s => Math.pow(10, 3 * (s - 1));

// Boltzmann weights (LTE, optically thin): gk * Aki / wl * exp(-Ek / kT),
// with Ek the upper level energy. Divided by the largest weight, so 1 is
// the brightest line at T. Returns a Float64Array in line order.
export function boltz(spec, T) {
  const L = spec.lines, out = new Float64Array(L.length);
  let mx = 0;
  const fixed = [];
  for (let i = 0; i < L.length; i++) {
    const l = L[i], up = l[5] >= 0 ? spec.levels[l[5]] : null;
    // An unclassified line (no levels) or a line with no Aki has no
    // Boltzmann weight. It keeps its stored strength at every T.
    if (!up || !l[2]) { fixed.push(i); continue; }
    const v = (l[3] || 1) * l[2] / l[0] * Math.exp(-up[0] / (KB * T));
    out[i] = Number.isFinite(v) ? v : 0;
    if (out[i] > mx) mx = out[i];
  }
  if (mx > 0) for (let i = 0; i < out.length; i++) out[i] /= mx;
  for (const i of fixed) out[i] = linW(L[i][1]);
  return out;
}

// The column key of a level in the energy-level diagram: the L letter of
// its term and a '*' for odd parity, for example "2p6.3p 2P* 3/2" -> 'P*'.
// A term with no L letter (jK coupling, hydrogen n) gives only the parity.
const L_ORDER = 'SPDFGHIKLM';
export function termKey(label) {
  const tk = String(label || '').trim().split(/\s+/);
  const term = tk.length >= 2 ? tk[tk.length - 2] : '';
  const odd = /\*/.test(term) ? '*' : '';
  const m = /([SPDFGHIKLM])\*?$/.exec(term);
  return m ? m[1] + odd : odd || '-';
}
const keyRank = k => (L_ORDER.indexOf(k[0]) >= 0 ? L_ORDER.indexOf(k[0]) * 2 : 20) + (k.endsWith('*') ? 1 : 0);

// ── data helpers ──────────────────────────────────────────────────────────
const visLines = s => (s ? s.lines.filter(l => l[0] >= VIS[0] && l[0] <= VIS[1]) : []);
export function strongest(spec, visibleOnly = true) {
  let best = null;
  for (const l of spec.lines) if ((!visibleOnly || (l[0] >= VIS[0] && l[0] <= VIS[1])) && (!best || l[1] > best[1])) best = l;
  return best;
}
// The spectra that make a good shot: at least min visible lines.
export function candidates(spectra, min = 6) {
  const out = [];
  for (const e of (spectra && spectra.elements) || []) for (const ion of ['I', 'II']) {
    const s = e[ion];
    if (s && s.lines && s.lines.length && visLines(s).length >= min) out.push({ z: e.z, sym: e.sym, ion });
  }
  return out;
}
const elOf = (spectra, z) => spectra.elements.find(e => e.z === z);

// ── plan ──────────────────────────────────────────────────────────────────
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, a) => a[Math.floor(r() * a.length)];

export function planShots(seed, spectra, n = 64, { calm = 0.5 } = {}) {
  const r = rng((seed >>> 0) || 1), out = [];
  const cand = candidates(spectra), lev = cand.filter(c => { const s = elOf(spectra, c.z)[c.ion]; return s.levels && s.levels.length >= 4; });
  const temp = cand.filter(c => { const s = elOf(spectra, c.z)[c.ion]; return s.lines.some(l => l[2] > 0); });
  if (!cand.length) return out;
  const kinds = KINDS.filter(k => (k === 'levels' ? lev.length : k === 'temp' ? temp.length : k === 'compare' ? cand.length > 1 : true));
  let bag = [], lastZ = -1;
  const pickEl = pool => { let c = pick(r, pool); for (let i = 0; i < 4 && c.z === lastZ && pool.length > 1; i++) c = pick(r, pool); lastZ = c.z; return c; };
  while (out.length < n) {
    if (!bag.length) {
      bag = kinds.slice();
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
      const last = out.length ? out[out.length - 1].kind : null;
      if (bag.length > 1 && bag[bag.length - 1] === last) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
    }
    const kind = bag.pop();
    const dur = +Math.min(DUR[1], Math.max(DUR[0], 6.5 + r() * 3.5 + 2 * calm)).toFixed(2);
    const sh = { kind, dur, seed: 1 + Math.floor(r() * 999998) };
    if (kind === 'band') Object.assign(sh, pickEl(cand));
    else if (kind === 'levels') Object.assign(sh, pickEl(lev));
    else if (kind === 'temp') { Object.assign(sh, pickEl(temp)); sh.T0 = 2500 + Math.round(r() * 1500); sh.T1 = 18000 + Math.round(r() * 12000); if (r() < 0.5) [sh.T0, sh.T1] = [sh.T1, sh.T0]; }
    else if (kind === 'stack') { const N = spectra.elements.length; sh.from = Math.floor(r() * Math.max(1, N * 0.45)); sh.ion = r() < 0.75 ? 'I' : 'II'; }
    else if (kind === 'compare') {
      const a = pickEl(cand);
      let b = pick(r, cand);
      for (let i = 0; i < 8 && b.z === a.z; i++) b = pick(r, cand);
      if (b.z === a.z) b = cand.find(c => c.z !== a.z) || b;
      sh.a = a; sh.b = b; sh.z = a.z; sh.sym = a.sym; sh.ion = a.ion;
    }
    out.push(sh);
  }
  return out;
}

// ── plate ─────────────────────────────────────────────────────────────────
const ROMAN = { I: 'I', II: 'II' };
const nameOf = (names, sym) => (names && names[sym]) || sym;
const ionWord = ion => (ion === 'II' ? 'singly ionised' : 'neutral atom');
const nmText = nm => `${nm.toFixed(2)} nm`;
const eVText = nm => `${(HC / nm).toFixed(2)} eV`;
export function plateFor(sh, k, names, spectra) {
  const s = spectra && sh.z ? (elOf(spectra, sh.z) || {})[sh.ion] : null;
  const top = s ? strongest(s) || strongest(s, false) : null;
  const elTitle = `${nameOf(names, sh.sym)} · ${sh.sym} ${ROMAN[sh.ion] || ''}`.trim();
  const base = top ? [{ name: 'strongest line', value: nmText(top[0]) }, { name: 'photon', value: eVText(top[0]) }] : [];
  const lines = [CREDIT];
  if (sh.kind === 'band') {
    return { title: elTitle, sub: `Emission spectrum, ${ionWord(sh.ion)}: ${s ? s.lines.length : 0} lines from 200 to 1100 nm`,
      params: [...base, { name: 'lines in view', value: String(k == null ? 0 : k) }], tex: [TEX.photon], lines };
  }
  if (sh.kind === 'levels') {
    return { title: elTitle, sub: 'Energy levels: an electron drops and a photon leaves', tex: [TEX.photon], lines,
      params: k && k.line ? [{ name: 'line', value: nmText(k.line[0]) }, { name: 'photon', value: eVText(k.line[0]) }, { name: 'A_ki', value: `${k.line[2].toExponential(2)} /s` }] : base };
  }
  if (sh.kind === 'temp') {
    return { title: elTitle, sub: 'The lamp at temperature T (LTE, optically thin; no ionisation balance)', tex: [TEX.boltz], lines,
      params: [{ name: 'T', value: `${Math.round(k && k.T ? k.T : sh.T0).toLocaleString('en-US')} K` }, ...(top ? [{ name: 'strongest line', value: nmText(top[0]) }] : []), { name: 'lamp colour', value: (k && k.hex) || '-' }] };
  }
  if (sh.kind === 'stack') {
    const e = k && k.sym ? k : null;
    return { title: 'Every element, line by line', sub: e ? `Centre row: ${nameOf(names, e.sym)} · ${e.sym} ${sh.ion}` : `Rows sorted by Z, ${sh.ion} spectra`,
      params: e ? [{ name: 'Z', value: String(e.z) }, ...(e.top ? [{ name: 'strongest line', value: nmText(e.top) }] : [])] : [], tex: [TEX.photon], lines };
  }
  if (sh.kind === 'compare') {
    const t = c => `${nameOf(names, c.sym)} ${c.ion}`;
    return { title: `${sh.a.sym} ${sh.a.ion} and ${sh.b.sym} ${sh.b.ion}`, sub: `${t(sh.a)} over ${t(sh.b)}: lines within 0.5 nm are linked`,
      params: [{ name: 'near pairs', value: String(k == null ? 0 : k) }, ...base], tex: [TEX.photon], lines };
  }
  return { title: 'Spectral lines', lines };
}

// ── drawing ───────────────────────────────────────────────────────────────
const ease = u => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const FONT = '"Inter", system-ui, sans-serif';

// One glowing line at x from y0 to y1. UV and IR lines are dashed.
function glowLine(g, x, y0, y1, nm, a, wCore = 1.4) {
  if (a <= 0.004) return;
  const h = y1 - y0;
  if (isUV(nm) || isIR(nm)) {
    g.fillStyle = wlCSS(nm, 0.75 * a);
    for (let y = y0; y < y1; y += 6) g.fillRect(x - 0.7, y, 1.4, Math.min(3.5, y1 - y));
    return;
  }
  g.fillStyle = wlCSS(nm, 0.10 * a); g.fillRect(x - 6, y0, 12, h);
  g.fillStyle = wlCSS(nm, 0.30 * a); g.fillRect(x - 2.2, y0, 4.4, h);
  g.fillStyle = wlCSS(nm, a); g.fillRect(x - wCore / 2, y0, wCore, h);
  if (a > 0.6) { g.fillStyle = `rgba(255,255,255,${((a - 0.6) * 0.5).toFixed(3)})`; g.fillRect(x - 0.4, y0, 0.8, h); }
}
// A band: rect, lines, wl range, alpha of each line.
function drawBand(g, R, lines, w0, w1, alphaOf, opt = {}) {
  g.save();
  g.fillStyle = '#020204'; g.fillRect(R.x, R.y, R.w, R.h);
  // a faint visible-range rainbow at the base, so the band reads as a spectrum
  const sx = nm => R.x + (nm - w0) / (w1 - w0) * R.w;
  if (opt.rainbow !== false) for (let nm = Math.max(w0, VIS[0]); nm < Math.min(w1, VIS[1]); nm += 2) { g.fillStyle = wlCSS(nm, 0.07); g.fillRect(sx(nm), R.y + R.h * 0.92, Math.max(1, R.w / (w1 - w0) * 2 + 0.5), R.h * 0.08); }
  g.beginPath(); g.rect(R.x, R.y, R.w, R.h); g.clip();
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]; if (l[0] < w0 - 1 || l[0] > w1 + 1) continue;
    glowLine(g, sx(l[0]), R.y, R.y + R.h, l[0], alphaOf(l, i), opt.core || Math.max(1.2, R.h / 160));
  }
  g.restore();
  if (opt.axis !== false) drawAxis(g, R, w0, w1);
}
function drawAxis(g, R, w0, w1) {
  const sx = nm => R.x + (nm - w0) / (w1 - w0) * R.w;
  const fs = clamp(Math.round(R.h * 0.07), 9, 13);
  g.save();
  g.font = `500 ${fs}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'top';
  const step = w1 - w0 > 300 ? 100 : w1 - w0 > 120 ? 50 : w1 - w0 > 50 ? 20 : 10;
  for (let nm = Math.ceil(w0 / (step / 2)) * (step / 2); nm <= w1; nm += step / 2) {
    const x = sx(nm), major = Math.abs(nm / step - Math.round(nm / step)) < 1e-6;
    g.fillStyle = 'rgba(210,218,232,0.45)'; g.fillRect(x - 0.5, R.y + R.h, 1, major ? 6 : 3);
    if (major) { g.fillStyle = 'rgba(214,220,232,0.62)'; g.fillText(`${nm}`, x, R.y + R.h + 8); }
  }
  g.textAlign = 'left'; g.fillStyle = 'rgba(214,220,232,0.5)'; g.fillText('nm', R.x + R.w + 6, R.y + R.h + 8);
  g.textBaseline = 'bottom';
  if (w0 < VIS[0]) { g.fillStyle = 'rgba(170,140,230,0.8)'; g.fillText('UV', R.x + 4, R.y - 4); }
  if (w1 > VIS[1]) { g.textAlign = 'right'; g.fillStyle = 'rgba(220,100,90,0.8)'; g.fillText('IR', R.x + R.w - 4, R.y - 4); }
  g.restore();
}
function tag(g, text, x, y, fs, col = 'rgba(232,236,244,0.85)', align = 'left') {
  g.save(); g.font = `600 ${fs}px ${FONT}`; g.textAlign = align; g.textBaseline = 'middle'; g.fillStyle = col; g.fillText(text, x, y); g.restore();
}

// Each draw function gets (g, run, R, tau, u) and returns the plate state k.
const DRAW = {
  band(g, run, R, tau, u) {
    const s = run.spec, L = s.lines, top = run.top;
    if (!run.order) run.order = L.map((l, i) => i).sort((a, b) => L[b][1] - L[a][1]);
    if (!run.rank) { run.rank = new Int32Array(L.length); run.order.forEach((i, r) => { run.rank[i] = r; }); }
    const fill = ease(u / 0.62), shown = Math.ceil(fill * L.length);
    const z = ease((u - 0.6) / 0.4), c = top ? top[0] : 560;
    const w0 = lerp(330, Math.max(330, c - 60), z), w1 = lerp(880, Math.min(880, c + 60), z);
    if (!run.seen) run.seen = new Float32Array(L.length).fill(-1);
    const B = { x: R.x, y: R.y + R.h * 0.18, w: R.w, h: R.h * 0.62 };
    drawBand(g, B, L, w0, w1, (l, i) => {
      const r = run.rank[i]; if (r >= shown) return 0;
      if (run.seen[i] < 0) run.seen[i] = tau;
      const flash = Math.exp(-(tau - run.seen[i]) * 3);
      return clamp(0.25 + 0.75 * l[1] + 0.8 * flash, 0, 1);
    });
    if (top && z > 0.05) {
      const x = B.x + (top[0] - w0) / (w1 - w0) * B.w;
      tag(g, `${top[0].toFixed(2)} nm`, x, B.y - 14, clamp(Math.round(R.h * 0.05), 11, 16), `rgba(240,240,236,${(0.9 * z).toFixed(2)})`, 'center');
    }
    return Math.min(shown, L.length);
  },
  levels(g, run, R, tau, u, dt) {
    const s = run.spec, Lv = s.levels;
    if (!run.cols) {
      const keys = [...new Set(Lv.map(l => termKey(l[1])))].sort((a, b) => keyRank(a) - keyRank(b)).slice(0, 9);
      run.cols = keys; run.colOf = Lv.map(l => Math.max(0, keys.indexOf(termKey(l[1]))));
      if (keys.length === 1 || keys.every(k => k === keys[0])) run.colOf = Lv.map(() => 0);
      run.emax = Math.max(...Lv.map(l => l[0])) || 1;
      run.fx = []; run.flash = new Float32Array(s.lines.length); run.next = 0.3;
      run.wsum = 0; run.w = s.lines.map(l => { const w = Math.pow(l[1] + 0.05, 2); run.wsum += w; return w; });
    }
    const D = { x: R.x, y: R.y, w: R.w, h: R.h * 0.72 }, B = { x: R.x, y: R.y + R.h * 0.82, w: R.w, h: R.h * 0.16 };
    const nc = run.cols.length, cw = D.w / nc;
    const lx = i => D.x + cw * (run.colOf[i] + 0.5), ly = i => D.y + D.h - (Lv[i][0] / run.emax) * D.h;
    // new transitions: weighted by strength, a slower rate when calm
    run.next -= dt;
    if (run.next <= 0) {
      run.next = (0.18 + 0.32 * run.r()) * (1 + run.calm);
      let x = run.r() * run.wsum, i = 0;
      for (; i < run.w.length - 1; i++) { x -= run.w[i]; if (x <= 0) break; }
      const l = s.lines[i];
      if (Lv[l[4]] && Lv[l[5]]) run.fx.push({ i, t0: tau, j: (run.r() - 0.5) * cw * 0.5 });
      run.last = l;
    }
    // level bars
    g.save();
    const fs = clamp(Math.round(R.h * 0.045), 10, 14);
    for (let c = 0; c < nc; c++) { const k = run.cols[c]; if (k !== '-') tag(g, k.replace('*', '°'), D.x + cw * (c + 0.5), D.y - 12, fs, 'rgba(200,210,226,0.6)', 'center'); }
    g.fillStyle = 'rgba(190,204,226,0.38)';
    for (let i = 0; i < Lv.length; i++) g.fillRect(lx(i) - cw * 0.34, ly(i) - 0.6, cw * 0.68, 1.2);
    g.globalCompositeOperation = 'lighter';
    run.fx = run.fx.filter(f => tau - f.t0 < 1.6);
    for (const f of run.fx) {
      const l = s.lines[f.i], a = tau - f.t0, up = l[5], lo = l[4];
      const x0 = lx(up) + f.j, y0 = ly(up), x1 = lx(lo) + f.j * 0.4, y1 = ly(lo);
      const drop = ease(a / 0.55), fade = 1 - ease((a - 0.9) / 0.7);
      g.strokeStyle = wlCSS(l[0], 0.5 * fade); g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(lerp(x0, x1, drop), lerp(y0, y1, drop)); g.stroke();
      // the bars of both levels light up
      g.fillStyle = wlCSS(l[0], 0.7 * fade); g.fillRect(lx(up) - cw * 0.34, y0 - 1, cw * 0.68, 2); g.fillRect(lx(lo) - cw * 0.34, y1 - 1, cw * 0.68, 2);
      // the electron
      if (a < 0.6) { const ex = lerp(x0, x1, drop), ey = lerp(y0, y1, drop); g.fillStyle = 'rgba(235,245,255,0.95)'; g.beginPath(); g.arc(ex, ey, 3, 0, 7); g.fill(); g.fillStyle = 'rgba(150,200,255,0.25)'; g.beginPath(); g.arc(ex, ey, 8, 0, 7); g.fill(); }
      // the photon: a wave packet that leaves from the lower level
      if (a > 0.5) {
        const p = a - 0.5, d = p * cw * 2.2, wl = clamp(l[0] / 60, 3, 14), dir = run.colOf[lo] < nc / 2 ? 1 : -1;
        g.strokeStyle = wlCSS(l[0], 0.95 * fade); g.lineWidth = 1.6; g.beginPath();
        for (let t = 0; t <= 40; t++) { const q = t / 40, xx = x1 + dir * (d + q * cw * 0.6), env = Math.sin(Math.PI * q), yy = y1 - 6 + env * 5 * Math.sin(q * cw * 0.6 / wl * 6.283 - p * 20); if (t) g.lineTo(xx, yy); else g.moveTo(xx, yy); }
        g.stroke();
      }
      if (a > 0.5 && a < 0.6) run.flash[f.i] = 1;
    }
    g.restore();
    for (let i = 0; i < run.flash.length; i++) run.flash[i] *= Math.exp(-dt * 1.8);
    drawBand(g, B, s.lines, 330, 880, (l, i) => 0.12 + 0.25 * l[1] + 0.9 * run.flash[i], { core: 1.2 });
    return run.last ? { line: run.last } : null;
  },
  stack(g, run, R, tau, u) {
    const els = run.spectra.elements, ion = run.sh.ion, N = els.length;
    const rh = Math.max(6, Math.round(R.h / 18)), lab = clamp(Math.round(rh * 0.55), 9, 16), gx = lab * 2.6;
    const W = R.w - gx, total = N * rh, travel = Math.max(0, Math.min(total - R.h, rh * 26));
    const y0 = Math.min(run.sh.from * rh, Math.max(0, total - R.h - travel));
    const off = y0 + travel * ease(u);
    const key = `${W}x${rh}:${ion}:${N}`;
    if (run.mk && run.cacheKey !== key) { run.cache = run.mk(Math.ceil(W), Math.ceil(total)); run.cacheKey = key; if (run.cache) paintStack(run.cache.getContext('2d'), els, ion, W, rh); }
    g.save(); g.beginPath(); g.rect(R.x, R.y, R.w, R.h); g.clip();
    if (run.cache) g.drawImage(run.cache, 0, off, Math.ceil(W), R.h, R.x + gx, R.y, Math.ceil(W), R.h);
    else { g.translate(R.x + gx, R.y - off); paintStack(g, els, ion, W, rh, Math.floor(off / rh), Math.ceil((off + R.h) / rh)); }
    g.restore();
    const mid = clamp(Math.floor((off + R.h / 2) / rh), 0, N - 1);
    for (let i = Math.max(0, Math.floor(off / rh)); i < Math.min(N, Math.ceil((off + R.h) / rh)); i++) {
      const y = R.y + i * rh - off + rh / 2;
      if (y < R.y + 4 || y > R.y + R.h - 4) continue;
      tag(g, els[i].sym, R.x + gx - 8, y, lab, i === mid ? 'rgba(250,246,236,0.95)' : 'rgba(200,208,222,0.5)', 'right');
    }
    const ym = R.y + mid * rh - off;
    g.save(); g.strokeStyle = 'rgba(240,236,224,0.35)'; g.lineWidth = 1; g.strokeRect(R.x + gx - 0.5, ym + 0.5, W + 1, rh - 1); g.restore();
    const e = els[mid], s = e[ion] || e.I || e.II, top = s ? strongest(s) : null;
    return { z: e.z, sym: e.sym, top: top ? top[0] : null };
  },
  temp(g, run, R, tau, u) {
    const s = run.spec, sh = run.sh;
    const T = sh.T0 * Math.pow(sh.T1 / sh.T0, ease(u / 0.9));
    const w = boltz(s, T), rgb = lampRGB(s.lines, (l, i) => (l[0] >= 360 && l[0] <= 780 ? w[i] : 0));
    const hex = '#' + rgb.map(v => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
    // the discharge tube
    const tw = R.w * 0.62, th = Math.max(14, R.h * 0.11), tx = R.x + (R.w - tw) / 2, ty = R.y + R.h * 0.14;
    const css = a => `rgba(${rgb.map(v => Math.round(v * 255)).join(',')},${a})`;
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let k = 5; k >= 1; k--) { g.fillStyle = css(0.05); roundRect(g, tx - k * 7, ty - k * 7, tw + k * 14, th + k * 14, th / 2 + k * 7); g.fill(); }
    g.fillStyle = css(0.95); roundRect(g, tx, ty, tw, th, th / 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.35)'; roundRect(g, tx + th * 0.4, ty + th * 0.28, tw - th * 0.8, th * 0.2, th * 0.1); g.fill();
    g.restore();
    g.fillStyle = 'rgba(160,170,186,0.5)'; g.fillRect(tx - th * 0.6, ty + th * 0.3, th * 0.6, th * 0.4); g.fillRect(tx + tw, ty + th * 0.3, th * 0.6, th * 0.4);
    const B = { x: R.x, y: R.y + R.h * 0.42, w: R.w, h: R.h * 0.44 };
    drawBand(g, B, s.lines, 330, 880, (l, i) => clamp(0.05 + 1.05 * Math.pow(w[i], 0.45), 0, 1));
    tag(g, `${Math.round(T).toLocaleString('en-US')} K`, R.x + R.w, ty + th / 2, clamp(Math.round(R.h * 0.06), 12, 20), 'rgba(240,238,230,0.85)', 'right');
    return { T: Math.round(T / 50) * 50, hex };
  },
  compare(g, run, R, tau, u) {
    const A = run.specA, Bs = run.specB;
    if (!run.pairs) {
      run.pairs = [];
      for (const a of A.lines) for (const b of Bs.lines) if (Math.abs(a[0] - b[0]) <= 0.5) run.pairs.push((a[0] + b[0]) / 2);
    }
    const z = ease((u - 0.55) / 0.45), c = run.pairs.length ? run.pairs[Math.floor(run.pairs.length / 2)] : (run.top ? run.top[0] : 560);
    const w0 = lerp(330, Math.max(330, c - 45), z), w1 = lerp(880, Math.min(880, c + 45), z);
    const h = R.h * 0.36, Ra = { x: R.x, y: R.y + R.h * 0.08, w: R.w, h }, Rb = { x: R.x, y: R.y + R.h * 0.08 + h + R.h * 0.12, w: R.w, h };
    const inA = ease(u / 0.25), inB = ease((u - 0.12) / 0.25);
    drawBand(g, Ra, A.lines, w0, w1, l => inA * (0.2 + 0.8 * l[1]), { axis: false });
    drawBand(g, Rb, Bs.lines, w0, w1, l => inB * (0.2 + 0.8 * l[1]));
    const fs = clamp(Math.round(R.h * 0.05), 11, 16);
    tag(g, `${run.sh.a.sym} ${run.sh.a.ion}`, R.x + 6, Ra.y + 12, fs);
    tag(g, `${run.sh.b.sym} ${run.sh.b.ion}`, R.x + 6, Rb.y + 12, fs);
    const link = ease((u - 0.3) / 0.2);
    if (link > 0) {
      g.save(); g.globalCompositeOperation = 'lighter';
      for (const nm of run.pairs) {
        if (nm < w0 || nm > w1) continue;
        const x = R.x + (nm - w0) / (w1 - w0) * R.w;
        g.fillStyle = wlCSS(nm, 0.55 * link); g.fillRect(x - 0.6, Ra.y + h, 1.2, Rb.y - Ra.y - h);
        g.fillStyle = 'rgba(255,255,255,' + (0.7 * link).toFixed(2) + ')'; g.beginPath(); g.arc(x, (Ra.y + h + Rb.y) / 2, 2, 0, 7); g.fill();
      }
      g.restore();
    }
    return run.pairs.length;
  },
};
function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2); g.lineTo(x + r, y + h); g.arc(x + r, y + r, r, Math.PI / 2, Math.PI * 1.5); g.closePath();
}
// All rows of the stack, one element per row, I or II spectra, 380-750 nm.
// Rows i0..i1 only, when given (the path with no cache canvas).
export function paintStack(g, els, ion, W, rh, i0 = 0, i1 = els.length) {
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (let i = Math.max(0, i0); i < Math.min(els.length, i1); i++) {
    const e = els[i], s = e[ion] || null, y = i * rh;
    g.fillStyle = 'rgba(255,255,255,0.025)'; g.fillRect(0, y + rh - 1, W, 1);
    if (!s) continue;
    for (const l of s.lines) {
      if (l[0] < VIS[0] || l[0] > VIS[1]) continue;
      const x = (l[0] - VIS[0]) / (VIS[1] - VIS[0]) * W, a = 0.2 + 0.8 * l[1];
      g.fillStyle = wlCSS(l[0], 0.14 * a); g.fillRect(x - 3, y + 1, 6, rh - 2);
      g.fillStyle = wlCSS(l[0], a); g.fillRect(x - 0.6, y + 1, 1.2, rh - 2);
    }
  }
  g.restore();
}

// ── director ──────────────────────────────────────────────────────────────
// makeDirector(spectra, { seed, calm, label, names, makeCanvas })
//   tick(dt)               advance the clock, cut at the end of a shot
//   draw(g, W, H, band)    draw one frame; band = plateBand(H) or null
//   shot(), plan, debug(), cut()
export function frameRect(W, H, band) {
  const t = band ? band.t : Math.round(H * 0.17), b = band ? band.b : Math.round(H * 0.22);
  const pw = band && band.w > 0 ? Math.min(W, band.w) : W;
  const x = (W - pw) / 2 + pw * 0.07;
  return { x, y: t + 18, w: pw * 0.86, h: Math.max(80, H - t - b - 44) };
}
export function makeDirector(spectra, o = {}) {
  const calm = clamp(+o.calm || 0, 0, 1), label = typeof o.label === 'function' ? o.label : () => {};
  const seed = (o.seed >>> 0) || ((Math.random() * 2 ** 32) >>> 0);
  const plan = planShots(seed, spectra, 120, { calm });
  let i = -1, run = null, t = 0, clock = 0, plateKey = '', last = null;
  const names = o.names || {};
  function start(k) {
    i = k % plan.length; t = 0; const sh = plan[i];
    run = { sh, spectra, calm, r: rng(sh.seed), mk: o.makeCanvas || null };
    if (sh.z) { const e = elOf(spectra, sh.z); run.spec = e && e[sh.ion]; run.top = run.spec ? strongest(run.spec) : null; }
    if (sh.kind === 'compare') { run.specA = elOf(spectra, sh.a.z)[sh.a.ion]; run.specB = elOf(spectra, sh.b.z)[sh.b.ion]; }
    if (sh.kind === 'stack' && last && last.cache) { run.cache = last.cache; run.cacheKey = last.cacheKey; }
    last = run; plateKey = ''; plateTitle = '';
  }
  // The same title swaps the values in place; do that at most every 0.8 s.
  let plateT = -1e9, plateTitle = '';
  function setPlate(k) {
    const info = plateFor(run.sh, k, names, spectra), key = JSON.stringify(info);
    if (key === plateKey) return;
    if (info.title === plateTitle && plateKey && clock - plateT < 0.8) return;
    plateKey = key; plateTitle = info.title; plateT = clock;
    try { label(info); } catch (e) { /* the plate is optional */ }
  }
  if (plan.length) start(0);
  return {
    plan,
    shot: () => (run ? run.sh : null),
    tick(dt) { if (!run) return; const d = Math.max(0, Math.min(0.1, dt)); t += d; clock += d; if (t >= run.sh.dur) start(i + 1); },
    cut() { if (run) start(i + 1); },
    debug: () => (run ? { i, kind: run.sh.kind, t, dur: run.sh.dur } : null),
    draw(g, W, H, band, dt = 1 / 60) {
      g.save();
      g.fillStyle = '#04050a'; g.fillRect(0, 0, W, H);
      const vg = g.createRadialGradient ? g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7) : null;
      if (vg) { vg.addColorStop(0, 'rgba(30,36,60,0.35)'); vg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = vg; g.fillRect(0, 0, W, H); }
      g.restore();
      if (!run || !run.spec && run.sh.kind !== 'stack' && run.sh.kind !== 'compare') return;
      const R = frameRect(W, H, band), u = t / run.sh.dur;
      g.save();
      g.globalAlpha = clamp(Math.min(t / 0.6, (run.sh.dur - t) / 0.5), 0, 1);
      let k = null;
      try { k = DRAW[run.sh.kind](g, run, R, t, u, dt); } catch (e) { if (!run.warned) { run.warned = true; console.warn('spectral saver', e); } }
      g.restore();
      setPlate(k);
    },
  };
}

// ── the browser hook ──────────────────────────────────────────────────────
const HIDE = 'body>*:not(.sl-saver-canvas){display:none!important}.sl-saver-canvas{position:fixed;inset:0;width:100vw;height:100vh;display:block;cursor:none;background:#04050a;z-index:1}';
function loadData(win) {
  if (win.SPECTRA && win.SPECTRA.elements) return Promise.resolve(win.SPECTRA);
  return new Promise((res, rej) => {
    const doc = win.document, sc = doc.createElement('script');
    sc.src = new URL('./data/lines.js', import.meta.url).href;
    sc.onload = () => (win.SPECTRA ? res(win.SPECTRA) : rej(new Error('no SPECTRA')));
    sc.onerror = () => rej(new Error('data/lines.js did not load'));
    doc.head.appendChild(sc);
  });
}
export function installHook(win) {
  let run = null;
  const fire = name => { try { win.dispatchEvent(new win.CustomEvent(name)); } catch (e) { /* no events */ } };
  win.snSaver = {
    enter(o = {}) {
      if (run) win.snSaver.exit();
      const doc = win.document;
      win.snSaverActive = true; fire('sn-saver-enter');
      const st = doc.createElement('style'); st.textContent = HIDE; doc.head.appendChild(st);
      const canvas = doc.createElement('canvas'); canvas.className = 'sl-saver-canvas'; canvas.setAttribute('aria-hidden', 'true');
      doc.body.appendChild(canvas);
      const R = run = { o, st, canvas, dir: null, raf: 0, prev: 0, band: null, bandT: 0, names: {} };
      import('../periodic-table/data/elements.js').then(m => { for (const e of m.ELEMENTS || []) R.names[e.sym] = e.name; }).catch(() => { /* symbols only */ });
      const makeCanvas = (w, h) => { const c = doc.createElement('canvas'); c.width = w; c.height = h; return c; };
      loadData(win).then(sp => {
        if (run !== R) return;
        R.dir = makeDirector(sp, { seed: o.seed, calm: o.calm, label: o.label, names: R.names, makeCanvas });
      }).catch(e => console.error('spectral saver', e));
      const frame = ts => {
        if (run !== R) return;
        R.raf = win.requestAnimationFrame(frame);
        const dt = R.prev ? (ts - R.prev) / 1000 : 1 / 60; R.prev = ts;
        const W = canvas.clientWidth || win.innerWidth || 1, H = canvas.clientHeight || win.innerHeight || 1;
        const dpr = Math.min(2, win.devicePixelRatio || 1);
        if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
        if ((R.bandT -= dt) <= 0) { R.bandT = 0.5; try { R.band = plateBand(H); } catch (e) { R.band = null; } }
        const g = canvas.getContext('2d'); if (!g) return;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (R.dir) { R.dir.tick(dt); R.dir.draw(g, W, H, R.band, dt); }
        else { g.fillStyle = '#04050a'; g.fillRect(0, 0, W, H); }
      };
      R.raf = win.requestAnimationFrame(frame);
      return { canvas, warmupMs: 700 };
    },
    exit() {
      const R = run; if (!R) return;
      run = null;
      win.cancelAnimationFrame(R.raf);
      if (typeof R.o.label === 'function') { try { R.o.label(null); } catch (e) { /* ok */ } }
      R.canvas.remove(); R.st.remove();
      win.snSaverActive = false; fire('sn-saver-exit');
    },
    debug: () => (run && run.dir ? run.dir.debug() : null),
    cut: () => { if (run && run.dir) run.dir.cut(); },
  };
  return win.snSaver;
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') installHook(window);
