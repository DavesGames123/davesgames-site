// ============================================================================
//  ALPHA QUDITS  ·  webs/scenes/chain.js  ·  rigid links, free joints
// ----------------------------------------------------------------------------
//  The deck's own analogy for the joins ("an analogy for the joins, not a
//  model of them"). Four links hang in a row; each joint turns on its own.
//
//  step 'chain'  a mechanical chain: a link is rigid, its two ends turn
//                together; at a joint two links meet and turn freely
//  step 'pairs'  the same row as a network of pairs. Each end carries a
//                basis cross. Inside a pair the two crosses turn together
//                (a basis at one end fixes the far end's basis, as its
//                conjugate). At a shared qudit the two copies' crosses are
//                not matched: each joint has its own angle
//  step 'known'  what is known: what no turn of a joint changes. The angle
//                between the two ends of each pair stays at 0 while every
//                joint angle wanders; the joint angles are not known
//
//  GREP MAP   (grep -n "<anchor>" chain.js)
//    function joints .... the animated joint angles
//    function geometry .. link end points from the angles
//    draw( .............. the frame
// ============================================================================
import { C, font, label, setBounds, clamp, rgba, ease } from '../draw.js';
import { quditDot } from '../draw.js';

const STEPS = [{ id: 'chain', label: 'A chain' }, { id: 'pairs', label: 'Pairs' }, { id: 'known', label: 'What is known' }];
const PERIOD = 8;
const NL = 4;

// joint angles (radians): link 0 hangs from a fixed pin; each later link
// turns relative to the one before it
export function joints(t, calm = 1) {
  return Array.from({ length: NL }, (_, i) => (i === 0 ? 0.25 : 0.62) * calm * Math.sin(0.55 * t * (1 + 0.37 * i) + i * 1.9));
}
// basis angles of the copies at each joint (not matched across the joint)
function jointBases(t) { return Array.from({ length: NL + 1 }, (_, i) => 0.9 * Math.sin(0.4 * t * (1.3 + 0.21 * i) + i * 2.3)); }

export function geometry(v, th) {
  const L = clamp(Math.min((v.w - 40) / (NL + 0.4), (v.h - 90) / 2.2), 46, 150);
  let x = v.x + (v.w - L * NL) / 2, y = v.y + v.h * 0.42, a = 0;
  const pts = [[x, y]], dirs = [];
  for (let i = 0; i < NL; i++) {
    a += th[i]; dirs.push(a);
    x += Math.cos(a) * L; y += Math.sin(a) * L; pts.push([x, y]);
  }
  // centre the whole chain vertically in the view
  const ys = pts.map(p => p[1]), mid = (Math.min(...ys) + Math.max(...ys)) / 2, dy = v.y + v.h * 0.46 - mid;
  const xs = pts.map(p => p[0]), mx = (Math.min(...xs) + Math.max(...xs)) / 2, dx = v.x + v.w / 2 - mx;
  return { L, pts: pts.map(([px, py]) => [px + dx, py + dy]), dirs };
}

function link(g, p, q, L, col, alpha = 1) {
  const a = Math.atan2(q[1] - p[1], q[0] - p[0]), w = L * 0.2;
  g.save(); g.translate(p[0], p[1]); g.rotate(a); g.globalAlpha *= alpha;
  g.strokeStyle = col; g.lineWidth = Math.max(3, L * 0.07);
  g.beginPath();
  g.moveTo(0, -w); g.lineTo(L, -w); g.arc(L, 0, w, -Math.PI / 2, Math.PI / 2); g.lineTo(0, w); g.arc(0, 0, w, Math.PI / 2, -Math.PI / 2);
  g.stroke(); g.restore();
}
function cross(g, x, y, a, r, col, alpha = 1) {
  g.save(); g.globalAlpha *= alpha; g.strokeStyle = col; g.lineWidth = 2;
  for (const k of [0, Math.PI / 2]) {
    g.beginPath(); g.moveTo(x - Math.cos(a + k) * r, y - Math.sin(a + k) * r); g.lineTo(x + Math.cos(a + k) * r, y + Math.sin(a + k) * r); g.stroke();
  }
  g.fillStyle = col; g.beginPath(); g.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, 2.6, 0, Math.PI * 2); g.fill();
  g.restore();
}

export default {
  id: 'chain',
  title: 'Rigid links, free joints',
  steps: STEPS,
  autoKey: 'step',
  analogy: {
    right: 'Inside a link nothing can turn: fix one end and the other is fixed, as a basis at one end of a maximally entangled pair fixes the basis at its far end. At a joint two links meet and either can turn on its own, as the copies of a shared qudit carry no fixed match between their bases.',
    breaks: 'A chain lives in space and its joints turn through angles in a plane. The pairs have no space and no angle of that kind: a turn here is a change of basis by any unitary, and the far end turns by its conjugate, not by the same angle. The deck itself calls this an analogy for the joins, not a model of them.',
  },
  height: W => Math.round(clamp(W * 0.72, 300, 460)),
  init(p) { return { step: STEPS.some(s => s.id === p.step) ? p.step : 'chain' }; },
  controls() { return [{ key: 'step', label: 'Step', options: STEPS.map(s => ({ v: s.id, label: s.label })) }]; },
  caption(st) {
    if (st.step === 'chain') return 'A chain: each link is rigid, so its two ends turn together. Where two links meet, the joint is free to turn.';
    if (st.step === 'pairs') return 'The same row as pairs of qudits. Inside a pair the two basis crosses turn together. At a shared qudit the copies are not matched: each keeps its own basis.';
    return 'What is known is what no turn of a joint changes: the match inside each pair. The joint angles change all the time and are not known.';
  },
  draw(g, env, st, t) {
    const v = env.view; setBounds(v);
    if (st.auto) { const k = Math.floor((t - st.since) / PERIOD); st.step = STEPS[((k % STEPS.length) + STEPS.length) % STEPS.length].id; }
    const th = joints(t, env.reduced ? 0.5 : 1), G = geometry(v, th), L = G.L;
    const fs = clamp(v.w / 34, 11.5, 14);
    if (st.step === 'chain') {
      for (let i = 0; i < NL; i++) link(g, G.pts[i], G.pts[i + 1], L, i % 2 ? C.steel : C.brass);
      // the pin
      g.save(); g.fillStyle = C.axle; g.beginPath(); g.arc(G.pts[0][0], G.pts[0][1], 4, 0, Math.PI * 2); g.fill(); g.restore();
      const j = G.pts[2];
      label(g, 'joint: free to turn', j[0], j[1] - L * 0.42, { font: font(fs, 500), color: C.accent });
      const m = [(G.pts[0][0] + G.pts[1][0]) / 2, (G.pts[0][1] + G.pts[1][1]) / 2];
      label(g, 'link: rigid', m[0], m[1] + L * 0.42, { font: font(fs, 500), color: C.text });
    } else {
      const jb = jointBases(t), r = clamp(L * 0.16, 8, 16);
      // links as pairs: a thin line with strands
      for (let i = 0; i < NL; i++) {
        const [p, q] = [G.pts[i], G.pts[i + 1]];
        g.save(); g.strokeStyle = rgba(C.read, 0.55); g.lineWidth = 2;
        g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke(); g.restore();
      }
      // each end: a copy of the shared qudit, offset a little along its link
      for (let i = 0; i < NL; i++) {
        const a = G.dirs[i], [p, q] = [G.pts[i], G.pts[i + 1]], off = r * 1.3;
        const e0 = [p[0] + Math.cos(a) * off, p[1] + Math.sin(a) * off], e1 = [q[0] - Math.cos(a) * off, q[1] - Math.sin(a) * off];
        // the pair's basis: one angle per pair; its far end turns with it
        const b = jb[i] + G.dirs[i];
        quditDot(g, e0[0], e0[1], 3, { r: r * 0.55, alpha: 0.7 });
        quditDot(g, e1[0], e1[1], 3, { r: r * 0.55, alpha: 0.7 });
        cross(g, e0[0], e0[1], b, r, C.qutrit);
        cross(g, e1[0], e1[1], -b + 2 * G.dirs[i], r, C.qubit);
      }
      if (st.step === 'pairs') {
        const j = G.pts[2];
        label(g, 'shared qudit: bases not matched', j[0], j[1] - L * 0.5, { font: font(fs, 500), color: C.accent });
        const m = [(G.pts[0][0] + G.pts[1][0]) / 2, (G.pts[0][1] + G.pts[1][1]) / 2];
        label(g, 'pair: one end fixes the other', m[0], m[1] + L * 0.5, { font: font(fs, 500), color: C.read });
      } else {
        const y = v.y + v.h - 22;
        label(g, 'inside each pair: the match never changes (known)', v.x + v.w / 2, y - 22, { font: font(fs, 500), color: C.read });
        label(g, 'at each joint: ' + th.slice(1).map(a => Math.round(a * 180 / Math.PI) + '°').join(', ') + ' (not known)', v.x + v.w / 2, y, { font: font(fs * 0.95), color: C.dim });
      }
    }
  },
};
