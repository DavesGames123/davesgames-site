// ============================================================================
//  POOL PHYSICS  ·  core/rules.js — 8-ball and 9-ball (WPA rules, in short)
// ----------------------------------------------------------------------------
//  A game G holds the physics state, whose turn it is, the groups, ball in
//  hand and the result. The rules read only the facts of a shot that
//  core/physics.js records: the first ball the cue ball hit (S.first), a
//  rail after that contact (S.railAfter), the balls that hit a rail
//  (S.railMask) and the potted balls (S.potted).
//
//  8-BALL  break: legal when a ball falls or four object balls reach a
//          rail, else the other player breaks again. A scratch on the break
//          gives ball in hand behind the head string. The 8 on the break is
//          spotted again. The table is open after the break.
//          fouls: scratch, no ball hit, wrong ball first (the 8 first on an
//          open table, or a ball of the other group), no rail after the
//          contact and nothing potted. A foul gives ball in hand anywhere.
//          groups: the called ball (or the group of all potted balls) sets
//          the group on an open table.
//          the 8: potted legally in the called pocket after the group is
//          clear wins; potted early, in another pocket or with a foul loses.
//  9-BALL  the lowest ball first; any legal pot keeps the turn; the 9
//          potted legally wins (also on the break); a 9 potted on a foul is
//          spotted again. No push out and no three-foul rule here.
//
//  grep -n targets: "export function newGame", "export function legalTargets",
//  "export function judge", "export function apply", "function respot"
// ============================================================================
import { buildTable, rack8, rack9, rng, legalCuePlace } from './table.js';
import { createState, enableOrientation, PHYS } from './physics.js';

export const SOLIDS = [1, 2, 3, 4, 5, 6, 7], STRIPES = [9, 10, 11, 12, 13, 14, 15];
export const groupOf = n => (n >= 1 && n <= 7 ? 'solids' : n >= 9 && n <= 15 ? 'stripes' : n === 8 ? 'eight' : null);

export function newGame({ type = '8', seed = 1, T = buildTable(), P = PHYS, names = ['Left', 'Right'], kinds = ['ai', 'ai'], orient = false } = {}) {
  const r = rng(seed);
  const S = createState(T, P);
  if (orient) enableOrientation(S);
  const G = {
    type, seed, r, T, S,
    turn: 0, breaker: 0,
    players: names.map((name, k) => ({ name, kind: kinds[k], group: null, potted: 0 })),
    open: true, phase: 'break', inHand: true, kitchen: true,
    winner: -1, reason: '', shots: 0, log: [], last: null,
  };
  rackUp(G);
  return G;
}

export function rackUp(G) {
  const { S, T, r } = G;
  S.on.fill(0); S.pot.fill(-1);
  for (const k of ['vx', 'vy', 'wx', 'wy', 'wz']) S[k].fill(0);
  const rack = G.type === '9' ? rack9(T, r) : rack8(T, r);
  for (const b of rack) { S.on[b.n] = 1; S.x[b.n] = b.x; S.y[b.n] = b.y; }
  S.on[0] = 1; S.x[0] = T.headX - 0.06; S.y[0] = 0;
  if (S.q) for (let i = 0; i < 16; i++) { S.q[4 * i] = 1; S.q[4 * i + 1] = S.q[4 * i + 2] = S.q[4 * i + 3] = 0; }
  G.rack = rack;
  G.phase = 'break'; G.inHand = true; G.kitchen = true; G.open = true;
  for (const p of G.players) { p.group = null; }
}

export const onTable = (G, n) => !!G.S.on[n];

// Balls the shooter may hit first. For 8-ball with the group clear: [8].
// mask: the balls on the table as a bit mask (judge passes the mask from
// the start of the shot), else the balls on the table now.
export function legalTargets(G, who = G.turn, mask = null) {
  const S = G.S, on = n => (mask == null ? !!S.on[n] : !!(mask & (1 << n)));
  if (G.type === '9') { for (let n = 1; n <= 9; n++) if (on(n)) return [n]; return []; }
  const p = G.players[who];
  if (G.open || !p.group) return [...SOLIDS, ...STRIPES].filter(on);
  const mine = (p.group === 'solids' ? SOLIDS : STRIPES).filter(on);
  return mine.length ? mine : (on(8) ? [8] : []);
}

// Judge the shot that S just finished. call = { ball, pocket } (the pocket
// id of core/table.js, or -1 for no call). Returns the verdict; apply()
// changes the game.
export function judge(G, call = {}) {
  const S = G.S, who = G.turn, p = G.players[who];
  const potted = S.potted.map(e => e.i);
  const objPotted = potted.filter(n => n > 0);
  const scratch = potted.includes(0);
  const v = { foul: false, why: '', keep: false, win: false, lose: false, group: null, respot: [], breakOk: true, potted: objPotted, scratch, first: S.first };
  const legal = G.phase === 'break' ? null : legalTargets(G, who, S.onMask0);
  if (G.phase === 'break') {
    const rails = popcount(S.railMask & ~1);
    v.breakOk = objPotted.length > 0 || rails >= 4;
    if (G.type === '9' && S.first !== 1) { v.foul = true; v.why = 'the 1 was not hit first on the break'; }
    if (scratch) { v.foul = true; v.why = 'scratch on the break'; }
    if (G.type === '8') {
      if (potted.includes(8)) v.respot.push(8);
      if (!v.breakOk && !v.foul) { v.why = 'an illegal break: fewer than four balls reached a rail'; return v; }
      v.keep = !v.foul && objPotted.some(n => n !== 8);
      return v;
    }
    // 9-ball break
    if (potted.includes(9)) { if (v.foul) v.respot.push(9); else { v.win = true; v.why = 'the 9 on the break'; return v; } }
    v.keep = !v.foul && objPotted.length > 0;
    return v;
  }
  if (scratch) { v.foul = true; v.why = 'scratch: the cue ball fell'; }
  else if (S.first < 0) { v.foul = true; v.why = 'no ball hit'; }
  else if (!legal.includes(S.first)) { v.foul = true; v.why = `wrong ball first (the ${S.first})`; }
  else if (!S.railAfter && objPotted.length === 0) { v.foul = true; v.why = 'no rail after the contact'; }

  if (G.type === '9') {
    if (potted.includes(9)) { if (v.foul) v.respot.push(9); else { v.win = true; v.why = 'the 9 is down'; return v; } }
    v.keep = !v.foul && objPotted.length > 0;
    return v;
  }
  // 8-ball
  if (potted.includes(8)) {
    const clear = legal.length === 1 && legal[0] === 8;
    const e8 = S.potted.find(e => e.i === 8);
    const rightPocket = call.ball !== 8 || call.pocket == null || call.pocket < 0 || e8.pocket === call.pocket;
    if (clear && !v.foul && rightPocket) { v.win = true; v.why = 'the 8 in the called pocket'; }
    else { v.lose = true; v.why = !clear ? 'the 8 fell before the group was clear' : v.foul ? 'the 8 fell on a foul' : 'the 8 fell in another pocket'; }
    return v;
  }
  if (v.foul) return v;
  if (G.open || !p.group) {
    const groups = new Set(objPotted.map(groupOf));
    let g = null;
    if (call.ball && objPotted.includes(call.ball)) g = groupOf(call.ball);
    else if (groups.size === 1) g = [...groups][0];
    if (g) { v.group = g; v.keep = true; }
    else v.keep = objPotted.length > 0;
    return v;
  }
  v.keep = objPotted.some(n => groupOf(n) === p.group);
  return v;
}

// Apply a verdict: groups, spots, turn, ball in hand, the end of the game.
export function apply(G, v) {
  const S = G.S, who = G.turn;
  G.shots++;
  G.last = v;
  for (const e of S.potted) if (e.i > 0) G.players[who].potted++;
  for (const n of v.respot) respot(G, n);
  if (v.win || v.lose) {
    G.winner = v.win ? who : 1 - who; G.phase = 'over'; G.reason = v.why;
    G.log.push({ who, v });
    return G;
  }
  if (G.phase === 'break') {
    if (G.type === '8' && !v.breakOk && !v.foul) {
      // the other player breaks again
      G.turn = 1 - who; G.breaker = G.turn; rackUp(G);
      G.log.push({ who, v });
      return G;
    }
    G.phase = 'play';
  }
  if (v.group && G.type === '8') {
    G.open = false;
    G.players[who].group = v.group;
    G.players[1 - who].group = v.group === 'solids' ? 'stripes' : 'solids';
  }
  if (v.scratch) {
    S.on[0] = 1;
    S.pot[0] = -1;
  }
  G.inHand = false; G.kitchen = false;
  if (v.foul) {
    G.turn = 1 - who; G.inHand = true;
    G.kitchen = v.why === 'scratch on the break';
    if (v.scratch || !S.on[0]) { S.on[0] = 1; placeCueDefault(G); }
  } else if (!v.keep) G.turn = 1 - who;
  G.log.push({ who, v });
  return G;
}

// Put the cue ball on a free spot (a placeholder; the shooter moves it).
export function placeCueDefault(G) {
  const S = G.S, T = G.T, others = [];
  for (let n = 1; n < 16; n++) if (S.on[n]) others.push({ x: S.x[n], y: S.y[n] });
  for (let k = 0; k < 200; k++) {
    const x = T.headX - 0.05 - (k % 10) * 0.03, y = ((k / 10) | 0) * 0.05 * ((k % 2) ? 1 : -1);
    if (legalCuePlace(T, x, y, others, true)) { S.x[0] = x; S.y[0] = y; break; }
  }
  S.vx[0] = S.vy[0] = S.wx[0] = S.wy[0] = S.wz[0] = 0;
}

// A ball back on the foot spot, or the nearest free point behind it.
function respot(G, n) {
  const S = G.S, T = G.T, R = T.R;
  const free = (x, y) => { for (let k = 0; k < 16; k++) if (k !== n && S.on[k] && Math.hypot(S.x[k] - x, S.y[k] - y) < 2 * R + 1e-4) return false; return true; };
  let x = T.footX;
  while (x < T.hx - R && !free(x, 0)) x += 0.002;
  if (!free(x, 0)) { x = T.footX; while (x > -T.hx + R && !free(x, 0)) x -= 0.002; }
  S.on[n] = 1; S.pot[n] = -1; S.x[n] = x; S.y[n] = 0;
  S.vx[n] = S.vy[n] = S.wx[n] = S.wy[n] = S.wz[n] = 0;
  S.potted = S.potted.filter(e => e.i !== n);
}

function popcount(m) { let c = 0; while (m) { c += m & 1; m >>>= 1; } return c; }

// A short status line for the HUD.
export function status(G) {
  const p = G.players[G.turn];
  if (G.phase === 'over') return `${G.players[G.winner].name} wins: ${G.reason}`;
  if (G.phase === 'break') return `${p.name} to break`;
  const tg = legalTargets(G);
  const what = G.type === '9' ? `the ${tg[0]}` : tg.length === 1 && tg[0] === 8 ? 'the 8' : G.open ? 'open table' : p.group;
  return `${p.name} · ${what}${G.inHand ? ' · ball in hand' : ''}`;
}
