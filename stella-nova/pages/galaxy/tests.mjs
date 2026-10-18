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
//    budget ....... every display fits the GPU memory limit; phones and
//                   tablets start at a lower level and stay small
//    encounter .... half floats round-trip; the record passes, swings out
//                   and merges; the phase follows the measured separation;
//                   the CPU mirror hits the keyframes
//    director ..... through a whole encounter (16:9 and 9:16): the view
//                   holds >= 80 % of the action weight, the camera steps
//                   stay small (no shake, no cut), it moves in at
//                   pericentre and pulls back for the tails (the tails
//                   shot holds >= 75 % of the test stars alone), it never
//                   zooms under MIN_R; the brightness hint sets the gain
//    saver pair ... each phase shot fits the run; in the plate band, at
//                   16:9 and 9:16, the view holds >= 80 % of the action
//    action cam ... update(sample) equals follow(measure(sample))
// ============================================================================
import * as M from './model.js';
import * as B from './budget.js';
import * as C from './camera.js';
import * as EN from './encounter.js';
import * as D from './director.js';
import { createActionCamera, actionWeights } from '../../lib/action-camera.js';
import { pairShot } from './saver.js';

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
  // the engine writes Omega_p t at OFF.phase: it must be arms2.y, the
  // float after the arm sharpness (a wrong offset froze the arms and broke the bar)
  ok(g[M.OFF.phase - 1] === Math.fround(P.sharp) && g[M.OFF.phase] === 0 && g[M.OFF.phase + 1] === Math.fround(P.flocc), `pack: OFF.phase = ${M.OFF.phase} is arms2.y`);
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
  // [w, h, dpr, profile]: d desktop, p phone, t tablet (coarse, not a phone)
  const screens = [[1280, 800, 1, 'd'], [1440, 900, 2, 'd'], [2560, 1440, 2, 'd'], [5120, 2880, 2, 'd'], [3840, 2160, 1.5, 'd'], [360, 640, 3, 'p'], [390, 844, 3, 'p'], [430, 932, 3, 'p'], [844, 390, 3, 'p'], [640, 360, 3, 'p'], [1024, 1366, 2, 't'], [1366, 1024, 2, 't'], [820, 1180, 2, 't']];
  let cases = 0;
  for (const [w, h, d, pf] of screens) for (const q of ['low', 'medium', 'high']) {
    const b = B.galaxyBudget(w, h, d, { phone: pf === 'p', tablet: pf === 't', quality: q }); cases++;
    if (!(b.total <= b.limit)) ok(false, `budget ${w}x${h}@${d} ${q}: ${(b.total / 1e6).toFixed(1)} MB > ${(b.limit / 1e6)} MB`);
  }
  const big = B.galaxyBudget(5120, 2880, 2, { quality: 'high' }), ph = B.galaxyBudget(430, 932, 3, { phone: true });
  ok(B.defaultQuality({ phone: true }) === 'low' && B.defaultQuality({ tablet: true }) === 'medium' && B.defaultQuality({}) === 'high', 'budget: start quality is low on a phone, medium on a tablet, high on a desktop');
  for (const [w, h] of [[360, 640], [390, 844], [844, 390]]) {
    const b = B.galaxyBudget(w, h, 3, { phone: true });
    ok(b.pr <= 1 && b.stars <= 45000 && b.total <= 40e6, `budget: phone ${w}x${h}@3 draws at DPR ${b.pr}, ${b.stars} stars, ${(b.total / 1e6).toFixed(0)} MB (DPR <= 1, <= 45k stars, <= 40 MB)`);
  }
  const ipad = B.galaxyBudget(1024, 1366, 2, { tablet: true }), ipadH = B.galaxyBudget(1024, 1366, 2, { tablet: true, quality: 'high' });
  ok(ipad.stars === B.QUALITY.medium.stars && ipad.total <= B.LIMITS.tablet.bytes && ipadH.w * ipadH.h <= B.LIMITS.tablet.maxPx, `budget: iPad 1024x1366@2 starts at medium, ${ipad.w}x${ipad.h} in ${(ipad.total / 1e6).toFixed(0)} MB; high stays at ${ipadH.w}x${ipadH.h} in ${(ipadH.total / 1e6).toFixed(0)} MB`);
  ok(true, `budget: ${cases} screen x quality cases fit; 5K at DPR 2 renders ${big.w}x${big.h} in ${(big.total / 1e6).toFixed(0)} MB; phone ${ph.w}x${ph.h}, ${ph.stars} stars, ${ph.steps} steps, ${(ph.total / 1e6).toFixed(0)} MB`);
  const old = 5120 * 2 * 2880 * 2 * (8 + 8 * 4 + 12);
  ok(big.total < old / 3, `budget: 5K is ${(big.total / 1e6).toFixed(0)} MB, not the ${(old / 1e6).toFixed(0)} MB of full-DPR 4x MSAA HalfFloat`);
}


// ── encounter ──
const encBuilt = M.buildGalaxy(M.presetParams('antennae'), { stars: 40000 }), enc = encBuilt.enc;
{
  let worst = 0;
  for (const v of [0, 1e-3, 0.37, -2.5, 17.123, -63.9, 118.7, 1024.5, 60000]) worst = Math.max(worst, Math.abs(M.fromHalf(M.toHalf(v)) - v) / Math.max(1, Math.abs(v)));
  ok(worst < 1e-3, `encounter: half floats round-trip to ${worst.toExponential(1)} (relative, 1 kpc floor)`);
  ok(enc && enc.track.length === enc.K * enc.n * 2 && encBuilt.stars.every(Number.isFinite), `encounter: the pair records ${enc.K} keyframes of ${enc.n} test stars (${(enc.track.byteLength / 1e6).toFixed(1)} MB), ${enc.tEnd.toFixed(0)} Myr`);
  const s0 = enc.sep[0], minSep = Math.min(...enc.sep), last = enc.sep[enc.NC - 1];
  ok(enc.peri.length >= 2 && enc.peri[0] < enc.tMerge && enc.tMerge < enc.tEnd && last < 0.35 * enc.UL && s0 > 3 * enc.sepPeri,
    `encounter: starts ${s0.toFixed(1)} kpc apart, first pericentre ${enc.sepPeri.toFixed(1)} kpc at ${enc.peri[0].toFixed(0)} Myr, second at ${enc.peri[1].toFixed(0)} Myr, merged at ${enc.tMerge.toFixed(0)} Myr, ends ${last.toFixed(1)} kpc apart (min ${minSep.toFixed(2)})`);
  // the CPU mirror hits the keyframes, and the curve is continuous
  let keyErr = 0, jump = 0;
  for (const k of [0, 9, 64, enc.K - 1]) for (const i of [0, 77, enc.n - 1]) {
    const p = EN.starAt(enc, i, k * enc.dtK), q = enc.track[(k * enc.n + i) * 2];
    keyErr = Math.max(keyErr, Math.abs(p[0] - M.fromHalf(q & 0xffff)), Math.abs(p[1] - M.fromHalf(q >>> 16)));
  }
  for (let t = 0; t < enc.tEnd; t += 0.5) { const a = EN.coresAt(enc, t), b = EN.coresAt(enc, t + 0.5); jump = Math.max(jump, Math.hypot(b[0][0] - a[0][0], b[0][1] - a[0][1], b[0][2] - a[0][2])); }
  ok(keyErr < 1e-9 && jump < 0.5, `encounter: the mirror hits the keyframes (err ${keyErr.toExponential(1)}); a core moves at most ${jump.toFixed(3)} kpc per 0.5 Myr`);
  // the phase follows the separation and the events
  let order = [], bad = 0;
  for (let t = 0; t <= enc.tEnd; t += 2) {
    const ph = EN.phaseAt(enc, t);
    if (order[order.length - 1] !== ph.phase) order.push(ph.phase);
    const want = t >= enc.tMerge ? 'merger' : ph.sep < 1.6 * enc.sepPeri ? 'peri' : t > enc.peri[0] ? 'tails' : 'approach';
    if (want !== ph.phase) bad++;
  }
  ok(bad === 0 && order.join() === 'approach,peri,tails,peri,merger', `encounter: phases by separation ${order.join(' > ')} (${bad} mismatches)`);
}

// ── director: a whole encounter at 60 fps ──
const runs = {};
for (const [name, aspect] of [['16:9', 16 / 9], ['9:16', 9 / 16]]) {
  const d = D.createDirector({ fov: 40 }), dt = 1 / 60, speed = 14;
  let prev = null, minShare = 1, minAt = 0, step = 0, zoom = 0, ang = 0, minR = 1e9, tailShare = 1;
  const rByPhase = {}, gainByPhase = {};
  for (let t = 0; t <= enc.tEnd; t += speed * dt) {
    const c = d.update({ enc, t, dt, aspect, viewPx: 2e6, nStars: encBuilt.count });
    const s = EN.sampleAt(enc, t, { count: 1000 });
    const aw = actionWeights(s), sh = D.viewShare(c, C.basis, s, aw, aspect);
    if (sh < minShare) { minShare = sh; minAt = t; }
    // the tidal material alone (the hosts out): the tails shot must hold it
    if (c.phase === 'tails' && c.weights.tails > 0.9) { aw[s.nStars] = aw[s.nStars + 1] = 0; tailShare = Math.min(tailShare, D.viewShare(c, C.basis, s, aw, aspect)); }
    if (prev) {
      step = Math.max(step, Math.hypot(c.target[0] - prev.target[0], c.target[1] - prev.target[1], c.target[2] - prev.target[2]) / c.dist);
      zoom = Math.max(zoom, Math.abs(Math.log(c.dist / prev.dist)));
      ang = Math.max(ang, Math.abs(c.pitch - prev.pitch), Math.abs(c.yaw - prev.yaw));
    }
    minR = Math.min(minR, c.radius);
    (rByPhase[c.phase] ||= []).push(c.radius); (gainByPhase[c.phase] ||= []).push(c.gain);
    prev = c;
  }
  const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
  runs[name] = { rByPhase, gainByPhase };
  ok(minShare >= 0.8, `director ${name}: the view holds >= ${minShare.toFixed(3)} of the action weight (min at ${minAt.toFixed(0)} Myr)`);
  ok(tailShare >= 0.75, `director ${name}: the tails shot holds >= ${tailShare.toFixed(3)} of the action weight of the test stars alone`);
  ok(step < 0.004 && zoom < 0.35 / 60 + 1e-6 && ang < 0.006, `director ${name}: per frame the target moves <= ${step.toFixed(4)} of the distance, log zoom <= ${zoom.toFixed(4)}, angles <= ${ang.toFixed(4)} rad (no shake, no cut)`);
  const r = Object.fromEntries(Object.entries(rByPhase).map(([k, v]) => [k, med(v)]));
  ok(r.peri < r.approach && r.peri < r.tails && r.merger < r.tails && minR >= D.MIN_R,
    `director ${name}: median radius approach ${r.approach.toFixed(1)}, peri ${r.peri.toFixed(1)}, tails ${r.tails.toFixed(1)}, merger ${r.merger.toFixed(1)} kpc; never under ${D.MIN_R} kpc (min ${minR.toFixed(1)})`);
}
{
  // the brightness hint sets the gain: a wide view of dense cores gets a
  // low gain (strong compression), a close view gets 1
  const ac = createActionCamera({ fill: D.FILL });
  const near = D.coreGain(ac.follow({ c: [0, 0, 0], r: 8, n: 1e5 }), { viewPx: 2e6, nStars: 1e5 });
  ac.reset();
  const far = D.coreGain(ac.follow({ c: [0, 0, 0], r: 60, n: 1e5 }), { viewPx: 2e6, nStars: 1e5 });
  const g = runs['16:9'].gainByPhase, mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  ok(near === 1 && far < 0.5 && mean(g.tails) < mean(g.peri), `director: the brightness hint gives gain ${near.toFixed(2)} at 8 kpc, ${far.toFixed(2)} at 60 kpc; mean gain peri ${mean(g.peri).toFixed(2)}, tails ${mean(g.tails).toFixed(2)}`);
}

// ── saver pair shots: plate band, 16:9 and 9:16 ──
{
  let worst = 1, worstAt = '', inRun = true, step = 0;
  for (const [name, aspect] of [['16:9', 16 / 9], ['9:16', 9 / 16]]) for (const phase of D.PHASES) for (const dur of [5, 12]) {
    const w = pairShot(enc, phase, dur);
    if (!(w.start >= 0 && w.start < enc.tEnd && w.rate >= 6 && w.rate <= 30)) inRun = false;
    const d = D.createDirector({ fov: 40 }), band = 0.55, dt = 1 / 30;
    d.snap({ side: phase === 'peri' ? -1 : 1, jitter: 0.3 });
    let prev = null;
    for (let el = 0, t = w.start; el < dur; el += dt, t = Math.min(enc.tEnd, t + w.rate * dt)) {
      const c = d.update({ enc, t, dt, aspect, band, yawRate: 0.05 });
      const s = EN.sampleAt(enc, t, { count: 600 });
      const sh = D.viewShare(c, C.basis, s, actionWeights(s), aspect, band);
      if (sh < worst) { worst = sh; worstAt = `${name} ${phase} ${dur} s at ${el.toFixed(1)} s`; }
      if (prev) step = Math.max(step, Math.hypot(c.target[0] - prev.target[0], c.target[1] - prev.target[1], c.target[2] - prev.target[2]) / c.dist);
      prev = c;
    }
  }
  ok(inRun, 'saver pair: every phase window starts inside the run at 6-30 Myr/s');
  ok(worst >= 0.8 && step < 0.01, `saver pair: in a 55 % band the view holds >= ${worst.toFixed(3)} of the action weight (${worstAt}); target step <= ${step.toFixed(4)} of the distance`);
  const plan = (await import('./saverplan.js')).makePlan(11, 0.7), phases = new Set();
  for (let i = 0; i < 42; i++) { const s = plan.next(); if (s.kind === 'pair') phases.add(s.phase); }
  ok(D.PHASES.every(p => phases.has(p)), `saver pair: two decks hold the phases ${[...phases].join(', ')}`);
}

// ── action camera: the two halves ──
{
  const a = createActionCamera(), b = createActionCamera();
  let worst = 0;
  for (let f = 0; f < 300; f++) {
    const s = EN.sampleAt(enc, f * 2, { count: 300 });
    const ga = a.update(s, 1 / 60), gb = b.follow(b.measure(s), 1 / 60);
    worst = Math.max(worst, Math.abs(ga.radius - gb.radius), ...ga.center.map((v, k) => Math.abs(v - gb.center[k])));
  }
  ok(worst === 0, `action camera: update equals follow(measure) over 300 frames (max difference ${worst})`);
}

console.log(`\n${n - fail}/${n} passed`);
if (fail) process.exit(1);
