// ============================================================================
//  PATTERN DESIGNER  ·  modifiers.js — stackable changes to any pattern
// ----------------------------------------------------------------------------
//  A modifier takes the element list of a pattern (engine.js) and gives a
//  new list. The stack runs top to bottom. The same list, stack and seed
//  always give the same result, so the worker, the page and the tests
//  agree. No DOM here, except buildTextShape, which needs a 2D canvas that
//  the caller gives.
//
//  KINDS
//    warp     lens (bulge or pinch), twirl, wave or noise. Lines are cut
//             into short steps first, so straight edges bend.
//    mask     keep the part inside a shape (or outside, with invert).
//             Lines are cut at the edge. Solids stay whole when their
//             centre is inside.
//    clip     a hard clip to a shape in the SVG (<clipPath>), with an
//             optional frame line. The geometry does not change.
//    mirror   left-right, top-bottom, both, or a kaleidoscope of n wedges.
//    repeat   the whole pattern, smaller, in an nx by ny grid.
//    jitter   a seeded shake of each point and each element.
//    dash     lines become dashes or dots, as real geometry (a pen
//             plotter draws them as they are).
//
//  SHAPES (mask and clip): circle, rounded, diamond, arch, hex, text.
//  A text shape is { grid, rings } from buildTextShape.
//
//  grep -n targets
//    run the stack ........ "export function applyModifiers"
//    shapes ............... "export function shapeRings"
//    warps ................ "function warpFn"
//    text to shape ........ "export function buildTextShape"
//    defaults ............. "export const MOD_KINDS"
// ============================================================================
import { TAU, CAP, makeRng, makeNoise, resample, contours, centroid, clamp } from './engine.js';

// The controls of each kind: { key: [min, max, step, default, label] }.
// Choice keys (kind, shape) list their values.
export const MOD_KINDS = {
  warp: { label: 'Warp', choice: { kind: ['lens', 'twirl', 'wave', 'noise'] }, params: { amount: [-1, 2, 0.01, 0.6, 'Amount'], size: [0.1, 1.5, 0.01, 0.55, 'Size'], cx: [0, 1, 0.01, 0.5, 'Centre x'], cy: [0, 1, 0.01, 0.5, 'Centre y'] } },
  mask: { label: 'Mask', choice: { shape: ['circle', 'rounded', 'diamond', 'arch', 'hex', 'text'] }, params: { margin: [0, 0.4, 0.005, 0.1, 'Margin'], invert: [0, 1, 1, 0, 'Invert'], outline: [0, 1, 1, 0, 'Outline'] } },
  clip: { label: 'Clip', choice: { shape: ['rounded', 'circle', 'arch', 'diamond', 'hex', 'text'] }, params: { margin: [0, 0.4, 0.005, 0.06, 'Margin'], frame: [0, 1, 1, 1, 'Frame line'] } },
  mirror: { label: 'Mirror', choice: { kind: ['x', 'y', 'xy', 'kaleido'] }, params: { n: [3, 16, 1, 6, 'Wedges'] } },
  repeat: { label: 'Repeat', params: { nx: [1, 8, 1, 2, 'Across'], ny: [1, 8, 1, 2, 'Down'], gap: [0, 0.2, 0.005, 0.03, 'Gutter'] } },
  jitter: { label: 'Jitter', params: { amount: [0, 1, 0.01, 0.25, 'Shake'], turn: [0, 1, 0.01, 0, 'Turn'] } },
  dash: { label: 'Dash', choice: { kind: ['dash', 'dots'] }, params: { dash: [2, 120, 1, 18, 'Dash'], gap: [1, 120, 1, 10, 'Gap'], dot: [0.5, 12, 0.1, 2.4, 'Dot size'] } },
};
export function modDefaults(type) {
  const k = MOD_KINDS[type], m = { type };
  for (const c in k.choice || {}) m[c] = k.choice[c][0];
  for (const p in k.params) m[p] = k.params[p][3];
  return m;
}

// ── shapes ─────────────────────────────────────────────────────────────────
// Rings (flat closed point lists) of a shape on a W x H board.
export function shapeRings(m, W, H) {
  const S = Math.min(W, H), g = (m.margin ?? 0.1) * S, x0 = g, y0 = g, w = W - 2 * g, h = H - 2 * g, cx = W / 2, cy = H / 2;
  const ring = (n, f) => { const p = []; for (let i = 0; i < n; i++) { const [x, y] = f(i / n * TAU); p.push(x, y); } return p; };
  switch (m.shape) {
    case 'circle': { const r = Math.min(w, h) / 2; return [ring(128, a => [cx + r * Math.cos(a), cy + r * Math.sin(a)])]; }
    case 'diamond': return [[cx, y0, x0 + w, cy, cx, y0 + h, x0, cy]];
    case 'hex': { const r = Math.min(w / Math.sqrt(3) * 1.0, h / 2); return [ring(6, a => [cx + r * Math.cos(a - Math.PI / 2), cy + r * Math.sin(a - Math.PI / 2)])]; }
    case 'arch': {
      const r = w / 2, p = [x0, y0 + h, x0 + w, y0 + h, x0 + w, y0 + r];
      for (let i = 1; i < 48; i++) { const a = -Math.PI * i / 48; p.push(cx + r * Math.cos(a), y0 + r + r * Math.sin(a)); }
      p.push(x0, y0 + r);
      return [p];
    }
    case 'text': return m.text && m.text.rings ? m.text.rings : [];
    default: {   // rounded rectangle
      const r = 0.08 * S, p = [];
      for (const [qx, qy, a0] of [[x0 + w - r, y0 + r, -Math.PI / 2], [x0 + w - r, y0 + h - r, 0], [x0 + r, y0 + h - r, Math.PI / 2], [x0 + r, y0 + r, Math.PI]])
        for (let k = 0; k <= 8; k++) { const a = a0 + Math.PI / 2 * k / 8; p.push(qx + r * Math.cos(a), qy + r * Math.sin(a)); }
      return [p];
    }
  }
}
// Even-odd point test against rings.
function inRings(rings, x, y) {
  let c = false;
  for (const p of rings) {
    const m = p.length / 2;
    for (let i = 0, j = m - 1; i < m; j = i++) {
      const xi = p[2 * i], yi = p[2 * i + 1], xj = p[2 * j], yj = p[2 * j + 1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
  }
  return c;
}
// A fast inside test: a text shape reads its raster grid, the others test
// their rings (few points).
function insideFn(m, W, H) {
  if (m.shape === 'text' && m.text && m.text.grid) {
    const G = m.text.grid;
    return (x, y) => { const i = Math.floor((x - G.x0) / G.k), j = Math.floor((y - G.y0) / G.k); return i >= 0 && j >= 0 && i < G.w && j < G.h && G.data[j * G.w + i] > 127; };
  }
  const rings = shapeRings(m, W, H);
  return (x, y) => inRings(rings, x, y);
}

// ── warps ──────────────────────────────────────────────────────────────────
function warpFn(m, W, H, seed) {
  const S = Math.min(W, H), cx = (m.cx ?? 0.5) * W, cy = (m.cy ?? 0.5) * H, R = (m.size ?? 0.5) * S, a = m.amount ?? 0.6;
  switch (m.kind) {
    case 'twirl': return (x, y) => {
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy); if (d >= R) return [x, y];
      const t = 1 - d / R, th = a * Math.PI * t * t, c = Math.cos(th), s = Math.sin(th);
      return [cx + dx * c - dy * s, cy + dx * s + dy * c];
    };
    case 'wave': { const f = TAU / (R * 0.5), A = a * S * 0.035; return (x, y) => [x + A * Math.sin(y * f), y + A * Math.sin(x * f * 0.8 + 1.3)]; }
    case 'noise': {
      const N = makeNoise(makeRng(seed, 'warp').next), f = 1 / (R * 0.9), A = a * S * 0.06;
      return (x, y) => [x + A * N.fbm(x * f, y * f, 3), y + A * N.fbm(x * f + 31.7, y * f - 12.9, 3)];
    }
    default: {   // lens: d' = R (d/R)^(1/(1+a)) inside R. a > 0 bulges, a < 0 pinches.
      const pw = 1 / (1 + Math.max(-0.9, a));
      return (x, y) => {
        const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy); if (d >= R || d < 1e-9) return [x, y];
        const k = R * Math.pow(d / R, pw) / d; return [cx + dx * k, cy + dy * k];
      };
    }
  }
}
// Map an element through f. Small circles stay circles (the centre moves,
// the radius scales by the local area change). Large circles become rings.
function warpItem(e, f, step) {
  if (e.t === 'circle') {
    if (e.r < step * 1.5) {
      const [x, y] = f(e.x, e.y), [x1, y1] = f(e.x + 0.5, e.y), [x2, y2] = f(e.x, e.y + 0.5);
      const det = Math.abs((x1 - x) * (y2 - y) - (x2 - x) * (y1 - y)) * 4;
      return Object.assign({}, e, { x, y, r: e.r * Math.sqrt(clamp(det, 0.01, 25)) });
    }
    const p = [], n = Math.max(24, Math.min(160, Math.ceil(TAU * e.r / step)));
    for (let i = 0; i < n; i++) { const a = TAU * i / n; p.push(...f(e.x + e.r * Math.cos(a), e.y + e.r * Math.sin(a))); }
    return { t: 'poly', p, c: 1, f: e.f, s: e.s, w: e.w };
  }
  const map = q => { const r = resample(q, step, true); const o = new Array(r.length); for (let i = 0; i < r.length; i += 2) { const [x, y] = f(r[i], r[i + 1]); o[i] = x; o[i + 1] = y; } return o; };
  if (e.t === 'multi') return Object.assign({}, e, { rr: e.rr.map(map) });
  const r = resample(e.p, step, !!e.c), o = new Array(r.length);
  for (let i = 0; i < r.length; i += 2) { const [x, y] = f(r[i], r[i + 1]); o[i] = x; o[i + 1] = y; }
  return Object.assign({}, e, { p: o });
}

// ── cutting lines ──────────────────────────────────────────────────────────
// Split a polyline into the runs where keep(x, y) is true. The line is cut
// into steps first; a crossing is found by bisection, so the cut is
// clean at the shape edge.
function splitRuns(p, closed, keep, step) {
  const r = resample(p, step, closed);
  if (closed) r.push(r[0], r[1]);
  const runs = []; let cur = null;
  const edge = (x0, y0, x1, y1, inFirst) => {
    let a = 0, b = 1;
    for (let k = 0; k < 12; k++) { const m = (a + b) / 2, ins = keep(x0 + (x1 - x0) * m, y0 + (y1 - y0) * m); if (ins === inFirst) a = m; else b = m; }
    const t = inFirst ? a : b; return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
  };
  let prevIn = keep(r[0], r[1]);
  if (prevIn) cur = [r[0], r[1]];
  for (let i = 2; i < r.length; i += 2) {
    const x = r[i], y = r[i + 1], ins = keep(x, y);
    if (ins && prevIn) cur.push(x, y);
    else if (ins && !prevIn) { const [ex, ey] = edge(r[i - 2], r[i - 1], x, y, false); cur = [ex, ey, x, y]; }
    else if (!ins && prevIn) { const [ex, ey] = edge(r[i - 2], r[i - 1], x, y, true); cur.push(ex, ey); runs.push(cur); cur = null; }
    prevIn = ins;
  }
  if (cur && cur.length >= 4) {
    // A closed ring that is inside all the way stays one closed ring.
    if (closed && runs.length === 0) { cur.length -= 2; return [{ p: cur, c: 1 }]; }
    runs.push(cur);
  }
  return runs.map(q => ({ p: q, c: 0 }));
}
const isLine = e => e.t === 'poly' && e.f === -1;
const centre = e => e.t === 'circle' ? [e.x, e.y] : centroid(e.t === 'multi' ? e.rr[0] : e.p);

// ── kinds ──────────────────────────────────────────────────────────────────
function doMask(items, m, W, H, step) {
  const inside = insideFn(m, W, H), keep = m.invert ? (x, y) => !inside(x, y) : inside, out = [];
  for (const e of items) {
    if (isLine(e)) { for (const r of splitRuns(e.p, !!e.c, keep, step)) out.push(Object.assign({}, e, r)); continue; }
    const [x, y] = centre(e);
    if (keep(x, y)) out.push(e);
  }
  if (m.outline) for (const r of shapeRings(m, W, H)) out.push({ t: 'poly', p: r, c: 1, f: -1, s: 0, w: 1.5 });
  return out;
}
// Reflect each element through T (a 2x3 affine map [a, b, c, d, e, f]).
function mapItem(e, T) {
  const [a, b, c, d, tx, ty] = T, mp = p => { const o = new Array(p.length); for (let i = 0; i < p.length; i += 2) { o[i] = a * p[i] + c * p[i + 1] + tx; o[i + 1] = b * p[i] + d * p[i + 1] + ty; } return o; };
  if (e.t === 'circle') { const s = Math.sqrt(Math.abs(a * d - b * c)); return Object.assign({}, e, { x: a * e.x + c * e.y + tx, y: b * e.x + d * e.y + ty, r: e.r * s }); }
  if (e.t === 'multi') return Object.assign({}, e, { rr: e.rr.map(mp) });
  return Object.assign({}, e, { p: mp(e.p) });
}
function cutKeep(items, keep, step) {
  const out = [];
  for (const e of items) {
    if (isLine(e)) { for (const r of splitRuns(e.p, !!e.c, keep, step)) out.push(Object.assign({}, e, r)); continue; }
    const [x, y] = centre(e); if (keep(x, y)) out.push(e);
  }
  return out;
}
function doMirror(items, m, W, H, step) {
  const cx = W / 2, cy = H / 2;
  if (m.kind === 'kaleido') {
    const n = Math.round(m.n || 6), wedge = TAU / n;
    const ang = (x, y) => { let a = Math.atan2(y - cy, x - cx); if (a < 0) a += TAU; return a; };
    const base = cutKeep(items, (x, y) => ang(x, y) <= wedge, step), out = [];
    for (let k = 0; k < n; k++) {
      const th = k * wedge, refl = k % 2 === 1;
      // refl: reflect across the wedge axis at angle 0 first, then turn by (k+1)*wedge.
      const rot = refl ? (k + 1) * wedge : th, c = Math.cos(rot), s = Math.sin(rot), r = refl ? -1 : 1;
      const a = c, b = s, cc = -s * r, d = c * r;
      for (const e of base) out.push(mapItem(e, [a, b, cc, d, cx - a * cx - cc * cy, cy - b * cx - d * cy]));
    }
    return out;
  }
  let cur = items;
  if (m.kind === 'x' || m.kind === 'xy') { const b = cutKeep(cur, x => x <= cx, step); cur = b.concat(b.map(e => mapItem(e, [-1, 0, 0, 1, W, 0]))); }
  if (m.kind === 'y' || m.kind === 'xy') { const b = cutKeep(cur, (x, y) => y <= cy, step); cur = b.concat(b.map(e => mapItem(e, [1, 0, 0, -1, 0, H]))); }
  return cur;
}
function doRepeat(items, m, W, H) {
  const nx = Math.max(1, Math.round(m.nx)), ny = Math.max(1, Math.round(m.ny)), g = (m.gap || 0) * Math.min(W, H);
  const cw = (W - g * (nx + 1)) / nx, ch = (H - g * (ny + 1)) / ny, k = Math.min(cw / W, ch / H), out = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const ox = g + i * (cw + g) + (cw - W * k) / 2, oy = g + j * (ch + g) + (ch - H * k) / 2;
    for (const e of items) { const q = mapItem(e, [k, 0, 0, k, ox, oy]); if (q.w) q.w *= Math.max(0.35, k); out.push(q); }
    if (out.length > CAP.nodes) break;
  }
  return out;
}
function doJitter(items, m, W, H, seed) {
  const rng = makeRng(seed, 'jitter'), S = Math.min(W, H), A = (m.amount || 0) * S * 0.012, T = (m.turn || 0) * Math.PI * 0.5;
  return items.map(e => {
    const ox = rng.gauss() * A, oy = rng.gauss() * A, th = rng.gauss() * T, [cx, cy] = centre(e), c = Math.cos(th), s = Math.sin(th);
    const q = mapItem(e, [c, s, -s, c, cx - c * cx + s * cy + ox, cy - s * cx - c * cy + oy]);
    if (q.t === 'poly' && A > 0) { const p = q.p.slice(); for (let i = 0; i < p.length; i++) p[i] += rng.gauss() * A * 0.25; q.p = p; }
    return q;
  });
}
function doDash(items, m) {
  const D = Math.max(0.5, m.dash || 18), G = Math.max(0.5, m.gap || 10), out = [];
  for (const e of items) {
    const line = e.t === 'poly' && e.f === -1, ring = e.t === 'circle' && e.f === -1;
    if (!line && !ring) { out.push(e); continue; }
    let p = line ? e.p : null; const closed = line ? !!e.c : true;
    if (ring) { p = []; const n = Math.max(24, Math.ceil(TAU * e.r / 4)); for (let i = 0; i < n; i++) { const a = TAU * i / n; p.push(e.x + e.r * Math.cos(a), e.y + e.r * Math.sin(a)); } }
    const q = closed ? p.concat([p[0], p[1]]) : p;
    let pos = 0, on = true, cur = on ? [q[0], q[1]] : null, left = D;
    if (m.kind === 'dots') { out.push({ t: 'circle', x: q[0], y: q[1], r: m.dot || 2.4, f: e.s, s: -1, w: 1 }); }
    for (let i = 2; i < q.length; i += 2) {
      let x0 = q[i - 2], y0 = q[i - 1]; const x1 = q[i], y1 = q[i + 1];
      let L = Math.hypot(x1 - x0, y1 - y0);
      while (L > 1e-9) {
        const t = Math.min(L, left), x = x0 + (x1 - x0) * t / L, y = y0 + (y1 - y0) * t / L;
        if (on && m.kind !== 'dots') cur.push(x, y);
        L -= t; left -= t; x0 = x; y0 = y; pos += t;
        if (left <= 1e-9) {
          if (m.kind === 'dots') { if (!on) out.push({ t: 'circle', x, y, r: m.dot || 2.4, f: e.s, s: -1, w: 1 }); }
          else if (on) { if (cur.length >= 4) out.push(Object.assign({}, e, { t: 'poly', p: cur, c: 0, sm: 0 })); cur = null; }
          else cur = [x, y];
          on = !on; left = on ? D : G;
        }
      }
      if (out.length > CAP.nodes) break;
    }
    if (on && cur && cur.length >= 4 && m.kind !== 'dots') out.push(Object.assign({}, e, { t: 'poly', p: cur, c: 0, sm: 0 }));
  }
  return out;
}

// Run the stack. Returns { items, clip, frame, capped }. clip: rings for
// the SVG <clipPath> (the last clip in the stack).
export function applyModifiers(items, stack, W, H, seed = 1) {
  const S = Math.min(W, H), step = S / 160;
  let cur = items, clip = null, frame = false, capped = false;
  (stack || []).forEach((m, i) => {
    if (!m || m.off) return;
    const sd = (seed >>> 0) + 7919 * (i + 1);
    switch (m.type) {
      case 'warp': { const f = warpFn(m, W, H, sd); cur = cur.map(e => warpItem(e, f, step)); break; }
      case 'mask': cur = doMask(cur, m, W, H, step); break;
      case 'clip': clip = shapeRings(m, W, H); frame = !!m.frame; break;
      case 'mirror': cur = doMirror(cur, m, W, H, step); break;
      case 'repeat': cur = doRepeat(cur, m, W, H); break;
      case 'jitter': cur = doJitter(cur, m, W, H, sd); break;
      case 'dash': cur = doDash(cur, m); break;
    }
    if (cur.length > CAP.nodes) { cur = cur.slice(0, CAP.nodes); capped = true; }
  });
  let pts = 0; const out = [];
  for (const e of cur) {
    const n = e.t === 'circle' ? 1 : e.t === 'multi' ? e.rr.reduce((a, r) => a + r.length / 2, 0) : e.p.length / 2;
    if (pts + n > CAP.points) { capped = true; break; }
    pts += n; out.push(e);
  }
  return { items: out, clip: clip && clip.length ? clip : null, frame, capped };
}

// ── text ───────────────────────────────────────────────────────────────────
// Draw text into a canvas (made by mk(w, h)), then trace the glyph edge
// with contours(). Returns { grid, rings } in board units. font: a CSS
// family list. The text fills the board less the margin.
export function buildTextShape(text, W, H, mk, font = 'Inter, system-ui, sans-serif', weight = 800, margin = 0.08) {
  const gw = 420, k = W / gw, gh = Math.round(H / k), c = mk(gw, gh), g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, gw, gh);
  const lines = String(text || 'A').toUpperCase().split(/\n|\\n/).slice(0, 4);
  const pad = margin * Math.min(gw, gh), aw = gw - 2 * pad, ah = gh - 2 * pad;
  g.textBaseline = 'alphabetic'; g.textAlign = 'center'; g.fillStyle = '#fff';
  let fs = 100; g.font = `${weight} ${fs}px ${font}`;
  const wid = Math.max(...lines.map(l => g.measureText(l).width), 1);
  fs = Math.min(fs * aw / wid, ah / lines.length / 0.92);
  g.font = `${weight} ${fs}px ${font}`;
  const lh = fs * 0.92, top = gh / 2 - lh * lines.length / 2;
  lines.forEach((l, i) => g.fillText(l, gw / 2, top + lh * (i + 0.82)));
  const px = g.getImageData(0, 0, gw, gh).data, data = new Uint8Array(gw * gh), F = new Float32Array(gw * gh);
  for (let i = 0; i < gw * gh; i++) { data[i] = px[4 * i]; F[i] = px[4 * i] / 255; }
  for (let i = 0; i < gw; i++) { F[i] = 0; F[(gh - 1) * gw + i] = 0; }
  for (let j = 0; j < gh; j++) { F[j * gw] = 0; F[j * gw + gw - 1] = 0; }
  const rings = contours(F, gw, gh, 0.5).rings.map(r => r.map((v, i) => (v + 0.5) * k)).filter(r => r.length >= 8);
  return { grid: { w: gw, h: gh, k, x0: 0, y0: 0, data }, rings };
}
