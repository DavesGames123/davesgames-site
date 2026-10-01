// svg2fold.mjs -- convert an SVG (or ORIPA .opx) crease pattern to a planar FOLD file.
//
// Run: node tools/svg2fold.mjs in.svg out.fold [--title T] [--author A] [--source S]
//
// Two SVG colour conventions are read. Origami Simulator (A. Ghassaei) uses the
// stroke colour for the kind and the opacity for the fold angle:
//   black border, red mountain, blue valley, yellow facet, magenta hinge,
//   green cut. A mountain or valley folds to opacity * 180 degrees.
// flat-folder (J. S. Ku) adds gray for a flat (auxiliary) line.
// A hinge becomes U (it does not fold here). A cut has no kind on this page, so
// a pattern with cuts is refused unless --allow-cuts is given.
//
// The converter reads line, polyline, polygon, rect and path elements, with
// group transforms and inherited stroke and opacity. A curve segment in a path
// is cut into straight chords. ORIPA .opx files are read from their
// OriLineProxy records (type 0 aux, 1 border, 2 mountain, 3 valley).
//
// After the parse, every crease is clipped to the border when the border is a
// convex polygon, the pattern is fit into the centred unit square, and
// planarize.js splits every crossing and T-junction. The output is the same
// planar FOLD graph that the page builds from a preset. edges_foldAngle keeps
// the SVG angle. The page sim reads only the kind, so the angle is data only.
//
// grep map:
//   parseSvg      -- the tag walk: transforms, styles, elements to segments
//   parsePath     -- the path data commands
//   kindOf        -- stroke colour to a FOLD letter
//   parseOpx      -- ORIPA XML to segments
//   clipToBorder  -- clip creases to a convex border loop
//   convert       -- text to a FOLD object (the export the import tool uses)

import { readFile, writeFile } from 'node:fs/promises';
import { CreasePattern } from '../model.js';
import { planarize } from '../planarize.js';
import { toFold } from '../foldio.js';

// ── colours ─────────────────────────────────────────────────────────────────
const NAMED = {
  black: '#000000', red: '#ff0000', blue: '#0000ff', green: '#00ff00', lime: '#00ff00',
  yellow: '#ffff00', magenta: '#ff00ff', fuchsia: '#ff00ff', gray: '#808080', grey: '#808080',
};

// A CSS colour as #rrggbb, or null.
function hex(c) {
  if (!c) return null;
  c = c.trim().toLowerCase().replace(/\s+/g, '');
  if (NAMED[c]) return NAMED[c];
  let m = c.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (m) return '#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3];
  if (/^#[0-9a-f]{6}$/.test(c)) return c;
  m = c.match(/^rgb\((\d+),(\d+),(\d+)\)$/);
  if (m) return '#' + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('');
  return null;
}

// The FOLD letter for a stroke colour. C is a cut. null is an unknown colour.
export function kindOf(stroke) {
  switch (hex(stroke)) {
    case '#000000': return 'B';
    case '#ff0000': return 'M';
    case '#0000ff': return 'V';
    case '#00ff00': return 'C';
    case '#ffff00': return 'F';
    case '#808080': return 'F';
    case '#ff00ff': return 'U';
    default: return null;
  }
}

// ── affine transforms, as [a, b, c, d, e, f] (the SVG matrix order) ──────────
const ID = [1, 0, 0, 1, 0, 0];
function mul(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
function apply(m, p) { return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]; }
function parseTransform(s) {
  let m = ID;
  if (!s) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let t;
  while ((t = re.exec(s))) {
    const a = t[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let n = ID;
    switch (t[1]) {
      case 'matrix': n = a.slice(0, 6); break;
      case 'translate': n = [1, 0, 0, 1, a[0] || 0, a[1] || 0]; break;
      case 'scale': n = [a[0], 0, 0, a.length > 1 ? a[1] : a[0], 0, 0]; break;
      case 'rotate': {
        const r = (a[0] || 0) * Math.PI / 180, c = Math.cos(r), s2 = Math.sin(r);
        n = [c, s2, -s2, c, 0, 0];
        if (a.length >= 3) n = mul(mul([1, 0, 0, 1, a[1], a[2]], n), [1, 0, 0, 1, -a[1], -a[2]]);
        break;
      }
      case 'skewX': n = [1, 0, Math.tan(a[0] * Math.PI / 180), 1, 0, 0]; break;
      case 'skewY': n = [1, Math.tan(a[0] * Math.PI / 180), 0, 1, 0, 0]; break;
    }
    m = mul(m, n);
  }
  return m;
}

// ── the tag walk ────────────────────────────────────────────────────────────
function attrsOf(s) {
  const out = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(s))) out[m[1]] = m[3] !== undefined ? m[3] : m[4];
  return out;
}
function styleOf(s) {
  const out = {};
  if (!s) return out;
  for (const part of s.split(';')) {
    const i = part.indexOf(':');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
// Simple `.name { stroke: ... }` rules from <style> blocks.
function cssRules(text) {
  const rules = {};
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(text))) {
    const decl = styleOf(m[2]);
    for (const sel of m[1].split(',')) {
      const s = sel.trim();
      if (/^\.[\w-]+$/.test(s)) rules[s.slice(1)] = Object.assign(rules[s.slice(1)] || {}, decl);
    }
  }
  return rules;
}

const num = (x, d = 0) => { const v = parseFloat(x); return Number.isFinite(v) ? v : d; };

// Parse an SVG text into segments: { a, b, kind, opacity }.
export function parseSvg(text) {
  const warn = new Set();
  text = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  let css = {};
  for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) Object.assign(css, cssRules(m[1]));
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '');

  const segs = [];
  // Inherited state per open group.
  const stack = [{ m: ID, stroke: null, opacity: 1, sopacity: 1, hidden: false, skip: false }];
  const re = /<(\/?)([\w:-]+)([^>]*?)(\/?)>/g;
  let t;
  while ((t = re.exec(text))) {
    const [, close, tag, rest, selfClose] = t;
    if (close) { if (stack.length > 1) stack.pop(); continue; }
    if (tag.startsWith('?') || tag.startsWith('!')) continue;
    const a = attrsOf(rest);
    const st = styleOf(a.style);
    const cls = (a.class || '').split(/\s+/).filter(Boolean).reduce((o, c) => Object.assign(o, css[c] || {}), {});
    const top = stack[stack.length - 1];
    const pick = (k) => (st[k] !== undefined ? st[k] : a[k] !== undefined ? a[k] : cls[k]);
    const s = {
      m: mul(top.m, parseTransform(a.transform)),
      stroke: pick('stroke') !== undefined ? pick('stroke') : top.stroke,
      opacity: top.opacity * num(pick('opacity'), 1),
      sopacity: pick('stroke-opacity') !== undefined ? num(pick('stroke-opacity'), 1) : top.sopacity,
      hidden: top.hidden || pick('display') === 'none' || pick('visibility') === 'hidden',
      skip: top.skip || ['defs', 'metadata', 'clipPath', 'mask', 'symbol', 'pattern', 'marker'].includes(tag.replace(/^svg:/, '')),
    };
    if (!selfClose) stack.push(s);
    if (s.hidden || s.skip) continue;
    const name = tag.replace(/^svg:/, '');
    const pts = [];      // polylines in local coordinates
    switch (name) {
      case 'line': pts.push([[num(a.x1), num(a.y1)], [num(a.x2), num(a.y2)]]); break;
      case 'polyline': case 'polygon': {
        const v = (a.points || '').trim().split(/[\s,]+/).map(Number);
        const p = [];
        for (let i = 0; i + 1 < v.length; i += 2) p.push([v[i], v[i + 1]]);
        if (name === 'polygon' && p.length) p.push(p[0]);
        pts.push(p);
        break;
      }
      case 'rect': {
        const x = num(a.x), y = num(a.y), w = num(a.width), h = num(a.height);
        pts.push([[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]);
        break;
      }
      case 'path': for (const p of parsePath(a.d || '', warn)) pts.push(p); break;
      default: continue;
    }
    if (!s.stroke || s.stroke === 'none') { warn.add(`a <${name}> without a stroke was skipped`); continue; }
    const kind = kindOf(s.stroke);
    if (!kind) { warn.add(`unknown stroke ${s.stroke} read as U`); }
    const opacity = s.opacity * s.sopacity;
    for (const p of pts) {
      for (let i = 0; i + 1 < p.length; i++) {
        segs.push({ a: apply(s.m, p[i]), b: apply(s.m, p[i + 1]), kind: kind || 'U', opacity });
      }
    }
  }
  return { segs, warnings: [...warn] };
}

// Path data to polylines. Curves are cut into eight chords each.
export function parsePath(d, warn) {
  const out = [];
  const tok = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
  let i = 0, cmd = null;
  let cur = [0, 0], start = [0, 0], line = null, lastCtl = null;
  const isCmd = (x) => /^[a-zA-Z]$/.test(x);
  const n = () => Number(tok[i++]);
  const flush = () => { if (line && line.length > 1) out.push(line); line = null; };
  const to = (p) => { if (!line) line = [cur.slice()]; line.push(p); cur = p; };
  const curve = (pts) => {
    const k = 8;
    for (let s = 1; s <= k; s++) {
      const u = s / k;
      let q = pts.map((p) => p.slice());
      while (q.length > 1) q = q.slice(1).map((p, j) => [q[j][0] + (p[0] - q[j][0]) * u, q[j][1] + (p[1] - q[j][1]) * u]);
      to(q[0]);
    }
  };
  while (i < tok.length) {
    if (isCmd(tok[i])) cmd = tok[i++];
    else if (cmd === null) { i++; continue; }
    const rel = cmd === cmd.toLowerCase();
    const off = (p) => (rel ? [cur[0] + p[0], cur[1] + p[1]] : p);
    switch (cmd.toUpperCase()) {
      case 'M': { flush(); cur = off([n(), n()]); start = cur.slice(); line = [cur.slice()]; cmd = rel ? 'l' : 'L'; lastCtl = null; break; }
      case 'L': to(off([n(), n()])); lastCtl = null; break;
      case 'H': { const x = n(); to([rel ? cur[0] + x : x, cur[1]]); lastCtl = null; break; }
      case 'V': { const y = n(); to([cur[0], rel ? cur[1] + y : y]); lastCtl = null; break; }
      case 'Z': to(start.slice()); flush(); cur = start.slice(); line = null; lastCtl = null; break;
      case 'C': { const c1 = off([n(), n()]), c2 = off([n(), n()]), p = off([n(), n()]); warn.add('curves were cut into chords'); curve([cur, c1, c2, p]); lastCtl = c2; break; }
      case 'S': {
        const c1 = lastCtl ? [2 * cur[0] - lastCtl[0], 2 * cur[1] - lastCtl[1]] : cur.slice();
        const c2 = off([n(), n()]), p = off([n(), n()]); warn.add('curves were cut into chords'); curve([cur, c1, c2, p]); lastCtl = c2; break;
      }
      case 'Q': { const c = off([n(), n()]), p = off([n(), n()]); warn.add('curves were cut into chords'); curve([cur, c, p]); lastCtl = c; break; }
      case 'T': { const c = lastCtl ? [2 * cur[0] - lastCtl[0], 2 * cur[1] - lastCtl[1]] : cur.slice(); const p = off([n(), n()]); curve([cur, c, p]); lastCtl = c; break; }
      case 'A': { n(); n(); n(); n(); n(); const p = off([n(), n()]); warn.add('arcs were read as chords'); to(p); lastCtl = null; break; }
      default: i++;
    }
  }
  flush();
  return out;
}

// ── ORIPA ───────────────────────────────────────────────────────────────────
// ORIPA writes a java.beans XML file. A property equal to its default (0) is
// left out, so every coordinate and the type start at 0.
export function parseOpx(text) {
  const segs = [];
  const KIND = ['F', 'B', 'M', 'V'];
  const re = /<object class="oripa\.OriLineProxy">([\s\S]*?)<\/object>/g;
  let m;
  while ((m = re.exec(text))) {
    const v = { type: 0, x0: 0, y0: 0, x1: 0, y1: 0 };
    for (const p of m[1].matchAll(/<void property="(\w+)">\s*<(?:double|int)>([^<]*)<\/(?:double|int)>/g)) v[p[1]] = Number(p[2]);
    // ORIPA has y down, as SVG has.
    segs.push({ a: [v.x0, v.y0], b: [v.x1, v.y1], kind: KIND[v.type] || 'U', opacity: 1 });
  }
  return { segs, warnings: [] };
}

// ── clip to the border ──────────────────────────────────────────────────────
// Chain the border segments into one loop. Return the loop if it is convex.
function convexBorder(segs, eps) {
  const b = segs.filter((s) => s.kind === 'B');
  if (b.length < 3) return null;
  const same = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < eps;
  // Take the border vertices and their convex hull. The loop is convex when
  // every border endpoint lies on the hull boundary.
  const pts = [];
  for (const s of b) for (const p of [s.a, s.b]) if (!pts.some((q) => same(p, q))) pts.push(p);
  const hull = convexHull(pts);
  const onHull = (p) => hull.some((h, i) => distToSeg(p, h, hull[(i + 1) % hull.length]) < eps);
  return pts.every(onHull) ? hull : null;
}
function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function distToSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy || 1e-30;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
}
// Cyrus-Beck: clip each non-border segment to a convex CCW loop.
export function clipToBorder(segs, eps) {
  const hull = convexBorder(segs, eps);
  if (!hull) return { segs, clipped: 0, convex: false };
  let clipped = 0;
  const out = [];
  for (const s of segs) {
    if (s.kind === 'B') { out.push(s); continue; }
    let t0 = 0, t1 = 1;
    const d = [s.b[0] - s.a[0], s.b[1] - s.a[1]];
    let keep = true;
    for (let i = 0; i < hull.length && keep; i++) {
      const p = hull[i], q = hull[(i + 1) % hull.length];
      const nrm = [-(q[1] - p[1]), q[0] - p[0]];       // inward for a CCW loop
      const len = Math.hypot(nrm[0], nrm[1]) || 1;
      const num0 = ((s.a[0] - p[0]) * nrm[0] + (s.a[1] - p[1]) * nrm[1]) / len + eps;
      const den = (d[0] * nrm[0] + d[1] * nrm[1]) / len;
      if (Math.abs(den) < 1e-15) { if (num0 < 0) keep = false; continue; }
      const t = -num0 / den;
      if (den > 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
      if (t0 > t1) keep = false;
    }
    if (!keep) { clipped++; continue; }
    if (t0 > 1e-9 || t1 < 1 - 1e-9) clipped++;
    const at = (t) => [s.a[0] + d[0] * t, s.a[1] + d[1] * t];
    out.push({ ...s, a: at(t0), b: at(t1) });
  }
  return { segs: out, clipped, convex: true };
}

// ── convert ─────────────────────────────────────────────────────────────────
// Text to a planar FOLD object. `kind` is 'svg' or 'opx'. Throws when the
// pattern has cuts and opts.allowCuts is not set.
export function convert(text, kind, opts = {}) {
  const parsed = kind === 'opx' ? parseOpx(text) : parseSvg(text);
  let segs = parsed.segs.filter((s) => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) > 0);
  const warnings = parsed.warnings.slice();
  const cuts = segs.filter((s) => s.kind === 'C').length;
  if (cuts && !opts.allowCuts) throw new Error(`${cuts} cut lines: this page has no cut kind`);
  segs = segs.filter((s) => s.kind !== 'C');
  if (!segs.length) throw new Error('no creases found');

  // Fit the bounds of the border (or of all lines) into the unit square.
  const box = (list) => {
    let lx = Infinity, ly = Infinity, hx = -Infinity, hy = -Infinity;
    for (const s of list) for (const p of [s.a, s.b]) { lx = Math.min(lx, p[0]); ly = Math.min(ly, p[1]); hx = Math.max(hx, p[0]); hy = Math.max(hy, p[1]); }
    return [lx, ly, hx, hy];
  };
  const border = segs.filter((s) => s.kind === 'B');
  const [lx, ly, hx, hy] = box(border.length >= 3 ? border : segs);
  const ext = Math.max(hx - lx, hy - ly) || 1;
  const cx = (lx + hx) / 2, cy = (ly + hy) / 2;
  // SVG y runs down. Flip it so the pattern reads the same way up.
  const fit = (p) => [(p[0] - cx) / ext, -(p[1] - cy) / ext];
  segs = segs.map((s) => ({ ...s, a: fit(s.a), b: fit(s.b) }));

  const clip = clipToBorder(segs, 1e-6);
  segs = clip.segs;
  if (clip.clipped) warnings.push(`${clip.clipped} creases were clipped to the border`);
  if (!clip.convex && border.length) warnings.push('the border is not convex: nothing was clipped');

  // Snap a loose end onto a line it nearly meets. Drawing tools leave ends a
  // few ten-thousandths short of the border. planarize joins only within
  // 1e-5, and a loose end leaves a face open, so the sim would lose that face.
  const SNAP = 1e-3;
  let snapped = 0;
  for (const s of segs) {
    for (const end of ['a', 'b']) {
      const p = s[end];
      let best = null, bd = SNAP;
      for (const t of segs) {
        if (t === s) continue;
        for (const q of [t.a, t.b]) { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = q.slice(); } }
      }
      if (!best) {
        for (const t of segs) {
          if (t === s) continue;
          const d = distToSeg(p, t.a, t.b);
          if (d > 1e-9 && d < bd) {
            const dx = t.b[0] - t.a[0], dy = t.b[1] - t.a[1];
            const u = Math.max(0, Math.min(1, ((p[0] - t.a[0]) * dx + (p[1] - t.a[1]) * dy) / (dx * dx + dy * dy)));
            bd = d; best = [t.a[0] + dx * u, t.a[1] + dy * u];
          }
        }
      }
      if (best && (best[0] !== p[0] || best[1] !== p[1])) { s[end] = best; snapped++; }
    }
  }
  if (snapped) warnings.push(`${snapped} loose ends were snapped onto a line`);

  const cp = new CreasePattern();
  for (const s of segs) cp.addCrease(s.a, s.b, s.kind);
  const p = planarize(cp);
  // Recover each sub-crease's SVG angle from the source line it lies on.
  p.foldAngle = p.edges.map((e, i) => {
    const k = p.assignment[i];
    if (k !== 'M' && k !== 'V') return 0;
    const a = p.vertices[e[0]], b = p.vertices[e[1]];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let best = null, bd = Infinity;
    for (const s of segs) {
      if (s.kind !== k) continue;
      const d = distToSeg(mid, s.a, s.b);
      if (d < bd) { bd = d; best = s; }
    }
    const op = best ? Math.max(0, Math.min(1, best.opacity)) : 1;
    return Math.round((k === 'M' ? -180 : 180) * op * 1000) / 1000;
  });
  const fold = toFold(p);
  fold.file_creator = 'svg2fold (davesgames origami page)';
  if (opts.title) fold.file_title = opts.title;
  if (opts.author) fold.file_author = opts.author;
  if (opts.source) fold.file_source = opts.source;
  // Round the coordinates: f32 noise is not data, and it bloats the file.
  fold.vertices_coords = fold.vertices_coords.map((v) => v.map((x) => Math.round(x * 1e7) / 1e7));
  delete fold.faces_vertices;
  return { fold, warnings, faces: p.faces.length };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const allowCuts = args.includes('--allow-cuts');
  if (allowCuts) args.splice(args.indexOf('--allow-cuts'), 1);
  const title = opt('--title'), author = opt('--author'), source = opt('--source');
  const [inp, out] = args;
  if (!inp || !out) { console.error('usage: node tools/svg2fold.mjs in.svg|in.opx out.fold [--title T] [--author A] [--source S] [--allow-cuts]'); process.exit(2); }
  const kind = inp.toLowerCase().endsWith('.opx') ? 'opx' : 'svg';
  const r = convert(await readFile(inp, 'utf8'), kind, { title, author, source, allowCuts });
  await writeFile(out, JSON.stringify(r.fold) + '\n');
  console.log(`${out}: ${r.fold.vertices_coords.length} vertices, ${r.fold.edges_vertices.length} edges, ${r.faces} faces`);
  for (const w of r.warnings) console.log(`  note: ${w}`);
}
