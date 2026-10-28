// ============================================================================
//  STEREOGRAM MAKER  ·  worker.js — the module worker of the page
// ----------------------------------------------------------------------------
//  All heavy work runs here: model loads, depth maps, pattern tiles,
//  stereograms and turntable frames. The page keeps two of these workers:
//  one for the stage (render, preview, turntable) and one for the
//  thumbnails (models, tiles, examples), so a slow thumbnail never holds
//  up the stage. The saver keeps its own.
//
//  PROTOCOL. in { id, op, args }. out { id, ok: true, result } or
//  { id, ok: false, error }. A turntable also sends
//  { id, progress: { k, n, frame } } for each frame as it is made. Every
//  Image buffer goes back as a transfer.
//    upload     { ref, img }                 keep an uploaded Image
//    render     { state, w, h, dpi, colors, relief }
//                 -> { stereo: StereoImage, relief: Image|null, ms }
//    preview    { src, w, h }                -> { relief }   (drag to turn)
//    modelThumb { id, size }                 -> { relief }
//    tiles      { ids, size, seed, tpal }    -> [Image + { id }]
//    practice   { w, h, dpi, mode }          -> { stereo, relief }
//    turntable  { state, w, h, dpi, n, colors, gen } -> { n, sepFar, stale }
//    turnGen    { gen }                      -> { gen }
//  TURNTABLE GENERATION. The page sends turnGen when it starts or stops a
//  turntable. A turntable makes one frame at a time and yields between
//  frames, so a turnGen message can arrive. The page sends gens in order,
//  so the last gen to arrive is the newest. When args.gen is not the
//  newest gen, the turntable stops and returns stale: true with the
//  frames made so far (n). A turntable with no gen (the saver) never stops.
//  state is the page state (state.js). dpi is the output px per inch.
//
//  CACHES. Meshes stay loaded (the library is small). The last raw depth
//  maps and tiles sit in small LRU maps, so a change of pattern or of a
//  view setting does not draw the depth again.
//
//  handle(msg, post) is exported, so node tests run the same code with no
//  worker. The onmessage binding runs only inside a worker.
//
//  grep -n targets: "export async function handle", "async function depthOf",
//                   "function tileOf", "function stereoOpts", "const TEXT_FACES"
// ============================================================================
import * as E from './engine-api.js';
import { reliefImage, shapeDepth, practiceDepth, mirrorTile, cropSquare, recolour, repeatTile } from './depthkit.js';
import { PALETTES } from '../pattern-designer/palettes.js';

const meshes = new Map(), uploads = new Map();
let readBytes = null;
// The node tests read the GLB files from disk; a worker uses fetch.
export function setReadBytes(fn) { readBytes = fn; meshes.clear(); }
class LRU {
  constructor(n) { this.n = n; this.m = new Map(); }
  get(k) { if (!this.m.has(k)) return undefined; const v = this.m.get(k); this.m.delete(k); this.m.set(k, v); return v; }
  set(k, v) { this.m.set(k, v); while (this.m.size > this.n) this.m.delete(this.m.keys().next().value); return v; }
}
const depthCache = new LRU(6), tileCache = new LRU(24);
let turnGen = 0;     // the newest turntable generation from the page

export function meshOf(id) {
  if (!meshes.has(id)) {
    const p = readBytes ? E.loadModel(id, { readBytes }) : E.loadModel(id);
    meshes.set(id, p);
    p.catch(() => meshes.delete(id));
  }
  return meshes.get(id);
}

// Letter styles. The worker has no page fonts, so the faces name system
// fonts that every platform has in some form.
export const TEXT_FACES = {
  serif: { font: 'Georgia, "Times New Roman", serif', weight: 700, bevel: 0.012 },
  sans: { font: '"Helvetica Neue", Helvetica, Arial, sans-serif', weight: 800, bevel: 0.008 },
  bevel: { font: '"Arial Black", "Helvetica Neue", Arial, sans-serif', weight: 900, bevel: 0.04 },
};

// The raw depth map of a source (before relief and lift), cached.
// match { mu, relief, lift }: the model depth map takes the perspective that
// the fused stereogram implies (engine matchedFov), so the object keeps
// its shape when it is fused.
export async function depthOf(src, w, h, match = null) {
  const mk = match && src.kind === 'model' ? [match.mu, src.relief, src.lift].map(v => Math.round((v ?? 0) * 1000)) : null;
  const key = JSON.stringify([src.kind, src.id, src.yaw, src.pitch, src.roll || 0, src.fit, src.text, src.face, src.shape, src.invert, src.soft, src.ref, w, h, mk]);
  const hit = depthCache.get(key);
  if (hit) return hit;
  let dm;
  if (src.kind === 'model') {
    const mesh = await meshOf(src.id);
    // The WebGL2 path (opts.gl) has not run in a browser yet (NOTES.md), so
    // the CPU rasteriser draws every depth map.
    dm = E.depthFromMesh(mesh, { w, h, yaw: src.yaw, pitch: src.pitch, roll: src.roll || 0, fit: src.fit,
      match: match ? { mu: match.mu, relief: src.relief, lift: src.lift } : undefined });
  } else if (src.kind === 'text') {
    const f = TEXT_FACES[src.face] || TEXT_FACES.serif;
    dm = E.depthFromText(src.text || ' ', { w, h, size: 0.42, font: f.font, weight: f.weight, bevel: Math.max(1, Math.round(f.bevel * Math.min(w, h))) });
  } else if (src.kind === 'shape') {
    dm = E.depthFromSDF(src.shape, { w, h });
  } else if (src.kind === 'depth' || src.kind === 'photo') {
    const img = uploads.get(src.ref);
    if (!img) throw new Error('no uploaded image');
    dm = src.kind === 'photo'
      ? E.depthFromImage(img, { w, h, mode: 'photo', invert: !!src.invert, blur: src.soft })
      : E.depthFromImage(img, { w, h, mode: 'depth', invert: !!src.invert });
  } else throw new Error('unknown source ' + src.kind);
  return depthCache.set(key, dm);
}

// The tile Image of a pattern state at a repeat of sepFar px, or null for
// the dot sources.
export function tileOf(pat, sepFar) {
  if (pat.kind === 'image') return uploads.get(pat.ref) || null;
  if (pat.kind !== 'tile' || !pat.id) return null;
  const k = Math.max(1, Math.min(3, pat.tdens | 0 || 1));
  const size = Math.max(16, Math.round(sepFar / k));
  const key = [pat.id, pat.seed, size, k, pat.tpal || ''].join('|');
  const hit = tileCache.get(key);
  if (hit) return hit;
  const [t] = E.tilesFromPatterns([pat.id], size, pat.seed);
  return tileCache.set(key, repeatTile(tintTile(t, pat.id, pat.tpal), k));
}

// A tile in the colours of another pattern-designer palette, or as drawn.
const palCols = id => { const p = PALETTES.find(q => q.id === id); return p ? [p.bg, ...p.ink] : null; };
export function tintTile(t, id, tpal) {
  if (!tpal) return t;
  const m = E.tileMeta(id), from = m && palCols(m.palette), to = palCols(tpal);
  return from && to ? recolour(t, from, to) : t;
}

// The engine options of a page state at an output density dpi.
export function stereoOpts(state, dpi, colors) {
  const v = state.view, p = state.pat;
  const o = {
    eyeSep: v.eyeSep / 2.54, dpi, mu: v.mu, mode: v.mode === 'cross' ? 'cross' : 'wall',
    oversample: v.smooth ? 2 : 1, guides: !!v.guides, seed: p.seed | 0 || 1, dot: v.dot | 0 || 1,
    source: p.kind === 'colour' ? 'color' : p.kind === 'dots' ? 'dots' : 'tile', density: p.density,
  };
  if (o.source === 'color' && colors && colors.length) o.palette = colors;
  if (o.source === 'tile') {
    const t = tileOf(p, E.farSeparation(o));
    if (t) o.tile = t; else o.source = 'dots';
  }
  return o;
}

async function stereoOf(state, w, h, dpi, colors) {
  const raw = await depthOf(state.src, w, h, { mu: state.view.mu });
  const dm = shapeDepth(raw, state.src.relief, state.src.lift);
  const stereo = E.sirds(dm, stereoOpts(state, dpi, colors));
  return { dm, stereo };
}

const bufs = (...imgs) => imgs.filter(Boolean).map(i => i.data.buffer);

export async function handle(msg, post) {
  const { id, op, args = {} } = msg;
  try {
    let result, transfer = [];
    if (op === 'upload') {
      let img = args.img;
      if (args.tile) img = mirrorTile(cropSquare(img, Math.min(256, Math.min(img.w, img.h))));
      uploads.set(args.ref, img);
      for (const k of [...depthCache.m.keys()]) if (k.includes(JSON.stringify(args.ref))) depthCache.m.delete(k);
      result = { ref: args.ref, w: img.w, h: img.h };
    } else if (op === 'render') {
      const t0 = Date.now();
      const { dm, stereo } = await stereoOf(args.state, args.w, args.h, args.dpi, args.colors);
      const relief = args.relief === false ? null : reliefImage(dm);
      result = { stereo, relief, ms: Date.now() - t0 };
      transfer = bufs(stereo, relief);
    } else if (op === 'preview') {
      const raw = await depthOf(args.src, args.w, args.h);
      const relief = reliefImage(shapeDepth(raw, args.src.relief, args.src.lift));
      result = { relief }; transfer = bufs(relief);
    } else if (op === 'modelThumb') {
      const m = E.modelMeta(args.id), v = (m && m.view) || {};
      const raw = await depthOf({ kind: 'model', id: args.id, yaw: v.yaw || 0, pitch: v.pitch || 0, roll: v.roll || 0, fit: 0.86 }, args.size, args.size);
      const relief = reliefImage(raw, { bg: [26, 28, 33], bg2: [13, 14, 17] });
      result = { relief }; transfer = bufs(relief);
    } else if (op === 'tiles') {
      result = E.tilesFromPatterns(args.ids, args.size, args.seed).map((t, i) => tintTile(t, args.ids[i], args.tpal));
      transfer = bufs(...result);
    } else if (op === 'practice') {
      const dm = practiceDepth(args.w, args.h);
      const stereo = E.sirds(dm, { eyeSep: 2.5, dpi: args.dpi, mu: 0.3333, mode: args.mode, oversample: 2, guides: true, source: 'dots', seed: 7, dot: args.dot || 1 });
      const relief = reliefImage(dm);
      result = { stereo, relief }; transfer = bufs(stereo, relief);
    } else if (op === 'turnGen') {
      turnGen = args.gen | 0;
      result = { gen: turnGen };
    } else if (op === 'turntable') {
      const gen = args.gen == null ? null : args.gen | 0;
      if (gen != null) turnGen = gen;
      const stale = () => gen != null && gen !== turnGen;
      const st = args.state, mesh = await meshOf(st.src.id);
      const n = args.n | 0, y0 = st.src.yaw || 0;
      const turnOpts = { w: args.w, h: args.h, pitch: st.src.pitch, roll: st.src.roll || 0, fit: st.src.fit,
        match: { mu: st.view.mu, relief: st.src.relief, lift: st.src.lift } };
      const opts = stereoOpts(st, args.dpi, args.colors);
      let sepFar = 0, k = 0;
      // One frame at a time: E.turntable with n = 1 at the yaw of frame k
      // gives frame k of E.turntable(n), and E.animate with its fixed seed
      // keeps the wall still. The yield lets a turnGen message in.
      for (; k < n && !stale(); k++) {
        const d = E.turntable(mesh, 1, Object.assign({}, turnOpts, { yaw: y0 + 360 * k / n }))[0];
        E.animate([shapeDepth(d, st.src.relief, st.src.lift)], opts, (i, frame) => {
          sepFar = frame.sepFar;
          post({ id, progress: { k, n, frame } }, [frame.data.buffer]);
        });
        await new Promise(r => setTimeout(r, 0));
      }
      result = { n: k, sepFar, stale: k < n };
    } else throw new Error('unknown op ' + op);
    post({ id, ok: true, result }, transfer);
  } catch (err) {
    post({ id, ok: false, error: String(err && err.message || err) }, []);
  }
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof document === 'undefined' && typeof WorkerGlobalScope !== 'undefined') {
  self.onmessage = e => handle(e.data, (m, t) => self.postMessage(m, t || []));
}
