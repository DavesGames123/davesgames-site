// ============================================================================
//  BREADBOARD LAB  ·  ui/share.js — a whole bench in a link
// ----------------------------------------------------------------------------
//  #d=<base64url(deflate-raw(JSON))> (CONTRACT 1.5). The browser's own
//  CompressionStream does the deflate, so there is no library. Where it is
//  missing, the link falls back to #j=<base64url(JSON)>, which every
//  decoder here also reads. A link longer than 8000 characters still works
//  in most browsers, but chat apps and some servers cut it: the FILE panel
//  warns and offers the JSON file instead.
//
//  GREP MAP
//    b64url / unb64url ..... bytes <-> URL-safe base64, no padding
//    deflate / inflate ..... CompressionStream('deflate-raw') round trip
//    encodeDoc / decodeHash  doc <-> 'd=...' (or 'j=...')
//    shareLink ............. { url, chars, warn }
//    LINK_WARN ............. 8000
// ============================================================================

export const LINK_WARN = 8000;

export function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64url(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function through(bytes, ts) {
  const w = ts.writable.getWriter();
  w.write(bytes).catch(() => {});
  w.close().catch(() => {});
  const r = ts.readable.getReader(), parts = [];
  let n = 0;
  for (;;) { const { value, done } = await r.read(); if (done) break; parts.push(value); n += value.length; }
  const out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export const canDeflate = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
export async function deflate(bytes) { return through(bytes, new CompressionStream('deflate-raw')); }
export async function inflate(bytes) { return through(bytes, new DecompressionStream('deflate-raw')); }

export async function encodeDoc(doc) {
  const json = new TextEncoder().encode(JSON.stringify(doc));
  if (canDeflate()) {
    try { return 'd=' + b64url(await deflate(json)); } catch (e) { /* fall through */ }
  }
  return 'j=' + b64url(json);
}
// '#d=...' | 'd=...' | '#j=...' -> doc (throws on a broken link)
export async function decodeHash(hash) {
  const m = /^#?(?:.*&)?([dj])=([A-Za-z0-9_-]+)/.exec(String(hash || ''));
  if (!m) return null;
  const bytes = unb64url(m[2]);
  const raw = m[1] === 'd' ? await inflate(bytes) : bytes;
  return JSON.parse(new TextDecoder().decode(raw));
}
export async function shareLink(doc, base) {
  const href = base || (typeof location !== 'undefined' ? location.href : 'https://example.invalid/');
  const url = href.split('#')[0] + '#' + await encodeDoc(doc);
  return { url, chars: url.length, warn: url.length > LINK_WARN };
}
