// ============================================================================
//  ANIMATED PATTERN DESIGNER  ·  tests-dom.mjs — boot the page in jsdom
// ----------------------------------------------------------------------------
//    NODE_PATH=<dir>/node_modules node tests-dom.mjs     every view below,
//                                                        each in its own process
//    node tests-dom.mjs 390 844 coarse [reduced]         one view
//  jsdom resolves through JSDOM_DIR (a folder with node_modules/jsdom, or
//  the jsdom folder itself) or NODE_PATH; the file exits 0 with SKIP when
//  it cannot find it. jsdom has no layout, no canvas and no Worker: the
//  2D context is a recording stub, matchMedia reads the view below, and
//  the pattern jobs run on the main thread. No browser runs here.
//
//  CHECKS (each view): boot with no error; the panel open on a desktop and
//  closed on a phone; presets and dock; the clock moves while playing and
//  stops on pause and while the page is hidden; scrub; a field channel
//  makes a new scene, a curve change does not; loop length; a preset; a
//  morph scene; palette; random motion; SVG and GIF exports save a file
//  and show its size; a governor level lowers the canvas size and the
//  density; the saver enters, frames its board in the view, and exits.
//  The reduced view starts paused at a quarter speed.
// ============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const VIEWS = [[1280, 800, 'fine'], [390, 844, 'coarse'], [844, 390, 'coarse'], [1280, 800, 'fine', 'reduced']];
const self = fileURLToPath(import.meta.url);
if (process.argv.length < 4) {
  let bad = 0, total = 0;
  for (const v of VIEWS) {
    const r = spawnSync(process.execPath, [self, ...v.map(String)], { encoding: 'utf8', env: process.env, timeout: 300000 });
    process.stdout.write(r.stdout || ''); if (r.stderr) process.stdout.write(r.stderr);
    if (/SKIP/.test(r.stdout || '')) { console.log('SKIP: jsdom not found (set JSDOM_DIR or NODE_PATH)'); process.exit(0); }
    const m = /(\d+) passed, (\d+) failed/.exec(r.stdout || '');
    if (!m || +m[2] || r.status) bad++;
    total += m ? +m[1] : 0;
  }
  console.log(`\nall views: ${total} checks, ${bad} view(s) failed`);
  process.exit(bad ? 1 : 0);
}

let JSDOM;
try {
  const d = process.env.JSDOM_DIR;
  if (d && existsSync(d + '/lib/api.js')) ({ JSDOM } = createRequire(d + '/')(d));
  else if (d && existsSync(d + '/node_modules/jsdom')) ({ JSDOM } = createRequire(d + '/')('jsdom'));
  else ({ JSDOM } = createRequire(import.meta.url)('jsdom'));
} catch (e) { console.log('SKIP: jsdom not found (set JSDOM_DIR or NODE_PATH)'); process.exit(0); }

const [W, H] = process.argv.slice(2, 4).map(Number), coarse = process.argv[4] === 'coarse', reduced = process.argv[5] === 'reduced';
const phone = W <= 768 || (H <= 500 && coarse);
console.log(`\n# ${W}x${H} ${coarse ? 'coarse' : 'fine'}${reduced ? ' reduced-motion' : ''} (${phone ? 'phone' : 'desktop'})`);

const dir = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');
const html = readFileSync(dir + '/index.html', 'utf8');
const dom = new JSDOM(html, { url: pathToFileURL(dir + '/index.html').href, pretendToBeVisual: false });
const w = dom.window, doc = w.document;
const errors = [];
w.addEventListener('error', e => errors.push('error: ' + (e.message || e.error)));
process.on('unhandledRejection', e => errors.push('rejection: ' + (e && e.stack || e)));
const cerr = console.error; console.error = (...a) => { errors.push('console.error: ' + a.join(' ')); };
const cwarn = console.warn; console.warn = (...a) => { errors.push('console.warn: ' + a.join(' ')); };

// A media query on this view: (max-width / max-height: Npx), (pointer),
// (orientation), (prefers-reduced-motion); "," is or, "and" is and.
function matchQuery(q) {
  return q.split(',').some(part => part.split(/\band\b/).every(f => {
    const m = /\(\s*([a-z-]+)\s*:\s*([a-z0-9.]+)\s*\)/.exec(f.trim()); if (!m) return true;
    const [, k, v] = m;
    if (k === 'max-width') return W <= parseFloat(v);
    if (k === 'max-height') return H <= parseFloat(v);
    if (k === 'min-width') return W >= parseFloat(v);
    if (k === 'pointer') return (v === 'coarse') === coarse;
    if (k === 'orientation') return (v === 'landscape') === (W > H);
    if (k === 'prefers-reduced-motion') return (v === 'reduce') === reduced;
    return false;
  }));
}
Object.defineProperty(w, 'innerWidth', { value: W }); Object.defineProperty(w, 'innerHeight', { value: H });
Object.defineProperty(w, 'devicePixelRatio', { value: coarse ? 3 : 2 });
w.matchMedia = q => ({ matches: matchQuery(q), media: q, addEventListener() {}, removeEventListener() {} });
// The recording 2D context.
const calls = { fill: 0, stroke: 0, getImageData: 0 };
function ctx2d(canvas) {
  return new Proxy({ canvas }, { get(t, k) {
    if (k in t) return t[k];
    if (k === 'getImageData') return (x, y, ww, hh) => { calls.getImageData++; return { data: new Uint8ClampedArray(ww * hh * 4), width: ww, height: hh }; };
    if (k === 'measureText') return s => ({ width: String(s).length * 6 });
    if (k === 'fill' || k === 'stroke') return () => { calls[k]++; };
    return () => {};
  }, set(t, k, v) { t[k] = v; return true; } });
}
const ctxs = new WeakMap();
w.HTMLCanvasElement.prototype.getContext = function (kind) { if (kind !== '2d') return null; if (!ctxs.has(this)) ctxs.set(this, ctx2d(this)); return ctxs.get(this); };
w.HTMLCanvasElement.prototype.toBlob = function (cb, type) { setTimeout(() => cb(new w.Blob([new Uint8Array(64)], { type: type || 'image/png' })), 0); };
let downloads = [];
w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
w.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };
w.HTMLElement.prototype.setPointerCapture = function () {};
const top0 = phone ? (coarse && H <= 500 ? 0 : 46) : 52, dockH = phone ? 64 : 0;
const realRect = w.HTMLElement.prototype.getBoundingClientRect;
w.HTMLElement.prototype.getBoundingClientRect = function () {
  if (this.id === 'desk') return { left: 0, top: top0, right: W, bottom: H - dockH, width: W, height: H - dockH - top0 };
  if (this.id === 'timeline') return { left: 0, top: 0, right: 290, bottom: 40, width: 290, height: 40 };
  return realRect.call(this);
};

let hidden = false;
Object.defineProperty(doc, 'hidden', { get: () => hidden, configurable: true });
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'getComputedStyle', 'matchMedia', 'location', 'devicePixelRatio', 'innerWidth', 'innerHeight', 'localStorage', 'addEventListener']) {
  try { Object.defineProperty(globalThis, k, { value: k === 'window' ? w : typeof w[k] === 'function' && k !== 'HTMLElement' && k !== 'Node' && k !== 'Event' && k !== 'MouseEvent' ? w[k].bind(w) : w[k], configurable: true, writable: true }); } catch (e) { /* read-only */ }
}
let raf = new Map(), rafId = 0, T = 0;
globalThis.requestAnimationFrame = w.requestAnimationFrame = fn => { raf.set(++rafId, fn); return rafId; };
globalThis.cancelAnimationFrame = w.cancelAnimationFrame = id => { raf.delete(id); };
const step = n => { for (let i = 0; i < n; i++) { const q = [...raf.values()]; raf = new Map(); T += 16.7; q.forEach(f => f(T)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 60000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; step(1); await sleep(5); } return false; }

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const $ = id => doc.getElementById(id);
const click = el => (typeof el === 'string' ? $(el) : el).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const key = k => w.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));

await import(pathToFileURL(dir + '/main.js').href);
const { PRESETS } = await import(pathToFileURL(dir + '/presets.js').href);
const A = w.__pa;
ok(!!A, 'the page sets window.__pa');
ok(await until(() => A.ready), 'the first scene is ready');
step(5);

// boot and layout
ok(A.scene && A.scene.G.n > 0, `scene: ${A.scene ? A.scene.pat.name : '-'} with ${A.scene ? A.scene.G.n : 0} shapes at density ${A.scene ? A.scene.D.toFixed(2) : '-'}`);
ok($('panel').classList.contains('open') === !phone, `panel ${phone ? 'closed' : 'open'} at boot`);
ok($('presets').children.length === PRESETS.length, `${PRESETS.length} preset chips`);
ok($('dockTitle').textContent.length > 2, `dock title "${$('dockTitle').textContent}"`);
ok($('board').width > 50 && $('board').height > 50, `board canvas ${$('board').width} x ${$('board').height}`);
ok($('channels').querySelectorAll('.chan').length === 13, 'thirteen channel rows');
ok(calls.fill + calls.stroke > 0, `the board draws (${calls.fill} fills, ${calls.stroke} strokes)`);
ok(doc.querySelectorAll('[hidden]').length >= 1, 'hidden elements present');

if (reduced) {
  ok(!A.st.playing && A.st.speed === 0.25, `reduced motion: paused at ${A.st.speed}x`);
  const t0 = A.st.t; step(30);
  ok(A.st.t === t0, 'reduced motion: the clock stays');
  click('playBtn'); step(30);
  ok(A.st.playing && A.st.t > t0 && A.st.t < t0 + 0.4, `play at a quarter speed moves slowly (${(A.st.t - t0).toFixed(3)} s in 0.5 s)`);
} else {
  ok(A.st.playing, 'playing at boot');
  const t0 = A.st.t; step(30);
  ok(A.st.t > t0, `the clock moves (${t0.toFixed(2)} -> ${A.st.t.toFixed(2)})`);
  click('playBtn');
  const t1 = A.st.t; step(20);
  ok(!A.st.playing && A.st.t === t1, 'pause stops the clock');
  $('scrub').value = '500'; $('scrub').dispatchEvent(new w.Event('input'));
  ok(Math.abs(A.st.t - A.st.anim.L / 2) < 0.02, `scrub sets the time (${A.st.t.toFixed(2)})`);
  $('scrub').dispatchEvent(new w.Event('change'));
  key('.'); ok(Math.abs(A.st.t - (A.st.anim.L / 2 + 1 / 30)) < 0.01, 'the . key steps one frame');
  click('playBtn'); step(4);
  hidden = true; doc.dispatchEvent(new w.Event('visibilitychange'));
  const t2 = A.st.t; step(20);
  ok(A.st.t === t2, 'a hidden page does not move');
  hidden = false; doc.dispatchEvent(new w.Event('visibilitychange')); step(10);
  ok(A.st.t !== t2, 'the clock moves again when the page shows');
}

// motion edits
{
  const sc0 = A.scene, wave = $('channels').querySelector('.chan[data-id="wave"] .tog');
  click(wave);
  ok(A.st.anim.ch.wave.on === 1, 'a channel toggle turns the wave on');
  ok(await until(() => A.ready && A.scene !== sc0), 'a field channel makes a new scene');
  const sc1 = A.scene, seg = $('channels').querySelector('.chan[data-id="wave"] .seg button:nth-child(2)');
  click(seg); step(2);
  ok(A.st.anim.ch.wave.curve === 'ease' && A.scene === sc1 && A.player.anim.ch.wave.curve === 'ease', `a curve change compiles again with no new scene (${A.st.anim.ch.wave.curve}, same scene ${A.scene === sc1}, player ${A.player.anim.ch.wave.curve})`);
  const cy = $('channels').querySelector('.chan[data-id="wave"] .cyc button[data-d="1"]');
  click(cy); ok(A.st.anim.ch.wave.cycles === 2, 'cycles per loop goes up');
  $('loopLen').value = '12'; $('loopLen').dispatchEvent(new w.Event('change'));
  ok(A.st.anim.L === 12 && A.player.C.L === 12, 'the loop length changes');
}
{
  const pr = PRESETS[5];
  click($('presets').querySelector(`[data-id="${pr.id}"]`));
  ok(await until(() => A.ready && A.scene.pat.id === pr.pat), `preset ${pr.name} builds its scene`);
  ok($('dockTitle').textContent === pr.name, 'the dock shows the preset');
  click($('morphKind').querySelector('[data-k="seed"]'));
  ok(await until(() => A.ready && !!A.scene.B), 'a morph to a new seed builds a B scene');
  click($('morphKind').querySelector('[data-k="off"]'));
  ok(await until(() => A.ready && !A.scene.B), 'morph off');
  click($('palettes').querySelector('.pal[data-id="night"]'));
  ok(A.st.pal === 'night' && A.player.pal.id === 'night', 'a palette click sets the palette');
  const before = JSON.stringify(A.st.anim.ch);
  key('r');
  ok(JSON.stringify(A.st.anim.ch) !== before && Object.values(A.st.anim.ch).some(s => s.on), 'R gives a new motion');
  await until(() => A.ready);
}

// exports
{
  const fmtBtn = f => $('expFmt').querySelector(`[data-f="${f}"]`);
  ok($('expFmt').children.length === 5, 'five export formats');
  click(fmtBtn('svg')); const n0 = downloads.length;
  click('expGo');
  ok(await until(() => downloads.length > n0 && !A.exp.busy), 'SVG export saves a file');
  ok(/\.svg$/.test(downloads[downloads.length - 1]) && /Saved .*\d+(\.\d+)? (B|KB|MB)/.test($('exportInfo').textContent), `SVG size shown: "${$('exportInfo').textContent}"`);
  const svg = A.exp.svgText();
  ok(svg.startsWith('<svg') && /viewBox="0 0 /.test(svg) && svg.includes('</svg>'), `SVG text of the frame (${(svg.length / 1024).toFixed(0)} KB)`);
  click(fmtBtn('gif'));
  $('expSize').value = '240'; $('expSize').dispatchEvent(new w.Event('change'));
  $('expFps').value = '10'; $('expFps').dispatchEvent(new w.Event('change'));
  const P = A.exp.plan(), g0 = calls.getImageData, n1 = downloads.length;
  ok(P.n === Math.round(A.st.anim.L * 10), `GIF plan: ${P.n} frames for ${A.st.anim.L} s at 10 fps`);
  click('expGo');
  ok(await until(() => downloads.length > n1 && !A.exp.busy, 120000), 'GIF export saves a file');
  ok(calls.getImageData - g0 === P.n && /\.gif$/.test(downloads[downloads.length - 1]) && A.exp.ex.last && A.exp.ex.last.frames === P.n && A.exp.ex.last.bytes > 0, `GIF reads ${calls.getImageData - g0} frames, ${A.exp.ex.last ? A.exp.ex.last.bytes : 0} bytes`);
  click(fmtBtn('video'));
  ok(/cannot record video/.test($('exportInfo').textContent), 'no MediaRecorder: the video format says so');
}

// governor
{
  const cw = $('board').width, D0 = A.scene.D;
  A.applyLevel(3);
  ok($('board').width < cw, `level 3 lowers the canvas size (${cw} -> ${$('board').width})`);
  ok(await until(() => A.ready && A.scene.budget < (coarse ? 60000 : 200000)), `level 3 builds under a lower budget (density ${D0.toFixed(2)} -> ${A.scene.D.toFixed(2)})`);
  A.applyLevel(0); await until(() => A.ready);
  ok($('board').width >= cw - 1, 'level 0 gives the full canvas back');
}

// saver
{
  const wasPlaying = A.st.playing;
  const r = w.snSaver.enter({ seed: 5, calm: 0.5 });
  ok(r && r.canvas && doc.body.contains(r.canvas), 'snSaver.enter gives a canvas in the document');
  ok(!!$('paSaverStyle'), 'the saver hides the page controls');
  ok(await until(() => w.snSaver.debug() && w.snSaver.debug().box), 'the saver plays a shot');
  step(10);
  const d = w.snSaver.debug();
  ok(d.box.x >= 0 && d.box.y >= 0 && d.box.x + d.box.w <= W + 0.5 && d.box.y + d.box.h <= H + 0.5, `the saver board fits the view (${d.board}, ${d.box.w.toFixed(0)} x ${d.box.h.toFixed(0)})`);
  ok(d.board === (W / H > 1.5 ? 'desk' : W < H * 0.75 ? '9x16' : d.board), `the saver board follows the aspect (${d.board})`);
  ok(d.t > 0, `the saver clock moves (${d.t.toFixed(2)} s)`);
  w.snSaver.exit();
  ok(!doc.body.contains(r.canvas) && !$('paSaverStyle'), 'snSaver.exit removes the canvas and the style');
  step(5);
  ok(A.st.playing === wasPlaying, 'the page plays as before the saver');
}

// phone dock and sheet
if (phone) {
  click('dockPanel');
  ok($('panel').classList.contains('open') && $('dockPanel').getAttribute('aria-expanded') === 'true', 'the dock opens the sheet');
  click('dockPanel');
  ok(!$('panel').classList.contains('open'), 'the dock closes the sheet');
  const p0 = A.st.preset; click('dockName');
  ok(A.st.preset !== p0, 'the dock name steps to the next preset');
  await until(() => A.ready);
}

step(5); await sleep(20);
const errs = errors.filter(e => !/Not implemented: HTMLCanvasElement|Could not load link/.test(e));
ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
console.error = cerr; console.warn = cwarn;
console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
