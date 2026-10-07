// ============================================================================
//  FISHDRAW  ·  treedraw.js — the tree of life on a canvas and as SVG
// ----------------------------------------------------------------------------
//  Our own code around fishdraw by Lingdong Huang (MIT, LICENSE-fishdraw.txt).
//  The layout comes from tree.js layoutTree() in plate mm. Each draw strokes
//  branches and fish as vectors through the view transform, so a zoom of
//  any size stays sharp. No raster of the tree is kept.
//
//  drawTree(ctx, P). P:
//    tree, lay      the model and its layout (mm)
//    view           { s, ox, oy }: device px per mm and the origin
//    theme, ink, pen (mm), jitter, dpr
//    tau            the growth time; T_MAX * GROW_OVER draws all of it
//    fishFor(id)    the pool fish of a node, or null (not drawn yet)
//    anc            true draws the ancestral fish at internal nodes
//    names          true writes the names under the tip fish
//    back, paper    true puts a paper card of colour paper under each fish
//  A natural layout (tree.js layoutNatural) has no time axis, thinner and
//  fainter branches, and names under the ancestor fish too.
//    sel            a node id or -1; line: a Set of the ids of its lineage
//    ancOnly        a Set of internal ids whose fish show when anc is false
//  Growth: the elbow of a branch shows when its parent exists, the run grows
//  from the parent time to the node time. At the growing end a small fish
//  fades from the parent form to the child form. A node fish draws on with
//  the pen in the DRAW_T time units after its node time.
//
//  treeSVG(...) gives the SVG elements of the full grown tree, in mm, for
//  export.js (inside the plate from svg.js plateSVG).
//
//  GREP MAP
//    grep -n 'export function drawTree'     the canvas draw
//    grep -n 'function drawFishBox'         one fish in a box, alpha, pen
//    grep -n 'export function treeSVG'      the SVG elements
//    grep -n 'export function hitTree'      the node under a plate point
//    grep -n 'export const GROW_OVER'       the overrun for the draw-on
// ============================================================================
import { T_MAX, maAgo } from './tree.js';
import { fishPath, fishPoints, tracePartial, labelFont } from './render.js';
import { cellLines, xmlEscape } from './svg.js';
import { isDark } from './plate.js';
import { SERIF } from './render.js';

export const DRAW_T = T_MAX * 0.07;          // draw-on span of a node fish
export const GROW_OVER = 1 + 0.07 + 0.02;    // tau end: the tips finish
export const hiColor = theme => (isDark(theme) ? '#ffcf5a' : '#b3412e');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ── drawFishBox ─────────────────────────────────────────────────────────────
// A soft paper card under each fish (P.back): the branch lines pass behind
// the fish, so the fish read first and the lines stay quiet.
function backing(ctx, box, P, alpha) {
  const s = P.view.s, x = P.view.ox + box.x * s, y = P.view.oy + box.y * s, w = box.w * s, h = box.h * s;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 0.86 * alpha; ctx.fillStyle = P.paper;
  const r = Math.min(w, h) * 0.18, px = w * 0.04, py = h * 0.08;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x - px, y - py, w + px * 2, h + py * 2, r); else ctx.rect(x - px, y - py, w + px * 2, h + py * 2);
  ctx.fill();
  ctx.restore();
}
function drawFishBox(ctx, f, box, P, alpha, prog) {
  const s = P.view.s, k = box.w / 500 * s;
  const ox = P.view.ox + box.x * s, oy = P.view.oy + box.y * s;
  if (ox > ctx.canvas.width || oy > ctx.canvas.height || ox + box.w * s < 0 || oy + box.h * s < 0) return;
  if (box.w * s < 3) return;
  if (P.back && P.paper) backing(ctx, box, P, alpha);
  const penF = clamp(box.w * 0.0042, 0.03, P.pen);
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.setTransform(k, 0, 0, k, ox, oy);
  ctx.lineWidth = Math.max(penF * s, 0.3 * (P.dpr || 1)) / k;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (prog == null || prog >= 1) ctx.stroke(fishPath(f, P.jitter || 0));
  else if (prog > 0) { tracePartial(ctx, f, fishPoints(f, P.jitter || 0).xy, f.total * prog); ctx.stroke(); }
  ctx.restore();
}

// ── drawTree ────────────────────────────────────────────────────────────────
export function drawTree(ctx, P) {
  const { tree, lay, view, theme } = P, s = view.s, nodes = tree.nodes;
  const ink = P.ink || theme.ink, hi = hiColor(theme), tau = P.tau == null ? T_MAX * GROW_OVER : P.tau;
  const X = v => view.ox + v * s, Y = v => view.oy + v * s;
  const line = P.line || new Set();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  // Eras and the time axis.
  ctx.fillStyle = ink; ctx.strokeStyle = ink;
  const showEras = P.xMode !== 'change' && !lay.natural;
  if (lay.natural) { /* no time axis: columns and rings are splits */ }
  else if (lay.kind === 'clado') {
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
        // A date label that would touch the one before it is left out.
        ctx.font = labelFont(ts, 'normal'); ctx.textAlign = 'center'; ctx.globalAlpha = 0.6;
        const txt = maAgo(e.t0) + ' Ma', tw = ctx.measureText(txt).width;
        if (x0 - tw / 2 > lastMa + ts * 0.6) { ctx.fillText(txt, x0, ax + ts * 1.5); lastMa = x0 + tw / 2; }
      }
    });
    ctx.globalAlpha = 0.6; ctx.lineWidth = Math.max(1, P.pen * 0.6 * s);
    ctx.beginPath(); ctx.moveTo(X(lay.x0), ax); ctx.lineTo(X(lay.x1), ax); ctx.stroke();
    if (tau < T_MAX) {
      ctx.globalAlpha = 0.5; ctx.strokeStyle = hi; ctx.setLineDash([4 * (P.dpr || 1), 4 * (P.dpr || 1)]);
      ctx.beginPath(); ctx.moveTo(X(lay.xOf(tau)), top); ctx.lineTo(X(lay.xOf(tau)), ax); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = ink;
    }
  } else {
    const ringAt = (t, dash, alpha, color) => {
      const r = lay.rOf(t) * s;
      ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.setLineDash(dash);
      ctx.beginPath();
      if (lay.fan) ctx.arc(X(lay.cx), Y(lay.cy), r, lay.a0, lay.a0 + lay.span); else ctx.arc(X(lay.cx), Y(lay.cy), r, 0, Math.PI * 2);
      ctx.stroke(); ctx.setLineDash([]);
    };
    ctx.lineWidth = Math.max(0.6, P.pen * 0.5 * s);
    if (showEras) tree.eras.forEach((e, i) => {
      if (i) ringAt(e.t0, [2 * (P.dpr || 1), 5 * (P.dpr || 1)], 0.3, ink);
      const fs = Math.min((lay.rOf(e.t1) - lay.rOf(e.t0)) * 0.3, lay.tip.h * 0.3) * s;
      if (fs > 5) {
        const a = lay.fan ? lay.a0 - 0.02 : -Math.PI / 2 - 0.02, r = lay.rOf((e.t0 + e.t1) / 2) * s;
        ctx.globalAlpha = 0.65; ctx.fillStyle = ink; ctx.font = labelFont(fs, 'italic'); ctx.textAlign = lay.fan ? 'center' : 'right';
        ctx.fillText(e.name, X(lay.cx) + r * Math.cos(a), Y(lay.cy) + r * Math.sin(a) + (lay.fan ? fs * 1.2 : 0));
      }
    });
    if (tau < T_MAX) ringAt(tau, [4 * (P.dpr || 1), 4 * (P.dpr || 1)], 0.5, hi);
  }
  ctx.globalAlpha = 1; ctx.strokeStyle = ink;

  // Branches.
  // Branches: thin and a little faded in the natural layout, so the fish
  // lead; a lineage is drawn thicker in the highlight colour.
  const bw = lay.natural ? Math.max(0.55 * (P.dpr || 1), P.pen * 0.6 * s) : Math.max(0.6 * (P.dpr || 1), P.pen * 1.2 * s);
  const quiet = lay.natural ? 0.6 : 1;
  const grow = [];
  for (const q of nodes) {
    if (q.parent < 0) continue;
    const p = nodes[q.parent];
    if (tau < p.t) continue;
    const b = lay.branch[q.id];
    const frac = q.t > p.t ? clamp((tau - p.t) / (q.t - p.t), 0, 1) : 1;
    const on = line.has(q.id);
    const extinct = q.kind === 'extinct';
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
    const r = bw * (q.radiation ? 2.2 : 1.3);
    ctx.fillStyle = line.has(q.id) ? hi : ink;
    ctx.beginPath(); ctx.arc(X(lay.pos[q.id].x), Y(lay.pos[q.id].y), r, 0, Math.PI * 2); ctx.fill();
    if (q.radiation) { ctx.strokeStyle = hi; ctx.lineWidth = bw * 0.7; ctx.beginPath(); ctx.arc(X(lay.pos[q.id].x), Y(lay.pos[q.id].y), r * 2.2, 0, Math.PI * 2); ctx.stroke(); }
  }

  // Fish at nodes.
  ctx.strokeStyle = ink; ctx.fillStyle = theme.text || ink;
  for (const q of nodes) {
    const box = lay.fish[q.id];
    if (!box || tau < q.t) continue;
    if (box.anc && !P.anc && q.id !== P.sel && !(P.ancOnly && P.ancOnly.has(q.id))) continue;
    const f = P.fishFor(q.id);
    const prog = clamp((tau - q.t) / DRAW_T, 0, 1);
    const alpha = q.kind === 'extinct' ? 0.5 : box.anc ? 0.88 : 1;
    ctx.strokeStyle = line.has(q.id) && box.anc ? hi : ink;
    if (f) drawFishBox(ctx, f, box, P, alpha, prog);
    if ((!box.anc || lay.natural) && P.names !== false && prog > 0.2) {
      const fs = box.h * (box.anc ? 0.17 : 0.15) * s;
      if (fs >= 6) {
        ctx.globalAlpha = q.kind === 'extinct' ? 0.55 : box.anc ? 0.7 : 0.9;
        ctx.font = labelFont(fs, 'italic'); ctx.textAlign = 'center';
        ctx.fillText((q.kind === 'extinct' ? '† ' : '') + q.name, X(box.x + box.w / 2), Y(box.y + box.h) + fs * 0.9);
        ctx.globalAlpha = 1;
      }
    }
  }
  // Growing ends: the parent form fades into the child form.
  if (grow.length <= 48) for (const g of grow) {
    const fa = P.fishFor(g.p.id), fb = P.fishFor(g.q.id);
    const w = lay.natural ? lay.anc.w : lay.tip.w * 0.5, h = w * 0.6;
    const box = lay.kind === 'clado' ? { x: g.x + w * 0.08, y: g.y - h / 2, w, h } : { x: g.x - w / 2, y: g.y - h / 2, w, h };
    ctx.strokeStyle = ink;
    if (fa) drawFishBox(ctx, fa, box, P, 0.85 * (1 - g.frac), null);
    if (fb) drawFishBox(ctx, fb, box, P, 0.85 * g.frac, null);
  }
  // The selected node.
  if (P.sel >= 0 && lay.fish[P.sel]) {
    const b = lay.fish[P.sel];
    ctx.strokeStyle = hi; ctx.lineWidth = Math.max(1, bw * 0.9); ctx.globalAlpha = 0.9;
    const pad = b.h * 0.08;
    ctx.strokeRect(X(b.x - pad), Y(b.y - pad), (b.w + pad * 2) * s, (b.h + pad * 2) * s);
  }
  ctx.restore();
}

// ── hitTree ─────────────────────────────────────────────────────────────────
// The node under plate point (x, y) in mm: a fish box first, then a node
// dot or a branch run within tol mm. -1 when none.
export function hitTree(tree, lay, x, y, tol, anc = true) {
  let best = -1, bd = Infinity;
  for (const q of tree.nodes) {
    const b = lay.fish[q.id];
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
// SVG elements (a string) of the grown tree, in mm. o: { theme, ink, pen,
// jitter, anc, names, line (Set), xMode }.
export function treeSVG(tree, lay, o, fishFor) {
  const t = o.theme, ink = o.ink || t.ink, hi = hiColor(t), n3 = v => (Math.round(v * 1000) / 1000).toString();
  // Fish lines in 0.01 mm: the tree fish are small, and the file stays smaller.
  const n2 = v => (Math.round(v * 100) / 100).toString();
  const out = ['<g id="tree">'];
  const font = xmlEscape(SERIF.replace(/"/g, "'"));
  if (lay.natural) { /* no time axis */ }
  else if (lay.kind === 'clado' && o.xMode !== 'change') {
    tree.eras.forEach((e, i) => {
      const x0 = lay.xOf(e.t0), x1 = lay.xOf(e.t1);
      out.push(`<rect x="${n3(x0)}" y="${n3(lay.top)}" width="${n3(x1 - x0)}" height="${n3(lay.bottom - lay.top)}" fill="${ink}" fill-opacity="${i % 2 ? 0.05 : 0.025}"/>`);
      const fs = Math.min(lay.axisH * 0.3, (x1 - x0) * 0.16);
      out.push(`<text x="${n3((x0 + x1) / 2)}" y="${n3(lay.axisY + fs * 2.6)}" font-family="${font}" font-size="${n3(fs)}" font-style="italic" fill="${ink}" text-anchor="middle">${xmlEscape(e.name)}</text>`);
      out.push(`<text x="${n3(x0)}" y="${n3(lay.axisY + lay.axisH * 0.3)}" font-family="${font}" font-size="${n3(lay.axisH * 0.2)}" fill="${ink}" fill-opacity="0.6" text-anchor="middle">${maAgo(e.t0)} Ma</text>`);
    });
    out.push(`<path d="M${n3(lay.x0)} ${n3(lay.axisY)}H${n3(lay.x1)}" stroke="${ink}" stroke-width="${n3(o.pen * 0.6)}" stroke-opacity="0.6"/>`);
  } else if (lay.kind !== 'clado' && o.xMode !== 'change') {
    tree.eras.forEach((e, i) => {
      if (!i) return;
      const r = lay.rOf(e.t0);
      if (lay.fan) {
        const a = lay.a0, b = lay.a0 + lay.span;
        out.push(`<path d="M${n3(lay.cx + r * Math.cos(a))} ${n3(lay.cy + r * Math.sin(a))}A${n3(r)} ${n3(r)} 0 0 1 ${n3(lay.cx + r * Math.cos(b))} ${n3(lay.cy + r * Math.sin(b))}" fill="none" stroke="${ink}" stroke-opacity="0.3" stroke-width="${n3(o.pen * 0.5)}" stroke-dasharray="0.6 1.4"/>`);
      } else out.push(`<circle cx="${n3(lay.cx)}" cy="${n3(lay.cy)}" r="${n3(r)}" fill="none" stroke="${ink}" stroke-opacity="0.3" stroke-width="${n3(o.pen * 0.5)}" stroke-dasharray="0.6 1.4"/>`);
    });
  }
  const bw = o.pen * (lay.natural ? 0.6 : 1.2), line = o.line || new Set();
  for (const q of tree.nodes) {
    if (q.parent < 0) continue;
    const b = lay.branch[q.id];
    const d = 'M' + b.elbow.map(p => n3(p[0]) + ' ' + n3(p[1])).join('L') + 'M' + b.run.map(p => n3(p[0]) + ' ' + n3(p[1])).join('L');
    const on = line.has(q.id), ext = q.kind === 'extinct';
    out.push(`<path d="${d}" fill="none" stroke="${on ? hi : ink}" stroke-width="${n3(on ? bw * 2.2 : bw)}" stroke-linecap="round" stroke-linejoin="round"${ext ? ` stroke-opacity="0.45" stroke-dasharray="${n3(bw * 2.5)} ${n3(bw * 2.5)}"` : ''}/>`);
  }
  for (const q of tree.nodes) {
    if (q.kind !== 'split') continue;
    out.push(`<circle cx="${n3(lay.pos[q.id].x)}" cy="${n3(lay.pos[q.id].y)}" r="${n3(bw * (q.radiation ? 2.2 : 1.3))}" fill="${line.has(q.id) ? hi : ink}"/>`);
  }
  for (const q of tree.nodes) {
    const box = lay.fish[q.id], f = fishFor(q.id);
    if (!box || (box.anc && !o.anc)) continue;
    if (f && lay.natural) out.push(`<rect x="${n3(box.x - box.w * 0.04)}" y="${n3(box.y - box.h * 0.08)}" width="${n3(box.w * 1.08)}" height="${n3(box.h * 1.16)}" rx="${n3(box.h * 0.18)}" fill="${t.paper}" fill-opacity="0.86"/>`);
    if (f) {
      const pen = clamp(box.w * 0.0042, 0.03, o.pen);
      const dd = cellLines(f, { fx: box.x, fy: box.y, k: box.w / 500 }, o.jitter || 0).map(pl => 'M' + pl.map(([x, y]) => n2(x) + ' ' + n2(y)).join('L')).join('');
      out.push(`<path data-name="${xmlEscape(q.name)}" d="${dd}" fill="none" stroke="${ink}" stroke-width="${n3(pen)}" stroke-linecap="round" stroke-linejoin="round"${q.kind === 'extinct' ? ' stroke-opacity="0.5"' : box.anc ? ' stroke-opacity="0.8"' : ''}/>`);
    }
    if ((!box.anc || lay.natural) && o.names !== false) {
      out.push(`<text x="${n3(box.x + box.w / 2)}" y="${n3(box.y + box.h + box.h * 0.15 * 0.9)}" font-family="${font}" font-size="${n3(box.h * 0.15)}" font-style="italic" fill="${t.text}" text-anchor="middle"${q.kind === 'extinct' ? ' fill-opacity="0.55"' : ''}>${xmlEscape((q.kind === 'extinct' ? '† ' : '') + q.name)}</text>`);
    }
  }
  out.push('</g>');
  return out.join('\n');
}
