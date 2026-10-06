// ============================================================================
//  HALFTONE  ·  saver.js — the screensaver hook (window.snSaver)
// ----------------------------------------------------------------------------
//  The shell screensaver (lib/screensaver.js) calls snSaver.enter(opts) with
//  opts = { calm, seconds, caption, seed, label }. enter() hides the page
//  GUI (html.ht-saver; the shell uses sn-saver for its generic mode),
//  decodes the four photos, and starts a shot director. It resolves to
//  { canvas, warmupMs }; the canvas is the page canvas #gl, which stays in
//  the document.
//
//  SHOTS. A seeded shuffle of a deck of shot kinds, and a second seeded
//  shuffle of the sources (the two scenes and the four photos). opts.seed
//  changes each run, so each run plays a new order with new values. The
//  counters live in the run object, so a new load starts from zero.
//    push ..... a push-in from the full image to the dots and the rosettes
//               (zoom 1 to 6..16) at a point of interest of the image
//    freq ..... a frequency sweep (for example 14 -> 70 cells), upstream
//    angle .... Extended: the four screens turn together by 20..40 degrees,
//               close in, so the rosette and the moire change
//    palette .. Extended: one ink set, then a second one half way, with a
//               dot shape; a slow push-in
//    split .... the split line wipes across: the source on the left, the
//               halftone on the right
//  A shot holds 5 + 5 calm + 0..2 s (calm 1 is the longest). Each cut fades
//  through black; a new source loads while the frame is black.
//
//  FRAMING. main.js clearArea() reads S.band, the clear band between the
//  plate's top and bottom text (lib/saver-clear.js plateBand), every 250 ms.
//  While the plate fades between two titles, plateBand returns null; the
//  director keeps the last band.
//
//  PLATE. opts.label gets the title (the source), the settings, the credit,
//  and a real excerpt of the loaded WGSL: the K screen of halftone()
//  (halftone.wgsl) in upstream shots, screen_uv or dot_dist
//  (extended.wgsl) in extended shots.
//
//  grep -n: "const DECK"  "function makeShot"  "function apply"  "function plate"
//           "async function nextShot"  "enter(opts)"
// ============================================================================
import { plateBand } from '../../lib/saver-clear.js';

const DECK = ['push', 'push', 'freq', 'angle', 'palette', 'palette', 'split'];
const INKSETS = ['newsprint', 'riso', 'pop', 'duotone', 'process'];
const SHAPE_NAMES = ['round', 'ellipse', 'line', 'square'];

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t * t * (3 - 2 * t);
const clamp01 = t => Math.min(1, Math.max(0, t));

// A real excerpt of a WGSL source: lines [from, to) of function name.
// The definition starts a line, so a mention in a comment does not match.
const fnStart = (src, name) => { const m = new RegExp('^fn ' + name + '\\(', 'm').exec(src); return m ? m.index : -1; };
function fnExtract(src, name, from, to) {
  const i = fnStart(src, name);
  if (i < 0) return '';
  const lines = src.slice(i, src.indexOf('\n}', i) + 2).split('\n');
  const part = lines.slice(from, to);
  return (from > 0 ? '…\n' : '') + part.join('\n') + (to < lines.length ? '\n…' : '');
}
// The lines of fn name from the first line that contains `start`, n lines.
function fnExtractAt(src, name, start, n) {
  const i = fnStart(src, name);
  if (i < 0) return '';
  const lines = src.slice(i, src.indexOf('\n}', i) + 2).split('\n');
  const a = lines.findIndex(l => l.includes(start));
  return a < 0 ? fnExtract(src, name, 0, n) : fnExtract(src, name, a, a + n);
}

export function installSaver(ctx) {
  const { S, SOURCES } = ctx;
  let run = null;

  function shuffle(a, r) {
    for (let j = a.length - 1; j > 0; j--) { const q = Math.floor(r() * (j + 1)); [a[j], a[q]] = [a[q], a[j]]; }
    return a;
  }
  function nextSource() {
    if (!run.srcDeck.length) {
      run.srcDeck = shuffle(SOURCES.map(s => s.key), run.r);
      if (run.srcDeck[0] === run.lastSrc && run.srcDeck.length > 1) run.srcDeck.push(run.srcDeck.shift());
    }
    return (run.lastSrc = run.srcDeck.shift());
  }
  function nextKind() {
    if (!run.deck.length) {
      run.deck = shuffle(DECK.slice(), run.r);
      // No kind twice in a row, also across the deck boundary.
      const d = run.deck, prev = run.shot ? run.shot.kind : null;
      for (let i = 0; i < d.length; i++) {
        const before = i ? d[i - 1] : prev;
        if (d[i] !== before) continue;
        const j = d.findIndex((k, q) => q > i && k !== before && (q + 1 >= d.length || d[q + 1] !== d[i]));
        if (j > 0) [d[i], d[j]] = [d[j], d[i]];
      }
    }
    return run.deck.shift();
  }

  function makeShot(kind, src, r, calm) {
    const dur = 5 + 5 * calm + r() * 2;
    const pick = a => a[Math.floor(r() * a.length)];
    const s = SOURCES.find(q => q.key === src);
    const poi = pick(s.poi);
    const base = { kind, src, dur, poi, freq: Math.round(lerp(24, 48, r())) };
    if (kind === 'push') {
      return { ...base, mode: r() < 0.6 ? 'upstream' : 'extended', ext: { palette: pick(['newsprint', 'riso', 'process']), shape: 0 },
        z1: lerp(6, 16, r()), freq: Math.round(lerp(20, 40, r())) };
    }
    if (kind === 'freq') {
      const up = r() < 0.5;
      return { ...base, mode: 'upstream', f0: up ? 12 : 90, f1: up ? lerp(60, 90, r()) : lerp(14, 22, r()), zoom: lerp(1, 1.6, r()) };
    }
    if (kind === 'angle') {
      return { ...base, mode: 'extended', ext: { palette: pick(['process', 'newsprint', 'pop']), shape: pick([0, 0, 1, 3]) },
        rot0: lerp(-20, 0, r()), rot1: lerp(20, 40, r()) * (r() < 0.5 ? -1 : 1), zoom: lerp(2.2, 4, r()) };
    }
    if (kind === 'palette') {
      const a = pick(INKSETS);
      let b = pick(INKSETS); for (let i = 0; i < 6 && b === a; i++) b = pick(INKSETS);
      const mono = r() < 0.2;
      return { ...base, mode: 'extended', ext: { palette: a, shape: pick([0, 1, 2, 3]), mono, gain: lerp(0, 0.3, r()), misreg: r() < 0.4 ? lerp(0.15, 0.4, r()) : 0 },
        pal2: b, z0: 1, z1: lerp(1.6, 2.6, r()), freq: Math.round(lerp(28, 60, r())) };
    }
    return { ...base, mode: r() < 0.5 ? 'upstream' : 'extended', ext: { palette: pick(INKSETS), shape: pick([0, 1, 3]) },
      dir: r() < 0.5 ? 1 : -1, freq: Math.round(lerp(30, 70, r())) };
  }

  // Apply the shot at time t (s) into it. Called every frame by main.js.
  function apply(sh, t) {
    const k = clamp01(t / sh.dur), e = ease(k);
    S.split.on = false;
    S.freq = sh.freq;
    if (sh.kind === 'push') {
      const z = Math.exp(lerp(0, Math.log(sh.z1), ease(clamp01((k - 0.08) / 0.84))));
      S.zoom = z;
      const w = clamp01((z - 1) / 1.5);
      S.cx = lerp(0.5, sh.poi[0], w); S.cy = lerp(0.5, sh.poi[1], w);
    } else if (sh.kind === 'freq') {
      S.freq = Math.round(Math.exp(lerp(Math.log(sh.f0), Math.log(sh.f1), e)));
      S.zoom = sh.zoom; S.cx = sh.poi[0]; S.cy = sh.poi[1];
    } else if (sh.kind === 'angle') {
      S.ext.rot = lerp(sh.rot0, sh.rot1, e);
      S.zoom = sh.zoom; S.cx = sh.poi[0]; S.cy = sh.poi[1];
    } else if (sh.kind === 'palette') {
      if (k > 0.5 && !sh.switched) { sh.switched = true; ctx.setExt({ palette: sh.pal2 }); plate(); }
      S.zoom = lerp(sh.z0, sh.z1, e); S.cx = lerp(0.5, sh.poi[0], e); S.cy = lerp(0.5, sh.poi[1], e);
    } else {
      S.zoom = 1; S.cx = 0.5; S.cy = 0.5;
      S.split.on = true;
      const p = ease(clamp01((k - 0.1) / 0.8));
      S.split.f = sh.dir > 0 ? lerp(0.02, 0.98, p) : lerp(0.98, 0.02, p);
    }
    ctx.clampView();
    S.fade = Math.max(0, Math.min(1, t / 0.6, (sh.dur - t) / 0.5));
  }

  function plate() {
    if (!run || !run.label) return;
    const sh = run.shot, src = ctx.shaderSource() || {};
    const s = SOURCES.find(q => q.key === sh.src);
    const up = sh.mode === 'upstream';
    const E = S.ext;
    const code = up
      ? { lang: 'wgsl', name: 'shaders/halftone.wgsl · halftone', text: fnExtractAt(src.halftone || '', 'halftone', 'let Kst', 3) }
      : sh.kind === 'angle'
        ? { lang: 'wgsl', name: 'shaders/extended.wgsl · screen_uv', text: fnExtract(src.extended || '', 'screen_uv', 0, 6) }
        : { lang: 'wgsl', name: 'shaders/extended.wgsl · dot_dist', text: fnExtract(src.extended || '', 'dot_dist', 0, 6) };
    const kindTitle = { push: 'Push-in', freq: 'Frequency sweep', angle: 'Screen angles', palette: 'Ink sets', split: 'Split' }[sh.kind];
    const subs = {
      push: 'From the whole image down to the dots: each zoom computes new dots',
      freq: 'Screen cells across the image height, from coarse to fine',
      angle: 'Four screens turn together; the rosette and the moire change',
      palette: 'Multiplied inks on paper; this page\'s extensions to glsl-halftone',
      split: 'The source on the left of the line, the halftone on the right',
    };
    const params = [
      { sym: 'f', name: 'frequency', value: sh.kind === 'freq' ? `${Math.round(sh.f0)} → ${Math.round(sh.f1)}` : String(sh.freq), cls: 'm1' },
      { sym: '\\theta', name: 'C M Y K', value: up ? '15° 75° 0° 45°' : E.angles.map(a => Math.round(a + (sh.kind === 'angle' ? 0 : E.rot)) + '°').join(' ') + (sh.kind === 'angle' ? ` + ${Math.round(sh.rot0)}° → ${Math.round(sh.rot1)}°` : ''), cls: 'm3' },
      { sym: 'm', name: 'mode', value: up ? 'upstream' : (E.mono ? 'mono · ' : '') + E.palette + ' · ' + SHAPE_NAMES[E.shape], cls: 'm5' },
    ];
    if (sh.kind === 'push') params.push({ sym: 'z', name: 'zoom', value: `1 → ${sh.z1.toFixed(0)}×`, cls: 'm2' });
    run.label({ title: `${kindTitle} · ${s.name}`, sub: subs[sh.kind], params,
      lines: [s.credit, up ? 'glsl-halftone (glslify, MIT), Stefan Gustavson (public domain), simplex noise by Ashima Arts (MIT)' : 'Extended mode: this page\'s own code on the glsl-halftone port'],
      code });
  }

  function tick(dt) {
    if (!run) return;
    const now = performance.now();
    if (now - run.bandAt > 250) { run.bandAt = now; const b = plateBand(innerHeight); if (b) S.band = b; }
    S.time += dt;
    if (run.loading) { S.fade = 0; return; }
    run.t += dt;
    if (run.t >= run.shot.dur) { nextShot(); return; }
    apply(run.shot, run.t);
  }

  async function nextShot() {
    const kind = nextKind(), src = nextSource();
    const sh = makeShot(kind, src, run.r, run.calm);
    run.loading = true; S.fade = 0;
    const my = run;
    try { await ctx.setSource(src, { keepView: true }); } catch (e) { /* the source keeps the last image */ }
    if (run !== my) return;
    ctx.resetExt();
    if (sh.ext) ctx.setExt(sh.ext);
    ctx.setMode(sh.mode);
    run.shot = sh; run.t = 0; run.count++; run.loading = false;
    apply(sh, 0);
    plate();
  }

  window.snSaver = {
    enter(opts = {}) {
      const calm = Math.min(1, Math.max(0, opts.calm ?? 0.7));
      document.documentElement.classList.add('ht-saver');
      run = { r: rng(opts.seed || 1), calm, deck: [], srcDeck: [], lastSrc: null, shot: null, t: 0, count: 0, bandAt: -1e9, loading: true,
        label: typeof opts.label === 'function' ? opts.label : null };
      run.saved = { source: S.source, freq: S.freq, mode: S.mode, ext: JSON.parse(JSON.stringify(S.ext)), split: { ...S.split }, loupe: { ...S.loupe }, zoom: S.zoom, cx: S.cx, cy: S.cy, playing: S.playing };
      S.saver = true; S.playing = true; S.loupe.on = false; S.fade = 0;
      return ctx.ready.then(async () => {
        await ctx.preload();
        S.saverTick = tick;
        await nextShot();
        return { canvas: ctx.canvas, warmupMs: 700 };
      });
    },
    exit() {
      const sv = run && run.saved;
      run = null; S.saverTick = null; S.saver = false; S.band = null; S.fade = 1;
      document.documentElement.classList.remove('ht-saver');
      if (sv) {
        Object.assign(S, { freq: sv.freq, mode: sv.mode, ext: sv.ext, split: sv.split, loupe: sv.loupe, playing: sv.playing });
        ctx.setSource(sv.source, { keepView: true }).then(() => { Object.assign(S, { zoom: sv.zoom, cx: sv.cx, cy: sv.cy }); ctx.syncUI(); });
      }
      ctx.syncUI();
    },
    debug() {
      if (!run || !run.shot) return run ? { loading: run.loading } : null;
      const sh = run.shot;
      return { kind: sh.kind, src: sh.src, mode: S.mode, t: +run.t.toFixed(2), dur: +sh.dur.toFixed(2), count: run.count, deckLeft: run.deck.slice(),
        freq: S.freq, zoom: +S.zoom.toFixed(2), rot: +S.ext.rot.toFixed(1), palette: S.ext.palette, split: S.split.on ? +S.split.f.toFixed(2) : null,
        fade: +S.fade.toFixed(2), band: S.band };
    },
  };
}
