// overlay.js — the SVG layer: approach rings, routes, cost tags, stations,
// labels and the hit targets. Reads data.js and icons.js. No GPU.
//
// createOverlay() builds every element once. update(view) then moves them
// for a new camera view without new elements, and setState() only sets
// classes and opacity, so CSS transitions do the fades.
//
// Two coordinate spaces:
//   world group  the dashed approach rings. One transform per frame, plus
//                stroke width and dash on the group so both stay constant
//                in CSS px.
//   screen       routes, tags, stations, labels, hits. update() writes the
//                route paths in CSS px (the route ends stop at the station
//                edge, which depends on zoom) and one translate/scale per
//                size-kept element.
// Size-kept elements scale by sizeScale(): constant at fit, and they grow
// gently when the camera zooms in.
//
// grep: function createOverlay  function buildStation  function buildHub
//       function sizeScale  function placeTag  function routeGeom  extent(  update(  setState(  STYLE

import { NODES, ROUTES, NODE_BY_ID, TIER_BY_ID } from './data.js';
import { ICONS, ICON_VIEW_R } from './icons.js';

const NS = 'http://www.w3.org/2000/svg';
const INK = '#0b0b0b';
const GREY = '#6e6e6e';
const FONT = "'Chakra Petch', sans-serif";

// Station outer radius in CSS px at fit zoom, per size.
const OUTER = { m: 17.5, l: 30.5 };
const TAG_FS = 12.5;        // tag font size, CSS px at fit
const TAG_H = 15;           // tag box height, CSS px at fit
const LABEL_FS = 9.5;       // label font size, CSS px at fit
const LABEL_LS = 0.5;       // label letter gap, em
const HIT_R = 26;           // hit circle radius, CSS px at fit

// Keyframes, transitions and state rules. Every selector has the sb- prefix.
const STYLE = `
.sb-fade { transition: opacity 180ms ease; }
.sb-ring { transform-box: fill-box; transform-origin: center; animation: sb-spin 240s linear infinite; transition: stroke 180ms ease; }
.sb-ringcore { transition: opacity 180ms ease; }
.sb-node.sb-hot .sb-edge { stroke: #fff; }
.sb-node.sb-hot .sb-halo { opacity: 0.5; }
.sb-route.sb-on { stroke-width: 2.6px; stroke-dasharray: 9 6; animation: sb-flow 0.9s linear infinite; }
.sb-route.sb-on.sb-rev { animation-direction: reverse; }
.sb-label { transition: opacity 180ms ease, fill 180ms ease; }
.sb-label.sb-hot { fill: #fff; opacity: 1 !important; }
.sb-sel { opacity: 0; }
.sb-node.sb-picked .sb-sel { opacity: 1; }
.sb-node.sb-picked .sb-pulse { animation: sb-pulse 1.6s ease-out infinite; }
.sb-pulse { opacity: 0; transform-box: fill-box; transform-origin: center; }
@keyframes sb-spin { to { transform: rotate(360deg); } }
@keyframes sb-flow { to { stroke-dashoffset: -30; } }
@keyframes sb-pulse {
  0%   { transform: scale(1);   opacity: 0.9; }
  100% { transform: scale(2.2); opacity: 0; }
}
`;

// Scale of the size-kept elements. It is sqrt(zoom / fit), so they grow
// gently when the camera zooms in. On a screen whose fit zoom is below the
// 1400 x 900 desktop fit (0.514), the chart is smaller, so they shrink a
// little too, down to 0.86.
function sizeScale(zoom, w, h) {
  const fit = Math.min(w / 900, h / 1750);
  const base = Math.min(1, Math.max(0.86, Math.sqrt(fit / 0.514)));
  return base * Math.sqrt(Math.max(1, zoom / fit));
}

function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

// A glyph from icons.js, scaled so its radius ICON_VIEW_R becomes r.
function glyph(id, r, parent) {
  const g = el('g', { transform: `scale(${(r / ICON_VIEW_R).toFixed(4)})`, color: INK }, parent);
  g.innerHTML = ICONS[id] || '';
  return g;
}

// Normal station ('m'): white disc with the glyph, a dark gap, a thin white
// ring and a thin grey ring.
function buildStation(n, g) {
  el('circle', { r: 17.8, fill: INK }, g);
  el('circle', { class: 'sb-halo sb-fade', r: 21, fill: 'none', stroke: '#fff', 'stroke-width': 1, opacity: 0 }, g);
  el('circle', { class: 'sb-edge', r: 16.9, fill: 'none', stroke: '#8a8a8a', 'stroke-width': 1.1, style: 'transition: stroke 180ms ease' }, g);
  el('circle', { r: 13.7, fill: 'none', stroke: '#f2f2f2', 'stroke-width': 1.7 }, g);
  el('circle', { r: 10.6, fill: '#f2f2f2' }, g);
  glyph(n.id, 7.6, g);
}

// Large hub ('l', Darkside): concentric thin rings, a band of short slanted
// ticks between two rings, and a white core with the hex-cluster glyph.
function buildHub(n, g) {
  el('circle', { r: 31, fill: INK }, g);
  el('circle', { class: 'sb-halo sb-fade', r: 34.5, fill: 'none', stroke: '#fff', 'stroke-width': 1, opacity: 0 }, g);
  el('circle', { class: 'sb-edge', r: 30, fill: 'none', stroke: '#d6d6d6', 'stroke-width': 1.8, style: 'transition: stroke 180ms ease' }, g);
  el('circle', { r: 23.6, fill: 'none', stroke: '#d6d6d6', 'stroke-width': 1.3 }, g);
  // The hatch band: slanted ticks from r0 to r1, each turned by a small angle.
  const r0 = 24.6, r1 = 29.2, count = 40, skew = 0.2;
  let d = '';
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const b = a + skew;
    d += `M${(r0 * Math.cos(a)).toFixed(2)},${(r0 * Math.sin(a)).toFixed(2)}` +
         `L${(r1 * Math.cos(b)).toFixed(2)},${(r1 * Math.sin(b)).toFixed(2)}`;
  }
  el('path', { d, stroke: '#e2e2e2', 'stroke-width': 1.9, 'stroke-linecap': 'butt', fill: 'none' }, g);
  for (const [r, w, c] of [[20.8, 1.1, '#d0d0d0'], [17, 0.8, '#a8a8a8'], [13.4, 0.8, '#bdbdbd']]) {
    el('circle', { r, fill: 'none', stroke: c, 'stroke-width': w }, g);
  }
  el('circle', { r: 10.4, fill: 'none', stroke: '#f2f2f2', 'stroke-width': 1.2 }, g);
  el('circle', { r: 8.6, fill: '#f2f2f2' }, g);
  glyph(n.id, 7.2, g);
}

// Screen geometry of one route: its end points, trimmed to the station edge,
// and a point function for tag placement. A bent route is a quadratic bow.
function routeGeom(r, a, b, ra, rb) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = Math.hypot(dx, dy) || 1;
  const bend = r.bend || 0;
  let at;
  if (!bend) {
    at = t => ({ x: a.x + dx * t, y: a.y + dy * t });
  } else {
    // Control point so the apex of the bow is bend (screen) off the chord.
    const nx = -dy / L, ny = dx / L;
    const c = { x: (a.x + b.x) / 2 + nx * bend * 2, y: (a.y + b.y) / 2 + ny * bend * 2 };
    at = t => {
      const u = 1 - t;
      return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
    };
  }
  const t0 = Math.min(0.49, ra / L), t1 = Math.max(0.51, 1 - rb / L);
  return { at, t0, t1, L, ux: dx / L, uy: dy / L, bend };
}

export function createOverlay(svg, { onHover = () => {}, onPick = () => {} } = {}) {
  svg.textContent = '';
  svg.setAttribute('overflow', 'hidden');
  const style = el('style', {}, svg);
  style.textContent = STYLE;

  const gWorld = el('g', { class: 'sb-world', 'pointer-events': 'none' }, svg);
  const gRings = el('g', { fill: 'none', stroke: GREY, 'stroke-linecap': 'butt' }, gWorld);
  const gRoutes = el('g', { fill: 'none', 'stroke-linecap': 'round', 'pointer-events': 'none' }, svg);
  const gTags = el('g', { 'pointer-events': 'none' }, svg);
  const gNodes = el('g', { 'pointer-events': 'none' }, svg);
  const gLabels = el('g', { 'pointer-events': 'none' }, svg);
  const gHits = el('g', {}, svg);

  // Per node: approach ring, station group, label, hit circle.
  const nodes = NODES.map(n => {
    const ringCore = el('circle', { class: 'sb-ringcore', cx: n.x, cy: n.y, r: n.ring, stroke: '#fff', 'stroke-dasharray': 'none', opacity: 0 }, gRings);
    const ring = el('circle', { class: 'sb-ring', cx: n.x, cy: n.y, r: n.ring }, gRings);
    const g = el('g', { class: 'sb-node sb-fade' }, gNodes);
    const inner = el('g', {}, g);
    // Selection marks sit under the station body.
    const R = OUTER[n.size] || OUTER.m;
    el('circle', { class: 'sb-sel', r: R + 3.5, fill: 'none', stroke: '#fff', 'stroke-width': 1.4, style: 'transition: opacity 180ms ease' }, inner);
    el('circle', { class: 'sb-pulse', r: R + 3.5, fill: 'none', stroke: '#fff', 'stroke-width': 1.2 }, inner);
    (n.size === 'l' ? buildHub : buildStation)(n, inner);

    // The label box centre sits at (dx, dy) CSS px from the station at fit.
    // The offset scales with k, the same as the station, so the label keeps
    // its place in the gaps between the routes at every zoom.
    const label = el('text', {
      class: 'sb-label',
      'text-anchor': 'middle', 'dominant-baseline': 'central',
      'font-family': FONT, 'font-weight': 500, 'font-size': LABEL_FS,
      'letter-spacing': `${LABEL_LS}em`, fill: '#e8e8e8', opacity: 0.88,
      stroke: INK, 'stroke-width': 3, 'stroke-linejoin': 'round', 'paint-order': 'stroke',
      // The text carries one trailing letter gap. Move half of it back.
      dx: `${LABEL_LS / 2}em`,
    }, gLabels);
    label.textContent = n.name.toUpperCase();

    const hit = el('circle', { r: HIT_R, fill: 'transparent', 'pointer-events': 'all', style: 'cursor: pointer' }, gHits);
    hit.addEventListener('pointerenter', () => onHover(n.id));
    hit.addEventListener('pointerleave', () => onHover(null));
    hit.addEventListener('click', ev => { ev.stopPropagation(); onPick(n.id); });

    // Label half size at fit, CSS px. The font load below measures the width.
    const lw = n.name.length * LABEL_FS * 0.55, lh = LABEL_FS * 0.6;
    return { n, R, ring, ringCore, g, label, hit, sx: 0, sy: 0, lx: 0, ly: 0, lw, lh };
  });
  const nodeIndex = Object.fromEntries(nodes.map((o, i) => [o.n.id, i]));

  // Per route: path, tag box and tag text.
  const routes = ROUTES.map((r, i) => {
    const color = (TIER_BY_ID[r.tier] || TIER_BY_ID.none).color;
    const path = el('path', { class: 'sb-route sb-fade', stroke: color, 'stroke-width': 1.3 }, gRoutes);
    const tag = el('g', { class: 'sb-fade' }, gTags);
    const w = String(r.cost).length + 1;
    const w0 = w * TAG_FS * 0.58 + 6;
    const box = el('rect', { x: -w0 / 2, y: -TAG_H / 2, width: w0, height: TAG_H, fill: INK, stroke: color, 'stroke-width': 1.2 }, tag);
    const t = el('text', {
      'text-anchor': 'middle', 'dominant-baseline': 'central', y: 0.5,
      'font-family': FONT, 'font-weight': 400, 'font-size': TAG_FS, fill: color,
    }, tag);
    t.textContent = `-${r.cost}`;
    return { r, i, path, tag, box, text: t, w: w0, a: nodeIndex[r.from], b: nodeIndex[r.to] };
  });

  // After the font loads, fit each tag box to its measured text once.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      for (const o of routes) {
        let tw = 0;
        try { tw = o.text.getComputedTextLength(); } catch { /* not rendered yet */ }
        if (tw > 0) {
          o.w = tw + 6;
          o.box.setAttribute('x', (-o.w / 2).toFixed(2));
          o.box.setAttribute('width', o.w.toFixed(2));
        }
      }
      for (const o of nodes) {
        try {
          const b = o.label.getBBox();
          // The box holds one trailing letter gap. Leave it out.
          if (b.width > 0) o.lw = (b.width - LABEL_FS * LABEL_LS) / 2 + 1;
        } catch { /* not rendered yet */ }
      }
      if (last) api.update(last);
    });
  }

  let last = null;
  let sizeW = -1, sizeH = -1;

  // Slide the tag along its route until it clears every station, label and
  // tag placed before it. placed holds the boxes of the placed tags.
  const placed = [];
  function placeTag(o, g, k) {
    const hw = (o.w / 2) * k, hh = (TAG_H / 2) * k;
    const ext = Math.abs(hw * g.ux) + Math.abs(hh * g.uy);        // half size along the route
    const pad = 4;
    const lo = Math.min(0.5, (nodes[o.a].R * k + ext + pad) / g.L);
    const hi = Math.max(0.5, 1 - (nodes[o.b].R * k + ext + pad) / g.L);
    const clear = p => {
      for (const s of nodes) {
        const rr = s.R * k + pad;
        const dx = Math.max(0, Math.abs(p.x - s.sx) - hw), dy = Math.max(0, Math.abs(p.y - s.sy) - hh);
        if (dx * dx + dy * dy < rr * rr) return false;
        if (Math.abs(p.x - s.lx) < hw + s.lw * k + 2 && Math.abs(p.y - s.ly) < hh + s.lh * k + 2) return false;
      }
      for (const t of placed) {
        if (Math.abs(p.x - t.x) < hw + t.hw + 2 && Math.abs(p.y - t.y) < hh + t.hh + 2) return false;
      }
      return true;
    };
    const base = Math.min(hi, Math.max(lo, o.r.at));
    let p = g.at(base);
    if (clear(p)) return p;
    for (let step = 1; step <= 8; step++) {
      for (const sgn of [1, -1]) {
        const t = base + sgn * step * 0.04;
        if (t < lo || t > hi) continue;
        const q = g.at(t);
        if (clear(q)) return q;
      }
    }
    return p;
  }

  const api = {
    // Screen box of every station and label for a view, without a layout
    // pass. With band = [y0, y1], only the boxes that touch that row count.
    // The page uses it to keep the home view clear of its UI.
    extent(view, band = null) {
      const { cx, cy, zoom, w, h } = view;
      const k = sizeScale(zoom, w, h);
      const ox = w / 2 - cx * zoom, oy = h / 2 - cy * zoom;
      const e = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      const add = (x0, y0, x1, y1) => {
        if (band && (y1 < band[0] || y0 > band[1])) return;
        e.x0 = Math.min(e.x0, x0); e.y0 = Math.min(e.y0, y0);
        e.x1 = Math.max(e.x1, x1); e.y1 = Math.max(e.y1, y1);
      };
      for (const o of nodes) {
        const sx = o.n.x * zoom + ox, sy = o.n.y * zoom + oy, r = o.R * k;
        add(sx - r, sy - r, sx + r, sy + r);
        const lx = sx + o.n.label.dx * k, ly = sy + o.n.label.dy * k;
        add(lx - o.lw * k, ly - o.lh * k, lx + o.lw * k, ly + o.lh * k);
      }
      return e;
    },

    update(view) {
      last = view;
      const { cx, cy, zoom, w, h } = view;
      if (w !== sizeW || h !== sizeH) {
        sizeW = w; sizeH = h;
        svg.setAttribute('width', w);
        svg.setAttribute('height', h);
        svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      }
      const k = sizeScale(zoom, w, h);
      const ox = w / 2 - cx * zoom, oy = h / 2 - cy * zoom;

      // World group: one transform, and a stroke that stays 2.5 CSS px.
      gWorld.setAttribute('transform', `matrix(${zoom},0,0,${zoom},${ox.toFixed(2)},${oy.toFixed(2)})`);
      gRings.setAttribute('stroke-width', (2.5 / zoom).toFixed(4));
      gRings.setAttribute('stroke-dasharray', `${(10 / zoom).toFixed(3)} ${(7 / zoom).toFixed(3)}`);

      for (const o of nodes) {
        o.sx = o.n.x * zoom + ox; o.sy = o.n.y * zoom + oy;
        const t = `translate(${o.sx.toFixed(2)},${o.sy.toFixed(2)}) scale(${k.toFixed(4)})`;
        o.g.setAttribute('transform', t);
        o.hit.setAttribute('transform', t);
        o.lx = o.sx + o.n.label.dx * k; o.ly = o.sy + o.n.label.dy * k;
        // Near a screen edge, slide the label in so that it stays whole.
        const m = 4 + o.lw * k;
        if (o.sx > 0 && o.sx < w) o.lx = Math.min(w - m, Math.max(m, o.lx));
        o.label.setAttribute('transform', `translate(${o.lx.toFixed(2)},${o.ly.toFixed(2)}) scale(${k.toFixed(4)})`);
      }

      placed.length = 0;
      for (const o of routes) {
        const A = nodes[o.a], B = nodes[o.b];
        const g = routeGeom(o.r, { x: A.sx, y: A.sy }, { x: B.sx, y: B.sy }, A.R * k, B.R * k);
        if (o.r.bend) g.bend = o.r.bend * zoom;
        let d;
        if (!o.r.bend) {
          const p = g.at(g.t0), q = g.at(g.t1);
          d = `M${p.x.toFixed(2)},${p.y.toFixed(2)}L${q.x.toFixed(2)},${q.y.toFixed(2)}`;
        } else {
          const gb = routeGeom({ bend: o.r.bend * zoom }, { x: A.sx, y: A.sy }, { x: B.sx, y: B.sy }, A.R * k, B.R * k);
          d = '';
          for (let s = 0; s <= 20; s++) {
            const p = gb.at(gb.t0 + (gb.t1 - gb.t0) * s / 20);
            d += (s ? 'L' : 'M') + p.x.toFixed(2) + ',' + p.y.toFixed(2);
          }
          g.at = gb.at;
        }
        o.path.setAttribute('d', d);
        const p = placeTag(o, g, k);
        placed.push({ x: p.x, y: p.y, hw: (o.w / 2) * k, hh: (TAG_H / 2) * k });
        o.tag.setAttribute('transform', `translate(${p.x.toFixed(2)},${p.y.toFixed(2)}) scale(${k.toFixed(4)})`);
      }
    },

    setState({ hover = null, selected = [], path = null, tiers = null } = {}) {
      const onRoute = new Set(path ? path.routes : []);
      const onNode = new Set(path ? path.nodes : []);
      const picked = new Set(selected || []);

      // Travel direction per path route, so the dash flows along the course.
      const rev = new Set();
      if (path) {
        path.routes.forEach((ri, j) => {
          const r = ROUTES[ri];
          if (r && r.from === path.nodes[j + 1] && r.to === path.nodes[j]) rev.add(ri);
        });
      }

      for (const o of routes) {
        let op = !tiers || tiers.has(o.r.tier) ? 1 : 0.12;
        if (path) op = Math.min(op, onRoute.has(o.i) ? 1 : 0.2);
        if (hover) op = Math.min(op, o.r.from === hover || o.r.to === hover ? 1 : 0.35);
        o.path.style.opacity = op;
        o.tag.style.opacity = op;
        o.path.classList.toggle('sb-on', onRoute.has(o.i));
        o.path.classList.toggle('sb-rev', rev.has(o.i));
      }

      for (const o of nodes) {
        const id = o.n.id;
        const hot = id === hover;
        o.g.classList.toggle('sb-hot', hot);
        o.g.classList.toggle('sb-picked', picked.has(id));
        o.g.style.opacity = path && !onNode.has(id) && !hot && !picked.has(id) ? 0.55 : 1;
        o.ring.setAttribute('stroke', hot ? '#ffffff' : GREY);
        o.ringCore.style.opacity = hot ? 0.3 : 0;
        o.label.classList.toggle('sb-hot', hot || onNode.has(id));
        o.label.style.opacity = path && !onNode.has(id) && !hot ? 0.5 : '';
      }
    },
  };

  api.setState({});
  return api;
}
