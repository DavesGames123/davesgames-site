// ============================================================================
//  THREAD ART  ·  saver.js — the screensaver hook (window.snSaver)
// ----------------------------------------------------------------------------
//  The shell screensaver (lib/screensaver.js) calls snSaver.enter(opts)
//  with opts = { calm, seconds, caption, seed, label }. enter() hides the
//  page GUI (html.ta-saver), stops the page's own step pump, and gives the
//  #view canvas to the shot director (saver-draw.js). It resolves to
//  { canvas, warmupMs }; #view stays in the document.
//
//  SHOTS. saver-core.js KINDS: needle, split, chase, layers, maker (the
//  construction), push, rack, wipe, gallery (the results). A seeded bag,
//  no kind twice in a row, 6-12 s each, cross-fades. opts.seed changes
//  each run, so each run plays a new order with new images and frames.
//
//  PIECES. The next pieces are computed ahead, so a cut does not wait:
//    GPU  ... gpu.js + thread.wgsl on the page's device, res 512, laid to
//             the error floor (about 23000 lines, opacity 0.025)
//    worker . saver-worker.js, the CPU step, res 384, 14000 lines
//    idle ... the CPU step in 8 ms slices (no Worker), the same sizes
//  Phones get 1500-1800 lines. The cache holds 6 pieces (LRU); canvases
//  come from fixed pool slots. Memory stays flat over hours.
//
//  FRAMING. The director draws in the clear band of the plate
//  (lib/saver-clear.js plateBand), read every 250 ms.
//
//  PLATE. Shot and image, the frame, the pegs, the lines so far, the
//  thread length in metres (the chords, on a 60 cm frame), the threads,
//  and the greedy objective as TeX. No code.
//
//  grep -n: "function makeProducer"  "function gpuMake"  "function workerMake"
//           "function idleMake"  "function sourceFor"  "function bandNow"  "enter(opts)"
// ============================================================================
import { plateBand } from '../../lib/saver-clear.js';
import { createDirector } from './saver-draw.js';
import { PieceCache, createProducer, specRun, compactRun } from './saver-core.js';
import { shapeImage, stepRun } from './engine.js';

export function installSaver(ctx) {
  const { S, SOURCES } = ctx;
  const sources = SOURCES.map(s => ({ key: s.key, kind: s.kind, colour: !!s.colour, name: s.name, poi: s.poi, credit: s.credit }));
  let run = null;

  // ── piece makers ─────────────────────────────────────────────────────────
  async function gpuMake(spec, rgba, my) {
    const g = ctx.gpu && ctx.gpu();
    if (!g) throw new Error('no GPU');
    if (!my.runner) my.runner = await ctx.createThreadGPU(g.device, g.wgsl);
    const R = specRun(spec, rgba);
    my.runner.load(R);
    let chunk = 96;
    while (!R.done && run === my) {
      const t0 = performance.now();
      my.runner.steps(chunk);
      await my.runner.sync();
      const dt = performance.now() - t0;
      chunk = dt < 10 ? Math.min(1024, chunk * 2) : dt > 30 ? Math.max(32, chunk >> 1) : chunk;
    }
    if (run !== my) throw new Error('saver stopped');
    return compactRun(spec, R);
  }
  function workerMake(spec, rgba, my) {
    return new Promise((resolve, reject) => {
      const id = ++my.wid;
      my.waits.set(id, { resolve, reject });
      my.worker.postMessage({ id, spec, rgba }, [rgba.buffer]);
    });
  }
  async function idleMake(spec, rgba, my) {
    const R = specRun(spec, rgba);
    while (!R.done) {
      if (run !== my) throw new Error('saver stopped');
      const t0 = performance.now();
      while (performance.now() - t0 < 8) if (!stepRun(R)) break;
      await new Promise(res => setTimeout(res, 0));
    }
    return compactRun(spec, R);
  }
  function makeProducer(my) {
    let mode = ctx.gpu && ctx.gpu() ? 'gpu' : 'worker';
    if (mode === 'worker') {
      try {
        my.worker = new Worker(new URL('./saver-worker.js', import.meta.url), { type: 'module' });
        my.wid = 0; my.waits = new Map();
        my.worker.onmessage = e => {
          const w = my.waits.get(e.data.id); if (!w) return;
          my.waits.delete(e.data.id);
          if (e.data.error) w.reject(new Error(e.data.error)); else w.resolve(e.data.piece);
        };
        my.worker.onerror = () => { mode = 'idle'; for (const w of my.waits.values()) w.reject(new Error('worker failed')); my.waits.clear(); };
      } catch (e) { mode = 'idle'; }
    }
    my.mode = () => mode;
    return createProducer({
      cache: my.cache, ahead: 2,
      make: async spec => {
        const rgba = await ctx.sourceRGBA(spec.src, spec.res);
        const copy = new Uint8ClampedArray(rgba);
        if (mode === 'gpu') { try { return await gpuMake(spec, copy, my); } catch (e) { if (run !== my) throw e; mode = 'worker'; console.warn('thread-art saver: GPU pieces failed, CPU from now on', e); return idleMake(spec, copy, my); } }
        if (mode === 'worker') return workerMake(spec, copy, my);
        return idleMake(spec, copy, my);
      },
    });
  }

  // ── source images at view size ───────────────────────────────────────────
  function sourceFor(key, px) {
    const meta = SOURCES.find(s => s.key === key);
    if (!meta) return null;
    if (meta.kind === 'shape') {
      const n = Math.min(2048, Math.max(256, Math.ceil(px / 256) * 256));
      const c = run.shapes.get(key);
      if (c && c.width >= n) return c;
      const cv = c || document.createElement('canvas');
      cv.width = cv.height = n;
      cv.getContext('2d').putImageData(new ImageData(shapeImage(key, n), n, n), 0, 0);
      run.shapes.set(key, cv);
      return cv;
    }
    return run.bitmaps.get(key) || null;
  }

  function bandNow() {
    const now = performance.now();
    if (now - run.bandAt > 250) { run.bandAt = now; run.band = plateBand(innerHeight); }
    const d = run.dpr, W = innerWidth, H = innerHeight, b = run.band;
    if (!b) { const m = Math.min(W, H) * 0.05; return { x: m * d, y: m * d, w: (W - 2 * m) * d, h: (H - 2 * m) * d }; }
    const w = Math.min(W, b.w || W), x = (W - w) / 2, h = Math.max(80, H - b.t - b.b);
    return { x: (x + w * 0.02) * d, y: b.t * d, w: w * 0.96 * d, h: h * d };
  }

  function draw(g, dt, W, H, dpr) {
    if (!run) return;
    run.dpr = dpr;
    run.dir.frame(g, dt, { W, H, dpr, band: bandNow() });
  }

  window.snSaver = {
    enter(opts = {}) {
      const calm = Math.min(1, Math.max(0, opts.calm ?? 0.6));
      document.documentElement.classList.add('ta-saver');
      const phone = matchMedia('(max-width:768px), (pointer:coarse)').matches;
      const my = run = { cache: new PieceCache(6), bitmaps: new Map(), shapes: new Map(), bandAt: -1e9, band: null, dpr: 1, phone };
      S.saver = true;
      return ctx.ready.then(async () => {
        if (run !== my) return { canvas: ctx.canvas, warmupMs: 0 };
        for (const s of SOURCES) if (s.kind === 'photo') ctx.sourceImage(s.key).then(b => { if (b) my.bitmaps.set(s.key, b); }).catch(() => {});
        my.producer = makeProducer(my);
        my.dir = createDirector({
          seed: (opts.seed >>> 0) || Math.floor(Math.random() * 4294967295), calm, phone, gpu: my.mode() === 'gpu',
          mk: (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; },
          source: sourceFor, sources, producer: my.producer, cache: my.cache,
          label: typeof opts.label === 'function' ? opts.label : null,
        });
        S.saverDraw = draw;
        return { canvas: ctx.canvas, warmupMs: 1500 };
      });
    },
    exit() {
      const my = run;
      run = null; S.saverDraw = null; S.saver = false;
      if (my) {
        if (my.producer) my.producer.clear();
        if (my.worker) my.worker.terminate();
        if (my.runner) my.runner.destroy();
        my.cache.map.clear();
      }
      document.documentElement.classList.remove('ta-saver');
      ctx.invalidate();
      ctx.syncUI();
    },
    cut(kind) { return run && run.dir ? run.dir.cut(kind) : false; },
    debug() { return run && run.dir ? { ...run.dir.debug(), mode: run.mode && run.mode() } : null; },
  };
}
