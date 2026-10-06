// ============================================================================
//  coast.mjs — make src/data/coast50.bin for the earth example
// ----------------------------------------------------------------------------
//  Input: the Natural Earth 50m coastline GeoJSON (public domain), from
//    https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_coastline.geojson
//  Each line is thinned with Ramer-Douglas-Peucker (tolerance in degrees,
//  0.04 for the committed file) and written as little endian binary:
//    u16 line count, then per line: u16 n, n x (i16 lng*100, i16 lat*100)
//
//    node tools/coast.mjs ne_50m_coastline.geojson src/data/coast50.bin 0.04
// ============================================================================
import fs from 'node:fs';
const [src, out, tolArg] = process.argv.slice(2);
const tol = +(tolArg || 0.04);
const j = JSON.parse(fs.readFileSync(src, 'utf8'));
function dp(pts, eps) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  let idx = -1, dmax = 0;
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i];
    let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax > eps) { const a = dp(pts.slice(0, idx + 1), eps), b = dp(pts.slice(idx), eps); return a.slice(0, -1).concat(b); }
  return [pts[0], pts[pts.length - 1]];
}
const lines = [];
for (const f of j.features) {
  const g = f.geometry; const ls = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
  for (const c of ls) { const s = dp(c, tol); if (s.length >= 3 || (s.length === 2 && c.length > 6)) lines.push(s); }
}
let n = 0; for (const l of lines) n += l.length;
const buf = Buffer.alloc(2 + lines.length * 2 + n * 4); let o = 0;
buf.writeUInt16LE(lines.length, o); o += 2;
for (const l of lines) { buf.writeUInt16LE(l.length, o); o += 2; for (const [lng, lat] of l) { buf.writeInt16LE(Math.round(lng * 100), o); buf.writeInt16LE(Math.round(lat * 100), o + 2); o += 4; } }
fs.writeFileSync(out, buf);
console.log('lines', lines.length, 'points', n, 'bytes', buf.length);
