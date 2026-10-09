// ============================================================================
//  MUSHROOM DRAW  ·  treedraw.js — the tree of life on a canvas and as SVG
// ----------------------------------------------------------------------------
//  Original code (davesgames.io), adapted from fishdraw/treedraw.js on this
//  site with the two fixes of e34c4c8 built in: each mushroom fits its box
//  by its own bbox (fitBox), and the pen is a share of the box width
//  (TREE_PEN), as thin as the main view. The layout comes from tree.js in
//  plate mm. Every draw strokes branches and mushrooms as vectors through
//  the view transform (render.js drawSpec), so a zoom stays sharp.
//
//  drawTree(ctx, P). P:
//    tree, lay      the model and its layout (mm)
//    view           { s, ox, oy }: device px per mm and the origin
//    theme, ink, style, pen (mm, the most), jitter, dpr
//    tau            the growth time; T_MAX * GROW_OVER draws all of it
//    specFor(id)    the built specimen of a node, or null (not built yet)
//    anc            true draws the ancestor mushrooms at internal nodes
//    names          true writes the names (italic) under the mushrooms
//    back, paper    true puts a paper card of colour paper under each one
//    sel            a node id or -1; line: a Set of the ids of its lineage
//    ancOnly        a Set of internal ids that show when anc is false
//  Growth: the elbow of a branch shows when its parent exists, the run grows
//  from the parent time to the node time. At the growing end a small
//  mushroom fades from the parent form to the child form. A node mushroom
//  is drawn on by the pen in the DRAW_T time units after its node time.
//
//  GREP MAP
//    grep -n 'export function drawTree'     the canvas draw
//    grep -n 'function drawBox'             one mushroom in a box
//    grep -n 'export function fitBox'       a specimen fitted by its bbox
//    grep -n 'export function treeSVG'      the SVG elements
//    grep -n 'export function hitTree'      the node under a plate point
// ============================================================================
import { T_MAX, maAgo } from './tree.js';
import { drawSpec, labelFont, SERIF } from './render.js';
import { isDark } from './plate.js';
import { specSVG, xmlEscape } from './svg.js';

export const DRAW_T = T_MAX * 0.07;
export const GROW_OVER = 1 + 0.07 + 0.02;
export const hiColor = theme => (isDark(theme) ? '#ffcf5a' : '#b3412e');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// The fit of specimen f in box (mm): by its bbox, at FIT of the box,
// centred, aspect kept. { k (mm per unit), ox, oy } as plate.js fitSpec.
export const FIT = 0.94;
// The pen of a tree mushroom as a share of its box width. The main view
// draws a mushroom about 220 mm wide with a 0.3 mm pen (0.0014).
export const TREE_PEN = 0.0015;
export function fitBox(f, box, fill = FIT) {
  const b = f && f.bbox && f.bbox.w > 0 && f.bbox.h > 0 ? f.bbox : { x: -50, y: -100, w: 100, h: 100 };
  const k = Math.min(box.w / b.w, box.h / b.h) * fill;
  return { k, ox: box.x + box.w / 2 - (b.x + b.w / 2) * k, oy: box.y + box.h / 2 - (b.y + b.h / 2) * k };
}
export const boxPen = (box, pen) => clamp(box.w * TREE_PEN, 0.015, pen);

function backing(ctx, box, P, alpha) {
  const s = P.view.s, x = P.view.ox + box.x * s, y = P.view.oy + box.y * s, w = box.w * s, h = box.h * s;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 0.86 * alpha; ctx.fillStyle = P.paper;
  const r = Math.min(w, h) * 0.14, px = w * 0.04, py = h * 0.05;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x - px, y - py, w + px * 2, h + py * 2, r); else ctx.rect(x - px, y - py, w + px * 2, h + py * 2);
  ctx.fill();
  ctx.restore();
}
// ── drawBox ─────────────────────────────────────────────────────────────────
function drawBox(ctx, f, box, P, alpha, prog) {
  const s = P.view.s, bx = P.view.ox + box.x * s, by = P.view.oy + box.y * s;
  if (bx > ctx.canvas.width || by > ctx.canvas.height || bx + box.w * s < 0 || by + box.h * s < 0) return;
  if (box.w * s < 3) return;
  if (P.back && P.paper) backing(ctx, box, P, alpha);
  const pen = Math.max(boxPen(box, P.pen), 0.3 * (P.dpr || 1) / s);
  ctx.save();
  ctx.globalAlpha = alpha;
  drawSpec(ctx, f, fitBox(f, box), P.view, { theme: P.theme, ink: P.ink, style: P.style || 'pen', pen, jitter: P.jitter || 0,
    prog: prog == null || prog >= 1 ? null : f.total * prog, marker: false, dpr: P.dpr, washMin: pen });
  ctx.restore();
}

// ── drawTree ────────────────────────────────────────────────────────────────
export function drawTree(ctx, P) {
  const { tree, lay, view, theme } = P, s = view.s, nodes = tree.nodes, dpr = P.dpr || 1;
  const ink = P.ink || theme.ink, hi = hiColor(theme), tau = P.tau == null ? T_MAX * GROW_OVER : P.tau;
  const X = v => view.ox + v * s, Y = v => view.oy + v * s;
  const line = P.line || new Set();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.fillStyle = ink; ctx.strokeStyle = ink;
  // Eras and the time axis (paper layouts only; the natural layout has none).
  const showEras = P.xMode !== 'change' && !lay.natural;
  if (!lay.natural && lay.kind === 'clado') {
    const top = Y(lay.top), bot = Y(lay.bottom), ax = Y(lay.axisY);
    let lastMa = -Infinity;
    if (showEras) tree.eras.forEach((e, i) => {
      const x0 = X(lay.xOf(e.t0)), x1 = X(lay.xOf(e.t1));
      ctx.globalAlpha = i % 2 ? 0.05 : 0.025; ctx.fillRect(x0, top, x1 - x0, bot - top);
      ctx.globalAlpha = 0.75;
      const fs = Math.min(lay.axisH * 0.3, (lay.xOf(e.t1) - lay.xOf(e.t0)) * 0.16) * s;
      if (fs > 5) { ctx.font = labelFont(fs, 'italic'); ctx.textAlign = 'center'; ctx.fillText(e.name, (x0 + x1) / 2, ax + fs * 2.6); }
      const ts = lay.axisH * 0.2 * s;
      if (ts > 5) {
        ctx.font = labelFont(ts, 'normal'); ctx.textAlign = 'center'; ctx.globalAlpha = 0.6;
        const txt = maAgo(e.t0) + ' Ma', tw = ctx.measureText(txt).width;
        if (x0 - tw / 2 > lastMa + ts * 0.6) { ctx.fillText(txt, x0, ax + ts * 1.5); lastMa = x0 + tw / 2; }
      }
    });
    ctx.globalAlpha = 0.6; ctx.lineWidth = Math.max(1, P.pen * 0.6 * s);
    ctx.beginPath(); ctx.moveTo(X(lay.x0), ax); ctx.lineTo(X(lay.x1), ax); ctx.stroke();
    if (tau < T_MAX) {
      ctx.globalAlpha = 0.5; ctx.strokeStyle = hi; ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath(); ctx.moveTo(X(lay.xOf(tau)), top); ctx.lineTo(X(lay.xOf(tau)), ax); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = ink;
    }
  } else if (!lay.natural) {
    const ringAt = (t, dash, alpha, color) => {
      const r = lay.rOf(t) * s;
      ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.setLineDash(dash);
      ctx.beginPath();
      if (lay.fan) ctx.arc(X(lay.cx), Y(lay.cy), r, lay.a0, lay.a0 + lay.span); else ctx.arc(X(lay.cx), Y(lay.cy), r, 0, Math.PI * 2);
      ctx.stroke(); ctx.setLineDash([]);
    };
    ctx.lineWidth = Math.max(0.6, P.pen * 0.5 * s);
    if (showEras) tree.eras.forEach((e, i) => { if (i) ringAt(e.t0, [2 * dpr, 5 * dpr], 0.3, ink); });
    if (tau < T_MAX) ringAt(tau, [4 * dpr, 4 * dpr], 0.5, hi);
  }
  ctx.globalAlpha = 1; ctx.strokeStyle = ink;

  // Branches: thin and a little faded in the natural layout, so the
  // mushrooms lead; a lineage is thicker, in the highlight colour.
  const bw = lay.natural ? Math.max(0.55 * dpr, P.pen * 0.6 * s) : Math.max(0.6 * dpr, P.pen * 1.2 * s);
  const quiet = lay.natural ? 0.6 : 1, grow = [];
  for (const q of nodes) {
    if (q.parent < 0) continue;
    const p = nodes[q.parent];
    if (tau < p.t) continue;
    const b = lay.branch[q.id];
    const frac = q.t > p.t ? clamp((tau - p.t) / (q.t - p.t), 0, 1) : 1;
    const on = line.has(q.id), extinct = q.kind === 'extinct';
    ctx.globalAlpha = on ? 1 : (extinct ? 0.45 : 1) * quiet;
    ctx.strokeStyle = on ? hi : ink;
    ctx.lineWidth = on ? bw * 2.6 : bw;
    ctx.setLineDash(extinct ? [bw * 2.5, bw * 2.5] : []);
    ctx.beginPath();
    ctx.moveTo(X(b.elbow[0][0]), Y(b.elbow[0][1]));
    for (let i = 1; i < b.elbow.length; i++) ctx.lineTo(X(b.elbow[i][0]), Y(b.elbow[i][1]));
    const [a0, a1] = b.run, ex = a0[0] + (a1[0] - a0[0]) * frac, ey = a0[1] + (a1[1] - a0[1]) * frac;
    ctx.moveTo(X(a0[0]), Y(a0[1])); ctx.lineTo(X(ex), Y(ey));
    ctx.stroke();
    if (frac < 1) grow.push({ q, p, frac, x: ex, y: ey });
  }
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  // Split dots and radiation rings.
  for (const q of nodes) {
    if (q.kind !== 'split' || tau < q.t || (lay.natural && (P.anc || (P.ancOnly && P.ancOnly.has(q.id))))) continue;
    const r = bw * (q.radiation ? 2.2 : 1.3), px = X(lay.pos[q.id].x), py = Y(lay.pos[q.id].y);
    ctx.fillStyle = line.has(q.id) ? hi : ink;
    ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
    if (q.radiation) { ctx.strokeStyle = hi; ctx.lineWidth = bw * 0.7; ctx.beginPath(); ctx.arc(px, py, r * 2.2, 0, Math.PI * 2); ctx.stroke(); }
  }
  // Mushrooms at the nodes, names in italics under them.
  for (const q of nodes) {
    const box = lay.box[q.id];
    if (!box || tau < q.t) continue;
    if (box.anc && !P.anc && q.id !== P.sel && !(P.ancOnly && P.ancOnly.has(q.id))) continue;
    const f = P.specFor(q.id), prog = clamp((tau - q.t) / DRAW_T, 0, 1);
    const alpha = q.kind === 'extinct' ? 0.5 : box.anc ? 0.9 : 1;
    if (f) drawBox(ctx, f, box, P, alpha, prog);
    if ((!box.anc || lay.natural) && P.names !== false && prog > 0.2) {
      const fs = box.w * (box.anc ? 0.1 : 0.085) * s;
      if (fs >= 6) {
        ctx.globalAlpha = q.kind === 'extinct' ? 0.55 : box.anc ? 0.7 : 0.92;
        ctx.fillStyle = line.has(q.id) && box.anc ? hi : (theme.text || ink);
        ctx.font = labelFont(fs, 'italic'); ctx.textAlign = 'center';
        ctx.fillText((q.kind === 'extinct' ? '† ' : '') + q.name, X(box.x + box.w / 2), Y(box.y + box.h) + fs * 0.95);
        ctx.globalAlpha = 1;
      }
    }
  }
  // Growing ends: the parent form fades into the child form.
  if (grow.length <= 48) for (const g of grow) {
    const fa = P.specFor(g.p.id), fb = P.specFor(g.q.id);
    const w = lay.natural ? lay.anc.w : lay.tip.w * 0.5, h = w * (lay.tip.h / lay.tip.w);
    const box = lay.kind === 'clado' ? { x: g.x + w * 0.08, y: g.y - h / 2, w, h } : { x: g.x - w / 2, y: g.y - h / 2, w, h };
    if (fa) drawBox(ctx, fa, box, Object.assign({}, P, { back: false }), 0.85 * (1 - g.frac), null);
    if (fb) drawBox(ctx, fb, box, Object.assign({}, P, { back: false }), 0.85 * g.frac, null);
  }
  if (P.sel >= 0 && lay.box[P.sel]) {
    const b = lay.box[P.sel], pad = b.h * 0.06;
    ctx.strokeStyle = hi; ctx.lineWidth = Math.max(1, bw * 0.9); ctx.globalAlpha = 0.9;
    ctx.strokeRect(X(b.x - pad), Y(b.y - pad), (b.w + pad * 2) * s, (b.h + pad * 2) * s);
  }
  ctx.restore();
}

// ── hitTree ─────────────────────────────────────────────────────────────────
// The node under plate point (x, y) in mm: a box first, then a node dot or
// a branch run within tol mm. -1 when none.
export function hitTree(tree, lay, x, y, tol, anc = true) {
  let best = -1, bd = Infinity;
  for (const q of tree.nodes) {
    const b = lay.box[q.id];
    if (b && (!b.anc || anc) && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return q.id;
  }
  for (const q of tree.nodes) {
    const p = lay.pos[q.id], d = Math.hypot(p.x - x, p.y - y);
    if (d < tol && d < bd) { bd = d; best = q.id; }
    const br = lay.branch[q.id];
    if (br) {
      const [a, b] = br.run, vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy || 1;
      const t = clamp(((x - a[0]) * vx + (y - a[1]) * vy) / L2, 0, 1);
      const e = Math.hypot(a[0] + vx * t - x, a[1] + vy * t - y);
      if (e < tol * 0.7 && e < bd) { bd = e; best = q.id; }
    }
  }
  return best;
}

// ── treeSVG ─────────────────────────────────────────────────────────────────
// SVG elements (a string) of the grown tree, in mm. o: { theme, ink, style,
// pen, jitter, anc, names, line (Set) }.
export function treeSVG(tree, lay, o, specFor) {
  const t = o.theme, ink = o.ink || t.ink, hi = hiColor(t), n3 = v => (Math.round(v * 1000) / 1000).toString();
  const font = xmlEscape(SERIF.replace(/"/g, "'")), out = ['<g id="tree">'];
  const bw = o.pen * (lay.natural ? 0.6 : 1.2), line = o.line || new Set();
  for (const q of tree.nodes) {
    if (q.parent < 0) continue;
    const b = lay.branch[q.id];
    const d = 'M' + b.elbow.map(p => n3(p[0]) + ' ' + n3(p[1])).join('L') + 'M' + b.run.map(p => n3(p[0]) + ' ' + n3(p[1])).join('L');
    const on = line.has(q.id), ext = q.kind === 'extinct';
    out.push(`<path d="${d}" fill="none" stroke="${on ? hi : ink}" stroke-width="${n3(on ? bw * 2.2 : bw)}" stroke-linecap="round" stroke-linejoin="round"${ext ? ` stroke-opacity="0.45" stroke-dasharray="${n3(bw * 2.5)} ${n3(bw * 2.5)}"` : ''}/>`);
  }
  for (const q of tree.nodes) {
    if (q.kind !== 'split' || (lay.natural && o.anc)) continue;
    out.push(`<circle cx="${n3(lay.pos[q.id].x)}" cy="${n3(lay.pos[q.id].y)}" r="${n3(bw * (q.radiation ? 2.2 : 1.3))}" fill="${line.has(q.id) ? hi : ink}"/>`);
  }
  for (const q of tree.nodes) {
    const box = lay.box[q.id], f = specFor(q.id);
    if (!box || (box.anc && !o.anc)) continue;
    if (f) {
      out.push(`<rect x="${n3(box.x - box.w * 0.04)}" y="${n3(box.y - box.h * 0.05)}" width="${n3(box.w * 1.08)}" height="${n3(box.h * 1.1)}" rx="${n3(box.h * 0.14)}" fill="${t.paper}" fill-opacity="0.86"/>`);
      out.push(`<g data-name="${xmlEscape(q.name)}">` + specSVG(f, fitBox(f, box), { theme: t, ink, style: o.style, pen: boxPen(box, o.pen), jitter: o.jitter,
        opacity: q.kind === 'extinct' ? 0.5 : box.anc ? 0.9 : 1 }) + '</g>');
    }
    if ((!box.anc || lay.natural) && o.names !== false) {
      const fs = box.w * (box.anc ? 0.1 : 0.085);
      out.push(`<text x="${n3(box.x + box.w / 2)}" y="${n3(box.y + box.h + fs * 0.95)}" font-family="${font}" font-size="${n3(fs)}" font-style="italic" fill="${t.text}" text-anchor="middle"${q.kind === 'extinct' ? ' fill-opacity="0.55"' : ''}>${xmlEscape((q.kind === 'extinct' ? '† ' : '') + q.name)}</text>`);
    }
  }
  out.push('</g>');
  return out.join('\n');
}
