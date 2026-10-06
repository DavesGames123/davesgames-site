// ============================================================================
//  GEAR TYPES  ·  tests.mjs — node stella-nova/pages/gear-types/tests.mjs
// ----------------------------------------------------------------------------
//  Checks mech.js against the real tooth outlines of teeth.js:
//    overlap ...... in the test plane of each pair, the teeth of the two
//                   members never cross, at 240 input angles (helical: at
//                   three slices of the face; bevel: on the virtual gears;
//                   worm: in the mid-plane; rack: both running senses)
//    contact ...... every contact point s_k on the line of action lies on
//                   the driving tooth outline (within 0.12 mm) and within
//                   the backlash of the driven outline
//    eps .......... contact ratio: the mean pair count over a pitch equals
//                   eps_alpha; spur pairs switch between 1 and 2; the
//                   helical count swings less than the spur count
//    ratios ....... finite steps of pose(): -N1/N2, worm -z1/N2, and the
//                   rack moves r1 per radian of the pinion (v = omega r)
//    helical ...... the normal of the twisted involute flank gives
//                   Fa / Ft = tan(beta) and Fr / Ft = tan(alpha_t)
//    bevel ........ the pitch cones share an apex (A = R1/sin g1 = R2/sin g2)
//                   and the separating force splits into Fa1, Fr1 as stated
//    worm ......... efficiency from a force and velocity balance on the
//                   flank equals wormEff(); self-locking iff back <= 0; the
//                   page unit self-locks with mu = 0.10
// ============================================================================
import { UNITS, derive, plane, pose, contacts, pairsIn, helixNormal, wormEff, TAU, T_TH, D2R } from './mech.js';
import { toothPoly } from './teeth.js';

let fail = 0, n = 0;
const ok = (c, msg) => { n++; console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); if (!c) fail++; };
const near = (a, b, e) => Math.abs(a - b) <= e;

// ── plane geometry ────────────────────────────────────────────────────────
function segX(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
function segD(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy, u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l));
  return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy);
}
const polyD = (p, poly) => { let m = Infinity; for (let i = 0; i < poly.length - 1; i++) m = Math.min(m, segD(p, poly[i], poly[i + 1])); return m; };
const crosses = (A, Bp) => { for (let i = 0; i < A.length - 1; i++) for (let j = 0; j < Bp.length - 1; j++) if (segX(A[i], A[i + 1], Bp[j], Bp[j + 1])) return true; return false; };
const gap = (A, Bp) => { let m = Infinity; for (const p of A) m = Math.min(m, polyD(p, Bp)); for (const p of Bp) m = Math.min(m, polyD(p, A)); return m; };

// teeth of a gear: centre C, N teeth of virtual count Nv, tooth k centre at
// world angle a0 + k 2 pi / Nv (virtual angles), only those near point P
function gearTeeth(C, Nv, m, o, a0, P, reach) {
  const poly = toothPoly(Nv, m, o), out = [];
  // k runs from the tooth nearest P: a virtual gear has a fractional tooth
  // count, so only the teeth near the contact are true teeth
  const aP = Math.atan2(P[1] - C[1], P[0] - C[0]), k0 = Math.round((aP - a0) / (TAU / Nv));
  for (let k = k0 - 4; k <= k0 + 4; k++) {
    const c = a0 + k * TAU / Nv;
    const pts = poly.map(([r, t]) => [C[0] + r * Math.cos(c + t), C[1] + r * Math.sin(c + t)]);
    const R = Nv * m / 2;
    if (Math.hypot(C[0] + R * Math.cos(c) - P[0], C[1] + R * Math.sin(c) - P[1]) < reach) out.push(pts);
  }
  return out;
}
// rack teeth: pitch line y0, tooth centres x0 + k p, tips toward +y
function rackTeeth(D, y0, x0, P, reach) {
  const out = [], hw = h => T_TH / 2 * D.p - h * Math.tan(D.at);
  for (let k = -40; k <= 40; k++) {
    const xc = x0 + k * D.p;
    if (Math.abs(xc - P[0]) > reach) continue;
    out.push([[xc - hw(-D.hf), y0 - D.hf], [xc - hw(D.ha), y0 + D.ha], [xc + hw(D.ha), y0 + D.ha], [xc + hw(-D.hf), y0 - D.hf]]);
  }
  return out;
}

// both members in the plane at input angle th, slice z (helical)
function members(u, D, th, z = 0) {
  const Q = pose(D, th), L = plane(D, Q.dir), reach = 2.2 * D.p;
  const o = { ha: D.ha / D.mt, hf: D.hf / D.mt, t: T_TH, alpha: D.at };
  if (D.id === 'rack') {
    return { Q, L, drv: gearTeeth([0, 0], D.N1, D.mt, o, -Math.PI / 2 + Q.a1, L.P, reach), drn: rackTeeth(D, -D.r1, Q.x + D.p / 2, L.P, reach) };
  }
  if (D.id === 'worm') {
    return { Q, L, drv: rackTeeth(D, 0, Q.x, L.P, reach), drn: gearTeeth([0, D.r2], D.N2, D.mt, o, -Math.PI / 2 + Q.a2, L.P, reach) };
  }
  const tw = D.beta ? z * Math.tan(D.beta) : 0;
  const c1 = D.g1 ? Math.cos(D.g1) : 1, c2 = D.g2 ? Math.cos(D.g2) : 1;
  const Nv1 = D.Nv1 || D.N1, Nv2 = D.Nv2 || D.N2;
  return {
    Q, L, arc: Q.arc + tw,
    drv: gearTeeth([0, 0], Nv1, D.mt, o, (Q.a1 + tw / D.r1) * c1, L.P, reach),
    drn: gearTeeth([D.r1 + D.r2, 0], Nv2, D.mt, o, Math.PI + (Q.a2 - tw / D.r2) * c2, L.P, reach),
  };
}

for (const u of UNITS) {
  const D = derive(u), N = 240;
  const slices = D.id === 'helical' ? [-D.b / 2, 0, D.b / 2] : [0];
  let crossed = 0, maxGap = 0, onDrv = 0, onDrn = 0, nC = 0;
  const span = D.id === 'rack' ? TAU * D.slow : TAU;
  for (let i = 0; i < N; i++) {
    const th = span * (i + 0.37) / N;
    for (const z of slices) {
      const M = members(u, D, th, z);
      for (const A of M.drv) for (const Bp of M.drn) if (crosses(A, Bp)) crossed++;
      let g = Infinity; for (const A of M.drv) for (const Bp of M.drn) g = Math.min(g, gap(A, Bp));
      maxGap = Math.max(maxGap, g);
      const arc = M.arc ?? M.Q.arc;
      for (const s of contacts(D, arc, M.Q.dir)) {
        const p = [M.L.P[0] + s * M.L.d[0], M.L.P[1] + s * M.L.d[1]];
        let a = Infinity, b = Infinity;
        for (const A of M.drv) a = Math.min(a, polyD(p, A));
        for (const Bp of M.drn) b = Math.min(b, polyD(p, Bp));
        onDrv = Math.max(onDrv, a); onDrn = Math.max(onDrn, b); nC++;
      }
    }
  }
  const bl = 2 * 0.02 * D.p * Math.cos(D.at);
  ok(crossed === 0, `${u.id}: teeth never cross (${crossed} crossings, ${N * slices.length} poses)`);
  ok(maxGap < bl + 0.1, `${u.id}: teeth stay in mesh (largest least gap ${maxGap.toFixed(3)} mm, backlash ${bl.toFixed(3)} mm)`);
  ok(nC > 0 && onDrv < 0.12, `${u.id}: ${nC} contact points on the driving flank (worst ${onDrv.toFixed(3)} mm)`);
  ok(onDrn < bl + 0.12, `${u.id}: contact points within backlash of the driven flank (worst ${onDrn.toFixed(3)} mm)`);

  // contact ratio: the mean count over one pitch of travel
  const K = 2000; let sum = 0, lo = 9, hi = 0;
  for (let i = 0; i < K; i++) { const c = pairsIn(D, D.p * i / K); sum += c; lo = Math.min(lo, c); hi = Math.max(hi, c); }
  ok(near(sum / K, D.epsA, 0.01), `${u.id}: mean pairs in contact ${(sum / K).toFixed(3)} = eps_alpha ${D.epsA.toFixed(3)}`);
  ok(D.epsA > 1.2, `${u.id}: eps_alpha ${D.epsA.toFixed(2)} > 1.2`);
  if (u.id === 'spur') { ok(lo === 1 && hi === 2, `spur: pairs switch between ${lo} and ${hi}`); }
  if (u.id === 'helical') {
    ok(hi - lo < 0.9, `helical: count swings by ${(hi - lo).toFixed(2)} (spur 1)`);
    ok(D.eps > 2, `helical: total contact ratio eps_alpha + eps_beta = ${D.eps.toFixed(2)} > 2`);
  }

  // ratios by finite steps
  const h = 1e-6, Q0 = pose(D, 0.3), Q1 = pose(D, 0.3 + h);
  if (u.id === 'rack') {
    ok(near((Q1.x - Q0.x) / (Q1.a1 - Q0.a1), D.r1, 1e-6), `rack: dx / dpsi = ${((Q1.x - Q0.x) / (Q1.a1 - Q0.a1)).toFixed(4)} mm = r1 (v = omega r)`);
    ok(near((Q1.a1 - Q0.a1) / h, Q0.w, 1e-5), 'rack: w is d(pinion)/d(th)');
  } else if (u.id === 'worm') {
    ok(near((Q1.a2 - Q0.a2) / h, -u.z1 / u.N2, 1e-6), `worm: wheel turns -z1/N2 = ${(-u.z1 / u.N2).toFixed(4)} per worm turn`);
  } else ok(near((Q1.a2 - Q0.a2) / h, -u.N1 / u.N2, 1e-6), `${u.id}: gear 2 turns -N1/N2 = ${(-u.N1 / u.N2).toFixed(4)}`);

  if (u.id === 'helical') {
    const nn = helixNormal(D);
    ok(near(Math.abs(nn[2] / nn[1]), Math.tan(D.beta), 2e-4), `helical: Fa/Ft from the flank normal ${Math.abs(nn[2] / nn[1]).toFixed(4)} = tan beta ${Math.tan(D.beta).toFixed(4)}`);
    ok(near(nn[0] / nn[1], Math.tan(D.at), 2e-4), `helical: Fr/Ft ${(nn[0] / nn[1]).toFixed(4)} = tan alpha_t ${Math.tan(D.at).toFixed(4)}`);
    ok(near(D.Fa, D.Ft * Math.tan(D.beta), 1e-9) && D.Fa > 0.3 * D.Ft, `helical: Fa = ${D.Fa.toFixed(0)} N at Ft = ${D.Ft.toFixed(0)} N`);
  }
  if (u.id === 'bevel') {
    ok(near(D.R1 / Math.sin(D.g1), D.R2 / Math.sin(D.g2), 1e-9) && near(D.g1 + D.g2, u.sigma, 1e-12), `bevel: one apex, A = ${D.A.toFixed(2)} mm, g1 + g2 = 90 deg`);
    // pinion axis +z, wheel axis -y, contact line d; the separating push on
    // the pinion is perpendicular to d in the plane of the axes
    const dl = [0, -Math.cos(D.g2), Math.sin(D.g2)], m = [0, -Math.sin(D.g2), -Math.cos(D.g2)];
    const Fs = D.Ft * Math.tan(u.alpha), Fp = m.map(v => -Fs * v);   // on the pinion, away from the wheel
    ok(Math.abs(dl[1] * m[1] + dl[2] * m[2]) < 1e-12 && near(Fp[2], D.Fa1, 1e-9) && near(Math.abs(Fp[1]), D.Fr1, 1e-9), `bevel: pinion thrust Fa1 = ${D.Fa1.toFixed(0)} N, radial Fr1 = ${D.Fr1.toFixed(0)} N`);
  }
  if (u.id === 'worm') {
    // flank normal and the two velocities at the contact (circumferential,
    // axial, radial of the worm): worm surface moves (1, 0, 0), the wheel
    // tooth (0, tan lambda, 0)
    const l = D.lambda, an = u.alpha;
    const nrm = [Math.sin(l) * Math.cos(an), Math.cos(l) * Math.cos(an), Math.sin(an)];
    const vw = [1, 0, 0], vg = [0, Math.tan(l), 0], sl = [Math.cos(l), -Math.sin(l), 0];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const balance = mu => {
      const F = nrm.map((v, i) => v + mu * sl[i]), G = nrm.map((v, i) => v - mu * sl[i]);
      return { fwd: dot(F, vg) / dot(F, vw), back: dot(G, vw) / dot(G, vg) };
    };
    const e = wormEff(l, u.mu, an), b = balance(u.mu);
    ok(Math.abs(dot(nrm, [vw[0] - vg[0], vw[1] - vg[1], 0])) < 1e-12, 'worm: sliding runs along the thread (normal ⟂ slip)');
    ok(near(e.fwd, b.fwd, 1e-12) && near(e.back, b.back, 1e-12), `worm: efficiency ${(e.fwd * 100).toFixed(1)} % forward, ${(e.back * 100).toFixed(1)} % back, from the flank balance`);
    let agree = true;
    for (let mu = 0; mu <= 0.3; mu += 0.005) { const w = wormEff(l, mu, an); if ((w.back <= 0) !== (Math.tan(l) <= mu / Math.cos(an))) agree = false; }
    ok(agree, 'worm: back efficiency <= 0 exactly when tan(lambda) <= mu / cos(alpha_n)');
    ok(D.selfLock && D.lambda < D.phiF, `worm: lead angle ${(D.lambda / D2R).toFixed(2)} deg < friction angle ${(D.phiF / D2R).toFixed(2)} deg: self-locking`);
    ok(near(D.L, u.z1 * Math.PI * u.m, 1e-12) && near(D.ratio, 30, 0), `worm: lead ${D.L.toFixed(2)} mm, ratio ${D.ratio} : 1`);
  }
}
console.log(`${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
