// ============================================================================
//  ALPHA QUDITS  ·  compare/scenes/roles.js  ·  a correspondence of roles (DOM-free)
// ----------------------------------------------------------------------------
//  Analogy 5, after the paper's Table S4 and Fig. S2, in our own drawing.
//  Left (or top on a phone): on-shell QED. The dressed photon two-point
//  function, two field insertions at x and y joined through the shaded
//  vacuum polarization; the bare line; Z3 as the ratio of residues at
//  q^2 = 0. Photon lines are drawn the way the particle-collider Feynman
//  card draws them (wavy). Right (or below): the model. The two reads at
//  the shared qutrit Q on the links to q1 and q2, the unread link to f
//  that carries the state, the dressed insertion M as a ring of the
//  records shaded by weight (counts from MODEL), the identity of R as the
//  bare insertion. ROLES lights the two halves in pairs. The role "zero
//  transfer" has no counterpart in the model, and the figure says so.
//  The paper's own warning stays on screen: no record is a Feynman diagram.
//
//  grep -n targets:  export const ROLES | export function layoutRoles |
//  function drawQED | function drawModel | function hl
// ============================================================================
import { C, text, textTex, measure, line, dot, clamp, backdrop, fitSize, rgba, wavyPts, strokePts, arrow, roundRect } from '../draw.js';

export const ROLES = [
  { id: 'insert', label: 'Two insertions', qed: ['x', 'y'], model: ['r1', 'r2'],
    qedText: 'two field insertions, at x and y', modelText: 'two reads of the link, taken at the shared qutrit Q on the links to q1 and q2' },
  { id: 'state', label: 'The state', qed: ['vac'], model: ['f'],
    qedText: 'the vacuum the two fields act on', modelText: 'a third, unread link of the same type, to the qubit f, which carries the state' },
  { id: 'dress', label: 'Dressing', qed: ['blob'], model: ['blob'],
    qedText: 'every vacuum-polarization insertion on the photon line', modelText: 'the dressed insertion M: the records, each with weight √k, the model’s counterpart of the sum over diagrams' },
  { id: 'bare', label: 'Bare', qed: ['bare'], model: ['bare'],
    qedText: 'the bare photon line, with no interaction', modelText: 'the identity of R, which weighs every direction once and reads 1' },
  { id: 'ratio', label: 'Ratio', qed: ['ratio'], model: ['ratio'],
    qedText: 'Z₃, dressed over bare: the ratio of residues', modelText: '⟨M⟩, the trace of M over the readout algebra R divided by its dimension N: dressed over bare (Eq. 2)' },
  { id: 'charge', label: 'Charge', qed: ['vert'], model: ['charge'],
    qedText: 'the Ward identity Z₁ = Z₂: vertex and charged field cancel', modelText: 'Q is conserved, so its dressed and bare insertions agree: Z₂/Z₁ = 1' },
  { id: 'coupling', label: 'Bare coupling', qed: ['abare'], model: ['abare'],
    qedText: 'the bare coupling is free, and set from the measured α(0)', modelText: 'the bare coupling is 1: a read’s projection onto a pair succeeds with certainty, ½ + ½' },
  { id: 'pole', label: 'Zero transfer', qed: ['q'], model: ['none'],
    qedText: 'the pole at q² = 0: a massless photon at zero momentum transfer', modelText: 'no counterpart. The model builds no propagator and no function of momentum; this enters only with Conjecture 1' },
];
const DWELL = 4.6;

export function layoutRoles(w) {
  const wide = w >= 600;
  return wide ? { wide, h: 334, panelH: 290 } : { wide, h: 580, panelH: 258 };
}

export default {
  id: 'roles',
  title: 'A correspondence of roles',
  init(env) {
    const st = { role: env.reduced ? 0 : -1, auto: !env.reduced, t: 0, t0: 0, reduced: !!env.reduced };
    if (env.params) this.show(st, env.params);
    return st;
  },
  show(st, p = {}) {
    if (p.role != null) { const i = typeof p.role === 'number' ? p.role : ROLES.findIndex(r => r.id === p.role); if (i >= 0) { st.role = i; st.auto = false; } }
    if (p.auto != null) { st.auto = !!p.auto && !st.reduced; st.t0 = st.t; }
  },
  height(w) { return layoutRoles(w).h; },
  active(st, t) {
    if (st.auto) return Math.floor(Math.max(0, t - st.t0) / DWELL) % ROLES.length;
    return st.role;
  },
  caption(st) {
    const i = this.active(st, st.t);
    if (i < 0) return 'Tap a role to light up its partner.';
    const r = ROLES[i];
    return `${r.label}. QED: ${r.qedText}. The model: ${r.modelText}.`;
  },
  info() {
    return `<p><b>A correspondence of roles, not of diagrams.</b> In the paper’s words, no record is a Feynman diagram. The model has no charged loop, no vertex factor, no loop momentum and no expansion in a coupling. The correspondence names what Theorem 2 computes; it is used in no proof, and the identification of the object with the photon is Conjecture 1.</p>`;
  },
  controls(st, ui) {
    const g = ui.group('Roles');
    ui.button(g, 'Auto', () => { st.auto = true; st.t0 = st.t; ui.redraw(); }, { pressed: () => st.auto });
    ROLES.forEach((r, i) => ui.button(g, r.label, () => { st.role = i; st.auto = false; ui.redraw(); }, { pressed: () => !st.auto && st.role === i }));
  },
  draw(g, box, t, st, F) {
    st.t = t;
    backdrop(g, box, C.chg, 0.03);
    const L = layoutRoles(box.w);
    const ai = this.active(st, t), role = ai >= 0 ? ROLES[ai] : null;
    const local = st.auto ? (Math.max(0, t - st.t0) % DWELL) : 9;
    const pulse = st.reduced ? 1 : 0.65 + 0.35 * Math.sin(t * 4);
    const fade = clamp(local / 0.35);
    const H = { on: id => role && role.qed.includes(id), mon: id => role && role.model.includes(id), any: !!role, pulse, fade };
    const pad = box.w < 420 ? 8 : 16, gap = 14;
    let a, b;
    if (L.wide) {
      const pw = (box.w - 2 * pad - gap) / 2;
      a = { x: box.x + pad, y: box.y + 8, w: pw, h: L.panelH };
      b = { x: box.x + pad + pw + gap, y: box.y + 8, w: pw, h: L.panelH };
    } else {
      a = { x: box.x + pad, y: box.y + 8, w: box.w - 2 * pad, h: L.panelH };
      b = { x: box.x + pad, y: box.y + 16 + L.panelH, w: box.w - 2 * pad, h: L.panelH };
    }
    drawQED(g, a, t, H, st.reduced);
    drawModel(g, b, t, H, F, st.reduced);
    // the link between the two halves for the lit role
    if (role) {
      const s = role.id === 'pole' ? 'no counterpart in the model' : role.label;
      const lx = L.wide ? box.x + box.w / 2 : box.x + box.w - pad - 6;
      const ly = L.wide ? box.y + 8 + L.panelH / 2 : box.y + 12 + L.panelH;
      g.globalAlpha = fade;
      if (L.wide) { line(g, lx - 5, ly, lx + 5, ly, C.val, 1.6); arrow(g, lx + 4, ly, 1, 0, 4, C.val); arrow(g, lx - 4, ly, -1, 0, 4, C.val); }
      else { line(g, lx + 4, ly - 8, lx + 4, ly + 4, C.val, 1.4); arrow(g, lx + 4, ly - 8, 0, -1, 3.5, C.val); arrow(g, lx + 4, ly + 4, 0, 1, 3.5, C.val); text(g, s, lx - 4, ly + 2, { size: 11.5, color: C.val, align: 'right' }); }
      g.globalAlpha = 1;
    }
    const warn = 'A correspondence of roles, not of diagrams: no record is a Feynman diagram.';
    const wsz = fitSize(g, warn, box.w - 2 * pad, 12, { it: true });
    if (measure(g, warn, { size: wsz, it: true }) <= box.w - 2 * pad) {
      text(g, warn, box.x + box.w / 2, box.y + box.h - 12, { size: wsz, color: C.ink2, align: 'center', it: true });
    } else {
      // A phone width: two lines at 11 px rather than one line cut at both sides.
      text(g, 'A correspondence of roles, not of diagrams:', box.x + box.w / 2, box.y + box.h - 27, { size: 11, color: C.ink2, align: 'center', it: true });
      text(g, 'no record is a Feynman diagram.', box.x + box.w / 2, box.y + box.h - 11, { size: 11, color: C.ink2, align: 'center', it: true });
    }
  },
};

// highlight helpers: stroke colour and alpha for an element
function hl(H, lit, base) {
  if (!H.any) return { col: base, a: 1, lit: false };
  return lit ? { col: base, a: 1, lit: true } : { col: base, a: 0.38, lit: false };
}
function halo(g, H, fn) {
  g.save(); g.globalAlpha = 0.5 * H.pulse * H.fade; g.strokeStyle = C.val; g.fillStyle = rgba(C.val, 0.25); fn(); g.restore();
}
function panelFrame(g, p, title, sub) {
  roundRect(g, p.x, p.y, p.w, p.h, 12); g.fillStyle = rgba('#ffffff', 0.025); g.fill();
  g.strokeStyle = C.line; g.lineWidth = 1; g.stroke();
  text(g, title, p.x + 12, p.y + 20, { size: 13, color: C.ink, w: 600 });
  text(g, sub, p.x + p.w - 12, p.y + 20, { size: 11, color: C.dim, align: 'right' });
}

function drawQED(g, p, t, H, reduced) {
  panelFrame(g, p, 'On-shell QED', 'the photon two-point function');
  const ph = reduced ? 0 : t * 5;
  const yD = p.y + 82, yB = p.y + 170;
  const xl = p.x + 26, xr = p.x + p.w - 26, xc = (xl + xr) / 2, R = Math.min(30, p.w * 0.09);
  // the vacuum: a tinted band behind the dressed row
  const vac = hl(H, H.on('vac'), C.dim);
  if (vac.lit) { roundRect(g, p.x + 8, yD - 44, p.w - 16, 88, 10); g.fillStyle = rgba(C.val, 0.08 * H.pulse * H.fade + 0.03); g.fill(); }
  text(g, 'dressed', p.x + 12, yD - 30, { size: 11, color: C.dim });
  text(g, 'vacuum', p.x + p.w - 12, yD - 30, { size: 11, color: vac.lit ? C.val : C.faint, align: 'right', alpha: vac.a });
  // photon lines into and out of the blob
  const ph1 = wavyPts(xl, yD, xc - R, yD, 4, 11, ph), ph2 = wavyPts(xc + R, yD, xr, yD, 4, 11, ph);
  const lineA = H.any ? 0.55 : 1;
  g.globalAlpha = lineA; strokePts(g, ph1, C.qb, 1.7); strokePts(g, ph2, C.qb, 1.7); g.globalAlpha = 1;
  // the blob: every vacuum-polarization insertion
  const bl = hl(H, H.on('blob'), C.ink2);
  if (bl.lit) halo(g, H, () => { g.beginPath(); g.arc(xc, yD, R + 6, 0, Math.PI * 2); g.lineWidth = 6; g.stroke(); });
  g.globalAlpha = bl.a;
  const gr = g.createRadialGradient(xc - R * 0.3, yD - R * 0.3, 2, xc, yD, R);
  gr.addColorStop(0, 'rgba(200,205,220,0.45)'); gr.addColorStop(1, 'rgba(120,130,150,0.22)');
  g.beginPath(); g.arc(xc, yD, R, 0, Math.PI * 2); g.fillStyle = gr; g.fill();
  g.strokeStyle = 'rgba(220,225,235,0.5)'; g.lineWidth = 1.2; g.stroke();
  // one charged loop drawn faintly inside, its arrows circling
  g.beginPath(); g.ellipse(xc, yD, R * 0.62, R * 0.42, 0, 0, Math.PI * 2); g.strokeStyle = rgba(C.ink, 0.6); g.lineWidth = 1.2; g.stroke();
  for (let k = 0; k < 2; k++) {
    const an = (reduced ? 0 : t * 1.6) + k * Math.PI;
    const ax = xc + R * 0.62 * Math.cos(an), ay = yD + R * 0.42 * Math.sin(an);
    arrow(g, ax, ay, -R * 0.62 * Math.sin(an), R * 0.42 * Math.cos(an), 3.6, rgba(C.ink, 0.85));
  }
  text(g, 'Π', xc, yD + 4.5, { size: 13, fam: 'serif', it: true, color: C.ink, align: 'center' });
  g.globalAlpha = 1;
  text(g, 'vacuum polarization', xc, yD + R + 16, { size: 11, color: bl.lit ? C.val : C.dim, align: 'center', alpha: bl.a });
  // the vertices where the photon meets the loop
  const vt = hl(H, H.on('vert'), C.chg);
  if (vt.lit) halo(g, H, () => { for (const x of [xc - R, xc + R]) { g.beginPath(); g.arc(x, yD, 8, 0, Math.PI * 2); g.fill(); } });
  g.globalAlpha = vt.a; dot(g, xc - R, yD, 3, C.chg); dot(g, xc + R, yD, 3, C.chg); g.globalAlpha = 1;
  if (vt.lit) textTex(g, 'Z_1 = Z_2', xc, yD - R - 8, { size: 12, color: C.val, align: 'center', w: 600 });
  // the two insertions
  for (const [id, x, lab] of [['x', xl, 'x'], ['y', xr, 'y']]) {
    const e = hl(H, H.on(id), C.ink);
    if (e.lit) halo(g, H, () => { g.beginPath(); g.arc(x, yD, 10, 0, Math.PI * 2); g.fill(); });
    g.globalAlpha = e.a; dot(g, x, yD, 4.4, C.ink); g.globalAlpha = 1;
    text(g, lab, x, yD + 20, { size: 14, fam: 'serif', it: true, color: e.lit ? C.val : C.ink2, align: 'center', alpha: e.a });
  }
  // the momentum transfer q
  const qe = hl(H, H.on('q'), C.qb);
  const qx0 = xl + (xc - R - xl) * 0.2, qx1 = xl + (xc - R - xl) * 0.8;
  g.globalAlpha = qe.a; line(g, qx0, yD - 15, qx1, yD - 15, qe.lit ? C.val : C.dim, 1.2); arrow(g, qx1, yD - 15, 1, 0, 3.5, qe.lit ? C.val : C.dim); g.globalAlpha = 1;
  text(g, 'q', (qx0 + qx1) / 2, yD - 20, { size: 12, fam: 'serif', it: true, color: qe.lit ? C.val : C.dim, align: 'center', alpha: qe.a });
  // the bare line
  const be = hl(H, H.on('bare'), C.qb);
  text(g, 'bare', p.x + 12, yB - 20, { size: 11, color: be.lit ? C.val : C.dim });
  if (be.lit) halo(g, H, () => { g.lineWidth = 7; g.beginPath(); g.moveTo(xl, yB); g.lineTo(xr, yB); g.stroke(); });
  g.globalAlpha = be.a; strokePts(g, wavyPts(xl, yB, xr, yB, 4, 11, ph), C.qb, 1.7); dot(g, xl, yB, 3.6, C.ink); dot(g, xr, yB, 3.6, C.ink); g.globalAlpha = 1;
  // the ratio
  const yr = p.y + p.h - 52;
  line(g, p.x + 12, yr - 18, p.x + p.w - 12, yr - 18, C.line, 1);
  const ra = hl(H, H.on('ratio'), C.val), ab = hl(H, H.on('abare'), C.ink);
  let x = p.x + 14;
  x += text(g, 'α(0) = ', x, yr, { size: 14, fam: 'serif', color: C.ink2 });
  x += textTex(g, 'Z_3', x, yr, { size: 14, fam: 'serif', it: true, color: ra.lit ? C.val : C.ink, alpha: ra.a, w: ra.lit ? 600 : 400 });
  x += text(g, ' · ', x, yr, { size: 14, fam: 'serif', color: C.ink2 });
  textTex(g, 'α_{bare}', x, yr, { size: 14, fam: 'serif', color: ab.lit ? C.val : C.ink, alpha: ab.a, w: ab.lit ? 600 : 400 });
  const long = 'Z_3: ratio of residues, dressed over bare, at q^2 = 0';
  const s2 = measure(g, long.replace(/[_^]/g, ''), { size: 11 }) <= p.w - 28 ? long : 'Z_3: dressed over bare residue at q^2 = 0';
  textTex(g, s2, p.x + 14, yr + 22, { size: fitSize(g, s2.replace(/[_^]/g, ''), p.w - 28, 11.5), color: (ra.lit || qe.lit) ? C.val : C.dim });
}

function drawModel(g, p, t, H, F, reduced) {
  panelFrame(g, p, 'The model', 'two reads on an unread link');
  const yD = p.y + 82, yB = p.y + 170;
  const Qx = p.x + p.w / 2, q1x = p.x + 30, q2x = p.x + p.w - 30, R = Math.min(30, p.w * 0.09);
  text(g, 'dressed', p.x + 12, yD - 30, { size: 11, color: C.dim });
  // links: two strands each (a qutrit-qubit pair has two strands)
  const link = (xa, ya, xb, yb, col, a, dash) => {
    const dx = xb - xa, dy = yb - ya, L = Math.hypot(dx, dy) || 1, nx = -dy / L * 2.2, ny = dx / L * 2.2;
    g.globalAlpha = a;
    line(g, xa + nx, ya + ny, xb + nx, yb + ny, col, 1.4, dash);
    line(g, xa - nx, ya - ny, xb - nx, yb - ny, col, 1.4, dash);
    g.globalAlpha = 1;
  };
  const r1 = hl(H, H.mon('r1'), C.qb), r2 = hl(H, H.mon('r2'), C.qb), fe = hl(H, H.mon('f'), C.qb);
  const fY = yD + 44;
  link(q1x, yD, Qx - R, yD, rgba(C.qb, 0.85), H.any ? 0.55 : 1);
  link(Qx + R, yD, q2x, yD, rgba(C.qb, 0.85), H.any ? 0.55 : 1);
  // the unread link to f, which carries the state
  const fx = Qx + Math.min(70, p.w * 0.16);
  if (fe.lit) halo(g, H, () => { g.lineWidth = 8; g.beginPath(); g.moveTo(Qx + R * 0.5, yD + R * 0.8); g.lineTo(fx, fY); g.stroke(); });
  link(Qx + R * 0.5, yD + R * 0.8, fx, fY, rgba(C.qb, 0.7), fe.a, [4, 3]);
  g.globalAlpha = fe.a; dot(g, fx, fY, 5, C.card, C.qb, 1.6); g.globalAlpha = 1;
  text(g, 'f', fx + 10, fY + 4, { size: 13, fam: 'serif', it: true, color: fe.lit ? C.val : C.ink2, alpha: fe.a });
  const ul = 'unread: the state', ulw = g.measureText(ul).width;
  if (fx + 22 + ulw < p.x + p.w - 8) text(g, ul, fx + 22, fY + 4, { size: 11, color: fe.lit ? C.val : C.dim, alpha: fe.a });
  else text(g, ul, p.x + p.w - 10, fY + 20, { size: 11, color: fe.lit ? C.val : C.dim, alpha: fe.a, align: 'right' });
  // reads: a basis travels from Q along each read link
  for (const [e, x0, x1, id] of [[r1, Qx - R, q1x, 'r1'], [r2, Qx + R, q2x, 'r2']]) {
    if (e.lit) halo(g, H, () => { g.beginPath(); g.arc(x0, yD, 9, 0, Math.PI * 2); g.lineWidth = 5; g.stroke(); });
    g.globalAlpha = e.a;
    g.beginPath(); g.arc(x0, yD, 6, 0, Math.PI * 2); g.strokeStyle = C.qt; g.lineWidth = 1.6; g.stroke();
    if (!reduced) { const k = ((t * 0.55) % 1); dot(g, x0 + (x1 - x0) * k, yD, 2.4, rgba(C.val, 1 - k)); }
    g.globalAlpha = 1;
    text(g, 'read', (x0 + x1) / 2, yD - 10, { size: 11, color: e.lit ? C.val : C.dim, align: 'center', alpha: e.a });
  }
  for (const [x, lab] of [[q1x, 'q₁'], [q2x, 'q₂']]) {
    g.globalAlpha = H.any ? 0.7 : 1; dot(g, x, yD, 5, C.qb); g.globalAlpha = 1;
    text(g, lab, x, yD + 22, { size: 13, fam: 'serif', it: true, color: C.ink2, align: 'center' });
  }
  // M: a ring of the records at Q, shaded by weight
  const bl = hl(H, H.mon('blob'), C.rec);
  const sec = F.sectors || null;
  const counts = sec ? [['++', 1], ['+-', Math.SQRT2], ['-+', Math.sqrt(3)], ['--', Math.sqrt(6)]].map(([k, w]) => ({ n: sec[k], w })) : [];
  const total = counts.reduce((s, c) => s + c.n, 0);
  if (bl.lit) halo(g, H, () => { g.beginPath(); g.arc(Qx, yD, R + 7, 0, Math.PI * 2); g.lineWidth = 6; g.stroke(); });
  g.globalAlpha = bl.a;
  g.beginPath(); g.arc(Qx, yD, R, 0, Math.PI * 2); g.fillStyle = rgba(C.rec, 0.1); g.fill();
  if (total) {
    let i = 0;
    const rot = reduced ? 0 : t * 0.15;
    for (const c of counts) for (let k = 0; k < c.n; k++, i++) {
      const an = rot + i / total * Math.PI * 2, rr = R - 4 - (i % 3) * 3.2;
      dot(g, Qx + rr * Math.cos(an), yD + rr * Math.sin(an), 1.25, rgba(C.rec, 0.25 + 0.75 * (c.w - 1) / (Math.sqrt(6) - 1)));
    }
  }
  dot(g, Qx, yD, 7, C.qt);
  g.globalAlpha = 1;
  text(g, 'Q', Qx, yD + 4.5, { size: 11, fam: 'serif', it: true, color: C.bg, align: 'center', w: 600 });
  const ml = total ? `M: ${total} records, weights √k` : 'M: the records, weights √k';
  text(g, ml, Qx, yD - R - 8, { size: 11, color: bl.lit ? C.val : C.dim, align: 'center', alpha: bl.a });
  // the charge Q, conserved
  const ch = hl(H, H.mon('charge'), C.chg);
  if (ch.lit) {
    halo(g, H, () => { g.beginPath(); g.arc(Qx, yD, 12, 0, Math.PI * 2); g.fill(); });
    textTex(g, 'Q conserved: Z_2/Z_1 = 1', p.x + 12, yD + 44, { size: 11.5, color: C.val, w: 600 });
  }
  // the bare insertion
  const be = hl(H, H.mon('bare'), C.ink2);
  text(g, 'bare', p.x + 12, yB - 20, { size: 11, color: be.lit ? C.val : C.dim });
  if (be.lit) halo(g, H, () => { roundRect(g, Qx - 64, yB - 15, 128, 30, 10); g.fill(); });
  g.globalAlpha = be.a;
  roundRect(g, Qx - 58, yB - 12, 116, 24, 8); g.strokeStyle = C.line2; g.lineWidth = 1; g.stroke();
  g.globalAlpha = 1;
  textTex(g, '1_R reads 1', Qx, yB + 5, { size: 12.5, fam: 'serif', color: be.lit ? C.val : C.ink, align: 'center', alpha: be.a });
  // Right of the box when it fits, else on the 'bare' row at the right.
  if (Qx + 66 + measure(g, 'the identity of R', { size: 11 }) <= p.x + p.w - 8) text(g, 'the identity of R', Qx + 66, yB + 4, { size: 11, color: C.dim, alpha: be.a });
  else text(g, 'the identity of R', p.x + p.w - 12, yB - 20, { size: 11, color: C.dim, alpha: be.a, align: 'right' });
  // the ratio
  const yr = p.y + p.h - 52;
  line(g, p.x + 12, yr - 18, p.x + p.w - 12, yr - 18, C.line, 1);
  const ra = hl(H, H.mon('ratio'), C.val), ab = hl(H, H.mon('abare'), C.ink), no = hl(H, H.mon('none'), C.ink);
  let x = p.x + 14;
  x += textTex(g, 'α_{cand} = ', x, yr, { size: 14, fam: 'serif', color: C.ink2 });
  x += text(g, '⟨M⟩', x, yr, { size: 14, fam: 'serif', color: ra.lit ? C.val : C.ink, alpha: ra.a, w: ra.lit ? 600 : 400 });
  x += text(g, ' · ', x, yr, { size: 14, fam: 'serif', color: C.ink2 });
  // Two statements, not one chain: the ratio is <M> times the bare
  // coupling, and the bare coupling is 1 (Sec. S8). Written as one chain,
  // 'a = <M> . a_bare = 1' would read as a_cand = 1.
  x += textTex(g, 'α_{bare}', x, yr, { size: 14, fam: 'serif', color: ab.lit ? C.val : C.ink, alpha: ab.a, w: ab.lit ? 600 : 400 });
  textTex(g, ',  α_{bare} = 1', x, yr, { size: 12.5, fam: 'serif', color: ab.lit ? C.val : C.ink2, alpha: ab.a });
  const N = F.N, s2 = `⟨M⟩ = tr_R M / N${N ? `,  N = ${N}` : ''}`;
  textTex(g, s2, p.x + 14, yr + 22, { size: fitSize(g, s2.replace(/[_^]/g, ''), p.w - 28, 11.5), color: ra.lit ? C.val : C.dim });
  if (no.lit) {
    const bw = 168, bx = Qx - bw / 2, by = yD - 19;
    g.save(); g.globalAlpha = H.fade;
    roundRect(g, bx, by, bw, 38, 9); g.fillStyle = C.card2; g.fill();
    g.setLineDash([4, 3]); g.strokeStyle = C.val; g.lineWidth = 1.2; g.stroke(); g.restore();
    text(g, 'no propagator, no q²:', Qx, by + 15, { size: 11.5, color: C.val, align: 'center' });
    text(g, 'enters with Conjecture 1', Qx, by + 30, { size: 11.5, color: C.val, align: 'center' });
  }
}
