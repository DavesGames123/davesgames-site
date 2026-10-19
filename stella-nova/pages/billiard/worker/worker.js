// ============================================================================
//  POOL ROOMS  ·  Cloudflare Worker + Durable Object for pages/billiard
// ----------------------------------------------------------------------------
//  The user asked for "stateful multiplayer in the pool/billiards page - i
//  want to play against my girlfriend from anywhere in the world with a
//  "chess by mail" strategy where there's a password to get in". This
//  Worker keeps one Durable Object (PoolRoom) per room. A room has two
//  seats, the full game state and the shot history of the current game.
//  A game can wait for days between two shots. When both players have the
//  page open, a WebSocket pushes each shot at once.
//
//    POST /rooms                 { password, type }  -> a new room, seat 0
//    POST /rooms/{code}/join     { password } -> a free seat, or
//                                { seatKey } -> the seat of that key again
//    GET  /rooms/{code}?since=v  the state and the shots after version v
//    POST /rooms/{code}/shot     { from, input, end, verdict }
//    POST /rooms/{code}/new      a new rack when the game is over
//    POST /rooms/{code}/leave    free the seat of the caller
//    GET  /rooms/{code}/ws       WebSocket (hibernation API); the first
//                                message is { t: 'auth', key }
//    GET  /                      a short health text
//  state, shot, new and leave need "Authorization: Bearer <seat key>".
//
//  PASSWORD. The Worker holds no password text. The secret PASS_HASH is
//  SHA-256(PASS_SALT + ":" + password) in hex, and PASS_SALT is a second
//  secret (README.md). Create and join compare the hash in constant time.
//  SEAT KEYS. A seat key is 128 random bits, sent to the client once. The
//  room keeps only SHA-256 of the key.
//  TRUST. The server does not run the physics. The shooter's page sends
//  the shot input and the end state that its own simulation made. The
//  server accepts a shot only from the seat whose turn it is and only for
//  the current version, and it checks the shape and the ranges of every
//  field. It stores only the fields that it checked.
//  PRIVACY. No names, no email, no IP address in storage. The rate limits
//  key on SHA-256(salt | IP), cut to 16 hex digits, and keep that key only
//  in memory (and in the Cloudflare rate limit binding, if it is set).
//  EXPIRY. Each write sets an alarm TTL_MS after it. The alarm deletes a
//  room with no write in TTL_MS (30 days).
//
//  Deploy: README.md. Tests: ../tests/online-worker.test.mjs (node).
//
//  grep -n targets
//    allowed origins ...... "const ORIGINS"
//    limits ............... "const LIMITS"
//    password check ....... "async function passwordOk"
//    rate limit ........... "async function limited"
//    field checks ......... "function cleanSnap"
//    the room object ...... "export class PoolRoom"
//    one shot ............. "async shot("
//    socket messages ...... "async webSocketMessage"
//    expiry ............... "async alarm("
//    the router ........... "export default"
// ============================================================================

const ORIGINS = ['https://davesgames.io', 'https://www.davesgames.io'];
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const TTL_MS = 30 * 24 * 3600 * 1000;
const MAX_BODY = 16384;
const MAX_SHOTS = 600;          // shots in one game
const MAX_SOCKETS = 8;          // open sockets in one room
const RECENT = 12;              // shots sent with a state
const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 6;
// In-memory caps per IP key and hour (each isolate has its own counts; the
// rate limit bindings RL_CREATE and RL_JOIN add a cap per minute).
const LIMITS = { create: 12, join: 60 };

// ── small helpers ───────────────────────────────────────────────────────────
const now = env => (env && typeof env.CLOCK === 'function' ? env.CLOCK() : Date.now());
const enc = new TextEncoder();
async function sha256hex(s) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
  let h = '';
  for (const b of d) h += b.toString(16).padStart(2, '0');
  return h;
}
function sameText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
function randomKey() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomCode() {
  const b = crypto.getRandomValues(new Uint8Array(CODE_LEN));
  let s = '';
  for (const x of b) s += CODE_ABC[x % CODE_ABC.length];
  return s;
}
const randomSeed = () => (crypto.getRandomValues(new Uint32Array(1))[0] % 999983) + 1;
export const normCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const codeOk = c => c.length === CODE_LEN && [...c].every(ch => CODE_ABC.includes(ch));
const bearer = req => { const m = /^Bearer\s+([\w-]{8,64})$/.exec(req.headers.get('Authorization') || ''); return m ? m[1] : ''; };

function cors(origin) {
  const ok = origin && (ORIGINS.includes(origin) || LOCAL.test(origin));
  return ok ? {
    'Access-Control-Allow-Origin': origin, 'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Max-Age': '86400',
  } : { 'Vary': 'Origin' };
}
const jsonRes = (o, s = 200, head = {}) => new Response(JSON.stringify(o), { status: s, headers: { ...head, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function readJson(req) {
  const t = await req.text();
  if (t.length > MAX_BODY) return null;
  try { const o = JSON.parse(t || '{}'); return o && typeof o === 'object' ? o : null; } catch (e) { return null; }
}

// ── password and rate limits ────────────────────────────────────────────────
export async function passwordOk(env, password) {
  if (!env.PASS_HASH || !env.PASS_SALT) return null;          // not set up
  if (typeof password !== 'string' || !password || password.length > 200) return false;
  return sameText(await sha256hex(env.PASS_SALT + ':' + password), String(env.PASS_HASH).trim().toLowerCase());
}

const MEM = new Map();
export function resetLimits() { MEM.clear(); }
async function limited(env, kind, req) {
  const ip = req.headers.get('CF-Connecting-IP') || 'none';
  const key = kind + ':' + (await sha256hex((env.PASS_SALT || '') + '|' + ip)).slice(0, 16);
  const b = env['RL_' + kind.toUpperCase()];
  if (b && typeof b.limit === 'function') {
    try { const r = await b.limit({ key }); if (r && r.success === false) return true; } catch (e) { /* the binding is optional */ }
  }
  const t = now(env), hour = Math.floor(t / 3600000);
  let e = MEM.get(key);
  if (!e || e.hour !== hour) { e = { hour, n: 0 }; MEM.set(key, e); }
  if (MEM.size > 5000) for (const [k, v] of MEM) if (v.hour !== hour) MEM.delete(k);
  e.n++;
  return e.n > LIMITS[kind];
}

// ── field checks (only checked fields go into storage) ──────────────────────
const fin = (x, lim) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= lim;
const int = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;
const bool = x => typeof x === 'boolean';
const text = (x, len) => (typeof x === 'string' ? x.replace(/[^\w .,:;()'+-]/g, '').slice(0, len) : '');
const GROUPS = [null, 'solids', 'stripes'];

// A game state (core/netstate.js snapshot). Returns a clean copy or null.
export function cleanSnap(s, room) {
  if (!s || typeof s !== 'object') return null;
  if (s.type !== room.type || s.seed !== room.seed) return null;
  for (const k of ['x', 'y', 'on', 'pot']) if (!Array.isArray(s[k]) || s[k].length !== 16) return null;
  if (!s.x.every(v => fin(v, 3)) || !s.y.every(v => fin(v, 3))) return null;
  if (!s.on.every(v => v === 0 || v === 1) || !s.pot.every(v => int(v, -2, 5))) return null;
  if (!int(s.turn, 0, 1) || !int(s.breaker, 0, 1) || !['break', 'play', 'over'].includes(s.phase)) return null;
  if (!int(s.winner, -1, 1) || (s.phase === 'over') !== (s.winner >= 0)) return null;
  if (!bool(s.open) || !bool(s.inHand) || !bool(s.kitchen) || !int(s.shots, 0, 100000)) return null;
  if (!Array.isArray(s.players) || s.players.length !== 2) return null;
  if (!s.players.every(p => p && GROUPS.includes(p.group) && int(p.potted, 0, 15))) return null;
  if (!Array.isArray(s.rack) || s.rack.length > 15 || !s.rack.every(r => Array.isArray(r) && r.length === 2 && int(r[0], 1, 15) && int(r[1], 0, 4))) return null;
  return {
    type: s.type, seed: s.seed, turn: s.turn, breaker: s.breaker, open: s.open, phase: s.phase, inHand: s.inHand, kitchen: s.kitchen,
    winner: s.winner, reason: text(s.reason, 120), shots: s.shots,
    players: s.players.map(p => ({ group: p.group, potted: p.potted })),
    x: s.x.slice(), y: s.y.slice(), on: s.on.slice(), pot: s.pot.slice(), rack: s.rack.map(r => [r[0], r[1]]),
  };
}
// The cue input of a shot (main.js planShot).
export function cleanInput(i) {
  if (!i || typeof i !== 'object') return null;
  if (!fin(i.phi, 100) || !fin(i.v, 12) || i.v <= 0 || !fin(i.a ?? 0, 1) || !fin(i.b ?? 0, 1)) return null;
  if (!int(i.n ?? -1, -1, 15) || !int(i.pocket ?? -1, -1, 5)) return null;
  let place = null;
  if (i.place != null) { if (!fin(i.place.x, 3) || !fin(i.place.y, 3)) return null; place = { x: i.place.x, y: i.place.y }; }
  return { phi: i.phi, v: i.v, a: i.a ?? 0, b: i.b ?? 0, n: i.n ?? -1, pocket: i.pocket ?? -1, place };
}
// The rule outcome (core/rules.js judge), for the message on both pages.
export function cleanVerdict(v) {
  if (!v || typeof v !== 'object') return null;
  const out = { why: text(v.why, 120), potted: Array.isArray(v.potted) ? v.potted.filter(n => int(n, 1, 15)).slice(0, 15) : [] };
  for (const k of ['foul', 'keep', 'win', 'lose', 'scratch']) out[k] = v[k] === true;
  return out;
}

// ── the room ────────────────────────────────────────────────────────────────
const shotKey = (game, v) => `shot:${String(game).padStart(4, '0')}:${String(v).padStart(6, '0')}`;
const turnOf = room => (room.snap ? room.snap.turn : room.breaker);

export class PoolRoom {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env || {}; this.room = undefined;
    try {
      if (typeof WebSocketRequestResponsePair === 'function' && ctx.setWebSocketAutoResponse) ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
    } catch (e) { /* older runtime */ }
  }

  async load() {
    if (this.room === undefined) this.room = (await this.ctx.storage.get('room')) || null;
    return this.room;
  }
  // write the room (and more keys) in one put; move the expiry alarm
  async save(extra = {}) {
    const t = now(this.env);
    this.room.touched = t;
    await this.ctx.storage.put({ room: this.room, ...extra });
    await this.ctx.storage.setAlarm(t + TTL_MS);
  }
  async seatOf(key) {
    if (!key || !this.room) return -1;
    const h = await sha256hex('seat:' + key);
    return this.room.seats.findIndex(s => s && sameText(s, h));
  }
  pub(seat) {
    const r = this.room;
    return {
      code: r.code, type: r.type, version: r.version, game: r.game, seed: r.seed, breaker: r.breaker, snap: r.snap,
      wins: r.wins.slice(), results: r.results.slice(-10), seats: r.seats.map(Boolean), you: seat, turn: turnOf(r),
      over: !!(r.snap && r.snap.phase === 'over'), touched: r.touched, expires: r.touched + TTL_MS, online: this.online(),
    };
  }
  async recent(since) {
    const r = this.room;
    if (!(since < r.version)) return [];
    const m = await this.ctx.storage.list({ prefix: `shot:${String(r.game).padStart(4, '0')}:` });
    return [...m.values()].filter(x => x.v > since).slice(-RECENT);
  }
  sockets() { try { return this.ctx.getWebSockets(); } catch (e) { return []; } }
  seatOfSocket(ws) { try { const a = ws.deserializeAttachment(); return a && Number.isInteger(a.seat) ? a.seat : -1; } catch (e) { return -1; } }
  online(skip = null) {
    const on = [false, false];
    for (const ws of this.sockets()) { if (ws === skip) continue; const s = this.seatOfSocket(ws); if (s >= 0) on[s] = true; }
    return on;
  }
  send(ws, o) { try { ws.send(JSON.stringify(o)); } catch (e) { /* closed */ } }
  broadcast(make, skip = null) {
    for (const ws of this.sockets()) { if (ws === skip) continue; const s = this.seatOfSocket(ws); if (s >= 0) this.send(ws, make(s)); }
  }

  async fetch(req) {
    const url = new URL(req.url), op = url.pathname.split('/').filter(Boolean).pop();
    await this.load();
    if (op === 'init') return this.init(await readJson(req));
    if (!this.room) return jsonRes({ error: 'no such room' }, 404);
    if (op === 'ws') return this.ws(req);
    if (op === 'join') return this.join(await readJson(req));
    const seat = await this.seatOf(bearer(req));
    if (seat < 0) return jsonRes({ error: 'seat key' }, 403);
    if (op === 'state') return jsonRes({ state: this.pub(seat), shots: await this.recent(+url.searchParams.get('since')) });
    if (req.method !== 'POST') return jsonRes({ error: 'method' }, 405);
    if (op === 'shot') return this.shot(seat, await readJson(req));
    if (op === 'new') return this.newGame(seat, await readJson(req));
    if (op === 'leave') return this.leave(seat);
    return jsonRes({ error: 'not found' }, 404);
  }

  async init(b) {
    if (this.room) return jsonRes({ error: 'taken' }, 409);
    if (!b || !codeOk(b.code)) return jsonRes({ error: 'bad request' }, 400);
    const key = randomKey(), t = now(this.env);
    this.room = {
      code: b.code, type: b.type === '9' ? '9' : '8', created: t, touched: t,
      seats: [await sha256hex('seat:' + key), null], version: 0, game: 1, seed: randomSeed(), breaker: 0, snap: null,
      wins: [0, 0], results: [],
    };
    await this.save();
    return jsonRes({ seat: 0, seatKey: key, state: this.pub(0), shots: [] });
  }

  async join(b) {
    if (!b) return jsonRes({ error: 'bad request' }, 400);
    if (b.seatKey) {
      const seat = await this.seatOf(String(b.seatKey));
      if (seat < 0) return jsonRes({ error: 'seat key' }, 403);
      return jsonRes({ seat, seatKey: b.seatKey, state: this.pub(seat), shots: await this.recent(-1) });
    }
    const seat = this.room.seats.indexOf(null);
    if (seat < 0) return jsonRes({ error: 'room full' }, 409);
    const key = randomKey();
    this.room.seats[seat] = await sha256hex('seat:' + key);
    await this.save();
    this.broadcast(s => ({ t: 'state', state: this.pub(s) }));
    return jsonRes({ seat, seatKey: key, state: this.pub(seat), shots: await this.recent(-1) });
  }

  async shot(seat, b) {
    const r = this.room;
    if (!b) return jsonRes({ error: 'bad request' }, 400);
    if (r.snap && r.snap.phase === 'over') return jsonRes({ error: 'game over', version: r.version }, 409);
    if (seat !== turnOf(r)) return jsonRes({ error: 'not your turn', version: r.version }, 409);
    if (b.from !== r.version) return jsonRes({ error: 'stale version', version: r.version }, 409);
    const input = cleanInput(b.input), end = cleanSnap(b.end, r), verdict = cleanVerdict(b.verdict);
    if (!input || !end || !verdict) return jsonRes({ error: 'bad shot' }, 400);
    // core/rules.js apply() counts every shot, a new rack after a bad break too
    if (end.shots !== (r.snap ? r.snap.shots : 0) + 1) return jsonRes({ error: 'bad shot' }, 400);
    if (end.shots > MAX_SHOTS) return jsonRes({ error: 'too many shots' }, 409);
    const v = r.version + 1;
    const rec = { v, from: r.version, game: r.game, by: seat, input, before: r.snap, end, verdict, at: now(this.env) };
    r.version = v; r.snap = end;
    if (end.phase === 'over') { r.wins[end.winner]++; r.results.push({ game: r.game, winner: end.winner, shots: end.shots, reason: end.reason, at: rec.at }); if (r.results.length > 50) r.results.shift(); }
    await this.save({ [shotKey(r.game, v)]: rec });
    this.broadcast(s => ({ t: 'shot', shot: rec, state: this.pub(s) }));
    return jsonRes({ ok: true, version: v, state: this.pub(seat) });
  }

  async newGame(seat, b) {
    const r = this.room;
    if (r.snap && r.snap.phase !== 'over') return jsonRes({ error: 'game not over', version: r.version }, 409);
    if (!r.snap) return jsonRes({ ok: true, version: r.version, state: this.pub(seat) });   // already fresh
    const old = await this.ctx.storage.list({ prefix: `shot:${String(r.game).padStart(4, '0')}:` });
    await this.ctx.storage.delete([...old.keys()]);
    r.game++; r.version++; r.seed = randomSeed(); r.breaker = 1 - r.breaker; r.snap = null;
    if (b && (b.type === '8' || b.type === '9')) r.type = b.type;
    await this.save();
    this.broadcast(s => ({ t: 'state', state: this.pub(s) }));
    return jsonRes({ ok: true, version: r.version, state: this.pub(seat) });
  }

  async leave(seat) {
    this.room.seats[seat] = null;
    await this.save();
    for (const ws of this.sockets()) if (this.seatOfSocket(ws) === seat) { try { ws.close(4000, 'left'); } catch (e) { /* closed */ } }
    this.broadcast(s => ({ t: 'state', state: this.pub(s) }));
    return jsonRes({ ok: true });
  }

  ws(req) {
    if ((req.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return jsonRes({ error: 'upgrade' }, 426);
    if (this.sockets().length >= MAX_SOCKETS) return jsonRes({ error: 'too many sockets' }, 429);
    const pair = new WebSocketPair(), [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ seat: -1 });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, data) {
    if (typeof data !== 'string' || data.length > 2048) { try { ws.close(1009, 'too big'); } catch (e) { /* closed */ } return; }
    let m = null;
    try { m = JSON.parse(data); } catch (e) { /* bad */ }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'ping') { this.send(ws, { t: 'pong' }); return; }
    if (m.t !== 'auth') return;
    await this.load();
    if (!this.room) { this.send(ws, { t: 'error', error: 'no such room' }); try { ws.close(4404, 'no such room'); } catch (e) { /* closed */ } return; }
    const seat = await this.seatOf(String(m.key || ''));
    if (seat < 0) { this.send(ws, { t: 'error', error: 'seat key' }); try { ws.close(4003, 'seat key'); } catch (e) { /* closed */ } return; }
    ws.serializeAttachment({ seat });
    this.send(ws, { t: 'hello', seat, state: this.pub(seat), shots: await this.recent(Number.isInteger(m.since) ? m.since : -1) });
    this.broadcast(() => ({ t: 'presence', online: this.online() }), ws);
  }
  async webSocketClose(ws) {
    try { ws.close(1000, 'bye'); } catch (e) { /* closed already */ }
    this.broadcast(() => ({ t: 'presence', online: this.online(ws) }), ws);
  }
  async webSocketError(ws) { return this.webSocketClose(ws); }

  async alarm() {
    await this.load();
    if (!this.room) return;
    const t = now(this.env);
    if (t - this.room.touched >= TTL_MS) {
      for (const ws of this.sockets()) { try { ws.close(4410, 'expired'); } catch (e) { /* closed */ } }
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      this.room = null;
    } else await this.ctx.storage.setAlarm(this.room.touched + TTL_MS);
  }
}

// ── the router ──────────────────────────────────────────────────────────────
export default {
  async fetch(req, env) {
    const url = new URL(req.url), origin = req.headers.get('Origin');
    const head = cors(origin);
    const json = (o, s = 200) => jsonRes(o, s, head);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: head });
    if (url.pathname === '/' && req.method === 'GET') return new Response('pool-rooms ok\n', { headers: head });
    const room = code => env.ROOMS.get(env.ROOMS.idFromName('room:' + code));
    const relay = async res => {
      if (res.status === 101) return res;
      return new Response(await res.text(), { status: res.status, headers: { ...head, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    };

    if (url.pathname === '/rooms' && req.method === 'POST') {
      if (await limited(env, 'create', req)) return json({ error: 'too many tries, wait a while' }, 429);
      const b = await readJson(req);
      if (!b) return json({ error: 'bad request' }, 400);
      const ok = await passwordOk(env, b.password);
      if (ok === null) return json({ error: 'server not set up (PASS_HASH, PASS_SALT)' }, 503);
      if (!ok) return json({ error: 'wrong password' }, 403);
      for (let k = 0; k < 6; k++) {
        const code = randomCode();
        const res = await room(code).fetch(new Request('https://room/init', { method: 'POST', body: JSON.stringify({ code, type: b.type }) }));
        if (res.status !== 409) return relay(res);
      }
      return json({ error: 'no free room code, try again' }, 503);
    }

    const m = /^\/rooms\/([A-Za-z0-9-]{4,12})(?:\/(join|shot|new|leave|ws))?$/.exec(url.pathname);
    if (!m) return json({ error: 'not found' }, 404);
    const code = normCode(m[1]), op = m[2] || 'state';
    if (!codeOk(code)) return json({ error: 'no such room' }, 404);
    if (op === 'ws') {
      if (origin && !head['Access-Control-Allow-Origin']) return json({ error: 'origin' }, 403);
      return room(code).fetch(req);
    }
    if (op === 'state') {
      if (req.method !== 'GET') return json({ error: 'method' }, 405);
      return relay(await room(code).fetch(new Request(`https://room/state?since=${encodeURIComponent(url.searchParams.get('since') || '-1')}`, { headers: { Authorization: req.headers.get('Authorization') || '' } })));
    }
    if (req.method !== 'POST') return json({ error: 'method' }, 405);
    if (op === 'join') {
      if (await limited(env, 'join', req)) return json({ error: 'too many tries, wait a while' }, 429);
      const b = await readJson(req);
      if (!b) return json({ error: 'bad request' }, 400);
      if (!b.seatKey) {
        const ok = await passwordOk(env, b.password);
        if (ok === null) return json({ error: 'server not set up (PASS_HASH, PASS_SALT)' }, 503);
        if (!ok) return json({ error: 'wrong password' }, 403);
      }
      return relay(await room(code).fetch(new Request('https://room/join', { method: 'POST', body: JSON.stringify(b.seatKey ? { seatKey: String(b.seatKey) } : {}) })));
    }
    const body = await req.text();
    if (body.length > MAX_BODY) return json({ error: 'too big' }, 413);
    return relay(await room(code).fetch(new Request('https://room/' + op, { method: 'POST', body, headers: { Authorization: req.headers.get('Authorization') || '' } })));
  },
};
