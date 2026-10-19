// ============================================================================
//  POOL PHYSICS  ·  tests/online-page.test.mjs — the Online mode in jsdom
// ----------------------------------------------------------------------------
//  The real index.html, main.js and online.js in jsdom; window.fetch and
//  window.WebSocket reach the real worker/worker.js in this process
//  (tests/fake-do.mjs). The second player is a script on the same server.
//    no URL ....... the Online section says "not deployed", no request
//                   goes out, the AI still plays
//    create ....... a wrong password shows the error; the right one makes
//                   a room: code, seat 0, the break to plan, no password
//                   in localStorage
//    join, live ... the script joins and opens a socket: the page shows
//                   the other player online (the presence dot)
//    shot out ..... the page shoots; the server has the end state of the
//                   page, bit for bit
//    shot in ...... the script shoots; the page plays it from the input
//                   (phase roll) and then holds the end state, bit for bit
//    turns ........ the page cannot shoot on the turn of the other seat
//    reload ....... a new page with the same storage resumes the room
//    leave ........ back to AI play; the room stays for "Resume"
//  Fails (does not skip) when jsdom is missing.
// ============================================================================
import { ok, done } from './util.mjs';
import { bootPage, loadJsdom } from './harness.mjs';
import { makeServer } from './fake-do.mjs';
import { snapshot, gameOf, computeShot } from '../core/netstate.js';
import { buildTable } from '../core/table.js';

if (!loadJsdom()) { ok(false, 'jsdom: not found (set JSDOM_DIR or NODE_PATH)'); done(); process.exit(1); }
const PW = 'page-test-pass', URL0 = 'http://localhost:8790';
const T = buildTable();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const tickOnce = () => new Promise(r => setTimeout(r, 0));
async function until(P, cond, max = 4000, frames = 1) {
  for (let k = 0; k < max; k++) { if (cond()) return k; await tickOnce(); P.frames(frames); }
  return -1;
}
const q = (P, k) => P.doc.querySelector(`#onlineSlot [data-r="${k}"]`);
const click = (P, k) => q(P, k).dispatchEvent(new P.win.Event('click'));

// ── no URL: the note, nothing else changes ──────────────────────────────────
{
  let fetches = 0;
  const P = await bootPage({ before: win => { win.fetch = async () => { fetches++; throw new Error('no'); }; } });
  const secs = [...P.doc.querySelectorAll('#panelBody .snp-sec')].map(s => s.dataset.sec).join(',');
  ok(secs === 'game,online,shot,maths,view,about', 'no URL: the panel has the Online section after Game', secs);
  ok(!q(P, 'nodeploy').hidden && q(P, 'form').hidden && /not deployed/.test(q(P, 'nodeploy').textContent), 'no URL: the Online section says the server is not deployed and shows no form');
  const seen = new Set();
  for (let k = 0; k < 200; k++) { P.frames(1); seen.add(P.pool.APP.phase); }
  ok(seen.has('think') && !P.pool.APP.net && fetches === 0 && P.errors.length === 0, 'no URL: the AI plays as before, no request goes out, no errors', `phases ${[...seen].join(' ')}, ${fetches} fetches ${P.errors.slice(0, 1)}`);
  P.close();
}

// ── with a server ───────────────────────────────────────────────────────────
const D = await makeServer({ password: PW });
let saved = {};
const before = win => {
  win.localStorage.clear();
  for (const [k, v] of Object.entries(saved)) win.localStorage.setItem(k, v);
  win.localStorage.setItem('billiard.server', URL0);
  win.fetch = D.fetch; win.WebSocket = D.WebSocket;
};
const P = await bootPage({ before });
const A = P.pool.APP, net = P.pool.online;
A.show.slow = false; A.speed = 2;
ok(q(P, 'nodeploy').hidden && !q(P, 'form').hidden, 'server: with a URL the Online form shows');

q(P, 'pw').value = 'wrong';
click(P, 'create');
await until(P, () => !net.busy && q(P, 'err').textContent, 200);
ok(/Wrong password/.test(q(P, 'err').textContent) && !A.net, 'create: a wrong password shows "Wrong password." and no room', q(P, 'err').textContent);

q(P, 'pw').value = PW;
click(P, 'create');
await until(P, () => A.net && A.phase === 'plan', 400);
const code = net.code;
const st = JSON.parse(P.win.localStorage.getItem('billiard.online') || '{}');
ok(A.net && /^[A-Z2-9]{6}$/.test(code) && q(P, 'codeOut').textContent === code && net.seat === 0, 'create: the right password makes a room; the code shows; seat 0', `code ${code}`);
ok(A.phase === 'plan' && A.G.phase === 'break' && !q(P, 'room').hidden, 'create: seat 0 breaks; the planner is open');
ok(st.code === code && st.key && !JSON.stringify(st).includes(PW) && !Object.values(P.win.localStorage).join('').includes(PW), 'storage: localStorage keeps the code and the seat key, never the password');
await until(P, () => D.sockets.length && D.sockets[0].readyState === 1, 50);
ok(D.sockets.length === 1 && D.sockets[0].readyState === 1, 'socket: the page opens the room socket');

// the second player joins and comes online
const j = await D.call('POST', `/rooms/${code}/join`, { password: PW });
const key1 = j.j.seatKey;
const sock1 = await D.socket(code, key1);
await until(P, () => net.online[1], 50);
P.frames(8);
const dot1 = P.doc.querySelector('#p1 .dot');
ok(j.s === 200 && j.j.seat === 1 && net.online[1] && dot1.classList.contains('net-on') && /online/.test(q(P, 'seatLine').textContent), 'live: the other player joins; the page shows them online (dot and seat line)', q(P, 'seatLine').textContent);

// the page shoots until the turn goes to seat 1
let outShots = 0, exactOut = true, guard = 0;
while (A.G.turn === 0 && A.G.phase !== 'over' && guard++ < 12) {
  await until(P, () => A.phase === 'plan', 600);
  P.pool.shootPlan();
  outShots++;
  const v0 = net.version;
  await until(P, () => (A.phase === 'plan' || A.phase === 'wait' || A.phase === 'over') && !A.netShot && !net.pending && net.version === v0 + 1, 6000);
  const srv = await D.call('GET', `/rooms/${code}`, null, key1);
  if (!srv.j || !same(srv.j.state.snap, snapshot(A.G))) exactOut = false;
}
const srv1 = (await D.call('GET', `/rooms/${code}?since=-1`, null, key1)).j;
ok(outShots >= 1 && exactOut && srv1.state.version === outShots, 'shot out: each shot of the page is on the server; the server state equals the page state bit for bit', `${outShots} shots, version ${srv1.state.version}`);
const pushed = sock1.out.filter(m => m.t === 'shot').length;
ok(pushed === outShots, 'shot out: the socket of the other player got each shot', `${pushed} pushes`);
ok(A.phase === 'wait' && /Waiting for the shot of Player 2/.test(P.doc.getElementById('bannerText').textContent), 'turns: the page waits for the other player', P.doc.getElementById('bannerText').textContent);
ok(net.shoot({ phi: 0, v: 2, a: 0, b: 0, n: -1, pocket: -1, place: null }) === null, 'turns: the page cannot shoot on the turn of seat 1');

// the second player shoots; the page plays it again from the input
const G1 = gameOf(srv1.state, { T, names: ['Player 1', 'Player 2'] });
const S1 = G1.S, tgt = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15].find(n => S1.on[n]);
const place = G1.inHand ? { x: G1.kitchen ? T.headX - 0.1 : 0.2, y: 0.25 } : null;
const cx = place ? place.x : S1.x[0], cy = place ? place.y : S1.y[0];
const input = { phi: Math.atan2(S1.y[tgt] - cy, S1.x[tgt] - cx), v: 3, a: 0, b: 0.2, n: tgt, pocket: -1, place };
const out = computeShot(G1, input);
const r2 = await D.call('POST', `/rooms/${code}/shot`, { from: srv1.state.version, input, end: out.end, verdict: out.verdict }, key1);
let sawRoll = false;
await until(P, () => { if (A.phase === 'roll' && A.netShot && A.netShot.by === 1) sawRoll = true; return sawRoll && !A.netShot && net.version === r2.j.version; }, 6000);
ok(r2.s === 200 && sawRoll, 'shot in: the page plays the shot of Player 2 from its input (the roll runs)', `status ${r2.s}`);
ok(same(snapshot(A.G), out.end) && net.version === r2.j.version, 'shot in: after the roll the page holds the end state of the shooter, bit for bit', `version ${net.version}`);
ok(P.errors.length === 0, 'page: no errors in the online round trip', P.errors.slice(0, 2).join(' | '));

// ── reload: a new page with the same storage resumes ────────────────────────
saved = {};
for (let k = 0; k < P.win.localStorage.length; k++) { const n = P.win.localStorage.key(k); if (n !== 'billiard.server') saved[n] = P.win.localStorage.getItem(n); }
net.leave({ keep: true, restart: false });
P.close();
const P2 = await bootPage({ before, hash: '#seed=7&game=8' });
const A2 = P2.pool.APP, net2 = P2.pool.online;
await until(P2, () => A2.net && !A2.netShot && (A2.phase === 'plan' || A2.phase === 'wait'), 400);
const srv2 = (await D.call('GET', `/rooms/${code}`, null, key1)).j;
ok(A2.net && net2.code === code && net2.seat === 0 && net2.version === srv2.state.version && same(snapshot(A2.G), srv2.state.snap), 'reload: the page resumes the room with its seat key and the server state', `version ${net2.version}`);
ok(/Player 1 \(you\)/.test(P2.doc.getElementById('p0n').textContent), 'reload: the score pill marks Player 1 as you', P2.doc.getElementById('p0n').textContent);

// ── leave: back to the AI, the room stays saved ─────────────────────────────
click(P2, 'leave');
const seen2 = new Set();
for (let k = 0; k < 200; k++) { P2.frames(1); seen2.add(A2.phase); }
ok(!A2.net && seen2.has('think') && !q(P2, 'resume').hidden && q(P2, 'resume').textContent.includes(code), 'leave: the AI plays again; "Resume game" offers the room', q(P2, 'resume').textContent);
ok(P2.errors.length === 0, 'page: no errors after the reload and the leave', P2.errors.slice(0, 2).join(' | '));
P2.close();

done();
process.exit(process.exitCode || 0);
