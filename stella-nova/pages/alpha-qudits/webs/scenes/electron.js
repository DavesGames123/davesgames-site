// ============================================================================
//  ALPHA QUDITS  ·  webs/scenes/electron.js  ·  the electron's web
// ----------------------------------------------------------------------------
//  The deck's conjectured web for the electron, built link by link in the
//  order the deck lists its genres. Solid: what the deck's text states.
//  Dashed: what it does not give (how many legs and docks, where they end,
//  how further hubs attach); those are labelled "not given".
//
//  step 'core'    (3,3) the core triangle of three qutrits
//  step 'hub'     (4,3) the in-leg joining the hub to the core
//  step 'legs'    (4,2) the legs of the hub assembly, (2,2) its qubit pair
//  step 'docks'   (3,2) the docks at the other two corners
//  step 'ladder'  the muon carries two hub assemblies, the tau three
//                 (params.lepton = 'electron' | 'muon' | 'tau')
//
//  The hub's dimension 4 is read off the genres: (4,3) to a core qutrit and
//  (4,2) to the qubits. That the web is the electron is a conjecture.
//
//  GREP MAP   (grep -n "<anchor>" electron.js)
//    export function layout ... node positions in the view
//    draw( .................... the frame
// ============================================================================
import { C, font, label, setBounds, clamp, rgba, ease } from '../draw.js';
import { quditDot, linkLine, gradeChip } from '../draw.js';
import { LEPTONS } from '../data.js';

const STEPS = [
  { id: 'core', label: 'Core' }, { id: 'hub', label: 'In-leg' }, { id: 'legs', label: 'Hub assembly' },
  { id: 'docks', label: 'Docks' }, { id: 'ladder', label: 'Ladder' },
];
const ORDER = STEPS.map(s => s.id);
const PERIOD = 5.5;

export function layout(v) {
  const u = clamp(Math.min(v.w / 7.2, (v.h - 110) / 5.4), 34, 96);
  const cx = v.x + v.w * 0.42, cy = v.y + 40 + u * 3.6;
  const A = [cx, cy - u * 0.95], B = [cx - u * 1.1, cy + u * 0.95], Cc = [cx + u * 1.1, cy + u * 0.95];
  const H = [cx, cy - u * 2.45];
  const q1 = [cx - u * 0.9, cy - u * 3.45], q2 = [cx + u * 0.9, cy - u * 3.45];
  const dB = [B[0] - u * 1.2, B[1] + u * 0.55], dC = [Cc[0] + u * 1.2, Cc[1] + u * 0.55];
  const hubs = [H, [cx + u * 2.1, cy - u * 2.0], [cx + u * 3.1, cy - u * 1.1]];
  return { u, A, B, C: Cc, H, q1, q2, dB, dC, hubs };
}

function stage(st) { return ORDER.indexOf(st.step); }

export default {
  id: 'electron',
  title: "The electron's web",
  steps: STEPS,
  autoKey: 'step',
  analogy: {
    right: 'A web is a small molecule of links: a fixed set of qudits joined by maximally entangled pairs of known genres. Building it one genre at a time shows that each part of the proposal is a link type from the table of six.',
    breaks: 'A molecule has bond lengths and angles. A web has no geometry: the drawing places the qudits only so the parts can be told apart. And where the deck does not say how many legs or docks there are, the dashed lines are our placeholders, not the compendium\'s web.',
  },
  height: W => Math.round(clamp(W * 1.0 + 40, 380, 640)),
  init(p) { return { step: ORDER.includes(p.step) ? p.step : 'core', lepton: ['electron', 'muon', 'tau'].includes(p.lepton) ? p.lepton : 'electron' }; },
  controls(st) {
    const g = [{ key: 'step', label: 'Step', options: STEPS.map(s => ({ v: s.id, label: s.label })) }];
    if (st.step === 'ladder') g.push({ key: 'lepton', label: 'Lepton', options: LEPTONS.map(l => ({ v: l.name, label: l.name })) });
    return g;
  },
  caption(st) {
    return {
      core: 'The core: a triangle of three qutrits, joined by (3,3) links. (3,3) is a dark genre.',
      hub: 'The in-leg: a (4,3) link joins the hub assembly to one corner of the core. The hub end has dimension 4.',
      legs: 'The hub assembly: (4,2) legs from the hub to qubits, and a (2,2) qubit pair. The deck does not give the number of legs; two are drawn, dashed.',
      docks: 'The docks: (3,2) links at the other two corners of the core. (3,2) is the readable genre of the Letter. Where each dock ends is not given; dashed.',
      ladder: {
        electron: 'Each generation adds one hub assembly. The electron has one.',
        muon: 'The muon carries two hub assemblies: the lepton ladder, a conditional theorem (box 152.1). How the second hub attaches is not given; dashed.',
        tau: "The tau carries three: its third hub is a theorem (box 154.1). How the extra hubs attach is not given; dashed.",
      }[st.lepton],
    }[st.step];
  },
  draw(g, env, st, t) {
    const v = env.view; setBounds(v);
    if (st.auto) {
      const k = Math.floor((t - st.since) / PERIOD), n = ORDER.length + 2;
      const i = ((k % n) + n) % n;
      st.step = ORDER[Math.min(i, ORDER.length - 1)];
      st.lepton = i < ORDER.length - 1 ? 'electron' : ['electron', 'muon', 'tau'][i - (ORDER.length - 1)] || 'tau';
    }
    const L = layout(v), s = stage(st), fs = clamp(L.u / 4.6, 11, 14), grow = st.auto ? ease(((t - st.since) % PERIOD) / 0.9) : 1;
    const al = i => (i < s ? 1 : i === s ? grow : 0);
    const tag = (txt, x, y, col, a = 1, align = 'center') => label(g, txt, x, y, { font: font(fs, 500), color: col, alpha: a, align });
    // links first, then dots on top
    const core = [[L.A, L.B], [L.B, L.C], [L.C, L.A]];
    for (const [p, q] of core) linkLine(g, p[0], p[1], q[0], q[1], { da: 3, db: 3, alpha: al(0) });
    if (s >= 1) linkLine(g, L.H[0], L.H[1], L.A[0], L.A[1], { da: 4, db: 3, alpha: al(1) });
    if (s >= 2) {
      linkLine(g, L.H[0], L.H[1], L.q1[0], L.q1[1], { da: 4, db: 2, dashed: true, alpha: al(2) });
      linkLine(g, L.H[0], L.H[1], L.q2[0], L.q2[1], { da: 4, db: 2, dashed: true, alpha: al(2) });
      linkLine(g, L.q1[0], L.q1[1], L.q2[0], L.q2[1], { da: 2, db: 2, alpha: al(2) });
    }
    if (s >= 3) {
      linkLine(g, L.B[0], L.B[1], L.dB[0], L.dB[1], { da: 3, db: 2, dashed: true, alpha: al(3) });
      linkLine(g, L.C[0], L.C[1], L.dC[0], L.dC[1], { da: 3, db: 2, dashed: true, alpha: al(3) });
    }
    const extra = s === 4 ? LEPTONS.find(l => l.name === st.lepton).hubs - 1 : 0;
    for (let h = 1; h <= extra; h++) {
      const P = L.hubs[h], Q = L.hubs[h - 1];
      linkLine(g, Q[0], Q[1], P[0], P[1], { color: C.dim, dashed: true, alpha: grow });
      quditDot(g, P[0], P[1], 4, { ghost: true, alpha: grow });
      tag('hub assembly ' + (h + 1), P[0], P[1] + L.u * 0.45, C.imag, grow);
    }
    for (const p of [L.A, L.B, L.C]) quditDot(g, p[0], p[1], 3, { alpha: Math.max(0.35, al(0)) });
    if (s >= 1) quditDot(g, L.H[0], L.H[1], 4, { alpha: al(1) });
    if (s >= 2) { quditDot(g, L.q1[0], L.q1[1], 2, { alpha: al(2) }); quditDot(g, L.q2[0], L.q2[1], 2, { alpha: al(2) }); }
    if (s >= 3) { quditDot(g, L.dB[0], L.dB[1], 2, { ghost: true, alpha: al(3) }); quditDot(g, L.dC[0], L.dC[1], 2, { ghost: true, alpha: al(3) }); }
    // genre tags
    tag('(3,3) core', (L.B[0] + L.C[0]) / 2, L.B[1] + L.u * 0.42, C.qutrit, al(0));
    if (s >= 1) tag('(4,3) in-leg', L.H[0] - L.u * 0.16, (L.H[1] + L.A[1]) / 2, C.imag, al(1), 'right');
    if (s >= 2) { tag('(4,2) legs', L.q1[0] - L.u * 0.25, (L.H[1] + L.q1[1]) / 2 + L.u * 0.1, C.imag, al(2), 'right'); tag('(2,2) qubit pair', (L.q1[0] + L.q2[0]) / 2, L.q1[1] - L.u * 0.42, C.qubit, al(2)); }
    if (s >= 3) { tag('(3,2) dock', L.dB[0], L.dB[1] + L.u * 0.48, C.read, al(3)); tag('(3,2) dock', L.dC[0], L.dC[1] + L.u * 0.48, C.read, al(3)); }
    if (s >= 2) tag('dashed: count or far end not given', v.x + v.w / 2, v.y + v.h - 36, C.dim, 1);
    gradeChip(g, v.x + v.w / 2, v.y + v.h - 14, 'conjectured', { align: 'center', text: 'that this web is the electron: conjectured', px: Math.max(11, fs * 0.85) });
    if (s === 4 && st.lepton !== 'electron') {
      const L0 = LEPTONS.find(l => l.name === st.lepton);
      gradeChip(g, v.x + v.w - 10, v.y + 14, L0.grade, { align: 'right', text: `${L0.claim}: ${L0.grade === 'theorem' ? 'theorem' : 'conditional'} (${L0.box})`, px: Math.max(11, fs * 0.85) });
    }
  },
};
