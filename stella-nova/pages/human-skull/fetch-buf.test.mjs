// HUMAN SKULL · fetch-buf.test.mjs — node fetch-buf.test.mjs
// A server that compresses the body sends a content-length smaller than
// the decoded bytes. fetchBuf must return every byte, not overflow.
import { fetchBuf } from './fetch-buf.js';
let fail = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${info}`); if (!ok) fail++; };
function serve(bytes, contentLength, chunk = 4096) {
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(c) { for (let i = 0; i < bytes.length; i += chunk) c.enqueue(bytes.slice(i, i + chunk)); c.close(); },
  }), { headers: contentLength == null ? {} : { 'content-length': String(contentLength) } });
}
const data = new Uint8Array(100000).map((_, i) => (i * 31) & 255);
for (const [name, cl] of [['content-length = body', data.length], ['content-length < body (gzip)', 41000], ['no content-length', null]]) {
  serve(data, cl);
  let last = 0, monotone = true;
  try {
    const buf = new Uint8Array(await fetchBuf('x.bin', f => { if (f < last) monotone = false; last = f; }));
    const same = buf.length === data.length && buf.every((v, i) => v === data[i]);
    check(name, same && monotone && last === 1 && last <= 1, `bytes ${buf.length}, last progress ${last}`);
  } catch (e) { check(name, false, String(e)); }
}
console.log(fail ? `${fail} failed` : 'all passed');
process.exit(fail ? 1 : 0);
