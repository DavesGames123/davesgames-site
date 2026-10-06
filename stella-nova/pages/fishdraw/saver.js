// ============================================================================
//  FISHDRAW  ·  saver.js — the window.snSaver hook (screensaver tour)
// ----------------------------------------------------------------------------
//  Our own code around fishdraw by Lingdong Huang (MIT, LICENSE-fishdraw.txt).
//  Protocol: lib/screensaver.js. enter(opts) hides the page GUI, puts a
//  full-window canvas (#saverCanvas) in the document, and returns
//  { canvas, warmupMs }. exit() removes them and gives the page back.
//
//  SHOTS. A seeded shuffle of four shot types, shuffled again each round
//  (opts.seed differs per run, so each run differs; the counters reset on
//  each load). Each shot lasts 5-12 s (calm = longer), then a cut.
//    draw    one fish, drawn on by the pen in upstream order, then held
//    plate   a grid plate that fills cell by cell, each cell drawn on
//    push    one finished fish, a slow push-in on the head, scales, fins
//            or tail; the lines are vectors through the camera each frame
//    morph   one name, params that step from the fish to a relative and
//            on to a second relative (blendParams), with a cross-fade
//  The paper theme changes on each shot (a shuffled bag of themes).
//  The next shot is asked of the pool while the current one plays.
//
//  FRAMING. The subject sits in the clear band of the shell label plate
//  (lib/saver-clear.js plateBand), checked each 250 ms. With no plate, a
//  band of 76% of the height.
//
//  LABEL. opts.label({ title, sub, lines, code }): the Latin name and the
//  seed, and a short real extract of fishdraw.js (cut from the source text
//  by function name, so it is always the shipped code).
//
//  GREP MAP
//    grep -n 'export function installSaver'  the hook
//    grep -n 'function prepare'              the specs and pool jobs of a shot
//    grep -n 'function render'               one frame of the active shot
//    grep -n 'function extract'              a code extract by function name
//    grep -n 'function boxOf'                the subject box in the band
// ============================================================================
import { mulberry, randomName, baseParams, mutate, blendParams } from './engine.js';
import { THEMES, THEME_KEYS, MM_PER_PX, layoutPlate } from './plate.js';
import { drawPlate } from './render.js';

const TYPES = ['draw', 'plate', 'push', 'morph'];
const FOCI = [
  { name: 'the head', u: 0.22, v: 0.5 },
  { name: 'the scales', u: 0.52, v: 0.48 },
  { name: 'the dorsal fin', u: 0.48, v: 0.3 },
  { name: 'the tail', u: 0.84, v: 0.5 },
  { name: 'the pectoral fin', u: 0.36, v: 0.6 },
];
const CODE = {
  draw: ['fish', 'start'],
  plate: ['binomen', 'end'],
  push: ['squama', 'start'],
  morph: ['rndtri', 'start'],
};

// The lines of `function name(` to its closing brace, the first or last n.
function extract(src, name, from = 'start', n = 12) {
  const lines = src.split('\n');
  const i = lines.findIndex(l => l.startsWith('function ' + name + '('));
  if (i < 0) return '';
  let j = i + 1;
  while (j < lines.length && lines[j] !== '}') j++;
  const body = lines.slice(i, j + 1).filter(l => l.trim());
  return (from === 'end' ? body.slice(-n) : body.slice(0, n)).join('\n');
}

// A one-cell layout that fits the real extent of the fish (the union of
// the bboxes of fs, in fish units) to a box of bw x bh mm. The 5:3 box of
// reframe() has pad; the band is short, so the pad would waste it.
function fitCell(fs, bw, bh, fill = 0.94) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of fs) if (f) { x0 = Math.min(x0, f.bbox.x); y0 = Math.min(y0, f.bbox.y); x1 = Math.max(x1, f.bbox.x + f.bbox.w); y1 = Math.max(y1, f.bbox.y + f.bbox.h); }
  if (!(x1 > x0)) { x0 = 20; y0 = 20; x1 = 480; y1 = 280; }
  const k = Math.min(bw / (x1 - x0), bh / (y1 - y0)) * fill;
  const fx = bw / 2 - (x0 + x1) / 2 * k, fy = bh / 2 - (y0 + y1) / 2 * k;
  return { w: bw, h: bh, rules: [], texts: [], content: { x: 0, y: 0, w: bw, h: bh },
    cells: [{ i: 0, x: 0, y: 0, w: bw, h: bh, fx, fy, fw: 500 * k, fh: 300 * k, k, bx: x0, by: y0, bw: x1 - x0, bh: y1 - y0 }] };
}

const ease = t => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);

export function installSaver(ctxIn) {
  const { S, pool, E, src, getGrain, onEnter, onExit } = ctxIn;
  let V = null;

  function shuffled(arr, rnd) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function nextType() {
    if (!V.bag.length) {
      let b = shuffled(TYPES, V.rnd);
      if (b[0] === V.lastType) b.push(b.shift());
      V.bag = b;
    }
    return (V.lastType = V.bag.shift());
  }
  function nextTheme() {
    if (!V.tbag.length) V.tbag = shuffled(THEME_KEYS, V.rnd);
    return V.tbag.shift();
  }
  const u32 = () => (V.rnd() * 4294967295) >>> 0;

  // ── prepare ───────────────────────────────────────────────────────────────
  function prepare(type) {
    const calm = V.calm;
    const shot = { type, theme: nextTheme(), dur: 5 + 4 * calm + V.rnd() * 3, fishes: [], specs: [], t0: 0 };
    const ask = (spec, i, label) => pool.draw(spec.name, spec.params, label, 2 + i, 'saver')
      .then(f => { shot.fishes[i] = f; return f; }).catch(() => null);
    if (type === 'plate') {
      const land = innerWidth >= innerHeight;
      const opts = land ? [[2, 3], [2, 4], [3, 4]] : [[3, 2], [4, 2], [5, 2]];
      const [rows, cols] = opts[Math.floor(V.rnd() * opts.length)];
      shot.rows = rows; shot.cols = cols; shot.dur += 2;
      for (let i = 0; i < rows * cols; i++) shot.specs.push({ name: randomName(E, u32()), params: null });
      const jobs = shot.specs.map((s, i) => ask(s, i, false));
      shot.ready = Promise.race([jobs[0], new Promise(r => setTimeout(r, 6000))]);
    } else if (type === 'morph') {
      const name = randomName(E, u32()), base = baseParams(E, name);
      const p1 = mutate(base, 0.55, V.rnd), p2 = mutate(p1, 0.55, V.rnd);
      const seq = [base, blendParams(base, p1, 1 / 3), blendParams(base, p1, 2 / 3), p1, blendParams(p1, p2, 1 / 3), blendParams(p1, p2, 2 / 3), p2];
      shot.specs = seq.map(p => ({ name, params: p }));
      shot.dur = Math.max(shot.dur, 7 + 2 * calm);
      shot.ready = Promise.all(shot.specs.map((s, i) => ask(s, i, false)));
    } else {
      shot.specs = [{ name: randomName(E, u32()), params: null }];
      if (type === 'push') { shot.focus = FOCI[Math.floor(V.rnd() * FOCI.length)]; shot.zoom = 2.3 + V.rnd() * 1.3; }
      shot.ready = ask(shot.specs[0], 0, false);
    }
    shot.ready.then(() => { shot.isReady = true; });
    return shot;
  }

  // ── label ─────────────────────────────────────────────────────────────────
  function labelFor(shot) {
    const f = shot.fishes[0], name = shot.specs[0].name;
    const [fn, from] = CODE[shot.type];
    const code = { lang: 'js', name: 'fishdraw.js · ' + fn + '()', text: extract(src, fn, from, 12) };
    const seed = E.str_to_seed(name);
    if (shot.type === 'plate') {
      return { title: 'Pisces fictae', sub: `A plate of ${shot.specs.length} specimens, drawn with fishdraw`,
        lines: [`${shot.specs[0].name} to ${shot.specs[shot.specs.length - 1].name}`, 'Each name is a binomen from the upstream syllable tables, and the seed of its fish.'], code };
    }
    const lines = [`Seed ${seed}: str_to_seed("${name}")` + (f ? ` · ${f.offs.length - 1} polylines` : '')];
    if (shot.type === 'draw') lines.push('The pen draws the polylines in the order fish() returns them.');
    if (shot.type === 'push') lines.push(`A close look at ${shot.focus.name}. Every line is a vector.`);
    if (shot.type === 'morph') lines.push('One name, so one noise stream. The params step to two relatives.');
    return { title: name, sub: 'fishdraw · Lingdong Huang', lines, code };
  }

  // ── boxOf ─────────────────────────────────────────────────────────────────
  // The subject box in device px: the clear band, with side margins.
  function boxOf(W, H, dpr) {
    const b = V.band;
    const t = b ? b.t : innerHeight * 0.12, bb = b ? b.b : innerHeight * 0.12;
    const h = Math.max(80, innerHeight - t - bb);
    const w = innerWidth * 0.9;
    return { x: (innerWidth - w) / 2 * dpr, y: t * dpr, w: w * dpr, h: h * dpr };
  }

  // ── render ────────────────────────────────────────────────────────────────
  function render(now) {
    if (!V) return;
    V.raf = requestAnimationFrame(render);
    if (V.bandFn && now - V.bandAt > 250) { V.bandAt = now; try { V.band = V.bandFn(innerHeight); } catch (e) { V.band = null; } }
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.round(innerWidth * dpr), H = Math.round(innerHeight * dpr), c = V.canvas, x = V.ctx;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    let shot = V.shot;
    // Cut when the shot is over and the next one is ready (at most 5 s late).
    if (shot && shot.t0 && (now - shot.t0) / 1000 > shot.dur && (V.next.isReady || (now - shot.t0) / 1000 > shot.dur + 5)) {
      V.shot = shot = V.next; shot.t0 = 0; V.next = prepare(nextType());
    }
    if (shot && !shot.t0 && shot.isReady) { shot.t0 = now; V.count++; V.label(labelFor(shot)); }
    const theme = THEMES[shot ? shot.theme : 'cream'];
    const mmDev = MM_PER_PX / dpr;
    x.setTransform(1, 0, 0, 1, 0, 0);
    // The paper over the whole window.
    drawPlate(x, { L: { w: W * mmDev, h: H * mmDev, rules: [], texts: [], cells: [] }, theme, view: { s: 1 / mmDev, ox: 0, oy: 0 },
      fishes: [], progress: [], grain: getGrain(), pen: 0.3, dpr });
    if (!shot || !shot.t0) return;
    const t = (now - shot.t0) / 1000, box = boxOf(W, H, dpr);
    const inner = Object.assign({}, theme, { paper: 'rgba(0,0,0,0)', grain: 0, vignette: 0, grid: null });
    const bw = box.w * mmDev, bh = box.h * mmDev;
    const pen = 0.3 * Math.max(0.8, Math.min(1.6, Math.min(innerWidth, innerHeight) / 700));
    if (shot.type === 'plate') {
      const L = layoutPlate({ w: bw, h: bh, rows: shot.rows, cols: shot.cols, border: false, title: false, labels: true, screen: true, names: shot.specs.map(s => s.name) });
      const n = shot.specs.length, slot = shot.dur * 0.72 / n;
      const progress = shot.specs.map((s, i) => {
        const f = shot.fishes[i]; if (!f) return 0;
        const local = t - i * slot;
        return local <= 0 ? 0 : local >= slot * 1.8 ? null : f.total * local / (slot * 1.8);
      });
      // A cell shows its label only once its pen has started.
      const Lv = Object.assign({}, L, { texts: L.texts.filter(tx => tx.cell == null || t > tx.cell * slot) });
      drawPlate(x, { L: Lv, theme: inner, view: { s: 1 / mmDev, ox: box.x, oy: box.y }, fishes: shot.fishes, progress, pen: pen * 0.8, marker: true, dpr, hiCell: -1 });
      return;
    }
    const L = fitCell(shot.type === 'morph' ? shot.fishes : [shot.fishes[0]], bw, bh);
    let view = { s: 1 / mmDev, ox: box.x, oy: box.y };
    if (shot.type === 'push') {
      // The focus is a point of the fish bbox (u, v in 0..1).
      const cl = L.cells[0], fm = [cl.fx + (cl.bx + shot.focus.u * cl.bw) * cl.k, cl.fy + (cl.by + shot.focus.v * cl.bh) * cl.k];
      const e = ease(t / shot.dur), z = 1 + (shot.zoom - 1) * e;
      const s = view.s * z;
      const sx0 = box.x + fm[0] * view.s, sy0 = box.y + fm[1] * view.s;
      const sx = sx0 + (box.x + box.w / 2 - sx0) * e, sy = sy0 + (box.y + box.h / 2 - sy0) * e;
      view = { s, ox: sx - fm[0] * s, oy: sy - fm[1] * s };
      // The pen grows with the zoom, but slower, so close-ups stay fine.
      drawPlate(x, { L, theme: inner, view, fishes: [shot.fishes[0]], progress: [null], pen: pen / Math.sqrt(z), dpr, hiCell: -1 });
      return;
    }
    if (shot.type === 'draw') {
      const f = shot.fishes[0], T = shot.dur * 0.7;
      const prog = f && t < T ? f.total * (t / T) : null;
      drawPlate(x, { L, theme: inner, view, fishes: [f], progress: [prog], pen, marker: true, dpr, hiCell: -1 });
      return;
    }
    // morph: step k of K, with a cross-fade in the last 35% of each step.
    const K = shot.specs.length, step = shot.dur / K;
    const k = Math.min(K - 1, Math.floor(t / step)), local = (t - k * step) / step;
    const a = k < K - 1 ? ease((local - 0.65) / 0.35) : 0;
    x.globalAlpha = 1 - a;
    drawPlate(x, { L, theme: inner, view, fishes: [shot.fishes[k]], progress: [null], pen, dpr, hiCell: -1 });
    if (a > 0) {
      x.globalAlpha = a;
      drawPlate(x, { L, theme: inner, view, fishes: [shot.fishes[k + 1]], progress: [null], pen, dpr, hiCell: -1 });
    }
    x.globalAlpha = 1;
  }

  window.snSaver = {
    enter(o = {}) {
      if (V) this.exit();
      const calm = Math.min(1, Math.max(0, o.calm ?? 0.7));
      const st = document.createElement('style');
      st.id = 'saverStyle';
      st.textContent = '.topbar,#panel,#dock,#gear,#caption,#busy,#desk{display:none!important}' +
        '#saverCanvas{position:fixed;inset:0;width:100%;height:100%;display:block;z-index:60;cursor:none}';
      document.head.append(st);
      const canvas = document.createElement('canvas'); canvas.id = 'saverCanvas';
      document.body.append(canvas);
      V = { rnd: mulberry((o.seed >>> 0) || 1), calm, label: typeof o.label === 'function' ? o.label : () => {},
        canvas, ctx: canvas.getContext('2d'), style: st, bag: [], tbag: [], lastType: '', count: 0,
        band: null, bandFn: null, bandAt: 0, raf: 0 };
      import('../../lib/saver-clear.js').then(m => { if (V) V.bandFn = m.plateBand; }).catch(() => { /* no shell: the default band */ });
      onEnter();
      V.shot = prepare(nextType());
      V.next = prepare(nextType());
      V.raf = requestAnimationFrame(render);
      return { canvas, warmupMs: 1500 };
    },
    exit() {
      if (!V) return;
      cancelAnimationFrame(V.raf);
      pool.cancel('saver');
      V.label(null);
      V.style.remove(); V.canvas.remove();
      V = null;
      onExit();
    },
    debug() { return V ? { type: V.shot && V.shot.type, t0: V.shot && V.shot.t0, name: V.shot && V.shot.specs[0].name, theme: V.shot && V.shot.theme, count: V.count, band: V.band } : null; },
  };
  return window.snSaver;
}
