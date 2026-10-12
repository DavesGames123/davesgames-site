// ============================================================================
//  FLY DUEL 3D  ·  between two games  (ES module, three.js r160, DOM optional)
// ----------------------------------------------------------------------------
//  The user (verbatim, 2026-10-12): "switching decks/end of game needs
//  better animations". Before, a new game put the next board on the table
//  at once (scene.js snapTo). Now the scene plays one sequence between two
//  games (scene.js setState calls take()). The phases, in order:
//
//    win      the win beat: the winner raises its arms again, the crowd
//             cheers, the camera eases to the win shot. The loser keeps
//             its head down over the thrown cards.
//    gather   both flies reach over the table. Every card (hand, thrown,
//             battlefield, graveyard, held) slides on an arc to the
//             library place of its owner and lands face down on the pile.
//             The pile grows card by card. Tokens shrink and go.
//    shuffle  the pile splits in two halves, the halves riffle together.
//    boxIn    the lid of the deck box opens, the deck goes into the box,
//             the lid closes.
//    swap     only when the deck of a seat changes (deckKey of hall.js):
//             the old box slides off the end of the table, the new box
//             comes up and slides in, and the playmat crossfades from the
//             old deck colours to the new ones (hall.swapDeckBox).
//    boxOut   the lid opens, the deck comes out to the library place, the
//             lid closes.
//    cut      a riffle, then the top half goes under the bottom half.
//    deal     the opening hands, one card at a time, seat by seat, from
//             the library to the fan. The d20s roll to the new life.
//
//  Play mode (scene first person): no cut and no deal. ui/play/play.js
//  shows the opening hand itself (ui/play/opening.js), so at the end of
//  boxOut the scene puts the new state on the table at once.
//  The saver gives a new game with empty hands first (saver.js
//  emptyHands), then the hands: the first sequence has no deal, and the
//  hands come with a short deal-only sequence (cut, deal).
//  A setState during the sequence changes its target. With no target
//  (park: play mode starts the clean-up at the rematch), the sequence
//  stops in the box until a state comes. skip() ends it at once (the
//  "New game" button of watch mode). Reduced motion: no sequence (a cut).
//  The phases run on scene time, so setSpeed scales them.
//
//  API
//      REGAME                         phase lengths, s at speed 1
//      regamePlan({ win, gather, swap, deal, hands, first }) -> { phases:
//        [{ name, at, dur }], deals: [{ p, i, at }], total } (pure)
//      createRegame(ctx) -> { take(state, { park }), update(dt), skip(),
//        busy, state() }
//      ctx: { W, Z, T, piles, hall, seatPos, seatQuat, newCard(id),
//        mirror(), setMirror(m), snapTo(m), deckBoxesOf(state), clip(p,
//        name, o), ended(), clearEnd(), fp(), shot(name, p), react(kind,
//        o), reduced }
//
//  GREP MAP
//      grep -n 'export const REGAME'          phase lengths
//      grep -n 'export function regamePlan'   the timeline (pure)
//      grep -n 'function collect'             cards -> gather moves
//      grep -n 'function riffle'              the two half piles
//      grep -n 'function boxMove'             the deck in and out of the box
//      grep -n 'function dealStart'           the opening hands
//      grep -n 'export function createRegame'
// ============================================================================
import * as THREE from 'three';
import { mirrorOf, mirrorDiff } from './choreo.js';
import { deckKey } from './hall.js';
import { TOKENS as TOKEN_CARDS } from '../../game/cards.js';

// Phase lengths in seconds at speed 1. dealGap: from one dealt card to the
// next; dealFly: the flight of one card; dealSettle: after the last card.
export const REGAME = Object.freeze({
  win: 0.7, gather: 1.0, shuffle: 0.55, boxIn: 0.55, swap: 1.2, boxOut: 0.55, cut: 0.55,
  dealGap: 0.07, dealFly: 0.3, dealSettle: 0.1,
});
const PILE = 0.007;        // pile height per card (scene.js layout)
const TOKEN_IDS = new Set((TOKEN_CARDS || []).map(t => t.id));

// The timeline. win: the win beat; gather: the clean-up (gather, shuffle,
// boxIn, boxOut); swap: a box swap; deal: the cut and the deal; hands:
// cards per seat; first: the seat that gets the first card.
export function regamePlan({ win = true, gather = true, swap = false, deal = true, hands = [7, 7], first = 0 } = {}, R = REGAME) {
  const phases = [];
  let at = 0;
  const add = (name, dur) => { phases.push({ name, at, dur }); at += dur; };
  if (win) add('win', R.win);
  if (gather) { add('gather', R.gather); add('shuffle', R.shuffle); add('boxIn', R.boxIn); }
  if (swap) add('swap', R.swap);
  if (gather) add('boxOut', R.boxOut);
  const deals = [];
  if (deal) {
    add('cut', R.cut);
    const n = [Math.max(0, hands[0] | 0), Math.max(0, hands[1] | 0)];
    const order = [];
    for (let i = 0; i < Math.max(n[0], n[1]); i++) for (const p of [first, 1 - first]) if (i < n[p]) order.push({ p, i });
    order.forEach((d, k) => deals.push({ ...d, at: at + k * R.dealGap }));
    if (order.length) add('deal', (order.length - 1) * R.dealGap + R.dealFly + R.dealSettle);
  }
  return { phases, deals, total: at };
}

const ease = k => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const clamp01 = k => Math.max(0, Math.min(1, k));

export function createRegame(ctx) {
  const { W, Z, T } = ctx;
  let run = null;          // the running sequence
  let count = 0;           // sequences started
  const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _a = new THREE.Vector3();

  // two half piles per seat for the shuffle and the cut, one pile for
  // the box moves (the geometry and material of the scene pile)
  const halves = [0, 1].map(p => [0, 1, 2].map(() => {
    const m = new THREE.Mesh(ctx.piles[p].lib.geometry, ctx.piles[p].lib.material);
    m.visible = false; m.castShadow = m.receiveShadow = true; m.name = 'regame-pile';
    W.fx.add(m);
    return m;
  }));
  const hideHalves = () => { for (const H of halves) for (const m of H) m.visible = false; };

  const cleanMirror = (m, libs) => ({
    turn: m.turn, active: m.active, result: null,
    players: m.players.map((pl, p) => ({ life: pl.life, library: libs ? libs[p] : pl.library, hand: [], battlefield: [], graveyard: [] })),
    held: [null, null], combat: { attackers: [], blocks: [] },
  });
  const handsOf = st => (st ? st.players.map(pl => pl.hand.length) : [0, 0]);
  const deckTotal = (st, p) => st.players[p].library.length + st.players[p].hand.length;

  // ---- the gather: every card object leaves the zones of the scene
  function collect(m) {
    const owner = new Map();
    m.players.forEach((pl, p) => pl.battlefield.forEach(x => owner.set(x.uid, p)));
    const list = [];
    const push = (o, p) => { if (o) list.push({ o, p, token: TOKEN_IDS.has(o.id) }); };
    for (let p = 0; p < 2; p++) {
      Z.hand[p].forEach(o => push(o, p));
      Z.grave[p].forEach(o => push(o, p));
      push(Z.held[p], p);
    }
    for (const [uid, o] of Z.perms) push(o, owner.get(uid) ?? 0);
    for (const o of Z.tossed) push(o, o.toss?.p ?? 0);
    Z.hand = [[], []]; Z.grave = [[], []]; Z.perms.clear(); Z.held = [null, null]; Z.tossed = [];
    Z.flags.clear();
    return list;
  }
  function gatherStart(R) {
    const m = ctx.mirror();
    const list = collect(m);
    const libs = m.players.map(pl => pl.library);
    ctx.setMirror(cleanMirror(m, libs));
    const per = [0, 0], n = [0, 0];
    for (const c of list) if (!c.token) n[c.p]++;
    const fly = R.gather * 0.5, spread = R.gather * 0.38;
    const centre = [new THREE.Vector3(), new THREE.Vector3()], cn = [0, 0];
    for (const c of list) {
      const o = c.o;
      o.toss = null; o.lunge = null; o.ring.visible = false; o.pulse = 0;
      o.basePos = null; o.delay = 0;
      if (o.badge) { o.mesh.remove(o.badge); o.badge.material.map?.dispose(); o.badge.material.dispose(); o.badge = null; o.badgeKey = ''; }
      centre[c.p].add(o.mesh.position); cn[c.p]++;
      if (c.token) {
        o.scaleTo = 0.01; c.at = fly; o.toP.copy(o.mesh.position); o.toQ.copy(o.mesh.quaternion); o.t = 1;
        continue;
      }
      const j = per[c.p]++;
      const delay = n[c.p] > 1 ? (j / (n[c.p] - 1)) * spread : 0;
      ctx.seatPos(c.p, T.deckU, 0.008 + (libs[c.p] + j) * PILE + 0.004, T.deckV, _p);
      ctx.seatQuat(c.p, Math.PI / 2, 0, (j % 5 - 2) * 0.02, _q);
      o.scaleTo = 1; o.dimTo = 1; o.glowTo = 0;
      o.next = { dur: fly, arc: 0.25 + 0.04 * (j % 4), delay };
      o.target(_p, _q);
      c.at = delay + fly;
    }
    run.cards = list;
    run.libs = libs.slice();
    // both flies reach over the table, then place the pile
    for (let p = 0; p < 2; p++) {
      if (cn[p]) centre[p].multiplyScalar(1 / cn[p]); else ctx.seatPos(p, 0, 0, T.creatureV, centre[p]);
      ctx.clip(p, 'reach', { target: centre[p], dur: R.gather * 0.5 });
      run.later.push({ at: run.t + R.gather * 0.5, fn: () => ctx.clip(p, 'place', { target: ctx.seatPos(p, T.deckU, 0.05, T.deckV), dur: R.gather * 0.5 }) });
    }
    ctx.shot('crane', 0);
  }
  function gatherUpdate(dt) {
    if (!run.cards) return;
    const m = ctx.mirror();
    for (const c of run.cards) {
      if (c.done) continue;
      c.o.update(dt);
      c.at -= dt;
      if (c.at <= 0) {
        c.done = true; c.o.dispose();
        if (!c.token) { m.players[c.p].library++; run.gathered[c.p]++; }
      }
    }
  }
  function gatherEnd() {
    if (!run.cards) return;
    const m = ctx.mirror();
    for (const c of run.cards) if (!c.done) { c.done = true; c.o.dispose(); if (!c.token) { m.players[c.p].library++; run.gathered[c.p]++; } }
    run.cards = null;
  }

  // ---- the pile meshes
  // pose(mesh, p, u, y, v, h, rx, rz): a pile of height h with its base at
  // seat point (u, y, v)
  function pose(mesh, p, u, y, v, h, rx = 0, rz = 0, s = 1) {
    ctx.seatPos(p, u, y, v, mesh.position);
    ctx.seatQuat(p, rx, 0, rz, mesh.quaternion);
    mesh.scale.set(s, Math.max(0.0005, h), s);
    mesh.visible = h > 0.0001;
  }
  // The riffle (k 0..1), then (cut) the top half goes under the bottom.
  function riffle(p, k, n, cut = false) {
    const [A, B] = halves[p];
    const nA = Math.ceil(n / 2), nB = n - nA, hA = nA * PILE, hB = nB * PILE;
    const U = T.deckU, V = T.deckV, y0 = 0.008;
    ctx.piles[p].lib.visible = false;
    halves[p][2].visible = false;
    const kr = cut ? clamp01(k / 0.55) : k;
    if (kr < 1) {
      if (kr < 0.35) {
        const s = ease(kr / 0.35);
        pose(A, p, U - 0.36 * s, y0, V, hA);
        pose(B, p, U + 0.36 * s, y0 + hA * (1 - s) + 0.06 * Math.sin(Math.PI * s), V, hB);
      } else if (kr < 0.8) {
        const s = ease((kr - 0.35) / 0.45), w = Math.sin(Math.PI * s);
        pose(A, p, U - 0.36 * (1 - s), y0, V, hA, 0, 0.22 * w);
        pose(B, p, U + 0.36 * (1 - s), y0 + hA * s + 0.05 * w, V, hB, 0, -0.22 * w);
      } else { pose(A, p, U, y0, V, hA); pose(B, p, U, y0 + hA, V, hB); }
      return;
    }
    // the cut: the top half B goes out to the side, A rises, B slides
    // under it, A comes down on B
    const c = clamp01((k - 0.55) / 0.45);
    const out = ease(c / 0.4), back = ease((c - 0.4) / 0.4), down = ease((c - 0.75) / 0.25);
    const bu = U + 0.62 * out * (1 - back);
    const by = c < 0.4 ? y0 + hA * (1 - out) + 0.1 * Math.sin(Math.PI * out) : y0;
    const ay = y0 + (hB + 0.03) * ease((c - 0.3) / 0.3) * (1 - down) + hB * down;
    pose(A, p, U, c < 0.3 ? y0 : ay, V, hA);
    pose(B, p, bu, by, V, hB);
  }
  // The deck goes into the box (dir 'in') or comes out of it ('out').
  // k 0..1: the lid opens (0..0.2), the pile moves (0.15..0.8), the lid
  // closes (0.8..1).
  function boxMove(p, k, n, dir) {
    const H = halves[p][2], hall = ctx.hall;
    hall.setLid?.(p, k < 0.2 ? ease(k / 0.2) : k < 0.8 ? 1 : 1 - ease((k - 0.8) / 0.2));
    ctx.piles[p].lib.visible = false;
    halves[p][0].visible = halves[p][1].visible = false;
    const m = clamp01((k - 0.15) / 0.65);
    const s = ease(dir === 'in' ? m : 1 - m);           // 0: on the mat, 1: in the box
    const h = n * PILE;
    const top = hall.boxTop ? hall.boxTop(p, _a) : ctx.seatPos(p, 2.62, 0.67, 2.55, _a);
    const lib = ctx.seatPos(p, T.deckU, 0.008, T.deckV, _p);
    // up from the mat to over the box (s 0..0.6), then down into it
    const a = ease(s / 0.6), d = ease((s - 0.6) / 0.4);
    const x = lib.x + (top.x - lib.x) * a, z = lib.z + (top.z - lib.z) * a;
    const y = lib.y + (top.y + 0.25 - lib.y) * a + 0.3 * Math.sin(Math.PI * a) * (1 - a) - (0.45 + h) * d;
    H.position.set(x, y, z);
    // the pile stands up as it goes into the box and gets smaller
    ctx.seatQuat(p, -Math.PI / 2 * a, 0, 0, H.quaternion);
    const sc = 1 - 0.3 * a;
    H.scale.set(sc, Math.max(0.0005, h), sc);
    H.visible = h > 0 && d < 0.999;
  }

  // ---- the deal
  function dealStart() {
    const st = run.target;
    const m = mirrorOf(st);
    m.players.forEach((pl, p) => { pl.library += pl.hand.length; pl.hand = []; });
    ctx.setMirror(m);
    ctx.deckBoxesOf(st);
    run.dealt = 0;
    for (let p = 0; p < 2; p++) ctx.clip(p, 'reach', { target: ctx.seatPos(p, T.deckU, 0.05, T.deckV), dur: 0.8 });
    ctx.shot('wide', st.active ?? 0);
  }
  function dealCard(d) {
    const st = run.target, m = ctx.mirror();
    const id = st.players[d.p].hand[d.i];
    if (id == null) return;
    const o = ctx.newCard(id);
    ctx.seatPos(d.p, T.deckU, 0.008 + m.players[d.p].library * PILE, T.deckV, _p);
    ctx.seatQuat(d.p, Math.PI / 2, 0, 0, _q);
    o.place(_p, _q);
    o.next = { dur: REGAME.dealFly * run.R, arc: 0.45 };
    Z.hand[d.p].push(o);
    m.players[d.p].hand.push(id);
    m.players[d.p].library = Math.max(0, m.players[d.p].library - 1);
    run.dealt++;
  }

  // ---- the run
  function tailFor(target) {
    const play = ctx.fp() != null;
    const swap = [0, 1].map(p => !!(target && target.decks && deckKey(target.decks[p]) !== (ctx.hall.deckKeyOf?.(p) ?? deckKey(target.decks[p]))));
    return { swap, deal: !!target && !play, hands: handsOf(target), first: target?.active ?? 0 };
  }
  function build(o) {
    const plan = regamePlan(o);
    run.plan = plan; run.i = 0; run.t = 0; run.deals = plan.deals.slice();
    run.swap = o.swapSeats || [false, false];
  }
  function start(target, { win, gather }) {
    count++;
    run = { target, t: 0, i: 0, R: 1, later: [], cards: null, gathered: [0, 0], dealt: 0, swapped: [false, false], waiting: false, gather, n: [0, 0] };
    const tail = tailFor(target);
    const parkNow = gather && !target;
    build({ win, gather, swap: tail.swap.some(Boolean), swapSeats: tail.swap, deal: tail.deal, hands: tail.hands, first: tail.first });
    if (parkNow) {
      // stop in the box: drop the phases after boxIn until a state comes
      const k = run.plan.phases.findIndex(x => x.name === 'boxIn');
      run.plan.phases.length = k + 1; run.plan.deals = []; run.deals = [];
      run.plan.total = run.plan.phases[k].at + run.plan.phases[k].dur;
      run.waiting = true;
    }
    if (!gather) {
      const m = ctx.mirror();
      run.n = m.players.map(pl => pl.library);
    }
    enter(run.plan.phases[0]);
  }
  // A new target. The phases that ran or run now stay (in a clean-up, at
  // least up to boxIn; in the swap or boxOut, up to boxOut). The rest is
  // made again for the target: the swap (when no box move started yet),
  // boxOut, the cut and the deal. In the deal, the end puts the target on
  // the table.
  function retarget(state) {
    if (!state) return;
    run.target = state;
    const P = run.plan.phases, cur = P[run.i]?.name;
    if (cur === 'deal') { run.restDeal = true; return; }
    const idx = n => P.findIndex(x => x.name === n);
    let keepTo = Math.min(run.i, P.length - 1);
    if (run.gather) keepTo = Math.max(keepTo, idx('boxIn'));
    if (cur === 'swap' || cur === 'boxOut') keepTo = Math.max(keepTo, idx('boxOut'));
    const keep = P.slice(0, keepTo + 1);
    const tail = tailFor(state);
    const names = new Set(keep.map(x => x.name));
    const canSwap = run.gather && !names.has('swap') && !names.has('boxOut');
    let at = keep.length ? keep[keep.length - 1].at + keep[keep.length - 1].dur : 0;
    const add = (name, dur) => { keep.push({ name, at, dur }); at += dur; };
    if (canSwap) { run.swap = tail.swap; if (tail.swap.some(Boolean)) add('swap', REGAME.swap); }
    if (run.gather && !names.has('boxOut')) add('boxOut', REGAME.boxOut);
    run.deals = [];
    if (tail.deal) {
      if (!names.has('cut')) add('cut', REGAME.cut);
      const rest = regamePlan({ win: false, gather: false, deal: true, hands: tail.hands, first: tail.first });
      const d0 = rest.phases.find(x => x.name === 'deal');
      if (d0) {
        const shift = at - d0.at;
        run.deals = rest.deals.map(d => ({ ...d, at: d.at + shift }));
        add('deal', d0.dur);
      }
    }
    run.plan.phases = keep;
    run.plan.deals = run.deals.slice();
    run.plan.total = at;
    if (run.waiting) { run.waiting = false; run.t = Math.min(run.t, P.length ? P[P.length - 1].at + P[P.length - 1].dur : 0); enter(keep[run.i]); }
  }
  function enter(ph) {
    if (!ph) return;
    const m = ctx.mirror();
    if (ph.name === 'win') {
      const w = ctx.ended();
      if (w >= 0) { ctx.clip(w, 'raiseArms'); ctx.react('cheer', { side: w, strength: 1 }); ctx.shot('win', w); }
    } else if (ph.name === 'gather') {
      ctx.clearEnd();
      gatherStart(REGAME);
    } else if (ph.name === 'shuffle' || ph.name === 'boxIn') {
      gatherEnd();
      run.n = m.players.map(pl => pl.library);
      if (ph.name === 'boxIn') for (let p = 0; p < 2; p++) m.players[p].library = 0;
    } else if (ph.name === 'swap') {
      for (let p = 0; p < 2; p++) if (run.swap[p] && run.target) { ctx.hall.swapDeckBox(p, run.target.decks[p]); run.swapped[p] = true; }
      ctx.shot('wide', 0);
    } else if (ph.name === 'boxOut') {
      if (run.target) run.n = [0, 1].map(p => deckTotal(run.target, p));
    } else if (ph.name === 'cut') {
      if (run.target && !run.gather) run.n = m.players.map(pl => pl.library);
      else if (run.target) { run.n = [0, 1].map(p => deckTotal(run.target, p)); m.players.forEach((pl, p) => { pl.library = run.n[p]; }); }
    } else if (ph.name === 'deal') {
      hideHalves();
      dealStart();
    }
  }
  function leave(ph) {
    if (!ph) return;
    const m = ctx.mirror();
    if (ph.name === 'gather') gatherEnd();
    else if (ph.name === 'shuffle' || ph.name === 'cut') { hideHalves(); }
    else if (ph.name === 'boxIn') { hideHalves(); ctx.hall.setLid?.(0, 0); ctx.hall.setLid?.(1, 0); }
    else if (ph.name === 'swap') { for (let p = 0; p < 2; p++) if (ctx.hall.swapping?.(p)) ctx.hall.swapStep(p, 1); }
    else if (ph.name === 'boxOut') {
      hideHalves(); ctx.hall.setLid?.(0, 0); ctx.hall.setLid?.(1, 0);
      for (let p = 0; p < 2; p++) m.players[p].library = run.n[p];
    }
  }
  function phaseUpdate(ph, k) {
    if (ph.name === 'shuffle') for (let p = 0; p < 2; p++) riffle(p, k, run.n[p]);
    else if (ph.name === 'boxIn') for (let p = 0; p < 2; p++) boxMove(p, k, run.n[p], 'in');
    else if (ph.name === 'swap') { for (let p = 0; p < 2; p++) if (run.swapped[p]) ctx.hall.swapStep(p, k); }
    else if (ph.name === 'boxOut') for (let p = 0; p < 2; p++) boxMove(p, k, run.n[p], 'out');
    else if (ph.name === 'cut') for (let p = 0; p < 2; p++) riffle(p, k, run.n[p], true);
  }
  function finish() {
    if (!run) return;
    const r = run;
    gatherEnd();
    hideHalves();
    for (let p = 0; p < 2; p++) { if (ctx.hall.swapping?.(p)) ctx.hall.swapStep(p, 1); ctx.hall.setLid?.(p, 0); }
    run = null;
    ctx.clearEnd();
    if (r.target) {
      const want = mirrorOf(r.target);
      const m = ctx.mirror();
      if (mirrorDiff(m, want).length || r.restDeal || r.dealt !== want.players[0].hand.length + want.players[1].hand.length) ctx.snapTo(want);
      ctx.deckBoxesOf(r.target);
    } else {
      const m = ctx.mirror();
      for (let p = 0; p < 2; p++) m.players[p].library = Math.max(m.players[p].library, r.n[p]);
    }
  }

  function update(dt) {
    if (!run) return;
    run.t += dt;
    for (let i = run.later.length - 1; i >= 0; i--) if (run.t >= run.later[i].at) { const f = run.later[i].fn; run.later.splice(i, 1); f(); }
    const P = run.plan.phases;
    // phase changes
    while (run.i < P.length && run.t >= P[run.i].at + P[run.i].dur) {
      phaseUpdate(P[run.i], 1);
      leave(P[run.i]);
      run.i++;
      if (run.i < P.length) enter(P[run.i]);
    }
    if (run.i < P.length) {
      const ph = P[run.i];
      const k = ph.dur > 0 ? clamp01((run.t - ph.at) / ph.dur) : 1;
      if (ph.name === 'gather') gatherUpdate(dt);
      phaseUpdate(ph, k);
      if (ph.name === 'deal') while (run.deals.length && run.t >= run.deals[0].at) dealCard(run.deals.shift());
      return;
    }
    // the end: wait in the box for a target, else done
    if (run.waiting) { run.t = run.plan.total; return; }
    finish();
  }

  // take(state): true when the scene plays a sequence to state (the
  // scene must not put state on the table itself).
  function take(state, { park = false } = {}) {
    if (ctx.reduced) return false;
    if (run) { retarget(state); return true; }
    if (!ctx.mirror()) return false;
    if (ctx.ended() != null) {
      if (!state && !park) return false;
      start(state || null, { win: true, gather: true });
      return true;
    }
    if (state && dealOnly(state)) { start(state, { win: false, gather: false }); return true; }
    return false;
  }
  // The board is empty, the hands come now (the saver hands shot): the
  // same decks, the same libraries before the draw.
  function dealOnly(state) {
    const m = ctx.mirror();
    if (!m || !state?.players) return false;
    if (Z.tossed.length || Z.held.some(Boolean)) return false;
    let cards = 0;
    for (let p = 0; p < 2; p++) {
      const a = m.players[p], b = state.players[p];
      if (a.hand.length || a.battlefield.length || a.graveyard.length) return false;
      if (b.battlefield.length || b.graveyard.length) return false;
      if (a.library !== b.library.length + b.hand.length) return false;
      if (state.decks && deckKey(state.decks[p]) !== (ctx.hall.deckKeyOf?.(p) ?? '')) return false;
      cards += b.hand.length;
    }
    return cards > 0 && ctx.fp() == null;
  }

  return {
    take, update, skip: finish,
    get busy() { return !!run; },
    state() {
      if (!run) return { on: false, count, swaps: ctx.hall.boxSwaps?.() ?? 0 };
      const ph = run.plan.phases[run.i];
      return {
        on: true, count, phase: ph ? ph.name : run.waiting ? 'wait' : 'end', t: run.t, total: run.plan.total,
        phases: run.plan.phases.map(x => x.name), swap: run.swap.slice(), waiting: run.waiting,
        moving: run.cards ? run.cards.filter(c => !c.done).length : 0, gathered: run.gathered.slice(), dealt: run.dealt,
        swaps: ctx.hall.boxSwaps?.() ?? 0,
      };
    },
    // the cards in flight to the piles (tests)
    flying() { return run?.cards ? run.cards.filter(c => !c.done).map(c => ({ p: c.p, token: c.token, mesh: c.o.mesh })) : []; },
    dispose() { finish(); for (const H of halves) for (const m of H) W.fx.remove(m); },
  };
}
