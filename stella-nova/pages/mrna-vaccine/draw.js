// ============================================================================
//  MRNA VACCINE  ·  scene drawing  (ES module, 2D canvas only)
// ----------------------------------------------------------------------------
//  Each scene is a pure draw function of (ctx, w, h, state). The page cards
//  and the screensaver call the same functions, so a scene looks the same
//  in both. No function here reads the DOM or the clock: the caller passes
//  the time. All drawings are our own schematic art, not to scale.
//
//  EXPORTS   (jump with grep -n "<anchor>" draw.js)
//      PAL ............ "export const PAL"            the colour set
//      drawStrand ..... "export function drawStrand"   the mRNA, scrolled
//      strandWidth .... "export function strandWidth"  its full length in px
//      drawJourney .... "export function drawJourney"  LNP into a cell
//      drawTranslate .. "export function drawTranslate" ribosomes to spikes
//      drawSpike ...... "export function drawSpike"    prefusion/postfusion
//      drawTitre ...... "export function drawTitre"    illustrative antibodies
//      drawDecay ...... "export function drawDecay"    first-order decay
//      drawCharge ..... "export function drawCharge"   charge against pH
// ============================================================================
import { protonated, titre, remaining, journey, JOURNEY } from './data.js';

export const PAL = {
  bg: '#05070c', ink: '#e8eaf0', dim: '#8a91a5', faint: '#2a3142', line: 'rgba(255,255,255,0.12)',
  A: '#ff9a62', U: '#62c4ff', G: '#86dc7c', C: '#ffd666', M: '#e889dc',
  cap: '#ffd666', utr5: '#a8a4ff', orf: '#62c4ff', utr3: '#a8a4ff', polyA: '#ff9a62',
  lipid: '#9aa3b5', plus: '#ff9a62', peg: '#86dc7c', chol: '#ffd666', rna: '#62c4ff',
  memb: '#c9a7ff', cyto: '#0a0f1a', endo: '#1a1222',
  s1: '#62c4ff', rbd: '#86dc7c', hr1: '#ffd666', ch: '#ff9a62', s2: '#e889dc', pro: '#ffffff',
  ribo: '#c9d2df', chain: '#86dc7c',
};
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = k => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
const lerp = (a, b, k) => a + (b - a) * k;
function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

// ---------------------------------------------------------------- strand
const STEP = 24, GAPW = 92, CAPW = 46;
export function strandWidth(T) { return T.reduce((s, t) => s + (t.k === 'nt' ? STEP : t.k === 'gap' ? GAPW : CAPW), 0) + 80; }
// opts: { T, offset (px), mod (bool: m1Ψ for U), hover (index or -1) }.
// Returns the screen boxes of the tokens drawn, for hit tests.
export function drawStrand(g, w, h, { T, offset = 0, mod = true, hover = -1, time = 0 } = {}) {
  g.fillStyle = PAL.bg; g.fillRect(0, 0, w, h);
  const cy = h * 0.52, amp = Math.min(10, h * 0.05), r = Math.min(10.5, h * 0.07);
  const boxes = [];
  let x = 40 - offset;
  const xs = T.map(t => { const x0 = x; x += t.k === 'nt' ? STEP : t.k === 'gap' ? GAPW : CAPW; return x0; });
  const yAt = xx => cy + amp * Math.sin((xx + offset) * 0.045 + time * 0.8);
  // backbone
  g.strokeStyle = 'rgba(200,210,230,0.35)'; g.lineWidth = 2; g.beginPath();
  for (let xx = Math.max(0, xs[0]); xx <= Math.min(w, x); xx += 4) { const y = yAt(xx); xx === Math.max(0, xs[0]) ? g.moveTo(xx, y) : g.lineTo(xx, y); }
  g.stroke();
  // region bands over the strand
  let i = 0;
  while (i < T.length) {
    let j = i; while (j + 1 < T.length && T[j + 1].region === T[i].region) j++;
    const x0 = xs[i] - 4, x1 = (j + 1 < T.length ? xs[j + 1] : x) - 4;
    if (x1 > 0 && x0 < w) {
      g.fillStyle = PAL[T[i].region]; g.globalAlpha = 0.9;
      g.fillRect(Math.max(0, x0), cy - h * 0.36, Math.min(w, x1) - Math.max(0, x0), 3);
      g.globalAlpha = 1;
    }
    i = j + 1;
  }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  T.forEach((t, k) => {
    const x0 = xs[k];
    if (x0 < -CAPW - 10 || x0 > w + 10) return;
    if (t.k === 'cap') {
      const y = yAt(x0 + 16);
      g.fillStyle = PAL.cap; g.beginPath(); g.arc(x0 + 16, y, r * 1.35, 0, TAU); g.fill();
      g.fillStyle = PAL.bg; g.font = `600 ${Math.round(r * 0.95)}px Inter, sans-serif`; g.fillText('m⁷G', x0 + 16, y + 0.5);
      boxes.push({ k, x: x0, w: CAPW, y: y - r * 1.4, h: r * 2.8 });
      return;
    }
    if (t.k === 'gap') {
      const y = yAt(x0 + GAPW / 2);
      g.strokeStyle = PAL.dim; g.setLineDash([3, 5]); g.beginPath(); g.moveTo(x0 + 4, y); g.lineTo(x0 + GAPW - 10, y); g.stroke(); g.setLineDash([]);
      g.fillStyle = PAL.dim; g.font = '12px Inter, sans-serif';
      g.fillText(`… ${t.n} ${t.unit} …`, x0 + GAPW / 2 - 3, y - r * 2.1);
      boxes.push({ k, x: x0, w: GAPW, y: y - r * 2, h: r * 4 });
      return;
    }
    const cx = x0 + STEP / 2 - 2, y = yAt(cx);
    const isU = t.b === 'U', col = isU && mod ? PAL.M : PAL[t.b];
    g.fillStyle = col; g.globalAlpha = hover === k ? 1 : 0.92;
    g.beginPath(); g.arc(cx, y, r, 0, TAU); g.fill(); g.globalAlpha = 1;
    if (hover === k) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); }
    g.fillStyle = PAL.bg; g.font = `600 ${Math.round(r * 1.15)}px "STIX Two Text", Georgia, serif`;
    g.fillText(isU && mod ? 'Ψ' : t.b, cx, y + 0.5);
    if (isU && mod) { g.fillStyle = '#fff'; g.beginPath(); g.arc(cx + r * 0.72, y - r * 0.72, r * 0.26, 0, TAU); g.fill(); }
    boxes.push({ k, x: x0, w: STEP, y: y - r, h: 2 * r });
    // codon bracket and amino acid under the first base of each codon
    if (t.codon && t.pos === 0) {
      const yb = cy + h * 0.2;
      g.strokeStyle = t.aa === '*' ? '#ff8d7a' : t.aa === 'P' && (t.res === 986 || t.res === 987) ? '#fff' : 'rgba(255,255,255,0.35)';
      g.lineWidth = 1.5; g.beginPath(); g.moveTo(x0 + 2, yb - 6); g.lineTo(x0 + 2, yb); g.lineTo(x0 + 3 * STEP - 6, yb); g.lineTo(x0 + 3 * STEP - 6, yb - 6); g.stroke();
      g.fillStyle = t.aa === '*' ? '#ff8d7a' : PAL.ink; g.font = '600 13px Inter, sans-serif';
      g.fillText(t.aa === '*' ? 'stop' : t.aa, x0 + 1.5 * STEP - 2, yb + 13);
      g.fillStyle = PAL.dim; g.font = '11px Inter, sans-serif';
      if (t.aa !== '*') g.fillText(String(t.res), x0 + 1.5 * STEP - 2, yb + 27);
    }
  });
  return boxes;
}

// ---------------------------------------------------------------- LNP
// One lipid nanoparticle at (x, y), radius r; charge 0..1 is the share of
// ionizable heads that carry a proton; open 0..1 releases the mRNA.
function drawLNP(g, x, y, r, charge, open, t) {
  // mRNA inside: a coiled line
  if (open < 1) {
    g.save(); g.globalAlpha = 1 - open;
    g.strokeStyle = PAL.rna; g.lineWidth = Math.max(1.2, r * 0.07); g.beginPath();
    for (let k = 0; k <= 80; k++) {
      const a = k / 80 * TAU * 3 + t * 0.3, rr = r * (0.2 + 0.45 * Math.abs(Math.sin(k * 0.37)));
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a * 1.3) * rr * 0.9;
      k ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.stroke(); g.restore();
  }
  const n = Math.max(18, Math.round(r * 1.1));
  for (let k = 0; k < n; k++) {
    const a = k / n * TAU + t * 0.05;
    const kind = k % 9 === 0 ? 'peg' : k % 3 === 1 ? 'chol' : 'ion';
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    if (kind === 'peg') {
      g.strokeStyle = PAL.peg; g.lineWidth = 1.2; g.beginPath(); g.moveTo(px, py);
      for (let s = 1; s <= 5; s++) { const rr = r + s * r * 0.07; g.lineTo(x + Math.cos(a + Math.sin(s + t) * 0.05) * rr, y + Math.sin(a + Math.sin(s + t) * 0.05) * rr); }
      g.stroke();
    }
    const on = kind === 'ion' && hash(k * 7.3) < charge;
    g.fillStyle = kind === 'chol' ? PAL.chol : on ? PAL.plus : PAL.lipid;
    g.beginPath(); g.arc(px, py, Math.max(1.6, r * 0.09), 0, TAU); g.fill();
    if (on && r > 22) { g.fillStyle = PAL.bg; g.font = `700 ${Math.round(r * 0.11)}px Inter, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('+', px, py + 0.5); }
  }
}

// One free mRNA strand from (x, y), growing with k, with a few ribosomes.
function freeStrand(g, x, y, len, k, seed, t) {
  g.strokeStyle = PAL.rna; g.lineWidth = 2; g.beginPath();
  const pts = [];
  for (let s = 0; s <= 40 * k; s++) {
    const u = s / 40, a = seed * 2.1 + u * 3;
    const px = x + Math.cos(a) * len * u + Math.sin(u * 14 + t + seed) * 5, py = y + Math.sin(a) * len * u * 0.7 + Math.cos(u * 11 + t) * 5;
    pts.push([px, py]); s ? g.lineTo(px, py) : g.moveTo(px, py);
  }
  g.stroke();
  return pts;
}

// p: 0..1 through JOURNEY. t: seconds, for idle motion.
export function drawJourney(g, w, h, { p = 0, t = 0, pKa = 6.4 } = {}) {
  const J = journey(p), S = Math.min(w, h);
  // outside (top) and cytosol (below the membrane)
  g.fillStyle = '#071019'; g.fillRect(0, 0, w, h);
  const my = h * 0.34;
  g.fillStyle = PAL.cyto; g.fillRect(0, my, w, h - my);
  const r = S * 0.075, cx = w * 0.5;
  // LNP path
  let lx, ly, depth = 0, pinched = 0;
  const pB = JOURNEY[0].to, pU = JOURNEY[1].to;
  if (p <= pB) { const k = smooth(p / pB); lx = lerp(w * 0.18, cx, k); ly = lerp(h * 0.08, my - r * 1.1, k); }
  else if (p <= pU) { const k = smooth((p - pB) / (pU - pB)); lx = cx; ly = lerp(my - r * 1.1, my + r * 1.9, k); depth = clamp(k * 1.4, 0, 1); pinched = clamp((k - 0.7) / 0.3, 0, 1); }
  else { const k = smooth((p - pU) / (1 - pU)); lx = cx + Math.sin(k * 2) * w * 0.04; ly = lerp(my + r * 1.9, h * 0.62, k); depth = 1; pinched = 1; }
  // the membrane, with a dip that wraps the particle while it goes in
  g.strokeStyle = PAL.memb; g.lineWidth = Math.max(3, S * 0.012);
  g.beginPath();
  const dipW = r * 1.8, dipD = depth * (r * 3.0) * (1 - pinched);
  for (let x = 0; x <= w; x += 3) {
    const d = Math.abs(x - cx), bump = d < dipW * 1.6 ? Math.exp(-(d * d) / (dipW * dipW)) : 0;
    const y = my + Math.sin(x * 0.02 + t * 0.4) * 2 + bump * dipD;
    x ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.stroke();
  // receptor stubs on the membrane, for scale
  g.strokeStyle = 'rgba(201,167,255,0.5)'; g.lineWidth = 2;
  for (let x = 20; x < w; x += 46) { if (Math.abs(x - cx) < dipW * 1.6) continue; g.beginPath(); g.moveTo(x, my); g.lineTo(x, my - 7); g.stroke(); }
  // endosome
  const pH = J.pH, charge = protonated(pH, pKa);
  const escK = J.id === 'escape' ? J.k : J.id === 'free' ? 1 : 0;
  if (pinched > 0) {
    const er = r * 1.55;
    const acid = clamp((7.4 - pH) / 1.9, 0, 1);
    g.fillStyle = `rgba(${Math.round(lerp(26, 120, acid))},${Math.round(lerp(18, 30, acid))},${Math.round(lerp(34, 60, acid))},${0.85 * (1 - escK * 0.8)})`;
    g.beginPath(); g.arc(lx, ly, er, 0, TAU); g.fill();
    g.strokeStyle = PAL.memb; g.lineWidth = Math.max(2, S * 0.008);
    // the membrane breaks into arcs as it is disrupted
    const gaps = Math.round(escK * 6);
    if (!gaps) { g.beginPath(); g.arc(lx, ly, er, 0, TAU); g.stroke(); }
    else for (let k = 0; k < 6; k++) {
      const a0 = k / 6 * TAU, a1 = a0 + TAU / 6 * (k < gaps ? 0.45 : 1);
      g.beginPath(); g.arc(lx, ly, er + (k < gaps ? escK * 6 : 0), a0, a1); g.stroke();
    }
    // protons pumped in
    if (J.id === 'acid' || J.id === 'escape') {
      g.fillStyle = PAL.plus; g.font = `700 ${Math.round(S * 0.03)}px Inter, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (let k = 0; k < 10 * acid; k++) {
        const a = hash(k) * TAU + t * (0.3 + hash(k + 9) * 0.4), rr = er * (0.55 + 0.35 * hash(k + 3));
        g.fillText('+', lx + Math.cos(a) * rr, ly + Math.sin(a) * rr);
      }
    }
  }
  // mRNA strands leave, then meet ribosomes
  if (escK > 0) {
    for (let s = 0; s < 3; s++) {
      const pts = freeStrand(g, lx, ly, S * 0.32, escK, s + 1, t);
      if (J.id === 'free') {
        for (let q = 0; q < 2; q++) {
          const u = (J.k * 0.6 + q * 0.35 + t * 0.03) % 1, pt = pts[Math.min(pts.length - 1, Math.floor(u * pts.length))];
          if (!pt || J.k < 0.15) continue;
          g.fillStyle = PAL.ribo; g.globalAlpha = smooth((J.k - 0.15) / 0.3);
          g.beginPath(); g.ellipse(pt[0], pt[1] - 4, 8, 6, 0, 0, TAU); g.fill();
          g.beginPath(); g.ellipse(pt[0], pt[1] + 4, 6, 4.5, 0, 0, TAU); g.fill();
          g.globalAlpha = 1;
        }
      }
    }
  }
  drawLNP(g, lx, ly, r * (1 - escK * 0.25), charge, escK, t);
  return { x: lx, y: ly, r: r * 1.6, pH, charge, phase: J };
}

// ---------------------------------------------------------------- translate
// Ribosomes run along one mRNA; each finished chain floats up, folds and
// joins the spikes on the cell surface (top). t in seconds.
export function drawTranslate(g, w, h, { t = 0, n = 4, speed = 1 } = {}) {
  g.fillStyle = PAL.cyto; g.fillRect(0, 0, w, h);
  const my = h * 0.16, ry = h * 0.72, x0 = w * 0.06, L = w * 0.88, S = Math.min(w, h);
  // the cell surface at the top
  g.fillStyle = '#071019'; g.fillRect(0, 0, w, my);
  g.strokeStyle = PAL.memb; g.lineWidth = Math.max(3, S * 0.012);
  g.beginPath(); for (let x = 0; x <= w; x += 4) { const y = my + Math.sin(x * 0.03 + t * 0.3) * 2; x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
  // the mRNA
  const yAt = x => ry + Math.sin(x * 0.03 + t * 0.6) * S * 0.015;
  g.strokeStyle = PAL.rna; g.lineWidth = 3; g.beginPath();
  for (let x = x0; x <= x0 + L; x += 3) x === x0 ? g.moveTo(x, yAt(x)) : g.lineTo(x, yAt(x));
  g.stroke();
  g.fillStyle = PAL.cap; g.beginPath(); g.arc(x0, yAt(x0), 6, 0, TAU); g.fill();
  g.fillStyle = PAL.polyA; g.fillRect(x0 + L - L * 0.08, yAt(x0 + L) - 2, L * 0.08, 4);
  const v = L / 9 * speed, sp = L / n, Tf = 4.5, Tlife = 26;
  const ORF0 = x0 + L * 0.06, ORF1 = x0 + L * 0.9;
  // spikes on the surface: chains released earlier
  const spikes = [];
  for (let i = 0; i < n; i++) {
    const c = Math.floor((t * v + i * sp) / L);
    for (let m = c; m >= c - 6; m--) {
      const tr = (m * L - i * sp) / v + (ORF1 - x0) / v;   // when this ribosome passed the stop codon
      const age = t - tr;
      if (age < 0) continue;
      const slot = hash(i * 31 + m * 7), sx = w * (0.06 + 0.88 * slot);
      if (age < Tf) {
        // the chain floats up and folds
        const k = smooth(age / Tf), fx = lerp(ORF1, sx, k), fy = lerp(ry - 14, my + 18, k);
        g.strokeStyle = PAL.chain; g.lineWidth = 2; g.beginPath();
        for (let s = 0; s <= 24; s++) {
          const u = s / 24, rr = lerp(18, 6, k) * (1 - u * 0.3);
          const px = fx + Math.cos(u * 18 + m) * rr * u, py = fy + lerp(30, 8, k) * u + Math.sin(u * 18 + m) * rr * u * 0.5;
          s ? g.lineTo(px, py) : g.moveTo(px, py);
        }
        g.stroke();
      } else if (age < Tf + Tlife) spikes.push({ x: sx, a: clamp(Math.min(age - Tf, Tf + Tlife - age) / 1.5, 0, 1) });
    }
  }
  for (const s of spikes) spikeGlyph(g, s.x, my, S * 0.07, s.a);
  // ribosomes and their growing chains
  for (let i = 0; i < n; i++) {
    const x = x0 + ((t * v + i * sp) % L), y = yAt(x);
    const inOrf = x > ORF0 && x < ORF1, k = clamp((x - ORF0) / (ORF1 - ORF0), 0, 1);
    if (inOrf) {
      g.strokeStyle = PAL.chain; g.lineWidth = 2; g.beginPath();
      const len = k * S * 0.28;
      for (let s = 0; s <= 30; s++) {
        const u = s / 30, px = x + Math.sin(u * 16 + i + t * 0.5) * 6 * u, py = y - 18 - len * u;
        s ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.stroke();
    }
    const R = S * 0.035;
    g.fillStyle = PAL.ribo; g.globalAlpha = 0.95;
    g.beginPath(); g.ellipse(x, y - R * 0.55, R * 1.25, R * 0.9, 0, 0, TAU); g.fill();
    g.fillStyle = '#9aa3b5';
    g.beginPath(); g.ellipse(x, y + R * 0.55, R * 0.95, R * 0.65, 0, 0, TAU); g.fill();
    g.globalAlpha = 1;
  }
  return { x: w / 2, y: (my + ry) / 2, r: S * 0.35, spikes: spikes.length };
}

// A small prefusion spike trimer standing on a membrane at (x, y).
function spikeGlyph(g, x, y, s, a) {
  // the spike points out of the cell: up, away from the cytosol below
  g.save(); g.globalAlpha = a; g.lineCap = 'round';
  g.strokeStyle = PAL.s2; g.lineWidth = s * 0.12; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - s * 0.45); g.stroke();
  g.fillStyle = PAL.s1;
  for (const dx of [-0.22, 0, 0.22]) { g.beginPath(); g.ellipse(x + dx * s, y - s * 0.62, s * 0.17, s * 0.24, 0, 0, TAU); g.fill(); }
  g.fillStyle = PAL.rbd; g.beginPath(); g.arc(x + s * 0.24, y - s * 0.88, s * 0.1, 0, TAU); g.fill();
  g.restore();
}

// ---------------------------------------------------------------- spike
// One spike protomer set, prefusion (m = 0) to postfusion (m = 1). p2 draws
// the two prolines at the HR1 / central-helix hinge. shake: 0..1 jitter of
// a spike that is pushed but held by 2P.
export function drawSpike(g, w, h, { m = 0, p2 = true, shake = 0, t = 0, labels = true } = {}) {
  g.fillStyle = '#071019'; g.fillRect(0, 0, w, h);
  const S = Math.min(w, h * 0.9), base = h * 0.86, cx = w / 2;
  g.fillStyle = PAL.cyto; g.fillRect(0, base, w, h - base);
  g.strokeStyle = PAL.memb; g.lineWidth = Math.max(4, S * 0.016);
  g.beginPath(); g.moveTo(0, base); g.lineTo(w, base); g.stroke();
  const u = S * 0.0072, j = shake * Math.sin(t * 40) * u * 1.6;
  const mk = smooth(m);
  g.lineCap = 'round'; g.lineJoin = 'round';
  const P = (x, y) => [cx + x * u + j, base - y * u];
  const seg = (pts, col, lw) => { g.strokeStyle = col; g.lineWidth = lw * u; g.beginPath(); pts.forEach((q, k) => { const [X, Y] = P(q[0], q[1]); k ? g.lineTo(X, Y) : g.moveTo(X, Y); }); g.stroke(); };
  const L = (a, b) => [lerp(a[0], b[0], mk), lerp(a[1], b[1], mk)];
  // three protomers, side by side
  const hinges = [];
  for (const off of [-7, 0, 7]) {
    const o = off * (1 - 0.6 * mk);
    // stalk and TM (HR2), same in both shapes
    seg([[o * 0.6, 0], [o * 0.6, 8], L([o, 22], [o * 0.4, 18])], PAL.s2, 3.2);
    // central helix: prefusion 22..44; postfusion 18..70
    const ch0 = L([o, 22], [o * 0.4, 18]), ch1 = L([o, 44], [o * 0.4, 70]);
    seg([ch0, ch1], PAL.ch, 3.6);
    // HR1: prefusion folded down beside the helix in short segments; postfusion one straight helix above
    const hinge = ch1;
    const pre = [hinge, [o + 6, 40], [o + 2, 36], [o + 7, 32], [o + 3, 28]];
    const post = [hinge, [o * 0.3, 80], [o * 0.25, 90], [o * 0.2, 100], [o * 0.15, 108]];
    seg(pre.map((q, k) => L(q, post[k])), PAL.hr1, 3.0);
    // fusion peptide at the tip of HR1
    const fp = L(pre[4], post[4]); const [fx, fy] = P(fp[0], fp[1]);
    g.fillStyle = '#ff6b6b'; g.beginPath(); g.arc(fx, fy, 1.6 * u, 0, TAU); g.fill();
    hinges.push(hinge);
  }
  // S1 head on top of the prefusion spike; it lifts off and fades in postfusion
  g.globalAlpha = 1 - mk;
  const lift = mk * 40;
  for (const [dx, col, ry] of [[-9, PAL.s1, 0], [0, PAL.s1, 0], [9, PAL.s1, 0]]) {
    const [X, Y] = P(dx, 61 + lift + ry); g.fillStyle = col; g.beginPath(); g.ellipse(X, Y, 6.5 * u, 11 * u, 0, 0, TAU); g.fill();
  }
  const [rx, ryy] = P(11, 75 + lift); g.fillStyle = PAL.rbd; g.beginPath(); g.arc(rx, ryy, 4.2 * u, 0, TAU); g.fill();
  g.globalAlpha = 1;
  // the two prolines at each hinge, over everything
  for (const hinge of hinges) {
    if (p2) {
      const [hx, hy] = P(hinge[0], hinge[1]);
      for (const d of [-1, 1]) {
        g.strokeStyle = PAL.pro; g.lineWidth = 1.1 * u; g.beginPath();
        for (let k = 0; k <= 5; k++) { const a = k / 5 * TAU; const X = hx + d * 1.7 * u + Math.cos(a) * 1.25 * u, Y = hy - 1.2 * u + Math.sin(a) * 1.25 * u; k ? g.lineTo(X, Y) : g.moveTo(X, Y); }
        g.stroke();
      }
    }
  }
  if (labels) {
    g.font = `${Math.max(12, Math.round(u * 3.4))}px Inter, sans-serif`; g.textBaseline = 'middle';
    const lab = (txt, x, y, col, al = 'left') => { const [X, Y] = P(x, y); g.fillStyle = col; g.textAlign = al; g.fillText(txt, X, Y); };
    if (mk < 0.5) { lab('S1 head', 18, 60, PAL.s1); lab('RBD up', 17, 78, PAL.rbd); lab('HR1, folded', 16, 34, PAL.hr1); if (p2) lab('K986P · V987P', -16, 44, '#fff', 'right'); }
    else { lab('HR1 + central helix: one long helix', 6, 96, PAL.hr1); lab('fusion peptide', 6, 108, '#ff6b6b'); }
    lab('stalk · HR2 · membrane anchor', 9, 6, PAL.s2);
  }
  const [ax, ay] = P(0, mk < 0.5 ? 45 : 60);
  return { x: ax, y: ay, r: S * 0.42 };
}

// ---------------------------------------------------------------- charts
function axes(g, w, h, pad) {
  g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(pad.l, pad.t); g.lineTo(pad.l, h - pad.b); g.lineTo(w - pad.r, h - pad.b); g.stroke();
}
// Illustrative antibody titre on a log axis. gap: days between doses.
export function drawTitre(g, w, h, { gap = 21, days = 150, cursor = -1, second = true } = {}) {
  g.clearRect(0, 0, w, h);
  const pad = { l: 44, r: 12, t: 14, b: 32 }, W = w - pad.l - pad.r, H = h - pad.t - pad.b;
  const doses = second ? [0, gap] : [0];
  const lo = -2, hi = 1.3;   // log10 of the arbitrary units
  const X = d => pad.l + d / days * W, Y = v => pad.t + H * (1 - (Math.log10(Math.max(v, 1e-3)) - lo) / (hi - lo));
  g.strokeStyle = 'rgba(255,255,255,0.07)';
  for (let e = -2; e <= 1; e++) { g.beginPath(); g.moveTo(pad.l, Y(10 ** e)); g.lineTo(w - pad.r, Y(10 ** e)); g.stroke(); }
  axes(g, w, h, pad);
  g.fillStyle = PAL.dim; g.font = '12px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'top';
  for (let d = 0; d <= days; d += 30) g.fillText(String(d), X(d), h - pad.b + 6);
  g.fillText('days after dose 1', pad.l + W / 2, h - 14);
  g.save(); g.translate(12, pad.t + H / 2); g.rotate(-Math.PI / 2); g.textBaseline = 'middle'; g.fillText('antibody level (log, arbitrary)', 0, 0); g.restore();
  // dose markers
  doses.forEach((d, i) => {
    g.strokeStyle = 'rgba(255,214,102,0.6)'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(X(d), pad.t); g.lineTo(X(d), h - pad.b); g.stroke(); g.setLineDash([]);
    g.fillStyle = PAL.C; g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText(`dose ${i + 1}`, X(d) + 4, pad.t);
  });
  // curves: antibodies (solid) and an illustrative T-cell line (dashed)
  const curve = (f, col, dash) => {
    g.strokeStyle = col; g.lineWidth = 2.2; g.setLineDash(dash); g.beginPath();
    let first = true;
    for (let d = 0; d <= days; d += 0.5) { const v = f(d); if (v <= 0.01) { first = true; continue; } first ? g.moveTo(X(d), Y(v)) : g.lineTo(X(d), Y(v)); first = false; }
    g.stroke(); g.setLineDash([]);
  };
  curve(d => titre(d, doses), PAL.U, []);
  curve(d => 0.6 * titre(d - 2, doses, { half: 180, boost: 4 }), PAL.G, [6, 5]);
  if (cursor >= 0) {
    const v = titre(cursor, doses);
    g.strokeStyle = 'rgba(255,255,255,0.4)'; g.beginPath(); g.moveTo(X(cursor), pad.t); g.lineTo(X(cursor), h - pad.b); g.stroke();
    if (v > 0.01) { g.fillStyle = '#fff'; g.beginPath(); g.arc(X(cursor), Y(v), 4, 0, TAU); g.fill(); }
  }
}

// First-order decay: fraction left against hours, for one half-life.
export function drawDecay(g, w, h, { half = 10, hours = 72 } = {}) {
  g.clearRect(0, 0, w, h);
  const pad = { l: 40, r: 12, t: 12, b: 30 }, W = w - pad.l - pad.r, H = h - pad.t - pad.b;
  const X = t => pad.l + t / hours * W, Y = f => pad.t + H * (1 - f);
  axes(g, w, h, pad);
  g.fillStyle = PAL.dim; g.font = '12px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'top';
  for (let t = 0; t <= hours; t += 12) g.fillText(String(t), X(t), h - pad.b + 6);
  g.fillText('hours', pad.l + W / 2, h - 13);
  g.textAlign = 'right'; g.textBaseline = 'middle';
  for (const f of [0, 0.5, 1]) g.fillText(f.toFixed(1), pad.l - 6, Y(f));
  g.strokeStyle = 'rgba(255,255,255,0.12)'; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(pad.l, Y(0.5)); g.lineTo(X(half), Y(0.5)); g.lineTo(X(half), Y(0)); g.stroke(); g.setLineDash([]);
  g.strokeStyle = PAL.U; g.lineWidth = 2.4; g.beginPath();
  for (let t = 0; t <= hours; t += 0.5) t ? g.lineTo(X(t), Y(remaining(t, half))) : g.moveTo(X(t), Y(1));
  g.stroke();
}

// The share of ionizable heads that carry a proton against pH.
export function drawCharge(g, w, h, { pKa = 6.4, pH = 7.4 } = {}) {
  g.clearRect(0, 0, w, h);
  const pad = { l: 40, r: 12, t: 12, b: 30 }, W = w - pad.l - pad.r, H = h - pad.t - pad.b;
  const lo = 4, hi = 8.5, X = p => pad.l + (p - lo) / (hi - lo) * W, Y = f => pad.t + H * (1 - f);
  // bands: endosome and blood
  g.fillStyle = 'rgba(255,154,98,0.10)'; g.fillRect(X(5), pad.t, X(6.5) - X(5), H);
  g.fillStyle = 'rgba(98,196,255,0.10)'; g.fillRect(X(7.3), pad.t, X(7.5) - X(7.3), H);
  axes(g, w, h, pad);
  g.fillStyle = PAL.dim; g.font = '12px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'top';
  for (let p = 4; p <= 8; p++) g.fillText(String(p), X(p), h - pad.b + 6);
  g.fillText('pH', pad.l + W / 2, h - 13);
  g.fillStyle = '#ffb48a'; g.fillText('endosome', X(5.75), pad.t + 2);
  g.fillStyle = '#9bd8ff'; g.fillText('blood', X(7.4), pad.t + 16);
  g.fillStyle = PAL.dim; g.textAlign = 'right'; g.textBaseline = 'middle';
  for (const f of [0, 0.5, 1]) g.fillText(f.toFixed(1), pad.l - 6, Y(f));
  g.strokeStyle = PAL.A; g.lineWidth = 2.4; g.beginPath();
  for (let p = lo; p <= hi + 1e-9; p += 0.02) p === lo ? g.moveTo(X(p), Y(protonated(p, pKa))) : g.lineTo(X(p), Y(protonated(p, pKa)));
  g.stroke();
  const f = protonated(pH, pKa);
  g.fillStyle = '#fff'; g.beginPath(); g.arc(X(pH), Y(f), 5, 0, TAU); g.fill();
}
