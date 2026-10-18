// ============================================================================
//  POOL PHYSICS  ·  tests/rules.test.mjs — racks and the 8-ball / 9-ball rules
// ----------------------------------------------------------------------------
//  racks .... 300 seeds: a legal 8-ball rack (apex on the foot spot, the 8 in
//             the middle of the third row, a solid and a stripe in the back
//             corners, no overlaps); the 9-ball diamond
//  fouls .... scratch, no ball hit, wrong ball first, no rail: ball in hand
//             for the other player
//  the 8 .... early loses, in the called pocket wins, on a foul loses, in
//             another pocket loses
//  groups ... the called ball sets the group on an open table
//  break .... a scratch gives ball in hand in the kitchen; an illegal break
//             gives the break to the other player; the 8 on the break is
//             spotted again
//  9-ball ... lowest ball first, the 9 on the break wins, a 9 on a foul is
//             spotted again
//  Real shots where it is cheap, else the shot facts set by hand.
// ============================================================================
import { ok, done } from './util.mjs';
import { buildTable, rack8, rack9, rng, isLegalRack8 } from '../core/table.js';
import { beginShot, strike, simulate } from '../core/physics.js';
import { newGame, judge, apply, legalTargets } from '../core/rules.js';

const T = buildTable();
{
  let bad = 0;
  for (let s = 1; s <= 300; s++) if (!isLegalRack8(T, rack8(T, rng(s)))) bad++;
  ok(bad === 0, 'rack: 300 seeded 8-ball racks are legal (8 in the middle, solid and stripe in the back corners, apex on the foot spot)', `${bad} bad`);
  let b9 = 0;
  for (let s = 1; s <= 100; s++) { const r = rack9(T, rng(s)); const one = r.find(b => b.row === 0), nine = r.find(b => b.row === 2 && b.col === 1); if (one.n !== 1 || nine.n !== 9 || r.length !== 9) b9++; }
  ok(b9 === 0, 'rack: 100 9-ball diamonds have the 1 at the apex and the 9 in the middle', `${b9} bad`);
  const G = newGame({ seed: 3 });
  ok(G.S.x[0] < T.headX && G.kitchen && G.inHand, 'rack: the cue ball starts behind the head string, in hand for the break');
}

// a game after the break, with chosen balls on the table
function mid({ type = '8', on = [1, 2, 9, 10, 8], group = null, turn = 0 } = {}) {
  const G = newGame({ type, seed: 9 });
  G.phase = 'play'; G.inHand = false; G.kitchen = false; G.turn = turn;
  const S = G.S; S.on.fill(0);
  S.on[0] = 1; S.x[0] = -0.8; S.y[0] = 0;
  on.forEach((n, k) => { S.on[n] = 1; S.x[n] = -0.3 + 0.15 * k; S.y[n] = 0.3 * ((k % 2) ? 1 : -1); });
  if (group) { G.open = false; G.players[turn].group = group; G.players[1 - turn].group = group === 'solids' ? 'stripes' : 'solids'; }
  beginShot(S);
  return G;
}
const facts = (G, f) => { Object.assign(G.S, { first: -1, railAfter: false, potted: [] }, f); for (const e of G.S.potted) G.S.on[e.i] = 0; return judge(G, f.call || {}); };

{
  // a real scratch: cue ball straight into the bottom left corner
  const G = mid({ group: 'solids' }), S = G.S, p = T.pockets.find(q => q.sx === -1 && q.sy === -1);
  S.x[0] = -0.9; S.y[0] = -0.3;
  beginShot(S); strike(S, 0, { phi: Math.atan2(p.my - S.y[0], p.mx - S.x[0]), v: 3 }); simulate(S);
  const v = judge(G, {});
  apply(G, v);
  ok(v.foul && v.scratch && G.turn === 1 && G.inHand && !G.kitchen && G.S.on[0], 'foul: a real scratch gives the other player ball in hand anywhere', `${v.why}; first ${v.first}`);
}
{
  const G = mid({ group: 'solids' });
  const v = facts(G, { first: -1 });
  ok(v.foul && v.why === 'no ball hit', 'foul: no ball hit');
  const w = facts(mid({ group: 'solids' }), { first: 9, railAfter: true });
  ok(w.foul && /wrong ball/.test(w.why), 'foul: a ball of the other group first', w.why);
  const e = facts(mid({}), { first: 8, railAfter: true });
  ok(e.foul && /wrong ball/.test(e.why), 'foul: the 8 first on an open table', e.why);
  const n = facts(mid({ group: 'solids' }), { first: 1, railAfter: false });
  ok(n.foul && /no rail/.test(n.why), 'foul: no rail after the contact and nothing potted', n.why);
  const g = facts(mid({ group: 'solids' }), { first: 1, railAfter: false, potted: [{ i: 2, pocket: 0, t: 1 }] });
  ok(!g.foul && g.keep, 'legal: own ball potted (no rail needed), the turn goes on');
  const o = facts(mid({ group: 'solids' }), { first: 1, railAfter: true, potted: [{ i: 9, pocket: 0, t: 1 }] });
  ok(!o.foul && !o.keep, 'legal: only the other group potted, the turn passes');
}
{
  const early = facts(mid({ group: 'solids' }), { first: 1, railAfter: true, potted: [{ i: 8, pocket: 2, t: 1 }] });
  ok(early.lose, 'the 8: potted before the group is clear loses', early.why);
  const G = mid({ group: 'solids', on: [9, 10, 8] });
  ok(JSON.stringify(legalTargets(G)) === '[8]', 'the 8: with the group clear, the 8 is the only legal ball');
  const win = facts(G, { first: 8, railAfter: true, potted: [{ i: 8, pocket: 3, t: 1 }], call: { ball: 8, pocket: 3 } });
  ok(win.win, 'the 8: in the called pocket wins', win.why);
  const wrong = facts(mid({ group: 'solids', on: [9, 8] }), { first: 8, railAfter: true, potted: [{ i: 8, pocket: 1, t: 1 }], call: { ball: 8, pocket: 3 } });
  ok(wrong.lose, 'the 8: in another pocket loses', wrong.why);
  const scr = facts(mid({ group: 'solids', on: [9, 8] }), { first: 8, railAfter: true, potted: [{ i: 8, pocket: 3, t: 1 }, { i: 0, pocket: 1, t: 2 }], call: { ball: 8, pocket: 3 } });
  ok(scr.lose, 'the 8: potted with a scratch loses', scr.why);
  const Gw = mid({ group: 'solids', on: [9, 8] });
  apply(Gw, win);
  ok(Gw.phase === 'over' && Gw.winner === 0, 'the 8: the game ends with a winner');
}
{
  const G = mid({});
  const v = facts(G, { first: 9, railAfter: true, potted: [{ i: 10, pocket: 0, t: 1 }, { i: 1, pocket: 1, t: 1.2 }], call: { ball: 9, pocket: 2 } });
  apply(G, v);
  ok(G.open && G.players[0].group === null && G.turn === 0, 'groups: both groups down and the called ball not potted: the table stays open, the turn goes on');
  const H = mid({});
  const w = facts(H, { first: 9, railAfter: true, potted: [{ i: 9, pocket: 0, t: 1 }], call: { ball: 9, pocket: 0 } });
  apply(H, w);
  ok(H.players[0].group === 'stripes' && H.players[1].group === 'solids' && !H.open, 'groups: the called stripe sets stripes for the shooter');
}
{
  const G = newGame({ seed: 4 }), S = G.S;
  beginShot(S);
  Object.assign(S, { first: 1, railMask: 0b1111110, potted: [{ i: 0, pocket: 2, t: 1 }] }); S.on[0] = 0;
  const v = judge(G, {}); apply(G, v);
  ok(v.foul && G.turn === 1 && G.inHand && G.kitchen, 'break: a scratch on the break gives ball in hand behind the head string', v.why);
  const H = newGame({ seed: 5 }); beginShot(H.S);
  Object.assign(H.S, { first: 1, railMask: 0b110, potted: [] });
  const w = judge(H, {}); apply(H, w);
  ok(!w.breakOk && H.turn === 1 && H.phase === 'break', 'break: fewer than four balls to a rail and nothing down: the other player breaks again', w.why);
  const E = newGame({ seed: 6 }); beginShot(E.S);
  Object.assign(E.S, { first: 1, railMask: 0b11111110, potted: [{ i: 8, pocket: 4, t: 1 }] }); E.S.on[8] = 0;
  const e = judge(E, {}); apply(E, e);
  ok(E.S.on[8] && E.phase === 'play' && E.turn === 1, 'break: the 8 on the break is spotted again (no other ball down: the turn passes)', `8 at x = ${E.S.x[8].toFixed(3)}`);
}
{
  const G = mid({ type: '9', on: [3, 5, 9] });
  ok(JSON.stringify(legalTargets(G)) === '[3]', '9-ball: the lowest ball is the only legal first ball');
  const f = facts(G, { first: 5, railAfter: true });
  ok(f.foul, '9-ball: another ball first is a foul', f.why);
  const c = facts(mid({ type: '9', on: [3, 5, 9] }), { first: 3, railAfter: true, potted: [{ i: 9, pocket: 1, t: 1 }] });
  ok(c.win, '9-ball: a combination that sinks the 9 off the lowest ball wins', c.why);
  const H = mid({ type: '9', on: [3, 5, 9] });
  const r = facts(H, { first: 5, railAfter: true, potted: [{ i: 9, pocket: 1, t: 1 }] });
  apply(H, r);
  ok(r.foul && H.S.on[9] && H.turn === 1 && H.inHand, '9-ball: a 9 potted on a foul is spotted again, ball in hand', r.why);
  const B = newGame({ type: '9', seed: 2 }); beginShot(B.S);
  Object.assign(B.S, { first: 1, railMask: 0b1111110, potted: [{ i: 9, pocket: 0, t: 1 }] }); B.S.on[9] = 0;
  const bw = judge(B, {});
  ok(bw.win, '9-ball: the 9 on a legal break wins', bw.why);
}
done();
