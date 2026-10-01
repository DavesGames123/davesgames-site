// ============================================================================
//  HUMAN SKULL  ·  fetch-buf.js — fetch a binary file with progress
// ────────────────────────────────────────────────────────────────────────────
//  fetchBuf(url, onProgress) returns an ArrayBuffer and calls onProgress
//  with 0..1 while the body arrives.
//
//  content-length is only a hint for progress. When the server compresses
//  the body (GitHub Pages sends skull.bin with gzip to a browser),
//  content-length is the compressed size, and the browser gives the
//  decoded bytes, which are more. A buffer of content-length bytes then
//  overflows ("RangeError: offset is out of bounds"). So the chunks are
//  kept in a list and joined at the end, at the real size.
//
//  No DOM and no THREE, so fetch-buf.test.mjs runs it in Node.
// ============================================================================
export async function fetchBuf(url, onProgress = () => {}) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const total = +res.headers.get('content-length') || 0;
  if (!res.body) return res.arrayBuffer();
  const reader = res.body.getReader(), chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    if (total) onProgress(Math.min(1, got / total));
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  onProgress(1);
  return out.buffer;
}
