// ============================================================================
//  IMAGE WORLDS  ·  tools/formats.mjs — write SPZ, read splat PLY, pack GLB
// ────────────────────────────────────────────────────────────────────────────
//  Node only (zlib). make-sample.mjs builds the sample world with it, and
//  tests.mjs builds its fixture splats with it. The page never loads it.
//
//  SPLATS  a plain record of arrays, n splats:
//    { n, pos: Float32Array(3n), dc: Float32Array(3n)  (SH DC coefficients),
//      alpha: Float32Array(n)  (opacity after the sigmoid, 0..1),
//      lnScale: Float32Array(3n), quat: Float32Array(4n)  (x, y, z, w) }
//
//  EXPORTS
//    readPly(buf) ......... binary little-endian 3DGS PLY -> SPLATS (SH DC only)
//    writeSpz(s, o) ....... SPLATS -> gzip SPZ v2 Buffer (o.fractionalBits 12)
//    packGlb(json, bin) ... glTF JSON + one binary buffer -> GLB Buffer
//    gltfToGlb(gltf, read)  a .gltf with external buffers and images -> GLB;
//                           read(uri) returns the file bytes
//    wav16(samples, rate) . mono Float32 -1..1 -> 16-bit PCM WAV Buffer
// ============================================================================
import zlib from 'node:zlib';

export function readPly(buf) {
  const end = buf.indexOf('end_header\n');
  if (end < 0) throw new Error('PLY: no end_header');
  const hdr = buf.subarray(0, end).toString('latin1');
  if (!/format binary_little_endian/.test(hdr)) throw new Error('PLY: only binary_little_endian');
  const n = +/element vertex (\d+)/.exec(hdr)[1];
  const props = [...hdr.matchAll(/property (\S+) (\S+)/g)].map(m => { if (m[1] !== 'float') throw new Error('PLY: non-float property ' + m[2]); return m[2]; });
  const at = k => { const i = props.indexOf(k); if (i < 0) throw new Error('PLY: no ' + k); return i * 4; };
  const stride = props.length * 4, base = end + 'end_header\n'.length;
  const o = { x: at('x'), dc: at('f_dc_0'), op: at('opacity'), sc: at('scale_0'), r: at('rot_0') };
  const s = { n, pos: new Float32Array(3 * n), dc: new Float32Array(3 * n), alpha: new Float32Array(n), lnScale: new Float32Array(3 * n), quat: new Float32Array(4 * n) };
  for (let i = 0; i < n; i++) {
    const p = base + i * stride, f = k => buf.readFloatLE(p + k);
    for (let k = 0; k < 3; k++) {
      s.pos[3 * i + k] = f(o.x + 4 * k);
      s.dc[3 * i + k] = f(o.dc + 4 * k);
      s.lnScale[3 * i + k] = f(o.sc + 4 * k);
    }
    s.alpha[i] = 1 / (1 + Math.exp(-f(o.op)));
    // PLY rot_0..3 is (w, x, y, z); SPLATS keep (x, y, z, w).
    const w = f(o.r), x = f(o.r + 4), y = f(o.r + 8), z = f(o.r + 12), l = Math.hypot(w, x, y, z) || 1;
    s.quat.set([x / l, y / l, z / l, w / l], 4 * i);
  }
  return s;
}

const u8 = v => Math.max(0, Math.min(255, Math.round(v)));

export function writeSpz(s, { fractionalBits = 12, antialiased = false } = {}) {
  const n = s.n, head = 16;
  const out = Buffer.alloc(head + n * (9 + 1 + 3 + 3 + 3));
  out.writeUInt32LE(0x5053474e, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(n, 8);
  out[12] = 0; out[13] = fractionalBits; out[14] = antialiased ? 1 : 0; out[15] = 0;
  let o = head;
  const k = 1 << fractionalBits, lim = (1 << 23) - 1;
  for (let i = 0; i < 3 * n; i++) {
    let v = Math.round(s.pos[i] * k);
    if (v > lim || v < -lim - 1) throw new Error('SPZ: position out of range at ' + i);
    if (v < 0) v += 1 << 24;
    out[o++] = v & 255; out[o++] = (v >> 8) & 255; out[o++] = (v >> 16) & 255;
  }
  for (let i = 0; i < n; i++) out[o++] = u8(s.alpha[i] * 255);
  for (let i = 0; i < 3 * n; i++) out[o++] = u8(s.dc[i] * (0.15 * 255) + 0.5 * 255);
  for (let i = 0; i < 3 * n; i++) out[o++] = u8((s.lnScale[i] + 10) * 16);
  for (let i = 0; i < n; i++) {
    const q = s.quat.subarray(4 * i, 4 * i + 4), sg = q[3] < 0 ? -1 : 1;
    for (let c = 0; c < 3; c++) out[o++] = u8(q[c] * sg * 127.5 + 127.5);
  }
  return zlib.gzipSync(out, { level: 9 });
}

export function packGlb(json, bin) {
  const pad = (b, c) => { const r = (4 - (b.length % 4)) % 4; return r ? Buffer.concat([b, Buffer.alloc(r, c)]) : b; };
  const j = pad(Buffer.from(JSON.stringify(json)), 0x20), b = pad(bin, 0);
  const h = Buffer.alloc(12); h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(12 + 8 + j.length + 8 + b.length, 8);
  const cj = Buffer.alloc(8); cj.writeUInt32LE(j.length, 0); cj.writeUInt32LE(0x4e4f534a, 4);
  const cb = Buffer.alloc(8); cb.writeUInt32LE(b.length, 0); cb.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([h, cj, j, cb, b]);
}

// One .gltf (buffers and images as relative uris) -> one GLB: the buffers
// and the images go into the BIN chunk, each image as a bufferView.
export async function gltfToGlb(gltf, read) {
  const g = JSON.parse(JSON.stringify(gltf));
  const parts = []; let off = 0;
  const add = b => { const st = off; parts.push(b); off += b.length; const r = (4 - (off % 4)) % 4; if (r) { parts.push(Buffer.alloc(r)); off += r; } return st; };
  const bufStart = [];
  for (const b of g.buffers || []) bufStart.push(add(await read(b.uri)));
  for (const v of g.bufferViews || []) { v.byteOffset = (v.byteOffset || 0) + bufStart[v.buffer]; v.buffer = 0; }
  g.bufferViews = g.bufferViews || [];
  for (const im of g.images || []) {
    if (!im.uri) continue;
    const bytes = await read(im.uri), st = add(bytes);
    im.bufferView = g.bufferViews.length; im.mimeType = /\.png$/i.test(im.uri) ? 'image/png' : 'image/jpeg';
    g.bufferViews.push({ buffer: 0, byteOffset: st, byteLength: bytes.length });
    delete im.uri;
  }
  const bin = Buffer.concat(parts);
  g.buffers = [{ byteLength: bin.length }];
  return packGlb(g, bin);
}

export function wav16(x, rate = 44100) {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), 44 + 2 * i);
  return b;
}
