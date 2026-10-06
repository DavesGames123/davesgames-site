// ============================================================================
//  STEAM LOCOMOTIVE  ·  tests.mjs — node stella-nova/pages/steam-locomotive/tests.mjs
// ----------------------------------------------------------------------------
//  Checks mech.js:
//    lengths ....... every rod and lever keeps its length, the valve pin
//                    stays on its line and the die stays in the slot arc,
//                    at 720 wheel angles and 5 reverser settings
//    stroke ........ the crosshead travel is 2 r (front to rear dead centre)
//    lead .......... the lead at both ends stays within 0.3 mm from full
//                    forward to full reverse (the Walschaerts property)
//    mid gear ...... valve travel = 2 (lap + lead)
//    cut-off ....... full gear 70-80 % of stroke; it falls as the reverser
//                    comes back to mid gear; reverse gear running backward
//                    gives the same cut-off as forward gear running forward
//    ports ......... no opening is more than the port width, and one end is
//                    never open to steam and exhaust at the same time
//    indicator ..... forward gear does positive work running forward and
//                    negative work running backward; a shorter cut-off
//                    gives less work but more work per unit of steam
//    continuity .... no joint jumps between two close wheel angles
// ============================================================================
import { G, makeGear, events, indicator, TAU } from './mech.js';

let fail = 0, n = 0;
const ok = (c, msg) => { n++; console.log(c ? 'ok  ' : 'FAIL', msg); if (!c) fail++; };
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

// lengths and continuity
{
  let worst = 0, jump = 0, slot = 0, line = 0, open = 0, both = 0;
  for (const c of [1, 0.5, 0, -0.5, -1]) {
    const g = makeGear(); let prev = null;
    for (let i = 0; i <= 720; i++) {
      const P = g.pose(TAU * i / 720, c), J = P.J;
      const errs = [dist(J.C, J.H) - G.L, dist(J.E, J.F) - G.Le, dist(J.K, J.F) - G.a, dist(J.D, J.T) - G.Rr, dist(J.T, J.V) - G.cv,
        dist(J.U, J.A) - G.Lu, dist(J.W, J.Q) - G.LA, dist(J.Q, J.D) - G.LL, dist(J.V, J.U) - G.cu, dist(J.C, [0, 0]) - G.r, dist(J.E, [0, 0]) - G.e];
      worst = Math.max(worst, ...errs.map(Math.abs));
      line = Math.max(line, Math.abs(J.V[1] - G.YV), Math.abs(J.H[1]));
      // the slot centre: Rr from K along the link's own x axis
      const Cc = [G.K[0] + G.Rr * Math.cos(P.psi), G.K[1] + G.Rr * Math.sin(P.psi)];
      slot = Math.max(slot, Math.abs(dist(Cc, J.D) - G.Rr));
      const o = P.open;
      open = Math.max(open, o.fs, o.rs, o.fx, o.rx);
      if ((o.fs > 0 && o.fx > 0) || (o.rs > 0 && o.rx > 0)) both++;
      if (prev) for (const k in J) jump = Math.max(jump, dist(J[k], prev[k]));
      prev = J;
    }
  }
  ok(worst < 1e-6, `rods and levers keep their lengths (worst ${worst.toExponential(2)} mm)`);
  ok(line < 1e-9, `valve pin and crosshead stay on their lines (${line.toExponential(1)} mm)`);
  ok(slot < 1e-9, `die block stays on the slot arc of radius Rr (${slot.toExponential(1)} mm)`);
  ok(open <= G.PORT + 1e-12, `no port opens more than its width ${G.PORT} mm (max ${open.toFixed(1)})`);
  ok(both === 0, `no end open to steam and exhaust at once (${both} poses)`);
  ok(jump < 20, `no jumps (largest step ${jump.toFixed(2)} mm per 0.5 deg)`);
}

// stroke
{
  const g = makeGear(); let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 1440; i++) { const x = g.pose(TAU * i / 1440, 1).J.H[0]; lo = Math.min(lo, x); hi = Math.max(hi, x); }
  ok(Math.abs(hi - lo - 2 * G.r) < 1e-6, `crosshead stroke ${(hi - lo).toFixed(3)} mm = 2 r = ${2 * G.r}`);
}

// lead and mid gear
{
  const leads = [], E = {};
  for (const c of [1, 0.75, 0.5, 0.25, 0, -0.25, -0.5, -0.75, -1]) { E[c] = events(c, c >= 0 ? 1 : -1); leads.push(E[c].front.lead, E[c].rear.lead); }
  const spread = Math.max(...leads) - Math.min(...leads);
  ok(spread < 0.3 && Math.min(...leads) > 4, `constant lead: ${Math.min(...leads).toFixed(2)}..${Math.max(...leads).toFixed(2)} mm over the reverser range`);
  const lead0 = E[0].front.lead;
  ok(Math.abs(E[0].travel - 2 * (G.LAP + lead0)) < 0.5, `mid gear travel ${E[0].travel.toFixed(2)} = 2 (lap + lead) = ${(2 * (G.LAP + lead0)).toFixed(2)} mm`);
  const cf = E[1].front.cutoff, cr = E[1].rear.cutoff;
  ok(cf > 0.7 && cf < 0.8 && cr > 0.7 && cr < 0.8, `full forward cut-off ${(cf * 100).toFixed(1)} % front, ${(cr * 100).toFixed(1)} % rear`);
  const seq = [1, 0.75, 0.5, 0.25, 0].map(c => (E[c].front.cutoff + E[c].rear.cutoff) / 2);
  ok(seq.every((v, i) => i === 0 || v < seq[i - 1]), `cut-off falls toward mid gear: ${seq.map(v => (v * 100).toFixed(0)).join(' > ')} %`);
  const rv = (E[-1].front.cutoff + E[-1].rear.cutoff) / 2, fw = (cf + cr) / 2;
  ok(Math.abs(rv - fw) < 0.03, `full reverse running backward cuts off at ${(rv * 100).toFixed(1)} %, forward ${(fw * 100).toFixed(1)} %`);
}

// indicator
{
  const f1 = indicator(1, 1), b1 = indicator(1, -1), r1 = indicator(-1, -1), f25 = indicator(0.25, 1), f50 = indicator(0.5, 1);
  ok(f1.mep > 0.5 && r1.mep > 0.5, `full gear MEP ${f1.mep.toFixed(3)} forward, reverse gear backward ${r1.mep.toFixed(3)} (share of boiler pressure)`);
  ok(b1.mep < 0, `forward gear running backward works against the motion (MEP ${b1.mep.toFixed(3)})`);
  ok(f1.mep > f50.mep && f50.mep > f25.mep, `MEP falls with cut-off: ${f1.mep.toFixed(3)} > ${f50.mep.toFixed(3)} > ${f25.mep.toFixed(3)}`);
  ok(f25.eff > 1.2 * f1.eff, `work per unit of steam at 25 % reverser ${f25.eff.toFixed(3)} > 1.2 x full gear ${f1.eff.toFixed(3)}`);
}

console.log(`${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
