// ============================================================================
//  ALPHA QUDITS  ·  ends/scenes/gears.js  ·  analogy 2a: mirror gears
// ----------------------------------------------------------------------------
//  The transpose identity (A (x) 1)|w> = (1 (x) A^T)|w> as two meshing
//  involute gears. Each gear carries the basis directions of its end as
//  coloured spokes, drawn the same way round at both ends.
//
//  step 'mesh'   a real turn R(a) at end A. The mesh turns B the mirror way,
//                R(-a) = R(a)^T. The two tiles are the coefficient matrices
//                of (R (x) 1)|w> and (1 (x) R^T)|w>, computed each frame;
//                the figure prints their largest difference.
//  step 'match'  a matching U (x) conj(U): both ends pushed the same way.
//                Meshed gears jam, and the pair does not move: U C U^T = C.
//                Dashed spokes show the turned bases; strands keep tying
//                e_i to conj(e_i), the same form in every basis.
//  d = 2 or 3. At d = 3 the turn is in the plane of directions 0 and 1;
//  direction 2 is the axle, which the turn does not move.
//
//  GREP MAP   (grep -n "<anchor>" gears.js)
//    function layout ..... gear sizes and the tile row in the view
//    function turnAngle .. the animated (or dragged) angle a
//    draw( ............... the frame
// ============================================================================
import { C, font, label, setBounds, drawGear, arcArrow, tile, ease, clamp, rgba, short } from '../draw.js';
import { rot2, coeffMatrix, actPair, conj, maxAbsDiff } from '../linalg.js';

const STEPS = [{ id: 'mesh', label: 'Turn one end' }, { id: 'match', label: 'Matching' }];
const PERIOD = 7.5;    // s per step in the tour
const N = 20;          // teeth

function layout(v, d) {
  const R = Math.max(34, Math.min(v.w * 0.2, v.h * 0.25, 118));
  const cx = v.x + v.w / 2, cy = v.y + 30 + R * 1.42 + 8;
  const s = clamp(Math.min(v.w * 0.07, (v.y + v.h - (cy + R * 1.2 + 44) - 24) / d), 16, 34);
  const ty = cy + R * 1.2 + 40;
  return { R, cy, ax: cx - R, bx: cx + R, s, ty, cx };
}
function turnAngle(st, t) {
  if (st.manual != null) return st.manual;
  return 0.95 * Math.sin(2 * Math.PI * t / 6);
}
const sciDiff = x => x < 1e-15 ? '0' : x.toExponential(0).replace('e', '×10^').replace('^-', '⁻').replace(/\^(\d+)/, (m, k) => k.split('').map(c => '⁰¹²³⁴⁵⁶⁷⁸⁹'[c]).join(''));

function matrixTiles(g, x, y, s, M, title, color) {
  const d = M.n;
  label(g, title, x + d * s / 2, y - 14, { font: font(13, 500, true, true), color });
  for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) {
    const re = M.re[i * d + j], im = M.im[i * d + j];
    tile(g, x + j * s, y + i * s, s, re, im, 1 / Math.sqrt(d) * 1.0001, { text: short(re, 2) });
  }
}

export default {
  id: 'gears',
  title: 'Mirror gears',
  steps: STEPS,
  autoKey: 'step',
  analogy: {
    right: 'An operator at one end of a pair acts as its transpose at the other, and for a real turn the transpose is the turn run backwards, as a meshed gear turns its partner the mirror way. A matching pushes both ends the same way and changes nothing, like two meshed gears pushed the same way: they jam.',
    breaks: 'Gears pass a turn through time and contact. The pair has no time, nothing travels, and the identity is one equation, true at once. The mirror is only for real turns: under the transpose a phase comes through unchanged, and a matching runs phases opposite at the two ends. Gears have no place for a phase.',
  },
  height: W => Math.round(clamp(W * 1.06, 380, 540)),
  init(p) { return { step: p.step || 'mesh', d: p.d === 3 ? 3 : 2, manual: null }; },
  controls(st) {
    return [
      { key: 'step', label: 'Step', options: STEPS.map(s => ({ v: s.id, label: s.label })) },
      { key: 'd', label: 'Dimension', options: [{ v: 2, label: 'd = 2' }, { v: 3, label: 'd = 3' }] },
    ];
  },
  onSet(st, key) { if (key === 'step') st.manual = null; },
  caption(st, t) {
    if (st.step === 'mesh') {
      const a = turnAngle(st, t), deg = Math.round(a * 180 / Math.PI);
      return `A turn of ${deg}° at end A gives the same pair as a turn of ${-deg}° at end B, the transpose. The two coefficient grids are computed separately and agree.`;
    }
    return 'A matching turns end A by U and end B by its conjugate. The two pushes cancel through the mesh: the pair state stays the same, whatever basis it is written in.';
  },
  pointer(st, kind, p, env) {
    if (kind === 'move') { st.manual = clamp((st.manual ?? 0) - p.dx * 0.012, -Math.PI, Math.PI); return true; }
    return false;
  },
  draw(g, env, st, t) {
    setBounds(env.view);
    if (st.auto) {
      const k = Math.floor((t - st.since) / PERIOD) % STEPS.length;
      st.step = STEPS[(k + STEPS.length) % STEPS.length].id;
    }
    const v = env.view, d = st.d, L = layout(v, d), a = turnAngle(st, t);
    const sp = d === 3 ? ['|0⟩', '|1⟩'] : ['|0⟩', '|1⟩'];
    const cA = C.qutrit, cB = C.qubit;
    const spokeCols = [C.read, C.accent];
    const C0 = coeffMatrix(d), R = rot2(d, a);

    // strands between the ends: the d matched directions of the pair
    const drawStrands = (aa, ab, alpha, dashed) => {
      for (let i = 0; i < 2; i++) {
        const angA = -(aa + i * Math.PI / 2), angB = -(ab + i * Math.PI / 2);
        const xa = L.ax + Math.cos(angA) * L.R * 0.86, ya = L.cy + Math.sin(angA) * L.R * 0.86;
        const xb = L.bx + Math.cos(angB) * L.R * 0.86, yb = L.cy + Math.sin(angB) * L.R * 0.86;
        g.save(); g.strokeStyle = rgba(spokeCols[i], alpha); g.lineWidth = 1.6; if (dashed) g.setLineDash([3, 5]);
        const lift = L.R * (0.35 + 0.15 * i);
        g.beginPath(); g.moveTo(xa, ya); g.bezierCurveTo(xa + (xb - xa) * 0.3, Math.min(ya, yb) - lift, xa + (xb - xa) * 0.7, Math.min(ya, yb) - lift, xb, yb); g.stroke(); g.restore();
      }
    };

    if (st.step === 'mesh') {
      // B is in mesh: canvas angle -(-a) with the tooth offset
      const off = Math.PI / N;
      const driveA = Math.floor(((t - st.since) / 3) % 2) === 0 || st.manual != null;
      drawStrands(a, -a, 0.35, true);
      drawGear(g, L.ax, L.cy, -a, { N, R: L.R, color: mixGear(cA), spokes: spokesOf(a, spokeCols), axle: d === 3 ? C.axle : null });
      drawGear(g, L.bx, L.cy, a + off, { N, R: L.R, color: mixGear(cB), spokes: spokesOf(-a, spokeCols, -off), axle: d === 3 ? C.axle : null });
      // the driving hand: an arc arrow round the driven gear
      const hand = (x, s, col) => arcArrow(g, x, L.cy, L.R * 1.16, -Math.PI / 2 - 0.15 * s, -Math.PI / 2 - (0.15 + 0.85 * clamp(Math.abs(a), 0, 1)) * s * Math.sign(a || 1), { color: col, w: 3, head: 10 });
      if (driveA) hand(L.ax, 1, C.text); else hand(L.bx, -1, C.text);
      label(g, driveA ? 'U at A' : 'Uᵀ at B', driveA ? L.ax : L.bx, L.cy - L.R * 1.42, { font: font(15, 600, true, true) });
      label(g, 'end A', L.ax, L.cy + L.R * 1.2, { font: font(12), color: C.dim });
      label(g, 'end B', L.bx, L.cy + L.R * 1.2, { font: font(12), color: C.dim });
      // tiles
      const M1 = actPair(C0, R, null), M2 = actPair(C0, null, transposeOf(R)), diff = maxAbsDiff(M1, M2);
      const gw = d * L.s, gap = Math.max(36, v.w * 0.1), x1 = L.cx - gap / 2 - gw, x2 = L.cx + gap / 2;
      matrixTiles(g, x1, L.ty, L.s, M1, '(U ⊗ 1)|ω⟩', C.text);
      matrixTiles(g, x2, L.ty, L.s, M2, '(1 ⊗ Uᵀ)|ω⟩', C.text);
      label(g, '=', L.cx, L.ty + gw / 2, { font: font(22, 400, true) });
      label(g, 'largest difference ' + sciDiff(diff), L.cx, L.ty + gw + 16, { font: font(12), color: C.ok });
    } else {
      // matching: both pushed the same way, the mesh jams, the pair is fixed
      const off = Math.PI / N, jit = 0.012 * Math.sin(t * 31) * ease(Math.abs(a));
      drawGear(g, L.ax, L.cy, jit, { N, R: L.R, color: mixGear(cA), spokes: spokesOf(0, spokeCols), axle: d === 3 ? C.axle : null });
      drawGear(g, L.bx, L.cy, off - jit, { N, R: L.R, color: mixGear(cB), spokes: spokesOf(0, spokeCols, -off), axle: d === 3 ? C.axle : null });
      // the turned bases e_i = U|i>, conj(e_i) at B: dashed spokes, both turned by a
      for (const [x, col] of [[L.ax, cA], [L.bx, cB]]) {
        for (let i = 0; i < 2; i++) {
          const ang = -(a + i * Math.PI / 2), r1 = L.R * 0.98;
          g.save(); g.setLineDash([4, 4]); g.strokeStyle = rgba(spokeCols[i], 0.95); g.lineWidth = 2;
          g.beginPath(); g.moveTo(x, L.cy); g.lineTo(x + Math.cos(ang) * r1, L.cy + Math.sin(ang) * r1); g.stroke(); g.restore();
        }
        arcArrow(g, x, L.cy, L.R * 1.16, -Math.PI / 2 + 0.15, -Math.PI / 2 + 0.15 - 0.9 * clamp(Math.abs(a), 0.05, 1) * Math.sign(a || 1), { color: C.text, w: 3, head: 10 });
      }
      drawStrands(a, a, 0.7, false);
      label(g, 'U at A', L.ax, L.cy - L.R * 1.42, { font: font(15, 600, true, true) });
      label(g, 'Ū at B', L.bx, L.cy - L.R * 1.42, { font: font(15, 600, true, true) });
      label(g, 'dashed: the turned basis eᵢ = U|i⟩', L.cx, L.cy + L.R * 1.2, { font: font(12), color: C.dim });
      const M1 = C0, M2 = actPair(C0, R, conj(R)), diff = maxAbsDiff(M1, M2);
      const gw = d * L.s, gap = Math.max(36, v.w * 0.1), x1 = L.cx - gap / 2 - gw, x2 = L.cx + gap / 2;
      matrixTiles(g, x1, L.ty, L.s, M1, '|ω⟩', C.text);
      matrixTiles(g, x2, L.ty, L.s, M2, '(U ⊗ Ū)|ω⟩', C.text);
      label(g, '=', L.cx, L.ty + gw / 2, { font: font(22, 400, true) });
      label(g, 'largest difference ' + sciDiff(diff), L.cx, L.ty + gw + 16, { font: font(12), color: C.ok });
    }
    if (d === 3) label(g, 'axle: direction |2⟩, not moved by this turn', L.cx, v.y + 14, { font: font(12), color: C.axle });
    else label(g, 'a (2, 2) pair: two strands of amplitude 1/√2', L.cx, v.y + 14, { font: font(12), color: C.dim });
  },
};

function mixGear(c) { return c; }
function spokesOf(a, cols, extra = 0) {
  // spokes are drawn in the gear's own rotated frame; the gear is rotated
  // by -a (canvas), so spoke angles are fixed in the gear frame.
  return [{ a: -extra, color: cols[0] }, { a: -Math.PI / 2 - extra, color: cols[1] }];
}
function transposeOf(M) { const T = { n: M.m, m: M.n, re: new Float64Array(M.re.length), im: new Float64Array(M.im.length) }; for (let i = 0; i < M.n; i++) for (let j = 0; j < M.m; j++) { T.re[j * M.n + i] = M.re[i * M.m + j]; T.im[j * M.n + i] = M.im[i * M.m + j]; } return T; }
