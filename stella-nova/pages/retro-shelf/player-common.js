// ============================================================================
//  RETRO SHELF  ·  player-common.js — what the three player pages share
// ----------------------------------------------------------------------------
//  The player pages (play-dos.html, play-scummvm.html, play-emu.html) run in
//  the child iframe of #player. Each one shows #status, a boot screen (the
//  done steps, the step that runs now, a progress bar and a percent),
//  until its engine draws. Each reads games.json and fetches the game
//  archive with a sha256 check, so the page runs only the unchanged file
//  that LICENSES.md reviewed. An error shows "System halted" with Try
//  again and Exit buttons.
//
//  View and sound: the CRT frame, the scanlines and the mute come from
//  localStorage (PREF_KEY) and from 'retro-view' messages of the shelf
//  page. trackAudio wraps the AudioContext constructor only to keep a list
//  for the mute; the engines load as before.
//
//  Pure helpers (node tests): bootLog, pct, parsePrefs, bezelFor, fitScreen.
//
//  grep -n targets
//    "export function status"   "export function bootLog"
//    "export function fitScreen"   "export function parsePrefs"
//    "function trackAudio"   "export function applyView"   "function initView"
//    "export async function manifest"
//    "export async function loadGame"   "export function gamepadPoll"
// ============================================================================
import { fetchBytes, sha256Hex } from './unzip.js';

const $ = id => (typeof document !== 'undefined' ? document.getElementById(id) : null);

// ------------------------------------------------------------- boot screen
/**
 * The boot log: done lines and the line that runs now. A text that only
 * differs in a "(...)" part or the "…" (a progress update of the same
 * step) changes nothing. Keeps the last max lines.
 */
export function bootLog(log, text, max = 6) {
  const key = t => String(t || '').replace(/\s*\([^)]*\)/g, '').replace(/[….]+$/, '').trim();
  if (!text) return log;
  const last = log[log.length - 1];
  if (last && !last.done && key(last.text) === key(text)) return log;
  const out = log.map(l => ({ ...l, done: true }));
  out.push({ text: String(text), done: false });
  return out.slice(-max);
}

/** The percent text of a progress value, or '' when there is none. */
export function pct(p) { return p >= 0 ? Math.round(Math.max(0, Math.min(1, p)) * 100) + '%' : ''; }

let LOG = [];

/** Show a status line. p in 0..1 shows the bar; p < 0 hides it. */
export function status(text, p = -1, isErr = false) {
  const box = $('status');
  if (!box) return;
  box.hidden = !text;
  box.classList.toggle('err', isErr);
  if (!text) return;
  if (!isErr) LOG = bootLog(LOG, text);
  const log = $('statusLog');
  if (log) log.replaceChildren(...LOG.slice(0, -1).map(l => { const li = document.createElement('li'); li.textContent = l.text.replace(/…$/, ''); return li; }));
  $('statusText').textContent = text;
  const head = $('statusHead');
  if (head) head.textContent = isErr ? 'System halted' : 'Retro Shelf · loading';
  const acts = $('statusActions');
  if (acts) acts.hidden = !isErr;
  const bar = $('statusBar');
  bar.hidden = !(p >= 0) || isErr;
  if (p >= 0) bar.value = Math.max(0, Math.min(1, p));
  const pc = $('statusPct');
  if (pc) pc.textContent = isErr ? '' : pct(p);
}

/** Put the game title on the boot screen. */
export function bootGame(title) { const e = $('statusGame'); if (e) e.textContent = title || ''; }

export function fail(text) { status(text, -1, true); }

export async function manifest() {
  const r = await fetch(new URL('games.json', import.meta.url));
  if (!r.ok) throw new Error('games.json: HTTP ' + r.status);
  return r.json();
}

/** Fetch the archive of a shelf game and check its sha256. */
export async function loadGame(data, game) {
  const url = new URL(data.fetched + game.file, import.meta.url);
  const name = game.file.split('/').pop();
  status('Downloading ' + name + ' (' + (game.bytes / 1048576).toFixed(1) + ' MB)…', 0);
  let bytes;
  try {
    bytes = await fetchBytes(url, p => status('Downloading ' + name + '…', p));
  } catch (e) {
    throw new Error('The game file ' + name + ' is not on the server right now. Please try again later.');
  }
  status('Checking ' + name + '…', 1);
  const h = await sha256Hex(bytes);
  if (h !== game.sha256) throw new Error(name + ' is not the reviewed file (sha256 ' + h.slice(0, 12) + '…). The page will not run it.');
  return bytes;
}

/** The game record of ?game=<id>. */
export function gameFromQuery(data) {
  const id = new URLSearchParams(location.search).get('game');
  const g = data.games.find(x => x.id === id);
  if (!g) throw new Error('No game "' + id + '" on the shelf.');
  return g;
}

/**
 * Poll the first standard gamepad. map: button index (string) -> key code
 * name; the d-pad (12..15) and the left stick give the arrow keys. send is
 * called with (code, down) only when a key changes.
 */
export function gamepadPoll(map, send, held = new Map()) {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = [...pads].find(p => p && p.connected);
  const want = new Map();
  if (gp) {
    for (const [i, code] of Object.entries(map || {})) if (gp.buttons[+i] && gp.buttons[+i].pressed) want.set(code, true);
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0, b = gp.buttons;
    if (ax < -0.5 || (b[14] && b[14].pressed)) want.set('ArrowLeft', true);
    if (ax > 0.5 || (b[15] && b[15].pressed)) want.set('ArrowRight', true);
    if (ay < -0.5 || (b[12] && b[12].pressed)) want.set('ArrowUp', true);
    if (ay > 0.5 || (b[13] && b[13].pressed)) want.set('ArrowDown', true);
  }
  for (const code of want.keys()) if (!held.has(code)) { held.set(code, true); send(code, true); }
  for (const code of [...held.keys()]) if (!want.has(code)) { held.delete(code); send(code, false); }
  return held;
}

// ------------------------------------------------------- view and sound
// The shelf page (main.js) keeps the view settings in localStorage under
// PREF_KEY and posts { type: 'retro-view', prefs } when one changes. Each
// player page reads the key at start and listens for the message.
//   frame   the CRT bezel round the screen (html.crt-frame)
//   scan    the scanlines over the screen (html.crt-scan)
//   muted   every AudioContext of the page is suspended
export const PREF_KEY = 'retro-shelf.view';
export const PREF_DEFAULT = Object.freeze({ frame: true, scan: false, muted: false });

/** The view settings from a stored JSON text; bad or missing keys get the default. */
export function parsePrefs(text) {
  let o = null;
  try { o = JSON.parse(text); } catch (e) { o = null; }
  const out = { ...PREF_DEFAULT };
  if (o && typeof o === 'object') for (const k of Object.keys(PREF_DEFAULT)) if (typeof o[k] === 'boolean') out[k] = o[k];
  return out;
}

export function readPrefs() {
  try { return parsePrefs(localStorage.getItem(PREF_KEY)); } catch (e) { return { ...PREF_DEFAULT }; }
}

/** The bezel width in CSS px: 0 without the frame, thin on a small screen. */
export function bezelFor(frame, w, h) {
  if (!frame) return 0;
  return Math.min(w, h) < 500 ? 8 : Math.min(w, h) < 800 ? 14 : 22;
}

/**
 * The size of the game screen in a box of aw x ah CSS px. The source is
 * sw x sh pixels, shown at the display aspect (4:3 for DOS VGA, so
 * 320 x 200 shows as 320 x 240). An integer scale k is used when it fills
 * at least 85% of the largest fit; else the fit is fractional (k = 0) and
 * image-rendering: pixelated keeps the pixels sharp.
 */
export function fitScreen(aw, ah, sw, sh, aspect = 4 / 3) {
  if (!(aw > 0 && ah > 0 && sw > 0 && sh > 0)) return { w: 0, h: 0, k: 0 };
  const bw = sw, bh = aspect ? Math.round(sw / aspect) : sh;
  const fit = Math.min(aw / bw, ah / bh), k = Math.floor(fit);
  if (k >= 1 && k / fit >= 0.85) return { w: bw * k, h: bh * k, k };
  return { w: Math.floor(bw * fit), h: Math.floor(bh * fit), k: 0 };
}

const AUDIO = { ctxs: [], muted: false };
/** True while the shelf page has the sound off. */
export function isMuted() { return AUDIO.muted; }

/**
 * Keep a list of each AudioContext that the page makes, so the mute
 * button can suspend them. A muted context does not resume: the engines
 * call resume() on a key or a tap, and that call does nothing while muted.
 */
function trackAudio() {
  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const AC = window[name];
    if (typeof AC !== 'function' || AC.__retro) continue;
    const P = new Proxy(AC, {
      construct(t, args, nt) {
        const ctx = Reflect.construct(t, args, nt);
        const resume = ctx.resume.bind(ctx);
        ctx.resume = () => (AUDIO.muted ? Promise.resolve() : resume());
        ctx.__resume = resume;
        AUDIO.ctxs.push(ctx);
        if (AUDIO.muted) ctx.suspend().catch(() => {});
        return ctx;
      },
    });
    P.__retro = true;
    window[name] = P;
  }
}

export function setMuted(m) {
  AUDIO.muted = !!m;
  AUDIO.ctxs = AUDIO.ctxs.filter(c => c.state !== 'closed');
  for (const c of AUDIO.ctxs) (m ? c.suspend() : c.__resume()).catch(() => {});
}

/** Apply view settings: the html classes, the sound, and a 'retro-view' event. */
export function applyView(p) {
  const r = document.documentElement.classList;
  r.toggle('crt-frame', !!p.frame);
  r.toggle('crt-scan', !!p.scan);
  if (AUDIO.muted !== !!p.muted) setMuted(p.muted);
  window.dispatchEvent(new CustomEvent('retro-view', { detail: p }));
}

function initView() {
  trackAudio();
  applyView(readPrefs());
  window.addEventListener('message', e => {
    if (e.origin !== location.origin || !e.data || e.data.type !== 'retro-view') return;
    applyView(parsePrefs(JSON.stringify(e.data.prefs)));
  });
  const retry = $('retryBtn'), quit = $('quitBtn');
  if (retry) retry.addEventListener('click', () => location.reload());
  if (quit) quit.addEventListener('click', askExit);
}

/** Ask the shelf page to close the player. */
export function askExit() { try { parent.postMessage({ type: 'retro-exit' }, location.origin); } catch (e) { /* no parent */ } }

if (typeof document !== 'undefined' && document.getElementById('status')) initView();
