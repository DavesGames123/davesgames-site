// ============================================================================
//  RETRO SHELF  ·  main.js — the shelf, the player frame, your own disc
// ----------------------------------------------------------------------------
//  Boot: read games.json, build the bookcase (one shelf per engine, one
//  3D box per game; shelf-art.js paints the box art), the system list of the
//  bring-your-own-disc form and the credit tables. Play opens #player over
//  the whole window with one child iframe (play-dos.html, play-scummvm.html
//  or play-emu.html). The Exit button, pagehide and the saver all call
//  closePlayer(), which removes the iframe: that ends the engine, its
//  workers and its audio.
//
//  A press on a box pulls it out: the box gets .out (it leaves the shelf)
//  and #info shows the same box turned to the front, with the back of the
//  box beside it. Closing #info puts the box back and focuses it.
//
//  Your own disc: the File objects go to play-emu.html with postMessage
//  (a structured clone in the same origin). Nothing is uploaded.
//
//  Pure helpers (node tests import them): playerUrl, extOk, fmtMB.
//
//  grep -n targets
//    "async function boot"   "function buildShelf"   "function box("
//    "function boxFaces"     "function artOf"        "function applyLayout"
//    "function openInfo"     "function closeInfo"    "function onInfoClosed"
//    "function play"         "function closePlayer"
//    "function goFull"       "function buildByo"     "function buildCredits"
//    "export function playerUrl"  "export function extOk"
// ============================================================================
import './saver.js';
import { licenceKind, mediaOf } from './saver-plan.js';
import { coverPalette, shelfGroups, shelfLayout, boxPose, spineTitle, paintCover, paintSpine, COVER_W, COVER_H, SPINE_W, SPINE_H } from './shelf-art.js';

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
// Each box is a button with three faces (front, spine, top) in CSS 3D.
// The art is painted once per game into a canvas and kept as a data URL,
// so the shelf box and the pulled-out box show the same picture.
const ART = new Map();
const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
function artOf(g) {
  if (ART.has(g.id)) return ART.get(g.id);
  let a = { front: '', spine: '' };
  try {
    const f = mkCanvas(COVER_W, COVER_H), sp = mkCanvas(SPINE_W, SPINE_H);
    paintCover(f.getContext('2d'), g, mkCanvas);
    paintSpine(sp.getContext('2d'), g);
    a = { front: f.toDataURL() || '', spine: sp.toDataURL() || '' };
  } catch (e) { /* no 2D canvas: the faces keep their CSS colours */ }
  ART.set(g.id, a);
  return a;
}

/** The three faces of a box; the caller sets the size variables. */
function boxFaces(g) {
  const pal = coverPalette(g), art = artOf(g);
  const face = (cls, url) => el('span', { class: 'face ' + cls + (url ? '' : ' plain'), style: url ? 'background-image:url(' + url + ')' : '' });
  const front = face('front', art.front);
  if (!art.front) front.append(el('span', { class: 'plain-title' }, g.title));
  front.append(el('span', { class: 'shine' }));
  return el('span', { class: 'box3d', style: '--c:' + pal.accent + ';--cb:' + pal.base + ';--cd:' + pal.dark + ';--cl:' + pal.light + ';--ci:' + pal.ink },
    front, face('spine', art.spine), el('span', { class: 'face top' }));
}

function box(g) {
  const pose = boxPose(g.id);
  const b = el('button', { type: 'button', class: 'box', 'data-id': g.id, 'aria-haspopup': 'dialog',
    'aria-label': g.title + ', ' + g.year + ', ' + g.maker + '. Take the box off the shelf',
    style: '--ry:' + pose.ry.toFixed(1) + 'deg;--dz:' + pose.dz + 'px',
    onclick: () => openInfo(g, b) },
  el('span', { class: 'floor-shadow' }), boxFaces(g));
  return el('li', { class: 'slot' }, b, el('span', { class: 'tag', 'aria-hidden': 'true' }, spineTitle(g), el('small', null, String(g.year))));
}

function buildShelf() {
  const bays = shelfGroups(S.data.games).map(s => el('section', { class: 'bay', 'aria-labelledby': 'bay-' + s.id },
    el('h3', { class: 'plate', id: 'bay-' + s.id }, s.label, el('small', null, ' · runs in ' + s.engine)),
    el('div', { class: 'back', 'aria-hidden': 'true' }),
    el('ul', { class: 'row', role: 'list' }, ...s.games.map(box)),
    el('div', { class: 'plank', 'aria-hidden': 'true' })));
  $('shelf').replaceChildren(...bays);
  applyLayout();
  window.addEventListener('resize', () => { cancelAnimationFrame(S.lay); S.lay = requestAnimationFrame(applyLayout); });
}

/** Write the box size of shelfLayout into the CSS variables. */
function applyLayout() {
  const L = shelfLayout(document.documentElement.clientWidth || window.innerWidth || 390);
  const st = document.documentElement.style;
  st.setProperty('--bw', L.bw + 'px'); st.setProperty('--bh', L.bh + 'px');
  st.setProperty('--bd', L.bd + 'px'); st.setProperty('--gap', L.gap + 'px');
  $('shelf').dataset.mode = L.mode;
}

function openInfo(g, from) {
  if (S.from) S.from.classList.remove('out');
  S.from = from || null;
  S.last = from || S.last;
  const shelf = shelfGroups([g])[0];
  const box = boxFaces(g);
  $('infoBox').replaceChildren(box);
  $('info').style.setProperty('--c', coverPalette(g).accent);
  $('infoKick').textContent = shelf.label + ' · ' + ((g.saver && g.saver.genre) || '');
  $('infoTitle').textContent = g.title;
  $('infoBy').textContent = g.year + ' · ' + g.maker + ' · ' + g.sub;
  $('infoChips').replaceChildren(...[
    'Runs in ' + shelf.engine, fmtMB(g.bytes), g.keyboard ? 'Keyboard or gamepad' : 'Mouse or touch',
    licenceKind(g), mediaOf(g) === 'cd' ? 'CD-ROM' : 'Floppy disks',
  ].map(t => el('li', null, t)));
  $('infoBlurb').textContent = g.blurb;
  $('infoCtl').textContent = g.controls;
  $('infoLic').replaceChildren(g.licence + '. Full text: ', el('code', null, g.licenceFile), ' in the archive. Source: ', link(g.source, new URL(g.source).hostname), '.');
  $('infoFile').textContent = g.file.split('/').pop() + ' · sha256 ' + g.sha256;
  $('infoPlay').onclick = () => { closeInfo(); play(g); };
  $('infoBack').onclick = closeInfo;
  if (from) from.classList.add('out');
  const d = $('info');
  if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  $('infoPlay').focus();
}

/** Close the pull-out; the 'close' event puts the box back. */
function closeInfo() {
  const d = $('info');
  if (d.close) d.close();
  else { d.removeAttribute('open'); onInfoClosed(); }
}

function onInfoClosed() {
  const b = S.from;
  S.from = null;
  if (!b) return;
  b.classList.remove('out');
  if (!S.frame) b.focus();
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
  $('info').addEventListener('close', onInfoClosed);
  // Exit: end the game, then focus the box that it came from.
  $('exitBtn').addEventListener('click', () => { closePlayer(); if (S.last && S.last.isConnected) S.last.focus(); });
  $('fsBtn').addEventListener('click', goFull);
  // A player page can ask to close (its own Exit key on a phone).
  window.addEventListener('message', e => {
    if (S.frame && e.source === S.frame.contentWindow && e.data && e.data.type === 'retro-exit') closePlayer();
  });
  window.__retro = { S, closePlayer, play: id => play(S.data.games.find(g => g.id === id)) };
  window.addEventListener('pagehide', closePlayer);
}

if (typeof document !== 'undefined' && document.getElementById('shelf')) boot();
