// ============================================================================
//  POOL PHYSICS  ·  tests/online-sync.test.mjs — shot sync (node, no DOM)
// ----------------------------------------------------------------------------
//  core/netstate.js: the shooter computes the outcome, the other page
//  plays the shot again from the input and then sets the end state.
//    fresh rack .... the same seed gives the same rack; the breaker shoots
//    snapshot ...... JSON round trip is exact; the Worker accepts it
//    replay ........ the live tick loop (rollOut) from the input gives the
//                    end state of computeShot, bit for bit, on one machine
//    snap .......... a page with a small float error (1e-9 m) plays a
//                    different end; after applySnapshot it is exact again
//    a game ........ 24 shots in turn, each played on a second game and
//                    snapped: the two games stay equal at every shot
// ============================================================================
import { ok, done } from './util.mjs';
import { buildTable } from '../core/table.js';
import { snapshot, applySnapshot, gameOf, freshSnap, computeShot, rollOut } from '../core/netstate.js';
import { legalTargets } from '../core/rules.js';
import { cleanSnap, cleanInput, cleanVerdict } from '../worker/worker.js';

const T = buildTable();
const room = { type: '8', seed: 4242, breaker: 1, snap: null };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── fresh rack ──────────────────────────────────────────────────────────────
const A = gameOf(room, { T }), B = gameOf(room, { T });
ok(same(snapshot(A), snapshot(B)) && same(freshSnap(room, T), snapshot(A)), 'fresh rack: one seed gives one rack on both pages');
ok(A.turn === 1 && A.breaker === 1 && A.phase === 'break', 'fresh rack: the breaker of the room (seat 1) breaks', `turn ${A.turn}`);

// ── snapshot ────────────────────────────────────────────────────────────────
const s0 = snapshot(A), round = JSON.parse(JSON.stringify(s0));
ok(same(s0, round) && round.x.every((v, i) => v === A.S.x[i]), 'snapshot: the JSON round trip keeps every float exactly');
const C = gameOf({ ...room, snap: round }, { T });
ok(same(snapshot(C), s0), 'snapshot: a game from a snapshot gives the same snapshot');

// ── the break: compute, replay, snap ────────────────────────────────────────
const brk = { phi: Math.atan2(A.S.y[A.rack.find(b => b.row === 0).n] - A.S.y[0], A.S.x[A.rack.find(b => b.row === 0).n] - A.S.x[0]), v: 10, a: 0, b: 0.1, n: -1, pocket: -1, place: null };
const out = computeShot(A, brk);
ok(same(snapshot(A), s0), 'compute: the outcome comes from a copy; the game itself does not move');
ok(out.end.shots === 1, 'compute: the end state counts the shot', `shots ${out.end.shots}, phase ${out.end.phase}, turn ${out.end.turn}`);
ok(!!cleanSnap(out.end, room) && !!cleanInput(brk) && !!cleanVerdict(out.verdict), 'worker: the Worker field checks accept the snapshot, the input and the verdict');
const moved = out.end.x.filter((v, i) => v !== s0.x[i]).length;
ok(moved >= 4, 'compute: the break moves the balls', `${moved} balls moved`);

const Bv = gameOf(room, { T });
rollOut(Bv, brk);
let err = 0;
for (let i = 0; i < 16; i++) if (Bv.S.on[i]) err = Math.max(err, Math.abs(Bv.S.x[i] - out.end.x[i]), Math.abs(Bv.S.y[i] - out.end.y[i]));
ok(err === 0, 'replay: the live loop from the input lands on the end state of the shooter, bit for bit', `max error ${err} m`);

const Cv = gameOf(room, { T });
Cv.S.x[5] += 1e-9;
rollOut(Cv, brk);
let drift = 0;
for (let i = 0; i < 16; i++) drift = Math.max(drift, Math.abs(Cv.S.x[i] - out.end.x[i]), Math.abs(Cv.S.y[i] - out.end.y[i]));
applySnapshot(Cv, out.end);
ok(drift > 0 && same(snapshot(Cv), out.end), 'snap: a 1e-9 m start error gives a different end; the snap makes it exact', `drift before the snap ${drift.toExponential(2)} m`);
ok(Cv.S.vx.every(v => v === 0) && Cv.S.wz.every(v => v === 0) && Cv.S.potted.length === 0, 'snap: the balls rest after the snap (no speed, no spin)');

// ── a game in turns ─────────────────────────────────────────────────────────
// Shooter page H and viewer page W. Each shot: H computes, W plays the
// input and snaps; then H snaps to its own end (as main.js does).
const H = gameOf(room, { T }), W = gameOf(room, { T });
let equal = true, shots = 0, turns = new Set(), fouls = 0, pots = 0;
for (let k = 0; k < 24 && H.phase !== 'over'; k++) {
  const S = H.S, legal = legalTargets(H);
  let input;
  if (H.phase === 'break') input = brk;
  else {
    const n = legal.find(b => S.on[b]) ?? 8;
    const place = H.inHand ? { x: H.kitchen ? T.headX - 0.1 : 0, y: 0.3 } : null;
    const cx = place ? place.x : S.x[0], cy = place ? place.y : S.y[0];
    input = { phi: Math.atan2(S.y[n] - cy, S.x[n] - cx), v: 2 + (k % 3), a: 0, b: (k % 2) * 0.2, n, pocket: -1, place };
  }
  turns.add(H.turn);
  const r = computeShot(H, input);
  rollOut(W, input);
  applySnapshot(W, r.end);
  applySnapshot(H, r.end);
  if (!same(snapshot(W), snapshot(H)) || !cleanSnap(r.end, room)) equal = false;
  shots++; if (r.verdict.foul) fouls++; pots += r.verdict.potted.length;
}
ok(equal && shots >= 10, 'a game: after every shot the two pages hold the same state, and the Worker accepts it', `${shots} shots, ${fouls} fouls, ${pots} balls potted, turns ${[...turns].join(',')}`);
ok(turns.size === 2, 'a game: both seats get turns');

done();
