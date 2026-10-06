// ============================================================================
//  RADIAL ENGINE  ·  tests.mjs — node stella-nova/pages/radial-engine/tests.mjs
// ----------------------------------------------------------------------------
//  Checks mech.js at 1440 crank angles over two turns:
//    master ....... piston 1 follows the slider-crank formula (1e-9 mm) and
//                   its stroke is exactly 2 r
//    lengths ...... master rod L, every link rod l, every knuckle pin at rho
//                   from the crank pin and at the cylinder angle in the
//                   master rod frame (1e-9)
//    axes ......... every wrist pin stays on its cylinder axis
//    articulation . every link stroke differs from 2 r (by less than 2 %),
//                   the TDC of a link piston is off its cylinder angle
//                   (by less than 8 deg), cylinders i and n - i mirror
//    compression .. cylinder 1 has the stated ratio; no crown reaches the
//                   head; every ratio within 1 of cylinder 1
//    firing ....... the order is 1 3 5 ... 2 4 ..., one firing every 4 pi / n
//    cam ring ..... N = (n - 1) / 2 lobes at -1 / (2 N): by sampling, each
//                   follower meets exactly one lobe per 720 deg, at
//                   fire_i + lobe centre for every cylinder; both valves are
//                   shut from 20 deg before to 20 deg after firing TDC
//    clearance .... no piston skirt reaches the crank counterweight or the
//                   master rod flange
// ============================================================================
import { UNITS, makeEngine, survey, sliderCrank, TAU, CW_GAP, flangeR } from './mech.js';

let fail = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fail++; console.log('FAIL', msg); } else if (process.argv.includes('-v')) console.log('ok  ', msg); };
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const DEG = 180 / Math.PI;
const wrapDeg = a => ((a % 720) + 720) % 720;

for (const u of UNITS) {
  const E = makeEngine(u), N = 1440, S = survey(E);
  let master = 0, lens = 0, axis = 0, knuckle = 0;
  for (let k = 0; k < N; k++) {
    const th = 2 * TAU * k / N, Q = E.pose(th);
    master = Math.max(master, Math.abs(Q.s[0] - sliderCrank(u.r, u.L, th)));
    lens = Math.max(lens, Math.abs(dist(Q.C, Q.P0) - u.L));
    for (let i = 1; i < u.n; i++) {
      lens = Math.max(lens, Math.abs(dist(Q.K[i], Q.P[i]) - u.l));
      // knuckle: radius rho and angle phi_i from the master rod direction
      const kx = Q.K[i][0] - Q.C[0], ky = Q.K[i][1] - Q.C[1], mx = Q.P0[0] - Q.C[0], my = Q.P0[1] - Q.C[1];
      const a = Math.atan2(mx * ky - my * kx, mx * kx + my * ky);
      knuckle = Math.max(knuckle, Math.abs(Math.hypot(kx, ky) - u.rho), Math.abs(Math.atan2(Math.sin(a - E.phi[i]), Math.cos(a - E.phi[i]))));
    }
    for (let i = 0; i < u.n; i++) axis = Math.max(axis, Math.abs(Q.P[i][0] * E.ax[i][1] - Q.P[i][1] * E.ax[i][0]));
  }
  ok(master < 1e-9, `${u.id}: master piston = slider-crank (worst ${master.toExponential(1)} mm)`);
  ok(Math.abs(S[0].stroke - 2 * u.r) < 1e-6, `${u.id}: master stroke ${S[0].stroke.toFixed(6)} = 2r = ${2 * u.r}`);
  ok(lens < 1e-9, `${u.id}: rod lengths hold (worst ${lens.toExponential(1)} mm)`);
  ok(knuckle < 1e-9, `${u.id}: knuckle pins fixed in the master rod (worst ${knuckle.toExponential(1)})`);
  ok(axis < 1e-9, `${u.id}: wrist pins on their cylinder axes (worst ${axis.toExponential(1)} mm)`);

  const links = S.slice(1);
  ok(links.every(q => Math.abs(q.stroke - 2 * u.r) > 1e-3 && Math.abs(q.stroke - 2 * u.r) < 0.02 * 2 * u.r),
    `${u.id}: link strokes ${links.map(q => q.stroke.toFixed(2)).join(' ')} differ from ${2 * u.r} by < 2 %`);
  ok(links.every(q => Math.abs(q.shift) > 1e-3 && Math.abs(q.shift * DEG) < 8),
    `${u.id}: link TDC shifts ${links.map(q => (q.shift * DEG).toFixed(2)).join(' ')} deg, nonzero and < 8`);
  let mir = 0;
  for (let i = 1; i < u.n; i++) { const a = S[i], b = S[u.n - i]; mir = Math.max(mir, Math.abs(a.stroke - b.stroke), Math.abs(a.shift + b.shift)); }
  ok(mir < 1e-6, `${u.id}: cylinders i and n - i mirror (worst ${mir.toExponential(1)})`);

  ok(Math.abs(S[0].CR - u.CR) < 1e-9, `${u.id}: cylinder 1 compression ratio ${S[0].CR.toFixed(3)}`);
  ok(S.every(q => q.clear > 5), `${u.id}: crowns clear the head (least ${Math.min(...S.map(q => q.clear)).toFixed(2)} mm)`);
  ok(S.every(q => Math.abs(q.CR - u.CR) < 1), `${u.id}: ratios ${S.map(q => q.CR.toFixed(2)).join(' ')}`);

  // firing order and spacing
  const want = [...Array.from({ length: (u.n + 1) / 2 }, (_, k) => 1 + 2 * k), ...Array.from({ length: (u.n - 1) / 2 }, (_, k) => 2 + 2 * k)];
  ok(E.order.join() === want.join(), `${u.id}: firing order ${E.order.join('-')}`);
  const f = [...E.fire].sort((a, b) => a - b), gap = f.slice(1).map((x, k) => x - f[k]);
  ok(gap.every(g => Math.abs(g - 2 * TAU / u.n) < 1e-12) && Math.abs(f[0] + 2 * TAU - f[f.length - 1] - 2 * TAU / u.n) < 1e-12, `${u.id}: one firing every ${(720 / u.n).toFixed(2)} deg`);

  // cam ring, by sampling: find each lobe centre pass at each follower
  ok(E.N === (u.n - 1) / 2 && Math.abs(E.omega + 1 / (2 * E.N)) < 1e-15, `${u.id}: ${E.N} lobes per track at ${E.omega.toFixed(4)} of crank speed`);
  for (let k = 0; k < 2; k++) {
    const T = E.tracks[k], M = 72000;
    let bad = 0, count = 0;
    for (let i = 0; i < u.n; i++) {
      const passes = [];
      let prev = null;
      for (let m = 0; m <= M; m++) {
        const th = 2 * TAU * m / M, psi = E.camAngle(k, th);
        // signed distance of the follower to the nearest lobe centre
        let best = null;
        for (let j = 0; j < E.N; j++) { const d = Math.atan2(Math.sin(E.phi[i] - psi - j * TAU / E.N), Math.cos(E.phi[i] - psi - j * TAU / E.N)); if (best === null || Math.abs(d) < Math.abs(best)) best = d; }
        if (prev !== null && (best > 0) !== (prev > 0) && Math.abs(best - prev) < 0.5) passes.push(th * DEG);
        prev = best;
      }
      const inTurn = passes.filter(t => t < 720);
      count += inTurn.length;
      if (inTurn.length !== 1) { bad++; continue; }
      const err = Math.abs(wrapDeg(inTurn[0] - E.fire[i] * DEG - T.at + 360) - 360);
      if (err > 720 / M + 1e-6) bad++;
    }
    ok(bad === 0 && count === u.n, `${u.id}: ${k ? 'exhaust' : 'inlet'} track meets each follower once per 720 deg at fire + ${T.at} deg (${count} passes)`);
  }
  let open = 0;
  for (let i = 0; i < u.n; i++) for (let a = -20; a <= 20; a += 0.5) { const Q = E.pose(E.fire[i] + a / DEG); open = Math.max(open, Q.lift[i][0], Q.lift[i][1]); }
  ok(open === 0, `${u.id}: valves shut round firing TDC (largest lift ${open})`);
  let overlap = 0;
  for (let i = 0; i < u.n; i++) { const Q = E.pose(E.fire[i] + TAU); overlap += Q.lift[i][0] > 0 && Q.lift[i][1] > 0; }
  ok(overlap === u.n, `${u.id}: inlet and exhaust overlap at the exhaust TDC in every cylinder`);

  // clearance: skirt bottom vs counterweight and master flange
  let skirt = Infinity, flange = -Infinity;
  for (let kk = 0; kk < 720; kk++) {
    const Q = E.pose(TAU * kk / 720);
    for (let i = 0; i < u.n; i++) {
      const sb = Q.s[i] - u.crown, ca = Q.C[0] * E.ax[i][0] + Q.C[1] * E.ax[i][1], cp = Q.C[0] * E.ax[i][1] - Q.C[1] * E.ax[i][0];
      const reach = Math.abs(cp) < flangeR(u) ? ca + Math.sqrt(flangeR(u) ** 2 - cp * cp) : -Infinity;
      skirt = Math.min(skirt, sb); flange = Math.max(flange, reach - sb);
    }
  }
  const cw = Math.min(...S.map(q => q.sBot)) - u.crown - CW_GAP;
  ok(cw > 2 * u.r - 20 && skirt > cw, `${u.id}: lowest skirt ${skirt.toFixed(1)} mm, counterweight radius ${cw.toFixed(1)} mm`);
  ok(flange < -10, `${u.id}: master flange stays ${(-flange).toFixed(1)} mm below the skirts`);
}
console.log(`${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
