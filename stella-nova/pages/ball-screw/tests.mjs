// ============================================================================
//  BALL SCREW & LEAD SCREW  ·  tests.mjs — node stella-nova/pages/ball-screw/tests.mjs
// ----------------------------------------------------------------------------
//  Checks mech.js:
//    thread ...... the surfaces close on themselves after one turn; the
//                  ACME flank angle is 14.5 degrees and the depth p/2; the
//                  nut follows the screw (the gap at a fixed nut point does
//                  not change with theta when the nut is at -L theta/2pi);
//                  the axial section gap from nut to screw is >= CLR
//    travel ...... travel = lead x turns; the stroke is STROKE mm and the
//                  screw angle changes at the drive rate
//    efficiency .. the closed forms match a force balance on the flank
//                  (normal force and friction along the helix); the
//                  self-locking angle; the drive efficiency peaks near
//                  45 - phi'/2; the ACME 20x4 locks, the 4-start and the
//                  ball screw back-drive; torque x speed = power
//    balls ....... the loop closes, the balls stay on the screw groove at
//                  every theta, no two balls overlap, the tube clears the
//                  screw, and the ball rate k/2 solves the no-slip
//                  equations at the two contacts
// ============================================================================
import { UNITS, unit, screw, screwR, nutR, screwProfile, nutProfile, effLead, effBall, eff, lockAngle, torques, stroke, psiMid, circuit, ballAt, ballShift, TAU, DEG, ALPHA, MU_SLIDE, MU_ROLL, STROKE, CLR, CONTACT } from './mech.js';

let fail = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fail++; console.log('FAIL', msg); } else if (process.argv.includes('-v')) console.log('ok  ', msg); };
const near = (a, b, e) => Math.abs(a - b) <= e;

// ── thread ──────────────────────────────────────────────────────────────────
for (const u of UNITS) for (const L of u.leads) {
  const g = screw(u, L), tag = `${u.id} L${L}`;
  ok(near(g.n * g.p, L, 1e-12) && Number.isInteger(g.n), `${tag}: n p = L (${g.n} x ${g.p})`);
  let worst = 0;
  for (let i = 0; i < 200; i++) { const y = -50 + i * 0.5, ph = i * 0.37; worst = Math.max(worst, Math.abs(screwR(g, y, ph) - screwR(g, y, ph + TAU)), Math.abs(nutR(g, y, ph) - nutR(g, y, ph + TAU))); }
  ok(worst < 1e-9, `${tag}: surfaces close after one turn (${worst.toExponential(1)})`);
  // the nut follows the screw: gap at a fixed nut point does not depend on theta
  let drift = 0;
  for (const th of [0, 0.7, 3.1, 11.4, -5.2]) {
    const xn = -L * th / TAU;
    for (let i = 0; i < 60; i++) {
      const yn = -10 + i * 0.37, ph = i * 0.61;
      const gap = nutR(g, yn, ph) - screwR(g, xn + yn, ph - th);
      const gap0 = nutR(g, yn, ph) - screwR(g, yn, ph);
      drift = Math.max(drift, Math.abs(gap - gap0));
    }
  }
  ok(drift < 1e-9, `${tag}: nut at -L theta/2pi stays on the thread (${drift.toExponential(1)})`);
  // axial section clearance: nut profile points to the screw profile polyline
  const sp = [], np = [];
  for (let i = 0; i <= 4000; i++) { const s = i / 4000 * 3 - 1, f = x => x - Math.floor(x); sp.push([s * g.p, screwProfile(g, f(s))]); np.push([s * g.p, nutProfile(g, f(s))]); }
  let dmin = Infinity, above = true;
  for (let i = 1333; i <= 2666; i++) {
    const [x, r] = np[i];
    if (r <= sp[i][1]) above = false;
    for (let j = 1; j < sp.length; j++) {
      const [ax, ay] = sp[j - 1], [bx, by] = sp[j], dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (r - ay) * dy) / (dx * dx + dy * dy || 1)));
      if (Math.abs(ax - x) > 4) continue;
      dmin = Math.min(dmin, Math.hypot(x - ax - t * dx, r - ay - t * dy));
    }
  }
  const want = g.type === 'lead' ? CLR : 0.3 * g.Db;
  ok(above && dmin >= want - 0.01, `${tag}: nut clears the screw, min gap ${dmin.toFixed(3)} mm (want ${want.toFixed(3)})`);
}
{
  const g = screw(unit('acme'));
  const [, a, b] = g.knots, flank = Math.atan2((b[0] - a[0]) * g.p, b[1] - a[1]);
  ok(near(flank, ALPHA, 1e-12) && near(g.rMaj - g.rMin, g.p / 2, 1e-12), `acme: flank ${(flank / DEG).toFixed(2)}°, depth ${g.rMaj - g.rMin} mm`);
  ok(near(g.dm, 18, 1e-12) && near(g.lam / DEG, Math.atan(4 / (Math.PI * 18)) / DEG, 1e-12), `acme: dm 18 mm, lead angle ${(g.lam / DEG).toFixed(2)}°`);
}

// ── travel ──────────────────────────────────────────────────────────────────
for (const u of UNITS) {
  const g = screw(u);
  let xmin = Infinity, xmax = -Infinity, rate = 0;
  const P = 2 * TAU * STROKE / g.L, N = 20000;
  for (let i = 0; i <= N; i++) {
    const psi = i / N * P, S = stroke(g, psi);
    xmin = Math.min(xmin, S.x); xmax = Math.max(xmax, S.x);
    const h = 1e-4, d = (stroke(g, psi + h).theta - stroke(g, psi - h).theta) / (2 * h);
    if (Math.abs(Math.abs(d) - 1) > 1e-6 && Math.abs(Math.abs(d) - 0) > 1e-6) rate++;
    if (Math.abs(d) < 0.5) rate++;
  }
  ok(near(xmax - xmin, STROKE, 1e-3) && near(xmax + xmin, 0, 1e-3), `${u.id}: stroke ${(xmax - xmin).toFixed(3)} mm about 0`);
  ok(rate <= 3, `${u.id}: theta moves at the drive rate except at the turns (${rate})`);
  const a = stroke(g, psiMid(g)), b = stroke(g, psiMid(g) + 3 * TAU);
  ok(near(a.x, 0, 1e-9) && near(Math.abs(b.x - a.x), 3 * g.L, 1e-9), `${u.id}: 3 turns move the nut ${Math.abs(b.x - a.x)} mm = 3 x ${g.L}`);
}

// ── efficiency: a force balance on the flank ────────────────────────────────
// Basis (r, t, a) at the mean radius. The thread runs along tau = (0, cos l,
// sin l). The loaded flank line leans alpha from the radial plane toward -a,
// so its normal (out of the tooth) has + a. The nut moves +a; the screw
// surface moves -t; the nut slides on the screw along +tau.
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unitv = a => { const l = Math.hypot(...a); return a.map(x => x / l); };
function balance(lam, mu, alpha) {
  const tau = [0, Math.cos(lam), Math.sin(lam)], f = [Math.cos(alpha), 0, -Math.sin(alpha)];
  let nn = unitv(cross(tau, f)); if (nn[2] < 0) nn = nn.map(x => -x);
  const F = 1, rm = 1, tl = Math.tan(lam);
  // drive: friction on the nut opposes its slide (+tau)
  const fd = nn.map((x, i) => x - mu * tau[i]), Nd = F / fd[2], Td = rm * Nd * Math.abs(fd[1]);
  // back-drive: the nut slides -tau, friction along +tau; out torque from t
  const fb = nn.map((x, i) => x + mu * tau[i]), Nb = F / fb[2], Tb = -rm * Nb * fb[1];
  return { fwd: F * rm * tl / Td, back: Tb / (F * rm * tl) };
}
{
  let worst = 0;
  for (const mu of [0.05, 0.12, 0.2]) for (let l = 1; l < 60; l += 1.7) {
    const A = effLead(l * DEG, mu), B = balance(l * DEG, mu, ALPHA);
    worst = Math.max(worst, Math.abs(A.fwd - B.fwd), Math.abs(A.back - B.back));
    const C = effBall(l * DEG, mu), Dd = balance(l * DEG, mu, 0);
    worst = Math.max(worst, Math.abs(C.fwd - Dd.fwd), Math.abs(C.back - Dd.back));
  }
  ok(worst < 1e-12, `efficiency: closed forms match the flank force balance (${worst.toExponential(1)})`);
  const lk = lockAngle(MU_SLIDE);
  ok(near(effLead(lk).back, 0, 1e-9) && effLead(lk - 0.01).back < 0 && effLead(lk + 0.01).back > 0, `self-locking below ${(lk / DEG).toFixed(2)}° at mu ${MU_SLIDE}`);
  ok(near(Math.cos(Math.atan(Math.tan(ALPHA) * Math.cos(lk))) * Math.tan(lk), MU_SLIDE, 1e-9), 'lock angle: cos an tan l = mu');
  // the peak of the drive efficiency (flat flank: 45 - phi/2, tan phi = mu)
  let best = 0, at = 0;
  for (let l = 0.01; l < 80; l += 0.01) { const e = effLead(l * DEG, MU_SLIDE, 0).fwd; if (e > best) { best = e; at = l; } }
  ok(near(at, 45 - Math.atan(MU_SLIDE) / DEG / 2, 0.02), `peak drive efficiency at ${at.toFixed(2)}° (45 - phi/2 = ${(45 - Math.atan(MU_SLIDE) / DEG / 2).toFixed(2)}°)`);
  const a = torques(screw(unit('acme')), 1000), b = torques(screw(unit('acme4')), 1000), c = torques(screw(unit('ball')), 1000);
  ok(a.locks && !b.locks && !c.locks, `acme 20x4 locks (eta' ${a.E.back.toFixed(3)}), 4-start (${b.E.back.toFixed(3)}) and ball (${c.E.back.toFixed(3)}) back-drive`);
  ok(a.E.fwd > 0.3 && a.E.fwd < 0.4 && c.E.fwd > 0.95, `drive efficiency: acme ${a.E.fwd.toFixed(3)}, 4-start ${b.E.fwd.toFixed(3)}, ball ${c.E.fwd.toFixed(3)}`);
  // power: T w = F v / eta, v = L w / 2 pi
  const g = screw(unit('ball')), T = torques(g, 2000), w = 10, v = g.L / 1000 * w / TAU;
  ok(near(T.drive * w, 2000 * v / T.E.fwd, 1e-9) && near(T.back * w, 2000 * v * T.E.back, 1e-9), `power balance: ${(T.drive * w).toFixed(3)} W in, ${(2000 * v).toFixed(3)} W out`);
  // a positive back torque: the screw is driven by the load
  ok(a.back < 0 && c.back > 0, `back torque at 1 kN: acme ${a.back.toFixed(3)} N m (must push), ball ${c.back.toFixed(3)} N m (must brake)`);
}

// ── balls ───────────────────────────────────────────────────────────────────
for (const L of unit('ball').leads) {
  const g = screw(unit('ball'), L), C = circuit(g, 18, 5), tag = `ball L${L}`;
  let jump = 0, prev = ballAt(g, C, 0);
  for (let i = 1; i <= 4000; i++) { const q = ballAt(g, C, i / 4000 * C.total); jump = Math.max(jump, Math.hypot(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2])); prev = q; }
  ok(jump < 0.2 * g.Db, `${tag}: the loop is continuous (max step ${jump.toFixed(3)} mm)`);
  // every groove ball sits on the screw groove centre for any theta
  let off = 0;
  for (const th of [0, 1.3, 7.7, -4.4]) {
    const xn = -g.L * th / TAU, sh = ballShift(g, C, th);
    for (let i = 0; i < C.nb; i++) {
      const u = ((i * C.sp + sh) % C.total + C.total) % C.total;
      if (u >= C.Lg) continue;
      const [X, Y, Z] = ballAt(g, C, u), r = Math.hypot(X, Z), ph = Math.atan2(-Z, X);
      const s = ((xn + Y - g.L * (ph - th) / TAU) / g.p) % 1, sw = ((s % 1) + 1) % 1;
      off = Math.max(off, Math.abs(r - g.Rbc), Math.abs(sw - 0.5) * g.p);
    }
  }
  ok(off < 1e-9, `${tag}: balls on the screw groove at every theta (${off.toExponential(1)} mm)`);
  let dmin = Infinity;
  const pts = Array.from({ length: C.nb }, (_, i) => ballAt(g, C, i * C.sp + 0.37));
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) dmin = Math.min(dmin, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1], pts[i][2] - pts[j][2]));
  ok(dmin >= g.Db, `${tag}: ${C.nb} balls, none overlap (min centre gap ${dmin.toFixed(3)} >= Db ${g.Db.toFixed(3)})`);
  // the rendered tube (centre radius >= bore + rt + 0.5) clears the screw
  let tmin = Infinity;
  for (const p of C.tube) { const r = Math.hypot(p[0], p[2]); if (r >= g.rBore + C.rt + 0.5) tmin = Math.min(tmin, r - C.rt); }
  ok(tmin >= g.rOut + 0.3, `${tag}: tube wall clears the screw (${tmin.toFixed(2)} mm vs land ${g.rOut.toFixed(2)})`);
  // rolling: ball centre speed v and spin W at the inner (screw) and outer
  // (nut) contacts, lever (Db/2) cos(contact): solve and compare to k/2
  const e = g.Db / 2 * Math.cos(CONTACT), w = 1, rin = g.Rbc - e;
  // v + W e = 0 (nut), v - W e = w rin (screw)
  const v = w * rin / 2, Wb = -v / e;
  ok(near(v - Wb * e, w * rin, 1e-12) && near(v / g.Rbc, w * g.k / 2, 1e-12), `${tag}: ball centre turns at ${(v / g.Rbc).toFixed(4)} of the screw (k/2)`);
}

console.log(`${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
