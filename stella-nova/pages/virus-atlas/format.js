// ============================================================================
//  VIRUS ATLAS  ·  format.js — read the bead files in data/
// ----------------------------------------------------------------------------
//  No DOM and no three.js: tests.mjs runs this file in Node.
//
//  A data file comes from tools/build-data.py (see its header for the
//  byte layout). It holds the asymmetric unit (AU) of one PDB entry as one
//  bead per residue, plus the symmetry operators that make the particle.
//
//  decode(buffer)   -> { info, pos, chain, flags, n }
//      pos     Float32Array(3n), nm (the file holds 0.1 A steps)
//      chain   Uint16Array(n), index into info.chains
//      flags   Uint8Array(n): bits 0-1 secondary structure, 2-4 class
//  copyOps(info, nOverride) -> Float32Array(12 m): m operators as 3x4 rows,
//      translation in nm. A helix (a rod or a fibril) makes its layers
//      from the screw (twist, rise), centred on layer 0.
//  helixLayer(k, n) the index of layer k, counted from the middle
//  fetchBin(url, onProgress) streams the file into one buffer. It never
//      sizes a buffer from content-length: GitHub Pages sends gzip, so
//      content-length is the compressed size (see gzip memory note).
//
//  grep -n targets: "export function decode", "export function copyOps",
//                   "export async function fetchBin", "export const SS"
// ============================================================================

export const SS = ['coil', 'helix', 'strand'];
export const CLASS = ['hydrophobic', 'polar', 'positive', 'negative', 'special (G, P, C)', 'nucleotide', 'sugar', 'other'];

export function decode(buf) {
  const u8 = new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer, buf.byteOffset || 0, buf.byteLength);
  const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
  if (magic !== 'VAT1') throw new Error('not a virus-atlas bead file');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const jl = dv.getUint32(4, true);
  const info = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + jl)));
  const n = info.n;
  let off = 8 + jl;
  const pos = new Float32Array(3 * n), s = info.q / 10;
  for (let i = 0; i < 3 * n; i++) pos[i] = dv.getInt16(off + 2 * i, true) * s;
  off += 6 * n;
  const chain = new Uint16Array(n);
  for (let i = 0; i < n; i++) chain[i] = dv.getUint16(off + 2 * i, true);
  off += 2 * n;
  const flags = u8.slice(off, off + n);
  if (flags.length !== n) throw new Error('bead file is short');
  return { info, pos, chain, flags, n };
}

// The layers run from -(n-1)/2 to (n-1)/2, so the rod is centred on the
// origin. helixLayer(k, n) gives the signed layer number of copy k.
export function helixLayer(k, n) { return k - (n - 1) / 2; }

export function copyOps(info, nOverride) {
  if (info.helix) {
    const h = info.helix, n = nOverride || h.n, out = new Float32Array(12 * n);
    for (let k = 0; k < n; k++) {
      const j = helixLayer(k, n), a = j * h.twist, c = Math.cos(a), s = Math.sin(a), o = 12 * k;
      // rotation about +y by a, then a shift of j * rise along y
      out.set([c, 0, s, 0, 0, 1, 0, j * h.rise / 10, -s, 0, c, 0], o);
    }
    return out;
  }
  const m = info.ops.length, out = new Float32Array(12 * m);
  for (let k = 0; k < m; k++) {
    const o = info.ops[k];
    for (let r = 0; r < 3; r++) {
      out[12 * k + 4 * r] = o[4 * r]; out[12 * k + 4 * r + 1] = o[4 * r + 1]; out[12 * k + 4 * r + 2] = o[4 * r + 2];
      out[12 * k + 4 * r + 3] = o[4 * r + 3] / 10;
    }
  }
  return out;
}

// Apply operator k (3x4 rows) to point p.
export function applyOp(ops, k, x, y, z, out = [0, 0, 0]) {
  const o = 12 * k;
  out[0] = ops[o] * x + ops[o + 1] * y + ops[o + 2] * z + ops[o + 3];
  out[1] = ops[o + 4] * x + ops[o + 5] * y + ops[o + 6] * z + ops[o + 7];
  out[2] = ops[o + 8] * x + ops[o + 9] * y + ops[o + 10] * z + ops[o + 11];
  return out;
}

// Stream a file into one buffer. onProgress(f) gets 0..1 (clamped), from
// content-length when the server sends it.
export async function fetchBin(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + ': HTTP ' + res.status);
  const hint = +res.headers.get('content-length') || 0;
  if (!res.body || !res.body.getReader) return new Uint8Array(await res.arrayBuffer());
  const rd = res.body.getReader(), parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    parts.push(value); got += value.length;
    if (onProgress && hint) onProgress(Math.min(1, got / hint));
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  if (onProgress) onProgress(1);
  return out;
}
