// ============================================================================
//  WATCH MOVEMENT  ·  calibres/anchor.js — anchor (recoil) wall clock
// ────────────────────────────────────────────────────────────────────────────
//  A spring-driven wall clock with Hooke and Clement's anchor escapement
//  (c. 1670) and a short pendulum. An original movement in millimetres:
//  two plates on pillars, a 30-tooth escape wheel, an anchor spanning 7½
//  teeth (90° between the pallets, pivot at √2 × the wheel radius), a crutch
//  to the pendulum. No DOM and no THREE (tests.mjs runs it in Node).
//
//  FRAME
//    x right, y to 12 o'clock, z out of the back. The front plate is
//    z -2..0, the back plate z 16..18, the dial faces -z at z.dialLo. The
//    pendulum hangs behind the back plate from a suspension above the
//    anchor arbor and swings in the x-y plane.
//
//  POWER PATH  (driver / driven, module)
//    barrel 72 / centre pinion 8  (0.6)     barrel 1 turn in 9 h
//    centre 72 / third pinion 6   (0.5)     centre 1 turn per hour
//    third 90 / escape pinion 6   (0.32)    escape 180 turns per hour
//    escape wheel 30 teeth: one tooth per pendulum period, 1.5 Hz
//    pendulum ≈ 110 mm (L = g / (2π f)²), 10,800 beats per hour
//    motion works: cannon 12 / minute 36, pinion 10 / hour 40 (0.45)
//
//  ESCAPEMENT
//    The anchor turns with the pendulum through the crutch (anchor angle =
//    minus the pendulum angle). The pallets are blockers with long inclined
//    faces; solveBeats() turns the wheel as far as they allow over each
//    swing, so the tooth recoils while the pallet keeps moving in after
//    the drop. Tables span a full swing (-A..+A), as for the verge.
//
//  GREP MAP
//    const CAL ......... counts, modules, z planes, pendulum
//    const L ........... arbor positions (solved)
//    function palletPolys  the two pallets at an anchor angle
//    function chain .... every train angle from the escape angle
//    const PARTS ....... the part cards
// ============================================================================
import * as G from '../geom.js';
import { solveBeats } from '../escapement.js';
import { makeRunner } from './common.js';
const { TAU, D, pol, add, sub, rot, ang, centreDist, drive, driveInv, gearSpec, fmtPeriod, clamp } = G;

const F_PEND = 1.5;                                      // pendulum frequency, Hz
export const CAL = {
  plateT: 2, bph: F_PEND * 2 * 3600, fBal: F_PEND,
  barrel: { N: 72, m: 0.6 }, center: { N: 72, m: 0.5, p: 8 }, third: { N: 90, m: 0.32, p: 6 },
  escape: { N: 30, Ra: 16, Rf: 14, p: 6 },
  cannon: { N: 12, m: 0.45 }, minute: { N: 36, m: 0.45, p: 10, pm: 0.432 }, hour: { N: 40, m: 0.432 },
  amp: 4.2 * D, span: 45 * D, palletW: 1.5, palletL: 4.2, depthUp: 0.7, depthDown: -0.4,
  pend: { L: 9810 / Math.pow(2 * Math.PI * F_PEND, 2), bobR: 13, bobT: 5 },
  z: {
    frontLo: -2, frontHi: 0, backLo: 16, backHi: 18, barrelLo: 1.2, barrelHi: 10, barrelTeeth: 2.2,
    center: 12.5, third: 6, escape: 9.5, anchor: 9.5, pend: 23.5,
    cannon: -3.2, minute: -3.2, hour: -4.4, dialLo: -8.6, dialHi: -7.8,
  },
  reserveTurns: 3.5,
};
const c = CAL;

// ── layout ─────────────────────────────────────────────────────────────────
const C = [0, 0];
const B = [0, -centreDist(c.barrel.m, c.barrel.N, c.center.p)];
const E = [0, 30];
const T = G.circleX(C, centreDist(c.center.m, c.center.N, c.third.p), E, centreDist(c.third.m, c.third.N, c.escape.p), -1);
const psi = 90 * D;                                     // escape wheel to anchor pivot: straight up
const P = add(E, pol(c.escape.Ra / Math.cos(c.span), psi));
const M = pol(centreDist(c.cannon.m, c.cannon.N, c.minute.N), 205 * D);
const PIV = [P[0], P[1] + 4.5];                         // the suspension, just above the anchor arbor
export const L = {
  C, B, T, E, P, M, PIV, psi,
  pillars: [[-26, 46], [26, 46], [-26, -42], [26, -42]],
};

// ── the anchor ─────────────────────────────────────────────────────────────
// Recoil wheel teeth for a wheel turning toward +angle: a long back slope
// rising to the point, a near-radial front (locking) face.
export function escapeTeeth(N = c.escape.N, Ra = c.escape.Ra, Rf = c.escape.Rf) {
  const p = TAU / N, out = [], h = Ra - Rf;
  for (let k = 0; k < N; k++) {
    const k0 = k * p;
    for (let j = 0; j <= 2; j++) out.push(pol(Rf, k0 - 0.5 * p + 0.25 * p * j / 2));
    out.push(pol(Rf + 0.35 * h, k0 - 0.12 * p));
    out.push(pol(Ra, k0 + 0.1 * p));                    // the point
    out.push(pol(Ra - 0.12 * h, k0 + 0.16 * p));
    out.push(pol(Rf + 0.1 * h, k0 + 0.2 * p));
    out.push(pol(Rf, k0 + 0.28 * p));
  }
  return out;
}
const WHEEL = escapeTeeth();
const PITCH = TAU / c.escape.N;
// the two pallets in the world frame at anchor angle g. Upstream is the
// -angle side (the wheel turns toward +angle); each inner face slopes so
// that the upstream corner sits higher than the downstream one.
export function palletPolys(g) {
  const out = [];
  for (const sgn of [1, -1]) {
    const a = psi + sgn * c.span, r = [Math.cos(a), Math.sin(a)], up = [Math.sin(a), -Math.cos(a)];
    const at = (dep, side) => add(E, [r[0] * (c.escape.Ra - dep) + up[0] * side, r[1] * (c.escape.Ra - dep) + up[1] * side]);
    const poly = [at(c.depthUp, c.palletW / 2), at(-c.palletL, c.palletW / 2), at(-c.palletL, -c.palletW / 2), at(c.depthDown, -c.palletW / 2)];
    out.push(poly.map(q => add(P, rot(sub(q, P), g))));
  }
  return out;
}
const hits = (th, g) => {
  const wheel = G.place(WHEEL, E, th);
  return palletPolys(g).some(s => G.polysOverlap(s, wheel));
};
const VT = solveBeats({ hits, g0: c.amp, g1: -c.amp, pitch: PITCH, dir: 1, n: 360, step: 0.0005 });
// table lookup that does not spread a drop: where the wheel falls more
// than a tenth of a tooth between two samples, it holds the earlier value
// (still clear, since the solver advanced from it) and lands at the sample
function look(tab, u) {
  const x = clamp(u, 0, 1) * (tab.length - 1), i = Math.min(tab.length - 2, Math.floor(x)), f = x - i;
  return Math.abs(tab[i + 1] - tab[i]) > 0.1 * PITCH ? (f < 1 - 1e-9 ? tab[i] : tab[i + 1]) : tab[i] + (tab[i + 1] - tab[i]) * f;
}
// swing j runs phi = j PI - PI/2 .. j PI + PI/2; the pendulum angle is
// amp sin(phi) and the anchor angle its negative. Even j: anchor +A -> -A.
const anchorAngle = phi => -c.amp * Math.sin(phi);
function escapeAngle(phi) {
  const j = Math.floor((phi + Math.PI / 2) / Math.PI), g = anchorAngle(phi);
  const cyc = Math.floor(j / 2), odd = j - 2 * cyc;
  const u = odd ? (g + c.amp) / (2 * c.amp) : (c.amp - g) / (2 * c.amp);
  return VT.start + cyc * VT.cycle + (odd ? VT.a + look(VT.B, u) : look(VT.A, u));
}
function depthAt(phi) {
  const esc = G.place(WHEEL, E, escapeAngle(phi)), st = palletPolys(anchorAngle(phi));
  let d = 0;
  for (const s of st) for (const q of esc) if (G.inPoly(q, s)) d = Math.max(d, G.depthIn(q, s));
  return d;
}
export const ESC = { tables: VT, pitch: PITCH, depthAt: phi => depthAt(phi), escapeAngle, anchorAngle, palletPolys, wheel: WHEEL, E, P, lift: c.amp * 0.5 };

// ── kinematics ─────────────────────────────────────────────────────────────
// two meshes from the escape wheel to the centre: the escape wheel turns
// the same way as the hands (+angle, clockwise on the dial)
export function chain(thE) {
  const third = driveInv(thE, c.third.N, c.escape.p, ang(T, E));
  const center = driveInv(third, c.center.N, c.third.p, ang(C, T));
  const barrel = driveInv(center, c.barrel.N, c.center.p, ang(B, C));
  const minute = drive(center, c.cannon.N, c.minute.N, ang(C, M));
  const hour = drive(minute, c.minute.p, c.hour.N, ang(M, C));
  return { escape: thE, escPinion: thE, third, center, barrel, minute, hour, cannon: center };
}
const run = makeRunner({
  escAngle: phi => escapeAngle(phi), lift: c.amp * 0.5, fBal: c.fBal, beat: 1 / (2 * c.fBal),
  ampFor: r => (r > 0 ? c.amp : 0), amp0: c.amp,
  startE: VT.start, cycleE: VT.cycle, chain, reserveTurns: c.reserveTurns,
  spent: (ch, C0) => -(ch.barrel - C0.barrel) / TAU,
  // the crutch holds the pendulum rod, so the pendulum turns with the anchor
  extra: s => ({ pendulum: anchorAngle(s.phi), anchor: anchorAngle(s.phi), ratchet: -s.wound * TAU }),
});

export function periods() {
  const esc = c.escape.N / c.fBal;                       // one tooth per period
  const third = esc * c.third.N / c.escape.p, center = third * c.center.N / c.third.p, barrel = center * c.barrel.N / c.center.p;
  const minute = center * c.minute.N / c.cannon.N, hour = minute * c.hour.N / c.minute.p;
  return { escape: esc, third, center, barrel, minute, hour, cannon: center, balance: 1 / c.fBal, pendulum: 1 / c.fBal };
}
const PER = periods();

const BRASS = 'brass, lacquered';
export const PARTS = {
  plate: { name: 'Plates', group: 'Frame', role: 'Two brass plates held apart by four pillars. The whole train runs between them; the pendulum hangs behind the back plate.', specs: [['Size', '64 × 106 mm'], ['Gap', '16 mm'], ['Material', BRASS]] },
  pillars: { name: 'Pillars', group: 'Frame', role: 'Turned brass pillars, riveted to the front plate and pinned through the back plate.', specs: [['Count', '4']] },
  barrel: { name: 'Barrel', group: 'Power', role: 'A spring barrel. Its teeth drive the centre pinion; it turns once in 9 hours.', specs: gearSpec(72, 0.6, [['Run', `${(c.reserveTurns * PER.barrel / 3600).toFixed(0)} h`]]), rate: 'barrel' },
  mainspring: { name: 'Mainspring', group: 'Power', role: 'A broad clock spring. An anchor clock is sensitive to the force of the spring, since the pendulum is never free of the train.', specs: [['Turns', `${c.reserveTurns}`]], live: 'reserve' },
  center: { name: 'Centre wheel', group: 'Going train', role: 'Turns once an hour and carries the minute hand through the cannon pinion.', specs: gearSpec(72, 0.5, [['Pinion', '8 leaves']]), rate: 'center' },
  third: { name: 'Third wheel', group: 'Going train', role: 'The step-up to the escape wheel: 72/6 × 90/6 = 180 escape turns an hour.', specs: gearSpec(90, 0.32, [['Pinion', '6 leaves']]), rate: 'third' },
  escape: { name: 'Escape wheel', group: 'Escapement', role: 'Thirty pointed teeth with sloping backs. The anchor lets one tooth pass per pendulum period, half a tooth per beat.', specs: [['Teeth', '30, recoil form'], ['Diameter', `${c.escape.Ra * 2} mm`], ['Turns', `once in ${fmtPeriod(PER.escape)}`]], rate: 'escape' },
  anchor: { name: 'Anchor', group: 'Escapement', role: 'Its two pallets span 7½ teeth, 90° apart. After a tooth drops onto a pallet, the pendulum swings on and the pallet pushes the wheel back: the recoil that gives the escapement its name.', specs: [['Span', '7½ teeth'], ['Pivot', '√2 × wheel radius above the wheel'], ['Swing', `±${(c.amp / D).toFixed(1)}°`]], angleKey: 'anchor' },
  crutch: { name: 'Crutch', group: 'Escapement', role: 'An arm on the anchor arbor with a fork round the pendulum rod. It carries the impulse from the anchor to the pendulum.', specs: [['Fork', 'open slot']], angleKey: 'anchor' },
  pendulum: { name: 'Pendulum', group: 'Regulator', role: 'The regulator of the clock: its period depends only on its length (and gravity). A nut under the bob raises or lowers it to adjust the rate.', specs: [['Length', `${c.pend.L.toFixed(0)} mm`], ['Period', `${(1 / c.fBal).toFixed(3)} s`], ['Beats', `${c.bph.toLocaleString()} per hour`], ['Bob', `Ø ${c.pend.bobR * 2} mm brass`]], live: 'balance', angleKey: 'pendulum' },
  suspension: { name: 'Suspension', group: 'Regulator', role: 'A thin spring from the back cock carries the pendulum, so it swings without a pivot to wear.', specs: [['Type', 'spring suspension']] },
  cannon: { name: 'Cannon pinion', group: 'Motion works', role: 'A friction fit on the centre arbor carries the minute hand.', specs: [['Leaves', '12']], rate: 'cannon' },
  minuteWheel: { name: 'Minute wheel', group: 'Motion works', role: 'It turns once in 3 hours and drives the hour wheel.', specs: gearSpec(36, 0.45, [['Pinion', '10 leaves']]), rate: 'minute' },
  hourWheel: { name: 'Hour wheel', group: 'Motion works', role: 'It carries the hour hand: 36/12 × 40/10 = 12.', specs: gearSpec(40, 0.432), rate: 'hour' },
  dial: { name: 'Dial', group: 'Display', role: 'A painted dial on dial feet in front of the front plate.', specs: [] },
  hourHand: { name: 'Hour hand', group: 'Display', role: 'One turn in 12 hours.', specs: [], rate: 'hour' },
  minuteHand: { name: 'Minute hand', group: 'Display', role: 'One turn per hour.', specs: [], rate: 'cannon' },
  screws: { name: 'Screws and nuts', group: 'Frame', role: 'Steel screws hold the back cock; the pillars are pinned.', specs: [] },
};

export default {
  id: 'anchor', name: 'Anchor Wall Clock', kind: 'Wall clock', era: 'c. 1670 – 1900', mech: 'anchor',
  blurb: 'Hooke and Clement\'s anchor: two pallets 90° apart rock with a pendulum and push the escape wheel back a little on every swing.',
  CAL, L, ESC, chain, ...run, periods, PARTS, plateR: 52,
  pendulum: { L: c.pend.L, bobR: c.pend.bobR, pivot: [PIV[0], PIV[1], c.z.pend] },
  zRange: [-10, 27], focus: [0, 40, c.z.escape],
  train: [['barrel', 'Barrel', 72, '—'], ['center', 'Centre', 72, 8], ['third', 'Third', 90, 6], ['escape', 'Escape', 30, 6]],
  freq: '1.5 Hz pendulum · 10,800 bph', beatSeconds: 1 / (2 * c.fBal), reserveHours: [28, 34], hoursPerTurn: PER.barrel / 3600,
  trainNote: 'From the centre to the escape wheel: 72/6 × 90/6 = 180 turns an hour. 30 teeth, one per pendulum period, give 1.5 periods a second.',
  about: [
    ['The anchor', 'Around 1670 the anchor replaced the verge in pendulum clocks. Its pallets lie in the plane of the escape wheel, so the pendulum needs only a few degrees of swing instead of the verge\'s forty, and the long, slow pendulum keeps far better time.'],
    ['Recoil', 'When a tooth drops onto a pallet the pendulum is still swinging, and the inclined pallet face pushes the wheel back against the train. Watch the escape wheel at 1/20×: it jumps forward, then creeps back, before the next release.'],
    ['The pendulum', `Its period depends on its length: L = g / (2πf)². At ${c.pend.L.toFixed(0)} mm it swings 1.5 times a second, 10,800 beats an hour. The crutch, an arm on the anchor arbor, gives it a push on each beat.`],
    ['Source', 'An original movement on classic proportions: 90° between the pallets, the anchor pivot √2 × the wheel radius above it, 7½ teeth spanned, about 4° of swing. The escapement is collision-solved; every spur mesh is tested for overlap.'],
  ],
  meshes: [
    ['barrel / centre pinion', 'barrel', G.wheelProfile(72, 0.6), B, 'center', G.pinionProfile(8, 0.6), C],
    ['centre / third pinion', 'center', G.wheelProfile(72, 0.5), C, 'third', G.pinionProfile(6, 0.5), T],
    ['third / escape pinion', 'third', G.wheelProfile(90, 0.32), T, 'escPinion', G.pinionProfile(6, 0.32), E],
    ['cannon / minute wheel', 'cannon', G.pinionProfile(12, 0.45), C, 'minute', G.wheelProfile(36, 0.45), M],
    ['minute pinion / hour', 'minute', G.pinionProfile(10, 0.432), M, 'hour', G.wheelProfile(40, 0.432), C],
  ],
  fmtPeriod,
  // plateR (52) is the fit radius of the whole clock with its pendulum
  // (y -67..61), so the default views frame the pendulum; the escapement
  // view looks at the wheel and the anchor with the back plate off
  views: { escapement: { az: 68, el: 16, explode: 0, rate: 0.05, close: true, bridges: false, distK: 1.5 } },
  checks: [
    ['anchor: the wheel recoils on each swing', () => {
      let back = 0;
      for (const tab of [VT.A, VT.B]) for (let i = 1; i < tab.length; i++) if (tab[i] < tab[i - 1] - 1e-5) back++;
      return [back > 0, `${back} samples move the wheel backward`];
    }],
    ['pendulum: length matches the beat', () => {
      const Tp = 2 * Math.PI * Math.sqrt(c.pend.L / 9810);
      return [Math.abs(Tp - 1 / c.fBal) < 1e-6, `T = ${Tp.toFixed(4)} s for L = ${c.pend.L.toFixed(1)} mm`];
    }],
    ['layout: wheels in one z plane keep clear', () => {
      const discs = [['barrel', B, 22.2, 1.2, 10], ['centre', C, 18.6, 11.8, 13.2], ['third', T, 14.8, 5.4, 6.6], ['escape', E, c.escape.Ra, 8.8, 10.2]];
      let worst = Infinity, which = '';
      for (let i = 0; i < discs.length; i++) for (let j = i + 1; j < discs.length; j++) {
        const a = discs[i], b = discs[j];
        if (a[4] <= b[3] || b[4] <= a[3]) continue;
        const g = G.dist(a[1], b[1]) - a[2] - b[2];
        if (g < worst) { worst = g; which = `${a[0]} / ${b[0]}`; }
      }
      return [worst > 0.3, worst === Infinity ? 'no shared planes' : `smallest gap ${worst.toFixed(2)} mm (${which})`];
    }],
  ],
};
