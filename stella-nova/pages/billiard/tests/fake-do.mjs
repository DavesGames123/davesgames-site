// ============================================================================
//  POOL PHYSICS  ·  tests/fake-do.mjs — worker/worker.js in node, for pages
// ----------------------------------------------------------------------------
//  A small fake of the Durable Object runtime: a Map storage with an alarm,
//  a namespace by name, WebSocketPair and the hibernation calls. Then a
//  fetch and a WebSocket class for a jsdom window that talk to the real
//  Worker code in this process (no network).
//    const D = makeServer({ password })
//    D.env  D.call(method, path, body, key)  D.fetch (window.fetch)
//    D.WebSocket (window.WebSocket)  D.sockets  D.flush()
// ============================================================================
import worker, { PoolRoom } from '../worker/worker.js';

const BaseResponse = globalThis.Response;
if (!BaseResponse.__pool101) {
  // node's Response refuses status 101: a subclass carries it
  globalThis.Response = class extends BaseResponse {
    constructor(body, init = {}) {
      if (init.status === 101) { super(null, { status: 200 }); this._s = 101; this.webSocket = init.webSocket; }
      else super(body, init);
    }
    get status() { return this._s || super.status; }
  };
  globalThis.Response.__pool101 = true;
}

class Storage {
  constructor() { this.m = new Map(); this.alarm = null; }
  async get(k) { return this.m.has(k) ? structuredClone(this.m.get(k)) : undefined; }
  async put(k, v) { if (typeof k === 'object') { for (const [a, b] of Object.entries(k)) this.m.set(a, structuredClone(b)); } else this.m.set(k, structuredClone(v)); }
  async delete(k) { for (const x of Array.isArray(k) ? k : [k]) this.m.delete(x); }
  async list({ prefix = '' } = {}) { return new Map([...this.m.keys()].filter(k => k.startsWith(prefix)).sort().map(k => [k, structuredClone(this.m.get(k))])); }
  async deleteAll() { this.m.clear(); }
  async setAlarm(t) { this.alarm = t; }
  async deleteAlarm() { this.alarm = null; }
}
// one end of a pair; send() reaches the other end (its onDeliver, else its out)
class End {
  constructor() { this.out = []; this.att = null; this.closed = null; this.peer = null; this.onDeliver = null; }
  send(s) {
    if (this.closed) throw new Error('closed');
    const p = this.peer, m = JSON.parse(s);
    p.out.push(m);
    if (p.onDeliver) queueMicrotask(() => p.onDeliver(m));
  }
  close(code, why) { if (this.closed) return; this.closed = { code, why }; if (this.peer && this.peer.onClose) queueMicrotask(() => this.peer.onClose(code)); }
  serializeAttachment(a) { this.att = structuredClone(a); }
  deserializeAttachment() { return structuredClone(this.att); }
}
globalThis.WebSocketPair = function () { const c = new End(), s = new End(); c.peer = s; s.peer = c; return { 0: c, 1: s }; };

const hex = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');

export async function makeServer({ password, salt = 'pagesalt', origin = 'http://localhost:8963' } = {}) {
  const objs = new Map(), ctxs = new Map();
  const env = { PASS_SALT: salt, PASS_HASH: await hex(salt + ':' + password) };
  const obj = id => {
    if (!objs.has(id)) {
      if (!ctxs.has(id)) { const ws = []; ctxs.set(id, { storage: new Storage(), ws, acceptWebSocket: w => ws.push(w), getWebSockets: () => ws.filter(w => !w.closed) }); }
      objs.set(id, new PoolRoom(ctxs.get(id), env));
    }
    return objs.get(id);
  };
  env.ROOMS = { idFromName: n => n, get: id => ({ fetch: req => obj(id).fetch(req) }) };
  const D = { env, obj, ctxs, calls: 0, sockets: [] };
  D.fetch = async (url, init = {}) => {
    D.calls++;
    const headers = { ...(init.headers || {}), Origin: origin, 'CF-Connecting-IP': '10.0.0.1' };
    return worker.fetch(new Request(url, { method: init.method || 'GET', headers, body: init.body }), env);
  };
  D.call = async (method, path, body, key) => {
    const headers = { 'Content-Type': 'application/json', Origin: origin, 'CF-Connecting-IP': '10.0.0.2' };
    if (key) headers.Authorization = 'Bearer ' + key;
    const res = await worker.fetch(new Request('https://pool.test' + path, { method, headers, body: body == null ? undefined : JSON.stringify(body) }), env);
    return { s: res.status, j: await res.json().catch(() => null) };
  };
  // a bare socket of the scripted player: auth, then read D.out
  D.socket = async (code, key) => {
    const res = await worker.fetch(new Request(`https://pool.test/rooms/${code}/ws`, { headers: { Upgrade: 'websocket', Origin: origin } }), env);
    const c = res.webSocket;
    await obj('room:' + code).webSocketMessage(c.peer, JSON.stringify({ t: 'auth', key }));
    return c;
  };
  // window.WebSocket for the page
  D.WebSocket = class {
    constructor(url) {
      this.readyState = 0; this.url = url; D.sockets.push(this);
      const code = /\/rooms\/(\w+)\/ws$/.exec(url)[1];
      this.room = 'room:' + code;
      setTimeout(async () => {
        const res = await worker.fetch(new Request(url.replace(/^ws/, 'http'), { headers: { Upgrade: 'websocket', Origin: origin } }), env);
        if (res.status !== 101) { this.readyState = 3; if (this.onclose) this.onclose({ code: 1006 }); return; }
        this.end = res.webSocket;
        this.end.onDeliver = m => { if (this.readyState === 1 && this.onmessage) this.onmessage({ data: JSON.stringify(m) }); };
        this.end.onClose = code2 => { this.readyState = 3; if (this.onclose) this.onclose({ code: code2 }); };
        this.readyState = 1;
        if (this.onopen) this.onopen({});
      }, 0);
    }
    send(s) { if (this.readyState !== 1) throw new Error('not open'); obj(this.room).webSocketMessage(this.end.peer, s); }
    close() { if (this.readyState === 3) return; this.readyState = 3; const srv = this.end && this.end.peer; if (srv) { srv.closed = { code: 1000 }; obj(this.room).webSocketClose(srv); } }
  };
  return D;
}
