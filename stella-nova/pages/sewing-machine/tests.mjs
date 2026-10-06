// ============================================================================
//  LOCKSTITCH SEWING MACHINE  ·  tests.mjs
//  node stella-nova/pages/sewing-machine/tests.mjs
// ----------------------------------------------------------------------------
//  Checks mech.js:
//    needle ...... stroke 2a; point 20 mm up at 0 deg, 12 mm down at 180
//                  deg; the crank-slider link keeps its length
//    take-up ..... the four-bar keeps its lengths at 1440 angles, turns
//                  fully with no jump, and the eye stays in front (z > 15)
//    timing ...... at the catch the needle has risen 2.4 mm from the bottom
//                  and the beak is 1.2-2.0 mm above the eye; the second
//                  beak pass comes with the eye above the plate
//    hook ........ 2 turns per shaft turn
//    take-up ..... at the loop peak the eye is in the lowest 15 % of its
//                  travel; its top comes after the cast-off, within 90 deg
//    feed ........ teeth above the plate only while the needle point is
//                  above the fabric; the fabric moves L per turn, also for
//                  0 and reverse; the teeth rise LIFT - DROP
//    thread ...... the upper path has no jump; the loop is positive on the
//                  hook and has its peak near half a hook turn
// ============================================================================
import { M, needle, takeUp, hook, feed, threadPath, thC, thCast, POINT_TDC, POINT_BDC, PRESETS, TAU, DEG } from './mech.js';

let fail = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fail++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const d2 = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const N = 1440, ang = i => TAU * i / N;

// needle
ok(Math.abs(POINT_TDC - 20) < 1e-9 && Math.abs(POINT_BDC + 12) < 1e-9, `needle: point ${POINT_TDC.toFixed(2)} mm at top, ${POINT_BDC.toFixed(2)} mm at bottom (stroke ${(POINT_TDC - POINT_BDC).toFixed(1)} = 2a)`);
let wl = 0;
for (let i = 0; i < N; i++) { const q = needle(ang(i)); wl = Math.max(wl, Math.abs(Math.hypot(q.pin[0], q.pin[1] + M.H - q.clamp) - M.l)); }
ok(wl < 1e-9, `needle: the link keeps l = ${M.l} mm (worst ${wl.toExponential(1)})`);

// take-up four-bar
let wt = 0, jump = 0, prev = null, zmin = Infinity, ymin = Infinity, ymax = -Infinity, ytop = 0;
for (let i = 0; i <= N; i++) {
  const q = takeUp(ang(i));
  wt = Math.max(wt, Math.abs(d2(q.A, q.B) - M.TU.b), Math.abs(d2(q.B, M.TU.C) - M.TU.c));
  if (prev) jump = Math.max(jump, d2(q.E, prev.E));
  prev = q; zmin = Math.min(zmin, q.E[0]);
  if (q.E[1] > ymax) { ymax = q.E[1]; ytop = ang(i); }
  ymin = Math.min(ymin, q.E[1]);
}
const travel = ymax - ymin;
ok(wt < 1e-9, `take-up: b and c hold (worst ${wt.toExponential(1)} mm)`);
ok(jump < 0.5, `take-up: no jump (largest eye step ${jump.toFixed(3)} mm per 0.25 deg)`);
ok(zmin > 15, `take-up: the eye stays in front of the shaft (z >= ${zmin.toFixed(1)} mm)`);
ok(travel > 35 && travel < 70, `take-up: eye travel ${travel.toFixed(1)} mm`);

// timing
const nc = needle(thC), kc = hook(thC);
ok(Math.abs(nc.point - POINT_BDC - M.RISE) < 1e-6, `timing: catch at ${(thC * DEG).toFixed(1)} deg, needle up ${(nc.point - POINT_BDC).toFixed(2)} mm from the bottom`);
const above = kc.beak[1] - nc.eye;
ok(above > 1.2 && above < 2.0 && Math.abs(kc.beak[2]) < 1e-9, `timing: beak ${above.toFixed(2)} mm above the eye, at the needle`);
ok(Math.abs(kc.beak[0] - M.XN) < 1 && kc.beak[0] - M.XN > 0.5, `timing: beak passes ${(kc.beak[0] - M.XN - 0.5).toFixed(2)} mm from the side of a 1 mm needle`);
const second = thC + Math.PI, k2 = hook(second);
ok(Math.abs(k2.psi - TAU) < 1e-9 && needle(second).eye > 0, `timing: second beak pass at ${((second * DEG) % 360).toFixed(0)} deg, eye ${needle(second).eye.toFixed(1)} mm above the plate (no loop)`);

// hook ratio
const p0 = hook(thC + 0.1).psi, p1 = hook(thC + 0.1 + TAU / 4).psi;
ok(Math.abs((p1 - p0) - Math.PI) < 1e-9, 'hook: 2 turns per shaft turn (a quarter shaft turn is half a hook turn)');

// take-up at the loop peak, and its top after the cast-off
let lmax = 0, thPeak = 0;
for (let i = 0; i <= N; i++) { const t = thC + (thCast - thC) * i / N, L = threadPath(t).loop; if (L > lmax) { lmax = L; thPeak = t; } }
const eyeAt = (takeUp(thPeak).E[1] - ymin) / travel;
ok(eyeAt < 0.15, `take-up: at the loop peak (${((thPeak * DEG) % 360).toFixed(0)} deg) the eye is ${(eyeAt * 100).toFixed(0)} % up its travel`);
const after = ((ytop - thCast) % TAU + TAU) % TAU;
ok(after > 0 && after < Math.PI / 2, `take-up: top at ${(ytop * DEG).toFixed(0)} deg, ${(after * DEG).toFixed(0)} deg after the cast-off at ${((thCast * DEG) % 360).toFixed(0)} deg`);
const psiPeak = hook(thPeak).psi * DEG;
ok(psiPeak > 150 && psiPeak < 240, `thread: loop peak ${lmax.toFixed(1)} mm at hook ${psiPeak.toFixed(0)} deg`);

// feed
let clash = 0, top = -Infinity;
for (let i = 0; i < N; i++) { const t = ang(i), F = feed(t, 2.5); top = Math.max(top, F.top); if (F.engaged && needle(t).point <= M.FABRIC) clash++; }
ok(clash === 0, `feed: teeth up only while the needle is out of the fabric (${clash} clashes)`);
ok(Math.abs(top - (M.LIFT - M.DROP)) < 1e-4, `feed: teeth rise ${top.toFixed(2)} mm above the plate`);
for (const p of PRESETS) {
  const a = feed(1.0, p.L).travel, b = feed(1.0 + TAU, p.L).travel, c = feed(1.0 + 5 * TAU, p.L).travel;
  ok(Math.abs(b - a - p.L) < 1e-9 && Math.abs(c - a - 5 * p.L) < 1e-9, `feed: ${p.name} moves the fabric ${(b - a).toFixed(2)} mm per turn`);
}
let fj = 0, fp = null, back = 0;
for (let i = 0; i <= 2 * N; i++) { const t = ang(i), f = feed(t, 2.5); if (fp !== null) { fj = Math.max(fj, Math.abs(f.travel - fp)); if (f.travel < fp - 1e-12) back++; } fp = f.travel; }
ok(fj < 0.02 && back === 0, `feed: fabric travel is smooth and one way (largest step ${fj.toFixed(4)} mm)`);
// the fabric moves only while the teeth are up
let still = 0;
for (let i = 0; i < N; i++) { const t = ang(i), F = feed(t, 2.5), G = feed(t + TAU / N, 2.5); if (!F.engaged && !G.engaged && Math.abs(G.travel - F.travel) > 1e-12) still++; }
ok(still === 0, 'feed: the fabric does not move while the teeth are down');

// thread
let uj = 0, up = null, neg = 0;
for (let i = 0; i <= N; i++) { const P = threadPath(ang(i)); if (up !== null) uj = Math.max(uj, Math.abs(P.upper - up)); up = P.upper; if (hook(ang(i)).caught && !(P.loop > 0)) neg++; }
ok(uj < 1, `thread: upper path has no jump (largest step ${uj.toFixed(3)} mm)`);
ok(neg === 0, 'thread: the loop has a length at every caught angle');

console.log(`${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
