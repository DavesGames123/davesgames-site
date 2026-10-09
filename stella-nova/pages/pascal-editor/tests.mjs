// ============================================================================
//  PASCAL EDITOR  ·  pages/pascal-editor/tests.mjs — node checks of the frame
// ----------------------------------------------------------------------------
//  Run: node stella-nova/pages/pascal-editor/tests.mjs [--net]
//  Checks with no network:
//    - the head loads gpu-guard.js, then wishlist.js, then stats-beacon.js
//    - style.css has the [hidden] guard, and each element with the hidden
//      attribute has no display rule that can win over the guard
//    - a local static server returns 200 for the page and each local URL
//      that index.html and style.css name, from the sub-path of the site
//    - main.js has APP on https://editor.pascal.app/ and a 64-hex PIN.sha256
//  --net also gets the published .sha256 file of the pinned release from
//  GitHub and compares it with PIN.sha256. No browser runs.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SN = path.resolve(DIR, '../..');
const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(DIR, 'style.css'), 'utf8');
const js = fs.readFileSync(path.join(DIR, 'main.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };

// Head order.
const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1]);
ok(scripts[0] === '../../lib/gpu-guard.js', 'gpu-guard.js is the first script');
ok(scripts[1] === '../../lib/wishlist.js', 'wishlist.js is directly after gpu-guard.js');
ok(scripts[2] === '../../lib/stats-beacon.js', 'stats-beacon.js is third');

// [hidden] guard.
ok(/\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/.test(css), 'style.css has [hidden]{display:none!important}');
for (const m of html.matchAll(/<\w+[^>]*\bid="([^"]+)"[^>]*\bhidden\b[^>]*>/g)) {
  const id = m[1];
  ok(!new RegExp(`#${id}[^{]*\\{[^}]*display`).test(css), `#${id} has no id display rule to fight the guard`);
}

// Pin and hosted URL.
ok(/export const APP = 'https:\/\/editor\.pascal\.app\/'/.test(js), 'APP is the hosted editor over https');
const sha = (js.match(/sha256: '([0-9a-f]+)'/) || [])[1];
const ver = (js.match(/version: '([^']+)'/) || [])[1];
const asset = (js.match(/asset: '([^']+)'/) || [])[1];
ok(sha && sha.length === 64, 'PIN.sha256 is 64 hex digits');
ok(asset === `pascal-web-runtime-${ver}.tar.gz`, 'PIN.asset matches PIN.version');
ok(/\[hidden\]/.test(css) && !/<iframe[^>]*src=/.test(html), 'the iframe gets its src from main.js only');

// Local URLs from the sub-path, through a static server.
const local = [
  ...[...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map(m => m[1]),
  ...[...css.matchAll(/url\(["']?([^"')#:]+)/g)].map(m => m[1]),
].filter(u => !u.startsWith('//'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const p = path.join(SN, decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/^\/stella-nova\//, '/')));
  if (!p.startsWith(SN) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/stella-nova/pages/pascal-editor/`;
const urls = [base, base + 'index.html', ...local.map(u => new URL(u, base + 'index.html').href)];
for (const u of [...new Set(urls)]) {
  const r = await fetch(u.endsWith('/') ? u + 'index.html' : u);
  ok(r.status === 200, `GET ${u.replace(base, '')} -> ${r.status}`);
}
server.close();
console.log(`local URLs fetched: ${new Set(urls).size}`);

if (process.argv.includes('--net')) {
  const tag = encodeURIComponent(`@pascal-app/cli@${ver}`).replace(/%40/g, '%40');
  const u = `https://github.com/pascalorg/editor/releases/download/${tag}/${asset}.sha256`;
  const t = await (await fetch(u)).text();
  ok(t.includes(sha), `published ${asset}.sha256 matches PIN.sha256 (${t.trim().slice(0, 16)}...)`);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
