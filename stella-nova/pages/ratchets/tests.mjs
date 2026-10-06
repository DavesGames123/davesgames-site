// ============================================================================
//  RATCHETS & FREEWHEELS  ·  tests.mjs — node stella-nova/pages/ratchets/tests.mjs [-v]
// ----------------------------------------------------------------------------
//  Checks mech.js:
//    one-way ...... over 2000 random strokes the output never turns back,
//                   and it never gains more than the forward input travel
//    lost motion .. after a back stroke B the next forward stroke loses
//                   the gap that a separate copy of the drop rule gives
//                   (g += B; while g >= p + c: g = max(0, g - p)) for a
//                   ratchet or a freehub, and min(B, e) for a sprag; the
//                   largest loss is 360/N + c, with the crest overrun c
//                   in 0..2 degrees, and under 0.5 degrees for the sprag
//    program ...... the cycle losses are 22, 10, 25 (ratchet), 7, 10, 10
//                   (freehub) and e three times (sprag)
//    pawl ......... at engagement the tip is at the root, FACE_GAP behind
//                   the face; at every wheel offset the tip touches the
//                   profile and no point of the pawl outline is in the
//                   teeth (q from 0 to p + c); the lift equals the tooth
//                   depth; the face force
//                   turns the pawl into the teeth with friction mu
//    freehub ...... N is a multiple of the pawl count, so the pawls engage
//                   together, every 360/N degrees
//    sprag ........ both contacts lean eps from the normal with tan eps < mu;
//                   the outline is 0.3 mm inside both races at the contacts;
//                   Z sprags fit round the mean circle
// ============================================================================
import { UNITS, TAU, FACE_GAP, toothR, pawlGeo, pawlPose, pawlTip, pawlOutline, pawlMoment, free, spragGeo, makeClutch, cycleCurve, pitch, inputAt, NET } from './mech.js';

let fail = 0, n = 0;
const V = process.argv.includes('-v');
const ok = (c, msg) => { n++; if (!c) { fail++; console.log('FAIL', msg); } else if (V) console.log('ok  ', msg); };
const D = 180 / Math.PI;
const rot = ([x, y], t) => [x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t)];
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

for (const u of UNITS) {
  const p = pitch(u), e = u.type === 'sprag' ? spragGeo(u).e : 0, c = p ? pawlGeo(u).c : 0;
  // the gap after a back stroke B from gap g0, worked out here on its own
  const gapAfter = (g0, B) => { if (!p) return Math.min(e, g0 + B); let q = g0 + B; while (q >= p + c) q = Math.max(0, q - p); return q; };

  // one-way: random strokes
  const C = makeClutch(u);
  let x = 0, back = false, fwdSum = 0, outPrev = 0, worstLoss = 0;
  for (let i = 0; i < 2000; i++) {
    const B = rnd() * 120 / D, F = rnd() * 120 / D;
    // back stroke B, then forward F in small steps
    const want = gapAfter(C.g, B);
    for (let k = 1; k <= 20; k++) { C.step(x - B * k / 20); if (C.out < outPrev - 1e-12) back = true; outPrev = C.out; }
    x -= B;
    const out0 = C.out;
    for (let k = 1; k <= 40; k++) { C.step(x + F * k / 40); if (C.out < outPrev - 1e-12) back = true; outPrev = C.out; }
    x += F; fwdSum += F;
    const lost = F - (C.out - out0);
    // a stroke shorter than the gap loses all of it; the gap remains
    const expect = Math.min(F, want);
    if (Math.abs(lost - expect) > 1e-9) { ok(false, `${u.id}: stroke ${i} lost ${lost * D} deg, expected ${expect * D}`); break; }
    if (F >= want) worstLoss = Math.max(worstLoss, lost);
  }
  ok(!back, `${u.id}: the output never turns back`);
  ok(C.out <= fwdSum + 1e-9, `${u.id}: output ${(C.out * D).toFixed(0)} <= forward travel ${(fwdSum * D).toFixed(0)} deg`);
  if (p) {
    ok(c > 0 && c < 2 / D, `${u.id}: crest overrun c = ${(c * D).toFixed(2)} deg (0 .. 2)`);
    ok(worstLoss < p + c && worstLoss > 0.97 * p, `${u.id}: largest loss ${(worstLoss * D).toFixed(2)} deg -> 360/N + c = ${((p + c) * D).toFixed(2)}`);
    // back 3 pitches + c + 0.2 deg: three clicks; the tip lands c behind
    // the face at each drop, so c + 0.2 deg is lost
    const C2 = makeClutch(u); C2.step(1); C2.step(1 - 3 * p - c - 0.2 / D); const o = C2.out; C2.step(1 - 3 * p - c - 0.2 / D + 3 / D);
    ok(C2.clicks === 3 && Math.abs(C2.out - o - (2.8 / D - c)) < 1e-9, `${u.id}: back 3 pitches + c + 0.2 deg: ${C2.clicks} clicks, ${((3 / D - C2.out + o) * D).toFixed(2)} deg lost`);
  } else {
    ok(worstLoss <= e + 1e-9 && e * D < 0.5, `${u.id}: largest loss ${(worstLoss * D).toFixed(3)} deg = e (${(e * D).toFixed(3)}) < 0.5`);
  }

  // the program
  const cc = cycleCurve(u, 600), L = cc.lost.map(v => v * D);
  const want = u.id === 'ratchet' ? [22, 10, 25] : u.id === 'freehub' ? [7, 10, 10] : [e * D, e * D, e * D];
  ok(L.length === 3 && L.every((v, i) => Math.abs(v - want[i]) < 1e-6), `${u.id}: cycle losses ${L.map(v => v.toFixed(2)).join(', ')} deg`);
  ok(Math.abs(cc.pts.at(-1).in - NET) < 1e-9, `${u.id}: net input ${(NET * D).toFixed(0)} deg per cycle`);
  ok(Math.abs(cc.pts.at(-1).out - (300 / D - L.reduce((a, b) => a + b, 0) / D)) < 1e-9, `${u.id}: output per cycle = 300 - losses = ${(cc.pts.at(-1).out * D).toFixed(2)} deg`);

  if (u.type === 'tooth') {
    const G = pawlGeo(u), Po = pawlOutline(u, G);
    // engaged: tip at the root, FACE_GAP behind the face
    const a0 = pawlPose(u, 0, G), tip0 = [G.P[0] + G.l * Math.cos(a0), G.P[1] + G.l * Math.sin(a0)];
    const faceA = FACE_GAP / u.rRoot, arc = (faceA - Math.atan2(tip0[1], tip0[0])) * Math.hypot(...tip0);
    ok(Math.abs(Math.hypot(...tip0) - u.rRoot) < 0.25 && arc > 0.2 && arc < 0.6, `${u.id}: engaged tip r ${Math.hypot(...tip0).toFixed(2)} mm, ${arc.toFixed(2)} mm behind the face`);
    // all offsets over a pitch
    let worstTip = 0, inTeeth = 0, lift0 = Infinity, lift1 = -Infinity;
    const N = 240, bad = [];
    for (let i = 0; i < N; i++) {
      const r = (p + c) * i / N, a = pawlPose(u, r, G), tip = pawlTip(G, a);
      const tr = Math.hypot(...tip), ta = Math.atan2(tip[1], tip[0]) - r, R = ta < -p + FACE_GAP / u.rRoot ? u.rTip : toothR(u, ta);
      worstTip = Math.max(worstTip, Math.abs(tr - R));
      lift0 = Math.min(lift0, tr); lift1 = Math.max(lift1, tr);
      // the outline, densely, without the tip itself (within 0.6 mm)
      for (let j = 0; j < Po.length; j++) {
        const A = Po[j], B = Po[(j + 1) % Po.length];
        for (let k = 0; k < 12; k++) {
          const q0 = [A[0] + (B[0] - A[0]) * k / 12, A[1] + (B[1] - A[1]) * k / 12];
          if (Math.hypot(q0[0] - G.l, q0[1]) < 0.6) continue;
          const q = rot(q0, a); q[0] += G.P[0]; q[1] += G.P[1];
          if (!free(u, q, r)) { inTeeth++; if (bad.length < 4) bad.push(`q ${(r * D).toFixed(1)} pt ${j} (${q0.map(v => v.toFixed(1))})`); }
        }
      }
    }
    ok(worstTip < 0.05, `${u.id}: tip on the profile (worst ${worstTip.toFixed(3)} mm)`);
    ok(inTeeth === 0, `${u.id}: no pawl outline point in the teeth (${inTeeth} found ${bad.join('; ')})`);
    const depth = Math.abs(u.rTip - u.rRoot);
    ok(Math.abs((lift1 - lift0) - depth) < 0.5, `${u.id}: tip lift ${(lift1 - lift0).toFixed(2)} mm = tooth depth ${depth}`);
    // self-engagement
    let muMax = 0; for (let m = 0; m < 2; m += 0.01) if (pawlMoment(u, m, G) > 0) muMax = m;
    ok(pawlMoment(u, u.mu, G) > 0, `${u.id}: the face force pulls the pawl in at mu ${u.mu} (in up to mu ${muMax.toFixed(2)})`);
    if (u.pawls) ok(u.N % u.pawls === 0, `${u.id}: ${u.N} teeth / ${u.pawls} pawls in phase, engagement ${(360 / u.N).toFixed(0)} deg`);
  } else {
    const S = spragGeo(u);
    ok(Math.tan(S.epsI) < u.mu && Math.tan(S.epsO) < u.mu, `${u.id}: tan eps ${Math.tan(S.epsI).toFixed(3)}, ${Math.tan(S.epsO).toFixed(3)} < mu ${u.mu}`);
    ok(S.epsI > 2 / D && S.epsI < 6 / D, `${u.id}: strut angle ${(S.epsI * D).toFixed(2)} deg in 2..6`);
    const rs = S.outline.map(q => Math.hypot(...q)), rmin = Math.min(...rs), rmax = Math.max(...rs);
    ok(Math.abs(rmin - (u.ri + 0.3)) < 0.05 && Math.abs(rmax - (u.ro - 0.3)) < 0.05, `${u.id}: outline r ${rmin.toFixed(2)} .. ${rmax.toFixed(2)}, 0.3 mm off both races`);
    const span = Math.max(...S.outline.map(q => Math.atan2(q[1], q[0]))) - Math.min(...S.outline.map(q => Math.atan2(q[1], q[0])));
    ok(u.Z * span < TAU * 0.8, `${u.id}: ${u.Z} sprags fill ${(u.Z * span / TAU * 100).toFixed(0)}% of the circle`);
    ok(S.delta < 0.02, `${u.id}: contact deflection ${(S.delta * 1000).toFixed(1)} um at Q ${S.Q.toFixed(0)} N`);
  }
}
// the program is continuous across a cycle end
ok(Math.abs(inputAt(TAU - 1e-9) - inputAt(TAU)) < 1e-6, 'program: continuous at the cycle end');
console.log(`${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
