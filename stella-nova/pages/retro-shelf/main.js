// ============================================================================
//  RETRO SHELF  ·  main.js — the shelf, the player frame, your own disc
// ----------------------------------------------------------------------------
//  Boot: read games.json, build the shelf cards, the system list of the
//  bring-your-own-disc form and the credit tables. Play opens #player over
//  the whole window with one child iframe (play-dos.html, play-scummvm.html
//  or play-emu.html). The Exit button, pagehide and the saver all call
//  closePlayer(), which removes the iframe: that ends the engine, its
//  workers and its audio.
//
//  Your own disc: the File objects go to play-emu.html with postMessage
//  (a structured clone in the same origin). Nothing is uploaded.
//
//  Pure helpers (node tests import them): playerUrl, extOk, fmtMB.
//
//  grep -n targets
//    "async function boot"   "function buildShelf"   "function card"
//    "function openInfo"     "function play"         "function closePlayer"
//    "function goFull"       "function buildByo"     "function buildCredits"
//    "export function playerUrl"  "export function extOk"
// ============================================================================
import './saver.js';

export function fmtMB(bytes) { return (bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0) + ' MB'; }

/** The player page of a shelf game. */
export function playerUrl(game) {
  const page = game.engine === 'dos' ? 'play-dos.html' : game.engine === 'scummvm' ? 'play-scummvm.html' : null;
  if (!page) throw new Error('no player for engine ' + game.engine);
  return page + '?game=' + encodeURIComponent(game.id);
}

/** True when the file name has one of the extensions of the system. */
export function extOk(name, system) {
  const n = String(name || '').toLowerCase();
  return system.ext.some(e => n.endsWith(e));
}

const $ = id => document.getElementById(id);
const S = { data: null, frame: null, system: null, pendingFile: null };

function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) e.append(k);
  return e;
}
const link = (href, text) => el('a', { href, target: '_blank', rel: 'noopener' }, text);

// ------------------------------------------------------------------ shelf
function card(g) {
  const engine = g.engine === 'dos' ? 'DOSBox' : 'ScummVM';
  const c = el('div', { class: 'card', role: 'listitem', style: '--c:' + g.accent },
    el('button', { type: 'button', class: 'open', 'aria-label': 'Play ' + g.title, onclick: () => play(g) },
      el('span', { class: 'yr' }, g.year + ' · ' + g.maker),
      el('span', { class: 'tt' }, g.title),
      el('span', { class: 'sub' }, g.sub),
      el('span', { class: 'bl' }, g.blurb)),
    el('div', { class: 'foot' },
      el('span', { class: 'chip' }, engine),
      el('span', { class: 'chip' }, fmtMB(g.bytes)),
      g.keyboard ? el('span', { class: 'chip' }, 'Keyboard') : el('span', { class: 'chip' }, 'Mouse or touch'),
      el('button', { type: 'button', class: 'lic', onclick: () => openInfo(g) }, 'Licence'),
      el('span', { class: 'go', 'aria-hidden': 'true' }, 'Play ▸')));
  return c;
}

function buildShelf() {
  const shelf = $('shelf');
  shelf.replaceChildren(...S.data.games.map(card));
}

function openInfo(g) {
  $('infoTitle').textContent = g.title;
  $('infoBy').textContent = g.year + ' · ' + g.maker + ' · ' + g.sub;
  $('infoBlurb').textContent = g.blurb;
  $('infoCtl').textContent = g.controls;
  $('infoLic').replaceChildren(g.licence + '. Full text: ', el('code', null, g.licenceFile), ' in the archive. Source: ', link(g.source, new URL(g.source).hostname), '.');
  $('infoFile').textContent = g.file.split('/').pop() + ' · sha256 ' + g.sha256;
  $('infoPlay').onclick = () => { $('info').close(); play(g); };
  const d = $('info');
  if (d.showModal) d.showModal(); else d.setAttribute('open', '');
}

// ----------------------------------------------------------------- player
function play(g) { openPlayer(playerUrl(g), g.title); }

function openPlayer(src, title, onReady) {
  closePlayer();
  if (window.snSaverActive) return;
  $('playerTitle').textContent = title;
  const f = el('iframe', { src, title: title + ' (game)', allow: 'fullscreen; gamepad; autoplay' });
  if (onReady) {
    const onMsg = e => {
      if (e.source !== f.contentWindow || !e.data || e.data.type !== 'retro-ready') return;
      window.removeEventListener('message', onMsg);
      onReady(f.contentWindow);
    };
    window.addEventListener('message', onMsg);
    f._off = () => window.removeEventListener('message', onMsg);
  }
  f.addEventListener('load', () => { try { f.contentWindow.focus(); } catch (e) { /* cross-origin never happens here */ } });
  $('playerStage').replaceChildren(f);
  S.frame = f;
  $('player').hidden = false;
  document.documentElement.classList.add('playing');
  f.focus();
}

function closePlayer() {
  const f = S.frame;
  S.frame = null;
  if (f) {
    if (f._off) f._off();
    try { f.src = 'about:blank'; } catch (e) { /* ignore */ }
    f.remove();
  }
  if ($('player')) $('player').hidden = true;
  document.documentElement.classList.remove('playing');
  const d = document;
  if (d.fullscreenElement && d.exitFullscreen) d.exitFullscreen().catch(() => {});
  else if (d.webkitFullscreenElement && d.webkitExitFullscreen) d.webkitExitFullscreen();
}

function goFull() {
  const p = $('player'), d = document;
  if (d.fullscreenElement || d.webkitFullscreenElement) {
    if (d.exitFullscreen) d.exitFullscreen().catch(() => {}); else if (d.webkitExitFullscreen) d.webkitExitFullscreen();
  } else if (p.requestFullscreen) p.requestFullscreen().catch(() => {});
  else if (p.webkitRequestFullscreen) p.webkitRequestFullscreen();
  if (S.frame) S.frame.focus();
}

// ----------------------------------------------------- bring your own disc
function buildByo() {
  const box = $('sys');
  for (const s of S.data.systems) {
    const r = el('input', { type: 'radio', name: 'sys', value: s.id });
    r.addEventListener('change', () => pickSystem(s));
    box.append(el('label', null, r, el('span', null, s.name), el('small', null, s.core)));
  }
  $('romFile').addEventListener('change', checkByo);
  $('biosFile').addEventListener('change', checkByo);
  $('own').addEventListener('change', checkByo);
  $('byoPlay').addEventListener('click', playOwn);
  const first = box.querySelector('input');
  first.checked = true;
  pickSystem(S.data.systems[0]);
}

function pickSystem(s) {
  S.system = s;
  $('romFile').setAttribute('accept', s.ext.join(','));
  $('romHint').textContent = 'File types: ' + s.ext.join(' ') + '. A .zip or .7z with the game inside works too.';
  $('biosPick').hidden = s.bios === 'none';
  $('biosHint').textContent = s.biosNote || '';
  $('biosFile').value = '';
  checkByo();
}

function checkByo() {
  const f = ($('romFile').files || [])[0];
  const okExt = f ? extOk(f.name, S.system) : false;
  $('byoPlay').disabled = !(f && okExt && $('own').checked);
  const st = $('byoStatus');
  st.classList.toggle('err', !!f && !okExt);
  st.textContent = !f ? '' : !okExt ? f.name + ' is not a ' + S.system.name + ' file type.' : !$('own').checked ? 'Tick the box to confirm that you own this game.' : f.name + ' (' + fmtMB(f.size) + ') stays on this device.';
}

function playOwn() {
  const f = ($('romFile').files || [])[0], b = ($('biosFile').files || [])[0] || null, s = S.system;
  if (!f || !$('own').checked) return;
  openPlayer('play-emu.html?system=' + encodeURIComponent(s.id), f.name + ' · ' + s.name, win => {
    win.postMessage({ type: 'retro-file', file: f, bios: b }, location.origin);
  });
}

// ---------------------------------------------------------------- credits
function buildCredits() {
  $('gameRows').replaceChildren(...S.data.games.map(g => el('tr', null,
    el('td', null, g.title + ' (' + g.year + ')'),
    el('td', null, g.maker),
    el('td', null, g.licence, el('br'), el('span', { class: 'mono' }, g.licenceFile)),
    el('td', null, link(g.source, g.file.split('/').pop()), el('br'), el('span', { class: 'mono' }, 'sha256 ' + g.sha256.slice(0, 16) + '…')))));
  $('engineRows').replaceChildren(...S.data.engines.map(e => el('tr', null,
    el('td', null, link(e.site, e.name)), el('td', null, e.licence), el('td', null, link(e.source, new URL(e.source).pathname.slice(1, 60))))));
  $('coreRows').replaceChildren(...S.data.systems.map(s => el('tr', null,
    el('td', null, s.name), el('td', null, s.core), el('td', null, s.licence), el('td', null, link(s.source, new URL(s.source).pathname.slice(1, 60))))));
}

// ------------------------------------------------------------------- boot
async function boot() {
  const coarse = matchMedia('(hover: none) and (pointer: coarse)').matches;
  $('touchNote').hidden = !coarse;
  try {
    const r = await fetch(new URL('games.json', import.meta.url));
    S.data = await r.json();
  } catch (e) {
    $('shelfStatus').textContent = 'The game list did not load. Reload the page to try again.';
    $('shelfStatus').classList.add('err');
    return;
  }
  buildShelf();
  buildByo();
  buildCredits();
  $('exitBtn').addEventListener('click', closePlayer);
  $('fsBtn').addEventListener('click', goFull);
  // A player page can ask to close (its own Exit key on a phone).
  window.addEventListener('message', e => {
    if (S.frame && e.source === S.frame.contentWindow && e.data && e.data.type === 'retro-exit') closePlayer();
  });
  window.__retro = { S, closePlayer, play: id => play(S.data.games.find(g => g.id === id)) };
  window.addEventListener('pagehide', closePlayer);
}

if (typeof document !== 'undefined' && document.getElementById('shelf')) boot();
