#!/usr/bin/env node
// ============================================================================
//  STORM GLOBE  ·  tools/coast.mjs  ·  write the coastline files
// ----------------------------------------------------------------------------
//  Reads the Natural Earth land and lake polygons (GeoJSON, public domain,
//  github.com/nvkelso/natural-earth-vector, folder geojson/) and writes two
//  files in the coast.js binary format (see "export function decodeCoast"):
//
//    data/coast-50m.bin   ne_50m_land + ne_50m_lakes, simplified to 0.02 deg.
//                         The page loads it at boot: the land fill and the
//                         far coastline.
//    data/coast-10m.bin   ne_10m_land + ne_10m_lakes (scalerank <= 6),
//                         simplified to 0.006 deg (about 0.7 km). The page
//                         loads it after the first frame: the near coastline
//                         (altitude below coast.js LOD_ALT).
//
//    node stella-nova/pages/storm-globe/tools/coast.mjs <dir with the .geojson files>
//
//  Simplification: Douglas-Peucker on (lon cos(lat), lat) in degrees. A
//  ring with a bounding box smaller than the minimum size goes.
//
//  grep -n targets: "function simplify", "const LODS"
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeCoast } from '../coast.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.argv[2];
if (!SRC) { console.error('usage: node tools/coast.mjs <dir with ne_*_land.geojson and ne_*_lakes.geojson>'); process.exit(2); }

// tol: simplification tolerance (deg); minDeg: smallest ring kept (bbox, deg)
const LODS = [
  { out: 'coast-50m.bin', land: 'ne_50m_land.geojson', lakes: 'ne_50m_lakes.geojson', tol: 0.02, minDeg: 0.12, lakeRank: 99 },
  { out: 'coast-10m.bin', land: 'ne_10m_land.geojson', lakes: 'ne_10m_lakes.geojson', tol: 0.006, minDeg: 0.05, lakeRank: 6 },
];

function rings(file, maxRank) {
  const g = JSON.parse(fs.readFileSync(path.join(SRC, file), 'utf8')), out = [];
  for (const f of g.features) {
    if ((f.properties.scalerank ?? 0) > maxRank) continue;
    const gm = f.geometry, polys = gm.type === 'Polygon' ? [gm.coordinates] : gm.coordinates;
    for (const pl of polys) for (const r of pl) out.push(r);
  }
  return out;
}
// Douglas-Peucker, iterative; keeps the first and the last point
function simplify(ring, tol) {
  const n = ring.length; if (n < 4) return ring;
  const xy = ring.map(([lo, la]) => [lo * Math.cos(la * Math.PI / 180), la]);
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let best = -1, bd = tol;
    const [ax, ay] = xy[a], [bx, by] = xy[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i];
      const d = L < 1e-12 ? Math.hypot(px - ax, py - ay) : Math.abs(dx * (ay - py) - dy * (ax - px)) / L;
      if (d > bd) { bd = d; best = i; }
    }
    if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return ring.filter((_, i) => keep[i]);
}
const big = (r, minDeg) => {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const [x, y] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return Math.max(x1 - x0, y1 - y0) >= minDeg;
};

for (const L of LODS) {
  const out = [];
  for (const [file, kind, rank] of [[L.land, 0, 99], [L.lakes, 1, L.lakeRank]]) {
    for (const r of rings(file, rank)) {
      if (!big(r, L.minDeg)) continue;
      const s = simplify(r, L.tol);
      if (s.length < 4) continue;
      const pts = new Float64Array(s.length * 2);
      s.forEach(([lo, la], i) => { pts[i * 2] = lo; pts[i * 2 + 1] = la; });
      out.push({ kind, pts });
    }
  }
  const buf = encodeCoast(out);
  fs.writeFileSync(path.join(HERE, '..', 'data', L.out), buf);
  const np = out.reduce((a, r) => a + r.pts.length / 2, 0);
  console.log(`${L.out}: ${out.length} rings, ${np} points, ${buf.length} bytes`);
}
