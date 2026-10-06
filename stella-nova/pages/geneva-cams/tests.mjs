// ============================================================================
//  GENEVA DRIVE & CAMS  ·  tests.mjs — node stella-nova/pages/geneva-cams/tests.mjs
// ----------------------------------------------------------------------------
//  Checks mech.js:
//    geneva ....... r^2 + R2^2 = a^2 (the pin meets the slot at a right
//                   angle); the pin enters along the slot axis (no side
//                   velocity); while engaged the pin stays on the slot axis,
//                   between the slot bottom and the rim; the star turns
//                   2 pi / n per driver turn, with no jump; the dwell share
//                   is 1 - (n - 2) / (2 n); omega matches a finite step
//    clearance .... no star point enters the pin or the locking disc, at
//                   any driver angle; in the dwell a concave arc of the star
//                   is centred on the driver, clr from the disc
//    cam .......... s, ds are continuous at the segment ends, the roller
//                   touches the profile at every angle (nearest point at
//                   Rr), and the pressure angle stays under 30 degrees
// ============================================================================
import { UNITS, geneva, genevaPose, camLaw, camProfile, camPose, TAU } from './mech.js';

let fail = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fail++; console.log('FAIL', msg); } };
const near = (a, b, e) => Math.abs(a - b) <= e;
const rot = ([x, y], t) => [x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t)];
function inside(pt, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

for (const u of UNITS.filter(q => q.n)) {
  const G = geneva(u), tag = u.id;
  ok(near(G.r * G.r + G.R2 * G.R2, G.a * G.a, 1e-9), `${tag}: right angle at entry`);
  ok(G.star.every(p => Math.hypot(...p) <= G.R2 + 1e-6), `${tag}: star inside its tip circle`);
  ok(near(G.dwell, 1 - (G.n - 2) / (2 * G.n), 1e-12), `${tag}: dwell share ${G.dwell}`);
  // entry: the pin velocity is along the slot axis
  {
    const th = Math.PI - G.alpha0, P = genevaPose(G, th + 1e-9).pin, v = [-Math.sin(th), Math.cos(th)];
    const ax = [P[0] / G.R2, P[1] / G.R2];
    ok(near(Math.hypot(...P), G.R2, 1e-6) && near(Math.abs(v[0] * -ax[1] + v[1] * ax[0]), 0, 1e-6), `${tag}: pin enters along the slot`);
  }
  // pin on the active slot axis, between the bottom and the rim
  let worst = 0, jump = 0, prev = null, depthOk = true;
  for (let i = 0; i <= 3 * 3600; i++) {
    const th = i / 3600 * TAU, Q = genevaPose(G, th);
    if (prev !== null) jump = Math.max(jump, Math.abs(Q.psi - prev));
    prev = Q.psi;
    if (!Q.engaged) continue;
    const sp = rot(Q.pin, -Q.psi);                   // pin in the star frame
    let best = Infinity, bestAlong = 0;
    for (let j = 0; j < G.n; j++) {
      const s = Math.PI / G.n + TAU * j / G.n, lat = -sp[0] * Math.sin(s) + sp[1] * Math.cos(s), along = sp[0] * Math.cos(s) + sp[1] * Math.sin(s);
      if (along > 0 && Math.abs(lat) < Math.abs(best)) { best = lat; bestAlong = along; }
    }
    if (bestAlong < G.rb - 1e-6 || bestAlong > G.R2 + 1e-6) depthOk = false;
    worst = Math.max(worst, Math.abs(best));
  }
  ok(worst < 1e-6, `${tag}: pin on the slot axis (worst ${worst.toExponential(2)} mm)`);
  ok(depthOk, `${tag}: pin between the slot bottom and the rim`);
  ok(jump < 0.01, `${tag}: no jump in the star angle (max step ${jump.toFixed(4)} rad)`);
  ok(near(genevaPose(G, 0.3 + TAU).psi - genevaPose(G, 0.3).psi, -TAU / G.n, 1e-9), `${tag}: one step per turn`);
  {
    const th = Math.PI + 0.2, h = 1e-6, fd = (genevaPose(G, th + h).psi - genevaPose(G, th - h).psi) / (2 * h);
    ok(near(fd, genevaPose(G, th).omega, 1e-5), `${tag}: omega ${genevaPose(G, th).omega.toFixed(5)} vs ${fd.toFixed(5)}`);
  }
  // clearance: star points never inside the pin or the locking disc
  let hitPin = 0, hitLock = 0;
  for (let i = 0; i < 1440; i++) {
    const th = i / 1440 * TAU, Q = genevaPose(G, th);
    const lockW = G.lock.map(p => { const q = rot(p, th); return [q[0] + G.a, q[1]]; });
    for (const p of G.star) {
      const w = rot(p, Q.psi);
      if (Math.hypot(w[0] - Q.pin[0], w[1] - Q.pin[1]) < G.pinR - 1e-3) hitPin++;
      if (inside(w, lockW)) hitLock++;
    }
  }
  ok(hitPin === 0, `${tag}: star clear of the pin (${hitPin} hits)`);
  ok(hitLock === 0, `${tag}: star clear of the locking disc (${hitLock} hits)`);
  // dwell: a concave arc centre sits on the driver centre
  {
    const Q = genevaPose(G, 0.1);
    const d = Math.min(...Array.from({ length: G.n }, (_, j) => { const c = rot([G.a * Math.cos(TAU * j / G.n), G.a * Math.sin(TAU * j / G.n)], Q.psi); return Math.hypot(c[0] - G.a, c[1]); }));
    ok(!Q.engaged && d < 1e-9 && near(G.rho - G.Rl, u.clr, 1e-12), `${tag}: locked in the dwell`);
  }
}

// cam
{
  const c = UNITS.find(q => q.id === 'cam'), D = Math.PI / 180;
  for (const e of [c.B1, c.B1 + c.D1, c.B1 + c.D1 + c.B2, 360]) {
    const a = camLaw(c, e * D - 1e-7), b = camLaw(c, e * D + 1e-7);
    ok(near(a.s, b.s, 1e-4) && near(a.v, b.v, 1e-3), `cam: continuous at ${e}°`);
  }
  const prof = camProfile(c, 1440);
  let worst = 0, inter = 0;
  for (let i = 0; i < 360; i++) {
    const th = i * D, P = camPose(c, th);
    let m = Infinity;
    for (const p of prof) { const w = rot(p, th); m = Math.min(m, Math.hypot(w[0] - P.x, w[1])); }
    worst = Math.max(worst, Math.abs(m - c.Rr));
    if (m < c.Rr - 0.05) inter++;
  }
  ok(worst < 0.05, `cam: roller touches the profile (worst ${worst.toFixed(4)} mm)`);
  ok(inter === 0, 'cam: no interference');
  let pmax = 0; for (let i = 0; i < 3600; i++) pmax = Math.max(pmax, Math.abs(camPose(c, i / 10 * D).press));
  ok(pmax < 30 * D, `cam: pressure angle max ${(pmax / D).toFixed(1)}°`);
}

console.log(`${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
