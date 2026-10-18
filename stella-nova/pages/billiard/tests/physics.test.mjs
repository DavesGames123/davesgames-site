// ============================================================================
//  POOL PHYSICS  ·  tests/physics.test.mjs — node, no browser
// ----------------------------------------------------------------------------
//  90 deg rule ...... a stun cue ball leaves along the tangent line
//  30 deg rule ...... a rolling cue ball turns about 30 deg at 1/4 to 3/4
//                     ball hits (the analytic angle at a half-ball hit)
//  energy ........... a head-on stun hit keeps (1 + e^2)/2 of the energy;
//                     no collision makes energy
//  slide to roll .... t = 2 v0 / (7 mu_s g), then v = 5/7 v0
//  cushion .......... rebound angle, e_c, side spin changes the angle
//  break ............ the rack spreads; determinism; no ball leaves the bed
// ============================================================================
import { ok, done, D } from './util.mjs';
import { buildTable, rack8, rng } from '../core/table.js';
import * as P from '../core/physics.js';

// on the bed: inside the cushion box, or hanging in a pocket mouth
const onBed = (x, y) => (Math.abs(x) <= T.hx - R + 1e-3 && Math.abs(y) <= T.hy - R + 1e-3) || T.pockets.some(p => Math.hypot(x - p.mx, y - p.my) < 0.07);

const T = buildTable(), R = T.R, PH = P.PHYS;

// cue ball at the ghost ball spot for a cut of theta, moving +x
function cutSetup(theta, v, spin) {
  const S = P.createState(T);
  S.on[0] = S.on[1] = 1;
  S.x[1] = 0.3; S.y[1] = 0;
  S.x[0] = S.x[1] - 2 * R * Math.cos(theta) - 0.001; S.y[0] = 2 * R * Math.sin(theta);
  S.vx[0] = v;
  if (spin === 'roll') S.wy[0] = v / R;
  P.beginShot(S, { log: true });
  P.simulate(S);
  const ev = S.events.find(e => e.type === 'ball');
  const roll = S.events.find(e => e.type === 'roll' && e.i === 0 && e.t > ev.t);
  return { S, ev, roll };
}

// 90 degree rule. With e < 1 the cue ball keeps (1 - e)/2 v cos(theta) along
// the line of centres, so its exact angle off the tangent is
// atan((1 - e) cos(theta) / (2 sin(theta))) plus a little throw.
{
  let worstMid = 0, worstModel = 0, rows = [];
  for (const deg of [10, 20, 30, 40, 50, 60, 70]) {
    const { ev } = cutSetup(deg / D, 1.5, 'stun');
    const [cx, cy, ox, oy] = ev.after;
    const toN = Math.acos(Math.abs(cx * ev.nx + cy * ev.ny) / Math.hypot(cx, cy)) * D;   // CB path against the line of centres
    const th = deg / D, model = 90 - Math.atan((1 - PH.eB) * Math.cos(th) / (2 * Math.sin(th))) * D;
    if (deg >= 30) worstMid = Math.max(worstMid, Math.abs(90 - toN));
    worstModel = Math.max(worstModel, Math.abs(model - toN));
    rows.push(`${deg}:${toN.toFixed(1)}(${model.toFixed(1)})`);
  }
  ok(worstMid < 3, '90 deg rule: a stun cue ball leaves within 3 deg of the tangent line at 30-70 deg cuts', `worst ${worstMid.toFixed(2)} deg; cut:angle to the line of centres(e model) ${rows.join(' ')}`);
  ok(worstModel < 1.5, '90 deg rule: at every cut the angle is the e = 0.95 angle within 1.5 deg (throw)', `worst ${worstModel.toFixed(2)} deg`);
}
// 30 degree rule
{
  const half = cutSetup(30 / D, 1.5, 'roll');
  const defl = Math.atan2(half.roll.vy, half.roll.vx) * D;
  const th = 30 / D, an = Math.atan(Math.sin(th) * Math.cos(th) / (Math.sin(th) ** 2 + 0.4)) * D;
  ok(Math.abs(defl - an) < 1.5, '30 deg rule: rolling half-ball hit, the cue ball turns by the analytic angle', `measured ${defl.toFixed(2)} deg, analytic ${an.toFixed(2)} deg (e = 1, no friction)`);
  const out = [];
  let lo = 99, hi = 0;
  for (const f of [0.25, 0.375, 0.5, 0.625, 0.75]) {   // ball fraction 1 - sin(theta)
    const t = Math.asin(1 - f), r = cutSetup(t, 1.5, 'roll');
    const d = Math.atan2(r.roll.vy, r.roll.vx) * D;
    lo = Math.min(lo, d); hi = Math.max(hi, d); out.push(`${f}:${d.toFixed(1)}`);
  }
  ok(lo > 26 && hi < 36, '30 deg rule: 1/4 to 3/4 ball hits all turn the rolling cue ball near 30 deg', `range ${lo.toFixed(1)}-${hi.toFixed(1)} deg; ${out.join(' ')}`);
}
// energy
{
  const S = P.createState(T);
  S.on[0] = S.on[1] = 1; S.x[0] = 0; S.x[1] = 2 * R + 0.0005; S.vx[0] = 2;
  const E0 = P.kinetic(S);
  P.beginShot(S, { log: true });
  for (let k = 0; k < 2; k++) P.tick(S);
  const ev = S.events.find(e => e.type === 'ball');
  const E0c = ev.before[0] ** 2 + ev.before[1] ** 2, E1 = ev.after[0] ** 2 + ev.after[1] ** 2 + ev.after[2] ** 2 + ev.after[3] ** 2;
  const want = (1 + PH.eB ** 2) / 2;
  ok(Math.abs(E1 / E0c - want) < 1e-9, 'energy: a head-on stun hit keeps (1 + e^2)/2 of the kinetic energy', `${(E1 / E0c).toFixed(6)} vs ${want.toFixed(6)}`);
  let bad = 0, worst = 0;
  for (let k = 0; k < 200; k++) {
    const r = rng(k + 1), th = (r() * 2 - 1) * 1.3;
    const C = P.createState(T); C.on[0] = C.on[1] = 1; C.x[1] = 0.2; C.x[0] = 0.2 - 2 * R * Math.cos(th) - 0.001; C.y[0] = 2 * R * Math.sin(th);
    C.vx[0] = 0.5 + 5 * r(); C.wy[0] = (r() * 2 - 1) * C.vx[0] / R; C.wz[0] = (r() * 2 - 1) * 60;
    const before = P.kinetic(C); P.beginShot(C); P.tick(C); P.tick(C);
    const after = P.kinetic(C);
    if (after > before * (1 + 1e-9)) bad++;
    worst = Math.max(worst, 1 - after / before);
  }
  ok(bad === 0, 'energy: 200 random spinning cuts, no collision makes energy', `largest loss over 4 ms ${(worst * 100).toFixed(1)} %`);
}
// slide to roll
{
  const rows = []; let worst = 0;
  for (const v0 of [0.5, 1, 2, 4]) {
    const S = P.createState(T); S.on[0] = 1; S.x[0] = -1.2; S.y[0] = 0;
    P.beginShot(S, { log: true }); P.strike(S, 0, { phi: 0, v: v0 });
    P.simulate(S);
    const r = S.events.find(e => e.type === 'roll' && e.i === 0), an = 2 * v0 / (7 * PH.muS * PH.g);
    worst = Math.max(worst, Math.abs(r.t - an));
    rows.push(`${v0}m/s: ${(r.t * 1000).toFixed(1)}/${(an * 1000).toFixed(1)} ms, v ${(r.vx / v0).toFixed(4)}`);
  }
  ok(worst <= PH.h / 2 + 1e-9, 'slide to roll: a centre-ball hit rolls at t = 2 v0 / (7 mu_s g) (within half a tick) at 5/7 v0', rows.join('; '));
  // a draw shot: the spin reverses the ball after a head-on stop
  const S = P.createState(T); S.on[0] = S.on[1] = 1; S.x[0] = -0.3; S.x[1] = 0; S.y[0] = S.y[1] = 0;
  P.beginShot(S); P.strike(S, 0, { phi: 0, v: 2.5, b: -0.45 }); P.simulate(S);
  ok(S.x[0] < -0.35, 'draw: low on the cue ball, it comes back after a full hit', `cue ball rests at x = ${S.x[0].toFixed(3)} m (started at -0.300)`);
}
// cushions: a ball from (0.4, 0.5) at `deg` off the normal of the top rail
{
  const hit = (deg, v, { roll = true, a = 0, P0 = PH } = {}) => {
    const S = P.createState(T, P0); S.on[0] = 1; S.x[0] = 0.4; S.y[0] = 0.55;
    const phi = (90 - deg) / D; S.vx[0] = v * Math.cos(phi); S.vy[0] = v * Math.sin(phi);
    if (roll) { S.wx[0] = -S.vy[0] / R; S.wy[0] = S.vx[0] / R; }
    S.wz[0] = a * 5 * v / (2 * R);
    P.beginShot(S, { log: true }); P.simulate(S, { maxT: 3 });
    const e = S.events.find(x => x.type === 'cushion'), r = S.events.find(x => x.type === 'roll' && x.t > e.t);
    const ang = (x, y) => Math.atan2(Math.abs(x), Math.abs(y)) * D;
    return { inA: ang(e.vin[0], e.vin[1]), outA: ang(e.vout[0], e.vout[1]), fin: r ? ang(r.vx, r.vy) : NaN, ratio: Math.abs(e.vout[1] / e.vin[1]) };
  };
  const smooth = Object.assign({}, PH, { muC: 0 });
  const f = hit(45, 2, { roll: false, P0: smooth }), law = Math.atan(Math.tan(45 / D) / PH.eC) * D;
  ok(Math.abs(f.outA - law) < 0.05 && Math.abs(f.ratio - PH.eC) < 1e-6, 'cushion reflection: with no cushion friction, tan(out) = tan(in) / e_c and v_perp out = e_c v_perp in', `out ${f.outA.toFixed(2)} deg, law ${law.toFixed(2)} deg, ratio ${f.ratio.toFixed(4)}`);
  const sq = hit(0, 2);
  ok(sq.ratio > PH.eC && sq.ratio < PH.eC + 0.1, 'cushion: a rolling ball square on comes back a little above e_c (top spin at the raised nose)', `v_out / v_in = ${sq.ratio.toFixed(3)}, e_c = ${PH.eC}`);
  const slow = hit(45, 0.8), fast = hit(45, 4);
  ok(slow.fin > slow.outA + 5 && Math.abs(fast.fin - fast.outA) < Math.abs(slow.fin - slow.outA), 'cushion: the top spin bends a rolling ball wider after the rail, less so when fast', `45 deg in: slow out ${slow.outA.toFixed(1)} then ${slow.fin.toFixed(1)}; fast out ${fast.outA.toFixed(1)} then ${fast.fin.toFixed(1)} deg`);
  const run = hit(30, 2, { a: 0.4 }), none = hit(30, 2), rev = hit(30, 2, { a: -0.4 });
  ok(Math.abs(run.outA - rev.outA) > 4, 'cushion: side spin changes the rebound angle (running against reverse english)', `out ${run.outA.toFixed(1)} / ${none.outA.toFixed(1)} / ${rev.outA.toFixed(1)} deg`);
}
// break, determinism, containment
{
  let rails = 0, pots = 0, esc = 0;
  for (let s = 1; s <= 20; s++) {
    const r = rng(s), rk = rack8(T, r), S = P.createState(T);
    for (const b of rk) { S.on[b.n] = 1; S.x[b.n] = b.x; S.y[b.n] = b.y; }
    S.on[0] = 1; S.x[0] = T.headX - 0.05; S.y[0] = 0;
    P.beginShot(S); P.strike(S, 0, { phi: 0, v: 11, b: -0.12 }); P.simulate(S);
    let m = S.railMask & ~1, c = 0; while (m) { c += m & 1; m >>>= 1; } rails += c;
    pots += S.potted.filter(e => e.i > 0).length;
    for (let i = 0; i < 16; i++) if (S.on[i] && !onBed(S.x[i], S.y[i])) esc++;
    if (S.potted.some(e => e.pocket === -2)) esc++;
  }
  ok(rails / 20 >= 10, 'break: the rack spreads (Hertz contacts in the frozen rack)', `on average ${(rails / 20).toFixed(1)} of 15 balls reach a rail, ${(pots / 20).toFixed(2)} fall`);
  ok(esc === 0, 'break: 20 breaks, every ball stays on the bed or falls in a pocket', `${esc} out`);
  const run = () => { const r = rng(5), rk = rack8(T, r), S = P.createState(T); for (const b of rk) { S.on[b.n] = 1; S.x[b.n] = b.x; S.y[b.n] = b.y; } S.on[0] = 1; S.x[0] = T.headX; P.beginShot(S); P.strike(S, 0, { phi: 0.002, v: 10, a: 0.1, b: -0.2 }); P.simulate(S); return Array.from(S.x).concat(Array.from(S.y)).join(','); };
  ok(run() === run(), 'determinism: the same break twice gives the same bits');
  let lost = 0;
  for (let k = 0; k < 300; k++) {
    const r = rng(1000 + k), S = P.createState(T);
    S.on[0] = 1; S.x[0] = (r() - 0.5) * 2.2; S.y[0] = (r() - 0.5) * 1.0;
    P.beginShot(S); P.strike(S, 0, { phi: r() * 6.283, v: 0.5 + 9 * r(), a: (r() - 0.5) * 0.8, b: (r() - 0.5) * 0.8 }); P.simulate(S);
    if (S.on[0] && !onBed(S.x[0], S.y[0])) lost++;
    if (S.pot[0] === -2) lost++;
  }
  ok(lost === 0, 'cushions: 300 random hard shots, the cue ball never goes through a rail or a jaw', `${lost} lost`);
}
// pockets
{
  let n = 0;
  for (const p of T.pockets) {
    const S = P.createState(T); S.on[0] = 1;
    const tx = p.mx + p.ox * 0.02, ty = p.my + p.oy * 0.02;
    S.x[0] = tx * 0.55; S.y[0] = ty * 0.55 - (p.kind === 'side' ? 0 : 0);
    P.beginShot(S); P.strike(S, 0, { phi: Math.atan2(ty - S.y[0], tx - S.x[0]), v: 2 }); P.simulate(S);
    if (S.pot[0] === p.id) n++;
  }
  ok(n === 6, 'pockets: a straight roll at each of the six pockets falls in it', `${n} of 6`);
}
done();
