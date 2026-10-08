// ============================================================================
//  GALAXY  ·  tests.mjs — node stella-nova/pages/galaxy/tests.mjs
// ----------------------------------------------------------------------------
//  Checks the pure modules (model.js, budget.js, camera.js, saverplan.js):
//    sersic ....... the surface profile integrates to sersicTotal; r_e holds
//                   half the light; the volume profile to sersicRhoTotal
//    disk ......... the exponential disk integrates to 4 pi rho0 Rd^2 hz;
//                   1.678 Rd holds half the light
//    spiral ....... arm points follow r = a e^(b theta), b = tan(pitch);
//                   the arm meets each circle at the pitch angle; the
//                   pattern turns rigidly (no winding)
//    rotation ..... v(R) is flat past the turnover radius
//    colour ....... blackbody blue/red rises with temperature
//    presets ...... every preset and type builds, with finite numbers
//    saver ........ shots last 5-12 s, the order changes with the seed
//    budget ....... every display fits the GPU memory limit
// ============================================================================
import * as M from './model.js';
import * as B from './budget.js';
import * as C from './camera.js';

let fail = 0, n = 0;
const ok = (c, msg) => { n++; console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fail++; };
const rel = (a, b) => Math.abs(a / b - 1);

// ── Sersic ──
for (const nn of [1, 2, 4]) {
  const re = 1.3, Ie = 2;
  let tot = 0, half = 0;
  // integrate in u = ln R so the cusp and the long tail both resolve
  const N = 40000, u0 = Math.log(1e-6), u1 = Math.log(re * 4000);
  for (let i = 0; i < N; i++) {
    const u = u0 + (u1 - u0) * (i + 0.5) / N, R = Math.exp(u), du = (u1 - u0) / N;
    const f = M.sersicI(R, Ie, re, nn) * 2 * Math.PI * R * R * du;
    tot += f; if (R < re) half += f;
  }
  const want = M.sersicTotal(Ie, re, nn);
  ok(rel(tot, want) < 1e-3, `sersic n=${nn}: integral ${tot.toFixed(4)} vs total ${want.toFixed(4)}`);
  ok(Math.abs(half / tot - 0.5) < 2e-3, `sersic n=${nn}: r_e holds ${(100 * half / tot).toFixed(2)} % of the light`);
  let vt = 0;
  for (let i = 0; i < N; i++) {
    const u = u0 + (u1 - u0) * (i + 0.5) / N, r = Math.exp(u), du = (u1 - u0) / N;
    vt += M.sersicRho(r, 1, re, nn) * 4 * Math.PI * r ** 3 * du;
  }
  const vw = M.sersicRhoTotal(1, re, nn);
  ok(rel(vt, vw) < 1e-3, `sersic volume n=${nn}: integral ${vt.toFixed(4)} vs ${vw.toFixed(4)}`);
}
ok(rel(M.gammaFn(5), 24) < 1e-12 && rel(M.gammaFn(0.5), Math.sqrt(Math.PI)) < 1e-12, 'gamma: 4! and sqrt(pi)');

// ── exponential disk ──
{
  const rho0 = 0.7, Rd = 3, hz = 0.3;
  let tot = 0, inner = 0;
  const NR = 3000, NZ = 400, Rm = 40 * Rd, Zm = 30 * hz;
  for (let i = 0; i < NR; i++) {
    const R = (i + 0.5) * Rm / NR;
    let col = 0;
    for (let j = 0; j < NZ; j++) { const z = -Zm + (j + 0.5) * 2 * Zm / NZ; col += M.diskRho(R, z, rho0, Rd, hz) * 2 * Zm / NZ; }
    const f = col * 2 * Math.PI * R * Rm / NR;
    tot += f; if (R < 1.678 * Rd) inner += f;
  }
  const want = M.diskTotal(rho0, Rd, hz);
  ok(rel(tot, want) < 2e-3, `disk: integral ${tot.toFixed(4)} vs 4 pi rho0 Rd^2 hz = ${want.toFixed(4)}`);
  ok(Math.abs(inner / tot - 0.5) < 3e-3, `disk: 1.678 Rd holds ${(100 * inner / tot).toFixed(2)} % of the light`);
}

// ── log spiral ──
for (const pitch of [10, 18, 30]) {
  const R0 = 1.5, b = Math.tan(pitch * Math.PI / 180);
  let worst = 0, worstAng = 0;
  for (let R = 2; R < 20; R += 0.5) {
    const th = -M.armAzimuth(R, R0, pitch);       // angle against rotation
    worst = Math.max(worst, rel(M.spiralRadius(th, R0, pitch), R));
    // pitch: tan(psi) = dR / (R dtheta)
    const h = 1e-4, dth = -(M.armAzimuth(R + h, R0, pitch) - M.armAzimuth(R - h, R0, pitch)) / (2 * h);
    worstAng = Math.max(worstAng, Math.abs(Math.atan(1 / (R * dth)) * 180 / Math.PI - pitch));
  }
  ok(worst < 1e-9 && worstAng < 1e-4, `spiral pitch ${pitch}: r = a e^(b theta) with b = ${b.toFixed(3)} (err ${worst.toExponential(1)}), angle err ${worstAng.toExponential(1)} deg`);
}
{
  const t = 333, Om = 0.021;
  const shifts = [2, 5, 9, 15].map(R => M.armAzimuth(R, 1.5, 15, 0, 2, Om * t) - M.armAzimuth(R, 1.5, 15, 0, 2, 0));
  ok(shifts.every(s => Math.abs(s - Om * t) < 1e-9), `pattern: every radius turns by Omega_p t = ${(Om * t).toFixed(3)} rad (no winding)`);
}

// ── rotation curve ──
{
  const vf = 220, Rt = 1.4;
  let flat = true, lines = [];
  for (const R of [4, 6, 10, 20, 40].map(k => k * Rt)) {
    const h = 1e-4, slope = (Math.log(M.vcirc(R * (1 + h), vf, Rt)) - Math.log(M.vcirc(R * (1 - h), vf, Rt))) / (2 * h);
    if (!(slope < 0.06 && rel(M.vcirc(R, vf, Rt), vf) < 0.031)) flat = false;
    lines.push(`${(R / Rt).toFixed(0)}Rt ${slope.toFixed(3)}`);
  }
  ok(flat, `rotation: d ln v / d ln R < 0.06 and v within 3.1 % of v_flat past 4 R_t (${lines.join(', ')})`);
  ok(rel(M.omega(10, vf, Rt) * 10 / M.KMS_KPC, M.vcirc(10, vf, Rt)) < 1e-12, 'rotation: Omega R = v');
}

// ── colour ──
{
  let mono = true, prev = -1;
  for (let T = 2500; T <= 40000; T *= 1.05) { const c = M.blackbodyRGB(T), q = c[2] / c[0]; if (!(q > prev)) mono = false; prev = q; }
  const sun = M.blackbodyRGB(5800);
  ok(mono, 'colour: blue/red of the blackbody rises with T from 2500 K to 40000 K');
  ok(M.blackbodyRGB(3000)[0] === 1 && M.blackbodyRGB(20000)[2] === 1 && sun[1] > 0.85, `colour: 3000 K red-led, 20000 K blue-led, 5800 K near white (${sun.map(v => v.toFixed(2)).join(' ')})`);
}

// ── presets and types ──
{
  const finite = b => b.stars.every(Number.isFinite) && b.gals.every(Number.isFinite);
  for (const p of M.PRESETS) {
    const b = M.buildGalaxy(M.presetParams(p.key), { stars: 20000 });
    ok(finite(b) && b.count > 15000 && b.gals.length === M.GAL_FLOATS * 2, `preset ${p.key}: ${b.count} stars, ${b.nGal} galaxy block(s), finite`);
  }
  for (const t of M.TYPES) {
    const b = M.buildGalaxy(M.randomParams(t.key, 42), { stars: 12000 });
    ok(finite(b) && b.count > 8000, `type ${t.key}: builds (${b.count} stars)`);
  }
  // the volume emission integrates to the unresolved light of the disk
  const P = M.presetParams('m51'), g = M.packGalaxy({ P, rot: M.frameFromNormal([0, 0, 1]), centre: [0, 0, 0], L: 1 });
  const Cm = M.components(P, 1), rhoD = g[5 * 4] * 4 * Math.PI;
  ok(rel(M.diskTotal(rhoD, P.Rd, P.hz), Cm.Lthin * (1 - M.RESOLVED.disk)) < 1e-6, 'pack: the thin disk rho0 gives its unresolved light');
}

// ── saver plan ──
{
  const S = await import('./saverplan.js');
  let inRange = true, lo = 99, hi = 0;
  for (const calm of [0, 0.5, 1]) {
    const plan = S.makePlan(7, calm);
    for (let i = 0; i < 60; i++) { const s = plan.next(); lo = Math.min(lo, s.dur); hi = Math.max(hi, s.dur); if (!(s.dur >= 5 && s.dur <= 12)) inRange = false; }
  }
  ok(inRange, `saver: 180 shots last ${lo.toFixed(1)}-${hi.toFixed(1)} s (5-12 s)`);
  const a = S.makePlan(1, 0.7), b = S.makePlan(2, 0.7);
  const ka = Array.from({ length: 8 }, () => a.next().key).join(), kb = Array.from({ length: 8 }, () => b.next().key).join();
  ok(ka !== kb, 'saver: two seeds give two orders');
  const p = S.makePlan(3, 0.7); let rep = false, last = '';
  for (let i = 0; i < 80; i++) { const s = p.next(); if (s.subject === last) rep = true; last = s.subject; }
  ok(!rep, 'saver: no subject twice in a row');
  const kinds = new Set(); const q = S.makePlan(4, 0.7); for (let i = 0; i < 40; i++) kinds.add(q.next().kind);
  ok(['orbit', 'dive', 'bulge', 'pair'].every(k => kinds.has(k)), `saver: 40 shots hold ${[...kinds].join(', ')}`);
  // the dive ends inside the disk: close in and level
  const dv = S.shotCamera({ kind: 'dive', yaw0: 0, spin: 0.1, incl: 50 }, 1, { R: 15, Rd: 3, fit: 40 });
  ok(dv.dist < 15 && Math.abs(dv.pitch) < 0.1, `saver: the dive ends at ${dv.dist.toFixed(1)} kpc, pitch ${(dv.pitch / C.DEG).toFixed(1)} deg`);
}

// ── camera ──
{
  let good = true;
  for (const pitch of [-1.2, 0, 0.7, Math.PI / 2]) {
    const b = C.basis({ target: [1, 2, 3], yaw: 0.4, pitch, dist: 10 });
    const d = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    if (Math.abs(d(b.fwd, b.right)) > 1e-12 || Math.abs(d(b.fwd, b.up)) > 1e-12 || Math.abs(d(b.up, b.up) - 1) > 1e-12) good = false;
  }
  ok(good, 'camera: orthonormal basis at every pitch, face-on included');
}

// ── budget ──
{
  const screens = [[1280, 800, 1, false], [1440, 900, 2, false], [2560, 1440, 2, false], [5120, 2880, 2, false], [3840, 2160, 1.5, false], [390, 844, 3, true], [430, 932, 3, true], [844, 390, 3, true], [1024, 1366, 2, true]];
  for (const [w, h, d, ph] of screens) for (const q of ['low', 'medium', 'high']) {
    const b = B.galaxyBudget(w, h, d, { phone: ph, quality: q });
    if (!(b.total <= b.limit)) ok(false, `budget ${w}x${h}@${d} ${q}: ${(b.total / 1e6).toFixed(1)} MB > ${(b.limit / 1e6)} MB`);
  }
  const big = B.galaxyBudget(5120, 2880, 2, { quality: 'high' }), ph = B.galaxyBudget(430, 932, 3, { phone: true });
  ok(true, `budget: 27 screen x quality cases fit; 5K at DPR 2 renders ${big.w}x${big.h} in ${(big.total / 1e6).toFixed(0)} MB; phone ${ph.w}x${ph.h}, ${ph.stars} stars, ${ph.steps} steps, ${(ph.total / 1e6).toFixed(0)} MB`);
  const old = 5120 * 2 * 2880 * 2 * (8 + 8 * 4 + 12);
  ok(big.total < old / 3, `budget: 5K is ${(big.total / 1e6).toFixed(0)} MB, not the ${(old / 1e6).toFixed(0)} MB of full-DPR 4x MSAA HalfFloat`);
}

console.log(`\n${n - fail}/${n} passed`);
if (fail) process.exit(1);
