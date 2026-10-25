// ============================================================================
//  ALPHA QUDITS  ·  ends/scenes/bloch.js  ·  analogy 2b: the qubit end
// ----------------------------------------------------------------------------
//  A Bloch sphere drawn on a 2D canvas (orthographic, slow turn, drag to
//  turn). The three read bases of a qubit are the three mutually unbiased
//  eigenbases of the clock and shift operators (Wootters and Fields 1989),
//  the z, x and y axes.
//
//  step 'bases'       a state hops between the six basis states; the bars
//                     show |<e|psi>|^2 in all three bases, computed live.
//                     At a basis state of one axis the other two read 1/2.
//  step 'letters'     each basis gives d - 1 = 1 traceless letter, P - 1/2;
//                     the three are the Pauli matrices. Their trace Gram
//                     matrix is computed and shown: orthogonal.
//  step 'commutator'  two reads in different bases anticommute. The arc
//                     from A to B and the order sign: A B = +- i C. Their
//                     commutator is a further letter with the order as its
//                     sign, the source of the 3 commutator records.
//
//  GREP MAP   (grep -n "<anchor>" bloch.js)
//    function proj ...... the orthographic view
//    function sphere .... the glass ball, equator and meridians
//    function product ... sigma_a sigma_b = i s sigma_c from the matrices
//    draw( .............. the frame
// ============================================================================
import { C, font, label, arrow, clamp, rgba, ease, tile, short, rrect } from '../draw.js';
import { mubs, blochOf, inner, pauli, mul, hs, readLetters, spanRank } from '../linalg.js';

const STEPS = [{ id: 'bases', label: 'Three bases' }, { id: 'letters', label: 'Three letters' }, { id: 'commutator', label: 'Order sign' }];
const PERIOD = 11;
const AX = ['x', 'y', 'z'];
const AXC = { x: C.read, y: C.imag, z: C.qubit };
const B = mubs(2); // z, x, y
const BLOCH = B.map(b => b.vecs.map(blochOf));
const KETS = { z: ['|0⟩', '|1⟩'], x: ['|+⟩', '|−⟩'], y: ['|+i⟩', '|−i⟩'] };
const P = pauli(); // x, y, z
const PAIRS = [['x', 'y'], ['y', 'z'], ['z', 'x']];

// sigma_a sigma_b = (re + i im) sigma_c: read the coefficients by the trace pairing.
export function product(a, b) {
  const M = mul(P[AX.indexOf(a)], P[AX.indexOf(b)]);
  for (let c = 0; c < 3; c++) {
    const [re, im] = hs(P[c], M); // tr(sigma_c^dag M) = 2 * coefficient
    if (Math.hypot(re, im) > 1e-9) return { c: AX[c], re: re / 2, im: im / 2 };
  }
  const [re, im] = hs({ n: 2, m: 2, re: Float64Array.of(1, 0, 0, 1), im: new Float64Array(4) }, M);
  return { c: '1', re: re / 2, im: im / 2 };
}

function proj(p, view) {
  const [x, y, z] = p, cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), ct = Math.cos(view.tilt), stt = Math.sin(view.tilt);
  const x1 = x * cy - y * sy, y1 = x * sy + y * cy;
  const y2 = y1 * ct - z * stt, z2 = y1 * stt + z * ct;
  return { x: view.cx + view.r * x1, y: view.cy - view.r * z2, depth: y2 };
}
function slerp(a, b, t) {
  const dot = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1);
  if (dot < -0.9999) { // antipodal: go over a perpendicular point
    const m = Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const k = [a[1] * m[2] - a[2] * m[1], a[2] * m[0] - a[0] * m[2], a[0] * m[1] - a[1] * m[0]], n = Math.hypot(...k);
    const mid = k.map(v => v / n);
    return t < 0.5 ? slerp(a, mid, t * 2) : slerp(mid, b, t * 2 - 1);
  }
  const om = Math.acos(dot); if (om < 1e-6) return a.slice();
  const s0 = Math.sin((1 - t) * om) / Math.sin(om), s1 = Math.sin(t * om) / Math.sin(om);
  return [a[0] * s0 + b[0] * s1, a[1] * s0 + b[1] * s1, a[2] * s0 + b[2] * s1];
}
// a qubit ket from a Bloch vector
function ketOf(r) {
  const th = Math.acos(clamp(r[2], -1, 1)), ph = Math.atan2(r[1], r[0]);
  return { re: [Math.cos(th / 2), Math.sin(th / 2) * Math.cos(ph)], im: [0, Math.sin(th / 2) * Math.sin(ph)] };
}
function sphere(g, view, front) {
  const { cx, cy, r } = view;
  if (!front) {
    const gr = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r);
    gr.addColorStop(0, 'rgba(98,196,255,0.16)'); gr.addColorStop(0.7, 'rgba(98,196,255,0.05)'); gr.addColorStop(1, 'rgba(98,196,255,0.12)');
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = gr; g.fill();
  }
  const circle = f => { // great circle points by parameter
    let prev = null;
    for (let k = 0; k <= 72; k++) {
      const u = k / 72 * Math.PI * 2, p = proj(f(u), view), isFront = p.depth < 0;
      if (prev && isFront === front) { g.beginPath(); g.moveTo(prev.x, prev.y); g.lineTo(p.x, p.y); g.stroke(); }
      prev = p;
    }
  };
  g.save(); g.lineWidth = 1; g.strokeStyle = front ? 'rgba(210,230,240,0.30)' : 'rgba(210,230,240,0.10)';
  circle(u => [Math.cos(u), Math.sin(u), 0]);
  circle(u => [Math.cos(u), 0, Math.sin(u)]);
  circle(u => [0, Math.cos(u), Math.sin(u)]);
  g.restore();
  if (front) { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.strokeStyle = 'rgba(210,230,240,0.35)'; g.lineWidth = 1.2; g.stroke(); }
}
function axisPts(axis) { const i = AX.indexOf(axis); const p = [0, 0, 0]; p[i] = 1; const m = [0, 0, 0]; m[i] = -1; return [p, m]; }

export default {
  id: 'bloch',
  title: 'The qubit end on a Bloch sphere',
  steps: STEPS,
  autoKey: 'step',
  analogy: {
    right: 'Each read of a qubit is an axis through the sphere, and its two outcomes are the two poles. The three axes are at right angles, which is what mutually unbiased means here: a pole of one axis sits on the equator of the other two, so it reads one half either way. Two reads on different axes anticommute, and their product is the third axis with a sign set by the order.',
    breaks: 'The sphere is a picture of one qubit alone. In the model no qubit stands alone: each is an end of a pair, and a read acts on the pair. The sphere also hides the phase of the far end, which the transpose identity hands over conjugated.',
  },
  height: W => Math.round(W < 560 ? clamp(W * 1.35, 440, 560) : clamp(W * 0.6, 380, 480)),
  init(p) { return { step: p.step || 'bases', pair: p.pair ?? 0, order: p.order ?? 0, yaw0: 0.6, drag: 0 }; },
  controls(st) {
    const out = [{ key: 'step', label: 'Step', options: STEPS.map(s => ({ v: s.id, label: s.label })) }];
    if (st.step === 'commutator') {
      out.push({ key: 'pair', label: 'Reads', options: PAIRS.map((p, i) => ({ v: i, label: 'σ' + p[0] + ', σ' + p[1] })) });
      out.push({ key: 'order', label: 'Order', options: [{ v: 0, label: 'A then B' }, { v: 1, label: 'B then A' }] });
    }
    return out;
  },
  caption(st, t) {
    if (st.step === 'bases') return 'Three read bases. At a pole of one axis, each of the other two bases reads one half and one half: the bases are mutually unbiased. The bars are |⟨e|ψ⟩|², computed for the moving state.';
    if (st.step === 'letters') return 'Each basis gives one traceless letter, its projector minus one half. The three letters are the Pauli matrices, and their trace pairing is zero across letters: 3 = (d + 1)(d − 1) at d = 2.';
    const [a, b] = PAIRS[st.pair], o = st.order ? [b, a] : [a, b], pr = product(o[0], o[1]);
    return `σ${o[0]} σ${o[1]} = ${pr.im > 0 ? '+' : '−'}i σ${pr.c}. Swap the order and the sign flips: the two reads fix one thing more than either alone, their product, with the order as its sign.`;
  },
  pointer(st, kind, p) { if (kind === 'move') { st.drag += p.dx * 0.01; return true; } return false; },
  draw(g, env, st, t) {
    const v = env.view, tt = t - st.since;
    if (st.auto) st.step = STEPS[Math.floor(Math.max(0, tt) / PERIOD) % STEPS.length].id;
    const wide = v.w >= 560;
    const r = wide ? Math.min(v.h * 0.36, v.w * 0.22) : Math.min(v.w * 0.33, v.h * 0.25);
    const view = { cx: wide ? v.x + v.w * 0.3 : v.x + v.w / 2, cy: wide ? v.y + v.h * 0.5 : v.y + r + 34, r, yaw: st.yaw0 + st.drag + (env.reduced ? 0.05 : 0.18) * t, tilt: 0.38 };
    const panel = wide ? { x: v.x + v.w * 0.56, y: v.y + 24, w: v.w * 0.42, h: v.h - 48 } : { x: v.x + 12, y: view.cy + r + 40, w: v.w - 24, h: v.y + v.h - (view.cy + r + 40) - 8 };

    sphere(g, view, false);
    // the axes and the six basis states
    const focus = st.step === 'commutator' ? (() => { const [a, b] = PAIRS[st.pair]; return st.order ? [b, a] : [a, b]; })() : null;
    const res = focus ? product(focus[0], focus[1]) : null;
    const cyc = st.step === 'letters' ? AX[Math.floor(tt / 2.2) % 3] : null;
    const items = [];
    for (const ax of AX) {
      const [pp, mm] = axisPts(ax), A = proj(pp, view), Bm = proj(mm, view);
      const hi = (focus && (focus.includes(ax) || res.c === ax)) || cyc === ax || st.step === 'bases';
      items.push({ depth: Math.min(A.depth, Bm.depth), f: () => {
        g.save(); g.strokeStyle = rgba(AXC[ax], hi ? 0.8 : 0.3); g.lineWidth = hi ? 2 : 1.2;
        g.beginPath(); g.moveTo(Bm.x, Bm.y); g.lineTo(A.x, A.y); g.stroke(); g.restore();
      } });
      const bi = { z: 0, x: 1, y: 2 }[ax];
      BLOCH[bi].forEach((bv, k) => {
        const q = proj(bv, view);
        items.push({ depth: q.depth, f: () => {
          const a = q.depth < 0 ? 1 : 0.45;
          g.beginPath(); g.arc(q.x, q.y, 5.5, 0, Math.PI * 2); g.fillStyle = rgba(AXC[ax], a); g.fill();
          const lx = q.x + (q.x - view.cx) * 0.16, ly = q.y + (q.y - view.cy) * 0.16;
          label(g, KETS[ax][k], lx, ly, { font: font(13, 500, true), color: AXC[ax], alpha: a });
        } });
      });
    }
    items.sort((p, q) => q.depth - p.depth);
    for (const it of items) if (it.depth >= 0) it.f();

    let psiR = null;
    if (st.step === 'bases') {
      // hop between the six poles: z0, x0, y0, z1, x1, y1
      const seq = [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]], seg = 1.8, k = Math.floor(Math.max(0, tt) / seg), f = (Math.max(0, tt) / seg) - k;
      const a = BLOCH[seq[k % 6][0]][seq[k % 6][1]], b = BLOCH[seq[(k + 1) % 6][0]][seq[(k + 1) % 6][1]];
      psiR = slerp(a, b, ease((f - 0.55) / 0.45));
    }
    for (const it of items) if (it.depth < 0) it.f();
    sphere(g, view, true);

    if (psiR) {
      const o = proj([0, 0, 0], view), q = proj(psiR, view);
      arrow(g, o.x, o.y, q.x, q.y, { color: C.accent, w: 3, head: 11 });
      label(g, '|ψ⟩', q.x + 14, q.y - 10, { font: font(15, 600, true, true), color: C.accent });
      // bars: |<e|psi>|^2 per basis and outcome, computed
      const psi = ketOf(psiR);
      const rows = [['z', 0], ['x', 1], ['y', 2]], bw = panel.w, rh = Math.min(46, panel.h / 3.6);
      label(g, 'probability of each outcome, |⟨e|ψ⟩|²', panel.x, panel.y + 6, { font: font(12), color: C.dim, align: 'left' });
      rows.forEach(([ax, bi], j) => {
        const y = panel.y + 22 + j * rh;
        label(g, ax + ' basis', panel.x, y + rh * 0.4, { font: font(13, 500), color: AXC[ax], align: 'left' });
        const x0 = panel.x + 70, w0 = bw - 70;
        B[bi].vecs.forEach((e, k) => {
          const [re, im] = inner(e, psi), pr = re * re + im * im, x = x0 + k * w0 / 2, w = w0 / 2 - 8;
          g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(x, y + 4, w, rh * 0.55);
          g.fillStyle = rgba(AXC[ax], 0.85); g.fillRect(x, y + 4, w * pr, rh * 0.55);
          label(g, KETS[ax][k] + ' ' + pr.toFixed(2), x + 4, y + 4 + rh * 0.275, { font: font(12, 500), align: 'left', color: C.text });
        });
      });
    }
    if (st.step === 'letters') {
      const s = clamp(Math.min(panel.w / 9.5, panel.h / 5.2), 18, 34), names = ['σx', 'σy', 'σz'];
      label(g, 'letters: P − ½ = ½ σ for each basis', panel.x, panel.y + 6, { font: font(12), color: C.dim, align: 'left' });
      P.forEach((M, k) => {
        const x = panel.x + k * (2 * s + Math.max(14, s * 0.8)), y = panel.y + 34, on = cyc === AX[k];
        g.save(); g.globalAlpha = on ? 1 : 0.55;
        for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
          const re = M.re[i * 2 + j], im = M.im[i * 2 + j];
          tile(g, x + j * s, y + i * s, s, re, im, 1, { text: im ? (im > 0 ? 'i' : '−i') : short(re) });
        }
        label(g, names[k], x + s, y + 2 * s + 14, { font: font(14, 600, true, true), color: AXC[AX[k]] });
        g.restore();
      });
      // trace Gram matrix of the read letters (computed): tr(s_a s_b)
      const y0 = panel.y + 34 + 2 * s + 40, gs = clamp(s * 0.8, 16, 26);
      label(g, 'tr(σₐ σᵦ), computed:', panel.x, y0, { font: font(12), color: C.dim, align: 'left' });
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { const [re] = hs(P[i], P[j]); tile(g, panel.x + j * gs, y0 + 14 + i * gs, gs, re, 0, 2, { text: short(re) }); }
      const rk = spanRank(readLetters(2).map(l => l.A));
      label(g, `3 bases × (d − 1) = ${rk} independent letters`, panel.x + 3 * gs + 12, y0 + 14 + 1.5 * gs, { font: font(12, 500), align: 'left', color: C.text });
    }
    if (st.step === 'commutator') {
      const [a, b] = focus, pa = AX.indexOf(a), pb = AX.indexOf(b);
      const va = [0, 0, 0], vb = [0, 0, 0], vc = [0, 0, 0]; va[pa] = 1; vb[pb] = 1; vc[AX.indexOf(res.c)] = res.im > 0 ? 1 : -1;
      const ph = ((tt % 3) / 3);
      // arc from A to B
      g.save(); g.strokeStyle = C.accent; g.lineWidth = 3;
      g.beginPath();
      const n = 30, up = ease(ph / 0.5);
      for (let k = 0; k <= n * up; k++) { const q = proj(slerp(va, vb, k / n).map(x => x * 1.04), view); k ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y); }
      g.stroke(); g.restore();
      const o = proj([0, 0, 0], view);
      for (const [vv, col, nm] of [[va, AXC[a], 'A = σ' + a], [vb, AXC[b], 'B = σ' + b]]) {
        const q = proj(vv, view); arrow(g, o.x, o.y, q.x, q.y, { color: col, w: 2.5 });
        label(g, nm, q.x + (q.x - o.x) * 0.25, q.y + (q.y - o.y) * 0.25 - 8, { font: font(13, 600, true, true), color: col });
      }
      const k2 = ease((ph - 0.45) / 0.3);
      if (k2 > 0) {
        const q = proj(vc.map(x => x * k2), view);
        arrow(g, o.x, o.y, q.x, q.y, { color: C.accent, w: 4, head: 12 });
        label(g, (res.im > 0 ? '+' : '−') + 'σ' + res.c, q.x + 18, q.y, { font: font(15, 700, true, true), color: C.accent, alpha: k2 });
      }
      // the algebra, computed from the matrices
      const ab = product(a, b), ba = product(b, a);
      const lines = [
        [`σ${a} σ${b} = ${ab.im > 0 ? '+' : '−'}i σ${ab.c}`, C.text],
        [`σ${b} σ${a} = ${ba.im > 0 ? '+' : '−'}i σ${ba.c}`, C.dim],
        [`[σ${a}, σ${b}] = ${ab.im > 0 ? '+' : '−'}2i σ${ab.c}`, C.accent],
        ['anticommute: Weyl phase −1 at d = 2', C.dim],
      ];
      lines.forEach(([s, col], i) => label(g, s, panel.x, panel.y + 12 + i * 26, { font: font(i < 3 ? 15 : 12, i === 2 ? 600 : 400, i < 3, false), color: col, align: 'left' }));
      const yb = panel.y + 12 + 4 * 26 + 6;
      if (yb + 40 < v.y + v.h) {
        rrect(g, panel.x - 6, yb - 4, Math.min(panel.w, 330), 44, 8); g.fillStyle = 'rgba(255,214,102,0.07)'; g.fill();
        label(g, 'three pairs of letters at each read qubit:', panel.x, yb + 8, { font: font(12), color: C.dim, align: 'left' });
        label(g, 'the 3 commutator records', panel.x, yb + 27, { font: font(13, 600), color: C.accent, align: 'left' });
      }
    }
    label(g, 'qubit, d = 2', view.cx, view.cy + r + 18, { font: font(12), color: C.qubit });
  },
};
