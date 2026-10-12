// ============================================================================
//  FLY DUEL  ·  a focused card is non-modal  (node tests/focus.test.mjs)
// ----------------------------------------------------------------------------
//  The user (verbatim, 2026-10-12): "wehen i focus on a card it sholdnt
//  be the only thing availabe in the iterface".
//    place     focusPlace (ui/cardzoom.js): the card goes on the side
//              away from the pointer, inside the view, clear of the top
//              and bottom bands; a phone gets a compact docked card; in
//              2000 random cases the card never covers the pointer
//    zoom      the watch zoom (ui/cardzoom.js, linkedom): no full-screen
//              box, a close control, the side away from the pointer; a
//              tap or a click on the table goes to the table and the
//              zoom stays open; the close control closes
//    inspector the play inspector (ui/play/inspector.js, linkedom): no
//              veil, no inset box, no aria-modal, pointer-events none
//              except its Close button, focus stays where it is; a
//              right-click elsewhere closes, a right-click that focuses
//              another card changes it, a touch hold does not close
//    play      mountPlay with a stub 3D scene: with a card focused, the
//              keys work (L opens the log), a click on the table reaches
//              the table handler (a pick), Escape closes
//    css       style.css: .czoom and .pl-insp.pl-focus have no inset
//              box, no veil and take no pointer events; the close
//              controls do
//  Exit code 1 on any failure.
// ============================================================================
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; if (process.env.VERBOSE) console.log('ok  ', m); } else { fail++; console.error('FAIL', m); } };

const { FOCUS, focusPlace, createCardZoom, attachCardZoom } = await import('../ui/cardzoom.js');
const cards = await import('../game/cards.js');
const { CARD } = cards;
const ids = Object.keys(CARD);

// --- place (pure) --------------------------------------------------------------------------
{
  const a = focusPlace([1440, 900], { x: 1100, y: 400 }, { top: 60, bottom: 180 });
  ok(a.side === 'left' && a.x + a.w < 1100 && !a.dock, `place: a pointer at the right puts the card at the left (${a.side} ${a.x},${a.y} ${a.w}x${a.h})`);
  const b = focusPlace([1440, 900], { x: 200, y: 400 }, { top: 60, bottom: 180 });
  ok(b.side === 'right' && b.x > 200 && b.x + b.w <= 1440 - FOCUS.margin, `place: a pointer at the left puts the card at the right (${b.x})`);
  ok(a.y >= 60 && a.y + a.h <= 900 - 180, `place: the card stays clear of the scorecards and the hand (${a.y}..${a.y + a.h})`);
  ok(a.w * a.h < 1440 * 900 * 0.25 && Math.abs(a.w / a.h - 5 / 7) < 0.01, `place: the card covers less than a quarter of a desktop view (${((a.w * a.h) / (1440 * 900) * 100).toFixed(1)} %), 5:7`);
  const p = focusPlace([390, 844], { x: 300, y: 500 }, { top: 70, bottom: 230 });
  ok(p.dock && p.w <= FOCUS.phoneMax && p.side === 'left' && p.y >= 70 && p.w * p.h < 390 * 844 * 0.1, `place: a phone gets a compact docked card (${p.w}x${p.h} at ${p.x},${p.y}, ${((p.w * p.h) / (390 * 844) * 100).toFixed(1)} %)`);
  const n = focusPlace([1280, 800], null);
  ok(n.side === 'right', 'place: with no pointer the card goes to the right');
  let bad = [];
  let seed = 11;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < 2000; i++) {
    const vw = 320 + Math.round(rnd() * 1700), vh = 320 + Math.round(rnd() * 1000);
    const top = rnd() * vh * 0.2, bottom = rnd() * vh * 0.35;
    const ptr = { x: rnd() * vw, y: rnd() * vh };
    const q = focusPlace([vw, vh], ptr, { top, bottom });
    const coversPtr = ptr.x >= q.x && ptr.x <= q.x + q.w && ptr.y >= q.y && ptr.y <= q.y + q.h;
    const out = q.x < 0 || q.y < 0 || q.x + q.w > vw || q.y + q.h > vh;
    const inBand = q.y >= top - 0.5 && q.y + q.h <= vh - bottom + 0.5;
    if (coversPtr || out || !inBand) bad.push(`${vw}x${vh} t${top | 0} b${bottom | 0} ptr ${ptr.x | 0},${ptr.y | 0} -> ${q.x},${q.y} ${q.w}x${q.h}`);
  }
  ok(bad.length === 0, `place: 2000 random views: the card stays in the view and the free band, never on the pointer${bad.length ? ` (${bad.length} bad: ${bad.slice(0, 2).join('; ')})` : ''}`);
}

// --- css ---------------------------------------------------------------------------------
{
  const css = readFileSync(join(ROOT, 'style.css'), 'utf8');
  const rule = sel => { const m = css.match(new RegExp(`(^|\\n)${sel.replace(/[.[\]()"=]/g, c => '\\' + c)}\\{([^}]*)\\}`)); return m ? m[2] : null; };
  const cz = rule('.czoom');
  ok(cz && /pointer-events:none/.test(cz) && !/inset:0/.test(cz) && !/background/.test(cz), `css: .czoom takes no pointer events, has no full-screen box and no veil (${cz})`);
  ok(/pointer-events:auto/.test(rule('.czoom-x') || ''), 'css: the close control of the zoom takes pointer events');
  const pf = rule('.pl-insp.pl-focus');
  ok(pf && /pointer-events:none/.test(pf) && /inset:auto/.test(pf) && /background:transparent/.test(pf), `css: .pl-insp.pl-focus overrides the old modal rule: no box, no veil, no pointer events (${pf})`);
  ok(/pointer-events:auto/.test(rule('.pl-insp.pl-focus .pl-insp-x') || ''), 'css: the Close button of the inspector takes pointer events');
}

// --- DOM (linkedom) -------------------------------------------------------------------------
let parseHTML = null;
for (const base of [join(ROOT, 'package.json'), '/usr/local/lib/node_modules/openclaw/package.json']) {
  try { ({ parseHTML } = createRequire(base)('linkedom')); break; } catch { /* next */ }
}
if (!parseHTML) console.log('  skip: DOM checks (linkedom is missing)');
else {
  const { window, document } = parseHTML('<!doctype html><html><body><div id="app"><canvas id="cv"></canvas><button id="other">x</button></div><div id="ph"><button id="elsewhere">y</button></div><main id="play"></main></body></html>');
  globalThis.window = window; globalThis.document = document;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const pev = (el, type, o = {}) => { const e = new window.Event(type, { bubbles: true, cancelable: true }); Object.assign(e, { clientX: 0, clientY: 0, button: 0, buttons: 0, pointerId: 1, pointerType: 'mouse', detail: 1 }, o); el.dispatchEvent(e); return e; };
  const fullBox = el => /inset:\s*0/.test(el.getAttribute('style') || '') || (el.style.width === '100%' && el.style.height === '100%');

  // --- the watch zoom
  {
    const app = document.getElementById('app'), cv = document.getElementById('cv');
    const CF = { drawCard() {}, paintWithArt: (t, id, draw) => draw(null) };
    const zoom = createCardZoom(app, { CARD, CF, view: () => [1440, 900] });
    zoom.el.querySelector('canvas').getContext = () => ({ clearRect() {}, setTransform() {} });
    const pick = x => (x < 700 ? { id: ids[0] } : x < 1400 ? { id: ids[1] } : null);
    const inp = attachCardZoom(cv, zoom, { pick, doc: document });
    let tableClicks = 0;
    cv.addEventListener('click', () => { tableClicks++; });
    pev(cv, 'contextmenu', { clientX: 1000, clientY: 400 });
    ok(zoom.isOpen() && zoom.el.dataset.side === 'left' && parseFloat(zoom.el.style.left) < 100, `zoom: a right-click at the right puts the card at the left (${zoom.el.dataset.side}, left ${zoom.el.style.left}, width ${zoom.el.style.width})`);
    ok(!fullBox(zoom.el) && parseFloat(zoom.el.style.width) < 1440 * 0.4, 'zoom: no full-screen box');
    ok(zoom.el.getAttribute('role') !== 'dialog' && !zoom.el.hasAttribute('aria-modal'), 'zoom: not a modal dialog');
    const x = zoom.el.querySelector('.czoom-x');
    ok(!!x && x.tagName === 'BUTTON', 'zoom: a close control');
    pev(cv, 'click', { clientX: 300, clientY: 400 });
    ok(tableClicks === 1 && zoom.isOpen(), 'zoom: a left click on the table goes to the table, the zoom stays open');
    pev(cv, 'pointerdown', { pointerType: 'touch', clientX: 1420, clientY: 400 });
    pev(cv, 'pointerup', { pointerType: 'touch', clientX: 1420, clientY: 400 });
    ok(zoom.isOpen(), 'zoom: a tap on the table does not close it (non-modal)');
    pev(cv, 'contextmenu', { clientX: 200, clientY: 400 });
    ok(zoom.id() === ids[0] && zoom.el.dataset.side === 'right', `zoom: another card focused changes it, at the side away from the pointer (${zoom.el.dataset.side})`);
    pev(x, 'click');
    ok(!zoom.isOpen(), 'zoom: the close control closes it');
    pev(cv, 'contextmenu', { clientX: 200, clientY: 400 });
    pev(x, 'contextmenu');
    ok(!zoom.isOpen(), 'zoom: a right-click on the close control closes it');
    inp.dispose(); zoom.dispose();
  }

  // --- the play inspector
  {
    const { createInspector } = await import('../ui/play/inspector.js');
    const host = document.getElementById('ph'), elsewhere = document.getElementById('elsewhere');
    const I = createInspector(host, { KEYWORDS: cards.KEYWORDS || {} });
    I.el.querySelector('canvas').getContext = () => null;
    const L = { zoom: { w: 400, h: 560 } };
    elsewhere.focus?.();
    const before = document.activeElement;
    pev(document.body, 'pointermove', { clientX: 1000, clientY: 300 });
    I.open(CARD[ids[2]], { L });
    const st = I.el.style;
    ok(I.isOpen() && st.pointerEvents === 'none' && !fullBox(I.el), `inspector: open, takes no pointer events, no full-screen box (${I.el.getAttribute('style')})`);
    ok(/background:\s*transparent/.test(I.el.getAttribute('style') || '') && I.el.classList.contains('pl-focus'), 'inspector: no veil');
    ok(!I.el.hasAttribute('aria-modal') && I.el.getAttribute('role') !== 'dialog', 'inspector: not a modal dialog');
    ok(I.el.querySelector('.pl-insp-x').style.pointerEvents === 'auto', 'inspector: only the Close button takes pointer events');
    ok(document.activeElement === before, 'inspector: focus stays where it was');
    ok(I.el.dataset.side === 'left', `inspector: a pointer at the right puts it at the left (${I.el.dataset.side})`);
    // a right-click on a card focuses that card: no close
    const cardEl = document.createElement('div');
    host.appendChild(cardEl);
    cardEl.addEventListener('contextmenu', e => { e.preventDefault(); I.open(CARD[ids[3]], { L }); });
    pev(cardEl, 'contextmenu', { clientX: 200, clientY: 300 });
    ok(I.isOpen() && I.el.dataset.id === ids[3], `inspector: a right-click on another card changes to it (${I.el.dataset.id})`);
    await wait(5);
    pev(elsewhere, 'pointerdown', { pointerType: 'touch', clientX: 200, clientY: 300 });
    pev(elsewhere, 'contextmenu', { pointerType: 'touch', clientX: 200, clientY: 300 });
    ok(I.isOpen(), 'inspector: the contextmenu of a touch hold does not close it');
    pev(elsewhere, 'pointerdown', { pointerType: 'mouse', button: 2, clientX: 200, clientY: 300 });
    const e = pev(elsewhere, 'contextmenu', { clientX: 200, clientY: 300 });
    ok(!I.isOpen() && e.defaultPrevented, 'inspector: a right-click elsewhere closes it');
    I.open(CARD[ids[2]], { L });
    pev(I.el.querySelector('.pl-insp-x'), 'click');
    ok(!I.isOpen(), 'inspector: the Close button closes it');
    I.dispose();
    ok(!host.querySelector('.pl-insp'), 'inspector: dispose removes it');
  }

  // --- play (mountPlay with a stub 3D scene)
  {
    const { mountPlay } = await import('../ui/play/play.js');
    const { greedyBot } = await import('../game/bots.js');
    const rules = await import('../game/rules.js');
    let picks = 0;
    const scene = {
      pickPermanent: () => { picks++; return null; }, pickFace: () => null, setFirstPerson() {}, highlight() {}, setState() {}, setSpeed() {}, resize() {},
      play: () => Promise.resolve(), orbitBy: () => ({}), zoomBy: () => ({}), seatView() {},
    };
    const root = document.getElementById('play');
    const P = mountPlay(root, { rules, cards, bots: { greedyBot }, flies: {}, connectomes: {}, seed: 4, scene, sceneEl: document.createElement('canvas') });
    const q = s => root.querySelector(s);
    pev(q('.pl-go'), 'click');
    pev(q('[data-call="heads"]'), 'click');
    await wait(5);
    pev(q('.pl-go'), 'click');
    q('[data-keep]') && pev(q('[data-keep]'), 'click');
    await wait(20);
    const insp = q('.pl-insp'), table = q('.pl-table');
    const hc = [...root.querySelectorAll('.pl-hc')].filter(el => !el.hidden);
    if (!hc.length) ok(false, 'play: the hand has cards');
    else {
      pev(hc[0], 'pointerdown', { pointerType: 'mouse', button: 2 });
      pev(hc[0], 'contextmenu', { pointerType: 'mouse', button: 2 });
      ok(!insp.hidden, 'play: a mouse right-click on a hand card focuses it');
      ok(insp.style.pointerEvents === 'none' && !fullBox(insp), 'play: the focused card takes no pointer events and has no full-screen box');
      const log = q('.pl-log');
      const wasHidden = log.hidden;
      pev(document.body, 'keydown', { key: 'l' });
      ok(log.hidden !== wasHidden && !insp.hidden, `play: with a card focused the keys still work (L: log ${wasHidden ? 'opens' : 'closes'}), the card stays`);
      if (!log.hidden) pev(document.body, 'keydown', { key: 'l' });
      const p0 = picks;
      pev(table, 'click', { clientX: 400, clientY: 300 });
      ok(picks > p0, `play: a left click on the table reaches the table handler (${picks - p0} picks)`);
      pev(document.body, 'keydown', { key: 'Escape' });
      ok(insp.hidden, 'play: Escape closes the focused card');
      pev(hc[0], 'pointerdown', { pointerType: 'mouse', button: 2 });
      pev(hc[0], 'contextmenu', { pointerType: 'mouse', button: 2 });
      await wait(5);
      pev(table, 'pointerdown', { pointerType: 'mouse', button: 2, clientX: 400, clientY: 300 });
      pev(table, 'contextmenu', { pointerType: 'mouse', button: 2, clientX: 400, clientY: 300 });
      ok(insp.hidden, 'play: a right-click on the table with no card closes it');
    }
    P.destroy();
  }
}

console.log(`focus: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
