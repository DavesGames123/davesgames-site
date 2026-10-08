// ============================================================================
//  MAP PROJECTIONS  ·  render.js — the map on a 2D canvas
// ----------------------------------------------------------------------------
//  MapView draws one map, or a morph between two, into a canvas at the
//  device pixel ratio. All lines go through geo.js each time the map
//  changes (vectors, never a scaled raster), so they stay sharp at any size.
//
//  LEVEL OF DETAIL. "fast" uses ne_110m_land and no borders (2-6 ms in
//  node); "full" uses ne_50m_land, its coast and the 50m land borders
//  (40-80 ms). A drag, a morph and the saver draw fast; 160 ms after the
//  last change the view draws full once.
//
//  LAYERS (back to front): ocean (the outline filled), heatmap (an image
//  under the land, clipped to the outline), graticule, land, borders,
//  coast, outline stroke. Tools draw on a second canvas over this one
//  (tools.js), so a hover does not draw the map again.
//
//  GREP MAP
//    grep -n 'export const THEME'      colours
//    grep -n 'export function loadData'  world.json + the borders file
//    grep -n 'class MapView'            the view: setState, fit, draw
//    grep -n 'fitFrame'                 raw bounds -> screen transform
// ============================================================================
import { makeMap, BY_KEY, D, vec } from './proj.js';
import { frameOf, clipPolygon, clipLine, outline, edgeLines, graticule, ringsFromFlat, seamlessLines } from './geo.js';

export const THEME = {
  bg: '#06080d',
  ocean0: '#13283f', ocean1: '#0a1626',
  grat: 'rgba(150,190,235,0.16)', gratMajor: 'rgba(150,190,235,0.30)',
  land: '#d4c39b', landHeat: 'rgba(235,228,210,0.10)',
  coast: 'rgba(40,30,14,0.55)', coastHeat: 'rgba(250,246,236,0.85)',
  border: 'rgba(70,52,24,0.42)', edge: '#92b6dc',
};

// world.json (this page) and the 50m land borders from ancient-earth
// (same Natural Earth source, reused by URL). Borders are optional.
export async function loadData(base = new URL('.', import.meta.url)) {
  const w = await (await fetch(new URL('data/world.json', base))).json();
  const data = {
    land: ringsFromFlat(w.land), coast: seamlessLines(w.land),
    land110: ringsFromFlat(w.land110), coast110: seamlessLines(w.land110),
    countries: w.countries.map(c => ({ name: c.n, a3: c.a3, cont: c.c, lx: c.lx, ly: c.ly, flat: c.r, rings: ringsFromFlat(c.r), lines: seamlessLines(c.r) })),
    borders: [],
  };
  try {
    const o = await (await fetch(new URL('../ancient-earth/data/overlays.json', base))).json();
    // Each line: [plate id, lon, lat, lon, lat, ...] in 1/100 deg.
    data.borders = o.borders.map(l => { const out = []; for (let i = 1; i + 1 < l.length; i += 2) out.push(vec(l[i] * 0.01 * D, l[i + 1] * 0.01 * D)); return out; }).filter(l => l.length > 1);
  } catch (e) { /* borders are a detail; the map works without them */ }
  return data;
}

// The screen transform that fits map m in the box (CSS px), with zoom and
// a pan offset. Returns { k, x, y } for frameOf.
export function fitFrame(m, box, zoom = 1, pan = [0, 0], pad = 0.04) {
  const f0 = frameOf(m, { k: 1, x: 0, y: 0, sy: 1 });
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const pc of outline([f0], { tol: 0.002, maxSeg: 0.08 })) for (let i = 0; i < pc.xy.length; i += 2) {
    const x = pc.xy[i], y = pc.xy[i + 1]; if (!isFinite(x) || !isFinite(y)) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const w = box.w * (1 - 2 * pad), h = box.h * (1 - 2 * pad);
  const k = Math.min(w / (x1 - x0), h / (y1 - y0)) * zoom;
  // box.align 'top': a map with spare height sits near the top, so the
  // card and the globe at the bottom cover less of it.
  let cy = box.y + box.h / 2;
  if (box.align === 'top' && zoom <= 1) { const mh = k * (y1 - y0), spare = box.h * (1 - 2 * pad) - mh; if (spare > 0) cy -= spare * 0.45; }
  return { k, x: box.x + box.w / 2 - k * (x0 + x1) / 2 + pan[0], y: cy + k * (y0 + y1) / 2 + pan[1], bounds: [x0, x1, y0, y1] };
}

export class MapView {
  constructor(canvas, data) {
    this.c = canvas; this.g = canvas.getContext('2d');
    this.data = data;
    this.dpr = 1; this.W = 0; this.H = 0;
    this.box = { x: 0, y: 0, w: 1, h: 1 };
    this.state = null; this.map = null; this.frames = null;
    this.zoom = 1; this.pan = [0, 0];
    this.heat = null;          // { canvas, key } from tools.js
    this.cache = new Map();
    this.grat = graticule(15); this.gratMajor = [];
    this.opts = { borders: true, graticule: true };
  }
  resize(w, h, dpr = Math.min(3, window.devicePixelRatio || 1)) {
    this.W = w; this.H = h; this.dpr = dpr;
    const cw = Math.round(w * dpr), ch = Math.round(h * dpr);
    if (this.c.width !== cw || this.c.height !== ch) { this.c.width = cw; this.c.height = ch; }
    this.cache.clear(); this.stKey = null;
  }
  // box: the clear part of the canvas (CSS px) the map should fit in.
  setBox(b) {
    const o = this.box;
    if (o && o.x === b.x && o.y === b.y && o.w === b.w && o.h === b.h && o.align === b.align) return;
    this.box = b; this.cache.clear(); this.stKey = null;
  }
  // state: { key, lon, lat, roll, aspect, lat0, lat1, lat2 }
  setState(st) {
    // The same state, box and zoom keep the cached geometry.
    const key = JSON.stringify([st, this.zoom, this.pan, this.W, this.H]);
    if (key === this.stKey && this.frames && this.frames.length === 1) return this.map;
    this.stKey = key;
    this.state = st; this.map = makeMap(st.key, st);
    this.screen = fitFrame(this.map, this.box, this.zoom, this.pan);
    this.frames = [frameOf(this.map, this.screen)];
    this.cache.clear();
    return this.map;
  }
  // A morph: frames for maps a and b with weights 1 - t and t. lat bounds
  // and the azimuthal edge open smoothly (see the saver and main.js), so
  // nothing pops in at the end.
  setMorph(stA, stB, t, rectsA = null, rectsB = null) {
    const a = makeMap(stA.key, stA), b = makeMap(stB.key, stB);
    const sa = fitFrame(a, this.box, this.zoom, this.pan), sb = fitFrame(b, this.box, this.zoom, this.pan);
    this.map = t < 0.5 ? a : b;
    this.frames = [frameOf(a, sa, 1 - t, rectsA), frameOf(b, sb, t, rectsB)];
    this.cache.clear(); this.stKey = null;
  }
  setFrames(frames, map) { this.frames = frames; this.map = map; this.cache.clear(); }

  // Geometry for the current frames, cached by level of detail.
  geom(lod) {
    const hit = this.cache.get(lod); if (hit) return hit;
    const F = this.frames, d = this.data, full = lod === 'full';
    const tol = full ? 0.3 : 0.45;
    const out = {
      edge: outline(F, { tol }),
      rim: edgeLines(F, { tol }),
      land: clipPolygon(full ? d.land : d.land110, F, { tol }),
      coast: (full ? d.coast : d.coast110).flatMap(l => clipLine(l, F, { tol })),
      grat: this.opts.graticule ? this.grat.flatMap(l => clipLine(l, F, { tol: 0.5 })) : [],
      borders: full && this.opts.borders ? d.borders.flatMap(l => clipLine(l, F, { tol })) : [],
    };
    this.cache.set(lod, out);
    return out;
  }

  draw(lod = 'full', o = {}) {
    const g = this.g, T = THEME, s = this.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (o.bg === 'transparent') g.clearRect(0, 0, this.c.width, this.c.height);
    else { g.fillStyle = o.bg || T.bg; g.fillRect(0, 0, this.c.width, this.c.height); }
    if (!this.frames) return;
    g.setTransform(s, 0, 0, s, 0, 0);
    const G = this.geom(lod), heat = o.heat && this.heat;
    const alpha = o.alpha ?? 1;
    g.globalAlpha = alpha;
    // ocean
    const edge = new Path2D(); addPieces(edge, G.edge, true);
    const grd = g.createRadialGradient(this.box.x + this.box.w / 2, this.box.y + this.box.h / 2, 0, this.box.x + this.box.w / 2, this.box.y + this.box.h / 2, Math.max(this.box.w, this.box.h) * 0.6);
    grd.addColorStop(0, T.ocean0); grd.addColorStop(1, T.ocean1);
    g.fillStyle = grd; g.fill(edge);
    if (heat) {
      g.save(); g.clip(edge); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      const h = this.heat, c = h.cell; g.drawImage(h.canvas, -c / 2, -c / 2, h.gw * c, h.gh * c); g.restore();   // pixel i sits at x = i * cell
    }
    // graticule
    if (G.grat.length) {
      const gp = new Path2D(); addPieces(gp, G.grat, false);
      g.strokeStyle = T.grat; g.lineWidth = 0.8; g.stroke(gp);
    }
    // land
    const lp = new Path2D(); addPieces(lp, G.land, true);
    g.fillStyle = heat ? T.landHeat : (o.land || T.land); g.fill(lp);
    if (G.borders.length && !heat) {
      const bp = new Path2D(); addPieces(bp, G.borders, false);
      g.strokeStyle = T.border; g.lineWidth = 0.6; g.stroke(bp);
    }
    const cp = new Path2D(); addPieces(cp, G.coast, false);
    g.strokeStyle = heat ? T.coastHeat : T.coast; g.lineWidth = heat ? 0.8 : 0.6; g.lineJoin = 'round'; g.stroke(cp);
    // edge
    const rim = new Path2D(); addPieces(rim, G.rim, false);
    g.strokeStyle = o.edge || T.edge; g.lineWidth = 1.2; g.stroke(rim);
    g.globalAlpha = 1;
    this.edgePath = edge;
  }
}

export function addPieces(path, pieces, close) {
  for (const pc of pieces) {
    const q = pc.xy; if (q.length < 4) continue;
    path.moveTo(q[0], q[1]);
    for (let i = 2; i < q.length; i += 2) path.lineTo(q[i], q[i + 1]);
    if (close) path.closePath();
  }
}
export { BY_KEY };
