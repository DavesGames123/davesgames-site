// ============================================================================
//  GRAVITY PLAYGROUND  ·  saver scene check  (Node, run by hand)
// ----------------------------------------------------------------------------
//  Runs every scene of saver-scenes.js for 1.5 saver holds with a copy of
//  the page integrator (computeForces + step in main.js: softening 4,
//  velocity Verlet, h = 0.01) and asserts:
//    - the energy drift |E − E0| / (K0 + |U0|) stays under 1e-3 (the
//      scale is K0 + |U0|, because E0 is near 0 for a parabolic pass)
//    - R0 is the largest distance of a framed body (no noframe) from the
//      frame centre (body sc.follow, else the origin) in the first third.
//      After that, no framed body goes past 2.5 R0, except a share
//      sc.escapeOk of them (tidal tails)
//    - each Trojan stays a tadpole: its angle from the planet never
//      reaches 0° or 180°
//  Run: node stella-nova/pages/gravity/saver-test.mjs
//  grep: function run  function forces  const HOLD
// ============================================================================
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { SCENES } = require('./saver-scenes.js');

const G = 1000, DT = 0.01, EPS = 4, HOLD = 10, FPS = 60;
const mk = (name, x, y, vx, vy, mass, radius, color, fixed) => ({ name, x, y, vx, vy, ax: 0, ay: 0, mass, radius, color, fixed: !!fixed });
function rng(seed) { return () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function forces(B, extra) {
  for (const b of B) { b.ax = 0; b.ay = 0; }
  for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
    const dx = B[j].x - B[i].x, dy = B[j].y - B[i].y, d2 = dx * dx + dy * dy, d = Math.sqrt(d2 + EPS), F = G / (d2 + EPS);
    B[i].ax += F * B[j].mass * dx / d; B[i].ay += F * B[j].mass * dy / d;
    B[j].ax -= F * B[i].mass * dx / d; B[j].ay -= F * B[i].mass * dy / d;
  }
  if (extra) extra(B);
}
function energy(B, pe) {
  let E = 0;
  for (const b of B) E += 0.5 * b.mass * (b.vx * b.vx + b.vy * b.vy);
  for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) E -= G * B[i].mass * B[j].mass / Math.sqrt((B[j].x - B[i].x) ** 2 + (B[j].y - B[i].y) ** 2 + EPS);
  return E + (pe ? pe(B) : 0);
}
function step(B, h, extra) {
  for (const b of B) if (!b.fixed) { b.vx += 0.5 * b.ax * h; b.vy += 0.5 * b.ay * h; b.x += b.vx * h; b.y += b.vy * h; }
  forces(B, extra);
  for (const b of B) if (!b.fixed) { b.vx += 0.5 * b.ax * h; b.vy += 0.5 * b.ay * h; }
}
// Run scene sc for 1.5 holds at calm 0 (ts substeps per frame). onStep(B, t)
// sees each state. Returns { drift, escaped }.
export function run(sc, seed, onStep) {
  const S = sc.build(rng(seed), G, mk), B = S.bodies;
  forces(B, S.extra);
  const E0 = energy(B, S.pe);
  let K0 = 0; for (const b of B) K0 += 0.5 * b.mass * (b.vx * b.vx + b.vy * b.vy);
  const scale = K0 + Math.abs(E0 - K0 - (S.pe ? S.pe(B) : 0)) + Math.abs(S.pe ? S.pe(B) : 0);
  const framed = B.filter(b => !b.noframe), at = () => sc.follow != null ? B[sc.follow] : { x: 0, y: 0 };
  const dist = b => Math.hypot(b.x - at().x, b.y - at().y);
  let drift = 0, R0 = 0, out = new Set(), t = 0;
  const n = Math.round(1.5 * HOLD * FPS * sc.ts);
  for (let k = 0; k < n; k++) {
    step(B, DT, S.extra); t += DT;
    if (k % 10 === 0) {
      drift = Math.max(drift, Math.abs(energy(B, S.pe) - E0) / scale);
      if (k < n / 3) for (const b of framed) R0 = Math.max(R0, dist(b));
      else for (const b of framed) if (dist(b) > 2.5 * R0) out.add(b);
    }
    if (onStep) onStep(B, t, S);
  }
  const escaped = out.size > (sc.escapeOk || 0) * framed.length ? [...out].map(b => b.name || '(disk)') : [];
  return { drift, escaped, out: out.size, framed: framed.length, B, S };
}
// The angle range (degrees from the planet, -180..180) of each Trojan.
function trojanSwing(sc, seed) {
  const S = [];
  run(sc, seed, B => { const ap = Math.atan2(B[1].y, B[1].x); B.slice(2).forEach((b, i) => { const x = ((Math.atan2(b.y, b.x) - ap) * 180 / Math.PI + 540) % 360 - 180; const s = S[i] ||= { lo: 999, hi: -999 }; s.lo = Math.min(s.lo, x); s.hi = Math.max(s.hi, x); }); });
  return S;
}
const isMain = process.argv[1] && process.argv[1].endsWith("saver-test.mjs");
if (isMain) {
  let fail = 0;
  for (const sc of SCENES) for (const seed of [1, 2, 3]) {
    const { drift, escaped, out, framed } = run(sc, seed);
    let ok = drift < 1e-3 && !escaped.length, note = '';
    if (sc.key === 'trojans') {
      const sw = trojanSwing(sc, seed), bad = sw.filter(s => s.lo * s.hi < 0 || Math.abs(s.lo) > 170 || Math.abs(s.hi) > 170);
      if (bad.length) ok = false;
      note = '  swing ' + sw.map(s => s.lo.toFixed(0) + '..' + s.hi.toFixed(0)).join(' ');
    }
    if (!ok) fail++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${sc.key.padEnd(13)} seed ${seed}  drift ${drift.toExponential(2)}  out ${out}/${framed}  escaped [${escaped.join(', ')}]${note}`);
  }
  console.log(fail ? `${fail} failures` : 'all scenes pass');
  process.exit(fail ? 1 : 0);
}
