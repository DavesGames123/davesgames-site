// ============================================================================
//  CORAL REEF  ·  scanned models and their places (DOM-free)
// ----------------------------------------------------------------------------
//  assets/models/*.bin are CC0 Poly Haven scans (see CREDITS.txt), made
//  small by our build step (vertex clustering for the rocks, quantised
//  positions and normals): CRM1 files.
//    'CRM1', u32 json length, json { name, verts, tris, size [x, y, z] (m),
//    uv, index32 }, Int16 positions (x, z in -1..1 of the half size, y in
//    0..1 of the height), Int8 normals (xyz + pad), Uint16 uv (if uv),
//    Uint16 or Uint32 indices.
//  DECOR lists the models and how many go on the seabed. scatterDecor()
//  puts them on the real seabed (terrain.js groundY), away from the
//  colonies and the rocks, tilted to the ground, from a seed.
//
//  grep -n targets
//    model list ......... "export const DECOR"
//    parse a file ....... "export function parseCRM"
//    places ............. "export function scatterDecor"
// ============================================================================
import { groundY } from './terrain.js';
import { rng } from '../../lib/dla-engine.js';

// file: assets/models/<id>.bin. kind: rock (triplanar reef-rock shading)
// or shell (its own texture). n: instances (desktop). size: the scene size
// (largest horizontal extent, units) range. sink: part of the height under
// the ground.
export const DECOR = [
  { id: 'moon_rock_01', kind: 'rock', n: 14, size: [4.0, 9.9], sink: 0.25 },
  { id: 'moon_rock_02', kind: 'rock', n: 10, size: [4.5, 11.7], sink: 0.3 },
  { id: 'moon_rock_03', kind: 'rock', n: 16, size: [2.2, 5.8], sink: 0.2 },
  { id: 'moon_rock_04', kind: 'rock', n: 14, size: [2.7, 7.2], sink: 0.2 },
  { id: 'moon_rock_05', kind: 'rock', n: 18, size: [1.4, 4.3], sink: 0.2 },
  { id: 'moon_rock_06', kind: 'rock', n: 18, size: [1.6, 4.7], sink: 0.2 },
  { id: 'moon_rock_07', kind: 'rock', n: 16, size: [1.8, 5.0], sink: 0.2 },
  { id: 'rock_09', kind: 'rock', n: 10, size: [3.6, 8.1], sink: 0.25 },
  { id: 'lambis_shell', kind: 'shell', n: 7, size: [4.7, 6.1], sink: 0.12 },
];

export function parseCRM(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== 'CRM1') throw new Error('not a CRM1 file');
  const jl = dv.getUint32(4, true);
  const json = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + jl)));
  let o = 8 + jl;
  const nv = json.verts;
  const qp = new Int16Array(buf.slice(o, o + nv * 6)); o += nv * 6; o += (4 - (nv * 6) % 4) % 4;
  const qn = new Int8Array(buf.slice(o, o + nv * 4)); o += nv * 4;
  let uv = null;
  if (json.uv) { const q = new Uint16Array(buf.slice(o, o + nv * 4)); o += nv * 4; uv = new Float32Array(nv * 2); for (let i = 0; i < nv * 2; i++) uv[i] = q[i] / 65535; }
  const ni = json.tris * 3;
  const indices = json.index32 ? new Uint32Array(buf.slice(o, o + ni * 4)) : new Uint16Array(buf.slice(o, o + ni * 2));
  // unit model: largest horizontal extent 1, base at y = 0
  const [sx, sy, sz] = json.size, s = Math.max(sx, sz);
  const positions = new Float32Array(nv * 3), normals = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    positions[i * 3] = qp[i * 3] / 32767 * sx / 2 / s;
    positions[i * 3 + 1] = qp[i * 3 + 1] / 32767 * sy / s;
    positions[i * 3 + 2] = qp[i * 3 + 2] / 32767 * sz / 2 / s;
    const nx = qn[i * 4], ny = qn[i * 4 + 1], nz = qn[i * 4 + 2], l = Math.hypot(nx, ny, nz) || 1;
    normals[i * 3] = nx / l; normals[i * 3 + 1] = ny / l; normals[i * 3 + 2] = nz / l;
  }
  return { name: json.name, positions, normals, uv, indices, height: sy / s, json };
}

// Places for the models: { id: [ { x, y, z, s (scale), ry (turn), tx, tz (tilt) } ] }.
// keep(x, z, r) -> false where a model must not go (colonies, rocks).
// k scales the counts (phones draw fewer).
export function scatterDecor(seed, keep, k = 1, R = 120) {
  const rand = rng((seed >>> 0) * 7 + 3 || 1), out = {};
  const taken = [];
  for (const d of DECOR) {
    const list = out[d.id] = [];
    const n = Math.round(d.n * k);
    for (let tries = 0; list.length < n && tries < n * 40; tries++) {
      // more near the reef, some further out
      const a = rand() * Math.PI * 2, r = R * Math.pow(rand(), 0.7) + 8;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const s = d.size[0] + (d.size[1] - d.size[0]) * rand() * rand();
      if (!keep(x, z, s * 0.6)) continue;
      if (taken.some(q => Math.hypot(q[0] - x, q[1] - z) < q[2] + s * 0.55)) continue;
      taken.push([x, z, s * 0.55]);
      const e = 0.6;
      const gx = groundY(x + e, z) - groundY(x - e, z), gz = groundY(x, z + e) - groundY(x, z - e);
      list.push({ x, y: groundY(x, z) - s * (d.height || 0.5) * d.sink, z, s, ry: rand() * Math.PI * 2, tx: Math.atan2(gz, 2 * e) * 0.8, tz: -Math.atan2(gx, 2 * e) * 0.8 });
    }
  }
  return out;
}
