// ============================================================================
//  FLY DUEL  ·  explainer figures  (pure ES module + 2D canvas drawing)
// ----------------------------------------------------------------------------
//  Small figures for sections 03, 04 and 05.
//
//  ToyMB is a teaching model, labelled "illustrative" on the page. It has
//  the same sign convention as brain/mb.js in the contract:
//    delta = r + gamma * V(next) - V(now)            (TD error)
//    delta > 0: PAM DANs depress active KC -> avoid-MBON synapses
//    delta < 0: PPL1 DANs depress active KC -> approach-MBON synapses
//    dw = -lr * |delta| * eligibility, w clamped to [0, wmax]
//  So reward lowers the avoid drive and punishment lowers the approach
//  drive. Value V = sum over MBONs of valence * rate.
//
//  GREP MAP
//      grep -n 'export function jaccard'     overlap of two active sets
//      grep -n 'export function cosine'      similarity of two rate vectors
//      grep -n 'export class ToyMB'          the section 05 toy
//      grep -n 'export function drawToy'     draws the toy
//      grep -n 'export function drawGlomeruli' section 03 PN grid
//      grep -n 'export function drawSparse'  section 04 KC grid, two boards
// ============================================================================

import { TOKENS, PAIR, rgb, font } from './tokens.js';

export function jaccard(a, b) {
  if (!a || !b) return 0;
  const A = new Set(a); let both = 0;
  for (const i of b) if (A.has(i)) both++;
  const uni = A.size + new Set(b).size - both;
  return uni ? both / uni : 0;
}

export function cosine(a, b) {
  if (!a || !b) return 0;
  let ab = 0, aa = 0, bb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
}

// Two "boards" (odours) share one KC, so learning on one leaks a little
// onto the other. MBON 0 is approach (+1), MBON 1 is avoid (-1).
export class ToyMB {
  constructor({ nKc = 20, lr = 0.5, wmax = 1, gamma = 0.9 } = {}) {
    this.nKc = nKc; this.lr = lr; this.wmax = wmax; this.gamma = gamma;
    this.odours = [[1, 4, 7, 11], [11, 14, 16, 18]];
    this.valence = [1, -1];
    this.reset();
  }
  reset() { this.w = [new Float32Array(this.nKc).fill(0.5), new Float32Array(this.nKc).fill(0.5)]; this.lastDelta = 0; this.lastDan = 0; this.history = []; }
  rates(o) { const ks = this.odours[o]; return this.w.map(w => ks.reduce((s, k) => s + w[k], 0) / ks.length); }
  value(o) { const r = this.rates(o); return this.valence[0] * r[0] + this.valence[1] * r[1]; }
  // One trial: odour o, reward r, value of the next state vNext (0 = end).
  trial(o, r, vNext = 0) {
    const v = this.value(o);
    const delta = r + this.gamma * vNext - v;
    const m = delta > 0 ? 1 : 0; // PAM -> avoid MBON (index 1); PPL1 -> approach MBON (index 0)
    for (const k of this.odours[o]) {
      const w = this.w[m];
      w[k] = Math.max(0, Math.min(this.wmax, w[k] - this.lr * Math.abs(delta)));
    }
    // a slow recovery of the other side toward the start value
    const other = this.w[1 - m];
    for (const k of this.odours[o]) other[k] += (0.5 - other[k]) * 0.1;
    this.lastDelta = delta; this.lastDan = delta > 0 ? 1 : delta < 0 ? -1 : 0; this.lastOdour = o;
    this.history.push({ o, r, delta, v0: this.value(0), v1: this.value(1) });
    if (this.history.length > 40) this.history.shift();
    return delta;
  }
}

// Draw the toy: KCs in a row, two MBONs, the DANs, the lines with width
// = weight, and the value of each board. flash is 0..1 for the DAN.
export function drawToy(g, w, h, toy, sel, flash = 0) {
  g.clearRect(0, 0, w, h);
  const n = toy.nKc, y0 = h * 0.2, y1 = h * 0.66, pad = 18;
  const kx = i => pad + ((w - 2 * pad) * (i + 0.5)) / n;
  const mx = [w * 0.3, w * 0.7];
  const active = new Set(toy.odours[sel]);
  const both = new Set(toy.odours[0].filter(k => toy.odours[1].includes(k)));
  const cols = [rgb(TOKENS.app), rgb(TOKENS.avoid)];
  // synapse lines
  for (let m = 0; m < 2; m++) for (let k = 0; k < n; k++) {
    const wt = toy.w[m][k], on = active.has(k);
    g.strokeStyle = `rgba(${cols[m]},${on ? 0.25 + 0.6 * wt : 0.06 + 0.12 * wt})`;
    g.lineWidth = 0.5 + wt * (on ? 4 : 2);
    g.beginPath(); g.moveTo(kx(k), y0 + 6); g.lineTo(mx[m], y1 - 12); g.stroke();
  }
  // KCs
  for (let k = 0; k < n; k++) {
    const on = active.has(k);
    g.fillStyle = on ? TOKENS['kc-on'] : both.has(k) ? TOKENS.dim : TOKENS['kc-off'];
    g.beginPath(); g.arc(kx(k), y0, on ? 6 : 4.5, 0, 7); g.fill();
  }
  // MBONs and their rates
  const r = toy.rates(sel);
  const names = ['approach MBON', 'avoid MBON'];
  for (let m = 0; m < 2; m++) {
    g.fillStyle = `rgba(${cols[m]},${0.35 + 0.65 * Math.min(1, r[m])})`;
    g.beginPath(); g.arc(mx[m], y1, 12 + 6 * r[m], 0, 7); g.fill();
    g.fillStyle = TOKENS.ink2; g.font = font(12); g.textAlign = 'center';
    g.fillText(`${names[m]} ${r[m].toFixed(2)}`, mx[m], y1 + 34);
  }
  // DANs: PAM onto the avoid MBON, PPL1 onto the approach MBON
  const dans = [{ x: mx[1] + 46, lab: 'PAM', col: rgb(TOKENS.app), s: 1 }, { x: mx[0] - 46, lab: 'PPL1', col: rgb(TOKENS.avoid), s: -1 }];
  for (const d of dans) {
    const hot = toy.lastDan === d.s ? flash : 0;
    g.fillStyle = `rgba(${d.col},${0.35 + 0.65 * hot})`;
    g.beginPath(); g.moveTo(d.x, y1 - 8 - hot * 6); g.lineTo(d.x + 9 + hot * 5, y1 + 6); g.lineTo(d.x - 9 - hot * 5, y1 + 6); g.closePath(); g.fill();
    g.fillStyle = TOKENS.ink2; g.fillText(d.lab, d.x, y1 + 20);
    if (hot > 0) { g.strokeStyle = `rgba(${d.col},${hot * 0.7})`; g.lineWidth = 2; g.beginPath(); g.arc(d.s > 0 ? mx[1] : mx[0], y1, 20 + (1 - hot) * 22, 0, 7); g.stroke(); }
  }
  g.fillStyle = TOKENS.dim; g.textAlign = 'left'; g.fillText('Kenyon cells (lit = this board)', pad, y0 - 12);
  g.textAlign = 'right'; g.fillText(`V(board ${sel ? 'B' : 'A'}) = ${toy.value(sel).toFixed(2)}`, w - pad, y0 - 12);
  g.textAlign = 'left';
}

// Section 03: PN (glomerulus channel) rates as a grid of discs.
export function drawGlomeruli(g, w, h, rates, labels = null) {
  g.clearRect(0, 0, w, h);
  if (!rates || !rates.length) { g.fillStyle = TOKENS.dim; g.font = font(12); g.textAlign = 'center'; g.fillText('waiting for the brain model', w / 2, h / 2); g.textAlign = 'left'; return; }
  const n = rates.length, cols = Math.ceil(Math.sqrt((n * w) / h)), rows = Math.ceil(n / cols);
  const cw = w / cols, chh = h / rows, rad = Math.max(2, Math.min(cw, chh) * 0.4);
  let mx = 1e-6; for (const v of rates) mx = Math.max(mx, v);
  for (let i = 0; i < n; i++) {
    const x = (i % cols + 0.5) * cw, y = (Math.floor(i / cols) + 0.5) * chh, v = Math.max(0, rates[i]) / mx;
    g.fillStyle = `rgba(${rgb(TOKENS.pn)},${0.08 + 0.92 * v})`;
    g.beginPath(); g.arc(x, y, rad * (0.55 + 0.45 * v), 0, 7); g.fill();
    if (labels && rad > 9) { g.fillStyle = 'rgba(255,255,255,0.5)'; g.font = font(11); g.textAlign = 'center'; g.fillText(String(labels[i]).slice(0, 5), x, y + rad + 8); }
  }
  g.textAlign = 'left';
}

// Section 04: every KC as one cell. a and b are active sets for two boards.
export function drawSparse(g, w, h, n, a, b) {
  g.clearRect(0, 0, w, h);
  if (!n) return;
  const cols = Math.ceil(Math.sqrt((n * w) / h)), rows = Math.ceil(n / cols);
  const cw = w / cols, ch = h / rows, s = Math.max(1, Math.min(cw, ch) - 0.6);
  g.fillStyle = TOKENS['kc-off'];
  for (let i = 0; i < n; i++) g.fillRect((i % cols) * cw, Math.floor(i / cols) * ch, s, s);
  const A = new Set(a || []), Bs = new Set(b || []);
  for (const i of A) { g.fillStyle = Bs.has(i) ? TOKENS['kc-on'] : PAIR[0]; g.fillRect((i % cols) * cw - 0.5, Math.floor(i / cols) * ch - 0.5, s + 1, s + 1); }
  g.fillStyle = PAIR[1];
  for (const i of Bs) if (!A.has(i)) g.fillRect((i % cols) * cw - 0.5, Math.floor(i / cols) * ch - 0.5, s + 1, s + 1);
}
