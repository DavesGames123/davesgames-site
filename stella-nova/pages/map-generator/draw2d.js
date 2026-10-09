// draw2d.js — the 2D map: canvas drawing and SVG export. No DOM access
// beyond the 2D context it is given, so node (tests, thumbnail) can use it.
//
// drawMap(ctx, city, frame, view)
//   frame   playback.js frameAt(), or fullFrame(city) for the finished map
//   view    { w, h (CSS px), dpr, s (px per map unit), ox, oy (px of map 0,0),
//             fieldAt (gen.js fieldSampler) or null, layers: {field, lots} }
// toSVG(city, opts) -> string, the finished map in map units (y down)
// toJSON(city) -> string, the city data with the credit line
// heightColour(h) -> [r, g, b] 0..1, the colour ramp of city-atlas
//   buildings.wgsl (grey blue, blue, sand, warm), so the 2D lots and the
//   3D buildings agree.
//
// Layers, bottom to top: land, river, sea, coastline, parks, blocks, lots
// (by height), roads (minor, major, main), field crosses.
//
// grep: export const PAL  export function heightColour  export function drawMap
//       export function toSVG  export function toJSON  export function fullFrame

export const PAL = {
  land: '#2a2d31',
  outside: '#15171a',
  sea: '#0e2a35',
  river: '#12384a',
  shore: '#4f8796',
  park: '#33482f',
  parkEdge: '#4a6342',
  block: '#363a40',
  main: '#f0d39a',
  major: '#e6e1d5',
  minor: '#9da3ab',
  coastRoad: '#f0d39a',
  riverRoad: '#d8d2c4',
  field: [150, 185, 220],
};
export const WIDTH = { main: 4.2, major: 2.6, minor: 1.25, coast: 4.2, river: 2.6 };

export function heightColour(h) {
  const t = Math.min(1, Math.max(0, Math.log2(Math.max(h, 3) / 6) / Math.log2(30)));
  const a = [0.42, 0.45, 0.50], b = [0.48, 0.58, 0.70], c = [0.80, 0.74, 0.62], d = [0.98, 0.84, 0.60];
  const mix = (p, q, k) => p.map((v, i) => v + (q[i] - v) * k);
  if (t < 0.4) return mix(a, b, t / 0.4);
  if (t < 0.75) return mix(b, c, (t - 0.4) / 0.35);
  return mix(c, d, (t - 0.75) / 0.25);
}
const css = (c, k = 1) => `rgb(${Math.round(c[0] * 255 * k)},${Math.round(c[1] * 255 * k)},${Math.round(c[2] * 255 * k)})`;

export function fullFrame(city) {
  return {
    roads: city.roads, parks: city.parks, blocks: city.blocks, lots: city.lots,
    lotIds: city.lots.map((_, i) => i),
    buildings: city.buildings.map((b, i) => ({ lot: city.lots[i], h: b.h, i })),
    coast: 1, river: 1, field: 0, phase: 'done',
  };
}

function poly(ctx, p) {
  ctx.moveTo(p[0][0], p[0][1]);
  for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]);
  ctx.closePath();
}
function path(ctx, l) {
  ctx.moveTo(l[0][0], l[0][1]);
  for (let i = 1; i < l.length; i++) ctx.lineTo(l[i][0], l[i][1]);
}

// A sea polygon that shows part by part: the coast phase clips it with a
// growing disc from the middle of the coastline.
function revealClip(ctx, city, k) {
  const c = city.coastline.length ? city.coastline[city.coastline.length >> 1] : [city.view.w / 2, city.view.h / 2];
  const r = Math.hypot(city.domain.w, city.domain.h) * k;
  ctx.beginPath();
  ctx.arc(c[0], c[1], Math.max(r, 0.01), 0, Math.PI * 2);
  ctx.clip();
}

export function drawMap(ctx, city, frame, view) {
  const { w, h, dpr = 1, s, ox, oy } = view;
  const layers = view.layers || {};
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = PAL.outside;
  ctx.fillRect(0, 0, w, h);
  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
  const px = 1 / s;   // one CSS px in map units
  const d = city.domain;
  ctx.fillStyle = PAL.land;
  ctx.fillRect(d.x, d.y, d.w, d.h);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // water: the river first, so the sea covers its mouth
  if (frame.river > 0 && city.river.length > 2) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, frame.river * 1.5);
    ctx.fillStyle = PAL.river;
    ctx.beginPath(); poly(ctx, city.river); ctx.fill();
    ctx.restore();
  }
  if (frame.coast > 0 && city.sea.length > 2) {
    ctx.save();
    if (frame.coast < 1) revealClip(ctx, city, frame.coast);
    ctx.fillStyle = PAL.sea;
    ctx.beginPath(); poly(ctx, city.sea); ctx.fill();
    if (city.coastline.length > 1) {
      ctx.strokeStyle = PAL.shore; ctx.lineWidth = 1.4 * px;
      ctx.beginPath(); path(ctx, city.coastline); ctx.stroke();
    }
    ctx.restore();
  }
  // parks
  ctx.fillStyle = PAL.park; ctx.strokeStyle = PAL.parkEdge; ctx.lineWidth = 1 * px;
  for (const p of frame.parks) { ctx.beginPath(); poly(ctx, p); ctx.fill(); ctx.stroke(); }
  // blocks
  ctx.fillStyle = PAL.block;
  ctx.beginPath();
  for (const b of frame.blocks) poly(ctx, b);
  ctx.fill();
  // lots: outline as they split, the building colour as they rise
  if (layers.lots !== false) {
    const risen = new Map();
    for (const b of frame.buildings) risen.set(b.i, b.h);
    ctx.lineWidth = 0.8 * px;
    ctx.strokeStyle = 'rgba(20,22,26,0.9)';
    frame.lots.forEach((l, j) => {
      const i = frame.lotIds ? frame.lotIds[j] : j;
      const hh = risen.get(i);
      const full = city.buildings[i] ? city.buildings[i].h : 10;
      ctx.beginPath(); poly(ctx, l);
      if (hh !== undefined) {
        const k = full > 0 ? hh / full : 1;
        ctx.fillStyle = css(heightColour(full), 0.55 + 0.45 * k);
      } else ctx.fillStyle = '#41464d';
      ctx.fill(); ctx.stroke();
    });
  }
  // roads: casing then the line, minor first
  const roadSets = [['minor', PAL.minor], ['river', PAL.riverRoad], ['major', PAL.major], ['coast', PAL.coastRoad], ['main', PAL.main]];
  const sw = Math.max(0.6, Math.min(1.6, s)) * px;
  for (const [k, col] of roadSets) {
    const ls = frame.roads[k] || [];
    if (!ls.length) continue;
    ctx.strokeStyle = 'rgba(10,12,15,0.85)';
    ctx.lineWidth = (WIDTH[k] + 1.6) * sw;
    ctx.beginPath(); for (const l of ls) path(ctx, l); ctx.stroke();
    ctx.strokeStyle = col;
    ctx.lineWidth = WIDTH[k] * sw;
    ctx.beginPath(); for (const l of ls) path(ctx, l); ctx.stroke();
  }
  // tensor field: a cross of the two eigenvector directions on a grid
  if (frame.field > 0.01 && view.fieldAt && layers.field !== false) {
    const step = 22 * px, half = step * 0.36;
    const [r, g, b] = PAL.field;
    ctx.strokeStyle = `rgba(${r},${g},${b},${(0.55 * frame.field).toFixed(3)})`;
    ctx.lineWidth = 1 * px;
    const x0 = Math.max(d.x, -ox / s), y0 = Math.max(d.y, -oy / s);
    const x1 = Math.min(d.x + d.w, (w - ox) / s), y1 = Math.min(d.y + d.h, (h - oy) / s);
    ctx.beginPath();
    for (let y = Math.floor(y0 / step) * step + step / 2; y < y1; y += step) {
      for (let x = Math.floor(x0 / step) * step + step / 2; x < x1; x += step) {
        const v = view.fieldAt(x, y);
        if (!v) continue;
        ctx.moveTo(x - v[0] * half, y - v[1] * half); ctx.lineTo(x + v[0] * half, y + v[1] * half);
        ctx.moveTo(x + v[1] * half, y - v[0] * half); ctx.lineTo(x - v[1] * half, y + v[0] * half);
      }
    }
    ctx.stroke();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// Fit the view rectangle [0, view.w] x [0, view.h] of the city into a
// w x h box with a margin. Returns { s, ox, oy }.
export function fitView(city, w, h, margin = 0, band = null) {
  const top = band ? band.t : margin, bot = band ? band.b : margin;
  const s = Math.min((w - 2 * margin) / city.view.w, (h - top - bot) / city.view.h);
  return { s, ox: (w - city.view.w * s) / 2, oy: top + (h - top - bot - city.view.h * s) / 2 };
}

const n2 = (v) => Math.round(v * 10) / 10;
const pts = (p) => p.map((q) => `${n2(q[0])},${n2(q[1])}`).join(' ');

export function toSVG(city, opts = {}) {
  const { w, h } = city.view;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`);
  out.push(`<title>${opts.title || 'City'} (seed ${city.seed})</title>`);
  out.push(`<desc>${CREDIT}</desc>`);
  out.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="${PAL.land}"/>`);
  if (city.river.length > 2) out.push(`<polygon id="river" points="${pts(city.river)}" fill="${PAL.river}"/>`);
  if (city.sea.length > 2) out.push(`<polygon id="sea" points="${pts(city.sea)}" fill="${PAL.sea}"/>`);
  if (city.coastline.length > 1) out.push(`<polyline id="coastline" points="${pts(city.coastline)}" fill="none" stroke="${PAL.shore}" stroke-width="1.4"/>`);
  out.push(`<g id="parks" fill="${PAL.park}" stroke="${PAL.parkEdge}">${city.parks.map((p) => `<polygon points="${pts(p)}"/>`).join('')}</g>`);
  out.push(`<g id="blocks" fill="${PAL.block}">${city.blocks.map((p) => `<polygon points="${pts(p)}"/>`).join('')}</g>`);
  out.push(`<g id="lots" stroke="#14161a" stroke-width="0.8">${city.lots.map((p, i) => `<polygon points="${pts(p)}" fill="${css(heightColour(city.buildings[i].h))}" data-h="${city.buildings[i].h}"/>`).join('')}</g>`);
  for (const [k, col] of [['minor', PAL.minor], ['river', PAL.riverRoad], ['major', PAL.major], ['coast', PAL.coastRoad], ['main', PAL.main]]) {
    const ls = city.roads[k];
    if (!ls.length) continue;
    out.push(`<g id="roads-${k}" fill="none" stroke-linecap="round" stroke-linejoin="round">`);
    out.push(`<g stroke="#0a0c0f" stroke-width="${WIDTH[k] + 1.6}">${ls.map((l) => `<polyline points="${pts(l)}"/>`).join('')}</g>`);
    out.push(`<g stroke="${col}" stroke-width="${WIDTH[k]}">${ls.map((l) => `<polyline points="${pts(l)}"/>`).join('')}</g>`);
    out.push('</g>');
  }
  out.push('</svg>');
  return out.join('\n');
}

export const CREDIT = 'Generated with the City Generator on davesgames.io. Streets, water, parks and lots: MapGenerator by ProbableTrain (LGPL-3.0), https://github.com/probabletrain/mapgenerator';

export function toJSON(c) {
  return JSON.stringify({
    format: 'davesgames-city-generator', version: c.v, credit: CREDIT,
    units: 'map units, y down; the 3D view reads 1 unit as 1 m',
    seed: c.seed, options: c.opts, view: c.view, domain: c.domain, fields: c.fields,
    sea: c.sea, coastline: c.coastline, river: c.river, roads: c.roads, parks: c.parks,
    blocks: c.blocks, lots: c.lots, lotBlock: c.lotBlock, buildings: c.buildings.map((b) => b.h), events: c.events,
  });
}
