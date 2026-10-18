// CNN Explainer · tests/page.test.mjs
// Boots the page in jsdom at a desktop and a phone size, with a stub 2D
// canvas context, and checks: no errors, the guided run (it visits every
// layer in order, opens its zooms in place, lights the explainer, ends on
// the answer; pause, step, scrub, speed), a zoom the reader opens (it grows
// in place, the run waits and goes on), "Show me", the class bars, every
// example, the zoom of each layer type, the keyboard, hover tips, colours,
// the explainer widgets, and the screensaver (it plays the same run). A third boot
// with prefers-reduced-motion checks the fade path.
// page.advance(dt) is one frame of the page; the tests call it to play the
// run fast (the jsdom frame loop runs too, between the awaits).
// Needs jsdom on NODE_PATH (or JSDOM_DIR); without it the test SKIPs and
// exits 1, so a run without jsdom never passes as green.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { barWidths } from '../draw.js';
import { densePhases } from '../scenes.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(HERE, '..');
let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) pass++; else { fail++; console.log('FAIL  ' + m + (d ? '  ' + d : '')); } };

let JSDOM = null, VirtualConsole = null;
for (const base of [process.env.JSDOM_DIR, process.env.NODE_PATH && path.join(process.env.NODE_PATH, 'jsdom')].filter(Boolean)) {
  try { ({ JSDOM, VirtualConsole } = createRequire(path.join(base, 'package.json'))(base)); break; } catch (e) { /* next */ }
}
if (!JSDOM) { console.log('SKIP  page: jsdom not found (set NODE_PATH or JSDOM_DIR)'); console.log('page: 0 passed, 1 failed'); process.exit(1); }

// a 2D context that does nothing but keeps image data shapes and counts calls
function fakeContext(calls) {
  const base = {
    canvas: null,
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(128) }),
    measureText: s => ({ width: String(s).length * 6 }),
    setLineDash() {}, getLineDash: () => [],
  };
  return new Proxy(base, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'string' && /^[a-z]/.test(k) && !['fillStyle', 'strokeStyle', 'font', 'lineWidth', 'globalAlpha', 'textAlign', 'textBaseline', 'imageSmoothingEnabled'].includes(k)) {
        return (...a) => { calls[k] = (calls[k] || 0) + 1; if (k === 'drawImage' && (!a[0] || a[0].width == null)) throw new Error('drawImage of a non-image'); };
      }
      return t['_' + String(k)];
    },
    set(t, k, v) { t['_' + String(k)] = v; return true; },
  });
}

const wait = ms => new Promise(r => setTimeout(r, ms));

async function bootAt({ name, width, height, phone, reduce = false }) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!/Not implemented: (HTMLCanvasElement|window.scrollTo|HTMLMediaElement)/.test(e.message)) errors.push('jsdom: ' + e.message); });
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
  const html = fs.readFileSync(path.join(PAGE, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: pathToFileURL(path.join(PAGE, 'index.html')).href, pretendToBeVisual: true, virtualConsole: vc });
  const win = dom.window;
  const calls = {};
  win.HTMLCanvasElement.prototype.getContext = function () { if (!this.__ctx) { this.__ctx = fakeContext(calls); } return this.__ctx; };
  win.innerWidth = width; win.innerHeight = height;
  win.matchMedia = q => ({ matches: q.includes('max-width: 768px') ? phone : q.includes('reduced-motion') ? reduce : false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {} });
  win.__cnnNoAutoBoot = true;
  win.__cnnLoadBytes = async url => new Uint8Array(fs.readFileSync(fileURLToPath(url)));
  win.addEventListener('error', e => errors.push('window error: ' + (e.error && e.error.stack || e.message)));
  // the page modules read these globals at call time
  globalThis.window = win; globalThis.document = win.document;
  for (const k of ['HTMLElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle']) {
    try { globalThis[k] = win[k]; } catch (e) { /* read-only in this node */ }
  }
  const origErr = console.error; console.error = (...a) => { errors.push('console.error: ' + a.map(String).join(' ')); };
  const origWarn = console.warn; const warns = []; console.warn = (...a) => { warns.push(a.map(String).join(' ')); };
  const mod = await import(pathToFileURL(path.join(PAGE, 'main.js')).href);
  let page = null;
  try { page = await mod.boot(); } catch (e) { errors.push('boot threw: ' + e.stack); }
  await wait(120);
  return { dom, win, doc: win.document, page, errors, warns, calls, restore() { console.error = origErr; console.warn = origWarn; dom.window.close(); } };
}

for (const size of [{ name: 'desktop 1280x800', width: 1280, height: 800, phone: false }, { name: 'phone 390x844', width: 390, height: 844, phone: true }]) {
  const T = await bootAt(size), { win, doc, page } = T, N = size.name;
  try {
    ok(page && page.state.booted && !page.state.failed, `${N}: booted`, String(page && page.state.failed));
    ok(page.state.result && page.state.result.label === 'espresso', `${N}: the first photo is an espresso`, page.state.result && page.state.result.label);
    ok(/Looking/.test(doc.getElementById('pred').textContent), `${N}: the topbar waits for the run`, doc.getElementById('pred').textContent);
    ok(doc.querySelectorAll('#stripEx .ex-btn').length === 20, `${N}: 20 example buttons`);
    ok(doc.querySelector('#stripEx .ex-btn[aria-checked="true"]').dataset.i === '12', `${N}: the espresso button is checked`);
    ok(doc.querySelectorAll('#learnBody .ex-sec').length >= 8, `${N}: the explainer has its sections`);
    ok(doc.querySelector('.pg-cv') && doc.querySelector('.act-plot'), `${N}: the playground and activation widgets are there`);
    const L = page.state.L;
    ok(L && L.orient === (size.phone ? 'v' : 'h'), `${N}: layout ${size.phone ? 'blocks' : 'columns'}`, L && L.orient);
    if (size.phone) {
      ok(!doc.getElementById('learn').classList.contains('open'), `${N}: the explainer sheet starts closed`);
      ok(parseInt(doc.getElementById('netCv').style.height, 10) === L.h, `${N}: the canvas is as tall as the blocks`);
      doc.getElementById('dockLearn').click();
      ok(doc.getElementById('learn').classList.contains('open'), `${N}: Learn opens the sheet`);
      doc.getElementById('dockLearn').click();
    } else {
      ok(doc.getElementById('learn').classList.contains('open'), `${N}: the explainer column is open`);
    }
    // ── the guided run ──────────────────────────────────────────────────
    const tour = page.tour, S = page.state;
    ok(tour.playing && tour.at().seg.li === 0, `${N}: the run plays from the input at boot`, `${tour.playing} ${tour.t}`);
    ok(doc.querySelector('#ex-input.on') && /red, green and blue/.test(doc.getElementById('tCap').textContent), `${N}: the run lights the input step and its caption`, doc.getElementById('tCap').textContent);
    ok(doc.body.classList.contains('run-on'), `${N}: the body knows the run is on`);
    ok(doc.querySelectorAll('#tTrack .t-seg').length === 12, `${N}: the scrubber has one part for each layer`);
    {
      tour.seek(0); tour.playing = true; S.segI = -1; S.visits = [];
      const secs = [], kinds = [], modes = new Set();
      let maxF = 0, minScale = 9, idScale = false, panelIn = true, scanMoved = false, denseEnd = false, convT0 = null;
      for (let i = 0; i < 2000 && !tour.ended; i++) {
        page.advance(0.05);
        const cur = doc.querySelector('#learnBody .ex-sec.on'); if (cur && secs[secs.length - 1] !== cur.id) secs.push(cur.id);
        const det = doc.getElementById('detail');
        if (!det.hidden) {
          if (kinds[kinds.length - 1] !== det.dataset.kind) kinds.push(det.dataset.kind);
          modes.add(det.dataset.mode);
          const z = S.zoom; maxF = Math.max(maxF, z ? z.f : 0);
          const m = /scale\(([\d.]+), ([\d.]+)\)/.exec(det.style.transform || '');
          if (m) minScale = Math.min(minScale, +m[1]);
          if (z && z.f === 1 && (!det.style.transform || /scale\(1\.0000, 1\.0000\)/.test(det.style.transform))) idScale = true;
          const fz = S.Lfull && S.Lfull.zoom;
          if (fz && !(parseFloat(det.style.left) === fz.x && parseFloat(det.style.width) === fz.w)) panelIn = false;
          const at = tour.at(), D = page.detail;
          if (at.seg.zoom === 'conv') { if (convT0 == null) convT0 = D.t; else if (D.t > convT0 + 3) scanMoved = true; }
          if (at.seg.zoom === 'dense' && at.local > at.seg.sec - 1.2 && at.local < at.seg.sec - 0.2) denseEnd = denseEnd || D.t === 0.999;
        }
      }
      ok(tour.ended && !tour.playing, `${N}: the run gets to the end`, `${tour.t.toFixed(1)} of ${page.plan.total.toFixed(1)}`);
      ok(S.visits.join() === '0,1,2,3,4,5,6,7,8,9,10,11', `${N}: the run visits every layer in order`, S.visits.join());
      ok(secs.join() === 'ex-input,ex-conv,ex-relu,ex-conv,ex-relu,ex-pool,ex-deep,ex-out', `${N}: the explainer follows the run`, secs.join());
      if (!size.phone) ok(page.explain.st.lastScroll && page.explain.st.lastScroll.id === 'out' && page.explain.st.lastScroll.behavior === 'smooth', `${N}: the explainer column scrolls to the step`, JSON.stringify(page.explain.st.lastScroll));
      else ok(!doc.getElementById('learn').classList.contains('open'), `${N}: the closed explainer sheet stays closed`);
      ok(kinds.join() === 'conv,relu,pool,dense' && modes.size === 1 && modes.has('tour'), `${N}: the run zooms into a conv, a ReLU, a pool and the softmax`, kinds.join() + ' ' + [...modes].join());
      ok(maxF === 1 && minScale < 0.3 && idScale, `${N}: each zoom grows out of its map and opens fully`, `${maxF} ${minScale} ${idScale}`);
      ok(panelIn, `${N}: the zoom panel sits in the open column`);
      ok(scanMoved, `${N}: the kernel moves in the conv zoom of the run`);
      ok(denseEnd, `${N}: the softmax zoom of the run ends on the probabilities (t 0.999)`);
      ok(doc.getElementById('detail').hidden && !S.zoom, `${N}: the last zoom closes before the end`);
      ok(/espresso/.test(doc.getElementById('pred').textContent) && /%/.test(doc.getElementById('pred').textContent), `${N}: the topbar names the answer at the end`, doc.getElementById('pred').textContent);
      ok(/It sees espresso/.test(doc.getElementById('tCap').textContent), `${N}: the caption names the answer`, doc.getElementById('tCap').textContent);
      ok(!doc.body.classList.contains('run-on') && doc.getElementById('tPlay').getAttribute('aria-label') === 'Play the run again', `${N}: the play button offers a replay`);
      ok(T.calls.drawImage > 50, `${N}: the overview drew the maps`, String(T.calls.drawImage));
      // the class bars: drawn widths are the probabilities
      const pr = S.result.probs, bw = barWidths(S.L, pr, 1);
      ok(S.bars && S.bars.every((w, i) => Math.abs(w - bw[i]) < 1e-9), `${N}: the class bars have their full widths`);
      ok(Math.abs(S.bars[S.result.top] - pr[S.result.top] * S.L.bars[S.result.top].w) < 1e-6 && pr[S.result.top] > 0.5, `${N}: the top bar is its probability`, `${S.bars[S.result.top]} vs ${pr[S.result.top]}`);
      ok(S.bars.reduce((a, w, i) => a + (w > 0 && w < 8 ? 0 : w / S.L.bars[i].w), 0) <= 1.0001, `${N}: the bars add up to at most 1`);
      // the softmax zoom of the run, near its end: the scene shows every phase
      const dz = page.plan.segs.find(q => q.zoom === 'dense');
      tour.seek(dz.t0 + dz.sec - 1); tour.pause(); page.advance(0);
      const ph = densePhases(page.detail.t);
      ok(S.zoom && S.zoom.mode === 'tour' && doc.getElementById('detail').dataset.kind === 'dense' && ph.a3 === 1 && ph.a4 === 1, `${N}: the softmax zoom shows full probability bars near its end`, String(page.detail.t));
    }
    // pause, step, scrub, speed
    {
      const track = doc.getElementById('tTrack');
      track.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
      page.advance(0);
      ok(tour.t === 0 && !S.zoom, `${N}: Home goes to the start`);
      tour.playing = true;
      doc.getElementById('tPlay').click();
      const t0 = tour.t; page.advance(1);
      ok(!tour.playing && tour.t === t0, `${N}: the play button pauses the run`);
      doc.getElementById('tNext').click(); doc.getElementById('tNext').click(); doc.getElementById('tNext').click(); page.advance(0);
      ok(tour.at().seg.li === 3 && doc.querySelector('#ex-conv.on') && /Conv 1·2/.test(doc.getElementById('tCap').textContent), `${N}: three steps on: Conv 1·2`, tour.at().seg.li + ' ' + doc.getElementById('tCap').textContent);
      doc.getElementById('tPrev').click(); page.advance(0);
      ok(tour.at().seg.li === 2 && doc.querySelector('#ex-relu.on'), `${N}: a step back: ReLU 1·1`, String(tour.at().seg.li));
      ok(!tour.playing, `${N}: a step keeps the run paused`);
      track.getBoundingClientRect = () => ({ left: 100, top: 0, width: 1000, height: 16, right: 1100, bottom: 16, x: 100, y: 0 });
      track.dispatchEvent(new win.MouseEvent('pointerdown', { clientX: 600, clientY: 8, bubbles: true }));
      track.dispatchEvent(new win.MouseEvent('pointermove', { clientX: 650, clientY: 8, bubbles: true }));
      track.dispatchEvent(new win.MouseEvent('pointerup', { clientX: 650, clientY: 8, bubbles: true }));
      page.advance(0);
      ok(Math.abs(tour.t - page.plan.total * 0.55) < 1e-6 && track.getAttribute('aria-valuenow') === '55', `${N}: the scrubber seeks`, `${tour.t} ${track.getAttribute('aria-valuenow')}`);
      const sp = doc.getElementById('tSpeed'); sp.value = '2'; sp.dispatchEvent(new win.Event('change', { bubbles: true }));
      tour.playing = true; const t1 = tour.t; page.advance(0.5);
      ok(tour.speed === 2 && Math.abs(tour.t - t1 - 1) < 1e-6, `${N}: speed 2 plays twice as fast`, `${tour.speed} ${tour.t - t1}`);
      sp.value = '1'; sp.dispatchEvent(new win.Event('change', { bubbles: true }));
      track.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'End', bubbles: true })); page.advance(0);
      ok(tour.ended && /espresso/.test(doc.getElementById('pred').textContent), `${N}: End shows the answer`);
      track.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); page.advance(0);
      ok(!tour.ended && tour.at().seg.li === 11 && /Looking/.test(doc.getElementById('pred').textContent), `${N}: a step back from the end hides the answer again`, doc.getElementById('pred').textContent);
    }
    // "Show me" moves the run to its layer
    {
      for (const [sec, li] of [['pool', 5], ['conv', 1], ['deep', 6], ['out', 11], ['input', 0]]) {
        tour.pause();
        doc.querySelector(`#ex-${sec} .ex-show`).click(); page.advance(0.02);
        ok(tour.at().seg.li === li && tour.playing && doc.querySelector(`#ex-${sec}.on`), `${N}: "Show me" in ${sec} goes to layer ${li} and plays`, `${tour.at().seg.li} ${tour.playing}`);
        ok(doc.getElementById('detail').hidden || doc.getElementById('detail').dataset.mode === 'tour', `${N}: "Show me" in ${sec} opens no separate card`);
      }
    }
    // a zoom the reader opens: in place, the run waits, then goes on
    {
      const stop6 = tour.stopOf(6); tour.seek(stop6.t0 + 0.3); tour.playing = true; S.segI = -1; page.advance(0);
      const m3 = S.L.maps.find(q => q.li === 3 && q.c === 2), cvx = doc.getElementById('netCv');
      cvx.dispatchEvent(new win.MouseEvent('click', { clientX: m3.x + m3.s / 2, clientY: m3.y + m3.s / 2, bubbles: true }));
      const det = doc.getElementById('detail'), tz = tour.t;
      ok(S.zoom && S.zoom.mode === 'user' && !tour.playing && !det.hidden && det.dataset.kind === 'conv' && det.dataset.mode === 'user', `${N}: a click on a map zooms into it and the run waits`);
      page.advance(0.25);
      ok(S.zoom.f > 0.2 && S.zoom.f < 0.8 && /scale\(0\.\d+/.test(det.style.transform), `${N}: the zoom grows out of the map`, `${S.zoom.f} ${det.style.transform}`);
      page.advance(0.6);
      const Z = S.Lfull.zoom;
      ok(S.zoom.f === 1 && S.L.zoom && S.L.zoom.li === 3 && parseFloat(det.style.width) === Z.w, `${N}: the column of the map is open`, JSON.stringify(Z));
      if (S.L.orient === 'h') ok(S.L.maps.filter(q => q.li !== 3).every(q => q.x + q.s <= Z.x || q.x >= Z.x + Z.w), `${N}: the other columns make room`);
      else ok(S.L.maps.filter(q => q.li > 3).every(q => q.y >= Z.y + Z.h) && parseInt(cvx.style.height, 10) === S.Lfull.h, `${N}: the blocks under it move down`);
      ok(tour.t === tz, `${N}: the run waits while the zoom is open`);
      doc.getElementById('dClose').click();
      page.advance(0.3); ok(S.zoom && S.zoom.f < 1, `${N}: close shrinks the zoom back`);
      page.advance(0.4);
      ok(!S.zoom && det.hidden && tour.playing, `${N}: after the zoom the run goes on`, `${!!S.zoom} ${det.hidden} ${tour.playing}`);
      page.advance(0.5); ok(tour.t > tz, `${N}: the run moves again`);
      // left alone, the zoom closes by itself and the run goes on
      const m5 = S.L.maps.find(q => q.li === 5 && q.c === 1);
      cvx.dispatchEvent(new win.MouseEvent('click', { clientX: m5.x + 2, clientY: m5.y + 2, bubbles: true }));
      const dbg0 = JSON.stringify(S.zoom && { ...S.zoom, seg: undefined });
      for (let i = 0; i < 85; i++) page.advance(0.1);
      ok(S.zoom && S.zoom.f === 1, `${N}: an untouched zoom stays open for 8 s`);
      for (let i = 0; i < 15; i++) page.advance(0.1);
      ok(!S.zoom && tour.playing, `${N}: an untouched zoom closes after its time`, dbg0 + ' -> ' + JSON.stringify(S.zoom && { ...S.zoom, seg: undefined }) + ' ' + tour.playing);
      // touched, it stays until the reader closes it
      cvx.dispatchEvent(new win.MouseEvent('click', { clientX: m5.x + 2, clientY: m5.y + 2, bubbles: true }));
      page.advance(1); doc.getElementById('dNext').click();
      for (let i = 0; i < 120; i++) page.advance(0.1);
      ok(S.zoom && S.zoom.f === 1 && !tour.playing, `${N}: a touched zoom stays open`);
      det.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      page.advance(1);
      ok(!S.zoom && tour.playing, `${N}: Esc closes it and the run goes on`);
      // a click on a layer ahead of the run moves the run there
      tour.seek(0.5); tour.playing = true; page.advance(0);
      const m8 = S.L.maps.find(q => q.li === 8 && q.c === 0);
      cvx.dispatchEvent(new win.MouseEvent('click', { clientX: m8.x + 2, clientY: m8.y + 2, bubbles: true }));
      page.advance(1);
      ok(S.zoom && S.zoom.spec.li === 8 && page.state.visits && tour.at().seg.li === 8, `${N}: a zoom ahead of the run shows that layer`, String(tour.at().seg.li));
      doc.getElementById('dClose').click(); page.advance(1);
      ok(!S.zoom && tour.playing && tour.at().seg.li === 9, `${N}: then the run goes on after it`, String(tour.at().seg.li));
      // a step in the run's own zoom makes it the reader's zoom
      const cz = page.plan.segs.find(q => q.zoom === 'conv');
      tour.seek(cz.t0 + 2); tour.playing = true; page.advance(0);
      ok(S.zoom && S.zoom.mode === 'tour', `${N}: the run's conv zoom is open`);
      det.dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
      doc.getElementById('detailCv').dispatchEvent(new win.MouseEvent('click', { clientX: 1, clientY: 1, bubbles: true }));
      page.advance(0.1);
      ok(S.zoom && S.zoom.mode === 'tour', `${N}: a click on empty canvas leaves the run's zoom`);
      doc.getElementById('dNext').click(); page.advance(2);
      ok(S.zoom && S.zoom.mode === 'user' && !tour.playing && det.dataset.mode === 'user', `${N}: a step in the run's zoom keeps it open for the reader`);
      doc.getElementById('dClose').click(); page.advance(1);
      ok(!S.zoom && tour.playing && tour.at().seg.li === 2, `${N}: then the run goes on after that zoom`, String(tour.at().seg.li));
    }
    // a click on a column title zooms into the busiest map of that column
    {
      tour.seek(page.plan.total); page.advance(0);
      const col = S.L.cols.find(q => q.li === 7), cvx = doc.getElementById('netCv');
      const y = S.L.orient === 'h' ? S.L.head - 12 : col.y + 10;
      cvx.dispatchEvent(new win.MouseEvent('click', { clientX: col.x + col.w / 2, clientY: y, bubbles: true }));
      ok(S.zoom && S.zoom.spec.li === 7 && doc.getElementById('detail').dataset.kind === 'relu', `${N}: a click on a column title zooms into it`, JSON.stringify(S.zoom && S.zoom.spec));
      doc.getElementById('dClose').click(); page.advance(1);
      ok(!S.zoom && tour.ended, `${N}: after the end, a closed zoom leaves the run at the end`);
    }
    if (size.phone) {
      // the phone run scrolls the diagram to each block
      tour.seek(0); tour.playing = true; S.segI = -1; const tops = [];
      for (let i = 0; i < 2000 && !tour.ended; i++) { page.advance(0.05); if (S.follow && tops[tops.length - 1] !== S.follow.top) tops.push(S.follow.top); }
      ok(tops.length >= 10 && tops[0] < 200 && Math.max(...tops) > 1500, `${N}: the run scrolls down the blocks`, tops.map(Math.round).join(','));
      ok(S.follow && S.follow.behavior === 'smooth', `${N}: the phone scroll is smooth`);
    }
    // every example: top-1 is its class
    const wrong = [];
    page.examples.forEach((ex, i) => { const r = page.runExample(i); if (r.label !== ex.cls) wrong.push(i + ':' + r.label); });
    ok(wrong.length === 0, `${N}: each example is classified as its class`, wrong.join(' '));
    page.runExample(12);
    // hover: a tip with a value, and links drawn
    const m = L.maps.find(q => q.li === 6 && q.c === 2);
    const cv = doc.getElementById('netCv');
    cv.dispatchEvent(new win.MouseEvent('pointermove', { clientX: m.x + m.s / 2, clientY: m.y + m.s / 2, bubbles: true }));
    await wait(40);
    ok(page.state.hover && page.state.hover.li === 6 && page.state.hover.c === 2, `${N}: hover finds Conv 2·1 map 3`, JSON.stringify(page.state.hover));
    if (!size.phone) ok(!doc.getElementById('netTip').hidden && /Conv 2·1/.test(doc.getElementById('netTip').textContent), `${N}: the tip names the map`, doc.getElementById('netTip').textContent);
    // click opens the zoom of that map
    cv.dispatchEvent(new win.MouseEvent('click', { clientX: m.x + m.s / 2, clientY: m.y + m.s / 2, bubbles: true }));
    await wait(60);
    ok(!doc.getElementById('detail').hidden && doc.getElementById('detail').dataset.kind === 'conv', `${N}: a click opens the conv detail`);
    ok(/Conv 2·1/.test(doc.getElementById('detailTitle').textContent), `${N}: the detail title`, doc.getElementById('detailTitle').textContent);
    // every layer type plays a few frames with no error
    for (const [li, c, kind] of [[0, -1, 'input'], [1, 0, 'conv'], [2, 3, 'relu'], [5, 9, 'pool'], [10, 1, 'pool'], [11, null, 'dense']]) {
      const before = T.errors.length, warn0 = T.warns.length;
      page.openDetail({ li, c });
      await wait(80);
      doc.getElementById('dNext').click(); doc.getElementById('dNext').click();
      ok(doc.getElementById('detail').dataset.kind === kind && T.errors.length === before && !T.warns.slice(warn0).some(w => /detail frame/.test(w)), `${N}: detail of layer ${li} (${kind}) runs`, T.errors.slice(before).concat(T.warns.slice(warn0)).join(' | '));
      ok(doc.getElementById('detailText').textContent.length > 60, `${N}: detail of layer ${li} has its text`);
    }
    ok(/score|probability/.test(doc.getElementById('detailLive').textContent), `${N}: the live line speaks the softmax`, doc.getElementById('detailLive').textContent);
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    page.advance(1);
    ok(doc.getElementById('detail').hidden, `${N}: Esc closes the zoom`);
    // keyboard on the overview: the focus starts on the last opened map
    page.openDetail({ li: 1, c: 0 }); doc.getElementById('dClose').click();
    cv.focus();
    cv.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    cv.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    ok(/ReLU 1·1, map 2 of 10/.test(doc.getElementById('netLive').textContent), `${N}: arrow keys move the focus`, doc.getElementById('netLive').textContent);
    cv.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    ok(!doc.getElementById('detail').hidden && doc.getElementById('detail').dataset.kind === 'relu', `${N}: Enter opens the focused map`);
    doc.getElementById('dClose').click();
    // colours: a new gradient and scale repaint the maps
    const d0 = T.calls.putImageData || 0;
    doc.getElementById('viewBtn').click();
    ok(!doc.getElementById('viewPop').hidden, `${N}: Colours opens the pop-up`);
    doc.querySelector('#gradHost .gg-sw[data-id="viridis"]').click();
    doc.querySelector('#scaleSeg button[data-id="map"]').click();
    ok(page.state.grad === 'viridis' && page.state.scale === 'map' && (T.calls.putImageData || 0) > d0 + 100, `${N}: gradient and scale repaint`, `${page.state.grad} ${page.state.scale} ${(T.calls.putImageData || 0) - d0}`);
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    ok(doc.getElementById('viewPop').hidden, `${N}: Esc closes the pop-up`);
    // the playground answers its sliders
    const pg = doc.querySelector('.pg'); const sl = pg.querySelector('input[data-k="s"]');
    sl.value = '2'; pg.dispatchEvent(new win.Event('input', { bubbles: true }));
    ok(/Output 3 × 3|stride/.test(pg.querySelector('.pg-note').textContent), `${N}: the playground note follows the stride`, pg.querySelector('.pg-note').textContent);
    const act = doc.querySelector('.act'); act.querySelector('button[data-id="sigmoid"]').click();
    ok(/Squeezes/.test(act.querySelector('.act-note').textContent), `${N}: the activation picker changes`);
    // the photo input is reachable by the keyboard (not display:none)
    const up = doc.getElementById('upload');
    ok(!up.hidden && up.tabIndex === 0 && up.closest('label'), `${N}: the photo input can take focus`);
    // credits
    doc.getElementById('creditsBtn').click();
    ok(!doc.getElementById('credits').hidden && doc.querySelectorAll('#creditsBody .cr-photos a').length === 20 && /MIT/.test(doc.getElementById('creditsBody').textContent), `${N}: credits list the photos and the MIT licence`);
    doc.getElementById('creditsClose').click();
    // the screensaver plays the same run
    ok(win.snSaver && typeof win.snSaver.enter === 'function' && typeof win.snSaver.exit === 'function', `${N}: window.snSaver has enter and exit`);
    page.tour.seek(3); page.tour.playing = true;
    const plates = [];
    const res = win.snSaver.enter({ calm: 0.7, seed: 11, label: p => plates.push(p) });
    ok(res && res.canvas && doc.body.contains(res.canvas), `${N}: the saver canvas is in the document`);
    ok(!page.tour.playing, `${N}: the page run waits while the saver plays`);
    await wait(250);
    const dbg = win.snSaver.debug();
    ok(dbg && dbg.id === 'flow' && dbg.li === 0 && dbg.tau > 0, `${N}: the saver starts the run at the input`, JSON.stringify(dbg));
    ok(plates.length >= 1 && plates[0].title === 'Layer by layer' && plates[0].tex.length === 1, `${N}: the saver names the run on the plate`, plates[0] && plates[0].title);
    for (const id of ['conv', 'relu', 'pool', 'dense', 'answer', 'flow']) {
      for (const k of [0.1, 0.6, 0.95]) {
        ok(win.snSaver.cut(id, k), `${N}: saver cut to ${id}`);
        await wait(40);
      }
      const d = win.snSaver.debug();
      ok(d.id === id && d.errs === 0 && d.frames > 0, `${N}: saver ${id} segment draws with no error`, JSON.stringify(d));
      if (['conv', 'relu', 'pool', 'dense'].includes(id)) {
        win.snSaver.cut(id, 0.5); await wait(40);
        ok(win.snSaver.debug().f > 0.95, `${N}: the saver ${id} zoom is open in its middle`, JSON.stringify(win.snSaver.debug()));
      }
    }
    ok(plates.some(p => /^It sees an? /.test(p.title)), `${N}: the saver names the answer at the end of a run`, plates.map(p => p.title).join(' | '));
    win.snSaver.exit();
    ok(!doc.getElementById('snSaverCv') && !win.__cnnSaver, `${N}: the saver exits and removes its canvas`);
    ok(page.tour.playing, `${N}: the page run goes on after the saver`);
    // a second saver run, at 9:16, has no error
    const before = T.errors.length;
    const iw = win.innerWidth, ih = win.innerHeight;
    win.innerWidth = 405; win.innerHeight = 720;
    win.snSaver.enter({ calm: 0.2, seed: 3, label: () => {} });
    await wait(60);
    for (const id of ['flow', 'conv', 'relu', 'dense', 'answer']) { win.snSaver.cut(id, 0.5); await wait(40); }
    const d9 = win.snSaver.debug();
    win.snSaver.exit();
    win.innerWidth = iw; win.innerHeight = ih;
    ok(T.errors.length === before && d9.errs === 0 && d9.frames > 3, `${N}: a 9:16 saver run has no error`, JSON.stringify(d9));
    ok(T.errors.length === 0, `${N}: no errors`, T.errors.slice(0, 5).join(' | '));
  } catch (e) {
    ok(false, `${N}: test threw`, e.stack);
  } finally { T.restore(); }
}

// reduced motion: the run plays as short fades, the zooms open at once
{
  const T = await bootAt({ name: 'reduced', width: 1280, height: 800, phone: false, reduce: true }), { win, doc, page } = T, N = 'reduced motion';
  try {
    const tour = page.tour, S = page.state, det = doc.getElementById('detail');
    ok(page.reducedMotion() && tour.playing, `${N}: the run still plays`);
    const cz = page.plan.segs.find(q => q.zoom === 'conv');
    tour.seek(cz.t0 + 0.05); page.advance(0);
    ok(S.zoom && S.zoom.f === 1 && det.style.transform === '' && det.style.getPropertyValue('--zc') === '1.000', `${N}: a zoom is open at once, with no growth`, `${S.zoom && S.zoom.f} ${det.style.transform}`);
    tour.seek(cz.t0 + 3.3); page.advance(0);
    ok(Number.isInteger(page.detail.t), `${N}: the scan jumps whole cells`, String(page.detail.t));
    const ex = page.state && doc.querySelector('#ex-conv.on');
    tour.seek(page.tour.stopOf(5).t0 + 0.1); page.advance(0);
    ok(ex && S.zoom === null, `${N}: the zoom closes with its segment`);
    tour.seek(0); tour.playing = true; S.segI = -1; S.visits = [];
    for (let i = 0; i < 2000 && !tour.ended; i++) page.advance(0.05);
    ok(tour.ended && S.visits.join() === '0,1,2,3,4,5,6,7,8,9,10,11' && /espresso/.test(doc.getElementById('pred').textContent), `${N}: the run gets to the answer`, S.visits.join());
    const ls = page.explain.st.lastScroll;
    ok(ls && ls.behavior === 'auto' && ls.id === 'out', `${N}: the explainer jumps to its step with no smooth scroll`, JSON.stringify(ls));
    tour.seek(page.tour.stopOf(3).t0 + 0.2); tour.playing = true; page.advance(0);
    const m = S.L.maps.find(q => q.li === 1 && q.c === 0), cv = doc.getElementById('netCv');
    cv.dispatchEvent(new win.MouseEvent('click', { clientX: m.x + 2, clientY: m.y + 2, bubbles: true }));
    page.advance(0.016);
    ok(S.zoom && S.zoom.f === 1 && det.style.transform === '', `${N}: a click opens the zoom at once`);
    doc.getElementById('dClose').click(); page.advance(0.016);
    ok(!S.zoom && det.hidden && tour.playing, `${N}: close is at once and the run goes on`);
    ok(T.errors.length === 0, `${N}: no errors`, T.errors.slice(0, 5).join(' | '));
  } catch (e) { ok(false, `${N}: test threw`, e.stack); } finally { T.restore(); }
}

console.log(`page: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
