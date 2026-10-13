// ============================================================================
//  RETRO SHELF  ·  player-common.js — what the three player pages share
// ----------------------------------------------------------------------------
//  The player pages (play-dos.html, play-scummvm.html, play-emu.html) run in
//  the child iframe of #player. Each one shows #status (a line of text and
//  a progress bar) until its engine draws, reads games.json and fetches the
//  game archive with a sha256 check, so the page runs only the unchanged
//  file that LICENSES.md reviewed.
//
//  grep -n targets
//    "export function status"   "export async function manifest"
//    "export async function loadGame"   "export function gamepadPoll"
// ============================================================================
import { fetchBytes, sha256Hex } from './unzip.js';

const $ = id => document.getElementById(id);

/** Show a status line. p in 0..1 shows the bar; p < 0 hides it. */
export function status(text, p = -1, isErr = false) {
  const box = $('status');
  if (!box) return;
  box.hidden = !text;
  box.classList.toggle('err', isErr);
  $('statusText').textContent = text || '';
  const bar = $('statusBar');
  bar.hidden = !(p >= 0);
  if (p >= 0) bar.value = Math.max(0, Math.min(1, p));
}

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

/** Ask the shelf page to close the player. */
export function askExit() { try { parent.postMessage({ type: 'retro-exit' }, location.origin); } catch (e) { /* no parent */ } }
