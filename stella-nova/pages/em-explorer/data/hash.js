// MurmurHash3 x86_128 for neuroglancer sharded v1 ("murmurhash3_x86_128").
// The shard spec hashes the 8 little-endian bytes of (chunk id >>
// preshift_bits) with seed 0 and keeps the low 64 bits of the output.

function rotl(x, r) { return (x << r) | (x >>> (32 - r)); }
function fmix(h) {
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h;
}

// Returns [h1, h2, h3, h4] as unsigned 32-bit numbers.
export function murmur3_x86_128(bytes, seed = 0) {
  const c1 = 0x239b961b, c2 = 0xab0e9789, c3 = 0x38b34ae5, c4 = 0xa1e38b93;
  const len = bytes.length;
  const nblocks = len >>> 4;
  let h1 = seed | 0, h2 = seed | 0, h3 = seed | 0, h4 = seed | 0;
  const rd = (i) => bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24);
  for (let b = 0; b < nblocks; b++) {
    const i = b * 16;
    let k1 = rd(i), k2 = rd(i + 4), k3 = rd(i + 8), k4 = rd(i + 12);
    k1 = Math.imul(k1, c1); k1 = rotl(k1, 15); k1 = Math.imul(k1, c2); h1 ^= k1;
    h1 = rotl(h1, 19); h1 = (h1 + h2) | 0; h1 = (Math.imul(h1, 5) + 0x561ccd1b) | 0;
    k2 = Math.imul(k2, c2); k2 = rotl(k2, 16); k2 = Math.imul(k2, c3); h2 ^= k2;
    h2 = rotl(h2, 17); h2 = (h2 + h3) | 0; h2 = (Math.imul(h2, 5) + 0x0bcaa747) | 0;
    k3 = Math.imul(k3, c3); k3 = rotl(k3, 17); k3 = Math.imul(k3, c4); h3 ^= k3;
    h3 = rotl(h3, 15); h3 = (h3 + h4) | 0; h3 = (Math.imul(h3, 5) + 0x96cd1c35) | 0;
    k4 = Math.imul(k4, c4); k4 = rotl(k4, 18); k4 = Math.imul(k4, c1); h4 ^= k4;
    h4 = rotl(h4, 13); h4 = (h4 + h1) | 0; h4 = (Math.imul(h4, 5) + 0x32ac3b17) | 0;
  }
  const t = nblocks * 16;
  let k1 = 0, k2 = 0, k3 = 0, k4 = 0;
  switch (len & 15) {
    case 15: k4 ^= bytes[t + 14] << 16; // falls through
    case 14: k4 ^= bytes[t + 13] << 8; // falls through
    case 13: k4 ^= bytes[t + 12];
      k4 = Math.imul(k4, c4); k4 = rotl(k4, 18); k4 = Math.imul(k4, c1); h4 ^= k4; // falls through
    case 12: k3 ^= bytes[t + 11] << 24; // falls through
    case 11: k3 ^= bytes[t + 10] << 16; // falls through
    case 10: k3 ^= bytes[t + 9] << 8; // falls through
    case 9: k3 ^= bytes[t + 8];
      k3 = Math.imul(k3, c3); k3 = rotl(k3, 17); k3 = Math.imul(k3, c4); h3 ^= k3; // falls through
    case 8: k2 ^= bytes[t + 7] << 24; // falls through
    case 7: k2 ^= bytes[t + 6] << 16; // falls through
    case 6: k2 ^= bytes[t + 5] << 8; // falls through
    case 5: k2 ^= bytes[t + 4];
      k2 = Math.imul(k2, c2); k2 = rotl(k2, 16); k2 = Math.imul(k2, c3); h2 ^= k2; // falls through
    case 4: k1 ^= bytes[t + 3] << 24; // falls through
    case 3: k1 ^= bytes[t + 2] << 16; // falls through
    case 2: k1 ^= bytes[t + 1] << 8; // falls through
    case 1: k1 ^= bytes[t];
      k1 = Math.imul(k1, c1); k1 = rotl(k1, 15); k1 = Math.imul(k1, c2); h1 ^= k1;
  }
  h1 ^= len; h2 ^= len; h3 ^= len; h4 ^= len;
  h1 = (h1 + h2) | 0; h1 = (h1 + h3) | 0; h1 = (h1 + h4) | 0;
  h2 = (h2 + h1) | 0; h3 = (h3 + h1) | 0; h4 = (h4 + h1) | 0;
  h1 = fmix(h1); h2 = fmix(h2); h3 = fmix(h3); h4 = fmix(h4);
  h1 = (h1 + h2) | 0; h1 = (h1 + h3) | 0; h1 = (h1 + h4) | 0;
  h2 = (h2 + h1) | 0; h3 = (h3 + h1) | 0; h4 = (h4 + h1) | 0;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

// Low 64 bits of murmur3_x86_128 over the 8 LE bytes of a BigInt key.
export function murmurHash64(key) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt.asUintN(64, key), true);
  const [h1, h2] = murmur3_x86_128(b, 0);
  return (BigInt(h2) << 32n) | BigInt(h1);
}
