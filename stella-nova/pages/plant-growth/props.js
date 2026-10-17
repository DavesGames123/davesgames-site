// ============================================================================
//  PLANT GROWTH  ·  natural objects round the plants (DOM-free)
// ----------------------------------------------------------------------------
//  The scene round the plants has scanned CC0 objects from Poly Haven
//  (tools/prep-props.py packs them into assets/props.bin and props.json):
//  mossy rocks, a tree stump, ferns, lesser celandine and grass clumps.
//  scatterProps() places them with a seed: rocks and the stump in the
//  middle distance, ferns at their feet and under the crowns, celandine
//  in patches, grass clumps everywhere. Nothing lands on a trunk, in the
//  soil cut-away, or on the trunk side of a rock. decodeMesh() turns one
//  packed mesh back into Float32 arrays for a BufferGeometry.
//
//  grep -n targets
//    placement .......... "export function scatterProps"
//    decode ............. "export function decodeMesh"
// ============================================================================
import { rng } from '../../lib/dla-engine.js';
import { groundY, inCutaway } from './ground.js';

// opts: seed, plants [{ x, z, r (crown radius), trunk (m) }], cut (cut-away
// radius or 0), meshes (props.json meshes), coarse. Returns [{ mesh (index
// into meshes), x, y, z, rot, scale, sink }].
export function scatterProps(opts) {
  const r = rng(opts.seed ?? 9), M = opts.meshes || [], out = [];
  const bySet = {};
  M.forEach((m, k) => { (bySet[m.set] = bySet[m.set] || []).push(k); });
  const plants = opts.plants || [{ x: 0, z: 0, r: 2, trunk: 0.5 }];
  const k = opts.coarse ? 0.45 : 1;
  const free = (x, z, pad) => {
    if (opts.cut && inCutaway(x, z, opts.cut + pad)) return false;
    for (const p of plants) if (Math.hypot(x - p.x, z - p.z) < (p.trunk || 0.4) + pad) return false;
    for (const o of out) if (o.big && Math.hypot(x - o.x, z - o.z) < o.rad + pad) return false;
    return true;
  };
  const put = (set, x, z, scale, extra = {}) => {
    const list = bySet[set]; if (!list) return null;
    const mesh = list[Math.floor(r() * list.length)], b = M[mesh].box;
    const o = Object.assign({ mesh, set, x, z, y: groundY(x, z), rot: r() * Math.PI * 2, scale, sink: 0 }, extra);
    o.rad = Math.max(b[3] - b[0], b[5] - b[2]) * 0.5 * scale;
    out.push(o);
    return o;
  };
  const ring = (r0, r1) => { const a = r() * Math.PI * 2, d = r0 + (r1 - r0) * Math.sqrt(r()); return [Math.cos(a) * d, Math.sin(a) * d]; };
  // rocks: a few boulders in the middle distance, half sunk
  const anchors = [];
  for (let n = 0, tries = 0; n < Math.round(7 * k) + 2 && tries < 200; tries++) {
    const [x, z] = ring(6, 24), s = 0.32 + 0.5 * r() * r();
    if (!free(x, z, 1.6 * s + 0.5)) continue;
    const o = put('rocks', x, z, s, { big: true }); if (!o) break;
    o.sink = 0.18 * s; anchors.push(o); n++;
  }
  // the stump of an old tree
  for (let tries = 0; tries < 60; tries++) {
    const [x, z] = ring(5, 11);
    if (!free(x, z, 1.2)) continue;
    const o = put('stump', x, z, 0.9 + 0.3 * r(), { big: true }); if (o) { o.sink = 0.03; anchors.push(o); }
    break;
  }
  // ferns: at the feet of the rocks and the stump, and under the crowns
  for (let n = 0, tries = 0; n < Math.round(34 * k) && tries < 600; tries++) {
    let x, z;
    if (anchors.length && r() < 0.6) { const a = anchors[Math.floor(r() * anchors.length)], t = r() * Math.PI * 2, d = a.rad + 0.2 + 0.9 * r(); x = a.x + Math.cos(t) * d; z = a.z + Math.sin(t) * d; }
    else { const p = plants[Math.floor(r() * plants.length)], t = r() * Math.PI * 2, d = Math.max(1.2, p.r * (0.5 + 0.7 * r())); x = p.x + Math.cos(t) * d; z = p.z + Math.sin(t) * d; }
    if (!free(x, z, 0.3)) continue;
    put('fern', x, z, 0.8 + 0.6 * r()); n++;
  }
  // celandine: patches of yellow spring flowers
  for (let c = 0; c < Math.round(7 * k) + 1; c++) {
    const [cx, cz] = ring(2.5, 15);
    for (let n = 0; n < 9; n++) {
      const x = cx + (r() - 0.5) * 2.2, z = cz + (r() - 0.5) * 2.2;
      if (free(x, z, 0.1)) put('celandine', x, z, 0.9 + 0.5 * r());
    }
  }
  // grass clumps: tufts of real grass among the blades
  for (let n = 0, tries = 0; n < Math.round(160 * k) && tries < 1200; tries++) {
    const [x, z] = ring(1, 20);
    if (!free(x, z, 0.05)) continue;
    put('grass', x, z, 1.0 + 1.4 * r()); n++;
  }
  return out;
}

// One packed mesh -> { pos Float32Array, nrm Int8Array, uv Float32Array,
// idx Uint16Array }. buf is the ArrayBuffer of props.bin.
export function decodeMesh(buf, m) {
  const q = new Uint16Array(buf, m.pos, m.n * 3), b = m.box;
  const pos = new Float32Array(m.n * 3);
  for (let i = 0; i < m.n; i++) for (let c = 0; c < 3; c++) pos[i * 3 + c] = b[c] + q[i * 3 + c] / 65535 * (b[c + 3] - b[c]);
  const qu = new Uint16Array(buf, m.uv, m.n * 2), u = m.uvBox;
  const uv = new Float32Array(m.n * 2);
  for (let i = 0; i < m.n; i++) for (let c = 0; c < 2; c++) uv[i * 2 + c] = u[c] + qu[i * 2 + c] / 65535 * (u[c + 2] - u[c]);
  return { pos, nrm: new Int8Array(buf, m.nrm, m.n * 3), uv, idx: new Uint16Array(buf, m.idx, m.i) };
}
