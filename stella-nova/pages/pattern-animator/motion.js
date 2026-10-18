// ============================================================================
//  ANIMATED PATTERN DESIGNER  ·  motion.js — loops, curves, channels (no DOM)
// ----------------------------------------------------------------------------
//  The pattern-designer engine makes a still list of elements. This file
//  packs that list once into typed arrays (pack) and then moves it in time
//  (frame). frame(G, C, t, F) is a pure function of the packed geometry G,
//  the compiled animation C and the time t. It writes into the frame
//  buffers F (makeFrame), so a frame makes no new arrays.
//
//  LOOP. The loop length is L seconds. Each channel has a number of cycles
//  per loop (an integer), so its period is L / cycles and every channel is
//  back at its start at t = L. The time goes through wrapT first, so the
//  frame at t = L is the frame at t = 0.
//
//  CURVES (curveValue, x is the phase in [0, 1), the value in [-1, 1])
//    sine     -cos(2 pi x)
//    ease     an eased triangle: a hold at each end
//    noise    three seeded harmonics of the period: smooth and periodic
//    bounce   2 |sin(pi x)| - 1: a hard touch at the floor
//    ramp     a linear triangle for a value. For a phase (rotate, spin,
//             wave travel, flow, lens path, colour cycle, dash), ramp is
//             a steady advance of one cycle per period.
//  Each curve is -1 at x = 0 and +1 at x = 0.5 (noise near that), so a
//  frame at half a period is always different from the start.
//
//  CHANNELS (CHANNELS, the state of one: { on, curve, amount, freq,
//  cycles, phase }). Three groups:
//    board    rotate, zoom, drift: one canvas transform, no point work
//    motif    spin, breathe, density breathing, colour cycle: per element
//    field    twist, lens, wave, ripple, flow: per point (lines are cut
//             into short steps by pack, so straight edges bend)
//    style    marching lines: a dash offset on every stroke
//  With only board channels, a global colour cycle and dashes, the points
//  do not move (C.still): render.js draws cached paths.
//
//  MORPH. C.morph moves a value m from 0 to 1 and back over the loop. The
//  elements of A shrink away in a soft sweep across the board while the
//  elements of B grow in. An element pair (same kind, same rings and
//  points, same inks: pairUp) slides from its A points to its B points.
//
//  ORDER. pack also gives G.order (drawOrder): a paint order by overlap
//  level and style, so render.js draws long runs of one style. Two
//  elements of two styles that may overlap keep their pattern order.
//
//  COVER. coverFor(view, anim) gives the geometry board: larger than the
//  view when the board turns or drifts or the field pulls at the edges,
//  so no paper shows at the corners. The page makes that board with the
//  density times its scale, so the motifs keep their size.
//
//  grep -n targets
//    curves ............... "export function curveValue"
//    channel table ........ "export const CHANNELS"
//    default state ........ "export function animDefaults"
//    pack ................. "export function pack"
//    morph pairs .......... "export function pairUp"
//    compile .............. "export function compile"
//    frame ................ "export function frame"
//    still items (export)   "export function materialise"
//    cover board .......... "export function coverFor"
//    colour table ......... "export function colourTable"
//    draw order ........... "export function drawOrder"
//    what a geometry has .. "export function geoInfo"
// ============================================================================
import { TAU, makeRng, makeNoise, hashStr } from '../pattern-designer/engine.js';
import { hexToOklab, oklabToHex } from '../pattern-designer/color.js';

export const LOOPS = [4, 5, 6, 8, 10, 12, 15, 16, 20, 24, 30];
export const CURVES = { sine: 'Sine', ease: 'Ease', noise: 'Noise', bounce: 'Bounce', ramp: 'Linear' };
export const Q = 12;                 // colour steps from one ink to the next
const frac = x => x - Math.floor(x);
const sstep = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);

// The time inside the loop: t = L gives 0.
export function wrapT(t, L) {
  let u = t - L * Math.floor(t / L);
  if (!(u >= 0) || L - u < 1e-7) u = 0;
  return u;
}
export function curveValue(kind, x, a = 0, b = 0) {
  switch (kind) {
    case 'ease': {
      const tr = 1 - Math.abs(1 - 2 * x);
      const e = tr < 0.5 ? 4 * tr * tr * tr : 1 - Math.pow(-2 * tr + 2, 3) / 2;
      return 2 * e - 1;
    }
    case 'noise': return -0.62 * Math.cos(TAU * x) + 0.24 * Math.sin(2 * TAU * x + a) + 0.14 * Math.sin(3 * TAU * x + b);
    case 'bounce': return 2 * Math.abs(Math.sin(Math.PI * x)) - 1;
    case 'ramp': return 1 - 2 * Math.abs(1 - 2 * x);
    default: return -Math.cos(TAU * x);
  }
}

// { label, group, amount: [min, max, step, default, name], freq: [...] }.
// cyc: the channel moves a phase, so a ramp is a steady advance.
export const CHANNELS = {
  rotate: { label: 'Rotate', group: 'board', cyc: 1, curve: 'sine', amount: [0, 180, 1, 12, 'Angle (deg)'], text: 'The whole board turns. Linear: one full turn each period.' },
  zoom: { label: 'Zoom', group: 'board', curve: 'ease', amount: [0, 0.6, 0.01, 0.12, 'Push in'], text: 'A slow push in and out.' },
  pan: { label: 'Drift', group: 'board', cyc: 1, curve: 'ramp', amount: [0, 0.12, 0.002, 0.03, 'Distance'], text: 'The board drifts on a figure of eight.' },
  spin: { label: 'Spin', group: 'motif', cyc: 1, curve: 'ease', amount: [0, 180, 1, 90, 'Angle (deg)'], freq: [0, 4, 0.05, 1, 'Wave across'], text: 'Each motif turns about its own centre, in a wave across the board.' },
  breathe: { label: 'Breathe', group: 'motif', curve: 'sine', amount: [0, 0.9, 0.01, 0.35, 'Shrink'], freq: [0, 4, 0.05, 1, 'Wave across'], text: 'Each motif grows and shrinks.' },
  thin: { label: 'Density breathing', group: 'motif', curve: 'sine', amount: [0, 0.95, 0.01, 0.5, 'Share hidden'], freq: [0, 4, 0.05, 0.6, 'Sweep'], text: 'Motifs leave and come back, so the density rises and falls.' },
  colour: { label: 'Colour cycle', group: 'motif', cyc: 1, curve: 'ramp', amount: [0, 5, 0.05, 1, 'Ink steps'], freq: [0, 4, 0.05, 0, 'Wave across'], text: 'The inks move along the palette. Linear: one full turn of the palette each period.' },
  twist: { label: 'Twist', group: 'field', curve: 'sine', amount: [0, 240, 1, 50, 'Angle (deg)'], freq: [0.3, 1.5, 0.01, 0.8, 'Reach'], text: 'A swirl about the centre that winds and unwinds.' },
  lens: { label: 'Lens', group: 'field', cyc: 1, curve: 'ramp', amount: [0, 1.2, 0.01, 0.5, 'Strength'], freq: [0.15, 0.8, 0.01, 0.32, 'Size'], text: 'A bulge that travels on a loop over the board.' },
  wave: { label: 'Wave', group: 'field', cyc: 1, curve: 'ramp', amount: [0, 0.05, 0.001, 0.012, 'Height'], freq: [0.5, 12, 0.1, 2.5, 'Waves across'], text: 'A travelling wave bends every line.' },
  ripple: { label: 'Ripple', group: 'field', cyc: 1, curve: 'ramp', amount: [0, 0.04, 0.001, 0.01, 'Height'], freq: [1, 16, 0.1, 4, 'Rings'], text: 'Rings run out from the centre.' },
  flow: { label: 'Flow', group: 'field', cyc: 1, curve: 'ramp', amount: [0, 0.05, 0.001, 0.012, 'Drift'], freq: [0.4, 6, 0.1, 1.6, 'Scale'], text: 'A slow noise current pushes the shapes.' },
  dash: { label: 'Marching lines', group: 'style', cyc: 1, curve: 'ramp', amount: [0.05, 1, 0.01, 0.35, 'Dash length'], freq: [1, 4, 1, 1, 'Dashes per period'], text: 'Lines become dashes that run along the stroke.' },
};
export const CHANNEL_IDS = Object.keys(CHANNELS);
export const MORPH = { curve: 'ease', cycles: 1, phase: 0 };

export function channelDefaults(id, on = 0) {
  const c = CHANNELS[id];
  return { on, curve: c.curve, amount: c.amount[3], freq: c.freq ? c.freq[3] : 0, cycles: 1, phase: 0 };
}
// A full animation state: loop length, every channel (off), no morph.
export function animDefaults(L = 8) {
  const ch = {};
  for (const id of CHANNEL_IDS) ch[id] = channelDefaults(id);
  return { L, ch, morph: null };
}
// A clean copy: known channels, numbers in range, integer cycles.
export function cleanAnim(a) {
  const out = animDefaults(LOOPS.includes(+a?.L) ? +a.L : Math.max(2, Math.min(60, +a?.L || 8)));
  for (const id of CHANNEL_IDS) {
    const s = a && a.ch && a.ch[id]; if (!s) continue;
    const d = CHANNELS[id], o = out.ch[id];
    o.on = s.on ? 1 : 0;
    o.curve = CURVES[s.curve] ? s.curve : d.curve;
    o.amount = clampTo(s.amount, d.amount);
    if (d.freq) o.freq = clampTo(s.freq, d.freq);
    o.cycles = Math.max(1, Math.min(8, Math.round(+s.cycles || 1)));
    o.phase = Math.max(0, Math.min(1, +s.phase || 0));
  }
  if (a && a.morph && (a.morph.seed || a.morph.pat)) {
    const m = a.morph;
    out.morph = { seed: m.seed ? Math.max(1, Math.round(+m.seed)) : 0, pat: m.pat || '', curve: CURVES[m.curve] ? m.curve : 'ease', cycles: Math.max(1, Math.min(4, Math.round(+m.cycles || 1))), phase: Math.max(0, Math.min(1, +m.phase || 0)) };
  }
  return out;
}
function clampTo(v, d) { const x = Number.isFinite(+v) ? +v : d[3]; return Math.max(d[0], Math.min(d[1], x)); }
export const activeIds = a => CHANNEL_IDS.filter(id => a.ch[id] && a.ch[id].on);
// What a geometry has: strokes (for dashes) and shapes that are not
// circles (a circle does not show a turn).
export function geoInfo(G) {
  let lines = 0, shapes = 0;
  for (let i = 0; i < G.n; i++) { if (G.s[i] >= 0) lines++; if (G.t[i] !== 1) shapes++; }
  return { lines, shapes };
}
export const needsDeform = a => activeIds(a).some(id => CHANNELS[id].group === 'field');

// ── pack ───────────────────────────────────────────────────────────────────
// items: pattern-designer elements (after the style mode). o: { W, H,
// seed, step }. step > 0 cuts each straight segment into pieces of at most
// step units (for the field channels). Solid rings that merge in one path
// get the positive turn (as export.js does), so a nonzero fill adds.
export function pack(items, o) {
  const { W, H } = o, step = o.step || 0, S = Math.min(W, H);
  const n = items.length;
  let nR = 0, nP = 0;
  const sub = (p, closed, sm) => {
    const m = p.length / 2;
    if (!step || sm || m < 2) return m;
    let c = m;
    const last = closed ? m : m - 1;
    for (let i = 0; i < last; i++) {
      const j = (i + 1) % m, L = Math.hypot(p[2 * j] - p[2 * i], p[2 * j + 1] - p[2 * i + 1]);
      if (L > step) c += Math.ceil(L / step) - 1;
    }
    return c;
  };
  for (const e of items) {
    if (e.t === 'circle') continue;
    const rings = e.t === 'multi' ? e.rr : [e.p], closed = e.t === 'multi' || !!e.c;
    for (const r of rings) { nR++; nP += sub(r, closed, e.sm); }
  }
  const G = {
    W, H, S, n, nR, nP,
    t: new Uint8Array(n), f: new Int8Array(n), s: new Int8Array(n), w: new Float32Array(n), fl: new Uint8Array(n),
    r0: new Uint32Array(n), r1: new Uint32Array(n), rs: new Uint32Array(nR), rn: new Uint32Array(nR),
    pts: new Float32Array(2 * nP), cx: new Float32Array(n), cy: new Float32Array(n), cr: new Float32Array(n),
    key: new Float32Array(n), proj: new Float32Array(n), wkey: new Float32Array(n),
  };
  const rng = makeRng(o.seed || 1, 'anim-key');
  let ri = 0, pi = 0;
  for (let i = 0; i < n; i++) {
    const e = items[i];
    G.t[i] = e.t === 'circle' ? 1 : e.t === 'multi' ? 2 : 0;
    G.f[i] = e.f; G.s[i] = e.s; G.w[i] = e.w || 1;
    G.key[i] = rng.next();
    G.r0[i] = ri;
    if (e.t === 'circle') {
      G.cx[i] = e.x; G.cy[i] = e.y; G.cr[i] = e.r; G.r1[i] = ri;
    } else {
      const closed = e.t === 'multi' || !!e.c, rings = e.t === 'multi' ? e.rr : [e.p];
      G.fl[i] = (closed ? 1 : 0) | (e.sm ? 2 : 0) | (e.t === 'multi' ? 4 : 0);
      const turn = e.t === 'poly' && e.f !== -1 && e.s === -1 && area(e.p) < 0;
      let sx = 0, sy = 0, sn = 0;
      for (let k = 0; k < rings.length; k++) {
        const p = turn ? reverse(rings[k]) : rings[k], m = p.length / 2;
        G.rs[ri] = pi;
        const start = pi;
        const put = (x, y) => { G.pts[2 * pi] = x; G.pts[2 * pi + 1] = y; pi++; };
        const last = closed ? m : m - 1;
        put(p[0], p[1]);
        for (let a = 0; a < last; a++) {
          const b = (a + 1) % m, x0 = p[2 * a], y0 = p[2 * a + 1], x1 = p[2 * b], y1 = p[2 * b + 1];
          const L = Math.hypot(x1 - x0, y1 - y0), c = step && !e.sm && L > step ? Math.ceil(L / step) : 1;
          for (let q = 1; q < c; q++) put(x0 + (x1 - x0) * q / c, y0 + (y1 - y0) * q / c);
          if (b !== 0) put(x1, y1);
        }
        G.rn[ri] = pi - start;
        if (k === 0) for (let q = start; q < pi; q++) { sx += G.pts[2 * q]; sy += G.pts[2 * q + 1]; sn++; }
        ri++;
      }
      G.r1[i] = ri;
      G.cx[i] = sn ? sx / sn : 0; G.cy[i] = sn ? sy / sn : 0;
    }
    const pj = ((G.cx[i] - W / 2) * 0.8 + (G.cy[i] - H / 2) * 0.6) / S;
    G.proj[i] = pj;
    G.wkey[i] = Math.max(0, Math.min(1, 0.62 * (pj + 0.75) / 1.5 + 0.38 * G.key[i]));
  }
  G.nP = pi;      // a degenerate ring (two points) may count less
  G.order = drawOrder(G, o.margin ?? 0.5);
  // The frame cost in points: a circle costs about as much as six points,
  // a draw group (one fill or stroke call) about as much as thirty.
  let nc = 0; for (let i = 0; i < n; i++) if (G.t[i] === 1) nc++;
  G.cost = pi + 6 * nc + 30 * (G.gs.length - 1);
  return G;
}
// ── draw order ─────────────────────────────────────────────────────────────
// A paint order that keeps the picture and needs fewer draw calls. Each
// element gets a level: it must come after every earlier element of
// another style that it may overlap (the boxes, grown by margin, share a
// grid cell), and not before an earlier one of its own style. The box
// grows by margin plus 0.21 of its size: a turned motif stays in it. The order
// is by level, then by style, then by the pattern order. A cell keeps the
// top level in it and the style at that level (-1: more than one), so
// the pass is one look per cell.
// The style key of render.js: class 1 (a line), 2 (a solid), 3 (a solid
// with an outline) share a key by inks and weight; any other element has
// a key of its own.
function styleKeys(G) {
  const map = new Map(), key = new Int32Array(G.n);
  for (let i = 0; i < G.n; i++) {
    const f = G.f[i], s = G.s[i], t = G.t[i];
    const c = f === -1 ? (s === -1 ? 0 : 1) : t === 2 ? 0 : s === -1 ? 2 : 3;
    if (!c) { key[i] = -1 - i; continue; }
    const k = c === 1 ? 's' + s + '|' + G.w[i] : c === 2 ? 'f' + f : 'k' + f + '|' + s + '|' + G.w[i];
    let v = map.get(k); if (v == null) { v = map.size; map.set(k, v); }
    key[i] = v;
  }
  return key;
}
export function drawOrder(G, margin = 0.5) {
  const n = G.n, key = styleKeys(G), lvl = new Int32Array(n);
  const cell = Math.max(G.S / 220, Math.sqrt(G.W * G.H / Math.max(1, n)) * 0.9);
  const gw = Math.ceil(G.W / cell) + 4, gh = Math.ceil(G.H / cell) + 4, top = new Int32Array(gw * gh).fill(-1), tk = new Int32Array(gw * gh);
  const ix = x => Math.max(0, Math.min(gw - 1, Math.floor(x / cell) + 2)), iy = y => Math.max(0, Math.min(gh - 1, Math.floor(y / cell) + 2));
  let maxL = 0;
  for (let i = 0; i < n; i++) {
    let x0, y0, x1, y1;
    if (G.t[i] === 1) { x0 = G.cx[i] - G.cr[i]; x1 = G.cx[i] + G.cr[i]; y0 = G.cy[i] - G.cr[i]; y1 = G.cy[i] + G.cr[i]; }
    else {
      x0 = y0 = Infinity; x1 = y1 = -Infinity;
      for (let ri = G.r0[i]; ri < G.r1[i]; ri++) for (let q = G.rs[ri], e = q + G.rn[ri]; q < e; q++) {
        const x = G.pts[2 * q], y = G.pts[2 * q + 1];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      if (!(x1 >= x0)) { x0 = x1 = G.cx[i]; y0 = y1 = G.cy[i]; }
    }
    // The margin: a turn about the centre sweeps about 0.21 of the box.
    const mg = margin + 0.21 * Math.max(x1 - x0, y1 - y0);
    const a0 = ix(x0 - mg), a1 = ix(x1 + mg), b0 = iy(y0 - mg), b1 = iy(y1 + mg), k = key[i];
    let L = 0;
    for (let v = b0; v <= b1; v++) for (let u = a0; u <= a1; u++) {
      const c = v * gw + u, t = top[c];
      if (t < 0) continue;
      const need = tk[c] === k ? t : t + 1;
      if (need > L) L = need;
    }
    lvl[i] = L; if (L > maxL) maxL = L;
    for (let v = b0; v <= b1; v++) for (let u = a0; u <= a1; u++) {
      const c = v * gw + u;
      if (L > top[c]) { top[c] = L; tk[c] = k; } else if (L === top[c] && tk[c] !== k) tk[c] = -2147483648;
    }
  }
  // Sort by (level, style, index): a stable sort of the indices.
  const idx = Array.from({ length: n }, (_, i) => i);
  idx.sort((a, b) => lvl[a] - lvl[b] || key[a] - key[b] || a - b);
  G.levels = maxL + 1;
  // Group starts: a new group at each change of level or style.
  const gs = [0];
  for (let q = 1; q < n; q++) { const a = idx[q - 1], b = idx[q]; if (lvl[a] !== lvl[b] || key[a] !== key[b]) gs.push(q); }
  gs.push(n);
  G.gs = Uint32Array.from(gs);
  return Uint32Array.from(idx);
}
function area(p) { let s = 0; const m = p.length / 2; for (let i = 0; i < m; i++) { const j = (i + 1) % m; s += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1]; } return s / 2; }
function reverse(p) { const q = new Array(p.length), m = p.length / 2; for (let i = 0; i < m; i++) { q[2 * i] = p[2 * (m - 1 - i)]; q[2 * i + 1] = p[2 * (m - 1 - i) + 1]; } return q; }

// Pairs for a morph: element i of A and element i of B pair when they
// have the same kind, inks and ring sizes. Returns { a: Int32Array(nA)
// (index in B or -1), b: Uint8Array(nB) (1: B has a pair) , count }.
export function pairUp(A, B) {
  const a = new Int32Array(A.n).fill(-1), b = new Uint8Array(B.n);
  let count = 0;
  const m = Math.min(A.n, B.n);
  for (let i = 0; i < m; i++) {
    if (A.t[i] !== B.t[i] || A.f[i] !== B.f[i] || A.s[i] !== B.s[i] || A.fl[i] !== B.fl[i]) continue;
    const na = A.r1[i] - A.r0[i];
    if (na !== B.r1[i] - B.r0[i]) continue;
    let same = true;
    for (let k = 0; k < na && same; k++) same = A.rn[A.r0[i] + k] === B.rn[B.r0[i] + k];
    if (!same) continue;
    a[i] = i; b[i] = 1; count++;
  }
  return { a, b, count };
}

// ── colour table ───────────────────────────────────────────────────────────
// Q steps from each ink to the next in OKLab: position k * Q + j is ink k
// mixed toward ink k + 1 (the last ink goes to the first).
export function colourTable(pal) {
  const n = pal.ink.length, labs = pal.ink.map(hexToOklab), out = new Array(n * Q);
  for (let k = 0; k < n; k++) {
    const A = labs[k], B = labs[(k + 1) % n];
    for (let j = 0; j < Q; j++) {
      // Most steps hold a pure ink; the change takes the middle 40%, so a
      // cycle reads as inks that hand over, not as muddy mixes.
      const u = sstep((j / Q - 0.3) / 0.4);
      out[k * Q + j] = u === 0 ? pal.ink[k].toLowerCase() : oklabToHex([A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u, A[2] + (B[2] - A[2]) * u]);
    }
  }
  return out;
}

// ── compile ────────────────────────────────────────────────────────────────
// view: { W, H } (the board on screen, in design units). G: the packed
// geometry (its W and H may be larger: the cover board). nInk: inks in the
// palette. seed: for the noise curves and the flow field.
export function compile(anim, view, G, nInk, seed = 1) {
  const A = cleanAnim(anim), on = activeIds(A);
  const S = Math.min(view.W, view.H);
  const C = { L: A.L, W: view.W, H: view.H, S, gx: G.W / 2, gy: G.H / 2, nInk: Math.max(1, nInk), on: {}, still: true, deform: false, morph: null };
  for (const id of on) {
    const s = A.ch[id], h = hashStr(id + ':' + seed);
    C.on[id] = { curve: s.curve, amount: s.amount, freq: s.freq, cycles: s.cycles, phase: s.phase, na: (h % 628) / 100, nb: ((h >>> 10) % 628) / 100 };
    const g = CHANNELS[id].group;
    if (g === 'motif' && !(id === 'colour' && !(s.freq > 0))) C.still = false;
    if (g === 'field') { C.still = false; C.deform = true; }
  }
  if (A.morph) { C.morph = { curve: A.morph.curve, cycles: A.morph.cycles, phase: A.morph.phase, na: 1.3, nb: 4.1 }; C.still = false; }
  if (C.on.flow) {
    const f = C.on.flow, cell = S / 22, mx = Math.ceil(G.W / cell) + 3, my = Math.ceil(G.H / cell) + 3;
    C.flow = { cell, mx, my, ox: -cell, oy: -cell, dx: new Float32Array(mx * my), dy: new Float32Array(mx * my), N1: makeNoise(makeRng(seed, 'flow-a').next), N2: makeNoise(makeRng(seed, 'flow-b').next), f: f.freq / S };
  }
  return C;
}
const chX = (c, tt, L) => frac(tt / L * c.cycles + c.phase);
const val = (c, x) => curveValue(c.curve, x, c.na, c.nb);
// A phase in cycles: a ramp advances, the other curves swing.
const cyc = (c, x, swing = 0.25) => c.curve === 'ramp' ? x : swing * val(c, x);

// Frame buffers for one packed geometry. Reused every frame.
export function makeFrame(G) {
  return {
    pts: new Float32Array(2 * G.nP), cx: new Float32Array(G.n), cy: new Float32Array(G.n), cr: new Float32Array(G.n),
    sc: new Float32Array(G.n), fc: new Int16Array(G.n), kc: new Int16Array(G.n),
    M: new Float64Array(6), dash: null, cshift: 0, still: false, cvar: false, drawn: 0, drawnPts: 0,
  };
}

// ── frame ──────────────────────────────────────────────────────────────────
// Write the frame at time t into F. mo (morph only): { other: the packed
// B geometry, pair: pairUp(A, B), role: 'A' | 'B' }. Returns F.
export function frame(G, C, t, F, mo = null) {
  const L = C.L, tt = wrapT(t, L), on = C.on, S = C.S, Q_ = Q, nQ = C.nInk * Q_;
  // board transform: geometry units -> view units
  let th = 0, z = 1, px = 0, py = 0;
  if (on.rotate) { const c = on.rotate, x = chX(c, tt, L); th = c.curve === 'ramp' ? TAU * x : c.amount * Math.PI / 180 * val(c, x); }
  if (on.zoom) { const c = on.zoom, x = chX(c, tt, L); z = 1 + c.amount * (val(c, x) + 1) / 2; }
  if (on.pan) {
    const c = on.pan, x = chX(c, tt, L), A = c.amount * S;
    if (c.curve === 'ramp') { px = -A * Math.cos(TAU * x); py = 0.6 * A * Math.sin(2 * TAU * x); }
    else { px = A * val(c, x); py = 0.6 * A * val(c, frac(x + 0.25)); }
  }
  const ca = Math.cos(th) * z, sa = Math.sin(th) * z, M = F.M;
  M[0] = ca; M[1] = sa; M[2] = -sa; M[3] = ca;
  M[4] = C.W / 2 + px - (ca * C.gx - sa * C.gy); M[5] = C.H / 2 + py - (sa * C.gx + ca * C.gy);
  // dashes
  F.dash = null;
  if (on.dash) {
    const c = on.dash, x = chX(c, tt, L), len = 2 + c.amount * S * 0.03, gap = len * 0.85, per = len + gap;
    const off = c.curve === 'ramp' ? -per * x * Math.max(1, Math.round(c.freq)) : -per * c.freq * (val(c, x) + 1) / 2;
    F.dash = [len, gap, off];
  }
  // a global colour shift (colour cycle with no wave across)
  let gshift = 0;
  const col = on.colour;
  if (col && !(col.freq > 0)) {
    const x = chX(col, tt, L), g = col.curve === 'ramp' ? C.nInk * x : col.amount * (val(col, x) + 1) / 2;
    gshift = Math.round(g * Q_) % nQ;
  }
  F.cshift = gshift;
  const slotPos = (k, sh) => k < 0 ? k : (((k % C.nInk) * Q_ + sh) % nQ + nQ) % nQ;
  if (C.still) {
    F.still = true; F.cvar = false; F.drawn = G.n; F.drawnPts = G.nP;
    for (let i = 0; i < G.n; i++) { F.sc[i] = 1; F.fc[i] = slotPos(G.f[i], gshift); F.kc[i] = slotPos(G.s[i], gshift); }
    return F;
  }
  F.still = false;
  F.cvar = !!(col && col.freq > 0);
  // motif channels: the global phase of each
  const sp = on.spin, br = on.breathe, tn = on.thin, cw = col && col.freq > 0 ? col : null;
  const xs = sp ? chX(sp, tt, L) : 0, xb = br ? chX(br, tt, L) : 0, xc = cw ? chX(cw, tt, L) : 0;
  const hThin = tn ? tn.amount * (val(tn, chX(tn, tt, L)) + 1) / 2 : 0;
  // morph
  let hM = -1, soft = 0.16;
  if (mo && C.morph) { const m = (val(C.morph, chX(C.morph, tt, L)) + 1) / 2; hM = m * (1 + soft); }
  const isB = mo && mo.role === 'B', pairA = mo && !isB ? mo.pair.a : null, pairB = isB ? mo.pair.b : null, O = mo ? mo.other : null;
  // field constants
  const fd = C.deform ? fieldConsts(C, tt, G) : null;
  const P = G.pts, out = F.pts;
  let drawn = 0, dpts = 0;
  for (let i = 0; i < G.n; i++) {
    // scale, turn and colour of this element
    let b = 1, a = 0, sh = gshift, lam = 0, pj = -1;
    if (hM >= 0) {
      lam = sstep((hM - G.wkey[i]) / soft);
      if (isB) { if (pairB[i]) b = 0; else b = lam; }
      else { pj = pairA[i]; if (pj < 0) b = 1 - lam; }
    }
    if (tn && b > 0) { const k = frac(G.key[i] + tn.freq * (G.proj[i] + 1) * 0.5); b *= sstep((k - hThin + 0.1) / 0.1); }
    if (br && b > 0) { const x = frac(xb + br.freq * G.proj[i]); b *= 1 - br.amount * (1 - val(br, x)) / 2; }
    F.sc[i] = b;
    if (b < 0.004) continue;
    if (sp) { const x = frac(xs + sp.freq * G.proj[i]); a = sp.curve === 'ramp' ? TAU * x : sp.amount * Math.PI / 180 * val(sp, x); }
    if (cw) { const x = frac(xc + cw.freq * G.proj[i]); const g = cw.curve === 'ramp' ? C.nInk * x : cw.amount * (val(cw, x) + 1) / 2; sh = Math.round(g * Q_) % nQ; }
    F.fc[i] = slotPos(G.f[i], sh); F.kc[i] = slotPos(G.s[i], sh);
    drawn++;
    const cs = Math.cos(a) * b, sn = Math.sin(a) * b;
    let ox = G.cx[i], oy = G.cy[i];
    if (pj >= 0 && lam > 0) { ox += (O.cx[pj] - ox) * lam; oy += (O.cy[pj] - oy) * lam; }
    if (G.t[i] === 1) {
      let x = ox, y = oy, r = G.cr[i] * b;
      if (pj >= 0 && lam > 0) r = (G.cr[i] + (O.cr[pj] - G.cr[i]) * lam) * b;
      if (fd) { fd.q[0] = x; fd.q[1] = y; deform(fd, fd.q); x = fd.q[0]; y = fd.q[1]; }
      F.cx[i] = x; F.cy[i] = y; F.cr[i] = r; dpts++;
      continue;
    }
    for (let ri = G.r0[i]; ri < G.r1[i]; ri++) {
      const s0 = G.rs[ri], m = G.rn[ri];
      const s1 = pj >= 0 ? O.rs[O.r0[pj] + (ri - G.r0[i])] : 0;
      for (let k = 0; k < m; k++) {
        const j = 2 * (s0 + k);
        let x = P[j], y = P[j + 1];
        if (pj >= 0 && lam > 0) { const jb = 2 * (s1 + k); x += (O.pts[jb] - x) * lam; y += (O.pts[jb + 1] - y) * lam; }
        const dx = x - ox, dy = y - oy;
        x = ox + cs * dx - sn * dy; y = oy + sn * dx + cs * dy;
        if (fd) { fd.q[0] = x; fd.q[1] = y; deform(fd, fd.q); x = fd.q[0]; y = fd.q[1]; }
        out[j] = x; out[j + 1] = y;
      }
      dpts += m;
    }
  }
  F.drawn = drawn; F.drawnPts = dpts;
  return F;
}

// The per-frame constants of the field channels.
function fieldConsts(C, tt, G) {
  const on = C.on, L = C.L, S = C.S, gx = C.gx, gy = C.gy, fd = { q: new Float64Array(2), gx, gy };
  if (on.twist) {
    const c = on.twist, R = c.freq * S * 0.7;
    fd.tw = { R, a: c.amount * Math.PI / 180 * val(c, chX(c, tt, L)) };
  }
  if (on.lens) {
    const c = on.lens, x = chX(c, tt, L), R = c.freq * S;
    let lx, ly;
    if (c.curve === 'ramp') { lx = -Math.cos(TAU * x); ly = Math.sin(2 * TAU * x); }
    else { lx = val(c, x); ly = val(c, frac(x + 0.25)); }
    fd.ln = { x: gx + 0.24 * C.W * lx, y: gy + 0.2 * C.H * ly, R, pw: 1 / (1 + Math.max(-0.9, c.amount)) };
  }
  if (on.wave) {
    const c = on.wave, x = chX(c, tt, L), d = 0.42;
    fd.wv = { A: c.amount * S, k: TAU * c.freq / S, ux: Math.cos(d), uy: Math.sin(d), p: TAU * cyc(c, x) };
  }
  if (on.ripple) {
    const c = on.ripple, x = chX(c, tt, L);
    fd.rp = { A: c.amount * S, k: TAU * c.freq / (0.5 * S), p: TAU * cyc(c, x), fade: 0.08 * S };
  }
  if (on.flow) {
    const c = on.flow, x = chX(c, tt, L), Fl = C.flow, A = c.amount * S, th = TAU * cyc(c, x), r = 1.6;
    const ox = r * Math.cos(th), oy = r * Math.sin(th);
    for (let v = 0; v < Fl.my; v++) for (let u = 0; u < Fl.mx; u++) {
      const X = (Fl.ox + u * Fl.cell) * Fl.f, Y = (Fl.oy + v * Fl.cell) * Fl.f, k = v * Fl.mx + u;
      Fl.dx[k] = A * Fl.N1.fbm(X + ox, Y + oy, 2);
      Fl.dy[k] = A * Fl.N2.fbm(X - oy, Y + ox, 2);
    }
    fd.fl = Fl;
  }
  return fd;
}
// Move one point q (in place) through the field channels.
function deform(fd, q) {
  let x = q[0], y = q[1];
  if (fd.tw) {
    const dx = x - fd.gx, dy = y - fd.gy, r = Math.hypot(dx, dy), R = fd.tw.R;
    if (r < R) { const u = 1 - r / R, th = fd.tw.a * u * u, c = Math.cos(th), s = Math.sin(th); x = fd.gx + c * dx - s * dy; y = fd.gy + s * dx + c * dy; }
  }
  if (fd.ln) {
    const l = fd.ln, dx = x - l.x, dy = y - l.y, d = Math.hypot(dx, dy);
    if (d < l.R && d > 1e-9) { const k = l.R * Math.pow(d / l.R, l.pw) / d; x = l.x + dx * k; y = l.y + dy * k; }
  }
  if (fd.wv) {
    const w = fd.wv, s = w.A * Math.sin(w.k * (x * w.ux + y * w.uy) - w.p);
    x -= w.uy * s; y += w.ux * s;
  }
  if (fd.rp) {
    const r = fd.rp, dx = x - fd.gx, dy = y - fd.gy, d = Math.hypot(dx, dy);
    if (d > 1e-6) { const s = r.A * Math.sin(r.k * d - r.p) * Math.min(1, d / r.fade); x += dx / d * s; y += dy / d * s; }
  }
  if (fd.fl) {
    const F = fd.fl, u = (x - F.ox) / F.cell, v = (y - F.oy) / F.cell;
    const i = Math.max(0, Math.min(F.mx - 2, Math.floor(u))), j = Math.max(0, Math.min(F.my - 2, Math.floor(v)));
    const fu = Math.max(0, Math.min(1, u - i)), fv = Math.max(0, Math.min(1, v - j)), k = j * F.mx + i;
    const a = (1 - fu) * (1 - fv), b = fu * (1 - fv), c = (1 - fu) * fv, d = fu * fv;
    x += a * F.dx[k] + b * F.dx[k + 1] + c * F.dx[k + F.mx] + d * F.dx[k + F.mx + 1];
    y += a * F.dy[k] + b * F.dy[k + 1] + c * F.dy[k + F.mx] + d * F.dy[k + F.mx + 1];
  }
  q[0] = x; q[1] = y;
}

// ── still items ────────────────────────────────────────────────────────────
// The frame as pattern-designer elements in view units (the board
// transform applied), for toSVG and drawItems. A slot is a colour
// position: use { bg, ink: colourTable(pal) } as the palette.
export function materialise(G, F) {
  const M = F.M, P = F.still ? G.pts : F.pts, out = [];
  const mx = (x, y) => M[0] * x + M[2] * y + M[4], my = (x, y) => M[1] * x + M[3] * y + M[5];
  const z = Math.hypot(M[0], M[1]);
  for (let i = 0; i < G.n; i++) {
    const b = F.still ? 1 : F.sc[i];
    if (b < 0.004) continue;
    const f = F.fc[i], s = F.kc[i], w = G.w[i] * z;
    if (G.t[i] === 1) {
      const x = F.still ? G.cx[i] : F.cx[i], y = F.still ? G.cy[i] : F.cy[i], r = (F.still ? G.cr[i] : F.cr[i]) * z;
      out.push({ t: 'circle', x: mx(x, y), y: my(x, y), r, f, s, w });
      continue;
    }
    const rings = [];
    for (let ri = G.r0[i]; ri < G.r1[i]; ri++) {
      const s0 = G.rs[ri], m = G.rn[ri], p = new Array(2 * m);
      for (let k = 0; k < m; k++) { const x = P[2 * (s0 + k)], y = P[2 * (s0 + k) + 1]; p[2 * k] = mx(x, y); p[2 * k + 1] = my(x, y); }
      rings.push(p);
    }
    const fl = G.fl[i];
    if (fl & 4) out.push({ t: 'multi', rr: rings.filter(r => r.length >= 6), f, s, w, sm: fl & 2 ? 1 : 0 });
    else if (rings[0] && rings[0].length >= 4) { const e = { t: 'poly', p: rings[0], c: fl & 1, f, s, w }; if (fl & 2) e.sm = 1; out.push(e); }
  }
  return out;
}

// ── cover board ────────────────────────────────────────────────────────────
// The geometry board for a view board and an animation: { W, H, k } with
// k the scale over the view (1 when nothing reaches past the edge).
// composed: the pattern is one centred motif (a radial family), so a turn
// keeps the board and shows paper in the corners.
export function coverFor(view, anim, composed = false) {
  const A = cleanAnim(anim), c = A.ch, S = Math.min(view.W, view.H);
  let hw = view.W / 2, hh = view.H / 2;
  if (c.rotate.on && !composed) {
    const max = c.rotate.curve === 'ramp' ? Math.PI : Math.min(Math.PI, c.rotate.amount * Math.PI / 180);
    let bw = hw, bh = hh;
    for (let i = 0; i <= 24; i++) {
      const th = max * i / 24, co = Math.abs(Math.cos(th)), si = Math.abs(Math.sin(th));
      bw = Math.max(bw, hw * co + hh * si); bh = Math.max(bh, hw * si + hh * co);
    }
    hw = bw; hh = bh;
  }
  let m = 0;
  if (c.pan.on) m += c.pan.amount * S * 1.05;
  if (c.wave.on) m += c.wave.amount * S;
  if (c.ripple.on) m += c.ripple.amount * S;
  if (c.flow.on) m += c.flow.amount * S * 1.2;
  if (c.spin.on || c.breathe.on) m += 0.03 * S;
  hw += m; hh += m;
  // A step of 4% keeps a small slider move from a new board.
  const k0 = Math.max(hw / (view.W / 2), hh / (view.H / 2)), k = k0 <= 1.0001 ? 1 : Math.ceil(k0 * 25) / 25;
  return { W: Math.round(view.W * k * 100) / 100, H: Math.round(view.H * k * 100) / 100, k };
}
