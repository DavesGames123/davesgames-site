// ============================================================================
//  THREAD ART  ·  saver.js — the screensaver hook (window.snSaver)
// ----------------------------------------------------------------------------
//  The shell screensaver (lib/screensaver.js) calls snSaver.enter(opts) with
//  opts = { calm, seconds, caption, seed, label }. enter() hides the page
//  GUI (html.ta-saver) and starts a shot director. It resolves to
//  { canvas, warmupMs }; the canvas is #view, which stays in the document.
//
//  SHOTS. A seeded shuffle of a deck of shot kinds; opts.seed changes each
//  run, so each run plays a new order with new values. Counters live in the
//  run object, so a new load starts from zero.
//    build .... a portrait threaded live from the first line, whole frame
//    closeup .. a part of a portrait (eye, mouth), zoom 3.5 to 6: the lines
//               cross slowly, peg to peg, over a half-laid piece
//    colour ... several threads (CMY + K or a palette from the image)
//    reveal ... a finished piece seen close, then a slow zoom out
//    shape .... a test shape of this page in a circle, square or hexagon
//  A shot holds 5 + 5 calm + 0..2 s. A cut fades through black; the new
//  run is built and, for closeup and reveal, laid ahead while black.
//
//  FRAMING. main.js clearArea() reads S.band, the clear band between the
//  plate's top and bottom text (lib/saver-clear.js plateBand), every 250 ms.
//
//  PLATE. Title (shot kind and image), sub, the pegs, the lines, the
//  opacity and the threads as values, and the greedy objective as TeX.
//  No code on the plate.
//
//  grep -n: "const DECK"  "function makeShot"  "function apply"  "function plate"
//           "async function nextShot"  "enter(opts)"
// ============================================================================
import { plateBand } from '../../lib/saver-clear.js';

const DECK = ['build', 'build', 'closeup', 'closeup', 'colour', 'reveal', 'reveal', 'shape'];
const TEX = [
  String.raw`(k^{*},\,j^{*}) = \arg\max_{k,\;j}\; \sum_{p\,\in\,L(c_k,\,j)} \big( 2\,\delta_k \cdot r_p - \lVert \delta_k \rVert^{2} \big)`,
  String.raw`r_p \leftarrow r_p - \delta_{k^{*}} \;\; (p \in L), \qquad c_{k^{*}} \leftarrow j^{*}`,
];

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t * t * (3 - 2 * t);
const clamp01 = t => Math.min(1, Math.max(0, t));

export function installSaver(ctx) {
  const { S, SOURCES } = ctx;
  const portraits = SOURCES.filter(s => s.portrait).map(s => s.key);
  const shapes = SOURCES.filter(s => s.kind === 'shape').map(s => s.key);
  const byKey = Object.fromEntries(SOURCES.map(s => [s.key, s]));
  let run = null;

  function shuffle(a, r) {
    for (let j = a.length - 1; j > 0; j--) { const q = Math.floor(r() * (j + 1)); [a[j], a[q]] = [a[q], a[j]]; }
    return a;
  }
  function nextKind() {
    if (!run.deck.length) {
      run.deck = shuffle(DECK.slice(), run.r);
      if (run.shot && run.deck[0] === run.shot.kind) run.deck.push(run.deck.shift());
    }
    return run.deck.shift();
  }
  function pickSrc(list) {
    const r = run.r, opts = list.filter(k => k !== run.lastSrc);
    return (run.lastSrc = opts[Math.floor(r() * opts.length)] || list[0]);
  }

  function makeShot(kind) {
    const r = run.r, calm = run.calm;
    const pick = a => a[Math.floor(r() * a.length)];
    const dur = 5 + 5 * calm + r() * 2;
    const base = { kind, dur, shape: r() < 0.6 ? 'circle' : pick(['square', 'hexagon']), P: pick([200, 240, 288]),
      maxLines: 3600, alpha: 0.1, dark: r() < 0.22, mode: 'mono', pal: 'cmyk', seed: Math.floor(r() * 1e6), zoom: 1, res: 384 };
    if (kind === 'build') {
      const src = pickSrc(portraits);
      const colour = src === 'van-gogh';
      return { ...base, src, mode: colour ? 'colour' : 'mono', pal: 'image', alpha: colour ? 0.12 : 0.1, maxLines: colour ? 5000 : 3600 };
    }
    if (kind === 'closeup') {
      const src = pickSrc(portraits.filter(k => k !== 'van-gogh'));
      return { ...base, src, shape: 'circle', dark: false, prefill: Math.floor(lerp(0.35, 0.6, r()) * 3600), lps: lerp(14, 40, r()),
        zoom: lerp(3.5, 6, r()), poi: pick(byKey[src].poi), drift: [lerp(-0.03, 0.03, r()), lerp(-0.03, 0.03, r())] };
    }
    if (kind === 'colour') {
      const src = pickSrc(['van-gogh', 'pearl', 'mona-lisa', 'star', 'rings']);
      const shape = byKey[src].kind === 'shape';
      return { ...base, src, mode: 'colour', pal: shape ? pick(['cmyk', 'rgbw']) : 'image', alpha: 0.12, maxLines: 5000,
        dark: shape ? r() < 0.5 : false };
    }
    if (kind === 'reveal') {
      const src = pickSrc(portraits);
      const colour = src === 'van-gogh';
      return { ...base, src, mode: colour ? 'colour' : 'mono', pal: 'image', alpha: colour ? 0.12 : 0.1, maxLines: colour ? 5000 : 3600,
        prefill: Infinity, z0: lerp(6, 9, r()), poi: pick(byKey[src].poi) };
    }
    const src = pickSrc(shapes);
    const colour = !!byKey[src].colour && r() < 0.7;
    return { ...base, src, mode: colour ? 'colour' : 'mono', pal: pick(['cmyk', 'rgbw']), alpha: colour ? 0.14 : 0.12, maxLines: 3000, dark: r() < 0.45 };
  }

  // Apply the shot at time t (s) into it. Called every frame by main.js.
  function apply(sh, t) {
    const k = clamp01(t / sh.dur);
    if (sh.kind === 'closeup') {
      S.zoom = sh.zoom;
      S.cx = sh.poi[0] + sh.drift[0] * ease(k); S.cy = sh.poi[1] + sh.drift[1] * ease(k);
    } else if (sh.kind === 'reveal') {
      const e = ease(clamp01((k - 0.06) / 0.88));
      S.zoom = Math.exp(lerp(Math.log(sh.z0), 0, e));
      const w = clamp01((S.zoom - 1) / 2);
      S.cx = lerp(0.5, sh.poi[0], w); S.cy = lerp(0.5, sh.poi[1], w);
    } else { S.zoom = 1; S.cx = 0.5; S.cy = 0.5; }
    ctx.clampView();
    S.fade = Math.max(0, Math.min(1, t / 0.6, (sh.dur - t) / 0.5));
  }

  function plate() {
    if (!run || !run.label) return;
    const sh = run.shot, s = byKey[sh.src], R = ctx.run;
    const K = R ? R.K : 1;
    const kindTitle = { build: 'Threading', closeup: 'Close-up', colour: 'Colour threads', reveal: 'Reveal', shape: 'Threading a shape' }[sh.kind];
    const subs = {
      build: 'One thread, peg to peg: each line is the one that lowers the error most',
      closeup: 'The thread crosses the face one chord at a time',
      colour: `${K} threads; at each step the best thread and the best peg win`,
      reveal: 'Close, the lines are only straight chords; far, they are a picture',
      shape: `A ${sh.shape} frame of ${sh.P} pegs`,
    };
    const params = [
      { sym: 'P', name: 'pegs', value: String(sh.P), cls: 'm1' },
      { sym: 'n', name: 'lines', value: sh.kind === 'reveal' && R ? R.lines.length.toLocaleString() : `up to ${sh.maxLines.toLocaleString()}`, cls: 'm2' },
      { sym: 'a', name: 'opacity', value: sh.alpha.toFixed(2), cls: 'm3' },
      { sym: 'K', name: 'threads', value: K === 1 ? (sh.dark ? '1 · white on black' : '1 · black on white') : `${K} · ${sh.pal === 'image' ? 'from the image' : sh.pal === 'cmyk' ? 'CMY + K' : 'RGB + W'}`, cls: 'm5' },
    ];
    run.label({
      title: `${kindTitle} · ${s ? s.name : 'Image'}`,
      sub: subs[sh.kind], params, tex: TEX,
      lines: [s ? s.credit : '', 'After the idea of image-stylization-threading by Jérémie Piellard; our own model and WGSL'],
    });
  }

  function tick(dt) {
    if (!run) return;
    const now = performance.now();
    if (now - run.bandAt > 250) { run.bandAt = now; const b = plateBand(innerHeight); if (b) S.band = b; }
    if (run.loading) { S.fade = 0; return; }
    const sh = run.shot, R = ctx.run;
    if (sh.prefill && !sh.prepped) {
      // Lay ahead while black: closeup to its prefill, reveal to the end.
      S.fade = 0;
      const target = Math.min(sh.prefill, R ? R.cfg.maxLines : 0);
      if (R && (ctx.shown >= target || (R.done && ctx.shown >= R.lines.length)) || run.prepT > 14) {
        sh.prepped = true;
        S.lpsOverride = sh.kind === 'closeup' ? sh.lps : 0.0001;
        plate();
      } else { run.prepT += dt; return; }
    }
    run.t += dt;
    if (run.t >= sh.dur) { nextShot(); return; }
    apply(sh, run.t);
  }

  async function nextShot() {
    const sh = makeShot(nextKind());
    run.loading = true; S.fade = 0;
    const my = run;
    Object.assign(S, { shape: sh.shape, P: sh.P, maxLines: sh.maxLines, alpha: sh.alpha, dark: sh.dark, mode: sh.mode, pal: sh.pal,
      seed: sh.seed, res: sh.res, contrast: 1, width: 1, showErr: false, finishing: false, playing: true });
    S.lpsOverride = sh.prefill ? Infinity : (sh.maxLines * 0.92) / sh.dur;
    if (sh.kind === 'build' || sh.kind === 'colour' || sh.kind === 'shape') S.lpsOverride = Math.max(60, (sh.maxLines * 0.8) / sh.dur);
    try { await ctx.setSource(sh.src, { keep: true }); } catch (e) { /* keep the last image */ }
    if (run !== my) return;
    run.shot = sh; run.t = 0; run.prepT = 0; run.count++; run.loading = false;
    apply(sh, 0);
    if (!sh.prefill) plate();
  }

  window.snSaver = {
    enter(opts = {}) {
      const calm = Math.min(1, Math.max(0, opts.calm ?? 0.7));
      document.documentElement.classList.add('ta-saver');
      run = { r: rng(opts.seed || 1), calm, deck: [], lastSrc: null, shot: null, t: 0, prepT: 0, count: 0, bandAt: -1e9, loading: true,
        label: typeof opts.label === 'function' ? opts.label : null };
      run.saved = { source: S.source, shape: S.shape, P: S.P, maxLines: S.maxLines, alpha: S.alpha, dark: S.dark, mode: S.mode, pal: S.pal,
        seed: S.seed, res: S.res, contrast: S.contrast, width: S.width, showErr: S.showErr, zoom: S.zoom, cx: S.cx, cy: S.cy, playing: S.playing };
      S.saver = true; S.fade = 0;
      return ctx.ready.then(async () => {
        S.saverTick = tick;
        await nextShot();
        return { canvas: ctx.canvas, warmupMs: 900 };
      });
    },
    exit() {
      const sv = run && run.saved;
      run = null; S.saverTick = null; S.saver = false; S.band = null; S.fade = 1; S.lpsOverride = 0;
      document.documentElement.classList.remove('ta-saver');
      if (sv) {
        const { source, ...rest } = sv;
        Object.assign(S, rest);
        ctx.setSource(source, { keep: true }).then(() => ctx.syncUI());
      }
      ctx.invalidate();
      ctx.syncUI();
    },
    debug() {
      if (!run || !run.shot) return run ? { loading: run.loading } : null;
      const sh = run.shot, R = ctx.run;
      return { kind: sh.kind, src: sh.src, t: +run.t.toFixed(2), dur: +sh.dur.toFixed(2), count: run.count, deckLeft: run.deck.slice(),
        lines: R ? R.lines.length : 0, shown: Math.floor(ctx.shown), zoom: +S.zoom.toFixed(2), fade: +S.fade.toFixed(2), band: S.band, prepped: !!sh.prepped };
    },
  };
}
