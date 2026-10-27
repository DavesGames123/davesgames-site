// ============================================================================
//  MUSHROOM DRAW  ·  engine/flatten.js — painter order, hidden lines, flat arrays
// ----------------------------------------------------------------------------
//  Original code (davesgames.io). No DOM. flatten(groups, capR, nBodies)
//  takes the item groups of buildSpecimen() in engine.js, sorted back to
//  front. It numbers the items in painter order, cuts each line where a
//  later fill covers it (hideLines in geom.js), simplifies the lines
//  (rdp) and packs them into flat typed arrays. capR sets the clip step
//  and the simplify tolerance. The result holds xy, offs, lens, total,
//  kinds, part, order, washes, bbox and stats, plus occs and vis (the
//  fills and the clipped lines, for opts.debug).
//
//  GREP MAP
//    grep -n 'export function flatten'   the whole pass
//    grep -n 'Draw-on order'             the line sort
//    grep -n 'Flatten.'                  the typed arrays and the bbox
// ============================================================================
import { hideLines, rdp } from '../geom.js';
import { PIDX } from './items.js';

export function flatten(groups, capR, nBodies) {
  // Painter order, then hidden lines.
  let ord = 0;
  const lines = [], occs = [], washes = [];
  for (const g of groups) for (const it of g.items) {
    const o = ord++;
    for (const l of it.lines) lines.push({ pts: l.pts, kind: l.kind, part: l.part, ord: o });
    if (it.fill && it.fill.length > 2) occs.push({ poly: it.fill, ord: o });
    for (const w of it.washes) if (w.pts.length > 2) washes.push({ pts: w.pts, color: w.color, part: it.part });
  }
  const step = Math.max(0.3, capR * 0.005);
  const vis = hideLines(lines, occs, step, step * 0.8);
  const eps = Math.max(0.03, capR * 0.0006);
  const polys = [];
  for (const l of vis) {
    const pts = rdp(l.pts, eps);
    if (pts.length > 1) polys.push({ pts, kind: l.kind, part: l.part, ord: l.ord });
  }
  // Draw-on order: outlines, details, hatching, ground; painter order inside.
  polys.sort((a, b) => a.kind - b.kind || a.ord - b.ord);

  // Flatten.
  let n = 0;
  for (const p of polys) n += p.pts.length;
  const xy = new Float64Array(n * 2), offs = new Uint32Array(polys.length + 1), lens = new Float64Array(polys.length);
  const kinds = new Uint8Array(polys.length), part = new Uint8Array(polys.length);
  let k = 0, total = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  polys.forEach((p, i) => {
    offs[i] = k; kinds[i] = p.kind; part[i] = PIDX[p.part] ?? 0;
    let L = 0;
    for (let j = 0; j < p.pts.length; j++) {
      const x = p.pts[j][0], y = p.pts[j][1];
      xy[k * 2] = x; xy[k * 2 + 1] = y; k++;
      grow(x, y);
      if (j) L += Math.hypot(x - p.pts[j - 1][0], y - p.pts[j - 1][1]);
    }
    lens[i] = L; total += L;
  });
  offs[polys.length] = k;
  const wout = washes.map(w => {
    const a = new Float64Array(w.pts.length * 2);
    w.pts.forEach((q, i) => { a[i * 2] = q[0]; a[i * 2 + 1] = q[1]; grow(q[0], q[1]); });
    return { xy: a, color: w.color, part: w.part };
  });
  const order = new Uint32Array(polys.length);
  for (let i = 0; i < polys.length; i++) order[i] = i;
  const stats = { lines: polys.length, points: n, bodies: nBodies, items: ord, occluders: occs.length, washes: wout.length, perPart: {} };
  for (const p of polys) stats.perPart[p.part] = (stats.perPart[p.part] || 0) + 1;
  return { occs, vis, xy, offs, lens, total, kinds, part, order, washes: wout, bbox: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, stats };
}
