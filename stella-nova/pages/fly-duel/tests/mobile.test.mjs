// ============================================================================
//  FLY DUEL  ·  phones and tablets  (node tests/mobile.test.mjs)
// ----------------------------------------------------------------------------
//  The user (verbatim, 2026-10-12): "make sure the whole thing is
//  extremely compatible with mobile". No browser (the user does not allow
//  headless Chrome), so this file checks the rules that make the page work
//  on a phone, and walks every control with touch events only.
//    css      index.html viewport (cover); style.css: 100dvh, no page
//             scroll sideways, the safe-area insets at every edge box,
//             touch-action (manipulation on the app and the buttons, none
//             on the table canvas), 44 px targets on a coarse pointer, the
//             control bar in one row that scrolls sideways, every :hover
//             inside a hover media query; play.css: the safe area at every
//             edge box of play mode; hud.css: 44 px brain button
//    chooser  ui/chooser/chooser.css: the title screen keeps clear of the
//             safe area at the top (phone, phone landscape, wide) and the
//             bottom (wide), and every control is 44 px on a coarse pointer
//    layout   at 360x740, 390x844, 430x932, 844x390, 932x430, 820x1180 and
//             1180x820 (and 1920x1080): the numbers of the CSS rules give a
//             control bar that holds one row of 44 px controls, brain
//             squares that stay in the view and off the turn box, and a
//             play screen (ui/play/layout.js) with 44 px targets, the big
//             button and the hand in the lower part (thumb reach) and a
//             hovered version that fits the view
//    walk     main.js boots on linkedom with (pointer: coarse). Every
//             control in #app (watch bar, scorecards, drawer, title
//             screen, play screen) must have a tap path: a click or
//             pointer listener on it or on a box round it under #app (a
//             listener on the document does not count), or a native
//             action (a link, a select). A probe button with a hover
//             listener only must fail the check. Then the test taps the controls
//             with touch events only (pointerdown, pointerup, click; no
//             mouse, no hover, no keys, no right-click): the watch bar,
//             the drawer, the title screen to play mode, the coin, the
//             keep, the big button, the menu. No error may show.
//    main     main.js re-lays the page out after a phone turns, and its
//             loop draws nothing while the page is hidden
//  Exit code 1 on any failure.
// ============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; if (process.env.VERBOSE) console.log('ok  ', m); } else { fail++; console.log(`FAIL ${m}`); } };
const read = p => readFileSync(join(ROOT, p), 'utf8');

const html = read('index.html'), css = read('style.css'), play = read('ui/play/play.css'), hud = read('ui/hud/hud.css');
const main = read('main.js');

// --- css --------------------------------------------------------------------------------------
{
  ok(/<meta name="viewport" content="[^"]*width=device-width[^"]*viewport-fit=cover/.test(html), 'css: the viewport meta covers the screen (viewport-fit=cover)');
  ok(/\.app\{[^}]*height:100dvh/.test(css), 'css: #app is 100dvh high (the bar stays over the browser bars)');
  ok(/html\{[^}]*overflow-x:hidden/.test(css) && /body\{[^}]*overflow:hidden/.test(css), 'css: no page scroll sideways');
  ok(/\.app\{[^}]*touch-action:manipulation/.test(css), 'css: the app allows pan and pinch but no double-tap zoom (touch-action: manipulation)');
  ok(/button\{[^}]*touch-action:manipulation/.test(css), 'css: every button has touch-action: manipulation (no iOS double-tap zoom)');
  ok(/\.stage-cv\{[^}]*touch-action:none/.test(css), 'css: the table canvas takes every touch (orbit, pinch), the page does not move');
  ok(/\.bp-grip\{[^}]*touch-action:none/.test(css), 'css: the brain grip takes its drag');
  // safe area
  for (const [sel, side] of [['\\.whud', 'top'], ['\\.stagebar', 'bottom'], ['\\.how-top', 'top'], ['#doc', 'bottom'], ['\\.app', 'bottom']]) {
    ok(new RegExp(`${sel}\\{[^}]*safe-area-inset-${side}`).test(css), `css: ${sel.replace(/\\/g, '')} keeps clear of the safe area (${side})`);
  }
  ok(/--sl:env\(safe-area-inset-left/.test(css) && /--sr:env\(safe-area-inset-right/.test(css), 'css: the left and right safe areas are --sl and --sr');
  ok(/\.how\{[^}]*--top:calc\(52px \+ env\(safe-area-inset-top/.test(css), 'css: the drawer head and its sticky chip bar sit under the notch');
  ok(/\.how\{[^}]*overflow-y:auto[^}]*overscroll-behavior:contain/.test(css), 'css: the drawer scrolls on its own, the page under it does not');
  // 44 px
  const coarse = css.slice(css.indexOf('@media (pointer:coarse)'));
  ok(/\.seg button,\.tgl,\.arena-ctrls \.tgl,\.seg\.mini button\{min-height:44px/.test(coarse), 'css: every bar control is 44 px high on a coarse pointer');
  ok(/select,input\[type=number\]\{min-height:44px\}/.test(coarse) && /#chips a\{[^}]*min-height:44px/.test(coarse), 'css: selects, inputs and the chips are 44 px on a coarse pointer');
  ok(/\.arena-ctrls\{[^}]*flex-wrap:nowrap[^}]*overflow-x:auto/.test(css) && /\.arena-ctrls>\*\{flex:none\}/.test(css) && /\.arena-ctrls \.seg\{[^}]*flex-wrap:nowrap/.test(css), 'css: the control bar is one row that scrolls sideways, it does not wrap');
  // hover only inside (hover:hover)
  const bad = [];
  for (const [file, raw] of [['style.css', css], ['play.css', play], ['hud.css', hud]]) {
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '');
    let depth = 0, media = [];
    const re = /@media([^{]*)\{|\{|\}/g;
    let m, last = 0;
    while ((m = re.exec(src))) {
      if (m[1] !== undefined) { media.push(m[1]); depth++; last = re.lastIndex; continue; }
      if (m[0] === '{') {
        const sel = src.slice(last, m.index);
        if (/:hover/.test(sel) && !media.some(q => /hover:\s*hover/.test(q))) bad.push(`${file}: ${sel.trim().slice(0, 60)}`);
        depth++;
      } else { depth--; if (media.length && depth < media.length) media.pop(); }
      last = re.lastIndex;
    }
  }
  ok(bad.length === 0, `css: every :hover rule is inside a (hover: hover) query, so a tap leaves no hover state (${bad.join(' | ') || 'none outside'})`);
  // play.css
  ok(/--sat: env\(safe-area-inset-top, 0px\); --sab: env\(safe-area-inset-bottom, 0px\);/.test(play) && /--base: calc\(var\(--peek\) \+ var\(--sab\)\)/.test(play), 'css: play mode has the safe-area insets and --base (the hand peek plus the home bar)');
  ok(!/bottom: calc\(var\(--peek\) \+/.test(play), 'css: no play box sits on the bare hand peek (all use --base)');
  ok(/\.pl-handbox \{[^}]*left: var\(--sal\); right: var\(--sar\)[^}]*bottom: calc\(var\(--base\) - var\(--hand-h\)\)/.test(play), 'css: the hand fan keeps clear of the notch and the home bar');
  ok(/\.pl\.pl-3d \.pl-cards \{[^}]*top: calc\(6px \+ var\(--sat\)\)/.test(play) && /\.pl\.pl-3d \.pl-actions \{[^}]*right: calc\(8px \+ var\(--sar\)\)/.test(play), 'css: the play scorecards and the big button keep clear of the notch');
  ok(/\.pl-sheet \{[^}]*padding: calc\(16px \+ var\(--sat\)\)/.test(play) && /\.pl-insp \{[^}]*padding: calc\(16px \+ var\(--sat\)\)/.test(play), 'css: the play sheets and the inspector keep clear of the notch');
  ok(/\.pl-btn \{[^}]*min-height: 44px[^}]*touch-action: manipulation/.test(play), 'css: every play button is 44 px and has touch-action: manipulation');
  ok(/@media \(pointer: coarse\) \{ \.pl-seatbtn \{ min-height: 44px; \} \}/.test(play), 'css: "Back to seat" is 44 px on a touch screen');
  ok(/\.pl-handbox \{[^}]*touch-action: none/.test(play) && /\.pl-hc \{[^}]*touch-action: none/.test(play), 'css: the hand fan does not scroll; a drag in any direction plays (touch-action: none)');
  ok(/@media \(pointer: coarse\) \{[\s\S]{0,200}\.hd-more \{ min-height: 44px; min-width: 44px;/.test(hud), 'css: the brain button of a scorecard is 44 px on a touch screen');
}

// --- chooser css (ui/chooser/chooser.css) ------------------------------------------------------
{
  const cc = read('ui/chooser/chooser.css').replace(/\/\*[\s\S]*?\*\//g, '');
  // the body of a media block: from its opening brace to the matching close
  const mediaBody = q => {
    const i = cc.indexOf(q);
    if (i < 0) return '';
    let d = 0, j = cc.indexOf('{', i);
    const s = j;
    for (; j < cc.length; j++) { if (cc[j] === '{') d++; else if (cc[j] === '}' && --d === 0) break; }
    return cc.slice(s + 1, j);
  };
  const land = mediaBody('@media (orientation:landscape) and (max-height:520px)');
  const top = cc.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g, '');
  ok(/(^|[}\s])\.fdc-in\{[^}]*padding:calc\(26px \+ env\(safe-area-inset-top,0px\)\) [^;]*calc\(18px \+ env\(safe-area-inset-bottom,0px\)\)/.test(top), 'chooser css: the wide layout (iPad 1180x820) keeps the title and the Start bar clear of the safe area (top and bottom)');
  ok(/\.fdc-phone \.fdc-in\{[^}]*padding:calc\(16px \+ env\(safe-area-inset-top,0px\)\)/.test(top), 'chooser css: the phone layout keeps the title under the notch (safe-area-inset-top)');
  ok(/\.fdc-phone \.fdc-in\{[^}]*padding:calc\(10px \+ env\(safe-area-inset-top,0px\)\)/.test(land), 'chooser css: phone landscape keeps the title clear of the safe area (top)');
  const coarse = mediaBody('@media (pointer:coarse)');
  const rules = [...coarse.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(m => ({ sel: m[1].split(',').map(x => x.trim()), body: m[2] }));
  const has = (sel, prop) => rules.some(r => r.sel.includes(sel) && new RegExp(`(^|;)${prop}:44px`).test(r.body));
  for (const sel of ['.fdc-x', '.fdc-fpip', '.fdc-kind button', '.fdc-edit', '.fdc-back', '.fdc-opp button', '.fdc-how', '.fdc-seat-b', '.fdc-mode', '.fdc-tile', '.fdc-ctile', '.fdc-go']) {
    ok(has(sel, 'min-height'), `chooser css: ${sel} is 44 px high or more on a coarse pointer`);
  }
  for (const sel of ['.fdc-x', '.fdc-fpip', '.fdc-kind button', '.fdc-opp button']) ok(has(sel, 'min-width'), `chooser css: ${sel} is 44 px wide or more on a coarse pointer`);
}

// --- layout -------------------------------------------------------------------------------------
{
  const { layoutFor } = await import('../ui/play/layout.js');
  const { peekSize } = await import('../ui/play/peek.js');
  // the --bar-h values of style.css
  const barBase = +(css.match(/--bar-h:calc\((\d+)px \+ env/) || [])[1];
  const barWide = +(css.slice(css.indexOf('@media (min-width:760px)')).match(/--bar-h:calc\((\d+)px/) || [])[1];
  const barLand = +(css.slice(css.indexOf('@media (max-height:520px) and (orientation:landscape)')).match(/--bar-h:calc\((\d+)px/) || [])[1];
  ok(barBase === 96 && barWide === 62 && barLand === 56, `layout: the bar heights of style.css (${barBase}, ${barWide}, ${barLand})`);
  const SIZES = [[360, 740], [390, 844], [430, 932], [844, 390], [932, 430], [820, 1180], [1180, 820], [1920, 1080]];
  for (const [W, H] of SIZES) {
    const land = W > H && H <= 520;
    const bar = land ? barLand : W >= 760 ? barWide : barBase;
    const rowLayout = land || W >= 760;            // status and controls in one row
    // phone portrait: 8 px top pad, the status line (0.74rem x 1.3), a 6 px gap, then the 44 px row (+2 px pad)
    const need = rowLayout ? 44 + 2 : 8 + Math.ceil(14 * 0.74 * 1.3) + 6 + 44 + 2;
    ok(need <= bar, `layout ${W}x${H}: the control bar (${bar} px) holds one row of 44 px controls (${need} px)`);
    const h = H - bar, wide = W / H >= 1.1 && W >= 700;
    const bpw = Math.min(640, Math.max(220, 0.31 * W)), bph = Math.min(250, Math.max(118, 0.22 * H));
    const sq = wide ? Math.min(0.6 * h, 0.92 * bpw) : bph;
    const squares = wide ? [[0, 0, bpw, sq], [W - bpw, 0, W, sq]] : [[0, 52, sq, 52 + sq], [W - sq, h - sq, W, h]];
    ok(squares.every(([x0, y0, x1, y1]) => x0 >= 0 && y0 >= 0 && x1 <= W && y1 <= h && x1 - x0 >= 100), `layout ${W}x${H}: the brain squares are in the view and at least 100 px (${Math.round(sq)} px)`);
    // the turn box: wide at the top centre (about 260 px wide, 22 high); tall under band A
    const tb = wide ? [W / 2 - 130, 12, W / 2 + 130, 34] : [W / 2 - 130, 52 + bph + 8, W / 2 + 130, 52 + bph + 30];
    const hit = squares.some(([x0, y0, x1, y1]) => tb[0] < x1 && tb[2] > x0 && tb[1] < y1 && tb[3] > y0);
    ok(!hit, `layout ${W}x${H}: the turn box does not lie on a brain square`);
    // play mode on a touch screen
    const L = layoutFor(W, H, { coarse: true });
    const expect = land || (W < 600 && W > H) ? 'phone-land' : W < 600 ? 'phone' : W < 1024 ? 'tablet' : 'desktop';
    ok(L.kind === expect && L.button.h >= 44 && L.target >= 44 && !L.hover, `layout ${W}x${H}: play is '${L.kind}', 44 px targets, the big button ${L.button.h} px, no hover input`);
    const btnTop = H - (L.hand.peek + 6 + L.button.h);
    ok(btnTop >= H * 0.5 && L.hand.peek >= 44 && L.hand.w >= 44, `layout ${W}x${H}: the big button (top at ${btnTop | 0}) and the hand (${L.hand.w}x${L.hand.h}, ${L.hand.peek} px in view) are in the lower half, in thumb reach`);
    const pk = peekSize(W, H);
    ok(pk.w <= W - 16 && pk.h <= H - 16, `layout ${W}x${H}: the hovered version (${pk.w}x${pk.h}) fits the view`);
  }
}

// --- main ----------------------------------------------------------------------------------------
{
  ok(/addEventListener\('orientationchange', turned\)/.test(main) && /screen\?\.orientation\?\.addEventListener\?\.\('change', turned\)/.test(main), 'main: a phone turn runs every resize handler again (orientationchange, screen.orientation)');
  ok(/if \(!window\.__fdSaver && !document\.hidden\)/.test(main), 'main: the loop draws nothing while the page is hidden');
  ok(/lite: COARSE/.test(main), 'main: the brain panels are lite on a touch screen');
  const scene = read('ui/fly3d/scene.js');
  ok(/setPixelRatio\(Math\.min\(window\.devicePixelRatio \|\| 1, coarse \? 1\.5 : 2\)\)/.test(scene), 'main: the table renders at a pixel ratio of at most 1.5 on a touch screen');
}

// --- walk (linkedom, touch only) ----------------------------------------------------------------------
let linkedom = null;
for (const spec of ['linkedom', '/usr/local/lib/node_modules/openclaw/node_modules/linkedom/esm/index.js']) {
  try { linkedom = await import(spec); break; } catch { /* next */ }
}
if (!linkedom) console.log('  skip: the touch walk (linkedom is missing)');
else {
  const W = linkedom.parseHTML(html.replace(/<script[^>]*\ssrc=[^>]*><\/script>/g, ''));
  const { document } = W;
  // record the listeners of every element
  const L = new WeakMap();
  let proto = document.createElement('button');
  while (proto && !Object.prototype.hasOwnProperty.call(proto, 'addEventListener')) proto = Object.getPrototypeOf(proto);
  const add0 = proto.addEventListener;
  proto.addEventListener = function (type, f, o) { (L.get(this) || L.set(this, new Set()).get(this)).add(type); return add0.call(this, type, f, o); };
  const errors = [];
  const oe = console.error, ow = console.warn;
  console.error = (...a) => errors.push(a.map(x => x && x.stack || String(x)).join(' '));
  console.warn = (...a) => errors.push('warn: ' + a.map(x => x && x.stack || String(x)).join(' '));
  const stub = () => {
    const store = {};
    return new Proxy(function () {}, {
      get(t, p) {
        if (p === Symbol.toPrimitive) return () => 0;
        if (p === 'then') return undefined;
        if (p in store) return store[p];
        if (p === 'width' || p === 'height' || p === 'length') return 0;
        return stub();
      },
      set(t, p, v) { store[p] = v; return true; },
      apply() { return stub(); },
    });
  };
  const P = W.HTMLElement.prototype;
  P.getBoundingClientRect = () => ({ width: 390, height: 260, top: 300, left: 0, right: 390, bottom: 560 });
  P.setPointerCapture = () => {}; P.scrollTo = () => {}; P.scrollIntoView = () => {};
  (W.HTMLCanvasElement || W.HTMLElement).prototype.getContext = function () { return this.__g ||= stub(); };
  class Img { set src(v) { this._s = v; setTimeout(() => this.onload?.(), 0); } get src() { return this._s; } decode() { return Promise.resolve(); } }
  const { createTrainer } = await import(pathToFileURL(join(ROOT, 'train/worker.js')).href);
  class FakeWorker {
    constructor() { this.t = createTrainer(m => setTimeout(() => this.onmessage?.({ data: structuredClone(m) }), 0)); }
    postMessage(m) { const c = structuredClone(m); setTimeout(() => this.t.handle(c), 0); }
    terminate() {}
  }
  const frames = [], winL = {};
  const realST = globalThis.setTimeout;
  globalThis.setTimeout = (f, ms, ...a) => realST(f, Math.min(ms || 0, 1), ...a);
  const media = q => /pointer:\s*coarse/.test(q) || /hover:\s*none/.test(q);
  Object.assign(globalThis, {
    location: { search: '', hash: '' }, history: { replaceState() {} },
    window: globalThis, document, Node: W.Node, HTMLElement: W.HTMLElement, Event: W.Event,
    innerWidth: 390, innerHeight: 844, devicePixelRatio: 3, Image: Img, Worker: FakeWorker,
    matchMedia: q => ({ matches: media(q), addEventListener() {}, removeEventListener() {} }),
    IntersectionObserver: class { constructor(cb) { this.cb = cb; } observe(t) { this.cb([{ target: t, isIntersecting: true }]); } unobserve() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: f => frames.push(f), cancelAnimationFrame() {},
    addEventListener: (t, f) => (winL[t] ||= []).push(f), removeEventListener() {},
    dispatchEvent: e => { (winL[e.type] || []).forEach(f => f(e)); return true; },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    fetch: async p => {
      const f = join(ROOT, String(p).replace(/^\.\//, ''));
      if (!existsSync(f)) return { ok: false, status: 404 };
      const txt = readFileSync(f, 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(txt), text: async () => txt };
    },
  });
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  let bootErr = null;
  try { await import(pathToFileURL(join(ROOT, 'main.js')).href); } catch (e) { bootErr = e; }
  ok(!bootErr, `walk: main.js boots with (pointer: coarse) (${bootErr && bootErr.message})`);
  await globalThis.flyDuel?.ready;
  await new Promise(r => realST(r, 50));
  let T = 0;
  const pump = n => { for (let i = 0; i < n; i++) { const fs = frames.splice(0); T += 50; for (const f of fs) f(T); } };
  pump(60);
  const fd = globalThis.flyDuel, $ = id => document.getElementById(id);
  const wait = ms => new Promise(r => realST(r, ms));
  // touch only: what a finger tap gives a page
  let n = 0;
  const tap = el => {
    const o = { clientX: 100, clientY: 400, button: 0, buttons: 1, pointerId: 50 + (n++ % 5), pointerType: 'touch', isPrimary: true, detail: 1 };
    for (const t of ['pointerdown', 'pointerup', 'click']) { const e = new W.Event(t, { bubbles: true, cancelable: true }); Object.assign(e, o, t === 'pointerup' ? { buttons: 0 } : {}); el.dispatchEvent(e); }
  };
  const shown = el => { for (let e = el; e && e !== document.body; e = e.parentNode) if (e.hidden) return false; return true; };
  const TAP = ['click', 'pointerdown', 'pointerup', 'touchstart', 'touchend'];
  const HOVER_ONLY = ['mouseenter', 'mouseover', 'pointerenter', 'pointerover', 'contextmenu', 'dblclick', 'mousedown', 'mouseup'];
  const controls = scope => [...scope.querySelectorAll('button, a[href], select, input, [role="button"], [tabindex="0"]')].filter(shown);
  const tapPath = el => {
    if (el.matches('a[href], select, input, label')) return true;
    // a card with data-zoom: ui/cardview.js installZoom handles its tap on
    // the document (the tap test below opens one)
    if (el.closest('[data-zoom]') && L.get(document)?.has('click')) return true;
    // the control or a box round it; the document, html, body and #app
    // do not count (their listeners close menus and so on)
    for (let e = el; e && e !== document && e !== document.documentElement && e !== document.body && e.id !== 'app'; e = e.parentNode) {
      const s = L.get(e); if (s && TAP.some(t => s.has(t))) return true;
    }
    return false;
  };
  const noPath = scope => controls(scope).filter(el => !tapPath(el)).map(el => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${(el.className || '').toString().split(' ')[0]}`);
  const hoverOnly = scope => controls(scope).filter(el => { const s = L.get(el); return s && [...s].some(t => HOVER_ONLY.includes(t)) && ![...s].some(t => TAP.includes(t)) && !tapPath(el); }).length;

  // the title screen (it opens with no mode in the URL)
  const ch = $('chooser');
  ok(ch.hidden === false, 'walk: the title screen opens');
  const chNo = noPath(ch);
  ok(chNo.length === 0 && controls(ch).length > 5, `walk: every control of the title screen has a tap path (${controls(ch).length} controls${chNo.length ? '; none: ' + chNo.join(', ') : ''})`);
  tap(ch.querySelector('.fdc-mode[data-mode="watch"]'));
  tap(ch.querySelector('.fdc-go'));
  ok(ch.hidden === true && fd.app.mode === 'watch', 'walk: a tap on the watch card and Start opens the watch table');
  pump(40);
  // the watch HUD and the bar
  const hudNo = noPath($('app'));
  ok(hudNo.length === 0, `walk: every shown control of the watch table has a tap path (${controls($('app')).length} controls${hudNo.length ? '; none: ' + hudNo.join(', ') : ''})`);
  ok(hoverOnly($('app')) === 0, 'walk: no control works by hover or right-click only');
  // the check bites: a button with a hover listener only has no tap path
  {
    const box = document.createElement('div'), probe = document.createElement('button');
    probe.className = 'probe';
    probe.addEventListener('mouseenter', () => {});
    box.appendChild(probe); $('app').appendChild(box);
    const docT = [...(L.get(document) || [])].filter(t => TAP.includes(t));
    ok(noPath(box).some(x => /probe/.test(x)) && hoverOnly(box) === 1, `walk: the check finds a hover-only button (document listeners ${docT.join(',') || 'none'} do not count)`);
    box.remove();
  }
  const bar = [...document.querySelectorAll('.stagebar button')].filter(b => !['btnDecks', 'btnPlay', 'btnHow'].includes(b.id));
  const e0 = errors.length;
  for (const b of bar) { tap(b); pump(2); }
  ok(errors.length === e0, `walk: a tap on each of the ${bar.length} bar controls works with no error (${errors.slice(e0, e0 + 2).join(' | ').slice(0, 300)})`);
  ok(fd.hero.brains === 'panels' || ['scene', 'off'].includes(fd.hero.brains), `walk: the brain switch took the taps (${fd.hero.brains})`);
  tap(document.querySelector('#heroBrains button[data-v="panels"]'));
  tap(document.querySelector('#heroCam button[data-v="auto"]'));
  ok(fd.hero.brains === 'panels' && fd.hero.cam === 'auto', 'walk: a tap sets the brains and the camera back');
  // the drawer
  tap($('btnHow'));
  ok($('how').hidden === false, 'walk: a tap on "How it works" opens the drawer');
  const howNo = noPath($('how'));
  ok(howNo.length === 0, `walk: every control of the drawer has a tap path (${controls($('how')).length} controls${howNo.length ? '; none: ' + howNo.slice(0, 6).join(', ') : ''})`);
  const e1 = errors.length;
  for (const sel of ['#galSeg button', '#toySel button', '#wOpp button', '.legend button']) for (const b of [...document.querySelectorAll(sel)].slice(0, 3)) tap(b);
  for (const id of ['toyRew', 'toyPun', 'toyReset', 'spNext', 'wNext', 'wPrev']) if ($(id)) tap($(id));
  pump(4);
  ok(errors.length === e1, `walk: taps on the drawer controls give no error (${errors.slice(e1, e1 + 2).join(' | ').slice(0, 300)})`);
  const zc = [...$('how').querySelectorAll('[data-zoom]')].find(shown);
  if (zc) {
    tap(zc);
    const ins = document.querySelector('.cv-inspect');
    ok(!!ins && !ins.hidden, 'walk: a tap on a card of the drawer opens its large view (ui/cardview.js)');
    const x = ins && [...ins.querySelectorAll('button')].find(shown);
    if (x) { tap(x); ok(ins.hidden, 'walk: a tap on its close button closes it'); }
  }
  tap($('howClose'));
  ok($('how').hidden === true, 'walk: a tap on "Back to the table" closes the drawer');
  // play mode, by taps only
  tap($('btnPlay'));
  ok(ch.hidden === false, 'walk: a tap on "Play a fly" opens the title screen on play');
  tap(ch.querySelector('.fdc-go'));
  for (let i = 0; i < 300 && !fd.app.play; i++) await wait(5);
  ok(fd.app.mode === 'play' && !!fd.app.play, 'walk: a tap on Start opens play mode');
  const root = $('playRoot'), q = s => root.querySelector(s);
  for (let i = 0; i < 100 && !q('[data-call]'); i++) await wait(5);
  tap(q('[data-call="heads"]'));
  for (let i = 0; i < 100 && !q('.pl-go'); i++) await wait(5);
  tap(q('.pl-go'));
  for (let i = 0; i < 100 && !q('[data-keep]'); i++) await wait(5);
  tap(q('[data-keep]'));
  await wait(20);
  ok(q('.pl-sheet').hidden === true, 'walk: coin and keep by taps: the table is open');
  const plNo = noPath(root);
  ok(plNo.length === 0, `walk: every shown control of the play screen has a tap path (${controls(root).length} controls${plNo.length ? '; none: ' + plNo.join(', ') : ''})`);
  const pc = fd.app.play.controller;
  let mine = 0;
  for (let k = 0; k < 3000 && mine < 4 && pc.need() !== 'over'; k++) {
    await wait(1);
    if (pc.need() !== 'human' || fd.app.play.busy) continue;
    const n0 = pc.history.length;
    tap(q('.pl-pri'));
    for (let j = 0; j < 200 && pc.history.length === n0; j++) await wait(1);
    if (pc.history.length > n0) mine++;
  }
  ok(mine >= 3, `walk: the big button plays by taps (${mine} moves)`);
  tap(q('.pl-menubtn'));
  ok(q('.pl-menu').hidden === false, 'walk: a tap opens the menu');
  const mNo = noPath(q('.pl-menu'));
  ok(mNo.length === 0, `walk: every menu item has a tap path${mNo.length ? ' (none: ' + mNo.join(', ') + ')' : ''}`);
  const lg = q('.pl-menu [data-m="log"]');
  if (lg) { tap(lg); ok(q('.pl-log').hidden === false, 'walk: the log opens by a tap'); tap(q('.pl-logx')); ok(q('.pl-log').hidden === true, 'walk: and closes by a tap'); }
  const hcs = [...root.querySelectorAll('.pl-hc')].filter(e => !e.hidden);
  if (hcs.length) { tap(hcs[0]); ok(hcs[0].getAttribute('aria-pressed') === 'true' || pc.need() !== 'human', 'walk: a tap selects a hand card'); }
  fd.exitPlay();
  pump(10);
  console.error = oe; console.warn = ow;
  globalThis.setTimeout = realST;
  ok(errors.length === 0, `walk: no console.error or console.warn in the walk (${errors.length}): ${errors.slice(0, 3).join(' | ').slice(0, 600)}`);
}

console.log(`mobile: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
