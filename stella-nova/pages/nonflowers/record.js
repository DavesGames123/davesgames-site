// ============================================================================
//  NONFLOWERS  ·  record.js — the step recorder, the stages and the stepper
// ----------------------------------------------------------------------------
//  Our own code around Nonflowers by Lingdong Huang (2018, MIT, see
//  LICENSE-nonflowers.txt). No DOM here, so tests.mjs imports it.
//
//  RECORD. recordPaint() runs engine.js paint() with a tap on the upstream
//  functions polygon, leaf, stem and branch (engine.js THE SHIM). Every
//  upstream shape is one polygon() call. The tap keeps each call as one
//  stroke: its layer (0: stems and leaves, blend multiply; 1: petals,
//  blend normal), its kind, its points with the offset added (as polygon()
//  adds it), its colour and its fill and stroke flags. The tap uses no
//  random numbers, so the painting stays the same.
//
//  KIND. The innermost leaf() or stem() call of the stroke gives its kind:
//    leaf   flo -> flower; no col (herbal root leaves) -> basal; else leaf
//    stem   1 branch() frame -> trunk; more -> branch; no branch frame:
//           no col -> stem (herbal); col hue 60 -> sheath; 70 -> shoot;
//           else (hue 50, woody pedicel) -> stalk
//  The hues are those of the pinned upstream file (tests.mjs checks the
//  sha256).
//
//  ORDER. Each layer keeps its own stroke order, so a replay of one layer
//  makes the same canvas calls as upstream. The two layers are separate
//  canvases, so the order between them is free:
//    woody   all of layer 0 (trunk, branches, leaves and stalks), then all
//            of layer 1 (flowers)
//    herbal  for each stem: its layer 0 strokes, then its flowers; the
//            root leaves last
//  A chapter is a run of strokes with the same key. The stages around the
//  strokes: paper first; shade (the fade and wispy filters) and mount
//  (the squircle border) last.
//
//  REPLAY. drawStroke(ctx, rec, i) makes the canvas calls of upstream
//  polygon() for stroke i. timeline() gives each chapter a duration at
//  speed 1; createStepper() is the play clock with stage steps.
//
//  GREP MAP
//    grep -n 'export const STAGES'          labels, notes and TeX per key
//    grep -n 'export function recordPaint'  paint() with the tap
//    grep -n 'export function drawStroke'   one upstream polygon() again
//    grep -n 'export function chapters'     runs of strokes, plus paper/shade/mount
//    grep -n 'export function timeline'     chapter durations at a speed
//    grep -n 'export function createStepper' play, seek, stage steps
// ============================================================================
import { paint } from './engine.js';

export const KINDS = ['trunk', 'branch', 'stem', 'leaf', 'sheath', 'shoot', 'stalk', 'flower', 'basal', 'other'];
const K = Object.fromEntries(KINDS.map((k, i) => [k, i]));

// Per chapter key: a caption, a plate note and TeX where a formula drives the stage.
export const STAGES = {
  paper: { label: 'paper', note: 'paper(): grain from Perlin noise and random specks, mirrored four ways.', tex: String.raw`c_{ij} = 255 - \tfrac{t}{2}\,n(0.1i,\,0.1j) - t\,u_{ij}` },
  trunk: { label: 'stem skeleton', note: 'stem(): a path of bent segments, then a tube of shaded quads.', tex: String.raw`\theta_{i+1} = \theta_i + \tfrac{1}{s}\,b\!\left(\tfrac{i}{s-1}\right),\quad p_{i+1} = p_i + R(\theta_{i+1})\,(0,0,\tfrac{\ell}{s})` },
  branch: { label: 'branches', note: 'branch() calls itself at random joints: shorter, thinner, one level less deep.', tex: String.raw`\ell' = \ell\,U(0.4,0.6),\quad w' = w\,U(0.4,0.7),\quad d' = d-1` },
  foliage: { label: 'leaves and flower stalks', note: 'leaf(): two rows of quads, shaded by the facet normal, then the veins.', tex: String.raw`\lambda = 1 - \frac{\angle(\mathbf{n},\,-\hat{y})}{\pi}` },
  stem: { label: 'stem', note: 'stem(): a path of bent segments from the root, then a tube of shaded quads.', tex: String.raw`\theta_{i+1} = \theta_i + \tfrac{1}{s}\,b\!\left(\tfrac{i}{s-1}\right),\quad p_{i+1} = p_i + R(\theta_{i+1})\,(0,0,\tfrac{\ell}{s})` },
  leaf: { label: 'leaves', note: 'leaf(): two rows of quads, shaded by the facet normal, then the veins.', tex: String.raw`\lambda = 1 - \frac{\angle(\mathbf{n},\,-\hat{y})}{\pi}` },
  sheath: { label: 'sheath', note: 'A short, wide stem() at the top of the stem.', tex: '' },
  shoot: { label: 'flower shoots', note: 'Thin stem() shoots from the top of the stem.', tex: '' },
  flower: { label: 'flowers', note: 'N petals, each a leaf() with no veins, turned about the stalk and shaded by a sigmoid.', tex: String.raw`\phi_k = \phi_0 + \frac{2\pi k}{N},\quad c(x) = \frac{1}{1 + e^{-k\,(x + x_0 - 1/2)}}` },
  basal: { label: 'root leaves', note: 'Long leaves from the root.', tex: String.raw`\lambda = 1 - \frac{\angle(\mathbf{n},\,-\hat{y})}{\pi}` },
  shade: { label: 'shading', note: 'Two pixel filters on the layers: fade, then wispy.', tex: String.raw`\alpha \leftarrow \alpha\,n(0.01x,\,0.01y),\quad \alpha \leftarrow \alpha\left(\tfrac12 + \tfrac12\,n(0.2x,\,0.2y)\right)` },
  mount: { label: 'mount', note: 'The layers go on the paper; a squircle border cuts the sheet.', tex: String.raw`r(\theta) = 0.98\left(\cos^{3}\theta + \sin^{3}\theta\right)^{-1/3}` },
  other: { label: 'strokes', note: '', tex: '' },
};

// ── recordPaint ─────────────────────────────────────────────────────────────
// Returns { r, rec }. r: the engine.js paint() result (with snaps). rec:
//   n, layer Uint8Array, kind Uint8Array, grp Uint16Array, flags Uint8Array
//   (1 fill, 2 stroke), col Uint16Array (index into cols), cols string[],
//   off Uint32Array (n + 1, point offsets), pts Float64Array (x, y pairs),
//   order Uint32Array (playback order), xref, yref (the plant blit offset).
export function recordPaint(src, seed, env, onStage = () => {}) {
  const stack = [], ctxs = [], layerCtx = [], kind = [], grp = [], flags = [], col = [], off = [0], pts = [];
  const cols = [], colIx = new Map();
  let g = 0, nb = 0;
  const def = v => v != undefined;   // eslint-disable-line eqeqeq -- upstream tests "!= undefined"
  function classify() {
    for (let i = stack.length - 1; i >= 0; i--) {
      const f = stack[i], a = f.a || {};
      if (f.n === 'leaf') return a.flo ? K.flower : def(a.col) ? K.leaf : K.basal;
      if (f.n === 'stem') {
        if (nb === 1) return K.trunk;
        if (nb > 1) return K.branch;
        if (!def(a.col)) return K.stem;
        const h = a.col.min && a.col.min[0];
        return h === 60 ? K.sheath : h === 70 ? K.shoot : K.stalk;
      }
    }
    return K.other;
  }
  function record(a) {
    a = def(a) ? a : {};
    const xof = def(a.xof) ? a.xof : 0, yof = def(a.yof) ? a.yof : 0, P = def(a.pts) ? a.pts : [];
    const c = def(a.col) ? a.col : 'black', fil = def(a.fil) ? a.fil : true, str = def(a.str) ? a.str : !fil;
    let li = ctxs.indexOf(a.ctx);
    if (li < 0) { li = ctxs.length; ctxs.push(a.ctx); }
    layerCtx.push(li);
    const k = classify();
    kind.push(k);
    grp.push(k === K.basal ? 65535 : g);
    flags.push((fil ? 1 : 0) | (str ? 2 : 0));
    if (!colIx.has(c)) { colIx.set(c, cols.length); cols.push(c); }
    col.push(colIx.get(c));
    for (let i = 0; i < P.length; i++) pts.push(P[i][0] + xof, P[i][1] + yof);
    off.push(pts.length / 2);
  }
  const tap = (name, fn) => function (a) {
    if (name === 'polygon') { record(a); return fn.apply(this, arguments); }
    const fr = { n: name, a };
    if (name === 'branch') nb++;
    if (name === 'stem' && nb === 0 && !stack.length && a && !def(a.col)) g++;
    stack.push(fr);
    try { return fn.apply(this, arguments); } finally { stack.pop(); if (name === 'branch') nb--; }
  };
  const r = paint(src, seed, env, onStage, { tap, snap: true });
  const lay1 = r.blits.length > 1 ? r.blits[1].ctx : null;
  const n = kind.length;
  const rec = {
    n, type: r.type,
    layer: Uint8Array.from(layerCtx, li => (ctxs[li] === lay1 ? 1 : 0)),
    kind: Uint8Array.from(kind), grp: Uint16Array.from(grp), flags: Uint8Array.from(flags),
    col: Uint16Array.from(col), cols, off: Uint32Array.from(off), pts: Float64Array.from(pts),
    xref: r.blits[0] ? r.blits[0].xof : 0, yref: r.blits[0] ? r.blits[0].yof : 0,
  };
  rec.order = playOrder(rec);
  return { r, rec };
}

// Playback order (see ORDER). A stable sort keeps each layer in order.
export function playOrder(rec) {
  const ix = Array.from({ length: rec.n }, (_, i) => i);
  const key = rec.type === 'woody' ? i => rec.layer[i] : i => rec.grp[i] * 2 + rec.layer[i];
  ix.sort((a, b) => key(a) - key(b) || a - b);
  return Uint32Array.from(ix);
}

// ── drawStroke ──────────────────────────────────────────────────────────────
// The canvas calls of upstream polygon() for stroke i, in the same order.
export function drawStroke(ctx, rec, i) {
  const a = rec.off[i], b = rec.off[i + 1], P = rec.pts, f = rec.flags[i], c = rec.cols[rec.col[i]];
  ctx.beginPath();
  if (b > a) ctx.moveTo(P[2 * a], P[2 * a + 1]);
  for (let j = a + 1; j < b; j++) ctx.lineTo(P[2 * j], P[2 * j + 1]);
  if (f & 1) { ctx.fillStyle = c; ctx.fill(); }
  if (f & 2) { ctx.strokeStyle = c; ctx.stroke(); }
}

// ── chapters ────────────────────────────────────────────────────────────────
// [{ key, label, grp, from, to }] with from/to in playback order (to is
// exclusive). paper first, shade and mount last (from = to: no strokes).
export function chapterKey(type, k) {
  const name = KINDS[k];
  if (type === 'woody') return name === 'leaf' || name === 'stalk' ? 'foliage' : name;
  return name;
}
export function chapters(rec) {
  const out = [{ key: 'paper', label: STAGES.paper.label, grp: 0, from: 0, to: 0 }];
  const stems = new Set();
  for (let i = 0; i < rec.n; i++) if (KINDS[rec.kind[i]] === 'stem') stems.add(rec.grp[i]);
  const nStem = stems.size;
  let cur = null;
  for (let j = 0; j < rec.n; j++) {
    const i = rec.order[j], key = chapterKey(rec.type, rec.kind[i]), g = rec.grp[i];
    if (!cur || cur.key !== key || cur.grp !== g) {
      let label = STAGES[key] ? STAGES[key].label : key;
      if (rec.type === 'herbal' && nStem > 1 && key !== 'basal') label = key === 'stem' ? `stem ${g} of ${nStem}` : `${label} on stem ${g}`;
      cur = { key, label, grp: g, from: j, to: j + 1 };
      out.push(cur);
    } else cur.to = j + 1;
  }
  out.push({ key: 'shade', label: STAGES.shade.label, grp: 0, from: rec.n, to: rec.n });
  out.push({ key: 'mount', label: STAGES.mount.label, grp: 0, from: rec.n, to: rec.n });
  return out;
}

// ── timeline ────────────────────────────────────────────────────────────────
// Duration of each chapter at speed 1 (ms): fixed for paper, shade and
// mount; 500 ms plus a share that grows with the root of the stroke count
// for a stroke chapter, at most 5 s. At speed v each duration is d / v.
export const SPEEDS = [0.25, 0.5, 1, 2, 4];
export const FIXED_MS = { paper: 1800, shade: 2200, mount: 1400 };
export function timeline(chs, speed = 1) {
  let t = 0;
  return chs.map(c => {
    const n = c.to - c.from;
    const d = (FIXED_MS[c.key] || Math.min(5000, 500 + 40 * Math.sqrt(n))) / speed;
    const s = { ...c, t0: t, dur: d };
    t += d;
    return s;
  });
}
export const totalMs = tl => (tl.length ? tl[tl.length - 1].t0 + tl[tl.length - 1].dur : 0);

// ── stepper ─────────────────────────────────────────────────────────────────
// The play clock over a list of chapters. State: t (ms on the timeline),
// playing, speed. at() gives { ci, u, strokes, done }: the chapter index,
// the share of it done (0..1) and the strokes done in playback order.
// Speed changes keep the place: the same chapter and the same share.
export function createStepper(chs, speed = 1) {
  let tl = timeline(chs, speed), T = totalMs(tl), t = 0, playing = false;
  function locate(tt) {
    let ci = tl.findIndex(c => tt < c.t0 + c.dur);
    if (ci < 0) ci = tl.length - 1;
    const c = tl[ci], u = c.dur > 0 ? Math.max(0, Math.min(1, (tt - c.t0) / c.dur)) : 1;
    return { ci, u };
  }
  const S = {
    get t() { return t; }, get total() { return T; }, get playing() { return playing; }, get speed() { return speed; }, get chapters() { return tl; },
    at() {
      const { ci, u } = locate(t), c = tl[ci];
      const strokes = c.from + Math.floor((c.to - c.from) * u + 1e-9);
      return { ci, u, strokes, done: t >= T, chapter: c };
    },
    // Time at which `strokes` strokes are done (for a lagging renderer).
    timeOfStrokes(n) {
      for (const c of tl) if (c.to > c.from && n < c.to) return c.t0 + c.dur * Math.max(0, n - c.from) / (c.to - c.from);
      const last = tl.filter(c => c.to > c.from).pop();
      return last ? last.t0 + last.dur : 0;
    },
    seek(tt) { t = Math.max(0, Math.min(T, tt)); return S.at(); },
    advance(ms) { if (playing) { t = Math.min(T, t + ms); if (t >= T) playing = false; } return S.at(); },
    play() { if (t >= T) t = 0; playing = true; },
    pause() { playing = false; },
    toggle() { playing ? S.pause() : S.play(); },
    // Next stage: the start of the next chapter (or the end).
    next() { const { ci } = locate(t); return S.seek(ci + 1 < tl.length ? tl[ci + 1].t0 : T); },
    // Stage back: the start of this chapter, or of the one before when
    // the clock is within 250 ms (at speed 1) of this start.
    prev() {
      const { ci } = locate(Math.min(t, T - 1e-6)), c = tl[ci];
      const near = t - c.t0 < 250 / speed || t >= T;
      if (t >= T) return S.seek(c.t0);
      return S.seek(near && ci > 0 ? tl[ci - 1].t0 : c.t0);
    },
    goto(ci) { return S.seek(tl[Math.max(0, Math.min(tl.length - 1, ci))].t0); },
    setSpeed(v) {
      const { ci, u } = locate(t), end = t >= T;
      speed = v; tl = timeline(chs, speed); T = totalMs(tl);
      t = end ? T : tl[ci].t0 + tl[ci].dur * u;
    },
  };
  return S;
}

// ── planSteps (saver) ───────────────────────────────────────────────────────
// Cut the growth of one plant into saver shots of 5 to 12 s. Each shot
// plays the timeline at speed 1 from t0 to t1 in dur - hold ms (hold:
// the finished painting at the end of the last shot). A long growth goes
// over more shots, cut at stage starts, so no shot plays faster than
// about MAX_RATE times speed 1. rnd: a seeded random source.
export const SHOT_MIN = 5000, SHOT_MAX = 12000, HOLD_MS = 1200, MAX_RATE = 3;
export function planSteps(chs, calm, rnd) {
  const tl = timeline(chs, 1), T = totalMs(tl);
  const pick = () => 1000 * Math.max(5, Math.min(12, 5 + 7 * calm + (rnd() * 2 - 1) * 1.2));
  const d = pick(), n = Math.max(1, Math.ceil(T / ((d - HOLD_MS) * MAX_RATE)));
  // Cut points: the stage start nearest to k T / n, each later than the last.
  const starts = tl.map(c => c.t0).filter(t => t > 0 && t < T);
  const cuts = [0];
  for (let k = 1; k < n; k++) {
    const want = k * T / n, last = cuts[cuts.length - 1];
    let best = null;
    for (const t of starts) if (t > last && (best === null || Math.abs(t - want) < Math.abs(best - want))) best = t;
    if (best !== null) cuts.push(best);
  }
  cuts.push(T);
  const parts = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const last = i + 2 === cuts.length;
    parts.push({ t0: cuts[i], t1: cuts[i + 1], dur: i ? pick() : d, hold: last ? HOLD_MS : 0, part: i + 1, of: cuts.length - 1 });
  }
  return parts;
}
