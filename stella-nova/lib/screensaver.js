// ============================================================================
//  SCREENSAVER  ·  lib/screensaver.js — the shell's screensaver mode
// ----------------------------------------------------------------------------
//  Cmd+Option+S on the Mac, or Ctrl+Alt+S on any system, opens the menu. Start
//  in the menu hides the shell chrome and plays a list of pages. Each page
//  shows for a set time, behind a fade to black. The menu can also record
//  each page canvas to a video file, which the browser saves in Downloads.
//
//  The shell (stella-nova/index.html) loads this classic script after its own
//  script. It uses the shell's switchTab, PAGES, LABELS and SN_NAV. It does
//  not change the page swap: it watches #frame-wrap for the new iframe.
//
//  Page protocol. When a page is on screen, the controller waits for
//  window.snSaver in the page (up to HOOK_WAIT_MS):
//    snSaver.enter(opts)  opts = { calm, seconds, caption, seed }. calm is
//                         0..1 (1 is slowest). The page hides its own GUI,
//                         sets a preset and starts its autopilot. It can
//                         return (or resolve to) { canvas, warmupMs }.
//    snSaver.exit()       optional. The controller calls it when the user
//                         stops the screensaver on that page.
//  A page with no snSaver gets the generic mode: class sn-saver on <html>,
//  the largest visible canvas pinned full-frame, all other content hidden.
//  lib/screensaver-catalog.js holds the tier of each page (how much work its
//  hook needs) and the default list.
//
//  Keys while it plays: Esc stops, Right and Left go to the next and the
//  previous page, Space pauses the timer, H shows the status line.
//
//  grep -n targets
//    settings + storage ... "const DEFAULTS"
//    key combination ...... "function isCombo"
//    menu markup .......... "function buildMenu"
//    play loop ............ "function showPage"
//    page hook / generic .. "function enterPage"
//    recorder ............. "function startRecording"
//    stop ................. "function stopSaver"
// ============================================================================
(function () {
'use strict';
if (window.snScreensaver) return;

const CAT = window.SN_SAVER_CATALOG || { pages: {}, tiers: {} };
// v2: shuffle became the default; a new key drops older saved choices.
const STORE = 'sn-saver-settings-v2';
// How long a page has to define window.snSaver. A page that the catalog
// marks hook: true gets the long wait (a module with a CDN import can take
// seconds under load). Other pages go to the generic mode soon.
const HOOK_WAIT_MS = 8000, NO_HOOK_WAIT_MS = 800;
const LOAD_WAIT_MS = 15000;  // a page that never loads is skipped after this

const DEFAULTS = {
  pages: null,          // null = the catalog default list
  seconds: 60,          // time on each page
  order: 'shuffle',     // 'shuffle' | 'nav'
  loop: true,           // false = play the list once, then stop
  fade: 1.2,            // fade to black between pages, seconds
  calm: 0.7,            // passed to page hooks; 1 = slowest
  caption: true,        // page name at the lower left for a few seconds
  display: 'screen',   // 'screen' = browser full screen | 'window' = fill the browser window
  hideCursor: true,
  exitOnInput: false,   // true = any key or mouse move stops it
  wakeLock: true,
  record: false,
  recordFps: 30,
  recordMbps: 12,
  recordWarmup: 2,      // seconds to wait before the recording starts
};

let S = load();
let run = null;        // the active run, or null
let menu = null;

function load() {
  try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(STORE) || '{}')); }
  catch (e) { return Object.assign({}, DEFAULTS); }
}
function save() { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) {} }

// ── catalog ────────────────────────────────────────────────────────────────
// Every registered page, in nav order, with its region, constellation and
// tier. state: 'ready' (own hook, or tier 1 that is good as it is), 'later'
// (tier 2-4 with no hook yet: generic mode only), 'no' (tier 5).
function allPages() {
  const out = [];
  (window.SN_NAV || []).forEach(r => r.constellations.forEach(c => c.groups.forEach(g => g.p.forEach(p => {
    const info = CAT.pages[p[0]] || {}, tier = info.tier || 0, hook = !!info.hook;
    const state = hook || tier === 1 ? 'ready' : tier === 5 ? 'no' : 'later';
    out.push({ key: p[0], label: p[1], region: r.id, regionName: r.label, con: c.label, color: c.color, tier, note: info.note || '', hook, state });
  }))));
  return out.filter(p => p.key !== 'home' && p.tier !== 'excluded');
}
function defaultKeys() {
  return allPages().filter(p => CAT.pages[p.key] ? CAT.pages[p.key].default : (p.tier >= 1 && p.tier <= 2)).map(p => p.key);
}
function chosenKeys() {
  const known = new Set(allPages().filter(p => p.state !== 'no').map(p => p.key));
  return (S.pages || defaultKeys()).filter(k => known.has(k));
}

// ── key combination ────────────────────────────────────────────────────────
// Cmd+Option+S on the Mac, Ctrl+Alt+S everywhere (Windows, Linux, and a PC
// keyboard on a Mac). Option and AltGr change e.key ("ß", "ś"), so match the
// physical key with e.code.
function isCombo(e) {
  return e.code === 'KeyS' && e.altKey && !e.shiftKey && (e.metaKey !== e.ctrlKey);
}
function onKey(e) {
  if (isCombo(e)) { e.preventDefault(); e.stopPropagation(); if (run) stopSaver(); else openMenu(); return; }
  if (run) runKey(e);
  else if (menu && !menu.hidden && e.key === 'Escape') { e.preventDefault(); closeMenu(); }
}
window.addEventListener('keydown', onKey, true);

// Keys pressed inside the page iframe do not reach the shell. Listen in each
// new frame too (same origin), and stop the run on input there if asked.
function hookFrame(f) {
  f.addEventListener('load', () => {
    let w; try { w = f.contentWindow; if (!w || w.location.href === 'about:blank') return; } catch (e) { return; }
    w.addEventListener('keydown', onKey, true);
    if (run) run.onFrameLoad(f, w);
  });
}
const wrap = document.getElementById('frame-wrap');
if (wrap) {
  wrap.querySelectorAll('iframe').forEach(hookFrame);
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.tagName === 'IFRAME') hookFrame(n); })))
    .observe(wrap, { childList: true });
}

// ── styles ─────────────────────────────────────────────────────────────────
const css = document.createElement('style');
css.textContent = `
body.sn-saver-on #sidebar, body.sn-saver-on #topbar, body.sn-saver-on #overlay { display: none !important; }
body.sn-saver-on #content { width: 100vw; height: 100vh; }
body.sn-saver-on.sn-saver-nocursor, body.sn-saver-on.sn-saver-nocursor * { cursor: none !important; }
#sn-saver-cover { position: fixed; inset: 0; background: #000; opacity: 0; pointer-events: none; z-index: 9000; transition: opacity var(--fade, 1.2s) ease; }
#sn-saver-cover.on { opacity: 1; }
#sn-saver-cap { position: fixed; left: 40px; bottom: 34px; z-index: 9001; pointer-events: none; font-family: var(--f-sans, system-ui); color: #eef3fb; opacity: 0; transition: opacity 1.6s ease; text-shadow: 0 1px 12px rgba(0,0,0,.8); }
#sn-saver-cap.on { opacity: .85; }
#sn-saver-cap b { display: block; font-weight: 300; font-size: 1.6rem; letter-spacing: .04em; }
#sn-saver-cap i { display: block; font: 500 .7rem/1.6 var(--f-mono, monospace); letter-spacing: .22em; text-transform: uppercase; font-style: normal; color: var(--c, #7f91ad); }
#sn-saver-hud { position: fixed; right: 18px; top: 14px; z-index: 9001; font: 500 .7rem/1.4 var(--f-mono, monospace); color: #9fb3d1; background: rgba(8,10,16,.7); border: 1px solid rgba(150,200,255,.18); border-radius: 8px; padding: 6px 10px; pointer-events: none; }
#sn-saver-hud[hidden] { display: none; }
#sn-saver-menu { position: fixed; inset: 0; z-index: 9500; display: grid; place-items: center; background: rgba(4,6,10,.72); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
#sn-saver-menu[hidden] { display: none; }
#sn-saver-menu .box { width: min(980px, calc(100vw - 32px)); max-height: calc(100vh - 48px); display: grid; grid-template-rows: auto 1fr auto; background: #0d1018; border: 1px solid rgba(150,200,255,.18); border-radius: 16px; box-shadow: 0 30px 80px rgba(0,0,0,.6); color: #c8d4e6; font-family: var(--f-sans, system-ui); overflow: hidden; }
#sn-saver-menu header { display: flex; align-items: baseline; gap: 14px; padding: 18px 22px 14px; border-bottom: 1px solid rgba(150,200,255,.09); }
#sn-saver-menu header h2 { font-weight: 300; font-size: 1.5rem; color: #eef3fb; }
#sn-saver-menu header h2 em { font-family: var(--f-serif, serif); color: #ffc832; }
#sn-saver-menu header p { margin-left: auto; font: 500 .68rem/1 var(--f-mono, monospace); letter-spacing: .16em; text-transform: uppercase; color: #7f91ad; }
#sn-saver-menu .cols { display: grid; grid-template-columns: 1.3fr 1fr; min-height: 0; }
#sn-saver-menu .pages { overflow: auto; padding: 12px 18px 18px; border-right: 1px solid rgba(150,200,255,.09); }
#sn-saver-menu .opts { overflow: auto; padding: 14px 20px 18px; display: grid; gap: 12px; align-content: start; }
#sn-saver-menu .quick { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
#sn-saver-menu button { font: inherit; color: inherit; cursor: pointer; }
#sn-saver-menu .chip { font: 500 .66rem/1 var(--f-mono, monospace); letter-spacing: .1em; text-transform: uppercase; padding: 7px 10px; border-radius: 999px; border: 1px solid rgba(150,200,255,.18); background: rgba(150,200,255,.04); }
#sn-saver-menu .chip:hover { border-color: #6db8e0; color: #eef3fb; }
#sn-saver-menu .sec { margin-top: 12px; border-top: 1px solid rgba(150,200,255,.09); padding-top: 8px; }
#sn-saver-menu .sec > summary { list-style: none; cursor: pointer; display: flex; align-items: baseline; gap: 8px; font-weight: 600; font-size: .95rem; color: #eef3fb; padding: 4px 2px; }
#sn-saver-menu .sec > summary::-webkit-details-marker { display: none; }
#sn-saver-menu .sec > summary::after { content: '\\203A'; margin-left: auto; color: #7f91ad; transition: transform .2s; }
#sn-saver-menu .sec[open] > summary::after { transform: rotate(90deg); }
#sn-saver-menu .sec > summary small { font: 500 .66rem/1 var(--f-mono, monospace); color: #7f91ad; }
#sn-saver-menu .sec-no label.pg { opacity: .5; cursor: default; }
#sn-saver-menu .con { margin-top: 10px; }
#sn-saver-menu .con-h { display: flex; align-items: center; gap: 8px; font: 500 .66rem/1 var(--f-mono, monospace); letter-spacing: .18em; text-transform: uppercase; color: var(--c); padding: 6px 4px; cursor: pointer; user-select: none; }
#sn-saver-menu label.pg { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 6px; font-size: .86rem; cursor: pointer; }
#sn-saver-menu label.pg:hover { background: rgba(150,200,255,.05); }
#sn-saver-menu label.pg input { accent-color: #6db8e0; }
#sn-saver-menu label.pg span { flex: 1; }
#sn-saver-menu .tier { font: 500 .6rem/1 var(--f-mono, monospace); padding: 3px 6px; border-radius: 5px; border: 1px solid currentColor; opacity: .85; }
#sn-saver-menu .t1 { color: #5fd38d; } #sn-saver-menu .t2 { color: #9fd35f; } #sn-saver-menu .t3 { color: #ffc832; }
#sn-saver-menu .t4 { color: #ff8a3d; } #sn-saver-menu .t5 { color: #ff6b8a; } #sn-saver-menu .t0 { color: #7f91ad; }
#sn-saver-menu .hk { font: 500 .6rem/1 var(--f-mono, monospace); color: #6db8e0; }
#sn-saver-menu .row { display: grid; gap: 6px; }
#sn-saver-menu .row > span { font: 500 .66rem/1 var(--f-mono, monospace); letter-spacing: .16em; text-transform: uppercase; color: #7f91ad; }
#sn-saver-menu .row output { color: #eef3fb; letter-spacing: 0; text-transform: none; }
#sn-saver-menu input[type=range] { width: 100%; accent-color: #6db8e0; }
#sn-saver-menu select { font: inherit; color: #eef3fb; background: #0a0c12; border: 1px solid rgba(150,200,255,.18); border-radius: 8px; padding: 6px 8px; }
#sn-saver-menu .tg { display: flex; align-items: center; gap: 8px; font-size: .86rem; cursor: pointer; }
#sn-saver-menu .tg input { accent-color: #6db8e0; }
#sn-saver-menu fieldset { border: 1px solid rgba(150,200,255,.09); border-radius: 10px; padding: 10px 12px 12px; display: grid; gap: 10px; }
#sn-saver-menu fieldset[disabled] > :not(legend) { opacity: .45; }
#sn-saver-menu legend { padding: 0 6px; font: 500 .66rem/1 var(--f-mono, monospace); letter-spacing: .16em; text-transform: uppercase; color: #7f91ad; }
#sn-saver-menu .note { font-size: .76rem; color: #7f91ad; line-height: 1.45; }
#sn-saver-menu footer { display: flex; align-items: center; gap: 12px; padding: 14px 22px; border-top: 1px solid rgba(150,200,255,.09); }
#sn-saver-menu footer .sum { flex: 1; font-size: .82rem; color: #7f91ad; }
#sn-saver-menu .go { padding: 11px 22px; border-radius: 10px; border: 0; background: #8ec5ff; color: #0a0c12; font-weight: 600; }
#sn-saver-menu .go:disabled { opacity: .4; cursor: default; }
#sn-saver-menu .x { padding: 10px 16px; border-radius: 10px; border: 1px solid rgba(150,200,255,.18); background: none; }
@media (max-width: 760px) { #sn-saver-menu .cols { grid-template-columns: 1fr; } #sn-saver-menu .pages { border-right: 0; max-height: 40vh; } }
`;
document.head.appendChild(css);

// ── menu ───────────────────────────────────────────────────────────────────
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function recFormat() {
  if (!window.MediaRecorder) return null;
  const types = ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || null;
}

function buildMenu() {
  const m = document.createElement('div');
  m.id = 'sn-saver-menu'; m.hidden = true;
  m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', 'Screensaver options');
  const tiers = CAT.tiers || {};
  // Three sections by readiness, each grouped by constellation. Only the
  // ready section is open. Tier 5 pages show for reference, not to pick.
  const SECTIONS = [
    { id: 'ready', title: 'Ready', text: 'Pages with their own calm screensaver, or that are good as they are.', open: true },
    { id: 'later', title: 'Not ready yet', text: 'These play in the generic mode: the picture fills the screen, but speed and framing are the page defaults.', open: false },
    { id: 'no', title: 'Not for a screensaver', text: 'Text, forms, the microphone or the network. They cannot be picked.', open: false },
  ];
  let list = '';
  SECTIONS.forEach(sec => {
    const pages = allPages().filter(p => p.state === sec.id);
    if (!pages.length) return;
    const byCon = new Map();
    pages.forEach(p => { if (!byCon.has(p.con)) byCon.set(p.con, { color: p.color, pages: [] }); byCon.get(p.con).pages.push(p); });
    list += `<details class="sec sec-${sec.id}"${sec.open ? ' open' : ''}><summary>${esc(sec.title)}<small>${pages.length}</small></summary><p class="note">${esc(sec.text)}</p>`;
    byCon.forEach((c, name) => {
      list += `<div class="con" style="--c:${c.color}"><div class="con-h" data-con="${esc(name)}">${esc(name)}</div>`;
      c.pages.forEach(p => {
        const t = tiers[p.tier] || {};
        const badge = sec.id === 'ready' ? (p.hook ? '' : '<b class="tier t1" title="Good as it is">AS IS</b>') : `<b class="tier t${p.tier}" title="${esc(t.name || 'Not rated')}: ${esc(t.text || '')}">${esc(t.name || '?')}</b>`;
        list += `<label class="pg" title="${esc(p.note)}"><input type="checkbox" value="${p.key}" data-region="${p.region}"${sec.id === 'no' ? ' disabled' : ''}><span>${esc(p.label)}</span>${badge}</label>`;
      });
      list += '</div>';
    });
    list += '</details>';
  });
  const regions = (window.SN_NAV || []).map(r => `<button class="chip" data-q="region:${r.id}">${esc(r.label)}</button>`).join('');
  const fmt = recFormat();
  m.innerHTML = `<div class="box">
  <header><h2>Screen<em>saver</em></h2><p>${/Mac/.test(navigator.platform) ? '⌘⌥S or Ctrl+Alt+S' : 'Ctrl+Alt+S'} · Esc to stop</p></header>
  <div class="cols">
    <div class="pages">
      <div class="quick">
        <button class="chip" data-q="ready">All ready</button>
        ${regions}
        <button class="chip" data-q="everything">Ready + not ready</button>
        <button class="chip" data-q="none">None</button>
      </div>
      <p class="note">A region button picks the ready pages of that region. Click a constellation name to toggle it.</p>
      ${list}
    </div>
    <div class="opts">
      <label class="row"><span>Time on each page <output data-o="seconds"></output></span><input type="range" data-k="seconds" min="10" max="600" step="5"></label>
      <label class="row"><span>Order</span><select data-k="order"><option value="nav">Site order</option><option value="shuffle">Shuffle</option></select></label>
      <label class="row"><span>Fade between pages <output data-o="fade"></output></span><input type="range" data-k="fade" min="0" max="4" step="0.1"></label>
      <label class="row"><span>Calm <output data-o="calm"></output></span><input type="range" data-k="calm" min="0" max="1" step="0.05"></label>
      <label class="tg"><input type="checkbox" data-k="loop">Loop the list</label>
      <label class="tg"><input type="checkbox" data-k="caption">Show the page name</label>
      <label class="row"><span>Display</span><select data-k="display"><option value="screen">Full screen (whole display)</option><option value="window">Fill the browser window</option></select></label>
      <label class="tg"><input type="checkbox" data-k="hideCursor">Hide the cursor</label>
      <label class="tg"><input type="checkbox" data-k="wakeLock">Keep the screen awake</label>
      <label class="tg"><input type="checkbox" data-k="exitOnInput">Stop on any key or mouse move</label>
      <fieldset${fmt ? '' : ' disabled'}><legend>Recording</legend>
        <label class="tg"><input type="checkbox" data-k="record">Save each page as a video</label>
        <label class="row"><span>Frame rate</span><select data-k="recordFps"><option value="24">24 fps</option><option value="30">30 fps</option><option value="60">60 fps</option></select></label>
        <label class="row"><span>Bit rate <output data-o="recordMbps"></output></span><input type="range" data-k="recordMbps" min="2" max="40" step="1"></label>
        <label class="row"><span>Wait before recording <output data-o="recordWarmup"></output></span><input type="range" data-k="recordWarmup" min="0" max="15" step="0.5"></label>
        <p class="note">${fmt ? `Format: ${esc(fmt.split(';')[0])}${fmt.startsWith('video/mp4') ? '' : ' (this browser cannot record MP4)'}. Files go to your browser's download folder, normally Downloads. The browser can ask once to allow more than one download. Only the page canvas is recorded, not text over it.` : 'This browser cannot record a canvas.'}</p>
      </fieldset>
    </div>
  </div>
  <footer><span class="sum"></span><button class="x" data-act="close">Cancel</button><button class="go" data-act="start">Start</button></footer>
</div>`;
  document.body.appendChild(m);

  const boxes = () => Array.from(m.querySelectorAll('.pg input'));
  const units = { seconds: v => v >= 60 ? `${Math.floor(v / 60)} min${v % 60 ? ' ' + v % 60 + ' s' : ''}` : v + ' s', fade: v => (+v).toFixed(1) + ' s', calm: v => Math.round(v * 100) + '%', recordMbps: v => v + ' Mbit/s', recordWarmup: v => (+v).toFixed(1) + ' s' };
  function sync() {
    const keys = boxes().filter(b => b.checked).map(b => b.value);
    S.pages = keys;
    m.querySelectorAll('[data-o]').forEach(o => { o.textContent = units[o.dataset.o](S[o.dataset.o]); });
    const total = keys.length * S.seconds;
    m.querySelector('.sum').textContent = keys.length ? `${keys.length} pages · ${Math.round(total / 60)} min a pass${S.record ? ' · recording' : ''}` : 'Pick at least one page.';
    m.querySelector('.go').disabled = !keys.length;
    save();
  }
  m.sync = () => {
    const on = new Set(chosenKeys());
    boxes().forEach(b => { b.checked = on.has(b.value); });
    m.querySelectorAll('[data-k]').forEach(el => {
      const k = el.dataset.k;
      if (el.type === 'checkbox') el.checked = !!S[k]; else el.value = S[k];
    });
    sync();
  };
  m.addEventListener('input', e => {
    const k = e.target.dataset.k;
    if (k) S[k] = e.target.type === 'checkbox' ? e.target.checked : (e.target.type === 'range' || k === 'recordFps') ? +e.target.value : e.target.value;
    sync();
  });
  m.addEventListener('click', e => {
    const q = e.target.closest('[data-q]'), act = e.target.closest('[data-act]'), con = e.target.closest('.con-h');
    if (e.target === m) closeMenu();
    if (con) { const bs = Array.from(con.parentElement.querySelectorAll('input:not(:disabled)')); const all = bs.every(b => b.checked); bs.forEach(b => { b.checked = !all; }); sync(); }
    if (q) {
      const v = q.dataset.q, pages = Object.fromEntries(allPages().map(p => [p.key, p]));
      const def = new Set(defaultKeys());
      boxes().forEach(b => {
        const p = pages[b.value];
        if (b.disabled) { b.checked = false; return; }
        b.checked = v === 'none' ? false : v === 'ready' ? p.state === 'ready' : v === 'everything' ? p.state !== 'no'
          : v.startsWith('region:') ? p.state === 'ready' && p.region === v.slice(7) : def.has(p.key);
      });
      sync();
    }
    if (act && act.dataset.act === 'close') closeMenu();
    if (act && act.dataset.act === 'start') { closeMenu(); startSaver(); }
  });
  return m;
}
function openMenu() {
  if (!menu) menu = buildMenu();
  menu.sync(); menu.hidden = false;
  const go = menu.querySelector('.go'); if (go) go.focus();
}
function closeMenu() { if (menu) menu.hidden = true; }

// ── run ────────────────────────────────────────────────────────────────────
function el(id, tag) {
  let e = document.getElementById(id);
  if (!e) { e = document.createElement(tag || 'div'); e.id = id; document.body.appendChild(e); }
  return e;
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

async function startSaver() {
  const keys = chosenKeys();
  if (!keys.length || run) return;
  const order = S.order === 'shuffle' ? shuffle(keys.slice()) : keys;
  run = {
    order, i: -1, timer: 0, paused: false, left: 0, started: 0,
    back: window.activeTab || null, rec: null, frameWin: null, lock: null, token: 0,
    onFrameLoad: () => {},
  };
  const cover = el('sn-saver-cover');
  cover.style.setProperty('--fade', S.fade + 's');
  cover.classList.add('on');
  document.body.classList.add('sn-saver-on');
  document.body.classList.toggle('sn-saver-nocursor', !!S.hideCursor);
  el('sn-saver-hud').hidden = true;
  if (S.display === 'screen' && !fsElement()) {
    const de = document.documentElement, rq = de.requestFullscreen || de.webkitRequestFullscreen;
    if (rq) Promise.resolve(rq.call(de)).catch(() => {});
  }
  if (S.wakeLock && navigator.wakeLock) navigator.wakeLock.request('screen').then(l => { if (run) run.lock = l; else l.release(); }).catch(() => {});
  if (S.exitOnInput) setTimeout(() => { if (run) { run.moveArm = true; } }, 1500);
  document.addEventListener('fullscreenchange', onFullscreen);
  document.addEventListener('webkitfullscreenchange', onFullscreen);
  next(1);
}
// Leaving full screen (Esc in the browser) stops the run.
function fsElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
function onFullscreen() { if (run && S.display === 'screen' && !fsElement()) stopSaver(); }

function next(step) {
  if (!run) return;
  let i = run.i + step;
  if (i >= run.order.length) { if (!S.loop) { stopSaver(); return; } i = 0; if (S.order === 'shuffle') shuffle(run.order); }
  if (i < 0) i = run.order.length - 1;
  run.i = i;
  showPage(run.order[i]);
}

// Fade out, swap the page, wait for its load, enter saver mode, fade in.
async function showPage(key) {
  const r = run, token = ++r.token;
  clearTimeout(r.timer);
  await finishRecording(r);
  const cover = el('sn-saver-cover'), cap = el('sn-saver-cap');
  cap.classList.remove('on');
  cover.classList.add('on');
  await wait(S.fade * 1000);
  if (run !== r || token !== r.token) return;
  const loaded = new Promise(res => { r.onFrameLoad = (f, w) => res(w); setTimeout(() => res(null), LOAD_WAIT_MS); });
  window.switchTab(key, '', 'replace');
  const w = await loaded;
  if (run !== r || token !== r.token) return;
  if (!w) { hud(`${key}: no load, skipped`); next(1); return; }
  r.frameWin = w;
  if (S.exitOnInput) armInput(w);
  const got = await enterPage(w, key);
  if (run !== r || token !== r.token) return;
  const page = allPages().find(p => p.key === key) || { label: key, con: '', color: '#7f91ad' };
  cap.innerHTML = `<i>${esc(page.con)}</i><b>${esc(page.label)}</b>`;
  cap.style.setProperty('--c', page.color);
  cover.classList.remove('on');
  if (S.caption) { setTimeout(() => { if (run === r && token === r.token) cap.classList.add('on'); }, S.fade * 1000 + 400); setTimeout(() => cap.classList.remove('on'), S.fade * 1000 + 6500); }
  hud(`${r.i + 1}/${r.order.length} ${page.label} · ${got.mode}${got.canvas ? '' : ' · no canvas'}`);
  if (S.record && got.canvas) startRecording(r, key, got.canvas, Math.max(S.recordWarmup * 1000, got.warmupMs || 0), token);
  r.left = S.seconds * 1000; r.started = performance.now();
  r.timer = setTimeout(() => next(1), r.left);
}

function wait(ms) { return new Promise(res => setTimeout(res, ms)); }

// The page hook, or the generic mode when the page has none.
async function enterPage(w, key) {
  const t0 = performance.now(), info = CAT.pages[key] || {};
  const limit = info.hook ? HOOK_WAIT_MS : NO_HOOK_WAIT_MS;
  while (!w.snSaver && performance.now() - t0 < limit) await wait(100);
  const opts = { calm: S.calm, seconds: S.seconds, caption: S.caption, seed: (Math.random() * 1e9) | 0 };
  if (w.snSaver && typeof w.snSaver.enter === 'function') {
    try {
      const res = (await w.snSaver.enter(opts)) || {};
      return { mode: 'hook', canvas: res.canvas || largestCanvas(w.document), warmupMs: res.warmupMs || 0 };
    } catch (e) { console.warn('[screensaver] hook failed, generic mode', e); }
  }
  return { mode: 'generic', canvas: genericMode(w), warmupMs: 0 };
}

function largestCanvas(doc) {
  let best = null, area = 0;
  doc.querySelectorAll('canvas').forEach(c => {
    const b = c.getBoundingClientRect();
    const a = b.width * b.height;
    const st = doc.defaultView.getComputedStyle(c);
    if (st.display === 'none' || st.visibility === 'hidden' || +st.opacity === 0) return;
    if (a > area) { area = a; best = c; }
  });
  return best;
}

function genericMode(w) {
  const doc = w.document, c = largestCanvas(doc);
  const st = doc.createElement('style');
  st.id = 'sn-saver-style';
  st.textContent = `
html.sn-saver, html.sn-saver body { background: #000 !important; overflow: hidden !important; cursor: none !important; }
html.sn-saver body * { visibility: hidden !important; pointer-events: none !important; }
html.sn-saver canvas.sn-saver-canvas { visibility: visible !important; position: fixed !important; inset: 0 !important;
  width: 100vw !important; height: 100vh !important; max-width: none !important; max-height: none !important;
  margin: 0 !important; transform: none !important; z-index: 2147483647 !important; }`;
  doc.head.appendChild(st);
  doc.documentElement.classList.add('sn-saver');
  if (c) c.classList.add('sn-saver-canvas');
  w.dispatchEvent(new w.Event('resize'));
  return c;
}

// Stop the run when a key or a real mouse move happens in the frame.
function armInput(w) {
  let x = null, y = null;
  w.addEventListener('mousemove', e => {
    if (!run || !run.moveArm) return;
    if (x === null) { x = e.clientX; y = e.clientY; return; }
    if (Math.abs(e.clientX - x) + Math.abs(e.clientY - y) > 12) stopSaver();
  });
  w.addEventListener('mousedown', () => { if (run && run.moveArm) stopSaver(); });
}
window.addEventListener('mousemove', e => {
  if (!run || !S.exitOnInput || !run.moveArm) return;
  if (run.mx === undefined) { run.mx = e.clientX; run.my = e.clientY; return; }
  if (Math.abs(e.clientX - run.mx) + Math.abs(e.clientY - run.my) > 12) stopSaver();
});

function runKey(e) {
  if (isCombo(e)) return;
  if (S.exitOnInput && !['Shift', 'Meta', 'Alt', 'Control'].includes(e.key)) { e.preventDefault(); stopSaver(); return; }
  const k = e.key;
  if (k === 'Escape') { e.preventDefault(); stopSaver(); }
  else if (k === 'ArrowRight') { e.preventDefault(); next(1); }
  else if (k === 'ArrowLeft') { e.preventDefault(); next(-1); }
  else if (k === ' ') { e.preventDefault(); togglePause(); }
  else if (k === 'h' || k === 'H') { const h = el('sn-saver-hud'); h.hidden = !h.hidden; }
}
function togglePause() {
  const r = run; if (!r) return;
  if (r.paused) { r.paused = false; r.started = performance.now(); r.timer = setTimeout(() => next(1), r.left); hud('playing'); }
  else { r.paused = true; clearTimeout(r.timer); r.left -= performance.now() - r.started; hud(`paused · ${Math.round(r.left / 1000)} s left`); }
}
function hud(t) { const h = el('sn-saver-hud'); h.textContent = t; }

async function stopSaver() {
  const r = run; if (!r) return;
  run = null;
  clearTimeout(r.timer);
  await finishRecording(r);
  try { const w = r.frameWin; if (w && w.snSaver && w.snSaver.exit) w.snSaver.exit(); } catch (e) {}
  if (r.lock) r.lock.release().catch(() => {});
  document.removeEventListener('fullscreenchange', onFullscreen);
  document.removeEventListener('webkitfullscreenchange', onFullscreen);
  const ex = document.exitFullscreen || document.webkitExitFullscreen;
  if (fsElement() && ex) Promise.resolve(ex.call(document)).catch(() => {});
  document.body.classList.remove('sn-saver-on', 'sn-saver-nocursor');
  el('sn-saver-cap').classList.remove('on');
  el('sn-saver-hud').hidden = true;
  // Reload the page the run stopped on, so the page GUI comes back.
  const key = r.order[r.i] || r.back || 'home';
  window.switchTab(key, '', 'replace');
  setTimeout(() => el('sn-saver-cover').classList.remove('on'), 300);
}

// ── recorder ───────────────────────────────────────────────────────────────
// One file per page. The recording starts after the warmup and stops when
// the page fades out, so a file holds no black frames.
function startRecording(r, key, canvas, warmup, token) {
  const type = recFormat();
  if (!type || !canvas.captureStream) { hud('recording is not possible here'); return; }
  setTimeout(() => {
    if (run !== r || token !== r.token || r.rec) return;
    let stream;
    try { stream = canvas.captureStream(S.recordFps); } catch (e) { hud(`${key}: capture failed`); return; }
    const chunks = [];
    const mr = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: S.recordMbps * 1e6 });
    mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    const done = new Promise(res => { mr.onstop = res; });
    mr.start(1000);
    r.rec = { mr, chunks, done, key, type, stream };
  }, warmup);
}
async function finishRecording(r) {
  const rec = r && r.rec; if (!rec) return;
  r.rec = null;
  try { rec.mr.stop(); } catch (e) {}
  await Promise.race([rec.done, wait(3000)]);
  rec.stream.getTracks().forEach(t => t.stop());
  if (!rec.chunks.length) return;
  const blob = new Blob(rec.chunks, { type: rec.type.split(';')[0] });
  const ext = rec.type.startsWith('video/mp4') ? 'mp4' : 'webm';
  const d = new Date(), p2 = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `stella-nova-${rec.key}-${stamp}.${ext}`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

window.snScreensaver = { open: openMenu, start: startSaver, stop: stopSaver, settings: () => Object.assign({}, S), pages: allPages, get running() { return !!run; } };
})();
