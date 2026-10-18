// ============================================================================
//  POOL PHYSICS  ·  core/shot.js — a shot, its prediction and its maths
// ----------------------------------------------------------------------------
//  predict(S, shot) runs the shot on a copy with the event log on. The
//  simulation is deterministic, so the prediction is the shot: the page
//  plays the same state forward and the events come at the same times.
//
//  mathsOf(T, S0, shot, pred, aim) turns the prediction into the steps of
//  the maths overlay. Each step has
//    id, title, at ('aim' | a sim time), tex (MathJax, with \class{mN}),
//    plain (the same in plain text: the fallback with no MathJax), and
//    draw: what the 2D view draws for it (lines, arcs, circles, labels).
//  Colours (lib/sci.css .m1-.m6): m1 the cue ball and its aim, m2 the
//  object ball and the pocket line, m3 the line of centres n, m4 the
//  tangent line t, m5 the angles, m6 the acceleration and friction.
//
//  grep -n targets: "export function predict", "export function contactOf",
//  "export function mathsOf", "const C = "
// ============================================================================
import { clone, beginShot, strike, simulate, PHYS } from './physics.js';
import { ghost, pocketAim, wrap } from './geometry.js';

export function predict(S, shot) {
  const C = clone(S);
  if (shot.place) { C.x[0] = shot.place.x; C.y[0] = shot.place.y; C.on[0] = 1; }
  beginShot(C, { log: true });
  strike(C, 0, shot);
  simulate(C, { maxT: 60 });
  return { S: C, events: C.events, paths: C.paths, potted: C.potted.slice(), first: C.first, t: C.t,
    start: { x: shot.place ? shot.place.x : S.x[0], y: shot.place ? shot.place.y : S.y[0] } };
}

// The first contact of the cue ball, as vectors (from the event log).
export function contactOf(pred) {
  const e = pred.events.find(x => x.type === 'ball' && (x.i === 0 || x.j === 0));
  if (!e) return null;
  const cueFirst = e.i === 0, o = cueFirst ? e.j : e.i;
  const sgn = cueFirst ? 1 : -1;
  const nx = sgn * e.nx, ny = sgn * e.ny;                // from the cue ball to the object ball
  const [a0, a1, b0, b1] = e.before, [c0, c1, d0, d1] = e.after;
  const vc = cueFirst ? [a0, a1] : [b0, b1], vo0 = cueFirst ? [b0, b1] : [a0, a1];
  const vc2 = cueFirst ? [c0, c1] : [d0, d1], vo2 = cueFirst ? [d0, d1] : [c0, c1];
  const cx = cueFirst ? e.xi : e.xj, cy = cueFirst ? e.yi : e.yj, ox = cueFirst ? e.xj : e.xi, oy = cueFirst ? e.yj : e.yi;
  const v = Math.hypot(vc[0] - vo0[0], vc[1] - vo0[1]);
  // theta between the cue ball velocity and the line of centres
  const cos = Math.max(-1, Math.min(1, ((vc[0] - vo0[0]) * nx + (vc[1] - vo0[1]) * ny) / (v || 1)));
  const theta = Math.acos(cos);
  // the tangent t: n turned toward the side the cue ball goes
  let tx = -ny, ty = nx;
  if ((vc[0] * tx + vc[1] * ty) < 0) { tx = -tx; ty = -ty; }
  const throwA = Math.abs(wrap(Math.atan2(vo2[1], vo2[0]) - Math.atan2(ny, nx)));
  return { t: e.t, o, cx, cy, ox, oy, px: (cx + ox) / 2, py: (cy + oy) / 2, nx, ny, tx, ty, v, theta, cos,
    vn: v * cos, vt: v * Math.sin(theta), vc, vc2, vo2, vO: Math.hypot(vo2[0], vo2[1]), vC: Math.hypot(vc2[0], vc2[1]), throwA, cluster: e.cluster || 0 };
}

const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '-');
const deg = r => r * 180 / Math.PI;
const c = (m, tex) => `\\class{${m}}{${tex}}`;
// shared symbols
const P_ = c('m2', '\\hat{\\mathbf p}'), D_ = c('m1', '\\hat{\\mathbf d}'), N_ = c('m3', '\\hat{\\mathbf n}'), T_ = c('m4', '\\hat{\\mathbf t}'), TH = c('m5', '\\theta');
const VC = c('m1', '\\mathbf v_C'), VO = c('m2', '\\mathbf v_O');

// T: table, S0: the state before the shot, shot: {phi, v, a, b, n, pocket},
// pred: predict(), aim: the planned geometry (core/geometry shotGeometry) or null.
export function mathsOf(T, S0, shot, pred, aim) {
  const R = T.R, P = S0.P || PHYS, g = P.g, steps = [];
  const C0 = pred.start;
  const push = s => { s.k = steps.length; steps.push(s); return s; };
  const ct = contactOf(pred);
  const n = shot.n > 0 ? shot.n : ct ? ct.o : 0;
  const pk = shot.pocket >= 0 ? T.pockets[shot.pocket] : null;
  // the aim part: from the plan (the ghost ball of the called pocket)
  if (pk && n > 0 && S0.on[n]) {
    const pa = pocketAim(pk), gb = ghost(S0.x[n], S0.y[n], pa.x, pa.y, R);
    const dG = Math.hypot(gb.x - C0.x, gb.y - C0.y), dx = (gb.x - C0.x) / dG, dy = (gb.y - C0.y) / dG;
    const cos = Math.max(-1, Math.min(1, dx * gb.px + dy * gb.py)), th = Math.acos(cos);
    push({ id: 'pocket', title: 'Line to the pocket', at: 'aim',
      tex: `${P_} = \\frac{\\mathbf P - \\mathbf O}{\\lVert \\mathbf P - \\mathbf O \\rVert},\\quad \\lVert \\mathbf P - \\mathbf O \\rVert = ${f(gb.d)}\\ \\text{m}`,
      plain: `p = (P - O) / |P - O|, |P - O| = ${f(gb.d)} m`,
      draw: [{ kind: 'line', from: [S0.x[n], S0.y[n]], to: [pa.x, pa.y], m: 'm2', dash: true, label: 'p̂' }, { kind: 'ring', at: [pa.x, pa.y], r: 0.02, m: 'm2' }] });
    push({ id: 'ghost', title: 'Ghost ball', at: 'aim',
      tex: `\\mathbf G = \\mathbf O - 2R\\,${P_},\\quad 2R = ${f(2 * R * 1000, 1)}\\ \\text{mm}`,
      plain: `G = O - 2R p, 2R = ${f(2 * R * 1000, 1)} mm`,
      draw: [{ kind: 'circle', at: [gb.x, gb.y], r: R, m: 'm1', dash: true, label: 'G' }, { kind: 'line', from: [S0.x[n], S0.y[n]], to: [gb.x, gb.y], m: 'm3', label: '2R', mid: true, lens: 'only' }] });
    push({ id: 'aimline', title: 'Aim line', at: 'aim',
      tex: `${D_} = \\frac{\\mathbf G - \\mathbf C}{\\lVert \\mathbf G - \\mathbf C \\rVert},\\quad \\lVert \\mathbf G - \\mathbf C \\rVert = ${f(dG)}\\ \\text{m}`,
      plain: `d = (G - C) / |G - C|, |G - C| = ${f(dG)} m`,
      draw: [{ kind: 'arrow', from: [C0.x, C0.y], to: [gb.x, gb.y], m: 'm1', label: 'd̂' }] });
    push({ id: 'cut', title: 'Cut angle', at: 'aim', val: { theta: deg(th) },
      tex: `\\cos ${TH} = ${D_} \\cdot ${P_} = ${f(cos, 3)} \\;\\Rightarrow\\; ${TH} = ${f(deg(th), 1)}^{\\circ}`,
      plain: `cos θ = d · p = ${f(cos, 3)}, θ = ${f(deg(th), 1)}°`,
      draw: [{ kind: 'angle', at: [gb.x, gb.y], a: Math.atan2(dy, dx), b: Math.atan2(gb.py, gb.px), r: 0.07, rl: 2.2 * R, m: 'm5', label: 'θ' }, { kind: 'line', from: [gb.x, gb.y], to: [gb.x + dx * 4 * R, gb.y + dy * 4 * R], m: 'm1', dash: true, lens: 'only' }] });
    const frac = 1 - Math.sin(th), off = 2 * R * Math.sin(th);
    push({ id: 'overlap', title: 'Ball overlap', at: 'aim', val: { frac },
      tex: `f = 1 - \\sin ${TH} = ${f(frac)},\\quad b = 2R \\sin ${TH} = ${f(off * 1000, 1)}\\ \\text{mm}`,
      plain: `f = 1 - sin θ = ${f(frac)} (ball fraction), b = 2R sin θ = ${f(off * 1000, 1)} mm`,
      draw: [{ kind: 'overlap', lens: 'only', c: [gb.x, gb.y], o: [S0.x[n], S0.y[n]], d: [dx, dy], r: R, m: 'm5', label: frac > 0.47 && frac < 0.53 ? 'half-ball' : `${Math.round(frac * 100)} % ball` }] });
  } else if (ct) {
    push({ id: 'aimline', title: 'Aim line', at: 'aim',
      tex: `${D_} = (\\cos\\varphi, \\sin\\varphi),\\quad \\varphi = ${f(deg(shot.phi), 1)}^{\\circ}`,
      plain: `d = (cos φ, sin φ), φ = ${f(deg(shot.phi), 1)}°`,
      draw: [{ kind: 'arrow', from: [C0.x, C0.y], to: [ct.cx, ct.cy], m: 'm1', label: 'd̂' }] });
  }
  // the strike
  const a = shot.a || 0, b = shot.b || 0;
  const spin = b > 0.08 ? 'follow' : b < -0.08 ? 'draw' : 'stun';
  push({ id: 'strike', title: 'Cue strike', at: 'aim',
    tex: `v_0 = ${f(shot.v)}\\ \\tfrac{\\text{m}}{\\text{s}},\\ \\ \\vec{\\omega}_0 = \\tfrac{5 v_0}{2R}\\,(-b\\,d_y,\\ b\\,d_x,\\ a) \\;\\;(a, b) = (${f(a)}, ${f(b)})R`,
    plain: `v0 = ${f(shot.v)} m/s, tip (a, b) = (${f(a)}, ${f(b)}) R, ω0 = 5 v0 / 2R (-b dy, b dx, a): ${spin}`,
    draw: [{ kind: 'tip', at: [C0.x, C0.y], a, b, m: 'm1' }] });
  // sliding until the first roll of the cue ball
  const roll = pred.events.find(e => e.type === 'roll' && e.i === 0);
  // |u0| = v0 |1 - 5b/2| for a level cue (u = v - R w x z at the cloth)
  const tr = Math.abs(1 - 2.5 * b) < 1e-3 ? 0 : 2 * Math.abs(shot.v * (1 - 2.5 * b)) / (7 * P.muS * g);
  push({ id: 'slide', title: 'Sliding on the cloth', at: 0,
    tex: `\\class{m6}{\\mathbf a} = -\\class{m6}{\\mu_s} g\\,\\hat{\\mathbf u},\\ \\ \\lVert\\class{m6}{\\mathbf a}\\rVert = ${f(P.muS * g)}\\ \\tfrac{\\text{m}}{\\text{s}^2},\\ \\ t_r = \\frac{2\\lVert\\mathbf u_0\\rVert}{7\\class{m6}{\\mu_s} g} = ${f(tr)}\\ \\text{s}`,
    plain: `a = -μs g û, |a| = ${f(P.muS * g)} m/s², rolls after t = 2|u0| / (7 μs g) = ${f(tr)} s`,
    draw: roll ? [{ kind: 'mark', at: [roll.x, roll.y], m: 'm6', label: 'rolls', t: roll.t }] : [] });
  if (ct) {
    push({ id: 'contact', title: 'Contact: two components', at: ct.t, val: { theta: deg(ct.theta) },
      tex: `${VC} = v\\cos ${TH}\\,${N_} + v \\sin ${TH}\\,${T_} = ${f(ct.vn)}\\,${N_} + ${f(ct.vt)}\\,${T_},\\ \\ ${TH} = ${f(deg(ct.theta), 1)}^{\\circ}`,
      plain: `v = v cos θ n + v sin θ t = ${f(ct.vn)} n + ${f(ct.vt)} t (m/s), θ = ${f(deg(ct.theta), 1)}°`,
      draw: [
        { kind: 'line', from: [ct.cx - ct.nx * 3 * R, ct.cy - ct.ny * 3 * R], to: [ct.ox + ct.nx * 5 * R, ct.oy + ct.ny * 5 * R], m: 'm3', label: 'n̂', dash: true },
        { kind: 'line', from: [ct.cx - ct.tx * 3 * R, ct.cy - ct.ty * 3 * R], to: [ct.cx + ct.tx * 5 * R, ct.cy + ct.ty * 5 * R], m: 'm4', label: 't̂', dash: true },
        { kind: 'circle', at: [ct.cx, ct.cy], r: R, m: 'm1', lens: 'only' },
        { kind: 'arrow', from: [ct.cx, ct.cy], vec: ct.vc, m: 'm1', label: 'v', lens: 'only' },
        { kind: 'arrow', from: [ct.cx, ct.cy], vec: [ct.nx * ct.vn, ct.ny * ct.vn], m: 'm3', label: 'v cos θ', thin: true, lens: 'only' },
        { kind: 'arrow', from: [ct.cx, ct.cy], vec: [ct.tx * ct.vt, ct.ty * ct.vt], m: 'm4', label: 'v sin θ', thin: true, lens: 'only' },
        { kind: 'right', at: [ct.cx, ct.cy], a: Math.atan2(ct.ny, ct.nx), b: Math.atan2(ct.ty, ct.tx), m: 'm5', lens: 'only' },
        { kind: 'angle', at: [ct.cx, ct.cy], a: Math.atan2(ct.vc[1], ct.vc[0]), b: Math.atan2(ct.ny, ct.nx), r: 0.05, rl: 1.6 * R, m: 'm5', label: 'θ', lens: 'only' },
        { kind: 'dot', at: [ct.px, ct.py], m: 'm3' },
      ] });
    const e = P.eB;
    push({ id: 'impulse', title: 'Impulse along the line of centres', at: ct.t,
      tex: `${VO}' = \\tfrac{1+e}{2}\\,v\\cos ${TH}\\,${N_},\\ \\ ${VC}' = v\\sin ${TH}\\,${T_} + \\tfrac{1-e}{2}\\,v \\cos ${TH}\\,${N_};\\ \\ \\lVert ${VO}'\\rVert = ${f(ct.vO)},\\ \\lVert ${VC}'\\rVert = ${f(ct.vC)}`,
      plain: `vO' = (1+e)/2 v cos θ n, vC' = v sin θ t + (1-e)/2 v cos θ n; |vO'| = ${f(ct.vO)}, |vC'| = ${f(ct.vC)} m/s (e = ${e})`,
      draw: [
        { kind: 'arrow', from: [ct.ox, ct.oy], vec: ct.vo2, m: 'm2', label: "v′O", lens: 'only' },
        { kind: 'arrow', from: [ct.cx, ct.cy], vec: ct.vc2, m: 'm1', label: "v′C", lens: 'only' },
      ] });
    if (deg(ct.throwA) > 0.15) push({ id: 'throw', title: 'Throw from ball friction', at: ct.t,
      tex: `\\Delta\\varphi = \\angle(${VO}', ${N_}) = ${f(deg(ct.throwA), 2)}^{\\circ},\\ \\ \\class{m6}{\\mu_b} = ${P.muB}`,
      plain: `throw: the object ball leaves ${f(deg(ct.throwA), 2)}° off the line of centres (μb = ${P.muB})`,
      draw: [{ kind: 'angle', at: [ct.ox, ct.oy], a: Math.atan2(ct.ny, ct.nx), b: Math.atan2(ct.vo2[1], ct.vo2[0]), r: 0.09, rl: 2.6 * R, m: 'm6', label: 'throw', lens: 'only' }] });
    const back = pred.events.find(x => x.type === 'roll' && x.i === 0 && x.t > ct.t);
    if (back && Math.hypot(back.vx, back.vy) > 0.05) {
      const bend = Math.abs(wrap(Math.atan2(back.vy, back.vx) - Math.atan2(ct.vc[1], ct.vc[0])));
      const th = ct.theta, an = Math.atan(Math.sin(th) * Math.cos(th) / (Math.sin(th) ** 2 + 0.4));
      push({ id: 'bend', title: 'The cue ball rolls again', at: back.t,
        tex: `\\theta_c = ${f(deg(bend), 1)}^{\\circ}\\ \\ \\Big(\\text{rolling: } \\tan\\theta_c = \\frac{\\sin ${TH}\\cos ${TH}}{\\sin^2 ${TH} + \\tfrac25} = ${f(deg(an), 1)}^{\\circ}\\Big)`,
        plain: `the cue ball turns ${f(deg(bend), 1)}° off its aim line (a rolling ball: tan θc = sin θ cos θ / (sin²θ + 2/5) = ${f(deg(an), 1)}°)`,
        draw: [{ kind: 'mark', at: [back.x, back.y], m: 'm6', label: 'rolls' }] });
    }
  }
  // cushions (the first three that the cue ball or the object ball meet)
  const cs = pred.events.filter(e => e.type === 'cushion' && (e.i === 0 || e.i === n)).slice(0, 3);
  for (const e of cs) {
    const tin = Math.atan2(Math.abs(e.vin[0] * e.ny - e.vin[1] * e.nx), Math.abs(e.vin[0] * e.nx + e.vin[1] * e.ny));
    const tout = Math.atan2(Math.abs(e.vout[0] * e.ny - e.vout[1] * e.nx), Math.abs(e.vout[0] * e.nx + e.vout[1] * e.ny));
    const who = e.i === 0 ? 'cue ball' : `the ${e.i}`;
    push({ id: 'cushion', title: `Cushion (${who})`, at: e.t,
      tex: `\\tan\\beta_{out} \\approx \\frac{\\tan\\beta_{in}}{e_c}:\\ \\ ${c('m5', '\\beta_{in}')} = ${f(deg(tin), 1)}^{\\circ},\\ ${c('m5', '\\beta_{out}')} = ${f(deg(tout), 1)}^{\\circ},\\ e_c = ${P.eC}`,
      plain: `cushion (${who}): in ${f(deg(tin), 1)}°, out ${f(deg(tout), 1)}° (tan βout ≈ tan βin / ec, ec = ${P.eC}; spin and friction move it)`,
      draw: [
        { kind: 'line', from: [e.x - e.nx * R, e.y - e.ny * R], to: [e.x + e.nx * 0.16, e.y + e.ny * 0.16], m: 'm3', dash: true },
        { kind: 'angle', at: [e.x, e.y], a: Math.atan2(e.ny, e.nx), b: Math.atan2(-e.vin[1], -e.vin[0]), r: 0.06, m: 'm5', label: 'βin' },
        { kind: 'angle', at: [e.x, e.y], a: Math.atan2(e.ny, e.nx), b: Math.atan2(e.vout[1], e.vout[0]), r: 0.08, m: 'm5', label: 'βout' },
      ] });
  }
  for (const pt of pred.potted.slice(0, 3)) {
    const pkt = T.pockets[pt.pocket];
    const name = pt.i === 0 ? 'the cue ball' : `the ${pt.i}`;
    push({ id: 'pot', title: pt.i === 0 ? 'Scratch' : 'Pocketed', at: pt.t,
      tex: `\\text{${name} drops at } t = ${f(pt.t)}\\ \\text{s}`,
      plain: `${name} drops at t = ${f(pt.t)} s`,
      draw: pkt ? [{ kind: 'ring', at: [pkt.hx, pkt.hy], r: pkt.r, m: pt.i === 0 ? 'm6' : 'm2' }] : [] });
  }
  return steps;
}

// Where the zoom lens of the 2D view looks: the contact (or the ghost ball).
export function lensOf(pred, geo) {
  const ct = contactOf(pred);
  if (ct) return { x: (ct.cx + ct.ox) / 2, y: (ct.cy + ct.oy) / 2, t: ct.t, balls: [{ n: ct.o, x: ct.ox, y: ct.oy }, { n: 0, x: ct.cx, y: ct.cy, ghost: true }] };
  if (geo) return { x: (geo.gx + geo.ox) / 2, y: (geo.gy + geo.oy) / 2, t: 0, balls: [{ n: geo.n, x: geo.ox, y: geo.oy }, { n: 0, x: geo.gx, y: geo.gy, ghost: true }] };
  return null;
}
