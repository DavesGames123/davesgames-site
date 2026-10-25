// ============================================================================
//  ALPHA QUDITS  ·  ends/scenes/locks.js  ·  analogy 3: locks and keys
// ----------------------------------------------------------------------------
//  A type (d1, d2) is a lock. A positive map between its two ends (a
//  consistent relation) is a key that fits it. Reads can cut only the
//  decomposable keys, Phi1 + Phi2 o T with Phi1, Phi2 completely positive.
//  A type is readable when every key that fits it is one reads can cut.
//
//  step 'grid'     the 4 x 4 grid d1, d2 = 2..5. Steel keys open every lock.
//                  At (2, 4) (Woronowicz 1976) and (3, 3) (Choi 1975) a red
//                  key fits too, a non-decomposable map; every cell with
//                  d1 d2 >= 8 inherits one. The strip under the grid shows
//                  the products: 7 is no product of two integers >= 2.
//                  Tap a cell to read its reason.
//  step 'witness'  the live test that Choi's key is not decomposable: on
//                  the Horodecki state sigma_a (PRL 82, 1056, 1999) the
//                  partial transpose stays positive for a <= 4, so every
//                  decomposable key keeps it positive, but (1 (x) Phi_Choi)
//                  turns it negative for a > 3. Both curves are computed.
//  step 'select'   the two readable types left, and Q = i (d2 - d1): only
//                  (2, 3) has unequal ends and an acting central charge.
//
//  GREP MAP   (grep -n "<anchor>" locks.js)
//    function gridLayout .. cell size and origin
//    function witnessData . the two eigenvalue curves (computed once)
//    function drawGrid / drawWitness / drawSelect
// ============================================================================
import { C, font, label, clamp, rgba, ease, lockFace, keyShape, rrect, arrow } from '../draw.js';
import { readCapLocal, centralChargeLocal, horodeckiState, partialT, applySecond, choiMap, hermEig, choiMatrix, randomKet, projector, mulberry } from '../linalg.js';
import { modelSync } from '../model-link.js';

const STEPS = [{ id: 'grid', label: 'The grid' }, { id: 'witness', label: "Choi's key" }, { id: 'select', label: 'What is left' }];
const PERIOD = 12;
const DS = [2, 3, 4, 5];

function cap(d1, d2) {
  const M = modelSync();
  const loc = readCapLocal(d1, d2);
  if (M && typeof M.readCap === 'function') {
    try { const r = M.readCap(d1, d2); const open = typeof r === 'boolean' ? r : r && (r.readable ?? r.open); if (typeof open === 'boolean') loc.open = open; } catch (e) { /* keep local */ }
  }
  return loc;
}
function gridLayout(v, compact) {
  const cs = clamp(Math.min((v.w - 44) / 4, (v.h - (compact ? 120 : 130)) / 4.25), 52, 112);
  const gw = cs * 4, x0 = v.x + 30 + (v.w - 30 - gw) / 2, y0 = v.y + 34;
  return { cs, x0, y0, gw };
}

let WD = null;
export function witnessData() {
  if (WD) return WD;
  const xs = [], pt = [], ch = [];
  for (let k = 0; k <= 60; k++) {
    const a = 2 + 3 * k / 60, S = horodeckiState(a);
    xs.push(a); pt.push(Math.min(...hermEig(partialT(S, 3, 3)))); ch.push(Math.min(...hermEig(applySecond(S, 3, 3, choiMap))));
  }
  const rnd = mulberry(1975); let posMin = Infinity;
  for (let k = 0; k < 600; k++) posMin = Math.min(posMin, ...hermEig(choiMap(projector(randomKet(3, rnd)))));
  const cpMin = Math.min(...hermEig(choiMatrix(choiMap, 3)));
  WD = { xs, pt, ch, posMin, cpMin };
  return WD;
}

function cellState(d1, d2, t, order) {
  // the key wave: cells in order of product, 0.45 s apart
  const k = order.findIndex(([a, b]) => a === d1 && b === d2), t0 = 0.6 + k * 0.42;
  return { steel: ease((t - t0) / 0.8), red: ease((t - t0 - 1.2) / 0.8), k };
}

function drawGrid(g, v, st, t) {
  const L = gridLayout(v), order = [];
  for (const a of DS) for (const b of DS) order.push([a, b]);
  order.sort((p, q) => p[0] * p[1] - q[0] * q[1] || p[0] - q[0]);
  label(g, 'd₂', L.x0 + L.gw / 2, v.y + 12, { font: font(13, 500, true, true), color: C.dim });
  label(g, 'd₁', v.x + 12, L.y0 + L.gw / 2, { font: font(13, 500, true, true), color: C.dim });
  DS.forEach((d, i) => {
    label(g, String(d), L.x0 + (i + 0.5) * L.cs, L.y0 - 10, { font: font(13, 600), color: C.text });
    label(g, String(d), L.x0 - 12, L.y0 + (i + 0.5) * L.cs, { font: font(13, 600), color: C.text });
  });
  DS.forEach((d1, i) => DS.forEach((d2, j) => {
    const x = L.x0 + j * L.cs, y = L.y0 + i * L.cs, c = cap(d1, d2), s = cellState(d1, d2, t, order);
    const sel = st.sel && st.sel[0] === d1 && st.sel[1] === d2;
    rrect(g, x + 3, y + 3, L.cs - 6, L.cs - 6, 9);
    const dark = !c.open && s.red > 0.5;
    g.fillStyle = c.open ? rgba(C.ok, 0.05 + 0.1 * s.steel) : rgba(C.dark, 0.04 + 0.12 * s.red); g.fill();
    g.lineWidth = sel ? 2 : 1; g.strokeStyle = sel ? C.accent : c.open ? rgba(C.ok, 0.2 + 0.5 * s.steel) : rgba(C.dark, 0.15 + 0.5 * s.red); g.stroke();
    const r = L.cs * 0.25, lx = x + L.cs / 2, ly = y + L.cs * 0.42;
    const turn = c.open ? s.steel * Math.PI / 2 : (s.steel - s.red * 0.0) * Math.PI / 2 * (1 - s.red) + s.red * Math.PI / 2;
    lockFace(g, lx, ly, r, turn, { glow: c.open ? s.steel : s.red, glowColor: c.open ? C.ok : C.dark, dim: false });
    // the key: steel, then (dark cells) the red key that no read cuts
    const kL = L.cs * 0.36, kh = Math.max(5, L.cs * 0.075);
    if (s.steel > 0 && s.steel < 1) keyShape(g, lx - r - kL * (1 - s.steel) - kL * 0.2, ly + r + kh, kL, kh, [0.3, 0.8, 0.5, 0.2], { color: C.steel, alpha: 1 - s.steel * 0.6 });
    if (!c.open && s.red > 0) keyShape(g, x + L.cs * 0.14, y + L.cs * 0.8, kL, kh, [0.9, 0.1, 0.7, 0.4], { color: C.dark, alpha: s.red });
    if (c.open && s.steel >= 1) label(g, 'opens', x + L.cs * 0.62, y + L.cs * 0.8, { font: font(11, 500), color: C.ok });
    label(g, String(d1 * d2), x + L.cs - 12, y + 13, { font: font(11, 600), color: dark ? C.dark : c.open ? C.ok : C.dim });
    if (c.origin && s.red > 0.4) label(g, '★', x + 12, y + 13, { font: font(12, 700), color: C.accent, alpha: s.red });
  }));
  // the strip of products
  const ys = L.y0 + 4 * L.cs + 26, nums = [4, 5, 6, 7, 8, 9, 10], sw = Math.min(40, (v.w - 40) / nums.length), sx = v.x + (v.w - sw * nums.length) / 2;
  const present = new Set(); for (const a of DS) for (const b of DS) present.add(a * b);
  nums.forEach((n, i) => {
    const x = sx + i * sw, on = present.has(n), open = n <= 6;
    rrect(g, x + 3, ys - 13, sw - 6, 26, 6);
    g.fillStyle = on ? rgba(open ? C.ok : C.dark, 0.22) : 'rgba(255,255,255,0.03)'; g.fill();
    g.strokeStyle = on ? rgba(open ? C.ok : C.dark, 0.6) : 'rgba(255,255,255,0.12)'; g.lineWidth = 1; g.stroke();
    label(g, String(n), x + sw / 2, ys, { font: font(13, 600), color: on ? C.text : C.faint });
  });
  const capX = sx + 3 * sw - 0;
  g.save(); g.strokeStyle = C.accent; g.lineWidth = 2; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(capX, ys - 20); g.lineTo(capX, ys + 20); g.stroke(); g.restore();
  label(g, 'cap d₁d₂ ≤ 6', capX - 4, ys + 32, { font: font(12, 600), color: C.accent, align: 'right' });
  label(g, '7: no product of two integers ≥ 2', capX + 2, ys + 32, { font: font(12), color: C.dim, align: 'left' });
}

function drawWitness(g, v, st, t) {
  const D = witnessData(), wide = v.w >= 560;
  const pl = { x: v.x + 52, y: v.y + 36, w: v.w - 72, h: Math.min(v.h * (wide ? 0.6 : 0.5), 300) };
  const ymin = -0.09, ymax = 0.05, X = a => pl.x + (a - 2) / 3 * pl.w, Y = e => pl.y + (ymax - e) / (ymax - ymin) * pl.h;
  // regions
  const regs = [[2, 3, 'separable', C.ok], [3, 4, 'PPT, entangled', C.accent], [4, 5, 'not PPT', C.dark]];
  for (const [a, b, nm, col] of regs) {
    g.fillStyle = rgba(col, 0.06); g.fillRect(X(a), pl.y, X(b) - X(a), pl.h);
    label(g, nm, (X(a) + X(b)) / 2, pl.y + 12, { font: font(11.5, 500), color: col });
  }
  g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(pl.x, Y(0)); g.lineTo(pl.x + pl.w, Y(0)); g.stroke();
  g.beginPath(); g.moveTo(pl.x, pl.y); g.lineTo(pl.x, pl.y + pl.h); g.stroke();
  label(g, '0', pl.x - 8, Y(0), { font: font(11), color: C.dim, align: 'right' });
  for (const a of [2, 3, 4, 5]) label(g, String(a), X(a), pl.y + pl.h + 12, { font: font(11), color: C.dim });
  label(g, 'α', pl.x + pl.w, pl.y + pl.h + 28, { font: font(13, 500, true, true), color: C.dim, align: 'right' });
  label(g, 'smallest eigenvalue', pl.x - 4, pl.y - 18, { font: font(11.5), color: C.dim, align: 'left' });
  const curve = (ys, col, w) => { g.save(); g.strokeStyle = col; g.lineWidth = w; g.beginPath(); D.xs.forEach((a, i) => { const p = [X(a), Y(clamp(ys[i], ymin, ymax))]; i ? g.lineTo(...p) : g.moveTo(...p); }); g.stroke(); g.restore(); };
  curve(D.pt, C.qubit, 2.5); curve(D.ch, C.dark, 2.5);
  // the moving cursor
  const a = 2 + 3 * ((Math.max(0, t) % 8) / 8), i = Math.round((a - 2) / 3 * 60), xa = X(D.xs[i]);
  g.strokeStyle = 'rgba(255,255,255,0.4)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(xa, pl.y); g.lineTo(xa, pl.y + pl.h); g.stroke(); g.setLineDash([]);
  for (const [ys, col] of [[D.pt, C.qubit], [D.ch, C.dark]]) { g.beginPath(); g.arc(xa, Y(clamp(ys[i], ymin, ymax)), 4.5, 0, Math.PI * 2); g.fillStyle = col; g.fill(); }
  const ly = pl.y + pl.h + 46, lx = v.x + 16;
  const rows = [
    [`partial transpose of σα (every decomposable key acts like this): ${D.pt[i].toFixed(4)}`, C.qubit],
    [`Choi's key, (1 ⊗ Φ)(σα): ${D.ch[i].toFixed(4)}   at α = ${D.xs[i].toFixed(2)}`, C.dark],
    [`Φ is positive: smallest eigenvalue on 600 random states ${D.posMin.toFixed(4)} ≥ 0`, C.dim],
    [`Φ is not completely positive: its Choi matrix has eigenvalue ${D.cpMin.toFixed(2)}`, C.dim],
  ];
  const rowsFit = rows.map(r => r[0]);
  rows.forEach(([s, col], k) => {
    g.save(); g.font = font(12, k < 2 ? 500 : 400);
    const lines = wrapLines(g, s, v.w - 32);
    g.restore();
    lines.forEach((ln, j) => label(g, ln, lx, ly + (k * 2 + j) * 17 - (lines.length < 2 ? 0 : 0), { font: font(12, k < 2 ? 500 : 400), color: col, align: 'left' }));
  });
  void rowsFit;
  const inPPT = D.xs[i] > 3 && D.xs[i] <= 4;
  if (inPPT) label(g, 'caught: a key no read cuts', xa, Y(D.ch[i]) + 18, { font: font(12, 600), color: C.dark });
}
function wrapLines(g, s, w) {
  const out = []; let line = '';
  for (const word of s.split(' ')) { const tt = line ? line + ' ' + word : word; if (g.measureText(tt).width > w && line) { out.push(line); line = word; } else line = tt; }
  if (line) out.push(line); return out.slice(0, 2);
}

function drawSelect(g, v, st, t) {
  const cells = [[2, 2], [2, 3]], wide = v.w >= 520, cs = clamp(Math.min(wide ? v.w * 0.28 : v.w * 0.42, v.h * 0.42), 110, 200);
  const gap = wide ? cs * 0.35 : 16, tot = wide ? 2 * cs + gap : cs, x0 = v.x + (v.w - tot) / 2;
  label(g, 'the readable types: d₁d₂ ≤ 6, ends of dimension ≥ 2', v.x + v.w / 2, v.y + 14, { font: font(12), color: C.dim });
  cells.forEach(([d1, d2], k) => {
    const x = wide ? x0 + k * (cs + gap) : x0, y = wide ? v.y + 40 : v.y + 40 + k * (cs + 22);
    const q = centralChargeLocal(d1, d2), act = q !== 0, glow = act ? 0.5 + 0.5 * Math.sin(t * 2.4) : 0;
    rrect(g, x, y, cs, cs, 14); g.fillStyle = act ? rgba(C.charge, 0.07 + 0.05 * glow) : 'rgba(255,255,255,0.03)'; g.fill();
    g.strokeStyle = act ? rgba(C.charge, 0.5 + 0.4 * glow) : 'rgba(255,255,255,0.15)'; g.lineWidth = act ? 2 : 1; g.stroke();
    lockFace(g, x + cs * 0.3, y + cs * 0.34, cs * 0.17, Math.PI / 2, { glow: 1, glowColor: C.ok });
    label(g, `(${d1}, ${d2})`, x + cs * 0.72, y + cs * 0.27, { font: font(cs * 0.13, 600, true), color: C.text });
    label(g, d1 === d2 ? 'equal ends' : 'unequal ends', x + cs * 0.72, y + cs * 0.43, { font: font(12), color: C.dim });
    label(g, 'Q acts as i(d₂ − d₁) =', x + cs / 2, y + cs * 0.68, { font: font(12.5), color: C.text });
    label(g, q === 0 ? '0' : q === 1 ? 'i' : q + 'i', x + cs / 2, y + cs * 0.85, { font: font(cs * 0.15, 700, true, true), color: act ? C.charge : C.faint });
  });
  label(g, 'only (2, 3) carries an acting central charge', v.x + v.w / 2, v.y + v.h - 12, { font: font(13, 600), color: C.charge });
}

export default {
  id: 'locks',
  title: 'Locks and keys: the read cap',
  steps: STEPS,
  autoKey: 'step',
  analogy: {
    right: 'Each type is a lock and each consistent relation between its ends is a key that fits it. Reads can cut only one family of keys. A lock is readable when every key that fits it is in that family, and the theorems of Størmer, Woronowicz and Choi say exactly which locks those are: products up to 6.',
    breaks: 'A real lock opens for one key. Here every link of every type stays maximally entangled and distillable; what a dark type has is a relation between its ends that no read can carry, not a stuck state. The paper also takes "fix" to mean certainty about every such relation, which is its own definition, not a theorem.',
  },
  height: W => Math.round(W < 560 ? clamp(W * 1.4, 480, 620) : clamp(W * 0.72, 440, 560)),
  init(p) { return { step: p.step || 'grid', sel: p.sel || null }; },
  controls() { return [{ key: 'step', label: 'Step', options: STEPS.map(s => ({ v: s.id, label: s.label })) }]; },
  caption(st) {
    if (st.step === 'grid') {
      if (st.sel) {
        const [a, b] = st.sel, c = cap(a, b);
        if (c.open) return `(${a}, ${b}): d₁d₂ = ${a * b} ≤ 6. Every positive map between the ends is decomposable (${c.src}), so reads carry every relation: readable.`;
        if (c.origin) return `(${a}, ${b}): a positive map that is not decomposable exists here (${c.src}). It is a key no read cuts: dark.`;
        return `(${a}, ${b}): d₁d₂ = ${a * b} ≥ 8. The key of ${c.src} carries over by compressing to a subspace and embedding: dark.`;
      }
      return 'Steel keys are maps that reads compose. They open every lock. Red keys are positive maps that no read composes; they first fit at (2, 4) and (3, 3) and then every lock with d₁d₂ ≥ 8. Tap a lock.';
    }
    if (st.step === 'witness') return "Every decomposable key keeps a state with positive partial transpose positive. For 3 < α ≤ 4 the Horodecki state has positive partial transpose, yet Choi's key turns it negative: Choi's key is not decomposable. Both curves are computed here.";
    return 'Two readable types remain. The charge Q acts on the pair as i(d₂ − d₁): zero at (2, 2) and i at (2, 3). So exactly one readable link has an acting central charge.';
  },
  pointer(st, kind, p, env) {
    if (kind !== 'tap' || st.step !== 'grid') return false;
    const L = gridLayout(env.view), j = Math.floor((p.x - L.x0) / L.cs), i = Math.floor((p.y - L.y0) / L.cs);
    if (i < 0 || j < 0 || i > 3 || j > 3) { st.sel = null; return true; }
    st.sel = [DS[i], DS[j]];
    return true;
  },
  draw(g, env, st, t) {
    const tt = t - st.since;
    if (st.auto) st.step = STEPS[Math.floor(Math.max(0, tt) / PERIOD) % STEPS.length].id;
    const local = st.auto ? Math.max(0, tt) % PERIOD : Math.max(0, tt);
    if (st.step === 'grid') drawGrid(g, env.view, st, local);
    else if (st.step === 'witness') drawWitness(g, env.view, st, local);
    else drawSelect(g, env.view, st, local);
  },
};
void arrow;
