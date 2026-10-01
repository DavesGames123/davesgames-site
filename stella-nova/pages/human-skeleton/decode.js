// ============================================================================
//  HUMAN SKELETON  ·  decode.js — data/*.bin.gz to typed arrays
// ────────────────────────────────────────────────────────────────────────────
//  No DOM and no THREE, so tests.mjs runs it in Node. build-data.py writes
//  one gzip file per body group; manifest.json gives each bone's byte
//  offsets inside the unzipped file and its quantization box.
//
//    pos  uint16 x3   p = qmin + q / 65535 * qsize   (metres, y up, +z front)
//    nrm  int8   x3   n = q / 127
//    cav  uint8  x1   cavity 0..1 (concave = 1)
//    idx  uint16 x3   triangle corners, local to the bone
//
//  GREP MAP
//    function gunzip       DecompressionStream, or the bytes as they are
//    function decodeBone   one bone: Float32 positions, Int8 normals, ...
//    function decodeGroup  all bones of one file, merged for one draw call
// ============================================================================

// A server can send the file already unzipped (Content-Encoding), so look
// at the gzip magic number before the bytes go through the decompressor.
export async function gunzip(buf) {
  const u8 = new Uint8Array(buf);
  if (u8.length < 2 || u8[0] !== 0x1f || u8[1] !== 0x8b) return buf;
  const ds = new DecompressionStream('gzip');
  const out = new Response(new Blob([u8]).stream().pipeThrough(ds));
  return out.arrayBuffer();
}

export function decodeBone(buf, b) {
  const q = new Uint16Array(buf, b.off.pos, b.v * 3);
  const pos = new Float32Array(b.v * 3);
  for (let i = 0; i < b.v; i++) {
    for (let k = 0; k < 3; k++) pos[3 * i + k] = b.qmin[k] + (q[3 * i + k] / 65535) * b.qsize[k];
  }
  return {
    pos,
    nrm: new Int8Array(buf, b.off.nrm, b.v * 3),
    cav: new Uint8Array(buf, b.off.cav, b.v),
    idx: new Uint16Array(buf, b.off.idx, b.t * 3),
  };
}

// Merge the bones of one file. `slot(b)` gives the row of the bone in the
// bone-state texture; the shader reads it from the aBone attribute.
export function decodeGroup(buf, bones, slot = b => b.i) {
  let nv = 0, nt = 0;
  for (const b of bones) { nv += b.v; nt += b.t; }
  const pos = new Float32Array(nv * 3), nrm = new Int8Array(nv * 3), cav = new Uint8Array(nv), bone = new Float32Array(nv);
  const idx = nv > 65535 ? new Uint32Array(nt * 3) : new Uint16Array(nt * 3);
  const ranges = [];
  let v0 = 0, t0 = 0;
  for (const b of bones) {
    const d = decodeBone(buf, b);
    pos.set(d.pos, v0 * 3); nrm.set(d.nrm, v0 * 3); cav.set(d.cav, v0);
    bone.fill(slot(b), v0, v0 + b.v);
    for (let i = 0; i < d.idx.length; i++) idx[t0 * 3 + i] = d.idx[i] + v0;
    ranges.push({ i: b.i, v0, nv: b.v, t0, nt: b.t });
    v0 += b.v; t0 += b.t;
  }
  return { pos, nrm, cav, bone, idx, ranges, nv, nt };
}
