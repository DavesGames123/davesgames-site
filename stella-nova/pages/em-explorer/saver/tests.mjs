// em-explorer SAVER tests (node, no browser, no network).
//   NODE_PATH=<dir with jsdom@24.1.3>/node_modules node stella-nova/pages/em-explorer/saver/tests.mjs
// (with no jsdom, section 5 is skipped and says so)
// 1 plan        the shot plan from the real CATALOG, over 40 seeds
// 2 framing     clear box, zoom and centre at 16:9, 9:16 and a phone,
//               checked against VIEW's own layoutViews
// 3 timing      every shot 5..12 s; fades; the hold drift
// 4 director    a fake page and a fake clock: cuts, labels, prefetch,
//               shot lengths, a dataset that does not open, stop
// 5 page        the real page in jsdom (NODE_PATH jsdom@24.1.3): a few
//               real-time shots at 16:9 and 9:16 on synthetic volumes
// 6 hook        saver/index.js on a small fake DOM: enter, debug, exit
import * as P from './plan.js';
import { createDirector } from './director.js';
import { normalizeCatalog } from '../ui/mount.js';
import { placeTitle, creditLine } from '../ui/panels.js';
import { fmtVoxel, fmtLength } from '../ui/format.js';
import { layoutViews } from '../view/camera.js';
import * as CATALOG from '../catalog/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const cat = normalizeCatalog(CATALOG);
const dsOf = (id) => cat.datasets.find((d) => d.id === id);
const bmOf = (id) => cat.bookmarks.find((b) => b.id === id);

// ── 1 plan ────────────────────────────────────────────────────────────────
{
  ok(cat.bookmarks.length >= 30, `catalog bookmarks ${cat.bookmarks.length}`);
  const a = P.shotPlan(cat.bookmarks, 7, 64), b = P.shotPlan(cat.bookmarks, 7, 64), c = P.shotPlan(cat.bookmarks, 8, 64);
  ok(JSON.stringify(a) === JSON.stringify(b), 'same seed, same plan');
  ok(JSON.stringify(a) !== JSON.stringify(c), 'other seed, other plan');
  let bad = 0, cutBad = 0, short = 0, seen = new Set(), dsSeen = new Set(), visitBad = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const p = P.shotPlan(cat.bookmarks, seed, 64);
    if (p.length !== 64) short++;
    if (p[0].cut !== 'dataset') cutBad++;
    let run = 0;
    p.forEach((s, i) => {
      seen.add(s.id);
      if (i < 25) dsSeen.add(seed + ':' + s.dataset);
      const q = p[i - 1];
      if (q && q.id === s.id) bad++;
      if (q && q.dataset !== s.dataset && s.cut !== 'dataset') cutBad++;
      if (q && q.dataset === s.dataset && q.plane !== s.plane && !s.cut) cutBad++;
      if (!bmOf(s.id) || bmOf(s.id).dataset !== s.dataset) bad++;
      run = s.cut === 'dataset' ? 1 : run + 1;
      if (run > 5) visitBad++;
    });
  }
  ok(short === 0, 'every plan has 64 shots');
  ok(bad === 0, `no bookmark twice in a row, all ids real (${bad})`);
  ok(cutBad === 0, `a cut at each dataset or plane change (${cutBad})`);
  ok(visitBad === 0, 'at most 5 shots in one visit');
  ok(seen.size === cat.bookmarks.length, `all ${cat.bookmarks.length} bookmarks used over 40 seeds (${seen.size})`);
  ok(dsSeen.size >= 40 * 5, `at least 5 datasets in the first 25 shots of each plan (${dsSeen.size / 40})`);
  const counts = {};
  for (const s of P.shotPlan(cat.bookmarks, 3, 64)) counts[s.dataset] = (counts[s.dataset] || 0) + 1;
  ok(Object.keys(counts).length === cat.datasets.length, `seed 3 visits all ${cat.datasets.length} datasets`);
  ok(P.shotPlan([], 1).length === 0, 'no bookmarks, no plan');
  ok(P.shotPlan([{ id: 'a', dataset: 'd', x: 1, y: 1, z: 1, zoom: 1 }], 1, 5).length === 5, 'one bookmark still plays');
}

// ── 2 framing ─────────────────────────────────────────────────────────────
// Plate bands as the shell gives them (plateBand t, b), for three frames.
const FRAMES = {
  '16:9': { w: 1920, h: 1080, band: { t: 250, b: 300 } },
  '9:16': { w: 540, h: 960, band: { t: 270, b: 300 } },
  phone: { w: 390, h: 844, band: { t: 230, b: 270 } },
};
{
  for (const [name, F] of Object.entries(FRAMES)) {
    const box = P.clearBox(F.w, F.h, F.band);
    ok(near(box.cy, F.band.t + (F.h - F.band.t - F.band.b) / 2), `${name}: box centre in the band`);
    ok(box.h >= 0.3 * F.h, `${name}: band is 30 % of the height or more`);
    // VIEW with these insets puts the view focus on the box centre
    for (const plane of ['xy', 'xz', 'yz']) {
      const v = layoutViews(F.w, F.h, 'single', plane, { top: F.band.t, bottom: F.band.b, left: 0, right: 0 })[0];
      ok(near(v.fx, box.cx, 0.5) && near(v.fy, box.cy, 0.5), `${name} ${plane}: VIEW focus (${v.fx}, ${v.fy}) = box centre (${box.cx}, ${box.cy})`);
    }
    // the subject (the bookmark field the catalog chose at REF_SHORT) fits in the box
    let worst = Infinity, widest = 0;
    for (const b of cat.bookmarks) {
      const z = P.frameZoom(b.zoom, box);
      const subj = P.REF_SHORT / b.zoom;             // voxels the catalog framed
      const showS = Math.min(box.w, box.h) / z;       // voxels on the short side now
      worst = Math.min(worst, showS / subj); widest = Math.max(widest, showS / subj);
    }
    ok(worst >= 0.62 && widest <= 2.3, `${name}: the framed subject keeps 0.62..2.3 of its catalog size (${worst.toFixed(2)}..${widest.toFixed(2)})`);
    console.log(`  ${name}: box ${box.w}x${Math.round(box.h)} at y ${Math.round(box.t)}, zoom factor ${(P.frameZoom(1, box)).toFixed(2)}`);
  }
  // 16:9 and 9:16 show the same subject size when the short side is the same
  const a = P.clearBox(1280, 900, { t: 130, b: 130 }), b = P.clearBox(640, 1300, { t: 300, b: 300 });
  ok(near(P.frameZoom(1, a), P.frameZoom(1, b)), 'same short side, same zoom');
  // shotTarget is the voxel centre in nm
  const bm = cat.bookmarks[0], d = dsOf(bm.dataset), box = P.clearBox(1920, 1080, FRAMES['16:9'].band);
  const tg = P.shotTarget(bm, d, box);
  ok(near(tg.x, (bm.x + 0.5) * d.voxel[0]) && near(tg.z, (bm.z + 0.5) * d.voxel[2]) && tg.units === 'nm', 'target in nm at the voxel centre');
  // startView: home in plane, the bookmark slice on the normal axis
  let svBad = 0;
  for (const b2 of cat.bookmarks) {
    const d2 = dsOf(b2.dataset), sv = P.startView(d2.home, b2, box), n = P.PLANES[sv.plane].n, k = 'xyz'[n];
    if (sv[k] !== b2[k] || sv.plane !== (b2.plane || 'xy')) svBad++;
    const r = sv.zoom / P.frameZoom(b2.zoom, box);
    if (!(sv.zoom > 0) || (r > 0.5 && r < 2)) svBad++;           // a real zoom in or a pull back
    for (let i = 0; i < 3; i++) if (!(sv['xyz'[i]] >= 0 && sv['xyz'[i]] < d2.size[i])) svBad++;
  }
  ok(svBad === 0, `start view of every bookmark: in the volume, on its slice, 2x or more from the shot zoom (${svBad})`);
}

// ── 3 timing, fades, drift ────────────────────────────────────────────────
{
  let bad = 0;
  for (const S of [0, 0.1, 0.5, 1, 2, 4, 7, 12, 30]) for (const calm of [0, 0.5, 0.7, 1]) for (const u of [0, 0.5, 1]) {
    const t = P.shotTiming(S, calm, u);
    const total = t.flyMs + t.holdMs;
    if (total < 5000 || total > 12000 || t.flyMs > 6500 || t.flyMs < 2400 || t.holdMs < 0 || total + t.extraMs > 12000) { bad++; console.log('  timing', S, calm, u, t); }
  }
  ok(bad === 0, 'flight + hold in 5..12 s, flight 2.4..6.5 s');
  ok(P.shotTiming(3, 1, 0.5).flyMs > P.shotTiming(3, 0, 0.5).flyMs, 'calm flies slower');
  const w = { lo: 0.2, hi: 0.7 };
  const c0 = P.crush(w, 0), c1 = P.crush(w, 1), ch = P.crush(w, 0.5);
  ok(near(c0.lo, 0.2) && near(c0.hi, 0.7), 'crush 0 = the window');
  ok(c1.lo >= 0.99 && c1.hi <= 1 && c1.hi > c1.lo, 'crush 1 = black, values in 0..1');
  ok(ch.lo > 0.2 && ch.lo < c1.lo && ch.hi <= 1, 'crush 0.5 between');
  let mono = true, prev = -1;
  for (let k = 0; k <= 1.0001; k += 0.05) { const c = P.crush({ lo: 0, hi: 1 }, k); if (c.lo < prev || c.hi > 1 || c.lo > 1) mono = false; prev = c.lo; }
  ok(mono, 'crush goes one way and stays in 0..1');
  // drift: at most 3 % of the box width, push in 8..14 %
  const box = P.clearBox(540, 960, FRAMES['9:16'].band);
  let dBad = 0;
  for (const b of cat.bookmarks) {
    const d = dsOf(b.dataset), tg = P.shotTarget(b, d, box);
    for (const [u1, u2] of [[0, 0], [0.3, 1], [0.77, 0.5]]) {
      const h = P.holdTarget(tg, d, box, u1, u2), npp = P.planeRes(d.voxel, tg.plane) / tg.zoom;
      const px = Math.hypot(h.x - tg.x, h.y - tg.y, h.z - tg.z) / npp;
      const n = 'xyz'[P.PLANES[tg.plane].n];
      if (px > 0.0301 * box.w || h[n] !== tg[n] || h.zoom / tg.zoom < 1.079 || h.zoom / tg.zoom > 1.141) dBad++;
    }
  }
  ok(dBad === 0, 'hold drift: in the plane, 3 % of the box or less, push in 8..14 %');
  const s = P.bandStep({ t: 0, b: 0 }, { t: 100, b: 200 }, 0.35);
  ok(near(s.t, 100 * (1 - Math.exp(-1)), 1e-9) && s.b > s.t, 'band ease');
}

// ── 4 director on a fake page ─────────────────────────────────────────────
function makeClock() {
  let t = 0;
  const q = [];
  const wait = (ms) => new Promise((res) => q.push({ at: t + Math.max(0, ms || 0), res }));
  return {
    now: () => t, wait, frame: () => wait(16),
    async run(until) {
      for (let guard = 0; guard < 2e6; guard++) {
        for (let k = 0; k < 4; k++) await new Promise((r) => setImmediate(r));
        if (!q.length || t >= until) return;
        q.sort((a, b) => a.at - b.at);
        const e = q.shift();
        t = Math.max(t, e.at);
        e.res();
      }
    },
  };
}

function fakePage(clock, { failIds = [], frame = FRAMES['16:9'], start = 'hemibrain' } = {}) {
  const calls = { flyTo: [], prefetch: [], goTo: [], select: [], contrast: [], labels: [], veil: [] };
  let dataset = start, volume = {}, changedAt = -1e9, cam = { nm: [0, 0, 0], nmPerPx: 100, plane: 'xy' };
  const ready = () => clock.now() - changedAt > 400 ? 1 : 0.3;
  const viewer = {
    setContrast(lo, hi, g) { calls.contrast.push({ t: clock.now(), lo, hi, g }); },
    setInvert() {},
    autoContrast: () => ({ lo: 0.21, hi: 0.79 }),
    goTo(v) { calls.goTo.push({ t: clock.now(), v }); changedAt = clock.now(); cam = { ...cam, plane: v.plane || cam.plane }; },
    state: () => ({ ...cam }),
    saverShots: {
      flyTo(tg, o) {
        calls.flyTo.push({ t: clock.now(), tg, ms: o.ms, dataset });
        const d = dsOf(dataset);
        return clock.wait(o.ms).then(() => { cam = { nm: [tg.x, tg.y, tg.z], nmPerPx: P.planeRes(d.voxel, tg.plane) / tg.zoom, plane: tg.plane }; return true; });
      },
      prefetch(tg) { calls.prefetch.push({ t: clock.now(), tg }); },
      isReady: () => ready(),
      setBand() {},
    },
  };
  const em = {
    catalog: cat,
    state: () => ({ dataset, contrast: { lo: 0, hi: 255, gamma: 1 }, invert: false, view: viewer.state() }),
    volume: () => volume,
    async selectDataset(id, { view }) {
      calls.select.push({ t: clock.now(), id, view });
      await clock.wait(250);
      if (failIds.includes(id)) return false;
      dataset = id; volume = {}; changedAt = clock.now();
      viewer.setContrast(0, 1, 1);           // CORE's default window
      cam = { ...cam, plane: view.plane };
      return true;
    },
  };
  const box = () => P.clearBox(frame.w, frame.h, frame.band);
  const director = createDirector({
    em, viewer, box, now: clock.now, wait: clock.wait, frame: clock.frame, calm: 0.7, seed: 11,
    label: (info) => calls.labels.push({ t: clock.now(), info }),
    onVeil: (k) => calls.veil.push({ t: clock.now(), k }),
    text: { placeTitle, creditLine, fmtVoxel, fmtLength },
  });
  return { calls, director, box };
}

for (const frameName of ['16:9', '9:16']) {
  const clock = makeClock();
  const { calls, director, box } = fakePage(clock, { frame: FRAMES[frameName] });
  director.start();
  await clock.run(10 * 60 * 1000);           // ten minutes of saver time
  director.stop();
  await clock.run(clock.now() + 60000);
  const shots = director.log.filter((e) => e.kind === 'shot'), ends = director.log.filter((e) => e.kind === 'end');
  ok(shots.length >= 45, `${frameName}: ${shots.length} shots in 10 min`);
  const lens = ends.map((e) => e.ms);
  console.log(`  director ${frameName}: ${shots.length} shots in 10 min, ${calls.select.length} dataset switches, shot ${Math.min(...lens)}..${Math.max(...lens)} ms, ${calls.prefetch.length} prefetch calls`);
  ok(lens.every((m) => m >= 5000 - 1 && m <= 12000 + 200), `${frameName}: each shot 5..12 s (${Math.min(...lens)}..${Math.max(...lens)} ms)`);
  // each shot names its place and the dataset credit
  const lab = calls.labels.map((l) => l.info);
  ok(lab.length >= shots.length && lab.every((i) => i.title && i.sub && i.lines.some((x) => x.startsWith('Data: ')) && i.lines.some((x) => /^Field of view \S+ (nm|µm|mm) across$/.test(x))), `${frameName}: plate has title, sub, field of view and credit`);
  ok(lab.every((i) => { const a = i.anchor(); const bx = box(); return a.lead === false && a.x === bx.cx && a.y === bx.cy; }), `${frameName}: plate anchor at the box centre, no leader`);
  // dataset changes go through selectDataset with a view in the volume
  const dsChanges = shots.filter((s, i) => i > 0 && s.dataset !== shots[i - 1].dataset).length;
  ok(calls.select.length >= dsChanges && dsChanges >= 6, `${frameName}: ${calls.select.length} selectDataset for ${dsChanges} dataset changes`);
  ok(calls.select.every((s) => { const d = dsOf(s.id); return ['x', 'y', 'z'].every((k, i) => s.view[k] >= 0 && s.view[k] < d.size[i]); }), `${frameName}: every start view in the volume`);
  // under black when CORE switches: the contrast right after selectDataset is crushed
  let blackBad = 0;
  for (const s of calls.select) {
    const after = calls.contrast.filter((c) => c.t >= s.t + 250).slice(0, 2);
    if (!(after.length === 2 && after[0].lo === 0 && after[1].lo >= 0.99)) blackBad++;
  }
  ok(blackBad === 0, `${frameName}: CORE's window is crushed again in the same step (${blackBad})`);
  // the veil is 1 at each switch and 0 after the fade in
  const lastVeil = calls.veil[calls.veil.length - 1].k;
  ok(calls.select.every((s) => { const v = calls.veil.filter((x) => x.t <= s.t).pop(); return v && v.k === 1; }), `${frameName}: black at every dataset switch`);
  ok(calls.veil.some((v) => v.k === 0), `${frameName}: veil goes to 0`);
  void lastVeil;
  // auto window after a switch
  ok(calls.contrast.some((c) => near(c.lo, 0.21) && near(c.hi, 0.79)), `${frameName}: VIEW auto window used`);
  // flights: zoom framed for the box, with a hold (push in) after each
  const flights = calls.flyTo;
  let zBad = 0;
  for (const s of shots) {
    const b = bmOf(s.id);
    if (!near(s.target.zoom, P.frameZoom(b.zoom, box()))) zBad++;
  }
  ok(zBad === 0, `${frameName}: each flight zoom = frameZoom(bookmark zoom)`);
  ok(flights.length >= 2 * shots.length - 1, `${frameName}: a flight and a hold per shot (${flights.length})`);
  // prefetch: a shot followed by a same-dataset shot with no cut prefetches it
  let pf = 0, pfWant = 0;
  for (let i = 0; i + 1 < shots.length; i++) {
    const n = director.plan[(shots[i].i + 1) % director.plan.length];
    if (!n.cut && bmOf(n.id).dataset === shots[i].dataset) {
      pfWant++;
      const nt = P.shotTarget(bmOf(n.id), dsOf(shots[i].dataset), box());
      if (calls.prefetch.some((p) => p.t >= shots[i].t && near(p.tg.x, nt.x) && near(p.tg.y, nt.y) && near(p.tg.z, nt.z))) pf++;
    }
  }
  ok(pfWant > 5 && pf === pfWant, `${frameName}: next shot prefetched ${pf}/${pfWant}`);
  ok(director.debug().errors === 0, `${frameName}: no errors (${director.debug().lastErr})`);
}

// a dataset that does not open is left out; the others go on
{
  const clock = makeClock();
  const { calls, director } = fakePage(clock, { failIds: ['h01'] });
  director.start();
  await clock.run(6 * 60 * 1000);
  director.stop();
  await clock.run(clock.now() + 60000);
  const shots = director.log.filter((e) => e.kind === 'shot');
  ok(shots.length > 25 && !shots.some((s) => s.dataset === 'h01'), `failed dataset skipped, ${shots.length} shots go on`);
  ok(calls.select.filter((s) => s.id === 'h01').length === 1, 'failed dataset tried once');
  ok(director.debug().failed.includes('h01') && director.debug().errors === 1, 'failure counted');
}

// all fail: the director waits and tries again, with no busy loop
{
  const clock = makeClock();
  const { calls, director } = fakePage(clock, { failIds: cat.datasets.map((d) => d.id), start: 'none' });
  director.start();
  await clock.run(60 * 1000);
  director.stop();
  await clock.run(clock.now() + 60000);
  ok(calls.select.length <= 30 && calls.select.length >= 7, `offline: ${calls.select.length} tries in 60 s`);
  ok(calls.flyTo.length === 0, 'offline: no flights');
}

// stop in a flight ends the loop
{
  const clock = makeClock();
  const { calls, director } = fakePage(clock);
  director.start();
  await clock.run(3000);
  director.stop();
  await clock.run(clock.now() + 120000);
  const n = calls.flyTo.length;
  await clock.run(clock.now() + 120000);
  ok(calls.flyTo.length === n && n <= 2, `stop: no flights after stop (${n})`);
}

// ── 5 the real page in jsdom: CORE, VIEW and CATALOG, a synthetic volume ──
// jsdom from NODE_PATH or JSDOM_DIR, the fake WebGL2 of pages/coral-reef.
// The saver plays in real time for a few shots at 16:9 and at 9:16.
{
  const require = createRequire(import.meta.url);
  let JSDOM = null, fakeCanvas = null;
  try {
    const dirs = [process.env.JSDOM_DIR, ...(process.env.NODE_PATH || '').split(path.delimiter)].filter(Boolean);
    JSDOM = require(require.resolve('jsdom', { paths: dirs.length ? dirs : undefined })).JSDOM;
  } catch (e) { /* skip */ }
  try { ({ fakeCanvas } = await import('../../coral-reef/tests/fake-gl.mjs')); } catch (e) { /* skip */ }
  if (!JSDOM || !fakeCanvas) console.log('  skip page run: no jsdom on NODE_PATH or no pages/coral-reef/tests/fake-gl.mjs');
  else {
    const VIEW = await import('../view/index.js');
    const HTML = fs.readFileSync(path.join(HERE, '..', 'index.html'), 'utf8');
    let hook = null, bootN = 0;
    for (const [name, w, h] of [['16:9', 1280, 720], ['9:16', 405, 720]]) {
      const dom = new JSDOM(HTML.replace(/<script type="module"[^>]*><\/script>/, '').replace(/<script src="[^"]*"><\/script>/g, ''), {
        url: 'http://localhost:8963/stella-nova/pages/em-explorer/index.html', pretendToBeVisual: true,
      });
      const win = dom.window, doc = win.document;
      win.matchMedia = (q) => ({ matches: /max-width/.test(q) ? w <= 768 : false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      const view = doc.getElementById('view');
      for (const [k, v] of [['clientWidth', w], ['clientHeight', h]]) Object.defineProperty(view, k, { value: v, configurable: true });
      const fakes = new Map();
      win.HTMLCanvasElement.prototype.getContext = function (kind) {
        if (kind !== 'webgl2') return null;
        if (!fakes.has(this)) fakes.set(this, fakeCanvas({ w, h, canvas: this }).gl);
        return fakes.get(this);
      };
      const rafQ = [];
      win.requestAnimationFrame = (f) => { rafQ.push(f); return rafQ.length; };
      win.cancelAnimationFrame = () => {};
      const opened = [];
      win.__emTestPackages = {
        catalog: CATALOG, view: VIEW,
        data: {
          setPhone() {},
          async openVolume(rec) {
            opened.push(rec.id);
            await new Promise((r) => setTimeout(r, 20));
            const levels = Math.ceil(Math.log2(Math.max(...rec.size) / 512)) + 1;
            const v = VIEW.stubVolume({ size: rec.size, resolution: rec.voxel, levels: Math.max(2, levels) });
            v.id = rec.id; v.dispose = () => {};
            return v;
          },
        },
      };
      const G = globalThis, keep = {};
      const keys = ['window', 'document', 'navigator', 'location', 'history', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'HTMLElement', 'HTMLCanvasElement', 'Element', 'Node', 'Event', 'KeyboardEvent', 'matchMedia', 'addEventListener', 'removeEventListener', 'dispatchEvent', 'devicePixelRatio', 'innerWidth', 'innerHeight', 'ResizeObserver', 'self', 'Worker'];
      for (const k of keys) keep[k] = Object.getOwnPropertyDescriptor(G, k);
      const val = (k) => (k === 'window' || k === 'self' ? win : k === 'devicePixelRatio' ? 1 : k === 'innerWidth' ? w : k === 'innerHeight' ? h
        : k === 'Worker' ? undefined : k === 'ResizeObserver' ? class { observe() {} unobserve() {} disconnect() {} }
        : (typeof win[k] === 'function' && /^[a-z]/.test(k) ? win[k].bind(win) : win[k]));
      for (const k of keys) Object.defineProperty(G, k, { value: val(k), configurable: true, writable: true });
      const errors = [], cerr = console.error, cwarn = console.warn;
      console.error = (...a) => errors.push(a.map((x) => (x && x.stack) || String(x)).join(' '));
      console.warn = (...a) => { const t = a.map(String).join(' '); if (!/package not loaded/.test(t)) errors.push('warn: ' + t); };
      const onRej = (e) => errors.push('unhandled: ' + ((e && e.stack) || e));
      process.on('unhandledRejection', onRej);
      const pump = async (ms, until) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
          const q = rafQ.splice(0);
          // rAF time has the page's time origin, as in a browser
          for (const f of q) { try { f(win.performance.now()); } catch (e) { errors.push('frame: ' + ((e && e.stack) || e)); } }
          if (until && until()) return true;
          await new Promise((r) => setTimeout(r, 8));
        }
        return false;
      };
      try {
        await import(pathToFileURL(path.join(HERE, '..', 'main.js')).href + `?saver=${bootN++}`);
        const em = win.__em;
        const ready = await Promise.race([em.ready, new Promise((r) => setTimeout(() => r('timeout'), 20000))]);
        await pump(300);
        // main.js loads saver/index.js; a second boot reuses the module, so it keeps the first hook
        await pump(3000, () => !!(win.snSaver || hook));
        hook = win.snSaver || hook;
        ok(ready === true && !!em.viewer, `${name} page: boots on the real catalog (ready ${ready})`);
        ok(hook && typeof hook.enter === 'function', `${name} page: main.js loads the saver hook`);
        // the reader's own image, which exit must put back
        if (em.setImage) em.setImage({ contrast: { lo: 20, hi: 200, gamma: 1.3 }, invert: true });
        const before = em.state();
        if (process.env.SAVER_LOG) { const f0 = em.viewer.saverShots.flyTo; em.viewer.saverShots.flyTo = (tg, o) => { const t = performance.now(); return f0(tg, o).then((v) => { console.log('    flyTo', o.ms, '->', v, Math.round(performance.now() - t), 'ms'); return v; }); }; }
        const labels = [];
        const res = await hook.enter({ calm: 0, seed: 4, label: (i) => labels.push(i) });
        ok(res && res.canvas === view, `${name} page: enter gives #view`);
        ok(doc.documentElement.classList.contains('sn-saver') && doc.getElementById('emSaverVeil'), `${name} page: sn-saver class and veil`);
        // jsdom loads no style sheet: check the CORE rule and that the ids exist
        const css = fs.readFileSync(path.join(HERE, '..', 'style.css'), 'utf8');
        ok(['panel', 'dock', 'title', 'caption', 'topRight', 'credit'].every((id) => css.includes(`html.sn-saver #${id}`) && doc.getElementById(id)), `${name} page: CORE chrome ids are hidden by html.sn-saver in style.css`);
        // play until the third shot starts (about 12 to 25 s)
        const plan = P.shotPlan(em.catalog.bookmarks, 4, 64);
        const t0 = Date.now();
        await pump(40000, () => hook.debug() && hook.debug().shown >= 3);
        const d = hook.debug();
        if (process.env.SAVER_LOG) console.log(JSON.stringify(hook.log().map((e) => ({ t: Math.round(e.t), kind: e.kind, i: e.i, id: e.id, ms: e.ms, flyMs: e.flyMs, holdMs: e.holdMs, S: e.S && +e.S.toFixed(2) }))));
        console.log(`  ${name} page: ${d.shown} shots in ${((Date.now() - t0) / 1000).toFixed(1)} s, phase ${d.phase}, dataset ${em.state().dataset}, opened ${opened.join(' ')}, errors ${d.errors} ${d.lastErr}`);
        ok(d.shown >= 3 && d.errors === 0, `${name} page: three shots play with no errors`);
        ok(labels.length >= 3 && labels.every((l) => l.lines.some((x) => x.startsWith('Data: '))), `${name} page: ${labels.length} plates with the credit`);
        // shot 1 landed on its bookmark: check the first plate title against the plan
        ok(labels[0].title === placeTitle(bmOf(plan[0].id)), `${name} page: first plate = first bookmark (${labels[0].title})`);
        ok(em.state().dataset === plan[2].dataset || em.state().dataset === plan[1].dataset, `${name} page: CORE shows the dataset of the plan (${em.state().dataset})`);
        // the view is near the shot target (the hold drifts 3 % and pushes in up to 14 %)
        const shotNow = plan[d.i % plan.length], bnow = bmOf(shotNow.id);
        await pump(9000, () => hook.debug().phase === 'hold');
        const st = em.viewer.state(), bx = P.clearBox(w, h, { t: 0, b: 0 });
        const zf = P.frameZoom(bnow.zoom, bx), field = Math.min(w, h) / zf;
        const off = Math.hypot(st.x - bnow.x, st.y - bnow.y);
        ok(hook.debug().phase === 'hold' && off < 0.2 * field && st.zoom / zf > 0.8 && st.zoom / zf < 1.25, `${name} page: the view holds on ${bnow.id} (off ${off.toFixed(1)} vx of ${field.toFixed(0)}, zoom ${(st.zoom / zf).toFixed(2)}x)`);
        ok(st.contrast.hi > st.contrast.lo && st.contrast.hi <= 1, `${name} page: contrast window ${st.contrast.lo.toFixed(3)}..${st.contrast.hi.toFixed(3)}`);
        hook.exit();
        await pump(500);
        const after = em.state();
        ok(!doc.documentElement.classList.contains('sn-saver') && !doc.getElementById('emSaverVeil'), `${name} page: exit removes the class and the veil`);
        ok(after.dataset === before.dataset, `${name} page: exit puts back ${before.dataset} (${after.dataset})`);
        const vs = em.viewer.state();
        ok(Math.abs(vs.x - before.view.x) < 2 && Math.abs(vs.zoom / before.view.zoom - 1) < 0.02, `${name} page: exit puts back the view`);
        const vc = vs.contrast || {};
        ok(after.auto === false && after.contrast.lo === 20 && after.contrast.hi === 200 && after.invert === true && Math.abs(vc.lo - 20 / 255) < 1e-3 && Math.abs(vc.hi - 200 / 255) < 1e-3 && Math.abs(vc.gamma - 1.3) < 1e-3 && vs.invert === true, `${name} page: exit puts back the reader's contrast and invert (${JSON.stringify(after.contrast)}, view ${vc.lo && vc.lo.toFixed(3)}..${vc.hi && vc.hi.toFixed(3)})`);
        ok(!errors.length, `${name} page: no errors${errors.length ? ': ' + errors[0].slice(0, 300) : ''}`);
        try { win.__snRelease && win.__snRelease(); } catch (e) { /* gpu-guard */ }
      } catch (e) {
        ok(false, `${name} page run threw: ${(e && e.stack) || e}`);
      } finally {
        process.off('unhandledRejection', onRej); console.error = cerr; console.warn = cwarn;
        for (const k of keys) { if (keep[k]) Object.defineProperty(G, k, keep[k]); else delete G[k]; }
        win.close();
      }
    }
  }
}

// ── 6 the hook on a small fake DOM ────────────────────────────────────────
{
  const els = [];
  const mk = (tag) => ({ tagName: tag, style: {}, id: '', textContent: '', remove() { const i = els.indexOf(this); if (i >= 0) els.splice(i, 1); } });
  const cls = new Set();
  const calls = { setBand: [], goTo: [], contrast: [], select: [] };
  const viewer = {
    setInsets() {}, setContrast(...a) { calls.contrast.push(a); }, setInvert() {}, autoContrast: () => ({ lo: 0.1, hi: 0.9 }),
    goTo(v) { calls.goTo.push(v); }, state: () => ({ nm: [0, 0, 0], nmPerPx: 50, plane: 'xy' }),
    saverShots: { flyTo: () => new Promise(() => {}), prefetch() {}, isReady: () => 1, setBand(b) { calls.setBand.push(b); } },
  };
  let dataset = 'minnie65';
  globalThis.window = globalThis;
  globalThis.innerWidth = 540; globalThis.innerHeight = 960;
  globalThis.requestAnimationFrame = (f) => setTimeout(() => f(performance.now()), 16);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.document = {
    documentElement: { classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) } },
    head: { appendChild: (e) => els.push(e) }, body: { appendChild: (e) => els.push(e) },
    createElement: mk, getElementById: (id) => (id === 'view' ? { id: 'view' } : null),
  };
  globalThis.__em = {
    catalog: cat, ready: Promise.resolve(true), viewer,
    state: () => ({ dataset, contrast: { lo: 10, hi: 200, gamma: 1.2 }, invert: true, view: { x: 5, y: 6, z: 7, zoom: 0.5, plane: 'xy' } }),
    volume: () => ({}),
    selectDataset: async (id, o) => { calls.select.push({ id, o }); dataset = id; return true; },
  };
  let resized = 0;
  globalThis.dispatchEvent = (e) => { if (e.type === 'resize') resized++; };
  await import('./index.js?fake');
  const S = globalThis.snSaver;
  ok(S && typeof S.enter === 'function' && typeof S.exit === 'function', 'hook: window.snSaver.enter / exit');
  ok(S.debug() === null, 'hook: debug null before enter');
  const res = await S.enter({ calm: 0.7, seed: 5, label: () => {} });
  ok(res && res.canvas && res.canvas.id === 'view' && res.warmupMs > 0, 'hook: enter returns #view and a warmup');
  ok(cls.has('sn-saver'), 'hook: html.sn-saver on');
  ok(els.some((e) => e.id === 'emSaverVeil') && els.some((e) => e.tagName === 'style'), 'hook: veil and style in the page');
  await new Promise((r) => setTimeout(r, 120));
  const dbg = S.debug();
  ok(dbg && dbg.phase && dbg.band, `hook: debug while on (${dbg && dbg.phase})`);
  ok(calls.setBand.length >= 1, 'hook: band given to VIEW');
  S.exit();
  ok(!cls.has('sn-saver') && !els.length, 'hook: exit removes the class, veil and style');
  ok(calls.setBand[calls.setBand.length - 1] === null, 'hook: exit clears the band');
  ok(resized === 1, 'hook: exit asks CORE for its insets (resize)');
  const back = calls.select.length ? calls.select[calls.select.length - 1] : null;
  ok((dataset === 'minnie65' && (back ? back.id === 'minnie65' : calls.goTo.length > 0)), 'hook: exit puts back the dataset and view');
  ok(S.debug() === null, 'hook: debug null after exit');
  // enter twice is safe
  await S.enter({ seed: 9 }); await S.enter({ seed: 10 }); S.exit();
  ok(!cls.has('sn-saver') && !els.length, 'hook: enter twice, one exit cleans up');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
