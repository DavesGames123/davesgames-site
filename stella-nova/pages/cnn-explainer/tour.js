// ============================================================================
//  CNN EXPLAINER  ·  tour.js  the guided run: a timeline over the layers
// ----------------------------------------------------------------------------
//  DOM-free (node tests import it). The guided run is the default view of
//  the page and of the screensaver. The network "perceives" the picture
//  layer by layer:
//
//    flow     one layer fills in: the data moves from the maps of the layer
//             before it (draw.js draws the lines, the dots and the wipe)
//    zoom     the column of one map opens in place and plays its detail
//             scene (conv, ReLU, pool or softmax), then it closes again
//    answer   the class bars are full, the top line names the answer
//
//  tourPlan() gives the segments, each { kind, li, sec, t0, t1, section,
//  zoom, cap }. createClock() keeps the time, play, pause, speed, seek and
//  step. The page and saver.js read the state of a time with segAt(),
//  flowState(), zoomF() and scanAt(), so a seek or a scrub is exact.
//
//  grep -n 'export function tourPlan'     the segments of one run
//  grep -n 'export function createClock'  play, pause, speed, seek, step
//  grep -n 'export function segAt'        time -> segment
//  grep -n 'export function flowState'    time -> what the overview shows
//  grep -n 'export function zoomF'        how far a zoom column is open
//  grep -n 'export function scanAt'       time -> detail scene position
//  grep -n 'export function busyMap'      a map with a lot of signal
//  grep -n 'export function zoomStart'    where the scan of a zoom starts
//  grep -n 'export function captionOf'    one line for each segment
// ============================================================================
import { ARCH, CLASSES } from './net.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const smooth = k => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };

// the explainer section (explain.js SECTIONS id) of each layer
export const SECTION_OF = ['input', 'conv', 'relu', 'conv', 'relu', 'pool', 'deep', 'deep', 'deep', 'deep', 'deep', 'out'];

// seconds at speed 1
export const FLOW_SEC = { input: 4, conv: 2.6, relu: 2.0, pool: 2.6, dense: 6 };
export const ZOOM_SEC = { input: 5, conv: 6.5, relu: 4.5, pool: 4.5, dense: 7 };
export const ANSWER_SEC = 2.5;
export const EXPAND_SEC = 0.7;            // a zoom column opens (and closes) in this time
export const DEFAULT_ZOOMS = { conv: 1, relu: 2, pool: 5, dense: 11 };

const CAPS = [
  'The picture splits into three grids of numbers: red, green and blue.',
  'Conv 1·1: ten 3 × 3 kernels slide over the red, green and blue grids. Each kernel makes one map.',
  'ReLU 1·1: every negative value becomes zero.',
  'Conv 1·2: each new map adds up a kernel over each of the ten maps before it.',
  'ReLU 1·2: negative values become zero again.',
  'Max pool 1: each 2 × 2 tile keeps its largest value, so the maps are half as wide.',
  'Conv 2·1: a cell of this layer sees a 10 × 10 patch of the picture.',
  'ReLU 2·1: negative values become zero.',
  'Conv 2·2: a cell now sees 14 × 14 pixels.',
  'ReLU 2·2: negative values become zero.',
  'Max pool 2: ten maps of 13 × 13. A cell sees 16 × 16 pixels, a quarter of the picture width.',
  'Output: the 1690 values flow into ten scores, one for each class. Softmax turns them into probabilities.',
];
const ZOOM_CAPS = {
  input: 'Closer: each pixel is three numbers, divided by 255.',
  conv: 'Closer: at each position the kernel multiplies nine values by nine weights and adds the products.',
  relu: 'Closer: max(0, x), one value at a time.',
  pool: 'Closer: four values in, the largest one out.',
  dense: 'Closer: each class adds up 1690 values times its weights. Softmax gives each class its share.',
};

// zooms: { conv: li, relu: li, pool: li, dense: 11, input: 0 } (null leaves
// one out); skip: a Set of layers with no flow segment (the 9:16 saver
// leaves the ReLU rows out). pace scales every duration.
export function tourPlan({ zooms = DEFAULT_ZOOMS, skip = null, pace = 1 } = {}) {
  const at = new Map();
  for (const [kind, li] of Object.entries(zooms || {})) {
    if (li == null) continue;
    if (!ARCH[li] || ARCH[li].type !== kind) throw new Error(`tourPlan: layer ${li} is not a ${kind} layer`);
    at.set(li, kind);
  }
  const segs = [];
  let t = 0;
  const push = s => { s.sec *= pace; s.t0 = t; t += s.sec; s.t1 = t; s.i = segs.length; segs.push(s); };
  for (let li = 0; li < ARCH.length; li++) {
    const type = ARCH[li].type, section = SECTION_OF[li];
    if (!(skip && skip.has(li))) push({ kind: 'flow', li, sec: FLOW_SEC[type], section, cap: CAPS[li] });
    if (at.has(li)) push({ kind: 'zoom', li, zoom: type, sec: ZOOM_SEC[type], section, cap: ZOOM_CAPS[type] });
  }
  push({ kind: 'answer', li: 11, sec: ANSWER_SEC, section: 'out', cap: '' });
  // the stops of the step buttons and the scrubber: the first segment of each layer
  const stops = [];
  for (const s of segs) if (s.kind !== 'answer' && !stops.some(q => q.li === s.li)) stops.push({ li: s.li, t0: s.t0 });
  // each stop ends where the next one starts; the last one takes the answer
  stops.forEach((q, i) => { q.t1 = i + 1 < stops.length ? stops[i + 1].t0 : t; });
  return { segs, stops, total: t };
}

// time -> { seg, i, local (s into the segment), k (0..1) }
export function segAt(plan, t) {
  t = clamp(t, 0, plan.total);
  let i = plan.segs.findIndex(s => t < s.t1);
  if (i < 0) i = plan.segs.length - 1;
  const seg = plan.segs[i], local = t - seg.t0;
  return { seg, i, local, k: clamp(local / seg.sec, 0, 1) };
}

// time -> the overview state:
//   li      the layer that is active (the layers before it are complete)
//   k       0..1 of its flow (1 during its zoom)
//   barT    0..1, the class bars grow to their probabilities
//   win     0..1, the top class lights up
//   answer  true from the answer segment on: the top line names the class
export function flowState(plan, t) {
  if (t >= plan.total) return { li: 11, k: 1, barT: 1, win: 1, answer: true, ended: true };
  const { seg, k } = segAt(plan, t);
  const fk = seg.kind === 'flow' ? k : 1;
  const out = seg.li === 11;
  return {
    li: seg.li, k: fk,
    barT: !out ? 0 : seg.kind === 'flow' ? smooth((k - 0.3) / 0.45) : 1,
    win: !out ? 0 : seg.kind === 'flow' ? smooth((k - 0.75) / 0.2) : 1,
    answer: seg.kind === 'answer', ended: false,
  };
}

// how far the zoom column is open (0..1) at local time of a zoom segment.
// Reduced motion: the column is open for the whole segment (the page fades
// it in and out, no growth).
export function zoomF(seg, local, reduced = false) {
  if (!seg || seg.kind !== 'zoom') return 0;
  if (reduced) return local >= 0 && local < seg.sec ? 1 : 0;
  const e = Math.min(local, seg.sec - local) / EXPAND_SEC;
  return smooth(e);
}

// scan positions a second, at speed 1
export const SCAN_RATE = { input: 6, conv: 2.4, relu: 4, pool: 3 };

// The detail scene position (scenes.js t) at local time of a zoom segment.
// The scan starts when the column is half open. The dense scene plays its
// phases once over the segment and stays on the probabilities.
export function scanAt(seg, local, start = 0, count = 0, reduced = false) {
  if (seg.zoom === 'dense' || !count) {
    if (reduced) return 0.999;
    return clamp((local - EXPAND_SEC * 0.8) / Math.max(0.5, seg.sec - 2 * EXPAND_SEC - 0.6), 0, 0.999);
  }
  const s = Math.max(0, local - EXPAND_SEC * 0.6) * (SCAN_RATE[seg.zoom] || 3);
  return Math.min(count - 1, start + (reduced ? Math.floor(s / (SCAN_RATE[seg.zoom] || 3)) : s));
}

// the k-th (mod 5) busiest map of layer li: the largest spread of values
export function busyMap(res, li, k = 0) {
  const L = res.layers[li], sp = [];
  for (let c = 0; c < L.C; c++) {
    let lo = Infinity, hi = -Infinity, on = 0;
    for (let i = 0; i < L.H * L.W; i++) { const v = L.data[i * L.C + c]; if (v < lo) lo = v; if (v > hi) hi = v; if (v > 0) on++; }
    sp.push({ c, s: (hi - lo) * Math.sqrt(on / (L.H * L.W) + 0.05) });
  }
  sp.sort((a, b) => b.s - a.s);
  return sp[k % Math.min(5, sp.length)].c;
}

// The first scan position of a zoom: a few cells to the left of the
// strongest value of the map, so the window moves over it in view.
export function zoomStart(res, li, c) {
  const L = res.layers[li];
  if (!L || ARCH[li].type === 'dense') return 0;
  const n = L.W;
  if (li === 0) return Math.floor(n / 2) * n + Math.floor(n / 3);
  let best = -Infinity, at = 0;
  for (let i = 0; i < L.H * L.W; i++) { const v = L.data[i * L.C + c]; if (v > best) { best = v; at = i; } }
  const y = Math.floor(at / n), x = at % n;
  return y * n + Math.max(0, x - 4);
}

const pct = v => (v * 100).toFixed(v >= 0.1 ? 1 : 2) + '%';
export function answerText(res) {
  const p = res.probs, order = p.map((v, i) => i).sort((a, b) => p[b] - p[a]);
  return { cls: CLASSES[order[0]], p: pct(p[order[0]]), second: `then ${CLASSES[order[1]]} ${pct(p[order[1]])}` };
}
export function captionOf(seg, res) {
  if (seg.kind === 'answer') { const a = answerText(res); return `It sees ${a.cls}, ${a.p}.`; }
  return seg.cap;
}

// The clock of one run. tick(dt) moves the time while it plays; the run
// stops at the end. seek(t) goes to a time; step(+1 / -1) goes to the next
// or the previous layer (a step back in the first 0.6 s of a layer goes to
// the layer before it).
export function createClock(plan) {
  const c = {
    plan, t: 0, playing: false, speed: 1,
    get ended() { return c.t >= c.plan.total; },
    tick(dt) {
      if (!c.playing) return false;
      c.t = Math.min(c.plan.total, c.t + dt * c.speed);
      if (c.t >= c.plan.total) c.playing = false;
      return true;
    },
    seek(t) { c.t = clamp(t, 0, c.plan.total); return c.t; },
    play() { if (c.ended) c.t = 0; c.playing = true; },
    pause() { c.playing = false; },
    step(dir) {
      const ts = c.plan.stops.map(s => s.t0).concat(c.plan.total);
      if (dir > 0) { const n = ts.find(x => x > c.t + 1e-6); return c.seek(n == null ? c.plan.total : n); }
      const p = ts.filter(x => x < c.t - 0.6);
      return c.seek(p.length ? p[p.length - 1] : 0);
    },
    stopOf(li) { return c.plan.stops.find(s => s.li === li) || null; },
    at(t = c.t) { return segAt(c.plan, t); },
  };
  return c;
}
