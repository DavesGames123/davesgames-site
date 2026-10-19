// ============================================================================
//  CORAL REEF  ·  phone checks in jsdom (no browser):  node mobile-check.mjs
// ----------------------------------------------------------------------------
//  Needs jsdom 24 (npm i jsdom@24.1.3 in a scratch folder, then give that
//  folder as JSDOM_DIR or NODE_PATH). It skips with a message if jsdom is
//  not found.
//
//  For each viewport (360x740, 390x844, 430x932, 768x1024, 844x390 on a
//  coarse pointer, and 1440x900 with a mouse) it loads index.html, sets
//  the window size and a matchMedia that reads the size, and imports the
//  real main.js. jsdom has no WebGL, so scene.js gives no scene and the
//  page runs without the reef render. The shell, the dock, the sheet, the
//  chips, the gradient picker and the reef model run as on a phone.
//    dock ......... five buttons with labels: camera, feed, colour mode,
//                   plant mode, menu; no other growth control is left (v4);
//                   plant mode turns on and off from the dock
//    sheet ........ menu opens the half sheet; the grip drags it to full,
//                   back to half and closed; Escape closes it
//    explainer .... opens over the sheet, closes with Escape
//    feed ......... the SSTV camera card: a tap makes it large, a second
//                   tap or Escape small again; the squad controls (world
//                   detail, ROVs, feed and SSTV mode) are in the sheet
//    css .......... 44 px targets in the touch blocks (style.css and the
//                   panel rules of lib/sn-panel.css), 12 px text or more,
//                   safe-area insets, no fixed widths over the viewport.
//                   tests/panel.test.mjs has the other panel checks.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire, register } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The importmap of index.html, for node: 'three' and 'three/addons/'.
const VENDOR = pathToFileURL(path.join(HERE, '../../vendor/three@0.160.0/')).href;
register('data:text/javascript,' + encodeURIComponent(`
  const V = ${JSON.stringify(VENDOR)};
  export async function resolve(s, c, n) {
    if (s === 'three') return n(V + 'build/three.module.js', c);
    if (s.startsWith('three/addons/')) return n(V + 'examples/jsm/' + s.slice(13), c);
    return n(s, c);
  }`));
const require = createRequire(import.meta.url);
let JSDOM;
try {
  const dirs = [process.env.JSDOM_DIR, ...(process.env.NODE_PATH || '').split(path.delimiter)].filter(Boolean);
  ({ JSDOM } = require(require.resolve('jsdom', { paths: dirs.length ? dirs : undefined })));
} catch (e) {
  console.log('mobile-check: SKIPPED, jsdom not found (set JSDOM_DIR or NODE_PATH)');
  process.exit(0);
}

let pass = 0, fail = 0;
function ok(cond, name, info = '') {
  if (cond) pass++; else { fail++; console.log(`FAIL ${name}${info !== '' ? ' ' + info : ''}`); }
}

// matchMedia for a size: (max-width), (max-height), (min-width), (pointer),
// (orientation), (prefers-reduced-motion). Comma = or, 'and' = and.
function mediaFor(w, h, coarse) {
  const feat = f => {
    const m = f.trim().replace(/^\(|\)$/g, '').split(':').map(s => s.trim());
    const [k, v] = m, n = parseFloat(v);
    if (k === 'max-width') return w <= n;
    if (k === 'min-width') return w >= n;
    if (k === 'max-height') return h <= n;
    if (k === 'min-height') return h >= n;
    if (k === 'pointer') return (v === 'coarse') === coarse;
    if (k === 'orientation') return (v === 'landscape') === (w > h);
    return false;
  };
  return q => ({
    matches: q.split(',').some(part => part.split(/\band\b/).every(feat)),
    media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
}

const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
const VIEWS = [[360, 740, true], [390, 844, true], [430, 932, true], [768, 1024, true], [844, 390, true], [1440, 900, false]];
let run = 0;

for (const [w, h, coarse] of VIEWS) {
  const tag = `${w}x${h}${coarse ? '' : ' mouse'}`;
  const phone = w <= 768 || (h <= 500 && coarse);
  const dom = new JSDOM(html.replace(/<script type="module"[^>]*><\/script>/, ''), { url: pathToFileURL(path.join(HERE, 'index.html')).href, pretendToBeVisual: true });
  const win = dom.window;
  Object.defineProperty(win, 'innerWidth', { value: w, configurable: true });
  Object.defineProperty(win, 'innerHeight', { value: h, configurable: true });
  win.matchMedia = mediaFor(w, h, coarse);
  win.HTMLCanvasElement.prototype.getContext = () => null;     // no WebGL, no 2D canvas
  // the globals main.js reads
  const G = globalThis;
  for (const k of ['window', 'document', 'navigator', 'getComputedStyle', 'requestAnimationFrame', 'HTMLElement', 'Element', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent']) {
    Object.defineProperty(G, k, { value: k === 'window' ? win : (typeof win[k] === 'function' && /^[a-z]/.test(k) ? win[k].bind(win) : win[k]), configurable: true, writable: true });
  }
  G.matchMedia = win.matchMedia;
  G.addEventListener = win.addEventListener.bind(win);
  G.devicePixelRatio = 3;
  G.innerWidth = w; G.innerHeight = h;
  const errs = [], cerr = console.error;
  console.error = (...a) => { if (!/^THREE\.WebGLRenderer/.test(String(a[0]))) cerr(...a); };
  try {
    await import(pathToFileURL(path.join(HERE, 'main.js')).href + `?v=${run++}`);
  } catch (e) { errs.push(e); }
  console.error = cerr;
  ok(errs.length === 0, `${tag}: main.js runs in jsdom with no scene`, errs.map(e => e.stack).join('\n'));
  if (errs.length) continue;
  const doc = win.document, $ = id => doc.getElementById(id);
  const click = id => $(id).dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  ok(!$('nogl').hidden, `${tag}: no WebGL shows the message (jsdom has none)`);

  // dock (v4: no growth controls, CONTRACT-V4.md)
  const dock = [...doc.querySelectorAll('#dock > button')];
  ok(dock.map(b => b.id).join() === 'dockCam,dockFeed,dockMode,dockPlant,dockMenu', `${tag}: the dock has camera, feed, colour mode, plant, menu`, dock.map(b => b.id).join());
  ok(dock.every(b => b.getAttribute('aria-label') && b.querySelector('span').textContent.trim()), `${tag}: each dock button has a label`);
  const panel = $('panel');
  ok(panel.classList.contains('open') === !phone, `${tag}: the panel is ${phone ? 'closed' : 'open'} at load`);
  ok(!$('dockPlay') && !$('bRegrow') && !$('sSpeed') && !$('sNut') && !$('plantBar') && !$('spParams'), `${tag}: no growth control is left (grow, regrow, speed, nutrients, dlaf parameters)`);
  // plant mode (world/plant.js): the dock button and the panel switch agree
  click('dockPlant');
  const pOn = $('dockPlant').getAttribute('aria-pressed') === 'true' && $('tPlant').checked && doc.body.classList.contains('planting');
  click('dockPlant');
  const pOff = $('dockPlant').getAttribute('aria-pressed') === 'false' && !$('tPlant').checked && !doc.body.classList.contains('planting');
  ok(pOn && pOff && $('sPlant') && $('sPlant').value === 'random' && $('sPlant').options.length > 30, `${tag}: the dock plant button turns plant mode on and off; the species list starts at Random`, `${pOn} ${pOff} ${$('sPlant') ? $('sPlant').options.length : 0} options`);

  // colour mode
  const m0 = $('dockModeName').textContent;
  click('dockMode');
  const on = doc.querySelector('#modes button.on');
  ok($('dockModeName').textContent !== m0 && on && on.textContent === $('dockModeName').textContent, `${tag}: the dock colour button goes to the next colour mode`, `${m0} -> ${$('dockModeName').textContent}`);

  // the sheet
  if (phone) {
    click('dockMenu');
    ok(panel.classList.contains('open') && !panel.classList.contains('full') && $('dockMenu').getAttribute('aria-expanded') === 'true', `${tag}: menu opens the half sheet`);
    const grip = $('sheetGrip');
    const drag = dy => {
      grip.dispatchEvent(new win.MouseEvent('pointerdown', { clientY: 400, bubbles: true }));
      grip.dispatchEvent(new win.MouseEvent('pointermove', { clientY: 400 + dy, bubbles: true }));
      grip.dispatchEvent(new win.MouseEvent('pointerup', { clientY: 400 + dy, bubbles: true }));
    };
    drag(-90); ok(panel.classList.contains('full'), `${tag}: the grip drags the sheet to full height`);
    drag(90); ok(panel.classList.contains('open') && !panel.classList.contains('full'), `${tag}: the grip drags it back to half`);
    drag(90); ok(!panel.classList.contains('open') && doc.body.classList.contains('panel-closed'), `${tag}: the grip drags it closed`);
    ok(panel.style.transform === '', `${tag}: no drag offset stays on the sheet`);
    click('dockMenu');
    win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }));
    ok(!panel.classList.contains('open'), `${tag}: Escape closes the sheet`);
    for (const g of ['explore', 'view', 'look', 'world', 'about']) ok(panel.querySelector(`.snp-sec[data-sec=${g}]`), `${tag}: the sheet holds the ${g} section`);
    ok(['gradPick', 'modes', 'sDir', 'sCur', 'sTemp', 'sCaust', 'quality', 'rovCount', 'feedMode', 'sstvMode', 'tBeam', 'tFeed', 'bSeed', 'bLead'].every(id => panel.contains($(id))), `${tag}: gradient, colour by, current, temperature, caustics, world detail, ROVs, feed and SSTV modes, beams, feed, new world and follow the lead are in the sheet`);
    ok($('quality').querySelectorAll('button').length === 4 && $('rovCount').querySelectorAll('button').length === 3 && $('sstvMode').querySelectorAll('button').length === 2, `${tag}: detail, ROV and SSTV mode chips`);
  }

  // the feed card (no scene in jsdom: show it by hand to test the toggle)
  $('feed').hidden = false;
  click('feedSize');
  ok($('feed').classList.contains('big') && $('feedSize').getAttribute('aria-pressed') === 'true', `${tag}: a tap on the feed card makes it large`);
  win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }));
  ok(!$('feed').classList.contains('big'), `${tag}: Escape makes the feed card small again`);
  click('feedSize'); click('feedSize');
  ok(!$('feed').classList.contains('big'), `${tag}: a second tap makes the feed card small`);
  $('feed').hidden = true;

  // explainer
  if (phone) click('dockMenu');
  click('aboutOpen');
  ok(!$('about').hidden && (!phone || !panel.classList.contains('open')), `${tag}: the explainer opens${phone ? ' and the sheet closes' : ''}`);
  ok($('about').querySelector('.ab-head #aboutClose'), `${tag}: the explainer close button is in its sticky head`);
  win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }));
  ok($('about').hidden, `${tag}: Escape closes the explainer`);
  win.close();
}

// ── css ─────────────────────────────────────────────────────────────────────
{
  const page = fs.readFileSync(path.join(HERE, 'style.css'), 'utf8');
  const lib = fs.readFileSync(path.join(HERE, '../../lib/sn-panel.css'), 'utf8');
  const blockOf = css => (start) => {
    const i = css.indexOf(start); if (i < 0) return '';
    let d = 0, j = css.indexOf('{', i);
    for (let k = j; k < css.length; k++) { if (css[k] === '{') d++; else if (css[k] === '}' && --d === 0) return css.slice(j, k + 1); }
    return '';
  };
  const TQ = '@media (pointer:coarse), (max-width:768px)', PQ = '@media (max-width:768px), (max-height:500px) and (pointer:coarse)';
  const touch = blockOf(page)(TQ), phoneB = blockOf(page)(PQ), lTouch = blockOf(lib)(TQ), lPhone = blockOf(lib)(PQ);
  const css = page + lib;
  ok(touch && phoneB && lTouch && lPhone, 'css: the touch and phone blocks are there (style.css and sn-panel.css)');
  for (const sel of ['.snp-head{min-height:44px', '.snp-chips .snp-opt{min-height:44px', '.snp-btn{min-height:44px', '.snp-tlabel{min-height:44px', '.snp-sel{min-height:44px', '.snp-iconbtn{width:44px;height:44px', '.snp-link{min-height:44px', '.snp-info{width:44px;height:44px']) ok(lTouch.includes(sel), `css: the panel touch block sizes ${sel.split('{')[0]} to 44 px`);
  ok(touch.includes('#aboutClose{width:44px;height:44px'), 'css: the touch block sizes #aboutClose to 44 px');
  ok(/\.snp-range::-webkit-slider-thumb\{[^}]*width:24px;height:24px/.test(lTouch) && /\.snp-range\{height:44px/.test(lTouch), 'css: thumb sliders, 24 px thumbs on a 44 px track');
  ok(/#feed\{[^}]*width:150px/.test(phoneB) && /#feed\.big\{[^}]*width:calc\(100vw - 16px\)/.test(phoneB), 'css: the phone feed card is small (150 px) and full width when large');
  ok(/\.snp-dock > button\{[^}]*height:48px/.test(lPhone) && /\.snp-grip\{[^}]*height:44px/.test(lPhone), 'css: dock buttons 48 px, grip 44 px');
  ok(['safe-area-inset-bottom', 'safe-area-inset-left', 'safe-area-inset-right', 'safe-area-inset-top'].every(s => phoneB.includes(s)), 'css: the phone block uses all four safe-area insets');
  const small = [...css.matchAll(/font(?:-size)?:\s*(?:\d+\s+)?([\d.]+)rem/g)].map(m => +m[1]).filter(v => v < 0.75);
  ok(small.length === 0, 'css: no text under 12 px (0.75rem)', small.join());
  const wide = [...css.matchAll(/(?:^|[;{])\s*(?:min-)?width:\s*(\d+)px/g)].map(m => +m[1]).filter(v => v > 360);
  ok(wide.length === 0, 'css: no fixed width over 360 px', wide.join());
  ok(/html,body\{[^}]*overflow:hidden/.test(css) && /\.snp\{[^}]*overflow-x:hidden/.test(lib) && /#about\{[^}]*overflow-x:hidden/.test(css), 'css: no horizontal scroll on the page, the panel or the explainer');
}

console.log(`mobile-check: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);          // the page timers of the closed windows do not run
