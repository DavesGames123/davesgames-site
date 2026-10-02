// ============================================================================
//  DIFFERENTIAL  ·  tests.mjs — node tests.mjs
// ────────────────────────────────────────────────────────────────────────────
//  Checks diff.js:
//    mesh ......... at every contact, the nearest tooth of one gear sits half
//                   a pitch from the teeth of the other, measured as arcs on
//                   one common tangent, at many carrier and side gear angles
//                   (spiral bevel: at the heel and mid-face; helical: at
//                   three sections along the axle)
//    overlap ...... the real tooth outlines (teeth.js) of each pair, placed
//                   on their virtual gears at the pose's arc places, never
//                   cross, and the gap between them stays under 0.12 m
//    speeds ....... (wL + wR)/2 = wC from the gear chain, by finite steps
//    ratios ....... pinion turns 41/11 times per carrier turn
//    torque ....... the split sums to the carrier torque, open splits it
//                   equally, and no split passes the unit's bias
// ============================================================================
import { BEV, HEL, SPEC, pose, drive, V, TAU, friction, VARIANTS, spiral } from './diff.js';
import { toothPoly } from './teeth.js';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };

// Arc test. Gear g = { N, u, e0 } has teeth at th + k·2π/N + extra. Each
// tooth gets an arc place r·(angle from the contact direction c), signed
// along the common tangent t. Returns the error as a share of a pitch.
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const psiOf = (g, c) => Math.atan2(V.dot(V.cross(g.u, g.e0), c), V.dot(g.e0, c));
function arcs(g, th, extra, c, r, t) {
  const sg = Math.sign(V.dot(V.cross(g.u, c), t)), pc = psiOf(g, c), out = [];
  for (let k = 0; k < g.N; k++) out.push(sg * r * wrap(th + k * TAU / g.N + extra - pc));
  return out;
}
function interleave(A, thA, exA, cA, rA, B, thB, exB, cB, rB) {
  const t = V.unit(V.cross(A.u, cA)), pitch = TAU * rA / A.N;
  const near = l => l.reduce((m, q) => Math.abs(q) < Math.abs(m) ? q : m);
  const a = near(arcs(A, thA, exA, cA, rA, t)), b = near(arcs(B, thB, exB, cB, rB, t));
  const f = ((a - b) / pitch % 1 + 1) % 1;
  return Math.abs(f - 0.5);
}
const sp = (s, A, gam, sigma) => spiral(s, gam, sigma);   // the rule scene.js uses

// ── tooth overlap in the plane ─────────────────────────────────────────────
// Gear A sits at the origin, gear B at (RA + RB, 0), the contact on the line
// of centres. Each tooth near the contact is the teeth.js outline turned to
// its arc place (arc / pitch radius). Returns { cross, gap } over the teeth.
function segX(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
function segD(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy, u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l));
  return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy);
}
function planeMesh(A, arcsA, B, arcsB) {
  const RA = A.Nv * A.m / 2, RB = B.Nv * B.m / 2, C = RA + RB, pitch = Math.PI * A.m;
  const polyA = toothPoly(A.Nv, A.m, A.o), polyB = toothPoly(B.Nv, B.m, B.o);
  const PA = arcsA.filter(a => Math.abs(a) < 1.6 * pitch).map(a => polyA.map(([r, th]) => [r * Math.cos(a / RA + th), r * Math.sin(a / RA + th)]));
  const PB = arcsB.filter(a => Math.abs(a) < 1.6 * pitch).map(a => polyB.map(([r, th]) => [C + r * Math.cos(Math.PI - a / RB - th), r * Math.sin(Math.PI - a / RB - th)]));
  let cross = 0, gap = Infinity;
  for (const p of PA) for (const q of PB) {
    for (let i = 0; i < p.length - 1; i++) for (let j = 0; j < q.length - 1; j++) if (segX(p[i], p[i + 1], q[j], q[j + 1])) cross++;
    for (const v of p) for (let j = 0; j < q.length - 1; j++) gap = Math.min(gap, segD(v, q[j], q[j + 1]));
    for (const v of q) for (let i = 0; i < p.length - 1; i++) gap = Math.min(gap, segD(v, p[i], p[i + 1]));
  }
  return { cross, gap: gap / A.m };
}

// ── bevel ──────────────────────────────────────────────────────────────────
{
  const F = BEV.FR, C = BEV.C, A = BEV.A, A2 = BEV.A2;
  const sgnP = BEV.sgnP;
  let wRP = 0, wS = 0, xRP = 0, gRP = 0, xS = 0, gS = 0;
  for (let i = 0; i < 400; i++) {
    const phiC = i * 0.137, delta = Math.sin(i * 0.07) * 3.1;
    const p = pose('open', phiC, delta);
    for (const s of [A, A - SPEC.ring.F / 2, A - SPEC.ring.F]) {
      wRP = Math.max(wRP, interleave(F.pinion, p.pinion, sp(s, A, BEV.gP, sgnP), C.rp, s * Math.sin(BEV.gP), F.ring, -phiC, sp(s, A, BEV.gR, 1), C.rp, s * Math.sin(BEV.gR)));
    }
    const rS = A2 * Math.sin(BEV.gS), rQ = A2 * Math.sin(BEV.gQ);
    for (const [g, th, c] of [[F.spiderT, p.spiderT, C.RT], [F.spiderT, p.spiderT, C.LT], [F.spiderB, p.spiderB, C.RB], [F.spiderB, p.spiderB, C.LB]]) {
      const right = c[0] > 0;
      wS = Math.max(wS, interleave(g, th, 0, c, rQ, right ? F.sideR : F.sideL, right ? p.sideR : p.sideL, 0, c, rS));
    }
    if (i % 8) continue;
    // tooth overlap at the heel, mid-face and toe (virtual gears at cone distance s)
    for (const s of [A, A - SPEC.ring.F / 2, A - SPEC.ring.F]) {
      const ms = SPEC.ring.m * s / A, rP = s * Math.sin(BEV.gP), rR = s * Math.sin(BEV.gR), t1 = V.unit(V.cross(F.pinion.u, C.rp));
      const q = planeMesh({ Nv: SPEC.pinion.N / Math.cos(BEV.gP), m: ms, o: SPEC.pinion }, arcs(F.pinion, p.pinion, sp(s, A, BEV.gP, sgnP), C.rp, rP, t1),
        { Nv: SPEC.ring.N / Math.cos(BEV.gR), m: ms, o: SPEC.ring }, arcs(F.ring, -phiC, sp(s, A, BEV.gR, 1), C.rp, rR, t1));
      xRP += q.cross; gRP = Math.max(gRP, q.gap);
    }
    for (const s of [A2, A2 - SPEC.side.F]) {
      const ms = SPEC.side.m * s / A2, t1 = V.unit(V.cross(F.spiderT.u, C.RT));
      const q = planeMesh({ Nv: SPEC.spider.N / Math.cos(BEV.gQ), m: ms, o: SPEC.spider }, arcs(F.spiderT, p.spiderT, 0, C.RT, s * Math.sin(BEV.gQ), t1),
        { Nv: SPEC.side.N / Math.cos(BEV.gS), m: ms, o: SPEC.side }, arcs(F.sideR, p.sideR, 0, C.RT, s * Math.sin(BEV.gS), t1));
      xS += q.cross; gS = Math.max(gS, q.gap);
    }
  }
  ok(xRP === 0 && gRP < 0.12, 'ring and pinion teeth never overlap and stay in contact', `${xRP} crossings, widest gap ${gRP.toFixed(3)} m`);
  ok(xS === 0 && gS < 0.12, 'spider and side gear teeth never overlap and stay in contact', `${xS} crossings, widest gap ${gS.toFixed(3)} m`);
  ok(wRP < 1e-6, 'ring and pinion stay in mesh (heel, mid-face, toe)', `worst ${(wRP * 100).toExponential(1)}% of a pitch`);
  ok(wS < 1e-6, 'both spiders mesh with both side gears', `worst ${(wS * 100).toExponential(1)}% of a pitch`);
  let wErr = 0;
  for (let i = 0; i < 200; i++) {
    const c0 = i * 0.2, d0 = Math.cos(i) * 2, h = 1e-4, dc = 0.7 * h, dd = 0.3 * h;
    const a = pose('open', c0, d0), b = pose('open', c0 + dc, d0 + dd);
    const wL = (b.wheelL - a.wheelL) / h, wR = (b.wheelR - a.wheelR) / h, wC = dc / h;
    wErr = Math.max(wErr, Math.abs((wL + wR) / 2 - wC));
  }
  ok(wErr < 1e-6, '(wL + wR)/2 = wC through the bevel gears', `max error ${wErr.toExponential(1)}`);
  const a = pose('open', 0, 0), b = pose('open', 1e-3, 0);
  const rp = (b.pinion - a.pinion) / 1e-3;
  ok(Math.abs(rp - 41 / 11) < 1e-9, 'pinion turns 41/11 per carrier turn', rp.toFixed(4));
  const s1 = pose('open', 0, 1e-3);
  const ks = (s1.spiderT - a.spiderT) / 1e-3;
  ok(Math.abs(Math.abs(ks) - 16 / 10) < 1e-9, 'spider turns 16/10 of the side gear speed on the carrier', ks.toFixed(3));
  const ham = SPEC.spider.ha * SPEC.side.m, spTip = Math.hypot(A2 * Math.sin(BEV.gQ) + ham * Math.cos(BEV.gQ), A2 * Math.cos(BEV.gQ) - ham * Math.sin(BEV.gQ));
  ok(spTip < 50, 'spider heel tips stay inside the 50 mm spherical seat', `${spTip.toFixed(1)} mm`);
}

// ── helical (Torsen type 2) ────────────────────────────────────────────────
{
  const h = SPEC.hel, s = HEL.side, p = HEL.pin, neg = a => a.map(x => -x);
  let w = 0, hx = 0, hg = 0;
  for (let i = 0; i < 300; i++) {
    const q = pose('torsen', i * 0.11, Math.sin(i * 0.05) * 4);
    HEL.pairs.forEach((c, j) => {
      const dA = V.unit(c.cA), dB = V.unit(c.cB), dAB = V.unit(V.sub(c.cB, c.cA));
      for (const x of [-45, -30, -12]) w = Math.max(w, interleave(p, q.A[j], HEL.twist.A(x), neg(dA), HEL.rP, s, q.sideL, HEL.twist.L(x), dA, HEL.rS));
      for (const x of [12, 30, 45]) w = Math.max(w, interleave(p, q.B[j], HEL.twist.B(x), neg(dB), HEL.rP, s, q.sideR, HEL.twist.R(x), dB, HEL.rS));
      for (const x of [-6, 0, 6]) w = Math.max(w, interleave(p, q.A[j], HEL.twist.A(x), dAB, HEL.rP, p, q.B[j], HEL.twist.B(x), neg(dAB), HEL.rP));
      if (i % 10 || j) return;
      const oS = { ...h.sideT, alpha: HEL.alpha }, oP = { ...h.pinT, alpha: HEL.alpha };
      for (const x of [-40, -20]) { const t1 = V.unit(V.cross(p.u, neg(dA))); const r = planeMesh({ Nv: h.NP, m: h.m, o: oP }, arcs(p, q.A[j], HEL.twist.A(x), neg(dA), HEL.rP, t1), { Nv: h.NS, m: h.m, o: oS }, arcs(s, q.sideL, HEL.twist.L(x), dA, HEL.rS, t1)); hx += r.cross; hg = Math.max(hg, r.gap); }
      for (const x of [20, 40]) { const t1 = V.unit(V.cross(p.u, neg(dB))); const r = planeMesh({ Nv: h.NP, m: h.m, o: oP }, arcs(p, q.B[j], HEL.twist.B(x), neg(dB), HEL.rP, t1), { Nv: h.NS, m: h.m, o: oS }, arcs(s, q.sideR, HEL.twist.R(x), dB, HEL.rS, t1)); hx += r.cross; hg = Math.max(hg, r.gap); }
      for (const x of [-5, 5]) { const t1 = V.unit(V.cross(p.u, dAB)); const r = planeMesh({ Nv: h.NP, m: h.m, o: oP }, arcs(p, q.A[j], HEL.twist.A(x), dAB, HEL.rP, t1), { Nv: h.NP, m: h.m, o: oP }, arcs(p, q.B[j], HEL.twist.B(x), neg(dAB), HEL.rP, t1)); hx += r.cross; hg = Math.max(hg, r.gap); }
    });
  }
  ok(hx === 0 && hg < 0.12, 'helical teeth never overlap and stay in contact (three sections)', `${hx} crossings, widest gap ${hg.toFixed(3)} m`);
  ok(w < 1e-6, 'helical elements mesh with each other and both side gears', `worst ${(w * 100).toExponential(1)}% of a pitch`);
  let wErr = 0;
  for (let i = 0; i < 100; i++) {
    const h1 = 1e-4, a = pose('torsen', i * 0.3, i * 0.1), b = pose('torsen', i * 0.3 + 0.4 * h1, i * 0.1 + 0.9 * h1);
    wErr = Math.max(wErr, Math.abs(((b.wheelL - a.wheelL) + (b.wheelR - a.wheelR)) / 2 / h1 - 0.4));
  }
  ok(wErr < 1e-6, '(wL + wR)/2 = wC through the helical gears', `max error ${wErr.toExponential(1)}`);
  const c0 = HEL.pairs[0], c1 = HEL.pairs[1], tip = HEL.rP + h.pinT.ha * h.m;
  const gap = Math.hypot(c0.cB[1] - c1.cA[1], c0.cB[2] - c1.cA[2]) - 2 * tip;
  ok(gap > 2, 'element pairs clear each other', `${gap.toFixed(1)} mm`);
  const ov = h.pinA[1] - h.pinB[0];
  ok(h.pinA[1] < h.side[0] && -h.pinB[0] < h.side[0] && ov >= 10, 'each element stops short of the other side gear; the pair overlaps in the gap', `${ov} mm overlap`);
}

// ── torque ─────────────────────────────────────────────────────────────────
{
  let sumErr = 0, biasBad = 0, eqBad = 0, kBad = 0;
  for (const v of VARIANTS.map(q => q.id)) for (const sc of ['straight', 'corner', 'ice', 'lift']) for (let Tin = 0; Tin <= SPEC.TinMax; Tin += 10) for (const dir of [1, -1]) {
    const d = drive(v, sc, { Tin, R: 8, dir });
    if (!d.slip) sumErr = Math.max(sumErr, Math.abs(d.TL + d.TR - d.Tc));
    if (v === 'open' && Math.abs(d.TL - d.TR) > 1e-9) eqBad++;
    if (v === 'torsen' && d.TL > 0 && d.TR > 0 && Math.max(d.TL, d.TR) / Math.min(d.TL, d.TR) > SPEC.torsen.TBR + 1e-9) biasBad++;
    if (v === 'clutch' && Math.abs(d.TL - d.TR) > friction(v, d.Tc) + 1e-9) biasBad++;
    const kC = sc === 'lift' || d.stall ? 0 : 1;
    if (Math.abs((d.kL + d.kR) / 2 - kC) > 1e-12) kBad++;
  }
  ok(sumErr < 1e-9, 'left + right torque = carrier torque (no slip)', sumErr.toExponential(1));
  ok(eqBad === 0, 'open differential splits the torque equally', `${eqBad} bad`);
  ok(biasBad === 0, 'no split passes the bias (Torsen ratio 3, clutch friction torque)', `${biasBad} bad`);
  ok(kBad === 0, 'every scenario keeps kC = (kL + kR)/2', `${kBad} bad`);
  const o = drive('open', 'ice', { Tin: 250 }), t = drive('torsen', 'ice', { Tin: 250 }), c = drive('clutch', 'ice', { Tin: 250 });
  ok(!o.moving && o.kL === 0 && o.kR === 2, 'open on ice: ice wheel spins at 2 wC, car stuck');
  ok(t.moving && c.moving, 'limited-slip units move the car off the ice', `${t.TL.toFixed(0)} / ${c.TL.toFixed(0)} N·m to the dry wheel`);
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
