// ============================================================================
//  POOL PHYSICS  ·  pages/billiard/online.js — one game against one person
// ----------------------------------------------------------------------------
//  The user: "i want to play against my girlfriend from anywhere in the
//  world with a "chess by mail" strategy where there's a password to get
//  in ... and then we can play 1v1 live online". The server is the
//  pool-rooms Worker (worker/worker.js, worker/README.md). Until POOL_URL
//  has its URL, the Online section says that the server is not deployed
//  and nothing else on the page changes.
//
//  THE ROOM. Create (the password) gives a 6-character room code and seat
//  0 (Player 1, who breaks). Join (the password and the code) gives seat 1.
//  Each join gives a seat key; localStorage 'billiard.online' keeps the
//  code, the seat key and the last version this device saw (never the
//  password). A reload resumes the room. The seat key also opens the seat
//  on another device.
//  A SHOT. On the user's turn the planner of main.js runs. shoot() asks
//  core/netstate.js computeShot for the outcome (the same sim and rules),
//  posts { from, input, end, verdict }, and main.js plays the shot. The
//  other page gets the record over the WebSocket (or in the state when it
//  opens), plays it from the input (main.js playNet) and then sets the
//  end state. A refused shot (409: not the turn, a stale version) loads
//  the state of the server. A post with no answer is sent again.
//  LIVE. The WebSocket pushes shots, seats and presence (the dots in the
//  score pills). It reconnects with a back-off. The tab title gets
//  "(Your shot)" while the tab is hidden and the turn is the user's.
//
//  grep -n targets: "export const POOL_URL", "export function serverUrl",
//  "export function installOnline", "function begin", "function shoot",
//  "function tick", "function onMessage", "function connect", "function
//  render", "function banner"
// ============================================================================
import { gameOf, freshSnap, computeShot } from './core/netstate.js';

// The URL of the deployed pool-rooms Worker (worker/README.md, step 6).
export const POOL_URL = '';
const STORE = 'billiard.online';
const NAMES = ['Player 1', 'Player 2'];

// localStorage 'billiard.server' overrides POOL_URL (wrangler dev, tests).
export function serverUrl() {
  try { const o = localStorage.getItem('billiard.server'); if (o && /^https?:\/\/[\w.:[\]-]+\/?$/.test(o)) return o.replace(/\/+$/, ''); } catch (e) { /* no storage */ }
  return POOL_URL.replace(/\/+$/, '');
}
const load = () => { try { const o = JSON.parse(localStorage.getItem(STORE) || 'null'); return o && o.code && o.key ? o : null; } catch (e) { return null; } };
const store = o => { try { if (o) localStorage.setItem(STORE, JSON.stringify(o)); else localStorage.removeItem(STORE); } catch (e) { /* no storage */ } };
const hashRoom = () => { const m = /(?:^#|&)room=([A-Za-z0-9-]{4,12})/.exec(location.hash || ''); return m ? m[1].toUpperCase() : ''; };

const ERR = {
  'wrong password': 'Wrong password.',
  'room full': 'That room has two players already.',
  'no such room': 'No room with that code (a room ends after 30 days with no shot).',
  'seat key': 'That seat key does not open a seat in this room.',
};
const errText = r => (r.s === 0 ? 'No answer from the server. Check the connection.' : r.s === 429 ? 'Too many tries. Wait a few minutes.' : ERR[r.j.error] || r.j.error || `The server said ${r.s}.`);

export function installOnline() {
  const base = serverUrl();
  const N = {
    active: false, seat: -1, code: '', key: '', state: null, online: [false, false], version: -1,
    queue: [], playing: null, target: null, force: false, pending: null, busy: false, err: '', note: '',
    ws: null, wsTries: 0, wsTimer: 0, pingTimer: 0, retryTimer: 0, P: null, ui: null, title: '', badge: false,
    deployed: !!base, hashCode: hashRoom(),
  };

  // ── the server ─────────────────────────────────────────────────────────────
  async function api(method, path, body, key) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (key) headers.Authorization = 'Bearer ' + key;
    try {
      const res = await window.fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
      let j = null;
      try { j = await res.json(); } catch (e) { /* not JSON */ }
      return { s: res.status, j: j || {} };
    } catch (e) { return { s: 0, j: {} }; }
  }
  const saveSeen = () => { if (N.active) store({ code: N.code, key: N.key, seat: N.seat, seen: N.version }); };

  // a room answer { seat, seatKey, state, shots } -> play on this page
  function begin(j, seen = -1) {
    const P = N.P;
    N.active = true; N.seat = j.seat; N.code = j.state.code; N.key = j.seatKey || N.key; N.state = j.state;
    N.online = (j.state.online || [false, false]).slice(); N.online[N.seat] = true;
    N.queue = []; N.target = j.state; N.force = false; N.pending = null; N.err = ''; N.note = '';
    P.APP.net = N;
    // shots this device has not seen: start from the state before the
    // first of them and play them in order
    const unseen = (j.shots || []).filter(r => r.v > seen && r.game === j.state.game);
    let G;
    if (unseen.length) {
      const r0 = unseen[0];
      G = gameOf({ type: j.state.type, seed: j.state.seed, breaker: j.state.breaker, snap: r0.before }, { T: P.T, names: NAMES });
      N.version = r0.from; N.queue = unseen;
    } else {
      G = gameOf(j.state, { T: P.T, names: NAMES });
      N.version = j.state.version;
    }
    saveSeen();
    try { history.replaceState(null, '', '#room=' + N.code); } catch (e) { /* sandboxed */ }
    P.enterNet(G);
    connect();
    render();
  }

  async function create(pw) {
    if (N.busy) return;
    N.busy = true; N.err = ''; render();
    const r = await api('POST', '/rooms', { password: pw, type: N.P.APP.type });
    N.busy = false;
    if (r.s === 200) begin(r.j); else { N.err = errText(r); render(); }
  }
  async function join(code, pw, seatKey) {
    if (N.busy) return;
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 6) { N.err = 'The room code has 6 letters and digits.'; render(); return; }
    N.busy = true; N.err = ''; render();
    const r = await api('POST', `/rooms/${code}/join`, seatKey ? { seatKey } : { password: pw });
    N.busy = false;
    if (r.s === 200) begin(r.j); else { N.err = errText(r); render(); }
  }
  async function resume() {
    const s = load();
    if (!s || N.busy) return;
    N.busy = true; N.err = ''; render();
    const r = await api('GET', `/rooms/${s.code}?since=-1`, null, s.key);
    N.busy = false;
    if (r.s === 200) { N.key = s.key; begin({ seat: r.j.state.you, seatKey: s.key, state: r.j.state, shots: r.j.shots }, Number.isInteger(s.seen) ? s.seen : -1); return; }
    if (r.s === 403 || r.s === 404) store(null);
    N.err = r.s === 403 ? 'Your seat in that room is gone.' : errText(r);
    render();
  }

  // leave: close the socket, back to local play; keep = remember the room
  function leave({ keep = true, restart = true } = {}) {
    const P = N.P;
    if (!keep) store(null);
    closeSocket();
    clearTimeout(N.retryTimer);
    N.active = false; N.pending = null; N.queue = []; N.target = null;
    if (P) { P.APP.net = null; P.APP.netShot = null; }
    setBadge(false);
    if (restart && P) P.startGame(P.APP.seed + 1);
    render();
  }
  async function forget() {
    if (!N.active) return;
    const r = await api('POST', `/rooms/${N.code}/leave`, {}, N.key);
    if (r.s !== 200 && r.s !== 403 && r.s !== 404) { N.err = errText(r); render(); return; }
    leave({ keep: false });
  }
  async function newGame() {
    if (!N.active || N.busy) return;
    N.busy = true; render();
    const r = await api('POST', `/rooms/${N.code}/new`, { type: N.P.APP.type }, N.key);
    N.busy = false;
    if (r.s === 200) { N.target = r.j.state; N.state = r.j.state; N.force = true; }
    else N.err = errText(r);
    render();
  }

  // ── a shot of this seat ────────────────────────────────────────────────────
  function shoot(input) {
    const G = N.P.APP.G;
    if (!N.active || N.pending || !N.myTurn()) return null;
    const { end, verdict } = computeShot(G, input);
    const rec = { v: N.version + 1, from: N.version, by: N.seat, game: N.state.game, input: { phi: input.phi, v: input.v, a: input.a || 0, b: input.b || 0, n: input.n ?? -1, pocket: input.pocket ?? -1, place: input.place || null }, end, verdict };
    N.pending = rec;
    post();
    render();
    return rec;
  }
  async function post(tries = 0) {
    const rec = N.pending;
    if (!rec || !N.active) return;
    const r = await api('POST', `/rooms/${N.code}/shot`, { from: rec.from, input: rec.input, end: rec.end, verdict: rec.verdict }, N.key);
    if (N.pending !== rec) return;            // the echo came first
    if (r.s === 200) { N.pending = null; N.version = Math.max(N.version, r.j.version); N.state = r.j.state; N.target = r.j.state; saveSeen(); render(); return; }
    if (r.s === 0 || r.s >= 500) { N.note = 'sending again'; render(); N.retryTimer = setTimeout(() => post(tries + 1), Math.min(30000, 2000 * 2 ** tries)); return; }
    // refused: the server state wins
    N.pending = null;
    N.err = r.s === 409 ? `The server refused the shot (${r.j.error || 'conflict'}); the table is set to its state.` : errText(r);
    const g = await api('GET', `/rooms/${N.code}?since=-1`, null, N.key);
    if (g.s === 200) { N.state = g.j.state; N.target = g.j.state; N.force = true; }
    render();
  }

  // ── each frame (main.js frame) ─────────────────────────────────────────────
  function tick() {
    const P = N.P, APP = P.APP;
    if (!N.active || APP.netShot || !['wait', 'plan', 'over', 'idle'].includes(APP.phase)) return;
    while (N.queue.length && N.queue[0].v <= N.version) N.queue.shift();
    if (N.queue.length) {
      const rec = N.queue.shift();
      const before = rec.before || freshSnap({ type: N.state.type, seed: N.state.seed, breaker: N.state.breaker }, P.T);
      N.version = rec.from; N.playing = rec;
      P.playNet(rec, before);
      render();
      return;
    }
    const t = N.target;
    if (t && !N.pending && (t.version > N.version || N.force)) {
      N.force = false; N.state = t; N.version = t.version;
      saveSeen();
      P.enterNet(gameOf(t, { T: P.T, names: NAMES }));
      render();
    }
    setBadge(N.myTurn() && document.hidden);
  }
  // main.js stepSettle: a shot is over and its end state is set
  function settled(rec) {
    if (rec === N.playing) { N.playing = null; N.version = Math.max(N.version, rec.v); saveSeen(); }
    render();
  }

  // ── the socket ─────────────────────────────────────────────────────────────
  function onMessage(m) {
    if (!m || typeof m !== 'object') return;
    if (m.state) { N.state = m.state; N.target = m.state; if (m.state.online) { N.online = m.state.online.slice(); N.online[N.seat] = true; } }
    if (m.t === 'hello' || m.t === 'shot') {
      const recs = m.t === 'hello' ? m.shots || [] : [m.shot];
      for (const r of recs) {
        if (!r || r.game !== N.state.game || r.v <= N.version) continue;
        // the echo of this page's own shot is its answer
        if (r.by === N.seat && N.pending && N.pending.from === r.from) { N.pending = null; N.version = r.v; saveSeen(); continue; }
        if (r.by === N.seat && !N.pending && N.P.APP.netShot && N.P.APP.netShot.from === r.from) continue;
        if (!N.queue.some(q => q.v === r.v)) N.queue.push(r);
      }
      N.queue.sort((a, b) => a.v - b.v);
    }
    if (m.t === 'presence') { N.online = m.online.slice(); N.online[N.seat] = true; }
    if (m.t === 'error') { N.err = ERR[m.error] || m.error; if (m.error === 'seat key' || m.error === 'no such room') { store(null); leave({ keep: false }); } }
    render();
    if (N.P) N.P.updateHud();
  }
  function connect() {
    if (!N.active || !window.WebSocket) return;
    closeSocket();
    let ws;
    try { ws = new window.WebSocket(base.replace(/^http/, 'ws') + `/rooms/${N.code}/ws`); } catch (e) { return; }
    N.ws = ws;
    ws.onopen = () => { N.wsTries = 0; try { ws.send(JSON.stringify({ t: 'auth', key: N.key, since: N.version })); } catch (e) { /* closed */ } render(); };
    ws.onmessage = e => { let m = null; try { m = JSON.parse(e.data); } catch (x) { /* bad */ } onMessage(m); };
    ws.onclose = () => {
      if (N.ws !== ws) return;
      N.ws = null; N.online = [false, false]; N.online[N.seat] = true; render();
      if (N.active) N.wsTimer = setTimeout(connect, Math.min(30000, 1000 * 2 ** N.wsTries++));
    };
    clearInterval(N.pingTimer);
    N.pingTimer = setInterval(() => { if (N.ws && N.ws.readyState === 1) try { N.ws.send('{"t":"ping"}'); } catch (e) { /* closed */ } }, 25000);
  }
  function closeSocket() {
    clearTimeout(N.wsTimer); clearInterval(N.pingTimer);
    const ws = N.ws;
    N.ws = null;
    if (ws) { try { ws.onclose = null; ws.close(1000, 'leave'); } catch (e) { /* closed */ } }
  }
  const live = () => !!(N.ws && N.ws.readyState === 1);

  // ── words and the panel ────────────────────────────────────────────────────
  const other = () => NAMES[1 - N.seat];
  N.myTurn = () => { const G = N.P && N.P.APP.G; return !!(N.active && G && G.phase !== 'over' && G.turn === N.seat); };
  function banner(phase) {
    const APP = N.P.APP, o = other();
    const send = N.pending ? (N.note ? ' · sending again' : ' · sending') : '';
    if (APP.netShot && APP.netShot.by !== N.seat) return `${o} shoots (played from the shot input)`;
    if (phase === 'aim' || phase === 'roll' || phase === 'settle') return `Your shot rolls${send}`;
    if (phase === 'plan') return `Your shot. Tap a ball, then a pocket, or drag to aim. Set the tip and the speed, then shoot.${send}`;
    if (phase === 'over') return 'Game over. Start a new rack in the Online section.';
    if (N.state && !N.state.seats[1 - N.seat]) return `Room ${N.code}: send the code to the other player. Waiting for a second player.`;
    if (N.online[1 - N.seat] && live()) return `Waiting for the shot of ${o} (online now).`;
    return `Waiting for the shot of ${o}. The game waits; you can close the page.${live() ? '' : ' Offline: connecting.'}`;
  }
  N.banner = banner;

  function setBadge(on) {
    if (on === N.badge) return;
    N.badge = on;
    if (!N.title) N.title = document.title;
    document.title = on ? `(Your shot) ${N.title}` : N.title;
  }

  function mount(host) {
    host.classList.add('onl');
    host.innerHTML = `
<p class="snp-note snp-warn" data-r="nodeploy" hidden>Online play needs the game server, and the server is not deployed yet.</p>
<div class="onl-form" data-r="form" hidden>
  <button type="button" class="snp-btn snp-primary" data-r="resume" hidden></button>
  <label class="onl-l"><span>Password</span><input type="password" data-r="pw" autocomplete="off" spellcheck="false" maxlength="200"></label>
  <button type="button" class="snp-btn snp-primary" data-r="create">Create game</button>
  <label class="onl-l"><span>Room code</span><input type="text" data-r="code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="8" placeholder="ABC234"></label>
  <button type="button" class="snp-btn snp-secondary" data-r="join">Join game</button>
  <details class="onl-more"><summary>Seat key (from another device)</summary>
    <label class="onl-l"><span>Seat key</span><input type="text" data-r="keyIn" autocomplete="off" spellcheck="false" maxlength="64"></label>
    <button type="button" class="snp-btn snp-secondary" data-r="keyJoin">Open my seat</button>
  </details>
</div>
<div class="onl-room" data-r="room" hidden>
  <div class="onl-code"><span>Room</span><b data-r="codeOut"></b><button type="button" class="snp-btn snp-secondary" data-r="copy">Copy link</button></div>
  <p class="onl-line" data-r="seatLine"></p>
  <p class="onl-line onl-turn" data-r="turnLine" aria-live="polite"></p>
  <div class="snp-actions" style="--cols:2"><button type="button" class="snp-btn snp-primary" data-r="newg">New rack</button><button type="button" class="snp-btn snp-secondary" data-r="leave">Leave</button></div>
  <details class="onl-more"><summary>Seat key for another device</summary>
    <p class="snp-fine">With this key and the room code, your seat opens on another phone or computer. Keep it to yourself.</p>
    <code class="onl-key" data-r="keyOut"></code>
    <div class="snp-actions" style="--cols:2"><button type="button" class="snp-btn snp-secondary" data-r="copyKey">Copy key</button><button type="button" class="snp-btn snp-secondary" data-r="forget">Free my seat</button></div>
  </details>
</div>
<p class="snp-note snp-warn" data-r="err" aria-live="polite"></p>`;
    const q = k => host.querySelector(`[data-r="${k}"]`);
    N.ui = { host, q };
    if (N.hashCode) q('code').value = N.hashCode;
    q('create').addEventListener('click', () => { const pw = q('pw').value; if (!pw) { N.err = 'Type the password first.'; render(); return; } create(pw); });
    q('join').addEventListener('click', () => { const pw = q('pw').value; if (!pw) { N.err = 'Type the password first.'; render(); return; } join(q('code').value, pw); });
    q('keyJoin').addEventListener('click', () => join(q('code').value, '', q('keyIn').value.trim()));
    q('resume').addEventListener('click', resume);
    q('leave').addEventListener('click', () => leave({ keep: true }));
    q('forget').addEventListener('click', forget);
    q('newg').addEventListener('click', newGame);
    const copy = t => { try { navigator.clipboard.writeText(t).catch(() => {}); } catch (e) { /* no clipboard */ } };
    q('copy').addEventListener('click', () => { copy(`${location.origin}${location.pathname}#room=${N.code}`); N.err = ''; N.ui.q('copy').textContent = 'Copied'; setTimeout(() => { if (N.ui) N.ui.q('copy').textContent = 'Copy link'; }, 1500); });
    q('copyKey').addEventListener('click', () => copy(N.key));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { setBadge(false); if (N.active && !N.ws) { N.wsTries = 0; connect(); } }
    });
    addEventListener('online', () => { if (N.active && !N.ws) { N.wsTries = 0; connect(); } });
    render();
  }

  function render() {
    if (!N.ui) return;
    const q = N.ui.q, saved = load();
    q('nodeploy').hidden = N.deployed;
    q('form').hidden = !N.deployed || N.active;
    q('room').hidden = !N.active;
    q('err').textContent = N.err || '';
    for (const k of ['create', 'join', 'keyJoin', 'resume', 'newg']) q(k).disabled = N.busy;
    q('resume').hidden = !saved || N.active;
    if (saved) q('resume').textContent = `Resume game ${saved.code}`;
    if (N.active) {
      q('codeOut').textContent = N.code;
      const o = other(), has = N.state && N.state.seats[1 - N.seat];
      const dot = has ? (N.online[1 - N.seat] && live() ? 'online' : 'offline') : 'no one yet';
      const w = N.state ? N.state.wins : [0, 0];
      q('seatLine').innerHTML = `You are <b>${NAMES[N.seat]}</b> · ${o}: <span class="onl-dot ${dot === 'online' ? 'on' : ''}" aria-hidden="true"></span>${dot} · wins ${w[N.seat]}–${w[1 - N.seat]}`;
      const APP = N.P.APP;
      q('turnLine').textContent = APP.phase === 'over' ? 'Game over' : N.myTurn() ? (N.pending ? 'Your shot: sending' : 'Your shot') : APP.netShot ? `${o} shoots` : `Waiting for the shot of ${o}`;
      q('newg').hidden = APP.phase !== 'over';
      q('keyOut').textContent = N.key;
    }
  }

  return Object.assign(N, {
    wantOpen: () => !!(N.hashCode || load()),
    mount, render, tick, settled, shoot, leave, newGame, create, join, resume, forget,
    attach(P) {
      N.P = P;
      if (N.deployed && load()) resume();
    },
    _onMessage: onMessage,
  });
}
