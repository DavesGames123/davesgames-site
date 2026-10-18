// ============================================================================
//  PLANET COLLISION  ·  tests.mjs — checks of the EOS, the bodies, the CPU
//  solver and the GPU solver
// ----------------------------------------------------------------------------
//  node stella-nova/pages/planet-collision/tests.mjs         CPU tests, then
//                                                            the GPU tests in Deno
//  deno run -A stella-nova/pages/planet-collision/tests.mjs --gpu          GPU only
//  deno run -A stella-nova/pages/planet-collision/tests.mjs --gpu --time   + timing
//
//  1  Tillotson EOS (SI) against its published properties: P(rho0, 0) = 0,
//     bulk modulus A at rho0, Grueneisen a + b, the ideal-gas limit a, a
//     hand value for iron, continuity at Eiv and Ecv, u_cold against a
//     numerical integral, the sound speed at rho0
//  2  hydrostatic bodies: every data.js body solves with its real mass; its
//     model radius is within 8 % of the real one (printed per body)
//  3  particles: counts, mass, layer shares, inside the model radius
//  4  impact geometry: the point-mass orbit from d0 meets at contact with
//     the asked speed and impact parameter; centre of mass at rest at 0
//  5  a settled spinning body (CPU, Earth, N 1200): radius kept, energy,
//     momentum and angular momentum conserved (KG = 1)
//  6  two bodies merge (CPU, Mars + half Mars, head-on at v_esc): the
//     bound remnant holds > 95 % of the mass, no NaN, mass sum exact,
//     energy kept through the impact
//  7  presets and budget: every preset builds, sources given, contact in
//     1-20 min of sim time; profile bytes under LIMIT; phones <= 12288
//  8  WGSL text: no line of any shader mixes && with || (Tint precedence
//     rule); naga validates each module (render shaders after common.wgsl)
//  G  GPU (Deno WebGPU): primed fields = CPU (rho, P, c, Balsara, a, du, g,
//     phi, T, hNext, nOther); 20 steps = CPU; energy over 300 steps; the
//     relax and launch; stats counters; no validation errors. --time: the
//     ms per step at 16k, 32k, 49k
//  R  the renderer (Deno WebGPU, an offscreen texture, no browser and no
//     image file): every shader compiles clean; before contact the target
//     fills its disc and the sky round it is dark, with no glow; no
//     particle of a settled body is debris; a body drawn all as vapour
//     is a dim haze (mean under 110 of 255); the remnant at +0.25, +1 and
//     +3 h after contact (moon-earth, 16k) has under 2 % near-white pixels
//     in its disc and over 2 % orange-red ones; the lava skin (one state,
//     coolH 0.05 h and 3 h, two wall times) loses light as the crust forms,
//     keeps bright seams, and flows; the
//     filter makes the depth smooth, keeps the area and makes the limb
//     rounder (less spread of its radius: no bump per particle); a
//     grazing hit makes debris (fn classify) and glowing pixels; the colour
//     modes and the cutaway change the image; no validation errors.
//     --time also prints ms per frame
//  9  analysis.js outcome on a made-up ball with orbiting, escaping and
//     falling test particles; arc.js meets at R1 + R2 at tContact
//  10 saver-plan.js: the reel (seeded, every run once, no repeat), the
//     shots (order, 5-12 s), the event cuts, the ejecta jump, the plate
//     (3 TeX, live numbers, no code)
//  11 the camera on the impact (view.js, saver-plan.js): 17 presets and 40
//     random draws, point-mass bodies that merge or run on, sampled every
//     frame through the collision. The contact (the neck point that faces
//     the eye) is in front of the eye, no body sphere (shrunk 3 %) is
//     between the eye and it, and it is in the frame (16:9 desktop, 9:16
//     phone) or in the saver's clear band. In the saver, the shot from
//     contact to contact + IMPACT_HOLD is never the cutaway, and the
//     cutaway starts no sooner than CUTAWAY_AFTER s after contact
//  12 the density volume (render.js VOL_K, VOL_ISO): on a settled-shape
//     Earth (moon-earth, 32k) the iso surface sits about 0.6 spacing out
//     with a radius spread under 0.05 spacing, against 0.28 for the union
//     of particle spheres (the old look); a lone particle stays under the
//     iso level, two touching ones join; the volume tiers and bytes;
//     debris drops are small (radius under 2.5 % of the body radius, under
//     a third of the old rock size) and the rock primitives are gone
//  13 optics.js: the black body (red, orange, white, blue; the table and
//     the WGSL constants), Henyey-Greenstein lobes integrate to 1, the
//     vapour flagging (smokeWeights), the temperature -> material map
//     (matterState, skinCap, crustShare, geotherm); the tone map (grey
//     neutral, hot melt stays orange) and the exposure rule
//  P  the page (Deno, main.js with the DOM stubbed and an offscreen
//     texture for the canvas): boot, the relax, the launch, first contact
//     (the flash and the fades), the numbers, the outcome of a readback,
//     slow motion, an aimed collision, a preset change, a random draw,
//     pagehide; no errors
//
//  Each test prints PASS or FAIL with its numbers. Exit code 1 on a FAIL.
// ============================================================================
import { MATERIALS, BODIES, UNIT } from './data.js';
import { tillotson, soundSpeed, uCold, matSI } from './eos.js';
import { profile, bodyParticles, impactGeometry, buildScenario, rng } from './build.js';
import { CpuSPH, makeParams, boundMass } from './sph.js';
import { PRESETS, randomScenario } from './scenarios.js';
import * as BG from './budget.js';
import { outcome, percentile, M_MOON as M_MOON_T } from './analysis.js';
import { previewArc } from './arc.js';
import { bandFrom, makeView, frameTarget, eyeOf, stepView, cameraOf, impactYaw, sideFor, contactPoint } from './view.js';
import { M4, VOL_K, VOL_ISO, SPHERE_K, DROP_K, DROPS_MAX } from './render.js';
import * as SP from './saver-plan.js';

const ARGS = typeof Deno !== 'undefined' ? Deno.args : process.argv.slice(2);
const GPU_ONLY = ARGS.includes('--gpu');
let fails = 0;
const ok = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}  ${info}`); if (!cond) fails++; };
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);

function eosTests() {
  const M = Object.fromEntries(Object.entries(MATERIALS).map(([k, r]) => [k, matSI(r)]));
  let worst = 0;
  for (const m of Object.values(M)) worst = Math.max(worst, Math.abs(tillotson(m, m.rho0, 0)));
  ok('1 P(rho0, u = 0) = 0', worst === 0, `max |P| ${worst} Pa`);
  let eK = 0, eG = 0, eI = 0, eC = 0;
  for (const m of Object.values(M)) {
    const d = 1e-7, K = (tillotson(m, m.rho0 * (1 + d), 0) - tillotson(m, m.rho0, 0)) / d;
    eK = Math.max(eK, rel(K, m.A));
    const du = 1e-3 * m.Eiv, G = (tillotson(m, m.rho0, du) - tillotson(m, m.rho0, 0)) / du / m.rho0;
    eG = Math.max(eG, rel(G, m.a + m.b));
    const rho = 1e-4 * m.rho0, u = 3 * m.Ecv, gas = tillotson(m, rho, u) / (rho * u);
    eI = Math.max(eI, rel(gas, m.a));
    eC = Math.max(eC, rel(soundSpeed(m, m.rho0, 0), Math.sqrt(m.A / m.rho0)));
  }
  ok('1 bulk modulus at rho0 = A', eK < 1e-5, `max rel err ${eK.toExponential(2)}`);
  ok('1 Grueneisen (1/rho) dP/du at rho0 = a + b', eG < 1e-3, `max rel err ${eG.toExponential(2)}`);
  ok('1 expanded hot limit P / (rho u) = a (ideal gas)', eI < 1e-3, `max rel err ${eI.toExponential(2)}`);
  ok('1 sound speed at rho0, u = 0 is sqrt(A / rho0)', eC < 2e-3, `max rel err ${eC.toExponential(2)} (granite ${soundSpeed(M.granite, 2680, 0).toFixed(0)} m/s)`);
  // a hand value: iron at eta 1.5, u = 1 MJ/kg (Melosh 1989 eq. AII.1 with table AII.3)
  //   w = 1e6 / (9.5e6 * 2.25) + 1 = 1.046784; (0.5 + 1.5 / w) * 11700 * 1e6 = 2.26156e10
  //   + 1.28e11 * 0.5 + 1.05e11 * 0.25  ->  1.128656e11 Pa
  const Pfe = tillotson(M.iron, 11700, 1e6);
  ok('1 iron at 11700 kg/m^3, 1 MJ/kg = 112.87 GPa (hand value)', rel(Pfe, 1.128656e11) < 1e-5, `${(Pfe / 1e9).toFixed(3)} GPa`);
  let jump = 0;
  for (const m of Object.values(M)) for (const u of [m.Eiv, m.Ecv]) {
    const a = tillotson(m, 0.8 * m.rho0, u * (1 - 1e-9)), b = tillotson(m, 0.8 * m.rho0, u * (1 + 1e-9));
    jump = Math.max(jump, Math.abs(a - b) / Math.max(1, Math.abs(a)));
  }
  ok('1 continuous across Eiv and Ecv (eta 0.8)', jump < 1e-6, `max rel jump ${jump.toExponential(2)}`);
  { const m = M.iron, eta = 1.4, n = 2000; let s = 0;
    for (let k = 0; k <= n; k++) { const e = 1 + (eta - 1) * k / n, mu = e - 1, f = (m.A * mu + m.B * mu * mu) / (m.rho0 * e * e) * (m.rho0 * (eta - 1) / n) / m.rho0 * m.rho0 / m.rho0; const w = k === 0 || k === n ? 1 : (k % 2 ? 4 : 2); s += w * f; }
    s /= 3; s *= m.rho0 / m.rho0;
    // integrand (A mu + B mu^2) / rho^2 d rho with rho = rho0 e: = (A mu + B mu^2) / (rho0 e^2) de
    let s2 = 0; for (let k = 0; k <= n; k++) { const e = 1 + (eta - 1) * k / n, mu = e - 1, w = k === 0 || k === n ? 1 : (k % 2 ? 4 : 2); s2 += w * (m.A * mu + m.B * mu * mu) / (m.rho0 * e * e); }
    s2 *= (eta - 1) / n / 3;
    ok('1 u_cold = integral of P_cold / rho^2', rel(uCold(m, eta), s2) < 1e-8, `iron eta 1.4: ${(uCold(m, eta) / 1e6).toFixed(4)} MJ/kg, Simpson ${(s2 / 1e6).toFixed(4)}`); }
}

function bodyTests() {
  const rows = [];
  let worst = 0, massErr = 0;
  for (const [k, b] of Object.entries(BODIES)) {
    const p = profile(b);
    massErr = Math.max(massErr, rel(p.m[p.m.length - 1], b.mass / UNIT.M));
    if (b.radius) { const e = p.R * UNIT.L / b.radius - 1; worst = Math.max(worst, Math.abs(e)); rows.push(`${k} ${(p.R * UNIT.L / 1e3).toFixed(0)}/${(b.radius / 1e3).toFixed(0)} km`); }
  }
  ok('2 hydrostatic bodies: real mass', massErr < 1e-9, `max rel err ${massErr.toExponential(1)}`);
  ok('2 model radius within 8 % of the real radius', worst < 0.08, `worst ${(100 * worst).toFixed(1)} %: ${rows.join(', ')}`);
  const e = profile(BODIES.earth);
  console.log(`INFO  Earth model: centre ${(e.Pc * UNIT.P / 1e9).toFixed(0)} GPa (PREM 364 GPa), core edge ${(e.edges[0] * UNIT.L / 1e3).toFixed(0)} km (PREM 3480 km): Tillotson iron is too soft at core pressures`);
  // particles
  const R = rng(3), n = 3000, pt = bodyParticles(e, n, R);
  let ms = 0, rmax = 0, core = 0;
  for (let i = 0; i < n; i++) { ms += pt.mp; rmax = Math.max(rmax, Math.hypot(pt.pos[3 * i], pt.pos[3 * i + 1], pt.pos[3 * i + 2])); if (pt.mat[i] === 0) core++; }
  ok('3 particles: count, mass, core share, inside R', pt.n === n && rel(ms, e.M) < 1e-12 && Math.abs(core / n - 0.325) < 0.01 && rmax <= e.R, `n ${pt.n}, core ${(core / n).toFixed(4)} (0.325), r_max/R ${(rmax / e.R).toFixed(4)}`);
}

function geometryTests() {
  let worst = '', bad = 0;
  for (const [vRel, b] of [[1, 0], [1, 0.7], [1.5, 0.5], [2.5, 0.9], [0.9, 0.3]]) {
    const g = impactGeometry(1, 0.12, 0.94, 0.53, { vRel, b, d0: 1.6 });
    const Mt = 1.12, Rs = 1.47;
    let s = [g.X[1][0] - g.X[0][0], g.X[1][1] - g.X[0][1], g.V[1][0] - g.V[0][0], g.V[1][1] - g.V[0][1]];
    const f = q => { const r = Math.hypot(q[0], q[1]), k = -Mt / r ** 3; return [q[2], q[3], k * q[0], k * q[1]]; };
    for (let it = 0; it < 1e6 && Math.hypot(s[0], s[1]) > Rs; it++) {
      const h = 2e-5;
      const k1 = f(s), k2 = f(s.map((x, j) => x + h / 2 * k1[j])), k3 = f(s.map((x, j) => x + h / 2 * k2[j])), k4 = f(s.map((x, j) => x + h * k3[j]));
      s = s.map((x, j) => x + h / 6 * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
    }
    const r = Math.hypot(s[0], s[1]), v = Math.hypot(s[2], s[3]), bb = Math.abs(s[0] * s[3] - s[1] * s[2]) / (r * v);
    const P = [0, 1].map(c => 1 * g.V[0][c] + 0.12 * g.V[1][c]), X = [0, 1].map(c => 1 * g.X[0][c] + 0.12 * g.X[1][c]);
    const e = Math.max(rel(v, g.vImp), Math.abs(bb - b), Math.hypot(...P), Math.hypot(...X));
    if (e > 1e-4) bad++;
    worst += ` [${vRel}, ${b}] v ${(v / g.vImp).toFixed(5)} b ${bb.toFixed(4)}`;
  }
  ok('4 impact geometry: contact speed and impact parameter, COM at rest', bad === 0, worst.trim());
}

// 9 ─ the outcome of a readback (analysis.js) and the preview arc (arc.js)
function analysisTests() {
  // the phone clear band: a full-width caption on top, a narrow side caption ignored
  {
    const dock = { top: 844 - 62, height: 62 };
    const port = bandFrom(844, 390, { bottom: 180, width: 374 }, [dock, null]);
    const land = bandFrom(390, 844, { bottom: 220, width: 300 }, [{ top: 390 - 62, height: 62 }]);
    const tight = bandFrom(500, 390, { bottom: 300, width: 374 }, [{ top: 300, height: 200 }]);
    ok('9 phone band: a top caption pushes the band down, a side caption does not, 30 % kept',
      port.t === 186 && port.b === 68 && land.t === 0 && land.b === 68 && Math.abs(500 - tight.t - tight.b - 150) < 1e-9,
      `portrait t ${port.t} b ${port.b}; landscape t ${land.t} b ${land.b}; tight band ${(500 - tight.t - tight.b).toFixed(0)} of 500 px`);
  }
  // a uniform ball (M 1, R 1, at rest) and four test particles
  const nb = 3000, R = rng(5), n = nb + 4;
  const rb = { pos: new Float32Array(4 * n), vel: new Float32Array(4 * n), grav: new Float32Array(8 * n), aux: new Float32Array(4 * n) };
  for (let i = 0; i < nb; i++) {
    let p; do { p = [2 * R() - 1, 2 * R() - 1, 2 * R() - 1]; } while (Math.hypot(...p) > 1);
    const r = Math.hypot(...p);
    rb.pos.set([...p, 0.05], 4 * i); rb.vel.set([0, 0, 0, 1 / nb], 4 * i);
    rb.grav[8 * i + 3] = -(3 - r * r) / 2; rb.aux[4 * i] = 300 + 1000 * (i % 100) / 100;
  }
  const add = (k, p, v) => { const i = nb + k, r = Math.hypot(...p); rb.pos.set([...p, 0.1], 4 * i); rb.vel.set([...v, 1e-4], 4 * i); rb.grav[8 * i + 3] = -1 / r; rb.aux[4 * i] = 5000; };
  add(0, [3, 0, 0], [0, Math.sqrt(1 / 3), 0]);            // circular orbit at 3 R: disk
  add(1, [3, 0, 0], [0, 1.2 * Math.sqrt(2 / 3), 0]);      // over the escape speed: escaping
  add(2, [2, 0, 0], [-0.3, 0, 0]);                        // falls straight in: largest body
  add(3, [0, 3, 0], [0.1, 0, 0]);                         // periapsis inside R: largest body
  const o = outcome(rb, n, [{ M: 1, R: 1 }]);
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  ok('9 outcome: largest body, disk and escaping mass from orbits', o.nD === 1 && o.nE === 1 && o.nP === nb + 2 && near(o.Md, 1e-4) && near(o.Me, 1e-4) && Math.abs(o.Rp - 1) < 1e-3,
    `largest ${o.nP} particles (M ${o.Mp.toFixed(5)}, Rp ${o.Rp.toFixed(4)}), disk ${o.nD}, escaping ${o.nE}`);
  const p99 = percentile(rb.aux.filter((_, k) => k % 4 === 0), n, 0.99);
  ok('9 outcome: T99 is the 99th percentile', o.T99 === p99 && o.T99 >= 1280 && o.T99 < 1300, `T99 ${o.T99.toFixed(0)} K`);
  // the preview arc meets at R1 + R2 at the contact time of build.js
  let worst = 0, info = [];
  for (const k of ['theia', 'moon-earth', 'mercury', 'two-earths']) {
    const st = buildScenario(PRESETS.find(p => p.key === k), 4096, 1), a = previewArc(st), B = st.bodies;
    const e = a.imp[a.imp.length - 1], t = a.tgt[a.tgt.length - 1], d = Math.hypot(e[0] - t[0], e[1] - t[1], e[2] - t[2]);
    const err = Math.max(Math.abs(d / (B[0].R + B[1].R) - 1), Math.abs(a.tHit / st.impact.tContact - 1), Math.hypot(a.imp[0][0] - B[1].X[0], a.imp[0][1] - B[1].X[1]));
    worst = Math.max(worst, err); info.push(`${k} ${a.imp.length}+${a.ghost.length} pts`);
  }
  ok('9 preview arc: starts at the impactor, meets at R1 + R2 at tContact', worst < 0.01, `worst rel err ${worst.toExponential(1)}; ${info.join(', ')}`);
}

// 10 ─ the saver plan (saver-plan.js): reel, shots, events, plate
function saverPlanTests() {
  const keys = SP.RUNS.map(r => r.key);
  let full = true, rep = 0, last = null;
  const R = SP.rng(11);
  for (let b = 0; b < 60; b++) {
    const reel = SP.makeReel(R, last);
    if (reel.length !== keys.length || new Set(reel.map(r => r.key)).size !== keys.length) full = false;
    if (reel[0].key === last) rep++;
    last = reel[reel.length - 1].key;
  }
  const a = SP.makeReel(SP.rng(1)).map(r => r.key).join(), a2 = SP.makeReel(SP.rng(1)).map(r => r.key).join(), b = SP.makeReel(SP.rng(2)).map(r => r.key).join();
  ok('10 reel: every run once per bag, no repeat across bags, seeded', full && rep === 0 && a === a2 && a !== b && keys.length >= 20 && SP.RUNS.filter(r => r.roll).length === 5,
    `${keys.length} runs (${PRESETS.length} presets + 5 random), 60 bags, ${rep} repeats; seed 1 starts ${a.split(',').slice(0, 3).join(' ')}, seed 2 ${b.split(',').slice(0, 3).join(' ')}`);
  let badLen = 0, cut = 0, orders = new Set();
  const Rp = SP.rng(5);
  for (let k = 0; k < 300; k++) {
    const sh = SP.shotPlan(Rp);
    if (sh[0].kind !== 'approach' || sh[1].kind !== 'impact' || sh[sh.length - 1].kind !== 'disk') badLen++;
    for (const x of sh) if (!(x.len >= x.min && x.len <= x.max && x.min >= SP.CUT_MIN && x.max <= SP.CUT_MAX)) badLen++;
    if (sh.some(x => x.kind === 'cutaway')) cut++;
    const ci = sh.findIndex(x => x.kind === 'cutaway');
    if (ci >= 0 && ci < sh.findIndex(x => x.kind === 'splash')) badLen++;
    if (ci >= 0 && ci < sh.findIndex(x => x.kind === 'ejecta')) badLen++;
    orders.add(sh.map(x => x.kind[0]).join(''));
  }
  ok('10 shots: approach, impact first, cutaway after splash and ejecta, disk last, 5-12 s each, varied order', badLen === 0 && cut > 170 && cut < 230 && orders.size === 4, `${cut}/300 plans with a cutaway, ${orders.size} orders`);
  const ap = SP.SHOTS.approach, dn = (el, c) => SP.shotDone(ap, el, { contactAt: c });
  const sp = SP.shotDone(Object.assign({ len: 6.5 }, SP.SHOTS.splash), 6.4, { contactAt: 0 }) === false && SP.shotDone(Object.assign({ len: 6.5 }, SP.SHOTS.splash), 6.5, { contactAt: 0 }) === true;
  const im = Object.assign({ len: 6 }, SP.SHOTS.impact), di = (el, c) => SP.shotDone(im, el, { contactAt: c });
  const imp = di(8, 0) && !di(7.9, 0) && !di(12.9, 5) && di(13, 5) && !di(30, null) && di(SP.APPROACH_MAX, null) && !di(17.9, 10) && di(18, 10);
  ok('10 cuts on events: the approach and the impact wait for contact; the impact holds IMPACT_HOLD s after it', !dn(11.9, null) && !dn(30, null) && dn(SP.APPROACH_MAX, null) && !dn(4.9, 2) && dn(5, 2) && !dn(7.7, 7) && dn(7.8, 7) && sp && imp,
    `no contact: approach and impact hold to ${SP.APPROACH_MAX} s; contact at 2 s: cut at 5 s; contact at 7 s: cut at 7.8 s; splash cuts at its length; impact len 6 s, contact at 0: cut at 8 s, at 5 s: cut at 13 s, at 10 s: cut at 18 s`);
  { const p = ['approach', 'impact', 'cutaway', 'splash', 'disk'].map(kind => ({ kind })), j = SP.pickNext(p, 1, 0, 3);
    const q = ['approach', 'impact', 'cutaway', 'disk'].map(kind => ({ kind })), jq = SP.pickNext(q, 1, 0, 3);
    const r = ['approach', 'impact', 'cutaway', 'disk'].map(kind => ({ kind })), jr = SP.pickNext(r, 1, 0, 30);
    const c = ['approach', 'impact', 'splash', 'cutaway', 'disk'].map(kind => ({ kind })), jc = SP.contactCut(c, 3);
    ok('10 an early cutaway gives way; a contact in a later shot cuts back to the impact', p[j].kind === 'splash' && q[jq].kind === 'disk' && r[jr].kind === 'cutaway' && c[jc].kind === 'impact' && SP.contactCut(c, 1) === 1,
      `3 s after contact: next ${p[j].kind} (cutaway dropped when only the disk is left: next ${q[jq].kind}); 30 s after: ${r[jr].kind}; contact in the cutaway: cut to ${c[jc].kind}`); }
  const plan = () => ['approach', 'impact', 'splash', 'cutaway', 'ejecta', 'disk'].map(kind => ({ kind }));
  const p1 = plan(), j1 = SP.pickNext(p1, 1, 0.05), p2 = plan(), j2 = SP.pickNext(p2, 1, 0), p3 = plan(), p4 = plan(), j4 = SP.pickNext(p4, 0, 0.5);
  ok('10 escaping mass brings the ejecta shot forward, after the impact shot', p1[j1].kind === 'ejecta' && p2[j2].kind === 'splash' && SP.pickNext(p3, 5, 0.5) === -1 && p1[p1.length - 1].kind === 'disk' && p4[j4].kind === 'impact',
    `esc 5 %: ${p1.map(x => x.kind).join(' ')}; esc 0: next ${p2[j2].kind}`);
  // the plate: every shot kind, a preset and a random draw, no code
  const Rr = SP.rng(3), bad = [];
  const runs = [SP.runScenario({ preset: 'theia' }, Rr), SP.runScenario({ roll: true }, Rr), SP.runScenario({ roll: true }, Rr), SP.runScenario({ preset: 'rheasilvia' }, Rr)];
  for (const { sc, seed } of runs) {
    const setup = buildScenario(sc, 4096, seed);
    for (const kind of Object.keys(SP.SHOTS)) {
      const after = kind !== 'approach';
      const L = SP.plateInfo({ sc, setup, stats: after ? { t: setup.impact.tContact + 1, tSec: 7200, maxPGPa: 300 } : null,
        out: after ? { Mp: 0.9, Md: 0.01, Me: 0.09, Mtot: 1, X: [0, 0, 0], Rp: 1 } : null, peak: { P: 310, melt: 0.2, vap: 0.01, T99: 4200 },
        n: 4096, shot: Object.assign({ kind, mode: 1 }, SP.SHOTS[kind]), warp: 95, slow: kind === 'impact' });
      const j = JSON.stringify(L);
      const plain = L.params.map(p => p.value).concat(L.lines).join(' ');
      if ('code' in L || /[\^_]/.test(plain) || /GPa/.test(plain) || L.tex.length !== 3 || L.eq.length !== 3 || L.params.length < 5 || L.lines.length !== 2 || L.title !== sc.title || /undefined|NaN|null/.test(j)) bad.push(sc.key + '/' + kind);
    }
  }
  const L0 = SP.plateInfo({ sc: runs[0].sc, setup: buildScenario(runs[0].sc, 4096, 1), stats: null, out: null, peak: { P: 0, melt: 0, vap: 0, T99: 0 }, n: 4096, shot: Object.assign({ kind: 'approach' }, SP.SHOTS.approach), warp: 0 });
  ok('10 plate: title, bodies, v_imp, angle, live numbers, 3 TeX, no code, no raw ^ or _', bad.length === 0 && runs[1].sc.key !== runs[2].sc.key,
    bad.join(' ') || `"${L0.title}": ${L0.params.map(p => p.name + ' ' + p.value).join('; ')}; ${L0.lines[0]}`);
}

// 11 ─ the camera on the impact (view.js + saver-plan.js, point masses)
function cameraTests() {
  const fov = 0.7, near = 0.01, SUN = (() => { const a = [1, 0.25, 0.3], l = Math.hypot(...a); return a.map(x => x / l); })();
  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const nrm3 = a => { const l = Math.hypot(...a) || 1; return a.map(x => x / l); };
  // the neck point that faces the eye (on both spheres once they overlap)
  function witness(A, B, eye) {
    const q = contactPoint(A, B), n = nrm3(sub3(B.c, A.c)), D = Math.hypot(...sub3(B.c, A.c));
    if (D >= A.R + B.R) return q;
    const a = Math.hypot(...sub3(q, A.c)), rho = Math.sqrt(Math.max(0, A.R * A.R - a * a));
    const g = sub3(eye, q), gp = nrm3(sub3(g, n.map(x => x * dot3(g, n))));
    return q.map((x, k) => x + rho * gp[k]);
  }
  // the smallest distance of segment eye -> W from c, over R
  function clearance(eye, W, c, R) {
    const d = sub3(W, eye), t = Math.max(0, Math.min(1, dot3(sub3(c, eye), d) / dot3(d, d)));
    return Math.hypot(...sub3(eye.map((x, k) => x + t * d[k]), c)) / R;
  }
  // one run: point masses, softened gravity, drag while they overlap
  function run(sc, seed, o) {
    const su = buildScenario(sc, 600, seed), B = su.bodies, M1 = B[0].M, M2 = B[1].M, Mt = M1 + M2, Rs = B[0].R + B[1].R;
    const im = su.impact, eps = 0.3 * Math.min(B[0].R, B[1].R), kd = 1.2 * im.vImp / Rs;
    let r = sub3(B[1].X, B[0].X), v = sub3(B[1].V, B[0].V), t = 0, tc = null, wall = 0;
    const H = o.H, aspect = o.aspect, band = o.band;
    const view = makeView(), rnd = SP.rng(seed * 7 + 1);
    let shots = o.saver ? SP.shotPlan(rnd) : null, si = 0, shotAt = 0, contactAt = null, contactWall = null, speed = 2;
    const st = { n: 0, occl: 0, out: 0, behind: 0, minClr: 9, maxX: 0, cutEarly: 0, wrongShot: 0, cutStart: null };
    const bodies = () => [{ c: r.map(x => -M2 / Mt * x), R: B[0].R }, { c: r.map(x => M1 / Mt * x), R: B[1].R }];
    let g = frameTarget(bodies(), null, fov, aspect);
    view.target = g.target.slice(); view.dist = g.dist; view.axis = g.axis; view.side = sideFor(g.axis, SUN);
    const dtw = 1 / 30, warp = o.warp;
    for (let f = 0; f < 30 * 120; f++) {
      // sim time of this frame
      let left = warp * speed / 2 * dtw;
      while (left > 0) {
        const h = Math.min(left, 0.02 * Rs / Math.max(1e-6, Math.hypot(...v)));
        const D = Math.hypot(...r), k = -Mt / Math.pow(D * D + eps * eps, 1.5);
        const a = r.map((x, j) => k * x - (D < Rs ? kd * v[j] : 0));
        v = v.map((x, j) => x + h * a[j]); r = r.map((x, j) => x + h * v[j]); t += h; left -= h;
      }
      wall += dtw;
      const bs = bodies(), D = Math.hypot(...r);
      if (tc == null && D <= Rs) {
        tc = t; contactWall = wall;
        if (shots) { const j = SP.contactCut(shots, si); if (j !== si) { si = j; shotAt = wall; } contactAt = wall - shotAt; if (shots[si].kind === 'approach' || shots[si].kind === 'impact') speed = 0.25; }
      }
      const sinceH = tc == null ? null : (t - tc) * UNIT.T / 3600;
      g = frameTarget(bs, sinceH, fov, aspect, { axis: view.axis });
      view.axis = g.axis; view.base = impactYaw(g.axis, view.side);
      stepView(view, g, dtw, tc != null ? 1.2 : 0.6);
      let v2 = view, sh = null;
      if (shots) {
        sh = shots[si];
        if (SP.shotDone(sh, wall - shotAt, { contactAt })) {
          const j = SP.pickNext(shots, si, 0, contactWall == null ? null : wall - contactWall);
          if (j < 0) break;
          si = j; shotAt = wall; sh = shots[si]; contactAt = tc != null ? 0 : null;
          speed = sh.kind === 'impact' && tc == null ? 2 : sh.kind === 'approach' && tc != null ? 0.25 : sh.speed;
          if (sh.kind === 'cutaway' && st.cutStart == null) st.cutStart = wall - contactWall;
        }
        v2 = SP.shotView(sh, Math.min(1, (wall - shotAt) / sh.len), o.calm, view, g.p);
        if (contactWall != null && wall - contactWall < SP.IMPACT_HOLD) {
          if (sh.cut || sh.kind === 'cutaway') st.cutEarly++;
          if (sh.kind !== 'approach' && sh.kind !== 'impact') st.wrongShot++;
        }
      }
      // the impact window: up to 1.5 sim h, until the smaller body is mostly under
      const depth = Rs - D, inWindow = (tc == null || sinceH < 1.5) && depth < 0.8 * Math.min(B[0].R, B[1].R);
      const checkShot = !sh || sh.kind === 'approach' || sh.kind === 'impact';
      if (!inWindow || !checkShot) { if (tc != null && !shots && !inWindow) break; continue; }
      const cam = cameraOf(v2, band, fov, H, aspect);
      const W = witness(bs[0], bs[1], cam.eye), fw = nrm3(sub3(cam.target, cam.eye));
      st.n++;
      if (dot3(sub3(W, cam.eye), fw) <= near) { st.behind++; continue; }
      const clr = Math.min(clearance(cam.eye, W, bs[0].c, bs[0].R), clearance(cam.eye, W, bs[1].c, bs[1].R));
      st.minClr = Math.min(st.minClr, clr);
      if (clr < 0.97) st.occl++;
      const vm = M4.lookAt(cam.eye, cam.target, cam.up).m, pm = M4.persp(fov, aspect, near), m = M4.mul(pm, vm);
      const cx = m[0] * W[0] + m[4] * W[1] + m[8] * W[2] + m[12], cy = m[1] * W[0] + m[5] * W[1] + m[9] * W[2] + m[13], cw = m[3] * W[0] + m[7] * W[1] + m[11] * W[2] + m[15];
      const nx = cx / cw, py = (0.5 - cy / cw * 0.5) * H;
      st.maxX = Math.max(st.maxX, Math.abs(nx));
      if (Math.abs(nx) > 0.92 || py < band.t || py > H - band.b) st.out++;
    }
    return st;
  }
  const scs = PRESETS.map(p => ({ sc: p, seed: 1 })).concat(Array.from({ length: 40 }, (_, k) => ({ sc: randomScenario(1000 + 37 * k), seed: 1000 + 37 * k })));
  const frames = [
    { name: 'page 16:9', H: 900, aspect: 16 / 9, band: { t: 0, b: 0 } },
    { name: 'page 9:16 phone', H: 844, aspect: 390 / 844, band: { t: 150, b: 90 } },
    { name: 'saver 16:9', H: 1080, aspect: 16 / 9, band: { t: 0.2 * 1080, b: 0.3 * 1080 }, saver: true },
    { name: 'saver 9:16', H: 1920, aspect: 9 / 16, band: { t: 0.2 * 1920, b: 0.3 * 1920 }, saver: true },
  ];
  const lines = [];
  let bad = 0, cutBad = 0, cutMin = Infinity, total = 0;
  for (const fr of frames) for (const warp of [1.0, 0.15]) {
    const agg = { n: 0, occl: 0, out: 0, behind: 0, minClr: 9, maxX: 0 };
    for (const { sc, seed } of scs) {
      const s = run(sc, seed, Object.assign({ warp, calm: 0.7 }, fr));
      for (const k of ['n', 'occl', 'out', 'behind']) agg[k] += s[k];
      agg.minClr = Math.min(agg.minClr, s.minClr); agg.maxX = Math.max(agg.maxX, s.maxX);
      if (fr.saver) { cutBad += s.cutEarly + s.wrongShot; if (s.cutStart != null) { cutMin = Math.min(cutMin, s.cutStart); if (s.cutStart < SP.CUTAWAY_AFTER) cutBad++; } }
    }
    total += agg.n; bad += agg.occl + agg.out + agg.behind;
    lines.push(`${fr.name} warp ${warp}: ${agg.n} samples, occluded ${agg.occl}, out of frame ${agg.out}, behind ${agg.behind}, min clearance ${agg.minClr.toFixed(3)} R, max |x| ${agg.maxX.toFixed(2)}`);
  }
  ok('11 camera: the contact is in front, not behind a body, in the frame or the clear band', bad === 0 && total > 5000, `${scs.length} runs x 4 frames x 2 speeds, ${total} samples, ${bad} bad | ` + lines.join(' | '));
  ok('11 saver: no cutaway or other shot in the impact window; the cutaway comes late', cutBad === 0, `${cutBad} bad frames; first cutaway ${cutMin === Infinity ? 'none' : cutMin.toFixed(1) + ' s'} after contact (rule ${SP.CUTAWAY_AFTER} s), impact window ${SP.IMPACT_HOLD} s`);
}

// 12 ─ the density volume: a smooth iso surface, not particle bumps
async function volumeTests() {
  const su = buildScenario(PRESETS.find(p => p.key === 'moon-earth'), 32768, 1), B = su.bodies[0], pts = [];
  for (let i = 0; i < su.N; i++) if (su.body[i] === 0) {
    const x = [0, 1, 2].map(c => su.pos[3 * i + c] - B.X[c]), r = Math.hypot(...x);
    if (r > 0.8 * B.R) pts.push({ x, r, s0: Math.cbrt(su.mass[i] / (MATERIALS[['iron', 'granite', 'basalt', 'ice'][su.mat[i]]].rho0 / UNIT.RHO)) });
  }
  const S0 = pts.reduce((a, p) => a + p.s0, 0) / pts.length, Rout = Math.max(...pts.map(p => p.r));
  const dirs = []; for (let k = 0; k < 400; k++) { const z = 1 - 2 * (k + 0.5) / 400, rr = Math.sqrt(1 - z * z), ph = k * 2.39996 + 0.3; dirs.push([rr * Math.cos(ph), rr * Math.sin(ph), z]); }
  const sd = a => { const m = a.reduce((p, q) => p + q, 0) / a.length; return [m, Math.sqrt(a.reduce((p, q) => p + (q - m) ** 2, 0) / a.length)]; };
  const field = q => { let s = 0; for (const p of pts) { const R = VOL_K * p.s0, d2 = (q[0] - p.x[0]) ** 2 + (q[1] - p.x[1]) ** 2 + (q[2] - p.x[2]) ** 2; if (d2 < R * R) { const u = 1 - d2 / (R * R); s += u * u * u; } } return s; };
  const iso = dirs.map(d => { let lo = 0.85 * B.R, hi = Rout + 3 * S0; for (let it = 0; it < 22; it++) { const m = 0.5 * (lo + hi); if (field(d.map(x => x * m)) >= VOL_ISO) lo = m; else hi = m; } return lo; });
  const sph = dirs.map(d => { let best = 0; for (const p of pts) { const r = SPHERE_K * p.s0, b = p.x[0] * d[0] + p.x[1] * d[1] + p.x[2] * d[2], h = b * b - (p.r * p.r - r * r); if (h >= 0) best = Math.max(best, b + Math.sqrt(h)); } return best; });
  const [mi, si] = sd(iso), [ms, ss] = sd(sph);
  ok('12 the iso surface of a body is smooth: no particle bumps', si < 0.05 * S0 && ss > 0.2 * S0 && si < 0.2 * ss && Math.abs((mi - Rout) / S0 - 0.62) < 0.15,
    `radius spread ${(si / S0).toFixed(3)} spacing (spheres ${(ss / S0).toFixed(3)}); surface ${((mi - Rout) / S0).toFixed(2)} spacing out (spheres ${((ms - Rout) / S0).toFixed(2)}); spacing ${(S0 * 6371).toFixed(0)} km, ${pts.length} outer particles`);
  // one particle alone: peak 1 < iso (the spray draws it); two at one
  // spacing: the middle is over the iso (they join as a drop)
  const pair = 2 * Math.pow(1 - 0.25 / (VOL_K * VOL_K), 3);
  ok('12 a lone particle stays under the iso level, two touching ones join', 1 < VOL_ISO && pair > VOL_ISO, `peak of one 1.00, middle of a pair ${pair.toFixed(2)}, iso ${VOL_ISO}`);
  const mb = G => (BG.volBytes(G) / 1e6).toFixed(1) + ' MB';
  const rb = BG.renderBudget({ cssW: 390, cssH: 844, dpr: 3, touch: true, phone: true }), rd = BG.renderBudget({ cssW: 1600, cssH: 900, dpr: 2 });
  ok('12 volume tiers: phones get a smaller volume, the governor steps down', rb.grid < rd.grid && rd.grid % 8 === 0 && rb.grid % 8 === 0 && BG.lowerGrid(rd.grid) < rd.grid && BG.lowerGrid(64) === 64 && BG.volBytes(rd.grid) < 40e6,
    `desktop ${rd.grid}^3 (${mb(rd.grid)}), phone ${rb.grid}^3 (${mb(rb.grid)}); tiers ${BG.GRID_TIERS.join(' ')}`);
  // debris: many small drops, not a few rocks. The largest drop over the
  // target radius for every preset, desktop and phone counts; the old rock
  // was 0.9 SPHERE_K spacing times a stretch up to 1.4
  let worst = 0, key = '';
  for (const p of PRESETS) for (const N of [BG.PROFILES.medium.N, BG.PROFILES.phone.N]) {
    const su2 = buildScenario(p, N, 1);
    for (const b of su2.bodies) { const s0 = Math.cbrt(b.mp / (MATERIALS.granite.rho0 / UNIT.RHO)), r = 1.45 * DROP_K * s0 / su2.bodies[0].R; if (r > worst) { worst = r; key = p.key + ' ' + N; } }
  }
  const oldRock = 0.9 * SPHERE_K * 1.4, newDrop = 1.45 * DROP_K;
  ok('12 debris drops are small: under 2.5 % of the body radius', worst < 0.025 && newDrop < oldRock / 3 && rd.frags >= 8 && rb.frags >= 3 && rd.frags <= DROPS_MAX,
    `largest drop ${(100 * worst).toFixed(2)} % of the target radius (${key}); drop ${newDrop.toFixed(2)} spacing against the old rock ${oldRock.toFixed(2)}; ${rd.frags} drops a particle desktop, ${rb.frags} phone`);
  const { readFileSync } = await import('node:fs'), fsr = n => readFileSync(new URL(n, import.meta.url), 'utf8');
  const rjs = fsr('./render.js'), dw = fsr('./shaders/debris.wgsl');
  ok('12 the rock primitives are gone: no octahedra, droplet impostors only', !/vs_rock|pRock|octCorner|draw\(24/.test(rjs + dw) && /pDrop\); p\.draw\(6, n \* F\)/.test(rjs) && /fn vs_drop/.test(dw),
    'render.js draws 6 vertices per droplet (pDrop); debris.wgsl has no vs_rock or octCorner');
}

function settledEarth(N, seed) {
  const st = buildScenario({ bodies: [{ key: 'earth', spinH: 10 }], impact: {} }, N, seed);
  const prm = makeParams(st, { KG: 1 });
  const s = new CpuSPH(st, prm);
  s.relax(120);
  return { st, prm, s };
}
function cpuTests() {
  const t0 = Date.now();
  { const { s } = settledEarth(1200, 3);
    const r90 = () => { const r = []; for (let i = 0; i < s.N; i++) r.push(Math.hypot(s.x[3 * i], s.x[3 * i + 1], s.x[3 * i + 2])); r.sort((a, b) => a - b); return r[Math.floor(0.9 * s.N)]; };
    s.launch();
    const R0 = r90(), E0 = s.energy(), M0 = s.momentum();
    s.run(250);
    const E = s.energy(), M = s.momentum(), R1 = r90();
    const Mtot = s.m.reduce((a, b) => a + b, 0), L0 = Math.hypot(...M0.L);
    ok('5 settled body keeps its radius (250 steps, spin 10 h)', Math.abs(R1 / R0 - 1) < 0.03, `r90 ${R0.toFixed(4)} -> ${R1.toFixed(4)} R_E, sim time ${(s.t * UNIT.T / 3600).toFixed(2)} h`);
    ok('5 energy conserved (KG = 1)', Math.abs(E.E - E0.E) / Math.abs(E0.W) < 1e-4, `|dE|/|W| ${(Math.abs(E.E - E0.E) / Math.abs(E0.W)).toExponential(2)} (K ${E0.K.toExponential(3)} -> ${E.K.toExponential(3)})`);
    const dP = Math.hypot(M.P[0] - M0.P[0], M.P[1] - M0.P[1], M.P[2] - M0.P[2]) / Mtot;
    ok('5 momentum and angular momentum conserved', dP < 1e-12 && Math.hypot(M.L[0] - M0.L[0], M.L[1] - M0.L[1], M.L[2] - M0.L[2]) / L0 < 1e-3,
      `|dP|/M ${dP.toExponential(1)} R_E/T, |dL|/|L| ${(Math.hypot(M.L[0] - M0.L[0], M.L[1] - M0.L[1], M.L[2] - M0.L[2]) / L0).toExponential(2)}`); }
  { const sc = { bodies: [{ key: 'mars' }, { key: 'mars', massScale: 0.5 }], impact: { vRel: 1.0, b: 0, d0: 1.3 }, fmin: 0.3 };
    const st = buildScenario(sc, 700, 5), prm = makeParams(st, { KG: 1 }), s = new CpuSPH(st, prm);
    s.relax(80); s.launch();
    const E0 = s.energy(), M0 = s.m.reduce((a, b) => a + b, 0);
    let Tmax = 0;
    while (s.t < 10) { s.run(25); for (let i = 0; i < s.N; i++) Tmax = Math.max(Tmax, s.T[i]); }
    const E = s.energy(), bm = boundMass(s.x, s.v, s.m, s.phi, s.N);
    let nan = 0; for (let i = 0; i < 3 * s.N; i++) if (!Number.isFinite(s.x[i]) || !Number.isFinite(s.v[i])) nan++;
    const M1 = s.m.reduce((a, b) => a + b, 0);
    ok('6 two bodies merge: bound remnant > 95 % of the mass', bm.M / M1 > 0.95 && nan === 0 && M1 === M0, `bound ${(100 * bm.M / M1).toFixed(2)} %, NaN ${nan}, mass sum ${M1 === M0 ? 'exact' : M1 / M0}, peak T ${Tmax.toFixed(0)} K, ${(s.t * UNIT.T / 3600).toFixed(2)} h`);
    ok('6 energy kept through the impact (KG = 1)', Math.abs(E.E - E0.E) / Math.abs(E0.W) < 5e-3, `|dE|/|W| ${(Math.abs(E.E - E0.E) / Math.abs(E0.W)).toExponential(2)}, u ${E0.U.toExponential(2)} -> ${E.U.toExponential(2)}`); }
  console.log(`INFO  CPU solver tests: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

// 13 ─ optics.js: the black body, the phase, the smoke and matter rules
async function opticsTests() {
  const O = await import('./optics.js');
  const bb = T => O.blackbodyRGB(T), f3 = c => c.map(v => v.toFixed(3)).join('/');
  const c1 = bb(1000), c15 = bb(1500), c65 = bb(6500), c12 = bb(12000);
  let mono = true, prev = 0; for (let T = 800; T <= 6500; T += 100) { const c = bb(T), q = c[1] / c[0]; if (q < prev - 1e-9) mono = false; prev = q; }
  ok('13 black body: red at 1000 K, orange at 1500 K, white at 6500 K, blue at 12000 K; green share rises with T',
    c1[0] === 1 && c1[1] < 0.06 && c1[2] < 0.01 && c15[1] > 0.08 && c15[1] < 0.25 && c15[2] < 0.02 && Math.min(...c65) > 0.9 && c12[2] === 1 && c12[0] < 0.8 && mono,
    `1000 K ${f3(c1)}, 1500 K ${f3(c15)}, 6500 K ${f3(c65)}, 12000 K ${f3(c12)} (linear sRGB)`);
  const lut = O.blackbodyLUT(), last = O.blackbodyRGB(O.BB_T1);
  let inR = true; for (const v of lut) if (!(v >= 0 && v <= 1)) inR = false;
  const wg = fs => fs.readFileSync(new URL('./shaders/common.wgsl', import.meta.url), 'utf8');
  const fsm = await import('node:fs'), cw = wg(fsm), num = k => Number((cw.match(new RegExp('const ' + k + ': f32 = ([0-9.]+)')) || [])[1]);
  ok('13 the black-body table: BB_N rows in [0, 1], ends at BB_T0 and BB_T1, the WGSL constants match', lut.length === 4 * O.BB_N && inR && Math.abs(lut[4 * O.BB_N - 2] - last[2]) < 1e-6 && num('BB_T0') === O.BB_T0 && num('BB_T1') === O.BB_T1 && num('BB_N') === O.BB_N,
    `${O.BB_N} rows ${O.BB_T0}-${O.BB_T1} K; common.wgsl BB_T0 ${num('BB_T0')}, BB_T1 ${num('BB_T1')}, BB_N ${num('BB_N')}`);
  const integ = fn => { let s = 0; const n = 40000; for (let i = 0; i < n; i++) { const c = -1 + 2 * (i + 0.5) / n; s += fn(c) * 2 * Math.PI * 2 / n; } return s; };
  const ints = [O.PHASE.g1, O.PHASE.g2, 0.9, 0].map(g => integ(c => O.hg(g, c))), mixI = integ(c => O.phase(c));
  ok('13 Henyey-Greenstein: each lobe and the two-lobe mix integrate to 1; forward scattering wins', ints.every(v => Math.abs(v - 1) < 2e-3) && Math.abs(mixI - 1) < 2e-3 && O.phase(1) > 10 * O.phase(-1),
    `lobes ${ints.map(v => v.toFixed(4)).join(', ')}; mix ${mixI.toFixed(4)}; forward / back ${(O.phase(1) / O.phase(-1)).toFixed(1)}`);
  const sw = O.smokeWeights, r = (o, k) => o[k].toFixed(2);
  const cold = sw({ xv: 0, T: 300, rhoRatio: 1.1, debris: false, coolH: -1 }), vap = sw({ xv: 0.8, T: 9000, rhoRatio: 0.1, coolH: 0.1 }),
    vapLate = sw({ xv: 0.8, T: 9000, rhoRatio: 0.1, coolH: 8 }), coolV = sw({ xv: 0.8, T: 1500, rhoRatio: 0.1, coolH: 1 }),
    deb = sw({ xv: 0, T: 400, rhoRatio: 0.15, debris: true, coolH: 1 }), hotExp = sw({ xv: 0, T: 5000, rhoRatio: 0.2, coolH: 0.2 }), hotDense = sw({ xv: 0, T: 5000, rhoRatio: 1.0, coolH: 0.2 });
  ok('13 vapour flagging: settled rock none; vapour (xv) and hot expanded rock gas; cool vapour and free debris dust; hot dense rock none',
    cold.gas === 0 && cold.dust === 0 && vap.gas > 0.95 && vapLate.gas > 0.5 && vapLate.Tgas < 2300 && coolV.dust > 0.95 && coolV.gas < 0.05 && Math.abs(deb.dust - O.SMOKE.dustShed) < 1e-9 && deb.gas === 0 && hotExp.gas > 0.9 && hotDense.gas === 0 && hotDense.dust === 0,
    `cold ${r(cold, 'gas')}/${r(cold, 'dust')}, vapour +0.1 h ${r(vap, 'gas')} at ${vap.Tgas.toFixed(0)} K, +8 h ${r(vapLate, 'gas')} at ${vapLate.Tgas.toFixed(0)} K, 1500 K vapour dust ${r(coolV, 'dust')}, debris dust ${r(deb, 'dust')}, hot expanded gas ${r(hotExp, 'gas')}, hot dense ${r(hotDense, 'gas')}`);
  const st = [O.matterState(300, 1500, -1), O.matterState(1200, 1500, -1), O.matterState(2500, 1500, 0.1), O.matterState(2500, 1500, 3), O.matterState(9000, 1500, 0.2, 0.8)].map(m => m.state);
  let skinMono = true, crMono = true, gtMono = true;
  for (let h = 0; h < 10; h += 0.1) { if (O.skinCap(h + 0.1) > O.skinCap(h)) skinMono = false; if (O.crustShare(h + 0.1) < O.crustShare(h)) crMono = false; }
  for (let x = 0; x < 1; x += 0.01) { if (O.geotherm(x + 0.01, 0) > O.geotherm(x, 0) + 1e-9) gtMono = false; }
  const melt = O.matterState(2500, 1500, 0.1), crust = O.matterState(2500, 1500, 3);
  ok('13 temperature -> material: solid, hot, melt, crust, vapour; the skin cools, the crust grows, the crust is darker; the geotherm falls outward',
    st.join() === 'solid,hot,melt,crust,vapour' && skinMono && crMono && crust.L < 0.5 * melt.L && O.crustShare(-1) === 0 && O.crustShare(100) === 0.85 && gtMono && O.geotherm(0, 1) === O.GEOTHERM.centre && Math.abs(O.geotherm(1, 0) - O.GEOTHERM.surface) < 1e-6,
    `${st.join(', ')}; skin cap ${O.skinCap(0).toFixed(0)} -> ${O.skinCap(3).toFixed(0)} K at 3 h; radiance melt ${melt.L.toFixed(2)}, crust ${crust.L.toFixed(2)}; geotherm ${O.geotherm(0, 1)} K centre, ${O.geotherm(0.6, 0).toFixed(0)} K at 0.6 R, ${O.geotherm(1, 0).toFixed(0)} K surface`);
}

// 13 ─ the tone map and the exposure (optics.js toneMap, adaptExposure)
async function toneTests() {
  const O = await import('./optics.js');
  let mono = true, prev = -1, neutral = true;
  for (let e = -12; e <= 6; e += 0.25) { const v = Math.pow(2, e), d = O.toneMap([v, v, v]); if (d[0] < prev - 1e-9) mono = false; prev = d[0]; if (Math.abs(d[0] - d[1]) > 1e-9 || Math.abs(d[1] - d[2]) > 1e-9) neutral = false; }
  const grey = O.toneMap([0.18, 0.18, 0.18])[0], z = O.toneMap([0, 0, 0]);
  const hot = [1500, 2000, 2500, 3000, 4000].map(T => { const c = O.blackbodyRGB(T), L = O.glowRadiance(T), d = O.toneMap(c.map(x => x * L)); return { T, d }; });
  const okHot = hot.every(h => h.d[0] >= h.d[1] && h.d[1] >= h.d[2] && Math.max(...h.d) < 0.99) && hot.filter(h => h.T <= 2500).every(h => h.d[1] / h.d[0] < 0.8);
  ok('13 tone map: neutral and rising for grey, 0.18 -> about 0.55, hot melt stays orange (no channel clips, green under 0.8 red to 2500 K)', mono && neutral && Math.abs(grey - 0.55) < 0.03 && z.every(v => v === 0) && okHot,
    `0.18 -> ${grey.toFixed(3)}; ${hot.map(h => h.T + ' K ' + h.d.map(v => v.toFixed(2)).join('/')).join(', ')}`);
  const E = O.EXPOSE, first = O.adaptExposure(0, 0.05, 0.016);
  let x = 1; for (let k = 0; k < 600; k++) x = O.adaptExposure(x, 3.0, 1 / 60);
  let y = 1; for (let k = 0; k < 600; k++) y = O.adaptExposure(y, 1e-5, 1 / 60);
  const half = O.adaptExposure(1, E.key / 0.75, E.tau * Math.LN2);
  ok('13 exposure: first frame jumps to the aim, a bright frame pulls it down to min, a dark one up to max, half way in tau ln 2', Math.abs(first - Math.min(E.max, E.key / 0.05)) < 1e-9 && Math.abs(x - E.min) < 1e-3 && Math.abs(y - E.max) < 1e-3 && Math.abs(half - 0.875) < 1e-9,
    `first ${first.toFixed(2)}, bright (mean lum 3) ${x.toFixed(3)}, dark ${y.toFixed(3)}, after tau ln 2 from 1 toward 0.75: ${half.toFixed(3)}`);
}

async function presetTests() {
  let bad = [], minT = Infinity, maxT = 0;
  for (const p of [...PRESETS, randomScenario(1), randomScenario(2), randomScenario(99)]) {
    const s = buildScenario(p, 8192, 1), tc = s.impact.tContact * UNIT.T / 60;
    minT = Math.min(minT, tc); maxT = Math.max(maxT, tc);
    if (!p.src || !p.title || s.N !== 8192 || !(tc > 1 && tc < 20) || s.bodies.some(b => b.n < 400)) bad.push(p.key);
  }
  ok('7 presets build, with sources, contact in 1-20 min', bad.length === 0, `${PRESETS.length} presets, contact ${minT.toFixed(1)}-${maxT.toFixed(1)} min${bad.length ? ', bad: ' + bad.join(' ') : ''}`);
  // the dense random draw: 300 seeds
  {
    const pairs = new Set(), titles = new Set(), comps = new Set(); let badR = [], b2 = 0, fast = 0, lo = 99, hi = 0;
    for (let sd = 1; sd <= 300; sd++) {
      const sc = randomScenario(sd), st = buildScenario(sc, 8192, 1), tc = st.impact.tContact * UNIT.T / 60;
      lo = Math.min(lo, tc); hi = Math.max(hi, tc);
      pairs.add(sc.bodies[0].key + '/' + sc.bodies[1].key); titles.add(sc.title); comps.add(sc.draw.cT); comps.add(sc.draw.cI);
      b2 += sc.impact.b ** 2 / 300; if (sc.impact.vRel >= 2.6) fast++;
      if (!(tc > 1 && tc < 20) || st.bodies.some(b => b.n < 400) || st.N !== 8192 || !/^[A-Z]/.test(sc.title)) badR.push(sd);
    }
    const same = JSON.stringify(randomScenario(42)) === JSON.stringify(randomScenario(42));
    ok('7 random draws: 300 seeds build, contact 1-20 min, many pairs, isotropic angles', badR.length === 0 && same && pairs.size >= 30 && titles.size >= 200 && comps.size >= 5 && Math.abs(b2 - 0.5) < 0.06 && fast > 15,
      `contact ${lo.toFixed(1)}-${hi.toFixed(1)} min, ${pairs.size} body pairs, ${titles.size} titles, ${comps.size} compositions, mean b^2 ${b2.toFixed(3)} (isotropic 0.5), ${fast} fast draws${badR.length ? ', bad: ' + badR.join(' ') : ''}`);
    // a composition override reaches the particles (build.js "layers")
    const ir = buildScenario({ bodies: [{ key: 'mars', layers: [['iron', 0.5], ['basalt', 0.5]] }], impact: {} }, 4000, 1);
    const re = buildScenario({ bodies: [{ key: 'mars' }], impact: {} }, 4000, 1);
    let fe = 0, ba = 0; for (let k = 0; k < ir.N; k++) { if (ir.mat[k] === 0) fe++; if (ir.mat[k] === 2) ba++; }
    ok('7 a composition override changes the body', Math.abs(fe / ir.N - 0.5) < 0.01 && Math.abs(ba / ir.N - 0.5) < 0.01 && ir.bodies[0].R < re.bodies[0].R,
      `iron ${(fe / ir.N).toFixed(3)}, basalt ${(ba / ir.N).toFixed(3)}; R ${(ir.bodies[0].R * UNIT.L / 1e3).toFixed(0)} km (as measured ${(re.bodies[0].R * UNIT.L / 1e3).toFixed(0)} km)`);
  }
  let over = [];
  for (const [k, p] of Object.entries(BG.PROFILES)) { const lim = k.startsWith('phone') ? BG.LIMIT.touch : BG.LIMIT.desktop; if (BG.gpuBytes(p.N) > lim) over.push(k); }
  const ph = BG.pickProfile({ phone: true });
  // the info panel states the counts the page really uses (main.js passes no quality)
  const html = (await import('node:fs')).readFileSync(new URL('./index.html', import.meta.url), 'utf8'), fmt = n => n.toLocaleString('en-US');
  const said = html.includes(fmt(ph.N) + ' particles on a phone') && html.includes(fmt(BG.pickProfile({}).N) + ' on a computer');
  ok('7 the info panel states the real particle counts', said, said ? `${fmt(ph.N)} phone, ${fmt(BG.pickProfile({}).N)} computer` : 'index.html counts differ from budget.js pickProfile');
  ok('7 profile bytes under LIMIT; a phone gets <= 12288', over.length === 0 && ph.N <= 12288, `phone ${ph.N} (${(BG.gpuBytes(ph.N) / 1e6).toFixed(1)} MB), desktop ${BG.pickProfile({}).N}${over.length ? ', over: ' + over.join(' ') : ''}`);
  const fs = await import('node:fs');
  const files = fs.readdirSync(new URL('./shaders/', import.meta.url)).filter(f => f.endsWith('.wgsl')).sort();
  const mix = [];
  for (const f of files) {
    const w = fs.readFileSync(new URL('./shaders/' + f, import.meta.url), 'utf8').split('\n');
    w.forEach((l, i) => { if (!l.trim().startsWith('//') && l.includes('&&') && l.includes('||')) mix.push(f + ':' + (i + 1)); });
  }
  ok('8 WGSL: no line mixes && with ||', mix.length === 0, mix.join(', ') || `none in ${files.length} files`);
  // naga on each module as the GPU sees it (render shaders after common.wgsl)
  const naga = (await import('node:os')).homedir() + '/.cargo/bin/naga';
  if (fs.existsSync(naga)) {
    const { spawnSync } = await import('node:child_process');
    const tmp = fs.mkdtempSync((await import('node:os')).tmpdir() + '/pc-naga-'), bad = [];
    const src = f => fs.readFileSync(new URL('./shaders/' + f, import.meta.url), 'utf8');
    for (const f of files.filter(f => f !== 'common.wgsl' && f !== 'scene.wgsl')) {
      // as render.js builds them: the scene pass gets common + scene
      const pre = ['shade.wgsl', 'debris.wgsl'].includes(f) ? src('common.wgsl') + '\n' + src('scene.wgsl') + '\n' : ['fluid.wgsl', 'smooth.wgsl', 'vol.wgsl', 'march.wgsl', 'smoke.wgsl'].includes(f) ? src('common.wgsl') + '\n' : '';
      const code = pre + src(f);
      fs.writeFileSync(tmp + '/' + f, code);
      const r = spawnSync(naga, [tmp + '/' + f], { encoding: 'utf8' });
      if (r.status !== 0) bad.push(f + ': ' + (r.stderr || r.stdout).trim().split('\n').slice(0, 3).join(' '));
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    ok('8 naga validates every shader module', bad.length === 0, bad.join(' | ') || files.filter(f => f !== 'common.wgsl' && f !== 'scene.wgsl').join(', '));
  } else console.log('SKIP  8 naga: ~/.cargo/bin/naga is not installed');
}

// G ─ GPU against CPU (Deno WebGPU)
async function gpuTests() {
  if (typeof navigator === 'undefined' || !navigator.gpu) { console.log('SKIP  GPU tests: no navigator.gpu here'); return; }
  const { SphGPU } = await import('./engine.js');
  const code = await Deno.readTextFile(new URL('./shaders/sph.wgsl', import.meta.url));
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) { console.log('SKIP  GPU tests: no adapter'); return; }
  const device = await adapter.requestDevice();
  const errs = []; device.addEventListener?.('uncapturederror', e => errs.push(String(e.error?.message || e)));
  // two bodies in contact range, with a velocity field, so every term acts
  const st = buildScenario({ bodies: [{ key: 'mars' }, { key: 'moon' }], impact: { vRel: 1.2, b: 0.5, d0: 1.02 } }, 1500, 4);
  for (let i = 0; i < 3 * st.N; i++) st.vel[i] = 0.05 * Math.sin(i * 1.7);
  const prm = makeParams(st, { KG: 1 });
  const cpu = new CpuSPH(st, prm); cpu.prime();
  const g = await SphGPU.create(device, 2048, code); g.upload(st, prm); g.prime();
  const rb = await g.readback(['pos', 'vel', 'th', 'aux', 'acc', 'grav', 'uu']);
  const err = (f, fc) => { let n = 0, d = 0; for (let i = 0; i < st.N; i++) { const a = f(i), b = fc(i); n += (a - b) ** 2; d += b * b; } return Math.sqrt(n / d); };
  const E = {
    rho: err(i => rb.th[4 * i], i => cpu.rho[i]), P: err(i => rb.th[4 * i + 1], i => cpu.P[i]), c: err(i => rb.th[4 * i + 2], i => cpu.cs[i]),
    bal: err(i => rb.th[4 * i + 3], i => cpu.bal[i]), a: err(i => rb.acc[4 * i], i => cpu.a[3 * i]), du: err(i => rb.acc[4 * i + 3], i => cpu.du[i]),
    g: err(i => rb.grav[8 * i + 1], i => cpu.g[3 * i + 1]), phi: err(i => rb.grav[8 * i + 3], i => cpu.phi[i]),
    T: err(i => rb.aux[4 * i], i => cpu.T[i]), hN: err(i => rb.aux[4 * i + 1], i => cpu.hn[i]),
  };
  let nOd = 0, nOs = 0; for (let i = 0; i < st.N; i++) { nOd = Math.max(nOd, Math.abs(rb.aux[4 * i + 2] - cpu.nOther[i])); nOs += cpu.nOther[i]; }
  const eMax = Math.max(...Object.values(E));
  ok('G primed fields = CPU (1500 particles, bodies in contact)', eMax < 1e-4 && nOd === 0 && nOs > 0, Object.entries(E).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ') + `; nOther exact (${nOs} cross pairs)`);
  ok('G first time step = CPU', rel(rb.ctl.dt, cpu.dt) < 1e-4, `GPU ${rb.ctl.dt.toExponential(5)} CPU ${cpu.dt.toExponential(5)}`);
  cpu.run(20); g.step(20);
  const r2 = await g.readback(['pos', 'vel']);
  let dx = 0; for (let i = 0; i < st.N; i++) for (let c = 0; c < 3; c++) dx = Math.max(dx, Math.abs(r2.pos[4 * i + c] - cpu.x[3 * i + c]));
  ok('G 20 steps = CPU', dx < 1e-5 && rel(r2.ctl.t, cpu.t) < 1e-4, `max |dx| ${dx.toExponential(2)} R_E (h ${prm.hmax.toFixed(3)}), t GPU ${r2.ctl.t.toFixed(6)} CPU ${cpu.t.toFixed(6)}`);
  g.destroy();
  // energy over 300 steps of a spinning settled body, relax and launch on the GPU
  { const st2 = buildScenario({ bodies: [{ key: 'earth', spinH: 8 }], impact: {} }, 4000, 9), p2 = makeParams(st2, { KG: 1 });
    const G = await SphGPU.create(device, 4096, code); G.upload(st2, p2);
    for (let k = 0; k < 6; k++) G.relaxSteps(25);
    G.launch();
    const en = r => { let K = 0, U = 0, W = 0, Lz = 0; for (let i = 0; i < G.n; i++) { const m = r.vel[4 * i + 3]; K += 0.5 * m * (r.vel[4 * i] ** 2 + r.vel[4 * i + 1] ** 2 + r.vel[4 * i + 2] ** 2); U += m * r.uu[i]; W += 0.5 * m * r.grav[8 * i + 3]; Lz += m * (r.pos[4 * i] * r.vel[4 * i + 1] - r.pos[4 * i + 1] * r.vel[4 * i]); } return { K, U, W, E: K + U + W, Lz }; };
    const a = await G.readback(['pos', 'vel', 'uu', 'grav']), A = en(a);
    // launched spin: v = W x r about the body centre (X = 0)
    const w = p2.bodies[0].W[2]; let sv = 0; for (let i = 0; i < G.n; i++) sv = Math.max(sv, Math.abs(a.vel[4 * i] + w * a.pos[4 * i + 1]) + Math.abs(a.vel[4 * i + 1] - w * a.pos[4 * i]));
    ok('G launch gives v = W x r', sv < 1e-5, `max |v - W x r| ${sv.toExponential(2)}, spin 8 h`);
    for (let k = 0; k < 6; k++) G.step(50);
    const b = await G.readback(['pos', 'vel', 'uu', 'grav']), B = en(b);
    ok('G energy and L_z over 300 GPU steps (KG = 1)', Math.abs(B.E - A.E) / Math.abs(A.W) < 1e-4 && Math.abs(B.Lz - A.Lz) / Math.abs(A.Lz) < 1e-3,
      `|dE|/|W| ${(Math.abs(B.E - A.E) / Math.abs(A.W)).toExponential(2)}, |dLz|/|Lz| ${(Math.abs(B.Lz - A.Lz) / Math.abs(A.Lz)).toExponential(2)}, ${(b.ctl.t * UNIT.T / 3600).toFixed(2)} h`);
    const S = await G.stats();
    let cx = 0; for (let i = 0; i < G.n; i++) cx += b.pos[4 * i];
    ok('G stats: counts, centre, nothing unbound, no melt', S.count[0] === G.n && S.unbound[0] === 0 && Math.abs(S.com[0][0] - cx / G.n) < 0.01 && S.melt === 0,
      `count ${S.count[0]}, com x ${S.com[0][0].toFixed(4)} (readback ${(cx / G.n).toFixed(4)}), unbound ${S.unbound[0]}, melt ${S.melt}, max T ${S.maxT.toFixed(0)} K, max P ${S.maxPGPa.toFixed(0)} GPa`);
    G.destroy(); }
  if (ARGS.includes('--time')) {
    for (const N of [16384, 32768, 49152]) {
      const s3 = buildScenario(PRESETS[0], N, 2), p3 = makeParams(s3, { KG: 4 });
      const G = await SphGPU.create(device, N, code); G.upload(s3, p3); G.relaxSteps(8); G.launch(); await G.stats();
      const t0 = performance.now(); G.step(40); await G.stats();
      console.log(`INFO  ${N} particles, KG 4: ${((performance.now() - t0) / 40).toFixed(2)} ms per step (${adapter.info?.description || 'adapter'})`);
      G.destroy();
    }
  }
  ok('G no WebGPU validation errors', errs.length === 0, errs.slice(0, 3).join(' | ') || 'none');
  device.destroy();
}

// R ─ the renderer (Deno WebGPU, offscreen)
async function renderTests() {
  if (typeof navigator === 'undefined' || !navigator.gpu) { console.log('SKIP  render tests: no navigator.gpu here'); return; }
  const { SphGPU } = await import('./engine.js');
  const { Renderer, loadRenderCode, defaultFrame, classify } = await import('./render.js');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) { console.log('SKIP  render tests: no adapter'); return; }
  const device = await adapter.requestDevice();
  const errs = []; device.addEventListener?.('uncapturederror', e => errs.push(String(e.error?.message || e)));
  const N = 8000, W = 320, H = 200;
  const sim = await SphGPU.create(device, N, await Deno.readTextFile(new URL('./shaders/sph.wgsl', import.meta.url)));
  const setup = buildScenario(PRESETS.find(p => p.key === 'moon-graze'), N, 3);
  sim.upload(setup, makeParams(setup, { KG: 4 }));
  for (let k = 0; k < 10; k++) sim.relaxSteps(20);
  sim.launch();
  const tex = device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const ren = new Renderer(device, { getCurrentTexture: () => tex }, 'rgba8unorm', await loadRenderCode(u => Deno.readTextFile(u)));
  const msgs = (await ren.compilationMessages()).filter(m => / error /.test(m));
  ok('R every render shader compiles with no error', msgs.length === 0, msgs.slice(0, 3).join(' | ') || 'common + fluid, smooth, shade, debris; centres; post');
  ren.attach(sim, setup); ren.resize(W, H);
  const readTex = async (t, bpp, w, h) => {
    const bpr = Math.ceil(w * bpp / 256) * 256, buf = device.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder(); enc.copyTextureToBuffer({ texture: t }, { buffer: buf, bytesPerRow: bpr }, [w, h]); device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ); const a = buf.getMappedRange().slice(0); buf.unmap(); buf.destroy(); return { a, bpr };
  };
  const readBuf = async (src, n) => { const b = device.createBuffer({ size: n, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }), e = device.createCommandEncoder(); e.copyBufferToBuffer(src, 0, b, 0, n); device.queue.submit([e.finish()]); await b.mapAsync(GPUMapMode.READ); const a = b.getMappedRange().slice(0); b.unmap(); b.destroy(); return a; };
  const rgb = async () => { const { a, bpr } = await readTex(tex, 4, W, H), px = new Uint8Array(a); return (x, y) => { const o = y * bpr + 4 * x; return [px[o], px[o + 1], px[o + 2]]; }; };
  // a settled body is all fluid: its surface layer is not debris (a test
  // on h took 1415 surface particles of Earth for debris here: they sit at
  // the h_max clamp)
  { const n0 = 16384, s0 = await SphGPU.create(device, n0, await Deno.readTextFile(new URL('./shaders/sph.wgsl', import.meta.url)));
    const su0 = buildScenario(PRESETS.find(p => p.key === 'moon-earth'), n0, 1);
    s0.upload(su0, makeParams(su0, { KG: 4 })); for (let k = 0; k < 10; k++) s0.relaxSteps(20); s0.launch();
    const rb0 = await s0.readback(['pos', 'vel', 'aux', 'tag', 'th']), c0 = classify(rb0, s0.n, s0.prm.hmax, {});
    ok('R before contact: no settled particle is debris (fn klass)', c0.debris === 0 && c0.vapour === 0, `moon-earth ${n0}: fluid ${c0.fluid}, debris ${c0.debris}, vapour ${c0.vapour}`);
    // the remnant after the impact is not a white blob: run on to 1 h and
    // 3 h after contact, frame it as the page does (view.js), and count
    // the near-white pixels in its disc (the radius of the target). Wall
    // heating puts 5000-20000 K on the surface; the skin cap, the soft
    // limit of fn glow and the crust keep it orange-red.
    const Wb = 320, Hb = 200, tb = device.createTexture({ size: [Wb, Hb], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const rb2 = new Renderer(device, { getCurrentTexture: () => tb }, 'rgba8unorm', await loadRenderCode(u => Deno.readTextFile(u)));
    rb2.attach(s0, su0); rb2.resize(Wb, Hb);
    let tc = null, st0 = null;
    const shots = [];
    for (const goal of [0.25, 1, 3]) {
      for (let k = 0; k < 2000; k++) {
        s0.step(20); st0 = null; while (!st0) st0 = await s0.stats();
        if (tc == null && st0.touching > 0) tc = st0.t;
        if (tc != null && (st0.t - tc) * UNIT.T / 3600 >= goal) break;
      }
      const hrs = tc == null ? -1 : (st0.t - tc) * UNIT.T / 3600, B = su0.bodies.map((b, i) => ({ c: st0.com[i] || b.X, R: b.R }));
      const g = defaultFrame(), v = makeView(), ft = frameTarget(B, hrs, g.fov, Wb / Hb);
      v.target = ft.target; v.dist = ft.dist;
      Object.assign(g, { eye: eyeOf(v), target: v.target, sun: [1, 0.25, 0.3], coolH: hrs, streakT: 4 * st0.dt, bodies: [0, 1, 2, 3].map(() => ({ atm: 0, shadow: 0 })) });
      rb2.render(g);
      const { a, bpr } = await readTex(tb, 4, Wb, Hb), px = new Uint8Array(a);
      const c = rb2.project(B[0].c, Wb, Hb), rr = rb2.focal * B[0].R / Math.hypot(...B[0].c.map((x, j) => x - g.eye[j]));
      let inD = 0, white = 0, hot = 0, dark = 0, bright = 0, lum = 0;
      for (let y = 0; y < Hb; y++) for (let x = 0; x < Wb; x++) {
        if (Math.hypot(x - c.x, y - c.y) >= rr) continue;
        const o = y * bpr + 4 * x, r = px[o], gg = px[o + 1], b = px[o + 2];
        inD++; if (r > 235 && gg > 235 && b > 220) white++; if (r > 120 && r > gg + 30 && gg >= b) hot++;
        if (r + gg + b < 75) dark++; if (r > 200 && gg > 90 && r > gg && gg > b) bright++; lum += r + gg + b;
      }
      const k = Math.max(inD, 1);
      shots.push({ goal, hrs, white: white / k, hot: hot / k, dark: dark / k, bright: bright / k, lum: lum / k / 3, inD });
    }
    // the exposure adapts on the GPU (post.wgsl cs_expose): the bright
    // remnant over 2 s of frames pulls it under 1, within EXPOSE
    { const { EXPOSE } = await import('./optics.js'), g = defaultFrame(), v = makeView(), B = su0.bodies.map((b, i) => ({ c: st0.com[i] || b.X, R: b.R })), ft = frameTarget(B, 0.25, g.fov, Wb / Hb);
      v.target = ft.target; v.dist = 0.5 * ft.dist;
      Object.assign(g, { eye: eyeOf(v), target: v.target, sun: [1, 0.25, 0.3], coolH: 0.25, bodies: [0, 1, 2, 3].map(() => ({ atm: 0, shadow: 0 })) });
      for (let k = 0; k < 120; k++) { g.time = 100 + k / 60; rb2.render(g); }
      const e = new Float32Array(await readBuf(rb2.expoBuf, 16));
      ok('R the exposure adapts to the lit pixels (cs_expose): the glowing remnant pulls it under 1, within its bounds', e[0] >= EXPOSE.min - 1e-4 && e[0] < 1 && Math.abs(e[0] - e[2]) < 0.2 * e[2] + 0.02 && e[1] > EXPOSE.key,
        `exposure ${e[0].toFixed(3)} (aim ${e[2].toFixed(3)}), bright-weighted mean luminance ${e[1].toFixed(3)}; bounds ${EXPOSE.min}-${EXPOSE.max}`);
      g.adapt = false; rb2.render(g); }
    ok('R the remnant at +0.25, +1 and +3 h is not a white blob, and it glows', tc != null && shots.every(q => q.white < 0.02 && q.hot > 0.02 && q.inD > 300),
      shots.map(q => `+${q.hrs.toFixed(2)} h: ${(100 * q.white).toFixed(1)} % near-white, ${(100 * q.hot).toFixed(1)} % orange-red of ${q.inD} disc px`).join('; '));
    // the lava skin alone (fn lavaSkin): the state at +3 h, framed the
    // same, drawn with coolH 0.05 h and 3 h, and at two wall times. In the
    // pixels that glow at 0.05 h: the light falls as the crust forms, the
    // crust is dark, the seams stay bright, and the pattern flows.
    { const g = defaultFrame(), v = makeView(), B = su0.bodies.map((b, i) => ({ c: st0.com[i] || b.X, R: b.R })), ft = frameTarget(B, 3, g.fov, Wb / Hb);
      v.target = ft.target; v.dist = 0.7 * ft.dist;
      Object.assign(g, { eye: eyeOf(v), target: v.target, sun: [1, 0.25, 0.3], sunI: 0.2, bodies: [0, 1, 2, 3].map(() => ({ atm: 0, shadow: 0 })), time: 10 });
      const shot = async (coolH, time) => { rb2.render(Object.assign({}, g, { coolH, time })); const { a, bpr } = await readTex(tb, 4, Wb, Hb); const p = new Uint8Array(a); return (x, y) => { const o = y * bpr + 4 * x; return [p[o], p[o + 1], p[o + 2]]; }; };
      const early = await shot(0.05, 10), late = await shot(3, 10), later = await shot(3, 14);
      let n = 0, l0 = 0, l3 = 0, dark = 0, seam = 0, moved = 0;
      for (let y = 0; y < Hb; y++) for (let x = 0; x < Wb; x++) {
        const a = early(x, y); if (!(a[0] > 90 && a[0] > a[2] + 30)) continue;
        const b = late(x, y), c = later(x, y); n++;
        l0 += a[0] + a[1] + a[2]; l3 += b[0] + b[1] + b[2];
        if (b[0] + b[1] + b[2] < 0.45 * (a[0] + a[1] + a[2])) dark++;
        if (b[0] > 150 && b[0] > b[1] && b[1] > b[2]) seam++;
        if (Math.abs(b[0] - c[0]) + Math.abs(b[1] - c[1]) + Math.abs(b[2] - c[2]) > 24) moved++;
      }
      ok('R the lava skins over as it cools: dark crust, bright seams, flowing', n > 200 && l3 < 0.75 * l0 && dark > 0.25 * n && seam > 0.02 * n && moved > 0.05 * n,
        `${n} glowing px at +0.05 h: light ${(l0 / n / 3).toFixed(0)} -> ${(l3 / n / 3).toFixed(0)} at +3 h; crust (under 45 % of the light) ${(100 * dark / n).toFixed(0)} %, bright seams ${(100 * seam / n).toFixed(1)} %, changed in 4 s of flow ${(100 * moved / n).toFixed(0)} %`); }
    rb2.destroy(); tb.destroy(); s0.destroy(); }
  const scan = at => { let glow = 0, lit = 0, s = [0, 0, 0]; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = at(x, y); if (c[0] > 150 && c[0] > c[1] + 30 && c[1] > c[2]) glow++; if (c[0] + c[1] + c[2] > 60) { lit++; s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; } } return { glow, lit, mean: s.map(v => lit ? v / lit : 0) }; };
  // before contact: look at the target from 4 radii, the impactor out of view
  const f = defaultFrame(), X0 = setup.bodies[0].X, R0 = setup.bodies[0].R;
  f.eye = [X0[0], X0[1] - 4 * R0, X0[2]]; f.target = X0; f.fov = 0.7;
  ren.render(f); let at = await rgb();
  const ctr = ren.project(X0, W, H), rpx = ren.focal * R0 / (4 * R0);
  const cIn = at(Math.round(ctr.x), Math.round(ctr.y)), cOut = at(Math.min(W - 1, Math.round(ctr.x + 1.35 * rpx)), Math.round(ctr.y));
  const pre = scan(at);
  ok('R before contact: the target fills its disc, dark sky outside, no glow', cIn[0] + cIn[1] + cIn[2] > 90 && cOut[0] + cOut[1] + cOut[2] < 60 && pre.glow === 0,
    `centre rgb ${cIn.join(',')}, 1.35 R out ${cOut.join(',')}, ${pre.glow} glowing px, disc ${rpx.toFixed(0)} px`);
  // vapour is a volume (smoke.wgsl): draw every particle of the settled
  // target as vapour (xvLo -2, xvHi -1; no drawn atmosphere). At 300 K it
  // is cold dust: a cloud that shades itself (the light march). Lit from
  // the eye's side it is bright; lit from behind, the disc is dark but
  // for the forward-scattered rim; never a white fog.
  { const disc = async sun => { const g = Object.assign({}, f, { sun, xvLo: -2, xvHi: -1, bodies: [0, 1, 2, 3].map(() => ({ atm: 0, shadow: 0 })) }); for (let k = 0; k < 6; k++) ren.render(g); const at2 = await rgb();
      let n = 0, white = 0, sum = 0, rim = 0, nr = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = at2(x, y), l = (c[0] + c[1] + c[2]) / 3, r = Math.hypot(x - ctr.x, y - ctr.y);
        if (r < 0.6 * rpx) { n++; sum += l; if (c[0] > 235 && c[1] > 235) white++; } else if (r < 1.05 * rpx) { rim += l; nr++; } }
      return { n, white, mean: sum / Math.max(n, 1), rim: rim / Math.max(nr, 1) }; };
    const front = await disc([0.3, -0.9, 0.3]), back = await disc([-0.3, 0.9, -0.3]);
    ok('R an all-vapour body is a self-shadowed cloud: bright lit from the front, dark lit from behind', front.n > 100 && front.white < 0.02 * front.n && front.mean > 40 && back.mean < 0.5 * front.mean,
      `centre mean ${front.mean.toFixed(0)} lit from the eye's side, ${back.mean.toFixed(0)} lit from behind (rim ${back.rim.toFixed(0)}); ${front.white} near-white of ${front.n} px`); }
  // the surface of a settled body before contact: one smooth planet, not
  // a heap of particle spheres. A close view (960 x 600, 3 radii) drawn
  // with the density volume (f.grid 144) and with the old particle
  // spheres (f.grid 0): the second difference of the view depth and of
  // the normal map along x over the disc (a facet or a particle bump is a
  // spike there), and the spread of the limb radius in px.
  const W2 = 960, H2 = 600;
  ren.resize(W2, H2); f.eye = [X0[0], X0[1] - 3 * R0, X0[2]];
  const ctr2 = () => ren.project(X0, W2, H2), rpx2 = () => ren.focal / 3;
  const sd = a => { const m = a.reduce((p, q) => p + q, 0) / a.length; return Math.sqrt(a.reduce((p, q) => p + (q - m) ** 2, 0) / a.length); };
  const surfStats = async grid => {
    ren.render(Object.assign({}, f, { grid }));
    const zr = new Float32Array((await readTex(ren.rawZ, 8, W2, H2)).a), nr0 = await readTex(ren.nrm, 8, W2, H2);
    const nr = new Uint16Array(nr0.a), half = h => { const s = h >> 15 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023; return e ? s * Math.pow(2, e - 15) * (1 + m / 1024) : s * Math.pow(2, -14) * (m / 1024); };
    const bz = Math.ceil(W2 * 8 / 256) * 256 / 8, bn = nr0.bpr / 8, c = ctr2(), rp = rpx2();
    const z = (x, y) => zr[(y * bz + x) * 2], n = (x, y, k) => half(nr[(y * bn + x) * 4 + k]);
    let d2z = 0, d2n = 0, cnt = 0, cov = 0; const limb = [];
    for (let y = 1; y < H2 - 1; y++) for (let x = 1; x < W2 - 1; x++) {
      const r = Math.hypot(x - c.x, y - c.y);
      if (z(x, y) > 0) { cov++; if ((z(x + 1, y) <= 0 || z(x - 1, y) <= 0 || z(x, y + 1) <= 0 || z(x, y - 1) <= 0) && Math.abs(r - rp) < 0.25 * rp) limb.push(r); }
      if (r > 0.85 * rp || !(z(x - 1, y) > 0 && z(x, y) > 0 && z(x + 1, y) > 0)) continue;
      d2z += Math.abs(z(x - 1, y) - 2 * z(x, y) + z(x + 1, y));
      for (let k = 0; k < 3; k++) d2n += Math.abs(n(x - 1, y, k) - 2 * n(x, y, k) + n(x + 1, y, k));
      cnt++;
    }
    return { d2z: d2z / Math.max(cnt, 1), d2n: d2n / Math.max(cnt, 1), cnt, cov, limb: sd(limb) };
  };
  const sv = await surfStats(144), cellV = ren.volBox ? ren.volBox.cell : 0, ss = await surfStats(0);
  ok('R before contact: the volume surface is one smooth body, no particle bumps or cell facets', sv.cnt > 1000 && sv.d2n < 0.25 * ss.d2n && sv.d2z < 0.5 * ss.d2z && sv.limb < 0.8 * ss.limb && Math.abs(sv.cov - ss.cov) < 0.12 * ss.cov && sv.d2n < 0.02,
    `normal 2nd diff ${sv.d2n.toExponential(2)} (spheres ${ss.d2n.toExponential(2)}), depth 2nd diff ${sv.d2z.toExponential(2)} (spheres ${ss.d2z.toExponential(2)}), limb spread ${sv.limb.toFixed(2)} px (spheres ${ss.limb.toFixed(2)}), covered px ${sv.cov} (spheres ${ss.cov}); disc ${rpx2().toFixed(0)} px, grid 144, cell ${cellV.toFixed(4)} R_E`);
  // the cutaway on the volume: the plane through the centre gives a flat
  // face (flag 1) over much of the disc
  { ren.render(Object.assign({}, f, { grid: 144, cut: { on: true, n: [0, -1, 0], d: X0[1] * -1 } }));
    const zr = new Float32Array((await readTex(ren.rawZ, 8, W2, H2)).a), bz = Math.ceil(W2 * 8 / 256) * 256 / 8, c = ctr2(), rp = rpx2();
    let disc = 0, face = 0;
    for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) { if (Math.hypot(x - c.x, y - c.y) > 0.8 * rp) continue; disc++; if (zr[(y * bz + x) * 2 + 1] > 0.5) face++; }
    ok('R the cutaway cuts the volume surface flat', face > 0.6 * disc, `${face} of ${disc} disc px on the cut face`); }
  ren.resize(W, H);
  // run through the grazing hit; watch from the side
  f.eye = [0.6, -7, 2.0]; f.target = [0, 0, 0]; f.streakT = 0.05;
  let cls = null, st = null;
  for (let k = 0; k < 12; k++) { for (let j = 0; j < 10; j++) sim.step(20); st = await sim.stats(); if (st.tSec > 1.4 * 3600) break; }
  const rb = await sim.readback(['pos', 'vel', 'aux', 'tag', 'th']);
  cls = classify(rb, sim.n, sim.prm.hmax, f);
  ok('R a grazing hit makes debris fragments (fn classify)', cls.debris > 0.01 * sim.n && cls.fluid > 0.8 * sim.n,
    `t ${(st.tSec / 3600).toFixed(2)} h: fluid ${cls.fluid}, debris ${cls.debris}, vapour ${cls.vapour}`);
  ren.render(f); at = await rgb();
  const post = scan(at);
  // the HDR image has no spikes: a far drop is a sub-pixel sphere, and
  // the plain quadratic hit put |n| over 1 there (a specular of 2052)
  { f.frags = 10; ren.render(f);
    const bpr = Math.ceil(W * 8 / 256) * 256, raw = new Uint16Array((await readTex(ren.hdr, 8, W, H)).a);
    const half = h => { const ex = (h >> 10) & 31, m = h & 1023; if (ex === 31) return m ? NaN : Infinity; return (h >> 15 ? -1 : 1) * (ex ? Math.pow(2, ex - 15) * (1 + m / 1024) : Math.pow(2, -14) * (m / 1024)); };
    let mx = 0, bad = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let k = 0; k < 3; k++) { const v = half(raw[y * bpr / 2 + 4 * x + k]); if (!Number.isFinite(v)) bad++; else mx = Math.max(mx, v); }
    ok('R debris drops: no NaN or spike in the HDR image', bad === 0 && mx < 50, `max ${mx.toFixed(2)} (scene units), ${bad} NaN or Inf, ${cls.debris} debris particles x 10 drops`); }
  ok('R after contact: hot melt glows (red > green > blue pixels)', post.glow > 20, `${post.glow} glowing px, ${post.lit} lit px`);
  const means = [];
  for (const m of [0, 1, 2, 3, 4]) { f.mode = m; ren.render(f); means.push(scan(await rgb()).mean); }
  let minD = 1e9; for (let i = 0; i < means.length; i++) for (let j = i + 1; j < means.length; j++) minD = Math.min(minD, Math.hypot(...means[i].map((v, c) => v - means[j][c])));
  ok('R the five colour modes give five different images', minD > 4, `smallest mean-colour distance ${minD.toFixed(1)}; means ${means.map(c => c.map(v => v.toFixed(0)).join('/')).join(' ')}`);
  f.mode = 0; ren.render(f); const at0 = await rgb();
  f.cut = { on: true, n: [0, -1, 0], d: 0 };
  ren.render(f); const at1 = await rgb(), cut = scan(at1);
  let changed = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const a = at0(x, y), b = at1(x, y); if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 30) changed++; }
  ok('R the cutaway changes the image', changed > 0.05 * post.lit,
    `${changed} px changed of ${post.lit} lit; lit px ${post.lit} -> ${cut.lit}, mean ${means[0].map(v => v.toFixed(0)).join('/')} -> ${cut.mean.map(v => v.toFixed(0)).join('/')}`);
  if (ARGS.includes('--time')) {
    for (const [n, w, h, grid] of [[32768, 1600, 900, 144], [12288, 780, 1688, 96]]) {
      const s2 = await SphGPU.create(device, n, await Deno.readTextFile(new URL('./shaders/sph.wgsl', import.meta.url)));
      const su = buildScenario(PRESETS[0], n, 2); s2.upload(su, makeParams(su, { KG: 4 })); s2.relaxSteps(5); s2.launch();
      const t2 = device.createTexture({ size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT });
      const r2 = new Renderer(device, { getCurrentTexture: () => t2 }, 'rgba8unorm', await loadRenderCode(u => Deno.readTextFile(u)));
      r2.attach(s2, su); r2.resize(w, h);
      const g = defaultFrame(); g.eye = [0.5, -4, 1]; g.streakT = 0.05; g.grid = grid;
      const B = su.bodies, fr = frameTarget(B.map(b => ({ c: b.X, R: b.R })), null, g.fov, w / h); g.vol = { c: fr.target, r: fr.rad };
      for (let k = 0; k < 3; k++) r2.render(g); await device.queue.onSubmittedWorkDone();
      let t0 = performance.now(); for (let k = 0; k < 20; k++) r2.render(g); await device.queue.onSubmittedWorkDone();
      const cached = (performance.now() - t0) / 20;
      t0 = performance.now(); for (let k = 0; k < 20; k++) { r2.volK = -1; r2.render(g); } await device.queue.onSubmittedWorkDone();
      const built = (performance.now() - t0) / 20;
      const z = Math.hypot(...g.eye), cellPx = r2.volBox.cell * r2.focal / z;
      console.log(`INFO  render ${n} particles at ${w}x${h}, volume ${grid}^3 (cell ${r2.volBox.cell.toFixed(4)} R_E, ${cellPx.toFixed(1)} px at the target): ${built.toFixed(2)} ms per frame with the volume built, ${cached.toFixed(2)} ms with it kept`);
      r2.destroy(); s2.destroy(); t2.destroy();
    }
  }
  ok('R no WebGPU validation errors', errs.length === 0, errs.slice(0, 3).join(' | ') || 'none');
  ren.destroy(); sim.destroy(); device.destroy();
}

// P ─ main.js in Deno with a stubbed DOM (no browser, no image file)
async function pageTest() {
  if (typeof navigator === 'undefined' || !navigator.gpu) { console.log('SKIP  page test: no navigator.gpu here'); return; }
  const els = new Map(), listeners = {}, errors = [];
  const el = id => {
    if (!els.has(id)) els.set(id, { id, hidden: false, textContent: '', innerHTML: '', value: '', style: {}, dataset: {}, width: 0, height: 0,
      classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, addEventListener() {}, setPointerCapture() {},
      querySelectorAll: () => [], getContext: () => ctxStub });
    return els.get(id);
  };
  let tex = null, device = null;
  const ctxStub = {
    configure(o) { device = o.device; tex = device.createTexture({ size: [320, 200], format: o.format, usage: GPUTextureUsage.RENDER_ATTACHMENT }); },
    getCurrentTexture: () => tex,
  };
  const rafQ = [];
  const G = globalThis, saved = {};
  const stub = { window: G, document: { getElementById: el, documentElement: { classList: { add() {}, remove() {}, toggle() {} } } }, matchMedia: () => ({ matches: false }), screen: { width: 1280, height: 800 },
    innerWidth: 320, innerHeight: 200, devicePixelRatio: 1, location: { href: 'http://x/pages/planet-collision/?run=moon-graze', search: '?run=moon-graze' },
    history: { replaceState() {} }, addEventListener: (k, f) => { (listeners[k] = listeners[k] || []).push(f); },
    requestAnimationFrame: f => rafQ.push(f), createImageBitmap: () => Promise.reject(new Error('no images in the test')) };
  for (const k of Object.keys(stub)) { saved[k] = Object.getOwnPropertyDescriptor(G, k); Object.defineProperty(G, k, { value: stub[k], configurable: true, writable: true }); }
  const realFetch = G.fetch;
  G.fetch = async url => { const u = String(url); if (u.endsWith('.jpg')) return { ok: false, status: 404 }; return { ok: true, text: () => Deno.readTextFile(new URL(u)) }; };
  const ce = console.error; console.error = (...a) => { errors.push(a.join(' ')); };
  try {
    const M = await import('./main.js?page-test');
    for (let k = 0; k < 400 && !G.__pc?.S?.sim && !errors.length; k++) await new Promise(r => setTimeout(r, 50));
    if (!G.__pc) { ok('P boot', false, errors.slice(0, 3).join(' | ') || 'no window.__pc after 20 s'); return; }
    const S = G.__pc.S;
    let t = 0;
    const pump = async n => { for (let k = 0; k < n; k++) { const f = rafQ.shift(); if (!f) break; t += 16.7; f(t); if (k % 6 === 5) await S.dev.queue.onSubmittedWorkDone(); } await S.dev.queue.onSubmittedWorkDone(); await new Promise(r => setTimeout(r, 30)); };
    await pump(12);
    const relaxed = S.phase === 'run';
    for (let k = 0; k < 60 && !S.contact; k++) await pump(12);
    const c = S.contact, fl = S.f.flashes[0];
    await pump(30);
    ok('P boot, relax, launch, first contact with a flash', relaxed && !!c && !!fl && fl.r > 0 && S.f.bodies[0].shadow < 1,
      `phase ${S.phase}, contact at ${c ? (c.simT * UNIT.T / 60).toFixed(1) + ' min' : 'none'}, flash r ${fl ? fl.r.toFixed(3) : '-'}, shadow ${S.f.bodies[0].shadow.toFixed(2)}, ${S.sim.n} particles`);
    const nums = el('nums').innerHTML;
    ok('P the numbers fill in', /Molten/.test(nums) && /J</.test(nums) && el('capTitle').textContent.length > 0, `title "${el('capTitle').textContent}"; ${nums.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)}`);
    // the outcome of a readback: the largest body, the disk, the escaping mass
    for (let k = 0; k < 40 && !S.out; k++) { t += 400; await pump(4); }
    const o = S.out, numsO = el('nums').innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    ok('P the outcome fills in from a readback', !!o && o.Mp / o.Mtot > 0.5 && Math.abs((o.Mp + o.Md + o.Me) / o.Mtot - 1) < 1e-6 && /Largest body \d/.test(numsO) && S.peak.T99 > 300,
      o ? `largest ${(100 * o.Mp / o.Mtot).toFixed(1)} %, disk ${(o.Md / M_MOON_T).toFixed(3)} M_moon, escaping ${(100 * o.Me / o.Mtot).toFixed(2)} %, T99 ${S.peak.T99.toFixed(0)} K` : 'no outcome');
    // slow motion: a quarter speed runs one step every second frame
    let nStep = 0; const step0 = S.sim.step.bind(S.sim); S.sim.step = n => { nStep += n; step0(n); };
    M.setSpeed(0.25); S.cap = 8; await pump(16); const slow = nStep; nStep = 0;
    M.setSpeed(2); await pump(16); const fast = nStep; S.sim.step = step0;
    ok('P slow motion: x1/4 runs 1/8 of the steps of x2', slow >= 7 && slow <= 9 && fast >= 4 * slow, `${slow} steps in 16 frames at x1/4, ${fast} at x2 (cap ${S.cap})`);
    // an aimed collision
    const aim = M.aimScenario({ t: 'earth', i: 'moon', ang: 30, v: 1.2, spin: '5', comp: 'ironRich' });
    G.__pc.startRun(aim, 1); await pump(14);
    ok('P an aimed collision builds and runs', S.sc.key === 'aim' && S.phase === 'run' && S.setup.bodies[1].key === 'moon' && Math.abs(S.setup.impact.theta - 30) < 1e-6 && !!S.arc && S.arc.imp.length > 10,
      `"${S.sc.title}", theta ${S.setup.impact.theta.toFixed(1)}, ${S.arc ? S.arc.imp.length : 0} arc points`);
    // the screensaver: enter, the approach, contact -> the slow-motion impact shot, the plate, a new run
    {
      const labels = [];
      const ret = await G.snSaver.enter({ seed: 7, calm: 0.5, label: l => labels.push(l) });
      const dbg = () => G.snSaver.debug();
      const seen = [];
      for (let k = 0; k < 120 && !(dbg().contact && dbg().shot === 'impact'); k++) { await pump(12); const d = dbg(); if (d.shot && seen[seen.length - 1] !== d.shot) seen.push(d.shot); }
      const d1 = dbg(), L = labels[labels.length - 1], an = L && L.anchor ? L.anchor() : null;
      ok('P saver: contact cuts to the slow-motion impact shot', ret && ret.canvas === el('gpu') && d1.shot === 'impact' && d1.speed === 0.25 && d1.fade > 0.5 && seen.join() === 'approach,impact',
        `run ${d1.run} "${d1.title}", shots ${seen.join(' > ')}, speed ${d1.speed}, fade ${d1.fade.toFixed(2)}, warp ${d1.warp.toFixed(0)} sim s per s`);
      ok('P saver: the plate has live numbers and TeX, no code', !!L && !('code' in L) && L.tex.length === 3 && L.params.length >= 5 && !!an && isFinite(an.x) && an.r > 0,
        L ? `"${L.title}" | ${L.params.map(p => p.name + ' ' + p.value).join('; ')} | ${L.lines[0]} | anchor ${an ? an.x.toFixed(0) + ',' + an.y.toFixed(0) + ' r ' + an.r.toFixed(0) : '-'}` : 'no label');
      const run1 = d1.run;
      for (let k = 0; k < 8; k++) { G.snSaver.cut(); await pump(2); }
      for (let k = 0; k < 40 && dbg().runs < 2; k++) await pump(6);
      for (let k = 0; k < 20 && dbg().state !== 'show'; k++) await pump(6);
      const d2 = dbg();
      ok('P saver: the take ends, fades out and a new run starts', d2.runs === 2 && d2.run !== run1 && d2.state === 'show' && d2.shot === 'approach',
        `run 2 ${d2.run} "${d2.title}", state ${d2.state}, shot ${d2.shot}, shots ${d2.shots.join(' ')}`);
      G.snSaver.exit();
      ok('P saver: exit hands the page back', S.dir === null && S.speed === 2, `dir ${S.dir}, speed ${S.speed}`);
    }
    G.__pc.startRun((await import('./scenarios.js')).presetByKey('theia'), 1); await pump(14);
    G.__pc.startRun((await import('./scenarios.js')).randomScenario(77), 77); await pump(14);
    ok('P a preset change and a random draw run', S.sc.key === 'random-77' && S.phase === 'run', `now "${S.sc.title}", phase ${S.phase}`);
    for (const f of listeners.pagehide || []) f();
    let reloads = 0; G.location.reload = () => { reloads++; };
    for (const f of listeners.pageshow || []) f({ persisted: true });
    ok('P pagehide frees the solver, the renderer and the device; a cache restore reloads', S.sim === null && S.dev === null && reloads === 1, `sim, ren, dev null; ${reloads} reload on pageshow (persisted)`);
    ok('P no errors on the page', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');
  } finally {
    console.error = ce; G.fetch = realFetch;
    for (const k of Object.keys(stub)) { if (saved[k]) Object.defineProperty(G, k, saved[k]); else delete G[k]; }
  }
}

if (!GPU_ONLY) {
  eosTests(); bodyTests(); geometryTests(); await presetTests(); analysisTests(); saverPlanTests(); cameraTests(); await volumeTests(); await opticsTests(); await toneTests(); cpuTests();
}
if (typeof Deno !== 'undefined') { await gpuTests(); await renderTests(); await pageTest(); }
else {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const d = spawnSync('deno', ['run', '-A', fileURLToPath(import.meta.url), '--gpu'], { encoding: 'utf8' });
  if (d.error) console.log('SKIP  GPU tests: deno is not installed (' + d.error.code + ')');
  else { process.stdout.write(d.stdout); if (d.stderr.trim()) process.stdout.write(d.stderr); if (d.status !== 0) fails++; }
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
if (typeof Deno !== 'undefined') { if (fails) Deno.exit(1); }
else process.exitCode = fails ? 1 : 0;
