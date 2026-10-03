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
//    snSaver.enter(opts)  opts = { calm, seconds, caption, seed, label,
//                         labels }. labels is the menu's "Show labels and
//                         equations" setting, for a page that draws its
//                         own labels into the canvas (so recordings keep
//                         them).
//                         calm is 0..1 (1 is slowest). The page hides its
//                         own GUI, sets a preset and starts its autopilot.
//                         It can return (or resolve to) { canvas, warmupMs }.
//    opts.label(info)     the page names what is on screen. info =
//                         { title, sub, lines: [..], eq: [..] }, plain text
//                         (Unicode maths, no KaTeX). Call it again when the
//                         subject changes (a new title fades to the new
//                         plate; the same title swaps the text in place, for
//                         live values); label(null) clears it. The shell
//                         draws it as a centred specimen poster (title,
//                         rule, parameters; equations, code and the site
//                         mark at the base). The poster is DOM, so a
//                         recording does not hold it.
//                         Fields: see "label plate (poster)" below.
//    snSaver.exit()       optional. The controller calls it when the user
//                         stops the screensaver on that page.
//  A page with no snSaver gets the generic mode: class sn-saver on <html>,
//  the largest visible canvas pinned full-frame, all other content hidden.
//  lib/screensaver-catalog.js holds the tier of each page (how much work its
//  hook needs) and the default list.
//
//  Keys while it plays: Esc stops, Right and Left go to the next and the
//  previous page, Space pauses the timer, H shows the status line.
//  A double-click or a double tap goes to the next page ("function onTap").
//  On a touch screen, a single tap stops it. A single mouse click does not
//  stop it: on a desktop only Esc does, unless the "Stop on any key or
//  mouse move" setting is on.
//
//  grep -n targets
//    settings + storage ... "const DEFAULTS"
//    key combination ...... "function isCombo"
//    menu markup .......... "function buildMenu"
//    play loop ............ "function showPage"
//    page hook / generic .. "function enterPage"
//    recorder ............. "function startRecording"
//    poster ............... "function posterHTML"
//    leader line .......... "function drawLeader"
//    stop ................. "function stopSaver"
// ============================================================================
(function () {
'use strict';
if (window.snScreensaver) return;
// This script's own URL (lib/screensaver.js): plate fonts and sci-math
// resolve against it, not against the page that loaded the script.
const SELF = (document.currentScript && document.currentScript.src) || new URL('lib/screensaver.js', document.baseURI).href;

const CAT = window.SN_SAVER_CATALOG || { pages: {}, tiers: {} };
// v2: shuffle became the default; a new key drops older saved choices.
const STORE = 'sn-saver-settings-v2';
// How long a page has to define window.snSaver. A page that the catalog
// marks hook: true gets the long wait (a module with a CDN import can take
// seconds under load). Other pages go to the generic mode soon.
const HOOK_WAIT_MS = 8000, NO_HOOK_WAIT_MS = 800;
const LOAD_WAIT_MS = 30000;  // a page that never loads is skipped after this
                             // (a page with CDN scripts took 18-24 s under load)

const DEFAULTS = {
  pages: null,          // null = the catalog default list
  seconds: 60,          // time on each page
  order: 'shuffle',     // 'shuffle' | 'nav'
  loop: true,           // false = play the list once, then stop
  fade: 1.2,            // fade to black between pages, seconds
  calm: 0.7,            // passed to page hooks; 1 = slowest
  caption: true,        // page name at the lower left for a few seconds
  labels: true,         // the page's own label plate (names, equations)
  display: 'screen',   // 'screen' = browser full screen | 'window' = fill the browser window
  frame: 'fill',        // 'fill' = the whole display | 'vertical' = a centred 9:16 column, for short video
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
// S.pages is a snapshot of the ticked boxes. A page that becomes a default
// after that snapshot is not in it, so add each default that the snapshot
// did not know (S.seenDefaults). A default that the user unticked stays off.
function chosenKeys() {
  const known = new Set(allPages().filter(p => p.state !== 'no').map(p => p.key));
  const defs = defaultKeys();
  let keys = S.pages || defs;
  if (S.pages) {
    const seen = new Set(S.seenDefaults || []);
    keys = keys.concat(defs.filter(k => !seen.has(k) && !keys.includes(k)));
  }
  return keys.filter(k => known.has(k));
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
// Two presses within DOUBLE_MS and 40 px (screen coordinates, so a press in
// the shell and one in the page frame compare) go to the next page. A single
// touch or pen tap stops the run and returns to the site, but only after
// DOUBLE_MS with no second tap. A single mouse click does nothing. The first
// 700 ms after start are ignored, so the tap on Start does not count.
const DOUBLE_MS = 320;
let tapPrev = null, tapTimer = 0;
function onTap(e) {
  if (!run || performance.now() - run.t0 < 700) return;
  const now = performance.now(), touch = e.pointerType !== 'mouse';
  if (touch) { e.preventDefault(); e.stopPropagation(); }
  const p = tapPrev;
  if (p && now - p.t < DOUBLE_MS && Math.hypot(e.screenX - p.x, e.screenY - p.y) < 40) {
    tapPrev = null; clearTimeout(tapTimer);
    next(1);
    return;
  }
  tapPrev = { t: now, x: e.screenX, y: e.screenY };
  clearTimeout(tapTimer);
  if (touch) tapTimer = setTimeout(() => { if (tapPrev && tapPrev.t === now) { tapPrev = null; stopSaver(); } }, DOUBLE_MS);
}
window.addEventListener('pointerdown', onTap, true);

// Keys pressed inside the page iframe do not reach the shell. Listen in each
// new frame too (same origin), and stop the run on input there if asked.
function hookFrame(f) {
  f.addEventListener('load', () => {
    let w; try { w = f.contentWindow; if (!w || w.location.href === 'about:blank') return; } catch (e) { return; }
    w.addEventListener('keydown', onKey, true);
    w.addEventListener('pointerdown', onTap, true);
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
#sn-saver-cap { position: fixed; left: 40px; bottom: 34px; z-index: 9001; pointer-events: none; font-family: 'Inter', var(--f-sans, system-ui), sans-serif; color: #eef3fb; opacity: 0; transition: opacity 1.6s ease; text-shadow: 0 1px 12px rgba(0,0,0,.8); }
#sn-saver-cap.on { opacity: .85; }
#sn-saver-cap b { display: block; font: 400 1.6rem/1.2 'STIX Two Text', Georgia, serif; }
#sn-saver-cap i { display: block; font: 400 .8rem/1.6 'Inter', system-ui, sans-serif; font-style: normal; color: var(--c, #7f91ad); }
#sn-saver-label { --fw: 100vw; --fs: min(var(--fw), 80vh); position: fixed; top: 0; bottom: 0; left: 50%; width: var(--fw); transform: translateX(-50%); z-index: 9001; pointer-events: none; box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between; align-items: center; text-align: center; padding: max(clamp(22px, calc(var(--fs) * .075), 96px), calc(env(safe-area-inset-top, 0px) + 14px)) max(clamp(16px, calc(var(--fs) * .06), 80px), calc(env(safe-area-inset-right, 0px) + 12px)) max(clamp(18px, calc(var(--fs) * .05), 64px), calc(env(safe-area-inset-bottom, 0px) + 14px)) max(clamp(16px, calc(var(--fs) * .06), 80px), calc(env(safe-area-inset-left, 0px) + 12px)); background: linear-gradient(to bottom, rgba(0,0,0,.62) 0, rgba(0,0,0,.25) 18%, transparent 30%, transparent 48%, rgba(0,0,0,.42) 66%, rgba(0,0,0,.78) 100%); color: #f1ede4; font: 400 16px/1.4 'STIX Two Text', Georgia, serif; text-shadow: 0 1px 14px rgba(0,0,0,.85); opacity: 0; transition: opacity 1s ease; }
body.sn-saver-vert #sn-saver-label { --fw: min(100vw, 56.25vh); }
#sn-saver-label.on { opacity: 1; }
#sn-saver-label .top, #sn-saver-label .bot { width: 100%; display: flex; flex-direction: column; align-items: center; }
#sn-saver-label .cat { font: 500 clamp(9px, calc(var(--fs) * .017), 14px)/1 'Inter', system-ui, sans-serif; letter-spacing: .34em; text-transform: uppercase; color: var(--c, #8ec5ff); margin: 0 0 1.1em; padding-left: .34em; }
#sn-saver-label .ttl { display: block; max-width: 30ch; font: 400 clamp(28px, calc(var(--fs) * .082), 84px)/1.04 'STIX Two Text', Georgia, serif; color: #f8f5ee; text-wrap: balance; }
#sn-saver-label .rule { display: block; width: min(78%, 560px); height: 1px; margin: .95em 0 .85em; font-size: clamp(14px, calc(var(--fs) * .03), 26px); background: linear-gradient(90deg, transparent, rgba(244,240,230,.92) 16%, rgba(244,240,230,.92) 84%, transparent); transform: scaleX(0); transition: transform 1.7s cubic-bezier(.22,.7,.12,1) .35s; }
#sn-saver-label.on .rule { transform: scaleX(1); }
#sn-saver-label .sub { max-width: 30em; font: italic 400 clamp(14px, calc(var(--fs) * .032), 28px)/1.3 'STIX Two Text', Georgia, serif; color: #e2ddd1; text-wrap: balance; }
#sn-saver-label .pp { display: flex; flex-wrap: wrap; justify-content: center; gap: .7em 1.5em; max-width: 34em; margin-top: 1em; font-size: clamp(13px, calc(var(--fs) * .026), 21px); }
#sn-saver-label .p { display: inline-flex; flex-direction: column; align-items: center; }
#sn-saver-label .p .v { font-style: italic; font-variant-numeric: tabular-nums; white-space: nowrap; color: #f4f1ea; }
#sn-saver-label .p .v .sym { display: inline-block; font-style: italic; }
#sn-saver-label .p .v .sym svg { vertical-align: -.2em; }
#sn-saver-label .p small { margin-top: .3em; font: 400 .56em/1.2 'Inter', system-ui, sans-serif; letter-spacing: .16em; text-transform: uppercase; color: #a4acb8; text-shadow: none; }
#sn-saver-label .eqs { display: grid; gap: .6em; justify-items: center; max-width: 100%; margin-top: 1em; font-size: clamp(14px, calc(var(--fs) * .03), 25px); color: #f4f1ea; }
#sn-saver-label .eq { max-width: 100%; line-height: 0; overflow: hidden; }
#sn-saver-label .eq svg { max-width: 100%; height: auto; overflow: visible; }
#sn-saver-label .eq.raw { line-height: 1.35; font-style: italic; white-space: pre-wrap; }
#sn-saver-label .notes { max-width: 32em; margin-top: .9em; font: italic 400 clamp(12px, calc(var(--fs) * .024), 19px)/1.4 'STIX Two Text', Georgia, serif; color: #cfc9bc; }
#sn-saver-label .notes p { margin: 0; } #sn-saver-label .notes p + p { margin-top: .25em; }
#sn-saver-label .code { max-width: 100%; margin-top: 1.1em; box-sizing: border-box; text-align: left; font: 400 clamp(8.5px, calc(var(--fs) * .0185), 14px)/1.55 'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace; font-variant-ligatures: none; color: #cdd5df; background: rgba(5,7,11,.7); border: 1px solid rgba(255,255,255,.09); border-radius: 6px; padding: .85em 1.1em .95em; text-shadow: none; overflow: hidden; }
#sn-saver-label .code header { margin-bottom: .7em; font: 500 .8em/1 'Inter', system-ui, sans-serif; letter-spacing: .24em; text-transform: uppercase; color: var(--c, #8ec5ff); }
#sn-saver-label .code header i { font-style: normal; color: #7d8794; letter-spacing: .12em; text-transform: none; margin-left: .8em; }
#sn-saver-label .code pre { margin: 0; font: inherit; white-space: pre; overflow: hidden; }
#sn-saver-label .code.cut pre { -webkit-mask-image: linear-gradient(90deg, #000 88%, transparent); mask-image: linear-gradient(90deg, #000 88%, transparent); }
#sn-saver-label .code .tk-kw { color: #c9a8ff; } #sn-saver-label .code .tk-ty { color: #6cc8ff; } #sn-saver-label .code .tk-bi { color: #5fd4c4; }
#sn-saver-label .code .tk-fn { color: #8ee08a; } #sn-saver-label .code .tk-num, #sn-saver-label .code .tk-con { color: #ffd27a; } #sn-saver-label .code .tk-st { color: #f0a36b; }
#sn-saver-label .code .tk-at, #sn-saver-label .code .tk-pp { color: #ff9f72; } #sn-saver-label .code .tk-sw { color: #a9c1ff; } #sn-saver-label .code .tk-op { color: #9aa4b2; }
#sn-saver-label .code .tk-cm { color: #6b7685; }
/* The site mark sits in a rule as wide as the title rule: line, boxed mark,
   line. The box border is the line colour, so the two lines and the box
   read as one stroke. The lines draw outward from the box. */
#sn-saver-label .mark { display: flex; align-items: center; width: min(78%, 560px); margin-top: 1.15em; font-size: clamp(13px, calc(var(--fs) * .03), 24px); }
#sn-saver-label .mark .ln { flex: 1; height: 1px; background: rgba(244,240,230,.85); transform: scaleX(0); transition: transform 1.5s cubic-bezier(.22,.7,.12,1) 1.1s; }
#sn-saver-label .mark .ln.l { transform-origin: 100% 50%; } #sn-saver-label .mark .ln.r { transform-origin: 0 50%; }
#sn-saver-label.on .mark .ln { transform: scaleX(1); }
#sn-saver-label .logo { flex: none; font: 500 1em/1 'STIX Two Text', Georgia, serif; letter-spacing: .24em; color: #f6f1e6; white-space: nowrap; padding: .5em .5em .5em .74em; border: 1px solid rgba(244,240,230,.85); background: rgba(5,7,11,.58); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); opacity: 0; transition: opacity 1.2s ease .6s; }
#sn-saver-label.on .logo { opacity: 1; }
#sn-saver-label .logo span { color: var(--c, #8ec5ff); letter-spacing: 0; padding: 0 .35em; }
#sn-saver-label .m1 { color: #62c4ff; fill: #62c4ff; } #sn-saver-label .m2 { color: #ff9a62; fill: #ff9a62; } #sn-saver-label .m3 { color: #86dc7c; fill: #86dc7c; }
#sn-saver-label .m4 { color: #e889dc; fill: #e889dc; } #sn-saver-label .m5 { color: #ffd666; fill: #ffd666; } #sn-saver-label .m6 { color: #a8a4ff; fill: #a8a4ff; }
#sn-saver-lead { position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: 9000; pointer-events: none; opacity: 0; transition: opacity 1.2s ease .8s; }
#sn-saver-lead.on { opacity: .85; }
#sn-saver-lead line { stroke: rgba(244,240,230,.8); stroke-width: 1; }
#sn-saver-lead circle { fill: none; stroke: rgba(244,240,230,.85); stroke-width: 1.2; }
#sn-saver-lead circle.dot { fill: rgba(244,240,230,.9); stroke: none; }
body.sn-saver-on.sn-saver-vert #shell { justify-content: center; background: #000; }
body.sn-saver-on.sn-saver-vert #content { flex: 0 0 auto; width: min(100vw, 56.25vh); }
body.sn-saver-on.sn-saver-vert #sn-saver-cap { left: calc(50% - min(50vw, 28.125vh) + 24px); }
#sn-saver-label .slot-bot { display: flex; flex-direction: column; align-items: center; max-width: 100%; }
#sn-saver-label .col { display: flex; flex-direction: column; align-items: center; max-width: 100%; }
/* Landscape frame. .slot-bot takes the full width: as a shrink-to-fit item
   its 48% columns resolved against its own content and came out a few
   hundred px wide, so the TeX scaled down and the notes wrapped. The
   equations then set out in a row, larger, and wrap when they must. */
@media (min-aspect-ratio: 5/4) {
  body:not(.sn-saver-vert) #sn-saver-label .slot-bot { width: 100%; flex-direction: row; align-items: flex-end; justify-content: center; gap: 3.5em; }
  body:not(.sn-saver-vert) #sn-saver-label .slot-bot .col { max-width: 92%; }
  body:not(.sn-saver-vert) #sn-saver-label .slot-bot:has(.code) .col { max-width: 52%; }
  body:not(.sn-saver-vert) #sn-saver-label .slot-bot .code { margin-top: 0; max-width: 44%; }
  body:not(.sn-saver-vert) #sn-saver-label .eqs { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: .7em 2.4em; font-size: clamp(16px, calc(var(--fs) * .036), 30px); }
  body:not(.sn-saver-vert) #sn-saver-label .notes { max-width: 46em; }
}
@media (max-width: 760px), (max-height: 520px) {
  #sn-saver-label .code { display: none; }
  #sn-saver-label { background: linear-gradient(to bottom, rgba(0,0,0,.7) 0, rgba(0,0,0,.45) 26%, transparent 40%, transparent 58%, rgba(0,0,0,.5) 72%, rgba(0,0,0,.82) 100%); }
  #sn-saver-cap { left: 16px; bottom: 16px; }
}
#sn-saver-hud { position: fixed; right: 18px; top: 14px; z-index: 9001; font: 500 .7rem/1.4 var(--f-mono, monospace); color: #9fb3d1; background: rgba(8,10,16,.7); border: 1px solid rgba(150,200,255,.18); border-radius: 8px; padding: 6px 10px; pointer-events: none; }
#sn-saver-hud[hidden] { display: none; }
#sn-saver-menu { position: fixed; inset: 0; z-index: 9500; display: grid; place-items: center; background: rgba(3,5,9,.66); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
#sn-saver-menu[hidden] { display: none; }
#sn-saver-menu .box { width: min(1040px, calc(100vw - 32px)); height: min(720px, calc(100vh - 48px)); display: grid; grid-template-rows: auto 1fr auto; background: #0c0f15; border: 1px solid rgba(255,255,255,.08); border-radius: 14px; box-shadow: 0 24px 70px rgba(0,0,0,.55); color: #c9d2df; font: 400 14px/1.45 var(--f-sans, Inter, system-ui, sans-serif); overflow: hidden; }
#sn-saver-menu button { font: inherit; color: inherit; cursor: pointer; background: none; border: 0; }
#sn-saver-menu header { display: flex; align-items: baseline; gap: 16px; padding: 20px 24px 14px; }
#sn-saver-menu header h2 { font-size: 1.2rem; font-weight: 600; color: #f1f4f8; margin: 0; }
#sn-saver-menu header p { margin: 0; font-size: .8rem; color: #7d8898; }
#sn-saver-menu kbd { font: 500 .75rem/1 var(--f-sans, system-ui); padding: 2px 5px; border-radius: 4px; border: 1px solid rgba(255,255,255,.14); color: #c9d2df; }
#sn-saver-menu .cols { display: grid; grid-template-columns: 1fr 320px; min-height: 0; border-top: 1px solid rgba(255,255,255,.07); }
#sn-saver-menu .pages { display: grid; grid-template-rows: auto 1fr; min-height: 0; border-right: 1px solid rgba(255,255,255,.07); }
#sn-saver-menu .bar { display: flex; align-items: center; gap: 4px; padding: 0 16px; border-bottom: 1px solid rgba(255,255,255,.07); }
#sn-saver-menu .tab { padding: 12px 10px 11px; color: #8591a3; border-bottom: 2px solid transparent; margin-bottom: -1px; font-weight: 500; }
#sn-saver-menu .tab:hover { color: #dfe5ee; }
#sn-saver-menu .tab.on { color: #f1f4f8; border-bottom-color: #8ec5ff; }
#sn-saver-menu .tab small, #sn-saver-menu .card-h small { font-size: .75rem; color: #6c7788; font-variant-numeric: tabular-nums; margin-left: 6px; font-weight: 400; }
#sn-saver-menu .quick { margin-left: auto; display: flex; gap: 2px; }
#sn-saver-menu .quick button { padding: 5px 8px; border-radius: 6px; font-size: .8rem; color: #8591a3; }
#sn-saver-menu .quick button:hover { color: #f1f4f8; background: rgba(255,255,255,.05); }
#sn-saver-menu .panes { overflow: auto; padding: 16px; }
#sn-saver-menu .pane { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; align-items: start; }
#sn-saver-menu .pane[hidden] { display: none; }
#sn-saver-menu .card { border: 1px solid rgba(255,255,255,.07); border-radius: 10px; padding: 4px 4px 6px; background: rgba(255,255,255,.015); }
#sn-saver-menu .card-h { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 8px 6px; font-weight: 600; font-size: .86rem; color: #e6ebf2; text-align: left; border-radius: 6px; }
#sn-saver-menu .card-h:hover { background: rgba(255,255,255,.04); }
#sn-saver-menu .card-h i { width: 8px; height: 8px; border-radius: 50%; background: var(--c); flex: none; }
#sn-saver-menu .card-h small { margin-left: auto; }
#sn-saver-menu label.pg { display: flex; align-items: center; gap: 9px; padding: 5px 8px; border-radius: 6px; font-size: .86rem; cursor: pointer; color: #c9d2df; }
#sn-saver-menu label.pg:hover { background: rgba(255,255,255,.04); }
#sn-saver-menu label.pg span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#sn-saver-menu label.pg em { font-style: normal; font-size: .72rem; color: #6c7788; }
#sn-saver-menu .pg input { appearance: none; -webkit-appearance: none; width: 16px; height: 16px; margin: 0; flex: none; border: 1.5px solid rgba(255,255,255,.28); border-radius: 4px; display: grid; place-items: center; cursor: pointer; }
#sn-saver-menu .pg input:checked { background: #8ec5ff; border-color: #8ec5ff; }
#sn-saver-menu .pg input:checked::after { content: ''; width: 8px; height: 4px; border: 2px solid #0c0f15; border-top: 0; border-right: 0; transform: translateY(-1px) rotate(-45deg); }
#sn-saver-menu .opts { overflow: auto; padding: 6px 20px 20px; }
#sn-saver-menu .opts h3 { font-size: .8rem; font-weight: 600; color: #e6ebf2; margin: 18px 0 10px; }
#sn-saver-menu .row { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 6px 10px; margin: 0 0 12px; font-size: .86rem; }
#sn-saver-menu .row output { color: #8591a3; font-variant-numeric: tabular-nums; font-size: .8rem; }
#sn-saver-menu .row input[type=range] { grid-column: 1 / -1; width: 100%; margin: 0; accent-color: #8ec5ff; }
#sn-saver-menu .seg { grid-column: 1 / -1; display: flex; padding: 2px; border-radius: 8px; background: rgba(255,255,255,.05); }
#sn-saver-menu .seg label { flex: 1; text-align: center; padding: 5px 4px; border-radius: 6px; font-size: .8rem; color: #8591a3; cursor: pointer; }
#sn-saver-menu .seg input { position: absolute; opacity: 0; pointer-events: none; }
#sn-saver-menu .seg label:has(input:checked) { background: #1d2430; color: #f1f4f8; }
#sn-saver-menu .sw { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 0; font-size: .86rem; cursor: pointer; }
#sn-saver-menu .sw input { appearance: none; -webkit-appearance: none; flex: none; width: 30px; height: 18px; margin: 0; border-radius: 9px; background: rgba(255,255,255,.14); position: relative; cursor: pointer; transition: background .15s; }
#sn-saver-menu .sw input::after { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #dfe5ee; transition: transform .15s; }
#sn-saver-menu .sw input:checked { background: #8ec5ff; }
#sn-saver-menu .sw input:checked::after { transform: translateX(12px); background: #0c0f15; }
#sn-saver-menu .rec-opts { margin-top: 8px; }
#sn-saver-menu .rec-opts[hidden], #sn-saver-menu .sw[hidden] { display: none; }
#sn-saver-menu .note { font-size: .76rem; color: #6c7788; line-height: 1.45; margin: 4px 0 0; }
#sn-saver-menu footer { display: flex; align-items: center; gap: 10px; padding: 14px 20px; border-top: 1px solid rgba(255,255,255,.07); }
#sn-saver-menu footer .sum { flex: 1; font-size: .84rem; color: #8591a3; font-variant-numeric: tabular-nums; }
#sn-saver-menu footer .reset { font-size: .8rem; color: #8591a3; padding: 8px 10px; }
#sn-saver-menu footer .reset:hover { color: #f1f4f8; }
#sn-saver-menu .x { padding: 9px 16px; border-radius: 8px; border: 1px solid rgba(255,255,255,.12) !important; }
#sn-saver-menu .go { padding: 9px 22px; border-radius: 8px; background: #8ec5ff !important; color: #0c0f15 !important; font-weight: 600; }
#sn-saver-menu .go:disabled { opacity: .4; cursor: default; }
@media (max-width: 760px) {
  #sn-saver-menu .box { height: calc(100dvh - 24px); }
  #sn-saver-menu .cols { grid-template-columns: 1fr; grid-template-rows: 1fr auto; }
  #sn-saver-menu .pages { border-right: 0; }
  #sn-saver-menu .opts { max-height: 38dvh; border-top: 1px solid rgba(255,255,255,.07); }
  #sn-saver-menu header p { display: none; }
  #sn-saver-menu .bar { overflow-x: auto; }
  #sn-saver-menu .tab { white-space: nowrap; }
}
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
  // Pages: one tab per region, one card per constellation. Pages that cannot
  // play (tier 5) do not show. A page with no hook of its own plays in the
  // generic mode and gets a "Basic" tag.
  const pages = allPages().filter(p => p.state !== 'no');
  const regions = (window.SN_NAV || []).map(r => {
    const cons = [];
    r.constellations.forEach(c => {
      const ps = pages.filter(p => p.region === r.id && p.con === c.label);
      if (ps.length) cons.push({ label: c.label, color: c.color, pages: ps });
    });
    return { id: r.id, label: r.label, cons };
  }).filter(r => r.cons.length);
  if (!regions.some(r => r.id === S.menuTab)) S.menuTab = regions[0] && regions[0].id;
  const tabs = regions.map(r => `<button class="tab" role="tab" data-tab="${r.id}">${esc(r.label)}<small data-tc="${r.id}"></small></button>`).join('');
  const panes = regions.map(r => `<div class="pane" role="tabpanel" data-pane="${r.id}">${r.cons.map(c => `<div class="card" style="--c:${c.color}">
    <button class="card-h" title="Select or clear this group"><i></i>${esc(c.label)}<small></small></button>
    ${c.pages.map(p => `<label class="pg" title="${esc(p.note)}"><input type="checkbox" value="${p.key}"><span>${esc(p.label)}</span>${p.state === 'later' ? '<em title="No screensaver of its own: it plays in the generic mode">Basic</em>' : ''}</label>`).join('')}
  </div>`).join('')}</div>`).join('');
  const seg = (k, opts) => `<div class="seg">${opts.map(([v, t]) => `<label><input type="radio" name="sn-${k}" data-k="${k}" value="${v}">${t}</label>`).join('')}</div>`;
  const sw = (k, t) => `<label class="sw"><span>${t}</span><input type="checkbox" data-k="${k}"></label>`;
  const fmt = recFormat();
  const combo = /Mac/.test(navigator.platform) ? '<kbd>⌘</kbd> <kbd>⌥</kbd> <kbd>S</kbd>' : '<kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>S</kbd>';
  m.innerHTML = `<div class="box">
  <header><h2>Screensaver</h2><p>${combo} opens this menu. <kbd>Esc</kbd> stops the screensaver. Double-click or double tap for the next page. On a touch screen, tap once to stop it.</p></header>
  <div class="cols">
    <div class="pages">
      <div class="bar" role="tablist">${tabs}<div class="quick"><button data-q="default">Defaults</button><button data-q="all">All</button><button data-q="none">None</button></div></div>
      <div class="panes">${panes}</div>
    </div>
    <div class="opts">
      <h3>Playback</h3>
      <div class="row"><span>Time on each page</span><output data-o="seconds"></output><input type="range" data-k="seconds" min="10" max="600" step="5"></div>
      <div class="row"><span>Order</span><span></span>${seg('order', [['nav', 'Site order'], ['shuffle', 'Shuffle']])}</div>
      <div class="row"><span>Fade between pages</span><output data-o="fade"></output><input type="range" data-k="fade" min="0" max="4" step="0.1"></div>
      <div class="row"><span>Calm</span><output data-o="calm"></output><input type="range" data-k="calm" min="0" max="1" step="0.05"></div>
      ${sw('loop', 'Loop the list')}
      <h3>Display</h3>
      <div class="row">${seg('display', [['screen', 'Full screen'], ['window', 'Browser window']])}</div>
      <div class="row"><span>Frame</span><span></span>${seg('frame', [['fill', 'Fill'], ['vertical', '9:16 vertical']])}</div>
      ${sw('caption', 'Show the page name')}
      ${sw('labels', 'Show labels and equations')}
      ${sw('hideCursor', 'Hide the cursor')}
      ${sw('wakeLock', 'Keep the screen awake')}
      ${sw('exitOnInput', 'Stop on any key or mouse move')}
      <h3>Recording</h3>
      ${fmt ? `${sw('record', 'Save each page as a video')}
      <div class="rec-opts">
        <div class="row"><span>Frame rate</span><span></span>${seg('recordFps', [['24', '24 fps'], ['30', '30 fps'], ['60', '60 fps']])}</div>
        <div class="row"><span>Bit rate</span><output data-o="recordMbps"></output><input type="range" data-k="recordMbps" min="2" max="40" step="1"></div>
        <div class="row"><span>Wait before recording</span><output data-o="recordWarmup"></output><input type="range" data-k="recordWarmup" min="0" max="15" step="0.5"></div>
        <p class="note">${esc(fmt.split(';')[0])}${fmt.startsWith('video/mp4') ? '' : ' (this browser cannot record MP4)'}. Files go to the browser download folder. Only the page canvas is recorded, not the poster over it. For a short video with the poster, use the 9:16 frame and a screen recorder.</p>
      </div>` : '<p class="note">This browser cannot record a canvas.</p>'}
    </div>
  </div>
  <footer><span class="sum"></span><button class="reset" data-act="reset">Reset to defaults</button><button class="x" data-act="close">Cancel</button><button class="go" data-act="start">Start</button></footer>
</div>`;
  document.body.appendChild(m);

  const boxes = () => Array.from(m.querySelectorAll('.pg input'));
  const units = { seconds: v => v >= 60 ? `${Math.floor(v / 60)} min${v % 60 ? ' ' + v % 60 + ' s' : ''}` : v + ' s', fade: v => (+v).toFixed(1) + ' s', calm: v => Math.round(v * 100) + '%', recordMbps: v => v + ' Mbit/s', recordWarmup: v => (+v).toFixed(1) + ' s' };
  function showTab() {
    m.querySelectorAll('.tab').forEach(t => { const on = t.dataset.tab === S.menuTab; t.classList.toggle('on', on); t.setAttribute('aria-selected', on); });
    m.querySelectorAll('.pane').forEach(p => { p.hidden = p.dataset.pane !== S.menuTab; });
  }
  function sync() {
    const keys = boxes().filter(b => b.checked).map(b => b.value);
    S.pages = keys;
    S.seenDefaults = defaultKeys();
    m.querySelectorAll('[data-o]').forEach(o => { o.textContent = units[o.dataset.o](S[o.dataset.o]); });
    m.querySelectorAll('.card').forEach(c => {
      const bs = c.querySelectorAll('.pg input');
      c.querySelector('.card-h small').textContent = `${[...bs].filter(b => b.checked).length} / ${bs.length}`;
    });
    m.querySelectorAll('[data-tc]').forEach(t => {
      const bs = m.querySelectorAll(`[data-pane="${t.dataset.tc}"] .pg input`);
      const n = [...bs].filter(b => b.checked).length;
      t.textContent = n ? String(n) : '';
    });
    const rec = m.querySelector('.rec-opts'); if (rec) rec.hidden = !S.record;
    const total = keys.length * S.seconds;
    m.querySelector('.sum').textContent = keys.length ? `${keys.length} pages, about ${Math.max(1, Math.round(total / 60))} min a pass${S.record ? ', recording' : ''}` : 'Select at least one page.';
    m.querySelector('.go').disabled = !keys.length;
    save();
  }
  m.sync = () => {
    const on = new Set(chosenKeys());
    boxes().forEach(b => { b.checked = on.has(b.value); });
    m.querySelectorAll('[data-k]').forEach(el => {
      const k = el.dataset.k;
      if (el.type === 'radio') el.checked = String(S[k]) === el.value;
      else if (el.type === 'checkbox') el.checked = !!S[k];
      else el.value = S[k];
    });
    showTab();
    sync();
  };
  m.addEventListener('input', e => {
    const t = e.target, k = t.dataset.k;
    if (k) S[k] = t.type === 'checkbox' ? t.checked : (t.type === 'range' || k === 'recordFps') ? +t.value : t.value;
    sync();
  });
  m.addEventListener('click', e => {
    const tab = e.target.closest('.tab'), q = e.target.closest('[data-q]'), act = e.target.closest('[data-act]'), head = e.target.closest('.card-h');
    if (e.target === m) closeMenu();
    if (tab) { S.menuTab = tab.dataset.tab; showTab(); save(); }
    if (head) { const bs = Array.from(head.parentElement.querySelectorAll('.pg input')); const all = bs.every(b => b.checked); bs.forEach(b => { b.checked = !all; }); sync(); }
    if (q) {
      // The quick buttons act on the open tab only.
      const def = new Set(defaultKeys());
      m.querySelectorAll(`[data-pane="${S.menuTab}"] .pg input`).forEach(b => {
        b.checked = q.dataset.q === 'all' ? true : q.dataset.q === 'none' ? false : def.has(b.value);
      });
      sync();
    }
    if (act && act.dataset.act === 'reset') {
      const tab = S.menuTab;
      S = Object.assign({}, DEFAULTS, { menuTab: tab });
      m.sync();
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
    order, i: -1, timer: 0, paused: false, left: 0, started: 0, t0: performance.now(),
    back: window.activeTab || null, rec: null, frameWin: null, lock: null, token: 0,
    onFrameLoad: () => {},
  };
  const cover = el('sn-saver-cover');
  cover.style.setProperty('--fade', S.fade + 's');
  cover.classList.add('on');
  document.body.classList.add('sn-saver-on');
  document.body.classList.toggle('sn-saver-nocursor', !!S.hideCursor);
  document.body.classList.toggle('sn-saver-vert', S.frame === 'vertical');
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
  setLabel(null);
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
  const got = await enterPage(w, key, r, token);
  if (run !== r || token !== r.token) return;
  const page = allPages().find(p => p.key === key) || { label: key, con: '', color: '#7f91ad' };
  cap.innerHTML = `<i>${esc(page.con)}</i><b>${esc(page.label)}</b>`;
  cap.style.setProperty('--c', page.color);
  cover.classList.remove('on');
  // The poster names the page, so the caption shows only with labels off.
  r.labeled = r.labeled && r.labelToken === token;
  if (S.labels) fallbackPoster(r, token, page);
  else if (S.caption) { setTimeout(() => { if (run === r && token === r.token) cap.classList.add('on'); }, S.fade * 1000 + 400); setTimeout(() => cap.classList.remove('on'), S.fade * 1000 + 6500); }
  hud(`${r.i + 1}/${r.order.length} ${page.label} · ${got.mode}${got.canvas ? '' : ' · no canvas'}`);
  if (S.record && got.canvas) startRecording(r, key, got.canvas, Math.max(S.recordWarmup * 1000, got.warmupMs || 0), token);
  r.left = S.seconds * 1000; r.started = performance.now();
  r.timer = setTimeout(() => next(1), r.left);
}

function wait(ms) { return new Promise(res => setTimeout(res, ms)); }

// ── label plate (poster) ───────────────────────────────────────────────────
// The page names what is on screen with opts.label(info). Fields:
//   title, sub            the common name, and the formal line under it
//   params                [{ sym, name, value, cls }]: sym is TeX (typeset
//                         inline), cls one of m1..m6, value plain text
//   lines                 short plain notes
//   tex, rules            TeX equations, typeset as MathJax SVG through
//                         lib/sci-math.js, coloured by rules [[sym, 'mN']]
//   eq                    plain Unicode equations: the fallback when no tex
//   code                  a short source extract: a string, or { lang, name,
//                         text }, or a list of them (the first shows). The
//                         poster shows at most CODE_LINES lines.
//   anchor                { x, y, r | w h, pts?, lead? } in page CSS px, or a function
//                         that returns it each frame: the subject on
//                         screen; pts are key points (nuclei, a gear
//                         centre): the leader goes to the nearest one
// The plate is a specimen poster across the frame, all text centred. Type
// scales with --fs: the frame width, capped at 80vh for a landscape frame.
//   top     catalogue line (number, constellation), title, a rule that draws
//           from the centre, sub in italics, then the site mark
//           [ www.davesgames.io ] boxed inside a second full rule
//   bottom  equations, then the parameters, then notes and code
// Code always goes last. In a landscape frame (wider than 5:4, not
// the 9:16 column) the bottom text and the code sit side by side. A page
// with no label gets a poster with its nav name only (see "function
// fallbackPoster"). The padding keeps clear of the safe-area insets (a
// phone notch or home bar) when the browser reports them.
// Pointer: a leader line goes from the poster block nearer to the subject
// (top or bottom, at its centre line) to a part of the subject, and a ring
// marks the end. The poster does not move; only the line follows.
// The leader names a part, never the whole subject: the title already
// names the whole. So it draws only when the anchor has a key point away
// from the subject centre (more than 15% of r, or 24 px). A plain circle
// or box, or one key point at the centre (explosion: the fireball), gets
// no leader. anchor.lead true or false overrides this test.
const CODE_LINES = 12;
let labelTimer = 0, plate = null, plateRAF = 0;
const texCache = new Map();
let sciMath = null;
function loadSciMath() {
  if (!sciMath) sciMath = import(new URL('sci-math.js', SELF).href).catch(() => null);
  return sciMath;
}
function plateFonts() {
  if (document.getElementById('sn-plate-fonts')) return;
  const l = document.createElement('link');
  l.id = 'sn-plate-fonts'; l.rel = 'stylesheet';
  // This file has the STIX Two Text italic faces and IBM Plex Mono (code).
  l.href = new URL('../vendor/fonts/stix-two-text+inter+ibm-plex-mono.c233e746.css', SELF).href;
  document.head.appendChild(l);   // appended at run time, so it does not block the shell
}
const arrOf = v => (Array.isArray(v) ? v : v ? [v] : []);
// Code and pseudocode are coloured by lib/code-highlight.js (an ES module,
// loaded once). Until it loads, a listing shows as plain escaped text, and
// fillCode colours it when the module arrives. After that, codeHTML colours
// at once, so a live label swap does not flash plain text.
let codeHL = null, codeHLP = null;
function loadCodeHL() {
  if (!codeHLP) codeHLP = import(new URL('code-highlight.js', SELF).href).then(M => (codeHL = M)).catch(() => null);
  return codeHLP;
}
function codeHTML(src, lang) { return codeHL ? codeHL.highlight(src, lang) : esc(src); }
function fillCode(box) {
  fitCode(box);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitCode(box));
  if (codeHL) return;
  loadCodeHL().then(M => {
    if (!M) return;
    box.querySelectorAll('pre[data-lang]').forEach(n => { n.innerHTML = M.highlight(n.textContent, n.dataset.lang); });
  });
}
// Shrink a listing until its longest line fits the box, to 72% at most.
// A line still too long then ends in the fade (.code.cut).
function fitCode(box) {
  box.querySelectorAll('.code').forEach(c => {
    const pre = c.querySelector('pre'); if (!pre) return;
    pre.style.fontSize = '';
    const k = pre.clientWidth / Math.max(1, pre.scrollWidth);
    if (k < 1) pre.style.fontSize = Math.max(0.72, k * 0.99).toFixed(3) + 'em';
    c.classList.toggle('cut', pre.scrollWidth > pre.clientWidth + 1);
  });
}
// One listing box: a header (language, then the name) and the lines.
function listing(label, name, lang, lines) {
  const ind = Math.min(...lines.filter(l => l.trim()).map(l => l.match(/^ */)[0].length));
  const body = lines.map(l => l.slice(ind)).slice(0, CODE_LINES);
  if (lines.length > CODE_LINES) body.push('…');
  return `<div class="code"><header>${esc(label)}${name ? `<i>${esc(name)}</i>` : ''}</header><pre data-lang="${esc(lang)}">${codeHTML(body.join('\n'), lang)}</pre></div>`;
}
function codeBlock(info) {
  let c = arrOf(info.code)[0];
  if (!c) return '';
  if (typeof c === 'string') c = { text: c };
  const lines = String(c.text || '').replace(/\t/g, '  ').replace(/^\n+|\s+$/g, '').split('\n');
  const label = c.lang || 'shader';
  return listing(label, c.name, c.lang || c.name || 'pseudo', lines);
}
// The two text slots. top: parameters (or, with none, equations and notes).
// bottom: equations and notes when the top has parameters, then code.
function posterSlots(info) {
  const params = arrOf(info.params).map(p => Array.isArray(p) ? { sym: p[0], value: p[1], name: p[2] } : p).filter(p => p && (p.sym || p.name));
  const pp = params.length ? `<div class="pp">${params.map(p => {
    const v = p.value == null || p.value === '' ? '' : esc(p.value);
    const sym = p.sym ? `<span class="sym ${p.cls || ''}" data-tex="${esc(p.sym)}" data-inline>${esc(p.sym)}</span>` : '';
    return `<span class="p"><span class="v">${sym}${sym && v ? ' = ' : ''}${v}</span>${p.name ? `<small>${esc(p.name)}</small>` : ''}</span>`;
  }).join('')}</div>` : '';
  const lines = arrOf(info.lines).map(String);
  const notes = lines.length ? `<div class="notes">${lines.map(t => `<p>${esc(t)}</p>`).join('')}</div>` : '';
  const tex = arrOf(info.tex).map(String), eq = arrOf(info.eq).map(String);
  const eqs = tex.length ? `<div class="eqs">${tex.map(t => `<div class="eq" data-tex="${esc(t)}">${esc(t)}</div>`).join('')}</div>`
    : '';
  const code = codeBlock(info);
  // Plain eq lines (no TeX) are pseudocode, for example the table pages'
  // "color = mix(ground, ramp(ρ′), …)". They show as a coloured listing,
  // not as italic text. With a real code extract, the extract replaces them.
  const pseudo = !tex.length && eq.length && !code ? listing('pseudocode', '', 'pseudo', eq) : '';
  // .col holds the bottom text, so a landscape frame can set it beside the code.
  // The top holds only the header and the site mark. The parameters go
  // under the equations, so the description line stands alone.
  return { top: '', bot: (eqs || pp || notes ? `<div class="col">${eqs + pp + notes}</div>` : '') + code + pseudo };
}
function posterHTML(info, page) {
  const s = posterSlots(info);
  const all = allPages(), n = page ? all.findIndex(q => q.key === page.key) + 1 : 0;
  const cat = page ? `<div class="cat">No. ${String(n).padStart(3, '0')} · ${esc(page.con || page.regionName || '')}</div>` : '';
  return `<div class="top">${cat}<b class="ttl">${esc(info.title || (page && page.label) || '')}</b><i class="rule"></i>`
    + `<div class="sub">${esc(info.sub || '')}</div><div class="slot-top">${s.top}</div>`
    + `<div class="mark"><i class="ln l"></i><div class="logo"><span>[</span>www.davesgames.io<span>]</span></div><i class="ln r"></i></div></div>`
    + `<div class="bot"><div class="slot-bot">${s.bot}</div></div>`;
}
// Fill each [data-tex] box from the cache, or typeset it once and keep the
// SVG. A live label swaps the text often; the TeX rarely changes.
function fillTex(box, rules) {
  const rk = JSON.stringify(rules || null);
  box.querySelectorAll('[data-tex]').forEach(n => {
    const tex = n.dataset.tex, inline = 'inline' in n.dataset, key = rk + (inline ? 'i:' : 'd:') + tex;
    if (texCache.has(key)) { n.innerHTML = texCache.get(key); if (!texCache.get(key)) n.classList.add('raw'); return; }
    loadSciMath().then(M => {
      if (!M) { n.classList.add('raw'); return; }
      const tmp = document.createElement('div');
      M.typeset(tmp, tex, { display: !inline, rules: inline ? null : rules }).then(ok => {
        const html = ok ? tmp.innerHTML : '';
        texCache.set(key, html);
        if (n.isConnected && n.dataset.tex === tex) { if (ok) n.innerHTML = html; else n.classList.add('raw'); }
      });
    });
  });
}
function setLabel(info, fallback) {
  const p = el('sn-saver-label');
  plateFonts();
  if (run && !fallback && info) run.labeled = true;
  if (info && S.labels && run && p.classList.contains('on') && p.dataset.title === String(info.title || '')) {
    // Same subject: live values change. Swap the slots only, so the title
    // and the rules do not draw again.
    const s = posterSlots(info);
    p.querySelector('.sub').textContent = info.sub || '';
    p.querySelector('.slot-top').innerHTML = s.top; p.querySelector('.slot-bot').innerHTML = s.bot;
    fillTex(p, info.rules); fillCode(p); plate.info = info;
    return;
  }
  clearTimeout(labelTimer);
  p.classList.remove('on'); leadEl().classList.remove('on');
  if (!info || !S.labels || !run) { if (plate) plate.info = null; return; }
  const page = allPages().find(q => q.key === run.order[run.i]);
  labelTimer = setTimeout(() => {
    p.innerHTML = posterHTML(info, page); fillTex(p, info.rules); fillCode(p);
    p.dataset.title = String(info.title || '');
    if (page) p.style.setProperty('--c', page.color);
    plate = { info, lead: null };
    void p.offsetWidth;   // commit scaleX(0), so the rule draws from the centre
    p.classList.add('on');
    if (!plateRAF) plateRAF = requestAnimationFrame(plateLoop);
  }, p.innerHTML ? 700 : 0);
}
// A page with no label of its own still gets a catalogue poster: its nav
// name, and the region as the sub line.
function fallbackPoster(r, token, page) {
  setTimeout(() => {
    if (run !== r || token !== r.token || r.labeled || !S.labels) return;
    setLabel({ title: page.label, sub: page.regionName || '' }, true);
  }, 1500);
}
// The leader overlay is SVG, so it needs the SVG namespace (el() makes HTML).
function leadEl() {
  let e = document.getElementById('sn-saver-lead');
  if (!e) { e = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); e.id = 'sn-saver-lead'; document.body.appendChild(e); }
  return e;
}
function plateLoop() {
  if (!plate || !plate.info) { plateRAF = 0; leadEl().classList.remove('on'); return; }
  drawLeader();
  plateRAF = requestAnimationFrame(plateLoop);
}
// The subject in shell px: the anchor is in the page frame's CSS px.
function plateAnchor() {
  const a = plate && plate.info && plate.info.anchor;
  if (!a) return null;
  let v = null;
  try { v = typeof a === 'function' ? a() : a; } catch (e) { return null; }
  if (!v || !isFinite(v.x) || !isFinite(v.y)) return null;
  const f = document.querySelector('#frame-wrap iframe'), o = f ? f.getBoundingClientRect() : { left: 0, top: 0 };
  const pts = Array.isArray(v.pts) ? v.pts.filter(q => q && isFinite(q.x) && isFinite(q.y)).map(q => ({ x: q.x + o.left, y: q.y + o.top })) : null;
  // A rectangle (w, h round x, y) fits a tall or thin subject better than
  // a circle. r stays the circle radius, or half the diagonal of the box.
  const hw = +v.w > 0 ? v.w / 2 : 0, hh = +v.h > 0 ? v.h / 2 : 0, box = hw > 0 && hh > 0;
  const x = v.x + o.left, y = v.y + o.top, r = box && !(+v.r > 0) ? Math.hypot(hw, hh) : Math.max(0, +v.r || 0);
  const part = typeof v.lead === 'boolean' ? v.lead : !!(pts && pts.some(q => Math.hypot(q.x - x, q.y - y) > Math.max(24, r * 0.15)));
  return { x, y, r, box, hw, hh, pts: pts && pts.length ? pts : null, part };
}
// The leader starts under the top block or over the bottom block, at the
// centre line, whichever start is nearer to the subject. It ends at the
// nearest key point, the box edge, or the circle edge. When the subject
// reaches the start (it fills the frame), there is no leader.
function drawLeader() {
  const p = document.getElementById('sn-saver-label'), lead = leadEl(), a = plateAnchor();
  if (!p || !a || !a.part || !p.classList.contains('on')) { lead.classList.remove('on'); if (plate) plate.lead = null; return; }
  const top = p.querySelector('.top').getBoundingClientRect(), bot = p.querySelector('.bot').getBoundingClientRect();
  const cx = top.left + top.width / 2, gap = 14;
  const starts = [{ x: cx, y: top.bottom + gap, dir: 1 }];
  if (bot.height > 30) starts.push({ x: cx, y: bot.top - gap, dir: -1 });
  let ex, ey, ring = 3, cxr = null, cyr = null, s = null, best = Infinity;
  for (const q of starts) {
    let tx = a.x, ty = a.y;
    if (a.pts) { let k = Infinity; for (const t of a.pts) { const d = Math.hypot(t.x - q.x, t.y - q.y); if (d < k) { k = d; tx = t.x; ty = t.y; } } }
    const d = Math.hypot(tx - q.x, ty - q.y);
    if (d < best) { best = d; s = q; }
  }
  if (a.pts) {
    let q = a.pts[0], k = Infinity;
    for (const t of a.pts) { const d = Math.hypot(t.x - s.x, t.y - s.y); if (d < k) { k = d; q = t; } }
    ring = 7; const d = k || 1;
    ex = q.x + (s.x - q.x) / d * ring; ey = q.y + (s.y - q.y) / d * ring; cxr = q.x; cyr = q.y;
  } else if (a.box) {
    const bx = Math.max(a.x - a.hw, Math.min(s.x, a.x + a.hw)), by = Math.max(a.y - a.hh, Math.min(s.y, a.y + a.hh));
    const ux = s.x - bx, uy = s.y - by, k = Math.hypot(ux, uy) || 1;
    ex = bx + ux / k * 4; ey = by + uy / k * 4; cxr = ex; cyr = ey;
  } else {
    const dx = s.x - a.x, dy = s.y - a.y, d = Math.hypot(dx, dy) || 1, er = Math.min(a.r + 4, d - 24);
    ex = a.x + dx / d * er; ey = a.y + dy / d * er; cxr = ex; cyr = ey;
  }
  const len = Math.hypot(ex - s.x, ey - s.y);
  // The leader must point away from the block it leaves (down from the
  // top block, up from the bottom block), and be long enough to read.
  const ok = len > 24 && (ey - s.y) * s.dir > 0;
  plate.lead = ok ? { x1: s.x, y1: s.y, x2: ex, y2: ey, from: s.dir > 0 ? 'top' : 'bot' } : null;
  if (!ok) { lead.classList.remove('on'); return; }
  const f = v => v.toFixed(1);
  lead.innerHTML = `<circle class="dot" cx="${f(s.x)}" cy="${f(s.y)}" r="2"/><line x1="${f(s.x)}" y1="${f(s.y)}" x2="${f(ex)}" y2="${f(ey)}"/><circle cx="${f(cxr)}" cy="${f(cyr)}" r="${ring}"/>`;
  lead.classList.add('on');
}
// For checks: the boxes of the poster parts, in shell CSS px.
function plateBoxes() {
  const p = document.getElementById('sn-saver-label');
  if (!p || !plate || !plate.info) return null;
  const box = s => { const e = p.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
  return { title: plate.info.title || '', lead: plate.lead || null, frame: box(':scope'), top: box('.top'), bot: box('.bot'), ttl: box('.ttl'), code: box('.code'), logo: box('.logo') };
}

// The page hook, or the generic mode when the page has none.
async function enterPage(w, key, r, token) {
  const t0 = performance.now(), info = CAT.pages[key] || {};
  const limit = info.hook ? HOOK_WAIT_MS : NO_HOOK_WAIT_MS;
  while (!w.snSaver && performance.now() - t0 < limit) await wait(100);
  // label() from a page that is already gone (an old token) does nothing.
  const label = info => { if (run === r && token === r.token) { r.labelToken = token; setLabel(info); } };
  const opts = { calm: S.calm, seconds: S.seconds, caption: S.caption, seed: (Math.random() * 1e9) | 0, label, labels: !!S.labels };
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
  document.body.classList.remove('sn-saver-on', 'sn-saver-nocursor', 'sn-saver-vert');
  el('sn-saver-cap').classList.remove('on');
  setLabel(null);
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

window.snScreensaver = { plate: plateBoxes, label: info => setLabel(info), open: openMenu, start: startSaver, stop: stopSaver, settings: () => Object.assign({}, S), pages: allPages, get running() { return !!run; } };
})();
