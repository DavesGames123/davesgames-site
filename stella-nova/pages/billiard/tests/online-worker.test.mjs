// ============================================================================
//  POOL PHYSICS  ·  tests/online-worker.test.mjs — the room server (node)
// ----------------------------------------------------------------------------
//  Runs worker/worker.js (the router and the PoolRoom Durable Object) in
//  node on a fake Durable Object runtime: a Map storage with alarms, an
//  id-from-name namespace, a fake WebSocketPair and hibernation calls.
//    password ...... create and join with the right and a wrong password;
//                    no secrets set gives 503; no password text in storage
//    seats ......... a third seat is refused; a seat key gets its seat
//                    again; a bad key is refused
//    turns ......... a shot out of turn, a stale version and a bad state
//                    are refused; a good shot moves the version
//    restart ....... a new object on the same storage has the same room
//    expiry ........ the alarm keeps a room for 30 days, then deletes it
//    sockets ....... auth, hello, presence and the shot push
//    limits ........ the hourly cap and the rate limit binding
//    new game, leave, CORS
//  No Cloudflare account, no network.
// ============================================================================
import { ok, done } from './util.mjs';
import worker, { PoolRoom, resetLimits, cleanSnap } from '../worker/worker.js';

const PW = 'test-pass-123', SALT = 'testsalt';
const hex = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');

// ── the fake runtime ────────────────────────────────────────────────────────
// Node's Response refuses status 101: a small subclass carries it.
const BaseResponse = globalThis.Response;
globalThis.Response = class extends BaseResponse {
  constructor(body, init = {}) {
    if (init.status === 101) { super(null, { status: 200 }); this._s = 101; this.webSocket = init.webSocket; }
    else super(body, init);
  }
  get status() { return this._s || super.status; }
};

class FakeStorage {
  constructor() { this.m = new Map(); this.alarm = null; }
  async get(k) { return this.m.has(k) ? structuredClone(this.m.get(k)) : undefined; }
  async put(k, v) { if (typeof k === 'object') { for (const [a, b] of Object.entries(k)) this.m.set(a, structuredClone(b)); } else this.m.set(k, structuredClone(v)); }
  async delete(k) { for (const x of Array.isArray(k) ? k : [k]) this.m.delete(x); }
  async list({ prefix = '' } = {}) { return new Map([...this.m.keys()].filter(k => k.startsWith(prefix)).sort().map(k => [k, structuredClone(this.m.get(k))])); }
  async deleteAll() { this.m.clear(); }
  async setAlarm(t) { this.alarm = t; }
  async getAlarm() { return this.alarm; }
  async deleteAlarm() { this.alarm = null; }
}
class FakeSocket {
  constructor() { this.out = []; this.att = null; this.closed = null; this.peer = null; }
  send(s) { if (this.closed) throw new Error('closed'); (this.peer || this).out.push(JSON.parse(s)); }   // the other end gets it
  close(code, why) { this.closed = this.closed || { code, why }; }
  serializeAttachment(a) { this.att = structuredClone(a); }
  deserializeAttachment() { return structuredClone(this.att); }
}
globalThis.WebSocketPair = function () { const c = new FakeSocket(), s = new FakeSocket(); c.peer = s; s.peer = c; return { 0: c, 1: s }; };
class FakeCtx {
  constructor(storage) { this.storage = storage; this.ws = []; }
  acceptWebSocket(ws) { this.ws.push(ws); }
  getWebSockets() { return this.ws.filter(w => !w.closed); }
}
let clock = Date.UTC(2026, 9, 18, 12);
function makeEnv(extra = {}) {
  const objs = new Map(), stores = new Map(), ctxs = new Map();
  const env = { PASS_SALT: SALT, CLOCK: () => clock, ...extra };
  env.ROOMS = {
    idFromName: n => n,
    get: id => ({ fetch: req => obj(id).fetch(req) }),
  };
  function obj(id) {
    if (!objs.has(id)) {
      if (!stores.has(id)) { stores.set(id, new FakeStorage()); ctxs.set(id, new FakeCtx(stores.get(id))); }
      objs.set(id, new PoolRoom(ctxs.get(id), env));
    }
    return objs.get(id);
  }
  env._obj = obj; env._stores = stores; env._ctxs = ctxs;
  env._restart = () => objs.clear();    // the objects lose memory, storage stays
  return env;
}
const BASE = 'https://pool-rooms.example.workers.dev';
async function call(env, method, path, body, { key, origin = 'https://davesgames.io', ip = '1.2.3.4' } = {}) {
  const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip };
  if (origin) headers.Origin = origin;
  if (key) headers.Authorization = 'Bearer ' + key;
  const res = await worker.fetch(new Request(BASE + path, { method, headers, body: body == null ? undefined : JSON.stringify(body) }), env);
  let j = null; try { j = await res.clone().json(); } catch (e) { /* text */ }
  return { s: res.status, j, res };
}
// A game state in the shape of core/netstate.js snapshot (no physics here).
function snapOf(state, { shots, turn, phase = 'play', winner = -1 }) {
  const x = [], y = [], on = [], pot = [];
  for (let i = 0; i < 16; i++) { x.push(-0.5 + i * 0.06); y.push(((i * 37) % 11) * 0.05 - 0.25); on.push(i === 3 ? 0 : 1); pot.push(i === 3 ? 2 : -1); }
  return { type: state.type, seed: state.seed, turn, breaker: state.breaker, open: true, phase, inHand: false, kitchen: false, winner, reason: phase === 'over' ? 'the 8 in the called pocket' : '', shots,
    players: [{ group: null, potted: 1 }, { group: null, potted: 0 }], x, y, on, pot, rack: [[1, 0], [9, 1]] };
}
const INPUT = { phi: 0.1, v: 2.4, a: 0, b: 0.2, n: 1, pocket: 2, place: null };
const VERDICT = { foul: false, why: '', keep: true, win: false, lose: false, scratch: false, potted: [3] };

// ── password, create, join ──────────────────────────────────────────────────
const HASH = await hex(SALT + ':' + PW);
{
  const env0 = makeEnv();
  const r = await call(env0, 'POST', '/rooms', { password: PW });
  ok(r.s === 503, 'create: with no PASS_HASH secret the server says it is not set up (503)', `status ${r.s}`);
}
const env = makeEnv({ PASS_HASH: HASH });
const h = await call(env, 'GET', '/');
ok(h.s === 200 && (await h.res.text()).startsWith('pool-rooms ok'), 'health: GET / answers "pool-rooms ok"');
let r = await call(env, 'POST', '/rooms', { password: 'eightbal' });
ok(r.s === 403 && r.j.error === 'wrong password', 'create: a wrong password is refused (403)', `status ${r.s}`);
r = await call(env, 'POST', '/rooms', { password: PW, type: '8' });
const code = r.j && r.j.state && r.j.state.code, key0 = r.j && r.j.seatKey;
ok(r.s === 200 && /^[A-HJ-NP-Z2-9]{6}$/.test(code) && r.j.seat === 0 && key0.length >= 20, 'create: the right password makes a room with a 6-character code and seat 0', `code ${code}, status ${r.s}`);
ok(r.res.headers.get('Access-Control-Allow-Origin') === 'https://davesgames.io', 'CORS: the site origin gets the CORS header');
const st0 = r.j.state;
ok(st0.version === 0 && st0.turn === 0 && st0.snap === null && st0.seats.join() === 'true,false', 'create: version 0, a fresh rack (snap null), seat 0 breaks', JSON.stringify({ v: st0.version, turn: st0.turn, seats: st0.seats }));

r = await call(env, 'POST', `/rooms/${code}/join`, { password: 'nope' });
ok(r.s === 403, 'join: a wrong password is refused (403)', `status ${r.s}`);
r = await call(env, 'POST', `/rooms/${code.toLowerCase()}/join`, { password: PW });
const key1 = r.j && r.j.seatKey;
ok(r.s === 200 && r.j.seat === 1 && key1 && key1 !== key0, 'join: the right password and the code (any case) give seat 1', `status ${r.s}`);
r = await call(env, 'POST', `/rooms/${code}/join`, { password: PW });
ok(r.s === 409 && r.j.error === 'room full', 'join: a third player is refused (room full)', `status ${r.s}`);
r = await call(env, 'POST', `/rooms/${code}/join`, { seatKey: key1 });
ok(r.s === 200 && r.j.seat === 1, 'rejoin: the seat key gets its seat again (a reload or a new device)', `status ${r.s}`);
r = await call(env, 'POST', `/rooms/${code}/join`, { seatKey: 'AAAAAAAAAAAAAAAAAAAAAA' });
ok(r.s === 403, 'rejoin: an unknown seat key is refused', `status ${r.s}`);
r = await call(env, 'POST', '/rooms/ZZZZZZ/join', { password: PW });
ok(r.s === 404, 'join: an unknown room code gives 404', `status ${r.s}`);
r = await call(env, 'GET', `/rooms/${code}`);
ok(r.s === 403, 'state: no seat key, no state (403)', `status ${r.s}`);
r = await call(env, 'GET', `/rooms/${code}`, null, { key: key1 });
ok(r.s === 200 && r.j.state.you === 1 && r.j.state.seats.join() === 'true,true', 'state: a seat key reads the state', `status ${r.s}`);

// ── turns ───────────────────────────────────────────────────────────────────
const st = r.j.state;
r = await call(env, 'POST', `/rooms/${code}/shot`, { from: 0, input: INPUT, end: snapOf(st, { shots: 1, turn: 1 }), verdict: VERDICT }, { key: key1 });
ok(r.s === 409 && r.j.error === 'not your turn', 'shot: seat 1 cannot shoot on the turn of seat 0', `status ${r.s} ${r.j && r.j.error}`);
r = await call(env, 'POST', `/rooms/${code}/shot`, { from: 5, input: INPUT, end: snapOf(st, { shots: 1, turn: 1 }), verdict: VERDICT }, { key: key0 });
ok(r.s === 409 && r.j.error === 'stale version' && r.j.version === 0, 'shot: a stale version is refused and the answer names the version', `status ${r.s} ${r.j && r.j.error}`);
const bad = snapOf(st, { shots: 1, turn: 1 }); bad.x[4] = NaN;
r = await call(env, 'POST', `/rooms/${code}/shot`, { from: 0, input: INPUT, end: bad, verdict: VERDICT }, { key: key0 });
ok(r.s === 400, 'shot: an end state with a bad number is refused (400)', `status ${r.s}`);
r = await call(env, 'POST', `/rooms/${code}/shot`, { from: 0, input: { ...INPUT, v: 40 }, end: snapOf(st, { shots: 1, turn: 1 }), verdict: VERDICT }, { key: key0 });
ok(r.s === 400, 'shot: a cue speed out of range is refused (400)', `status ${r.s}`);
r = await call(env, 'POST', `/rooms/${code}/shot`, { from: 0, input: INPUT, end: snapOf(st, { shots: 3, turn: 1 }), verdict: VERDICT }, { key: key0 });
ok(r.s === 400, 'shot: an end state that skips shots is refused (400)', `status ${r.s}`);

// a socket for each seat before the shot (the push)
async function socket(k, since = -1) {
  const res = await worker.fetch(new Request(`${BASE}/rooms/${code}/ws`, { headers: { Upgrade: 'websocket', Origin: 'https://davesgames.io' } }), env);
  const c = res.webSocket, s = c && c.peer;
  if (k != null) await env._obj('room:' + code).webSocketMessage(s, JSON.stringify({ t: 'auth', key: k, since }));
  return { res, c, s };
}
const w0 = await socket(key0), w1 = await socket(key1);
ok(w0.res.status === 101 && w0.c.out.some(m => m.t === 'hello' && m.seat === 0), 'socket: an upgrade gives 101; auth with the seat key gives hello', `status ${w0.res.status}`);
ok(w0.c.out.some(m => m.t === 'presence' && m.online[1] === true), 'socket: seat 0 gets presence when seat 1 comes online', JSON.stringify(w0.c.out.map(m => m.t)));
const wBad = await socket(null);
await env._obj('room:' + code).webSocketMessage(wBad.s, JSON.stringify({ t: 'auth', key: 'AAAAAAAAAAAAAAAAAAAAAA' }));
ok(wBad.s.closed && wBad.s.closed.code === 4003, 'socket: a bad seat key is closed (4003)', JSON.stringify(wBad.s.closed));
r = await worker.fetch(new Request(`${BASE}/rooms/${code}/ws`, { headers: { Upgrade: 'websocket', Origin: 'https://evil.example' } }), env);
ok(r.status === 403, 'socket: an upgrade from another site is refused (403)', `status ${r.status}`);

const end1 = snapOf(st, { shots: 1, turn: 1 });
r = await call(env, 'POST', `/rooms/${code}/shot`, { from: 0, input: INPUT, end: end1, verdict: VERDICT, extra: 'x'.repeat(100) }, { key: key0 });
ok(r.s === 200 && r.j.version === 1 && r.j.state.turn === 1, 'shot: seat 0 shoots on its turn; version 1, turn to seat 1', `status ${r.s}`);
const push = w1.c.out.find(m => m.t === 'shot');
ok(push && push.shot.v === 1 && push.shot.by === 0 && push.shot.before === null && push.shot.input.phi === INPUT.phi && push.state.you === 1, 'socket: seat 1 gets the shot (input, before, end) and its own view of the state', push ? JSON.stringify({ v: push.shot.v, by: push.shot.by }) : 'no push');
ok(push && push.shot.end.x[7] === end1.x[7] && !('extra' in push.shot), 'shot: the end state keeps every float exactly; unknown fields are dropped');
r = await call(env, 'POST', `/rooms/${code}/shot`, { from: 0, input: INPUT, end: snapOf(st, { shots: 1, turn: 0 }), verdict: VERDICT }, { key: key0 });
ok(r.s === 409, 'shot: the same shot sent again is refused (not the turn, stale)', `status ${r.s} ${r.j && r.j.error}`);

// ── restart ─────────────────────────────────────────────────────────────────
env._restart();
r = await call(env, 'GET', `/rooms/${code}?since=0`, null, { key: key1 });
ok(r.s === 200 && r.j.state.version === 1 && r.j.state.snap.x[7] === end1.x[7] && r.j.shots.length === 1 && r.j.shots[0].v === 1, 'restart: a new object on the same storage has the room, the state and the shot history', `status ${r.s}, ${r.j && r.j.shots.length} shots`);
const w1b = await socket(key1, 0);
const hello = w1b.c.out.find(m => m.t === 'hello');
ok(hello && hello.shots.length === 1 && hello.state.version === 1, 'socket: hello after a restart carries the shots after the version the client has');

// ── new game, wins ──────────────────────────────────────────────────────────
r = await call(env, 'POST', `/rooms/${code}/new`, {}, { key: key1 });
ok(r.s === 409, 'new game: refused while the game is not over', `status ${r.s}`);
const endOver = snapOf(st, { shots: 2, turn: 1, phase: 'over', winner: 1 });
r = await call(env, 'POST', `/rooms/${code}/shot`, { from: 1, input: INPUT, end: endOver, verdict: { ...VERDICT, win: true } }, { key: key1 });
ok(r.s === 200 && r.j.state.over && r.j.state.wins.join() === '0,1', 'shot: the winning shot ends the game and counts the win', `status ${r.s}`);
r = await call(env, 'POST', `/rooms/${code}/shot`, { from: 2, input: INPUT, end: snapOf(st, { shots: 3, turn: 0 }), verdict: VERDICT }, { key: key1 });
ok(r.s === 409 && r.j.error === 'game over', 'shot: no shot after the game is over', `status ${r.s}`);
r = await call(env, 'POST', `/rooms/${code}/new`, {}, { key: key0 });
ok(r.s === 200 && r.j.state.game === 2 && r.j.state.breaker === 1 && r.j.state.turn === 1 && r.j.state.snap === null && r.j.state.seed !== st.seed, 'new game: a new seed, the other seat breaks, version moves on', JSON.stringify({ g: r.j.state.game, br: r.j.state.breaker, v: r.j.state.version }));
const keysLeft = [...env._stores.get('room:' + code).m.keys()];
ok(keysLeft.join() === 'room', 'new game: the shots of the old game are deleted; the results stay in the room', keysLeft.join());

// ── no secrets in storage ───────────────────────────────────────────────────
const dump = JSON.stringify([...env._stores.values()].map(s => [...s.m.entries()]));
ok(!dump.includes(PW) && !dump.includes(key0) && !dump.includes(key1) && !dump.includes('1.2.3.4'), 'privacy: storage has no password, no seat key and no IP address');
ok(cleanSnap({ ...endOver, phase: 'over', winner: -1 }, { type: '8', seed: st.seed }) === null, 'checks: a game over with no winner is refused by cleanSnap');

// ── leave ───────────────────────────────────────────────────────────────────
r = await call(env, 'POST', `/rooms/${code}/leave`, {}, { key: key1 });
ok(r.s === 200 && w1.s.closed && w1.s.closed.code === 4000, 'leave: seat 1 is free and its sockets close', `status ${r.s}`);
r = await call(env, 'GET', `/rooms/${code}`, null, { key: key1 });
ok(r.s === 403, 'leave: the old seat key no longer works', `status ${r.s}`);
r = await call(env, 'POST', `/rooms/${code}/join`, { password: PW });
ok(r.s === 200 && r.j.seat === 1, 'leave: a new join takes the free seat', `status ${r.s}`);

// ── expiry ──────────────────────────────────────────────────────────────────
const store = env._stores.get('room:' + code), touched = (await store.get('room')).touched;
ok(store.alarm === touched + 30 * 86400000, 'expiry: each write sets the alarm 30 days after it', `${(store.alarm - touched) / 86400000} days`);
clock = touched + 29 * 86400000;
await env._obj('room:' + code).alarm();
r = await call(env, 'GET', `/rooms/${code}`, null, { key: key0 });
ok(r.s === 200, 'expiry: after 29 idle days the room is still there');
clock = touched + 30 * 86400000 + 1000;
env._restart();
await env._obj('room:' + code).alarm();
r = await call(env, 'GET', `/rooms/${code}`, null, { key: key0 });
ok(r.s === 404 && store.m.size === 0 && store.alarm === null, 'expiry: after 30 idle days the alarm deletes the room (404, storage empty)', `status ${r.s}, ${store.m.size} keys`);

// ── rate limits ─────────────────────────────────────────────────────────────
resetLimits();
const envL = makeEnv({ PASS_HASH: HASH });
let codes = [];
for (let k = 0; k < 13; k++) codes.push((await call(envL, 'POST', '/rooms', { password: 'wrong' }, { ip: '9.9.9.9' })).s);
ok(codes.slice(0, 12).every(s => s === 403) && codes[12] === 429, 'limits: the 13th create in an hour from one IP gets 429', codes.join(' '));
ok((await call(envL, 'POST', '/rooms', { password: PW }, { ip: '9.9.9.8' })).s === 200, 'limits: another IP is not blocked');
const envB = makeEnv({ PASS_HASH: HASH, RL_JOIN: { limit: async ({ key }) => ({ success: !/^join:/.test(key) }) } });
r = await call(envB, 'POST', `/rooms/${code}/join`, { password: PW });
ok(r.s === 429, 'limits: the rate limit binding (RL_JOIN) can refuse a join', `status ${r.s}`);
r = await call(envL, 'POST', '/rooms', { password: PW }, { origin: 'https://evil.example', ip: '5.5.5.5' });
ok(r.s === 200 && !r.res.headers.get('Access-Control-Allow-Origin'), 'CORS: another site gets no CORS header (the browser blocks it)');

done();
