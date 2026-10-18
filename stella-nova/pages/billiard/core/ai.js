// ============================================================================
//  POOL PHYSICS  ·  core/ai.js — a computer player that plans with physics
// ----------------------------------------------------------------------------
//  1. CANDIDATES  every legal ball x every pocket: the ghost ball geometry
//     (core/geometry.js). Blocked lines, thin cuts and bad pocket angles
//     drop out. A geometric chance ranks the rest.
//  2. VARIANTS    for the best few: three speeds x draw / stun / follow,
//     and some side spin. The speed comes from the distances: the object
//     ball must reach the pocket with pace to spare.
//  3. AIM         the real collision throws the object ball off the line of
//     centres by a few degrees. A short simulation to the first contact
//     gives the object ball direction; Newton steps on the aim angle bring
//     it onto the pocket line (the "throw correction").
//  4. OUTCOME     a full simulation of each variant: the ball must fall,
//     no foul. Position play: the chance of the best next shot from where
//     the cue ball stops.
//  5. CHOICE      score = chance x (0.35 + 0.65 x position). With no good
//     pot it plays a safety (leave the other player the worst shot) or a
//     one-rail kick when no legal ball is in sight.
//  6. NOISE       a small seeded error on the aim, the speed and the tip.
//  think() is a generator: the page runs a few steps per frame; the tests
//  run it to the end with plan().
//
//  grep -n targets: "export const SKILLS", "export function\* think",
//  "function variantsFor", "function refineAim", "function evaluate",
//  "function placeCue", "function safety", "export function plan"
// ============================================================================
import { clone, beginShot, strike, simulate, PHYS } from './physics.js';
import { shotGeometry, potChance, pathClear, wrap, pocketAim, ghost } from './geometry.js';
import { legalTargets, judge, apply as applyVerdict, groupOf } from './rules.js';
import { legalCuePlace } from './table.js';

export const SKILLS = {
  perfect: { label: 'Near perfect', aim: 0.03 * Math.PI / 180, speed: 0.01, tip: 0.01, top: 6 },
  pro: { label: 'Pro', aim: 0.12 * Math.PI / 180, speed: 0.03, tip: 0.03, top: 5 },
  club: { label: 'Club', aim: 0.4 * Math.PI / 180, speed: 0.07, tip: 0.06, top: 4 },
};
const PLAN_SIGMA = 0.22 * Math.PI / 180;   // the aim error the planner allows for

// The speed that sends the object ball d2 + spare metres after a cut of theta.
function baseSpeed(geo, P = PHYS) {
  const g = P.g, spare = 0.35;
  const vo = 1.4 * Math.sqrt(2 * P.muR * g * (geo.d2 + spare)) + 0.25;
  const vc = vo / (Math.max(0.25, geo.cos) * (1 + P.eB) / 2);
  return Math.min(7, Math.max(0.7, 1.4 * Math.sqrt(vc * vc / 1.96 + 2 * P.muR * g * geo.d1) + 0.1));
}

function variantsFor(geo, P) {
  const v0 = baseSpeed(geo, P), out = [];
  for (const k of [1, 1.45, 2.1]) for (const b of [-0.35, 0, 0.3]) out.push({ v: Math.min(8, v0 * k), a: 0, b });
  out.push({ v: Math.min(8, v0 * 1.4), a: 0.25 * geo.side, b: 0.1 }, { v: Math.min(8, v0 * 1.4), a: -0.25 * geo.side, b: 0.1 });
  return out;
}

// The object ball direction after the first contact for aim phi (null if
// the cue ball hits another ball first or nothing).
function firstDir(G, n, phi, vr) {
  const C = clone(G.S);
  beginShot(C);
  strike(C, 0, { phi, v: vr.v, a: vr.a, b: vr.b });
  simulate(C, { maxT: 8, stopAtFirst: true });
  if (C.first !== n) return null;
  return Math.atan2(C.vy[n], C.vx[n]);
}

// Newton steps on phi so that the object ball leaves along geo.psi.
function refineAim(G, geo, vr, slope) {
  let phi = geo.phi;
  for (let k = 0; k < 3; k++) {
    const psi = firstDir(G, geo.n, phi, vr);
    if (psi == null) return null;
    const e = wrap(psi - geo.psi);
    if (Math.abs(e) < 2e-5) break;
    phi -= e / slope;
  }
  return phi;
}

// d psi / d phi near the geometric aim (one pair of short simulations).
// Geometry alone gives about d1 / (2R cos theta).
function aimSlope(G, geo) {
  const vr = { v: 2, a: 0, b: 0 }, h = 0.01 * 2 * G.T.R * Math.max(0.2, geo.cos) / Math.max(0.05, geo.d1);
  const a = firstDir(G, geo.n, geo.phi - h, vr), b = firstDir(G, geo.n, geo.phi + h, vr);
  if (a == null || b == null) return null;
  const s = wrap(b - a) / (2 * h);
  return Math.abs(s) < 0.05 ? null : s;
}

// The best next-shot chance for player `who` in state S (geometry only).
export function bestChance(G, S, who, sigma = PLAN_SIGMA) {
  const Gx = Object.assign({}, G, { S });
  const targets = legalTargets(Gx, who);
  let best = 0, geo = null;
  for (const n of targets) for (const p of G.T.pockets) {
    const g = shotGeometry(S, G.T, n, p);
    if (!g) continue;
    const c = potChance(g, G.T, sigma) * (1 - 0.25 * Math.max(0, g.d1 - 1.2));
    if (c > best) { best = c; geo = g; }
  }
  return { best, geo };
}

// Simulate a shot on a copy; judge it with the rules on a copy of the game.
function outcome(G, shot) {
  const C = clone(G.S);
  if (shot.place) { C.x[0] = shot.place.x; C.y[0] = shot.place.y; }
  beginShot(C);
  strike(C, 0, shot);
  simulate(C, { maxT: 40 });
  const Gc = Object.assign({}, G, { S: C, players: G.players.map(p => Object.assign({}, p)) });
  const v = judge(Gc, { ball: shot.n, pocket: shot.pocket });
  return { C, v, Gc };
}

function evaluate(G, geo, vr, phi, place) {
  const shot = { phi, v: vr.v, a: vr.a, b: vr.b, n: geo.n, pocket: geo.pocket, place };
  const { C, v, Gc } = outcome(G, shot);
  const e = C.potted.find(x => x.i === geo.n);
  if (v.foul || v.lose || !e || e.pocket !== geo.pocket) return null;
  if (v.win) return { shot, score: 2, chance: 1, pos: 1, C, v };
  // the group the shooter will have after this shot
  if (v.group) { Gc.open = false; Gc.players[G.turn].group = v.group; Gc.players[1 - G.turn].group = v.group === 'solids' ? 'stripes' : 'solids'; }
  const next = bestChance(Gc, C, G.turn);
  // more balls down on the same shot is a small plus
  const extra = C.potted.filter(x => x.i !== geo.n && x.i > 0 && (G.type === '9' || !Gc.players[G.turn].group || groupOf(x.i) === Gc.players[G.turn].group)).length;
  const chance = potChance(geo, G.T, PLAN_SIGMA);
  return { shot, chance, pos: next.best, score: chance * (0.35 + 0.65 * next.best) + 0.03 * extra, C, v };
}

// Candidate cue ball spots for ball in hand: behind each ghost ball, 12 and
// 25 degrees off the pocket line (a slight cut leaves room for position).
function placeCue(G) {
  const S = G.S, T = G.T, out = [];
  const others = []; for (let k = 1; k < 16; k++) if (S.on[k]) others.push({ x: S.x[k], y: S.y[k] });
  for (const n of legalTargets(G)) for (const p of T.pockets) {
    const aim = pocketAim(p), g = ghost(S.x[n], S.y[n], aim.x, aim.y, T.R);
    for (const dist of [0.28, 0.5]) for (const off of [12, -12, 25, -25]) {
      const a = Math.atan2(-g.py, -g.px) + off * Math.PI / 180;
      const x = g.x + dist * Math.cos(a), y = g.y + dist * Math.sin(a);
      if (!legalCuePlace(T, x, y, others, G.kitchen)) continue;
      const geo = shotGeometry(S, T, n, p, x, y);
      if (!geo) continue;
      out.push({ x, y, geo, c: potChance(geo, T, PLAN_SIGMA) });
    }
  }
  out.sort((a, b) => b.c - a.c);
  // keep the spots for different balls or pockets first
  const seen = new Set(), pick = [];
  for (const o of out) { const k = o.geo.n + ':' + o.geo.pocket; if (!seen.has(k)) { seen.add(k); pick.push(o); } }
  return pick.concat(out.filter(o => !pick.includes(o)));
}

// The break: from the kitchen, full on the head ball, hard, a touch of draw.
function breakPlan(G, skill, r) {
  const T = G.T, S = G.S;
  const y = (r() - 0.5) * 0.12, x = T.headX - 0.05;
  const head = G.type === '9' ? 1 : G.rack.find(b => b.row === 0).n;
  const phi = Math.atan2(S.y[head] - y, S.x[head] - x);
  return { kind: 'break', place: { x, y }, phi, v: 10.5 + r() * 0.8, a: 0, b: -0.12, n: head, pocket: -1, candidates: [] };
}

// A safety: hit a legal ball and leave the other player the worst shot.
function* safety(G, legal) {
  const S = G.S, T = G.T, R = T.R, out = [];
  for (const n of legal.slice(0, 6)) {
    const dx = S.x[n] - S.x[0], dy = S.y[n] - S.y[0], d = Math.hypot(dx, dy);
    if (!pathClear(S, S.x[0], S.y[0], S.x[n], S.y[n], 2 * R - 2e-4, [0, n])) continue;
    const base = Math.atan2(dy, dx);
    for (const f of [0.75, 0.35, -0.35, -0.75]) {
      const phi = base + Math.asin(Math.max(-0.95, Math.min(0.95, f * 2 * R / d)));
      for (const v of [0.9, 1.5, 2.3]) {
        const shot = { phi, v, a: 0, b: 0, n, pocket: -1 };
        const { C, v: ver } = outcome(G, shot);
        if (ver.foul || ver.lose) continue;
        const opp = ver.keep ? 0 : bestChance(G, C, 1 - G.turn).best;
        out.push({ shot, score: (ver.keep ? 0.6 : 0) + (1 - opp) * 0.5, opp, C });
      }
      yield 1;
    }
  }
  return out;
}

// One-rail kicks when no legal ball is in sight: a sweep of aims.
function* kick(G, legal) {
  const out = [];
  for (let k = 0; k < 120; k++) {
    const phi = -Math.PI + k * Math.PI / 60;
    const C = clone(G.S); beginShot(C); strike(C, 0, { phi, v: 2.6 }); simulate(C, { maxT: 8, stopAtFirst: true });
    if (legal.includes(C.first)) out.push(phi);
    if (k % 20 === 19) yield 1;
  }
  const res = [];
  for (const phi of out.slice(0, 12)) {
    const shot = { phi, v: 2.6, a: 0, b: 0, n: legal[0], pocket: -1 };
    const { C, v } = outcome(G, shot);
    if (v.foul || v.lose) continue;
    res.push({ shot, score: 0.3 + 0.5 * (1 - bestChance(G, C, 1 - G.turn).best), C });
  }
  yield 1;
  return res;
}

// The planner. Yields while it works (the page draws the candidates);
// returns the plan: { kind, phi, v, a, b, n, pocket, place, candidates,
// chosen, est }.
export function* think(G, { skill = 'perfect', seed = 1 } = {}) {
  const sk = SKILLS[skill] || SKILLS.perfect;
  const r = G.r;
  if (G.phase === 'break') return noisy(breakPlan(G, sk, r), sk, r);
  const T = G.T, S = G.S;
  const legal = legalTargets(G);
  let places = [null];
  if (G.inHand) {
    const pl = placeCue(G).slice(0, 4);
    if (pl.length) places = pl.map(p => ({ x: p.x, y: p.y }));
  }
  const all = [];
  let candidates = [];
  for (const place of places) {
    const cx = place ? place.x : S.x[0], cy = place ? place.y : S.y[0];
    const geos = [];
    for (const n of legal) for (const p of T.pockets) {
      const g = shotGeometry(S, T, n, p, cx, cy);
      if (g) geos.push(Object.assign(g, { chance: potChance(g, T, PLAN_SIGMA), cx, cy }));
    }
    geos.sort((a, b) => b.chance - a.chance);
    if (!candidates.length || (place && geos.length && geos[0].chance > (candidates[0] || {}).chance)) candidates = geos.slice(0, 4);
    yield { stage: 'look', candidates: geos.slice(0, 4), place };
    const top = geos.slice(0, place ? 2 : sk.top);
    for (const geo of top) {
      const Gp = place ? withCue(G, place) : G;
      const slope = aimSlope(Gp, geo);
      if (slope == null) continue;
      for (const vr of variantsFor(geo, G.S.P)) {
        const phi = refineAim(Gp, geo, vr, slope);
        if (phi == null) continue;
        const e = evaluate(Gp, geo, vr, phi, place);
        if (e) { e.geo = geo; all.push(e); }
      }
      yield { stage: 'test', candidates: geos.slice(0, 4), geo, tried: all.length };
    }
  }
  all.sort((a, b) => b.score - a.score);
  const best = all[0];
  if (best && best.chance > 0.3) {
    const s = best.shot;
    return noisy({ kind: 'pot', phi: s.phi, v: s.v, a: s.a, b: s.b, n: s.n, pocket: s.pocket, place: s.place || null,
      candidates, chosen: best.geo, est: { chance: best.chance, pos: best.pos, score: best.score } }, sk, r);
  }
  // no good pot: a safety, else a kick, else the best poor pot
  const saf = G.inHand ? [] : yield* safety(G, legal);
  saf.sort((a, b) => b.score - a.score);
  if (saf.length && (!best || saf[0].score > 0.55)) {
    const s = saf[0].shot;
    return noisy({ kind: 'safe', phi: s.phi, v: s.v, a: 0, b: 0, n: s.n, pocket: -1, place: null, candidates, chosen: null, est: { opp: saf[0].opp } }, sk, r);
  }
  if (best) {
    const s = best.shot;
    return noisy({ kind: 'pot', phi: s.phi, v: s.v, a: s.a, b: s.b, n: s.n, pocket: s.pocket, place: s.place || null, candidates, chosen: best.geo, est: { chance: best.chance, pos: best.pos, score: best.score } }, sk, r);
  }
  const ks = yield* kick(G, legal);
  ks.sort((a, b) => b.score - a.score);
  if (ks.length) { const s = ks[0].shot; return noisy({ kind: 'kick', phi: s.phi, v: s.v, a: 0, b: 0, n: s.n, pocket: -1, place: null, candidates, chosen: null, est: {} }, sk, r); }
  // nothing legal found: roll toward the nearest legal ball
  const n = legal[0] || 0;
  const phi = n ? Math.atan2(S.y[n] - S.y[0], S.x[n] - S.x[0]) : 0;
  return noisy({ kind: 'blind', phi, v: 1.5, a: 0, b: 0, n, pocket: -1, place: G.inHand ? places[0] : null, candidates, chosen: null, est: {} }, sk, r);
}

function withCue(G, place) {
  const S = clone(G.S);
  S.x[0] = place.x; S.y[0] = place.y; S.on[0] = 1;
  return Object.assign({}, G, { S });
}

function noisy(plan, sk, r) {
  plan.ideal = { phi: plan.phi, v: plan.v, a: plan.a, b: plan.b };
  plan.phi += sk.aim * r.gauss();
  plan.v *= 1 + sk.speed * r.gauss();
  plan.a += sk.tip * r.gauss(); plan.b += sk.tip * r.gauss();
  return plan;
}

// Run the planner to the end (tests, the saver warm up).
export function plan(G, opts) {
  const it = think(G, opts);
  let s = it.next();
  while (!s.done) s = it.next();
  return s.value;
}

// One whole turn with no display: plan, place, shoot, judge, apply.
// Returns { plan, verdict, potted }.
export function autoTurn(G, opts) {
  const pl = plan(G, opts);
  const S = G.S;
  if (pl.place) { S.x[0] = pl.place.x; S.y[0] = pl.place.y; S.on[0] = 1; }
  beginShot(S);
  strike(S, 0, pl);
  simulate(S, { maxT: 60 });
  const verdict = judge(G, { ball: pl.n, pocket: pl.pocket });
  const potted = S.potted.map(e => e.i);
  applyVerdict(G, verdict);
  return { plan: pl, verdict, potted };
}
