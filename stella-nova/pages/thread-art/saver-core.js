// ============================================================================
//  THREAD ART  ·  saver-core.js — the saver plan, the pieces and the cache
// ----------------------------------------------------------------------------
//  No DOM. saver.js, saver-draw.js, saver-worker.js and tests.mjs use it.
//
//  SHOT KINDS (KINDS). Five show the construction, four the results:
//    needle .. the thread laid live, peg to peg; slow at first (each line,
//              the candidate fan from the peg, the winner marked), then a
//              ramp to a blur of thousands of lines
//    split ... three panels: the target, the error draining, the thread
//    chase ... a spring camera close on the needle, then a pull out
//    layers .. a colour piece: each thread colour builds alone, then the
//              layers fly into the combined piece
//    maker ... the peg ring with numbered pegs and the build sheet ticker
//    push .... a slow push-in across a finished piece, a light sweep
//    rack .... thread-level detail (depth of field, glow), then a focus
//              pull out to the whole image
//    wipe .... a before/after wipe between the source and the thread
//    gallery . a wall of finished pieces in circle, square, hexagon frames
//
//  PLAN. makePlan(seed, n, calm): a seeded bag of all kinds, shuffled per
//  bag, no kind twice in a row (also across bags), 6-12 s per shot.
//
//  PIECES. pieceSpec(r, kind, env) picks image, frame, pegs, lines, mono or
//  colour, white or black board. makePiece(spec, rgba) runs the greedy step
//  (engine.js) to the end and returns a compact piece: lines as one
//  Int32Array of (k, a, b), the pegs, the colours and the target (for the
//  candidate fan). PieceCache keeps at most cap pieces (LRU), so memory
//  stays flat over hours. createProducer() keeps the next pieces computed
//  ahead (in a worker, on the GPU or in idle time) and hands them over.
//
//  LENGTH. threadLength(piece, n, boardM) = the sum of the chord lengths
//  of the first n lines, with the frame width = boardM metres.
//
//  grep -n: "export const KINDS"  "export function makePlan"  "export function pieceSpec"
//           "export function makePiece"  "export function compactRun"  "export function threadLength"
//           "export class PieceCache"  "export function createProducer"  "export class Replay"
// ============================================================================
import {
  createRun, stepRun, targetFrom, frameMask, imagePalette, PALETTES, hex, makePegs, threadDeltas,
  walkLine, scoreLine, NO_GAIN, RFLOOR,
} from './engine.js';

export const KINDS = ['needle', 'split', 'chase', 'layers', 'maker', 'push', 'rack', 'wipe', 'gallery'];
export const BUILD_KINDS = ['needle', 'split', 'chase', 'layers', 'maker'];
export const BOARD_M = 0.6;   // the frame width the plate states (60 cm)

export function rng(seed) {
  let a = (seed >>> 0) || 0x2545f491;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** n shots: [{ kind, dur }]. calm 0..1 makes the shots longer (6..12 s). */
export function makePlan(seed, n, calm = 0.5) {
  const r = rng(seed), out = [];
  let bag = [];
  while (out.length < n) {
    if (!bag.length) {
      bag = KINDS.slice();
      for (let j = bag.length - 1; j > 0; j--) { const q = Math.floor(r() * (j + 1)); [bag[j], bag[q]] = [bag[q], bag[j]]; }
      if (out.length && bag[0] === out[out.length - 1].kind) bag.push(bag.shift());
    }
    const kind = bag.shift();
    const base = kind === 'gallery' || kind === 'needle' || kind === 'layers' ? 8.5 : 7;
    const dur = Math.min(12, Math.max(6, base + (r() - 0.5) * 3 + calm * 2));
    out.push({ kind, dur });
  }
  return out;
}

const pick = (r, a) => a[Math.floor(r() * a.length)];

/**
 * A piece spec for a shot kind. env: { sources: [{ key, kind, colour }],
 * gpu: bool, phone: bool, last: key of the last image }.
 */
export function pieceSpec(r, kind, env) {
  const photos = env.sources.filter(s => s.kind === 'photo').map(s => s.key);
  const shapes = env.sources.filter(s => s.kind === 'shape').map(s => s.key);
  const colourSrc = env.sources.filter(s => s.colour).map(s => s.key);
  const fresh = list => { const o = list.filter(k => k !== env.last); return pick(r, o.length ? o : list); };
  const big = env.gpu && !env.phone;
  let src, colour = false, dark = r() < 0.25, shape = r() < 0.55 ? 'circle' : pick(r, ['square', 'hexagon']);
  let P = pick(r, env.phone ? [160, 200] : [200, 240, 288]);
  if (kind === 'layers') { src = fresh(colourSrc.length ? colourSrc : photos); colour = true; dark = shapes.includes(src) ? r() < 0.5 : false; }
  else if (kind === 'wipe' || kind === 'rack' || kind === 'push' || kind === 'split') { src = fresh(photos); colour = env.sources.find(s => s.key === src)?.colour && r() < 0.6; }
  else if (kind === 'maker') { src = fresh(r() < 0.7 ? photos : shapes); P = pick(r, env.phone ? [120, 150] : [150, 180]); shape = 'circle'; }
  else { src = fresh(r() < 0.75 ? photos : shapes); colour = !!env.sources.find(s => s.key === src)?.colour && r() < 0.5; }
  if (kind === 'chase') dark = r() < 0.4;
  const isShape = shapes.includes(src);
  const pal = colour ? (isShape ? pick(r, ['cmyk', 'rgbw']) : 'image') : 'mono';
  const res = big ? 384 : 256;
  const alpha = colour ? (big ? 0.1 : 0.12) : 0.08;
  // Lines scale with the model area: 5000 at res 384 is ~2400 at 256. A
  // colour run lays black first and the colours later, so it gets more
  // lines (it stops on its own when no line lowers the error).
  let maxLines = big ? (colour ? 6000 : 5000) : env.phone ? (colour ? 2500 : 1800) : (colour ? 4000 : 2400);
  if (kind === 'maker') maxLines = Math.round(maxLines * 0.8);
  return { src, shape, P, res, colour, pal, dark, alpha, maxLines, seed: Math.floor(r() * 1e6), kind };
}

/** The thread colours of a spec (needs the image for the 'image' palette). */
export function specColours(spec, rgba, mask) {
  const side = spec.dark ? 'dark' : 'light';
  if (!spec.colour) return PALETTES.mono[side];
  if (spec.pal === 'image') return imagePalette(rgba, spec.res, 4, { dark: spec.dark, mask, seed: spec.seed });
  return PALETTES[spec.pal][side];
}

/** A fresh run for a spec (the CPU or the GPU lays it). */
export function specRun(spec, rgba) {
  const mask = frameMask(spec.shape, spec.res);
  const colors = specColours(spec, rgba, mask);
  const T = targetFrom(rgba, spec.res, { color: spec.colour, dark: spec.dark, mask });
  return createRun({ res: spec.res, shape: spec.shape, P: spec.P, colors, alpha: spec.alpha, color: spec.colour, dark: spec.dark,
    seed: spec.seed, maxLines: spec.maxLines }, T);
}

/** A finished run as a compact piece (transferable buffers). */
export function compactRun(spec, run) {
  const n = run.lines.length, L = new Int32Array(3 * n);
  for (let i = 0; i < n; i++) { const l = run.lines[i]; L[3 * i] = l.k; L[3 * i + 1] = l.a; L[3 * i + 2] = l.b; }
  return {
    spec, res: run.res, P: run.P, K: run.K, C: run.C, n, L,
    cfg: { alpha: run.cfg.alpha, dark: !!run.cfg.dark, shape: run.cfg.shape, color: !!run.cfg.color },
    colors: run.cfg.colors, colHex: run.cfg.colors.map(hex),
    start: Int32Array.from(run.start), target: run.target,
    pegs: { x: run.pegs.x, y: run.pegs.y, side: run.pegs.side },
  };
}

/** Run a spec to the end on the CPU. */
export function makePiece(spec, rgba) {
  const run = specRun(spec, rgba);
  while (stepRun(run));
  return compactRun(spec, run);
}

/** Buffers of a piece, for postMessage transfer. */
export function pieceBuffers(p) { return [p.L.buffer, p.target.buffer, p.pegs.x.buffer, p.pegs.y.buffer, p.pegs.side.buffer, p.start.buffer]; }

/** Thread length (m) of the first n lines; the frame is boardM wide. */
export function threadLength(piece, n, boardM = BOARD_M) {
  const px = piece.pegs.x, py = piece.pegs.y, L = piece.L;
  n = Math.max(0, Math.min(piece.n, Math.floor(n)));
  let s = 0;
  for (let i = 0; i < n; i++) { const a = L[3 * i + 1], b = L[3 * i + 2]; s += Math.hypot(px[b] - px[a], py[b] - py[a]); }
  return (s * boardM) / (piece.res - 1);
}

/** At most cap pieces, least recently used out first. */
export class PieceCache {
  constructor(cap = 6) { this.cap = cap; this.map = new Map(); this.seq = 0; }
  put(p) {
    if (!p.id) p.id = 'p' + (++this.seq);
    this.map.delete(p.id); this.map.set(p.id, p);
    while (this.map.size > this.cap) this.map.delete(this.map.keys().next().value);
    return p;
  }
  touch(p) { if (this.map.has(p.id)) { this.map.delete(p.id); this.map.set(p.id, p); } }
  list() { return [...this.map.values()]; }
  get size() { return this.map.size; }
  bytes() { let b = 0; for (const p of this.map.values()) b += p.L.byteLength + p.target.byteLength; return b; }
}

/**
 * Keep pieces computed ahead. make(spec) -> Promise<piece>. want(spec)
 * queues a spec; take(pred) hands over the oldest ready piece that pred
 * accepts (and puts it in the cache). At most `ahead` specs wait or run.
 */
export function createProducer({ make, cache, ahead = 2 }) {
  const queue = [], ready = [];
  let busy = false, made = 0, failed = 0;
  async function pump() {
    if (busy || !queue.length) return;
    busy = true;
    const spec = queue.shift();
    try { const p = await make(spec); p.spec = p.spec || spec; ready.push(p); made++; }
    catch (e) { failed++; }
    busy = false;
    pump();
  }
  return {
    // force: queue even when full (a forced cut needs a piece of its kind)
    want(spec, force = false) { if (force || queue.length + ready.length + (busy ? 1 : 0) < ahead + 1) { queue.push(spec); pump(); return true; } return false; },
    take(pred = () => true) {
      const i = ready.findIndex(pred);
      if (i < 0) return null;
      const p = ready.splice(i, 1)[0];
      return cache ? cache.put(p) : p;
    },
    get pending() { return queue.length + (busy ? 1 : 0); },
    get readyCount() { return ready.length; },
    get made() { return made; }, get failed() { return failed; },
    clear() { queue.length = 0; ready.length = 0; },
  };
}

/**
 * The residual of a piece after its first n lines, and the candidate fan
 * from a thread's peg: the gain of each line, from the engine's own score.
 * One residual buffer is reused while the piece size stays the same.
 */
export class Replay {
  constructor() { this.buf = null; this.p = null; this.n = 0; }
  reset(p) {
    const len = p.target.length;
    if (!this.buf || this.buf.length !== len) this.buf = new Int32Array(len);
    this.buf.set(p.target);
    this.p = p; this.n = 0;
    const pegs = p.pegs.side ? p.pegs : makePegs(p.cfg.shape, p.P, p.res);
    this.run = { res: p.res, P: p.P, K: p.K, C: p.C, pegs, residual: this.buf, cur: Int32Array.from(p.start),
      delta: threadDeltas(p.colors, p.cfg.alpha, { color: p.cfg.color, dark: p.cfg.dark }),
      gap: Math.max(1, Math.round(p.P / 30)) };
  }
  /** Lay lines up to n (only forward). */
  advance(n) {
    const p = this.p, R = this.buf, N = p.res * p.res, C = p.C, d = this.run.delta;
    n = Math.min(p.n, n);
    for (; this.n < n; this.n++) {
      const k = p.L[3 * this.n], a = p.L[3 * this.n + 1], b = p.L[3 * this.n + 2];
      walkLine(this.run.pegs, p.res, a, b, q => { for (let ch = 0; ch < C; ch++) { const i = ch * N + q; R[i] = Math.max(RFLOOR, R[i] - d[3 * k + ch]); } });
      this.run.cur[k] = b;
    }
  }
  /** Gains of thread k from its peg to every peg (NO_GAIN where not legal), into out (Float64Array P). */
  fan(k, out) {
    for (let j = 0; j < this.p.P; j++) out[j] = scoreLine(this.run, k, j);
    return out;
  }
}
export { NO_GAIN };
