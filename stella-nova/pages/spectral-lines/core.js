// ============================================================================
//  SPECTRAL LINES  ·  core.js  (ES module, no DOM, no canvas)
// ----------------------------------------------------------------------------
//  The pure part of the page: the colour of a wavelength, the line weights
//  of the two brightness models, the lamp colour, the search by wavelength,
//  the layouts of the overview (periodic table and stack), the columns of
//  the energy-level diagram, and the parse of the URL. main.js, draw.js,
//  tests.mjs and the saver can import it. Node can import it.
//
//  COLOUR. cmf() is the analytic multi-lobe fit of the CIE 1931 2-degree
//  colour-matching functions by Wyman, Sloan and Shirley (2013, JCGT 2(2)).
//  XYZ goes to linear sRGB with the standard matrix, then to the sRGB
//  gamma. A pure spectral colour is out of the sRGB gamut, so the display
//  colour clips the negative channels and scales the largest channel to 1.
//  Lines below 380 nm (UV) and above 750 nm (IR) get a muted violet or a
//  deep red. The page draws them dashed.
//
//  WEIGHTS. Model 'nist' uses the strength01 of the data (a log rank, 1 for
//  the strongest kept line). Model 'boltz' uses an optically thin LTE source:
//      I(T) = gk * Aki / lambda * exp(-Ek / (k T)),  k = 8.617333e-5 eV/K
//  Ek is the energy of the upper level. A line with no Aki in the data gets
//  the median gA/lambda of its spectrum times 10^(3 (s - 1)), with s its
//  NIST rank. Each spectrum is scaled to its own strongest line, so the
//  page does no Saha balance between I and II. An unclassified line
//  (loIdx and upIdx -1: no level data) keeps its stored strength in both
//  models, outside the Boltzmann scale.
//
//  EXPORTS   (jump with grep -n "<anchor>" core.js)
//      cmf, xyzToLinear, wlToLinear .... "export function cmf"
//      wlToRGB, bandOf, rgbCSS, LUT .... "export function wlToRGB"
//      boltzWeight, weights ............ "export function boltzWeight"
//      lampColor ....................... "export function lampColor"
//      findByWavelength, nearestLine ... "export function findByWavelength"
//      tablePos, tableRects, stackRects  "export function tableRects"
//      parseTerm, grotrian ............. "export function grotrian"
//      parseQuery, fmtA, niceTicks ..... "export function parseQuery"
// ============================================================================

export const K_B = 8.617333e-5;               // Boltzmann constant, eV/K
export const HC = 1239.84198;                 // h c in eV nm
export const WL_MIN = 200, WL_MAX = 1100;     // the range of the data, nm
export const VIS = [380, 750];                // the visible window, nm
export const RANGES = { visible: [380, 750], full: [200, 1100] };
export const T_MIN = 1500, T_MAX = 40000;

// ─── colour ────────────────────────────────────────────────────────────────
// One lobe of the fit: a Gaussian with a different width on each side.
function lobe(x, mu, s1, s2) { const t = (x - mu) / (x < mu ? s1 : s2); return Math.exp(-0.5 * t * t); }

// CIE 1931 2-degree x, y, z bar at nm (Wyman, Sloan and Shirley 2013).
export function cmf(nm) {
  const x = 1.056 * lobe(nm, 599.8, 37.9, 31.0) + 0.362 * lobe(nm, 442.0, 16.0, 26.7) - 0.065 * lobe(nm, 501.1, 20.4, 26.2);
  const y = 0.821 * lobe(nm, 568.8, 46.9, 40.5) + 0.286 * lobe(nm, 530.9, 16.3, 31.1);
  const z = 1.217 * lobe(nm, 437.0, 11.8, 36.0) + 0.681 * lobe(nm, 459.0, 26.0, 13.8);
  return [x, y, z];
}

// XYZ (D65 white) to linear sRGB.
export function xyzToLinear([X, Y, Z]) {
  return [
    3.2406 * X - 1.5372 * Y - 0.4986 * Z,
    -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
    0.0557 * X - 0.2040 * Y + 1.0570 * Z,
  ];
}
export const wlToLinear = nm => xyzToLinear(cmf(nm));
const gamma = c => c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
export const bandOf = nm => nm < VIS[0] ? 'UV' : nm > VIS[1] ? 'IR' : 'vis';
const UV_RGB = [0.46, 0.34, 0.86], IR_RGB = [0.62, 0.10, 0.12];

// Display colour of a line at nm: [r, g, b] in 0..1, sRGB gamma, largest
// channel 1, and a soft fade at the two ends of the visible window (the eye
// sees less there). UV and IR get the muted colours.
export function wlToRGB(nm) {
  const b = bandOf(nm);
  if (b === 'UV') return UV_RGB.slice();
  if (b === 'IR') return IR_RGB.slice();
  const lin = wlToLinear(nm).map(c => Math.max(0, c));
  const m = Math.max(1e-9, ...lin);
  let f = 1;
  if (nm < 420) f = 0.42 + 0.58 * (nm - 380) / 40;
  else if (nm > 690) f = 0.42 + 0.58 * (750 - nm) / 60;
  return lin.map(c => gamma(c / m) * f);
}
export const rgbCSS = (c, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;

// A 1 nm table of display colours from 195 to 1105 nm: rgb 0..255.
export const LUT = (() => {
  const t = new Uint8ClampedArray(911 * 3);
  for (let i = 0; i <= 910; i++) { const c = wlToRGB(195 + i); t[i * 3] = c[0] * 255; t[i * 3 + 1] = c[1] * 255; t[i * 3 + 2] = c[2] * 255; }
  return t;
})();
// [r, g, b] 0..255 from the table.
export function lutRGB(nm) {
  const i = Math.max(0, Math.min(910, Math.round(nm - 195))) * 3;
  return [LUT[i], LUT[i + 1], LUT[i + 2]];
}

// ─── weights ───────────────────────────────────────────────────────────────
// gk Aki / lambda exp(-Ek / kT) for one line. Ek from the upper level.
export const unclassified = line => line[4] < 0 || line[5] < 0;
export function boltzWeight(line, levels, T) {
  const up = line[5] >= 0 ? levels[line[5]] : null, Ek = up ? up[0] : 0;
  return line[3] * line[2] / line[0] * Math.exp(-Ek / (K_B * T));
}

// The weights of every line of spec for a model. Returns { b, lin }:
//   b    display brightness 0..1 (log scale, as strength01)
//   lin  linear intensity, the largest line 1 (for the lamp colour)
// Model 'nist': b = strength01, lin = 10^(3 (s - 1)).
// Model 'boltz': the LTE intensity at T, b = 1 + log10(I / Imax) / 3.5.
export function weights(spec, model = 'nist', T = 6000) {
  const L = spec.lines, n = L.length, b = new Float32Array(n), lin = new Float32Array(n);
  if (model !== 'boltz') {
    for (let i = 0; i < n; i++) { b[i] = L[i][1]; lin[i] = Math.pow(10, 3 * (L[i][1] - 1)); }
    return { b, lin };
  }
  const ga = [];
  for (const l of L) if (l[2] > 0 && !unclassified(l)) ga.push(l[3] * l[2] / l[0]);
  ga.sort((p, q) => p - q);
  const med = ga.length ? ga[ga.length >> 1] : 1;
  let mx = 0;
  const raw = new Float64Array(n);       // Float32 loses the small values at low T
  for (let i = 0; i < n; i++) {
    const l = L[i];
    if (unclassified(l)) { raw[i] = -1; continue; }
    let w = boltzWeight(l, spec.levels, T);
    if (!(l[2] > 0)) {
      const up = spec.levels[l[5]], Ek = up ? up[0] : 0;
      w = med * Math.pow(10, 3 * (l[1] - 1)) * Math.exp(-Ek / (K_B * T));
    }
    if (!Number.isFinite(w) || w < 0) w = 0;
    raw[i] = w; if (w > mx) mx = w;
  }
  for (let i = 0; i < n; i++) {
    if (raw[i] < 0) { b[i] = L[i][1]; lin[i] = Math.pow(10, 3 * (L[i][1] - 1)); continue; }
    lin[i] = mx > 0 ? Math.min(1, raw[i] / mx) : 0;
    b[i] = lin[i] > 0 ? Math.max(0, 1 + Math.log10(lin[i]) / 3.5) : 0;
  }
  return { b, lin };
}

// Perceived colour of the lamp: the sum of lin * cmf over the lines, to
// linear sRGB, clipped, largest channel 1, then gamma. Returns
// { rgb: [0..255 x3], hex, Y } (Y is the relative luminance before the scale).
export function lampColor(spec, lin) {
  let X = 0, Y = 0, Z = 0;
  if (spec) spec.lines.forEach((l, i) => { const w = lin[i]; if (!(w > 0)) return; const c = cmf(l[0]); X += w * c[0]; Y += w * c[1]; Z += w * c[2]; });
  if (X + Y + Z <= 0) return { rgb: [40, 40, 48], hex: '#282830', Y: 0 };
  let c = xyzToLinear([X, Y, Z]);
  const lo = Math.min(0, ...c); c = c.map(v => v - lo * 0.6);    // a little white for out-of-gamut sums
  c = c.map(v => Math.max(0, v));
  const m = Math.max(1e-9, ...c);
  const rgb = c.map(v => Math.round(gamma(v / m) * 255));
  return { rgb, hex: '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join(''), Y };
}

// ─── search ────────────────────────────────────────────────────────────────
// The first index of a line with wl >= nm (lines sorted by wl).
export function lowerBound(lines, nm) {
  let a = 0, b = lines.length;
  while (a < b) { const m = (a + b) >> 1; if (lines[m][0] < nm) a = m + 1; else b = m; }
  return a;
}

// Every element and ion with a line within +-tol nm of nm. One row per
// spectrum (its strongest line in the window), strongest first.
// Row: { z, sym, ion, wl, s, idx, d }.
export function findByWavelength(SP, nm, tol = 0.5, ions = ['I', 'II']) {
  const out = [];
  for (const e of (SP && SP.elements) || []) for (const ion of ions) {
    const sp = e[ion]; if (!sp) continue;
    let best = -1;
    for (let i = lowerBound(sp.lines, nm - tol); i < sp.lines.length && sp.lines[i][0] <= nm + tol; i++)
      if (best < 0 || sp.lines[i][1] > sp.lines[best][1]) best = i;
    if (best >= 0) { const l = sp.lines[best]; out.push({ z: e.z, sym: e.sym, ion, wl: l[0], s: l[1], idx: best, d: Math.abs(l[0] - nm) }); }
  }
  return out.sort((p, q) => q.s - p.s || p.d - q.d);
}

// The index of the line nearest to nm in px space, or -1. pxPerNm is the
// scale; maxPx the reach. A bright line wins over a faint one at equal reach.
export function nearestLine(lines, b, nm, pxPerNm, maxPx = 8) {
  const reach = maxPx / pxPerNm;
  let best = -1, bs = -Infinity;
  for (let i = lowerBound(lines, nm - reach); i < lines.length && lines[i][0] <= nm + reach; i++) {
    const dpx = Math.abs(lines[i][0] - nm) * pxPerNm;
    const sc = (b ? b[i] : lines[i][1]) * 4 - dpx;
    if (sc > bs) { bs = sc; best = i; }
  }
  return best;
}

// ─── layouts ───────────────────────────────────────────────────────────────
// Grid position of an element in the 18-column table: [col 1..18, row].
// The f block (block 'f', col32 3..16) goes in two rows below the table.
export function tablePos(e) {
  if (e.block === 'f') return [e.col32 + 0.5, e.period + 2.65];
  return [e.group || 3, e.period];
}

// Rects of the table view, in px, for the elements list: Map z -> {x,y,w,h}.
// The table fits the box { x, y, w, h }; the cells keep a gap.
export function tableRects(elements, box) {
  const cols = 18, rows = 9.65, gap = 0.07;
  const cw = box.w / cols, ch = box.h / rows;
  const m = new Map();
  for (const e of elements) {
    const [c, r] = tablePos(e);
    m.set(e.z, { x: box.x + (c - 1 + gap / 2) * cw, y: box.y + (r - 1 + gap / 2) * ch, w: cw * (1 - gap), h: ch * (1 - gap) });
  }
  return m;
}

// Rects of the stack view: one row per z in zs (sorted), a label column of
// labelW px at the left. Map z -> {x,y,w,h}.
export function stackRects(zs, box, labelW = 30) {
  const n = Math.max(1, zs.length), rh = box.h / n, gap = rh > 6 ? 1 : rh > 3 ? 0.5 : 0;
  const m = new Map();
  zs.forEach((z, i) => m.set(z, { x: box.x + labelW, y: box.y + i * rh + gap / 2, w: box.w - labelW, h: Math.max(0.6, rh - gap) }));
  return m;
}

export const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const lerpRect = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, w: a.w + (b.w - a.w) * k, h: a.h + (b.h - a.h) * k });

// ─── energy-level diagram ──────────────────────────────────────────────────
const L_ORDER = 'SPDFGHIKLMNOQ';
// The LS term of a level label, for example "2p6.3p 2P* 3/2" -> {mult 2,
// L 'P', odd true}. A jK term ("2[3/2]*") or a bare n gives null.
export function parseTerm(label) {
  const toks = String(label || '').split(/\s+/);
  for (let i = toks.length - 1; i >= 0; i--) {
    const m = toks[i].match(/^(\d+)([SPDFGHIKLMNOQ])(\*?)$/);
    if (m) return { mult: +m[1], L: m[2], odd: m[3] === '*' };
  }
  return null;
}

// Columns and lanes of the energy-level diagram for spec. Each level that a
// line uses gets a column: by L (S, P, D ...) and parity when the labels have
// LS terms, else one column. With one column the transitions spread into
// lanes, one per lower level (the series of hydrogen: Balmer, Paschen ...).
// Returns { cols: [{name, odd}], lvl: Map idx -> {E, col}, lanes: Map lo -> 0..1,
//           single, Emax }.
export function grotrian(spec, ionLimit) {
  const used = new Set();
  const cl = spec.lines.filter(l => l[4] >= 0 && l[5] >= 0);   // unclassified lines have no levels
  for (const l of cl) { used.add(l[4]); used.add(l[5]); }
  const keys = new Map(), lvl = new Map();
  let parsed = 0;
  for (const i of used) { if (parseTerm(spec.levels[i] && spec.levels[i][1])) parsed++; }
  const single = parsed < used.size * 0.5;
  for (const i of used) {
    const lv = spec.levels[i]; if (!lv) continue;
    const t = single ? null : parseTerm(lv[1]);
    const key = t ? t.L + (t.odd ? '*' : '') : '?';
    if (!keys.has(key)) keys.set(key, { name: t ? t.L : single ? '' : 'other', odd: t ? t.odd : false, ord: t ? L_ORDER.indexOf(t.L) * 2 + (t.odd ? 1 : 0) : 99 });
    lvl.set(i, { E: lv[0], key });
  }
  const cols = [...keys.entries()].sort((a, b) => a[1].ord - b[1].ord);
  const colIdx = new Map(cols.map(([k], i) => [k, i]));
  for (const v of lvl.values()) v.col = colIdx.get(v.key);
  const lanes = new Map();
  if (single) {
    const los = [...new Set(cl.map(l => l[4]))].sort((a, b) => (spec.levels[a][0] - spec.levels[b][0]));
    los.forEach((lo, i) => lanes.set(lo, los.length > 1 ? i / (los.length - 1) : 0.5));
  }
  let Emax = 0;
  for (const v of lvl.values()) Emax = Math.max(Emax, v.E);
  if (ionLimit > 0 && ionLimit < Emax * 1.6 + 1) Emax = Math.max(Emax, ionLimit);
  return { cols: cols.map(([, c]) => c), lvl, lanes, single, Emax: Emax * 1.03 || 1 };
}

// ─── misc ──────────────────────────────────────────────────────────────────
// ?el=<sym>&view=<table|stack> -> { el, view } (either may be null).
export function parseQuery(search) {
  const q = new URLSearchParams(search || '');
  const el = q.get('el'), v = q.get('view');
  return { el: el ? el.trim() : null, view: v === 'stack' || v === 'table' ? v : null };
}

const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
// An Aki value as "6.16×10⁷ s⁻¹", or "n/a".
export function fmtA(a) {
  if (!(a > 0)) return 'n/a';
  const e = Math.floor(Math.log10(a)), m = a / Math.pow(10, e);
  return `${m.toFixed(2)}×10${String(e).split('').map(c => SUP[c]).join('')} s⁻¹`;
}

// Tick values from lo to hi with about n major ticks: { major, minor, step }.
export function niceTicks(lo, hi, n = 8) {
  const raw = (hi - lo) / n, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  const step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
  const sub = step / 5, major = [], minor = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) major.push(+v.toFixed(6));
  for (let v = Math.ceil(lo / sub) * sub; v <= hi + 1e-9; v += sub) minor.push(+v.toFixed(6));
  return { major, minor, step };
}
