// ============================================================================
//  DIAGRAM RENDER  ·  scene -> SVG primitives, string and live DOM
// ----------------------------------------------------------------------------
//  scenePrims(scene, opts) is DOM-free. It turns the keyed scene items of
//  layout.js or transition.js into SVG primitives { id, layer, tag, attrs,
//  text } for one style:
//      penrose ..... outlined shapes per tensor kind, metric caps and cups,
//                    plain delta lines, epsilon bars, wavy (sym) and
//                    straight (antisym) bars, dashed ring for partial and
//                    solid ring for nabla
//      birdtrack ... filled blobs, an arrow on each line (away from an
//                    upper slot, toward a lower slot), hollow box for sym,
//                    solid box for antisym
//      network ..... boxes with legs, bond size on each bond, einsum line
//  toSvgString() writes a complete SVG document (tests, PNG checks, saver).
//  applyPrims() keeps a live <svg> in step with keyed elements: it changes
//  only the attributes that changed, so a frame at 60 Hz is cheap.
//
//  Each leg also gets a wide transparent hit path with data-sym, so that a
//  hover or a tap can pick its index.
//
//  EXPORTS   (jump with grep -n "<anchor>" render.js)
//      LAYERS ......... "export const LAYERS"
//      FONTS .......... "export const FONTS"
//      scenePrims ..... "export function scenePrims"
//      toSvgString .... "export function toSvgString"
//      applyPrims ..... "export function applyPrims"
// ============================================================================

import { smoothD, pointAt } from './geom.js';
import { THEMES } from './colors.js';

export const LAYERS = ['ring', 'wire', 'bar', 'node', 'label', 'text', 'hit'];
export const FONTS = {
  math: "'STIX Two Text', 'STIX Two Math', 'Times New Roman', serif",
  ui: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

const r2 = v => Math.round(v * 100) / 100;

function italicFor(label) {
  return /^[A-Za-z]/.test(label || '') && !/^(det|tr)/.test(label);
}

function wave(x0, x1, y) {
  const n = Math.max(2, Math.round((x1 - x0) / 7));
  const dx = (x1 - x0) / n;
  let d = `M${r2(x0)} ${r2(y)}`;
  for (let i = 0; i < n; i++) {
    const s = i % 2 ? 1 : -1;
    d += `Q${r2(x0 + dx * (i + 0.5))} ${r2(y + s * 5)} ${r2(x0 + dx * (i + 1))} ${r2(y)}`;
  }
  return d;
}

function nodeShape(it, th, style) {
  const { x, y, w, h } = it;
  const net = style === 'network', bird = style === 'birdtrack';
  const fill = net ? th.box : bird ? th.blob : th.node;
  const stroke = net ? th.boxEdge : th.ink;
  const sw = net ? 1.3 : bird ? 1 : 1.6;
  const base = { fill, stroke, 'stroke-width': sw };
  if (it.dashed) base['stroke-dasharray'] = '4 3';
  switch (it.shape) {
    case 'circle':
      return { tag: 'ellipse', attrs: { ...base, cx: r2(x), cy: r2(y), rx: r2(w / 2), ry: r2(h / 2) } };
    case 'round': case 'rect': case 'box': {
      const rx = it.shape === 'round' ? Math.min(9, h / 2) : it.shape === 'box' ? 5 : 3;
      return { tag: 'rect', attrs: { ...base, x: r2(x - w / 2), y: r2(y - h / 2), width: r2(Math.max(0, w)), height: r2(Math.max(0, h)), rx } };
    }
    case 'trap':
      return { tag: 'path', attrs: { ...base, d: `M${r2(x - w / 2)} ${r2(y - h / 2)}H${r2(x + w / 2)}L${r2(x + w / 2 - 6)} ${r2(y + h / 2)}H${r2(x - w / 2 + 6)}Z` } };
    case 'hex': {
      const k = Math.min(6, w / 4);
      return { tag: 'path', attrs: { ...base, d: `M${r2(x - w / 2 + k)} ${r2(y - h / 2)}H${r2(x + w / 2 - k)}L${r2(x + w / 2)} ${r2(y)}L${r2(x + w / 2 - k)} ${r2(y + h / 2)}H${r2(x - w / 2 + k)}L${r2(x - w / 2)} ${r2(y)}Z` } };
    }
    case 'cap': case 'cup': {
      const [a, b] = it.sx && it.sx.length === 2 ? it.sx : [x - w / 2, x + w / 2];
      const s = it.shape === 'cap' ? 1 : -1;
      const yb = y + s * h / 2, ya = y - s * (h / 2 + 2);
      return { tag: 'path', attrs: { fill: 'none', stroke: th.ink, 'stroke-width': 2.1, 'stroke-linecap': 'round', d: `M${r2(a)} ${r2(yb)}C${r2(a)} ${r2(ya)} ${r2(b)} ${r2(ya)} ${r2(b)} ${r2(yb)}` } };
    }
    case 'line':
      return { tag: 'path', attrs: { fill: 'none', stroke: th.ink, 'stroke-width': 2.1, d: `M${r2(x)} ${r2(y - h / 2)}V${r2(y + h / 2)}` } };
    case 'bar':
      return { tag: 'rect', attrs: { fill: th.ink, stroke: 'none', x: r2(x - w / 2), y: r2(y - h / 2), width: r2(Math.max(0, w)), height: r2(Math.max(0, h)), rx: 1.5 } };
    default:
      return null;
  }
}

function arrowPrim(it, th, wmul) {
  // Away from an upper slot, toward a lower slot.
  const at = pointAt(it.pts, 0.55);
  let [tx, ty] = at.t;
  if (!it.up) { tx = -tx; ty = -ty; }
  const s = 5.5 * Math.min(1.4, wmul);
  const [px, py] = at.p;
  const nx = -ty, ny = tx;
  const d = `M${r2(px + tx * s)} ${r2(py + ty * s)}L${r2(px - tx * s + nx * s * 0.8)} ${r2(py - ty * s + ny * s * 0.8)}L${r2(px - tx * s - nx * s * 0.8)} ${r2(py - ty * s - ny * s * 0.8)}Z`;
  return { tag: 'path', attrs: { d, fill: it.color, stroke: 'none' } };
}

export function scenePrims(scene, opts = {}) {
  const style = opts.style || scene.style || 'penrose';
  const th = { ...(THEMES[opts.theme] || THEMES.dark), ...(typeof opts.theme === 'object' ? opts.theme : {}) };
  const pick = opts.pick || null;
  const net = style === 'network', bird = style === 'birdtrack';
  const out = [];
  const push = (id, layer, tag, attrs, text) => out.push({ id, layer, tag, attrs, text });
  const legDim = it => (pick ? (it.sym === pick ? 1 : 0.22) : 1);
  for (const it of scene.items) {
    const o = Math.max(0, Math.min(1, it.o ?? 1));
    if (o <= 0.002) continue;
    const id = String(it.key);
    if (it.type === 'leg') {
      const wmul = (it.wmul || 1) * (pick && it.sym === pick ? 1.6 : 1);
      const d = smoothD(it.pts);
      const op = r2(o * legDim(it));
      push(id, 'wire', 'path', { d, fill: 'none', stroke: it.color, 'stroke-width': r2((net ? 2.4 : 2.1) * wmul), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: op });
      if (bird && (it.free || it.up)) {
        const a = arrowPrim(it, th, wmul);
        push(id + ':arrow', 'wire', a.tag, { ...a.attrs, opacity: op });
      }
      const lo = (it.labelO ?? (it.free ? 1 : 0)) * o;
      if (lo > 0.01 && it.labelX !== undefined) {
        push(id + ':label', 'label', 'text', {
          x: r2(it.labelX), y: r2(it.labelY), fill: it.color, 'text-anchor': it.labelX !== it.end[0] && Math.abs(it.labelY - it.end[1] - 5) < 1 ? (it.labelX > it.end[0] ? 'start' : 'end') : 'middle',
          'font-family': net ? FONTS.ui : FONTS.math, 'font-size': net ? 13 : 16, 'font-style': net ? 'normal' : 'italic', opacity: r2(lo * legDim(it)),
        }, it.label);
      }
      push(id + ':hit', 'hit', 'path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': 14, 'pointer-events': 'stroke', 'data-sym': it.sym, style: 'cursor:pointer' });
      continue;
    }
    if (it.type === 'node') {
      const sh = nodeShape(it, th, style);
      const nop = r2(o * (pick ? 0.75 : 1));
      if (sh) push(id, 'node', sh.tag, { ...sh.attrs, opacity: nop });
      const hasBox = !['cap', 'cup', 'line', 'bar'].includes(it.shape);
      if (it.label && hasBox && it.w > 4) {
        const fs = it.small ? 11 : net ? 14 : 16;
        push(id + ':t', 'node', 'text', {
          x: r2(it.x), y: r2(it.y + fs * 0.34), fill: net ? th.ink : th.ink, 'text-anchor': 'middle',
          'font-family': net ? FONTS.ui : FONTS.math, 'font-size': fs, 'font-weight': net ? 600 : 400,
          'font-style': !net && italicFor(it.label) ? 'italic' : 'normal', opacity: nop,
        }, it.label);
      } else if (it.label && (it.shape === 'cap' || it.shape === 'cup') && !net) {
        const xr = Math.max(...(it.sx && it.sx.length ? it.sx : [it.x + it.w / 2]));
        push(id + ':t', 'node', 'text', { x: r2(xr + 5), y: r2(it.y + 4), fill: th.dim, 'text-anchor': 'start', 'font-family': FONTS.math, 'font-size': 12, 'font-style': 'italic', opacity: nop }, it.label);
      }
      continue;
    }
    if (it.type === 'circle') {
      const w = it.x1 - it.x0, h = it.y1 - it.y0;
      if (w < 1 || h < 1) continue;
      const attrs = { x: r2(it.x0), y: r2(it.y0), width: r2(w), height: r2(h), rx: r2(Math.min(h / 2, 15)), fill: 'none', stroke: net ? th.boxEdge : th.ink, 'stroke-width': 1.5, opacity: r2(o) };
      if (it.dkind === 'partial') attrs['stroke-dasharray'] = '5 4';
      push(id, 'ring', 'rect', attrs);
      push(id + ':t', 'label', 'text', { x: r2(it.x1 + 3), y: r2(it.y0 + 9), fill: th.dim, 'font-family': FONTS.math, 'font-size': 12, opacity: r2(o) }, it.dkind === 'partial' ? '∂' : '∇');
      continue;
    }
    if (it.type === 'bar') {
      const anti = it.btype === 'antisym';
      if (it.x1 - it.x0 < 0.5) continue;
      if (bird) {
        push(id, 'bar', 'rect', { x: r2(it.x0), y: r2(it.y - 4), width: r2(it.x1 - it.x0), height: 8, fill: anti ? th.ink : th.bg, stroke: th.ink, 'stroke-width': 1.4, opacity: r2(o) });
      } else if (net) {
        push(id, 'bar', 'path', { d: `M${r2(it.x0)} ${r2(it.y + (it.up ? 4 : -4))}V${r2(it.y)}H${r2(it.x1)}V${r2(it.y + (it.up ? 4 : -4))}`, fill: 'none', stroke: th.dim, 'stroke-width': 1.2, 'stroke-dasharray': anti ? 'none' : '3 2', opacity: r2(o) });
      } else if (anti) {
        push(id, 'bar', 'path', { d: `M${r2(it.x0)} ${r2(it.y)}H${r2(it.x1)}`, fill: 'none', stroke: th.ink, 'stroke-width': 3.2, 'stroke-linecap': 'round', opacity: r2(o) });
      } else {
        push(id, 'bar', 'path', { d: wave(it.x0, it.x1, it.y), fill: 'none', stroke: th.ink, 'stroke-width': 1.8, 'stroke-linecap': 'round', opacity: r2(o) });
      }
      push(id + ':w', 'label', 'text', { x: r2(it.wx ?? it.x1 + 5), y: r2(it.wy ?? it.y + 4), 'text-anchor': it.wa || 'start', fill: th.dim, 'font-family': FONTS.math, 'font-size': 12, opacity: r2(o) }, (net ? (anti ? 'antisym ' : 'sym ') : '') + it.weight);
      continue;
    }
    if (it.type === 'text') {
      const role = it.role;
      const font = role === 'einsum' ? FONTS.mono : role === 'dim' ? FONTS.ui : FONTS.math;
      const fill = role === 'einsum' || role === 'dim' ? th.dim : th.ink;
      push(id, 'text', 'text', { x: r2(it.x), y: r2(it.y), fill, 'text-anchor': it.anchor || 'middle', 'font-family': font, 'font-size': it.size || 16, opacity: r2(o) }, it.text);
    }
  }
  return out;
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function toSvgString(scene, opts = {}) {
  const prims = scenePrims(scene, opts);
  const th = THEMES[opts.theme] || THEMES.dark;
  const W = r2(scene.width), H = r2(scene.height);
  const scale = opts.scale || 1;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${r2(W * scale)}" height="${r2(H * scale)}">`;
  if (opts.background !== false) s += `<rect x="0" y="0" width="${W}" height="${H}" fill="${opts.background || th.bg}"/>`;
  for (const layer of LAYERS) {
    if (layer === 'hit' && !opts.hit) continue;
    s += `<g data-layer="${layer}">`;
    for (const p of prims) {
      if (p.layer !== layer) continue;
      const a = Object.entries(p.attrs).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
      s += p.text !== undefined ? `<${p.tag} ${a}>${esc(p.text)}</${p.tag}>` : `<${p.tag} ${a}/>`;
    }
    s += '</g>';
  }
  return s + '</svg>';
}

const NS = 'http://www.w3.org/2000/svg';

// cache: { groups: Map(layer -> g), els: Map(id -> { el, tag, attrs, text }) }
export function applyPrims(svg, prims, cache) {
  const doc = svg.ownerDocument;
  if (!cache.groups) {
    cache.groups = new Map();
    cache.els = new Map();
    for (const layer of LAYERS) {
      const g = doc.createElementNS(NS, 'g');
      g.setAttribute('data-layer', layer);
      svg.appendChild(g);
      cache.groups.set(layer, g);
    }
  }
  const seen = new Set();
  for (const p of prims) {
    seen.add(p.id);
    let rec = cache.els.get(p.id);
    if (rec && rec.tag !== p.tag) { rec.el.remove(); rec = null; }
    if (!rec) {
      const el = doc.createElementNS(NS, p.tag);
      cache.groups.get(p.layer).appendChild(el);
      rec = { el, tag: p.tag, attrs: {}, text: undefined };
      cache.els.set(p.id, rec);
    }
    for (const k in p.attrs) {
      const v = p.attrs[k];
      if (rec.attrs[k] !== v) { rec.el.setAttribute(k, v); rec.attrs[k] = v; }
    }
    for (const k in rec.attrs) if (!(k in p.attrs)) { rec.el.removeAttribute(k); delete rec.attrs[k]; }
    if (p.text !== undefined && rec.text !== p.text) { rec.el.textContent = p.text; rec.text = p.text; }
  }
  for (const [id, rec] of cache.els) if (!seen.has(id)) { rec.el.remove(); cache.els.delete(id); }
}
