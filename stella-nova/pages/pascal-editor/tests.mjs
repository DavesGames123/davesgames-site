// ============================================================================
//  PASCAL EDITOR  ·  pages/pascal-editor/tests.mjs — node checks of the page
// ----------------------------------------------------------------------------
//  Run: node stella-nova/pages/pascal-editor/tests.mjs
//  No network, no browser. Checks:
//    - the head loads gpu-guard.js, then wishlist.js, then stats-beacon.js
//    - style.css has the [hidden] guard, and each element with the hidden
//      attribute has no display rule that can win over the guard
//    - main.js has APP on app/index.html, and no editor.pascal.app frame
//    - the pinned sha is the same in main.js, build.sh, NOTICE, BUILD.txt
//    - NOTICE and app/LICENSE.txt have the MIT text of Pascal Group Inc.
//    - app/index.html loads one module script and one stylesheet, by
//      relative paths, and sets globalThis.__SN_ENV first
//    - each new URL("x", import.meta.url) in the bundle names a file in
//      app/assets, and each "./icons/", "./audios/" path names a file
//    - the bundle has no root "/api/" request and no root icon/audio path
//    - a local static server returns 200 for the page, each local URL of
//      index.html and style.css, and each file app/index.html names
//    - app/ is under 25 MB
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SN = path.resolve(DIR, '../..');
const APPDIR = path.join(DIR, 'app');
const read = p => fs.readFileSync(path.join(DIR, p), 'utf8');
const html = read('index.html');
const css = read('style.css');
const js = read('main.js');
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

// App entry, no hosted frame.
ok(/export const APP = 'app\/index\.html'/.test(js), 'APP is app/index.html');
ok(!/editor\.pascal\.app/.test(js), 'main.js does not name editor.pascal.app');
ok(!/<iframe[^>]*src=/.test(html), 'the iframe gets its src from main.js only');
ok(!/href="https:\/\/editor\.pascal\.app/.test(html), 'index.html has no link to the hosted editor');

// Pinned sha across files.
const sha = (js.match(/sha: '([0-9a-f]{40})'/) || [])[1];
ok(!!sha, 'PIN.sha is 40 hex digits');
const build = read('build.sh');
ok(build.includes(`PIN_SHA=${sha}`), 'build.sh PIN_SHA matches PIN.sha');
const notice = read('NOTICE');
ok(notice.includes(`Built from pascalorg/editor ${sha}`), 'NOTICE names the pinned sha');
const info = fs.readFileSync(path.join(APPDIR, 'BUILD.txt'), 'utf8');
ok(info.includes(`commit    ${sha}`), 'app/BUILD.txt names the pinned sha');
const tag = (js.match(/tag: '([^']+)'/) || [])[1];
ok(build.includes(`PIN_TAG=${tag}`) && notice.includes(tag), 'tag matches in main.js, build.sh, NOTICE');

// MIT text.
const MIT = [
  'MIT License',
  'Copyright (c) 2026 Pascal Group Inc.',
  'Permission is hereby granted, free of charge, to any person obtaining a copy',
  'The above copyright notice and this permission notice shall be included in all',
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
];
const lic = fs.readFileSync(path.join(APPDIR, 'LICENSE.txt'), 'utf8');
for (const line of MIT) {
  ok(notice.includes(line), `NOTICE has "${line.slice(0, 40)}"`);
  ok(lic.includes(line), `app/LICENSE.txt has "${line.slice(0, 40)}"`);
}
ok(notice.includes('persistence changed to browser storage'), 'NOTICE states the persistence change');
ok(fs.existsSync(path.join(APPDIR, 'THIRD_PARTY_LICENSES.txt')), 'app/THIRD_PARTY_LICENSES.txt exists');
ok(!/\(UNKNOWN\)|"UNKNOWN"/.test(fs.readFileSync(path.join(APPDIR, 'THIRD_PARTY_LICENSES.txt'), 'utf8')), 'each bundled package has a known licence');

// The build entry.
const appHtml = fs.readFileSync(path.join(APPDIR, 'index.html'), 'utf8');
const mods = [...appHtml.matchAll(/<script type="module"[^>]*src="([^"]+)"/g)].map(m => m[1]);
const sheets = [...appHtml.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g)].map(m => m[1]);
ok(mods.length === 1 && mods[0].startsWith('./assets/'), `app/index.html loads one relative module (${mods})`);
ok(sheets.length === 1 && sheets[0].startsWith('./assets/'), `app/index.html loads one relative stylesheet (${sheets})`);
ok(appHtml.indexOf('globalThis.__SN_ENV') !== -1 && appHtml.indexOf('globalThis.__SN_ENV') < appHtml.indexOf('type="module"'),
  'app/index.html sets __SN_ENV before the module');

const bundleFiles = fs.readdirSync(path.join(APPDIR, 'assets')).filter(f => f.endsWith('.js'));
const bundle = bundleFiles.map(f => fs.readFileSync(path.join(APPDIR, 'assets', f), 'utf8')).join('\n');
const metaUrls = [...new Set([...bundle.matchAll(/new URL\("([^"]+)",\s*import\.meta\.url\)/g)].map(m => m[1]))];
ok(metaUrls.length > 0, `bundle has import.meta.url assets (${metaUrls.length})`);
for (const u of metaUrls) ok(fs.existsSync(path.join(APPDIR, 'assets', u)), `assets/${u} exists`);
const relPaths = [...new Set([...bundle.matchAll(/["'`]\.\/((?:icons|audios)\/[A-Za-z0-9_./-]+\.(?:webp|png|svg|mp3))["'`]/g)].map(m => m[1]))];
ok(relPaths.length > 20, `bundle names local icons and sounds (${relPaths.length})`);
let missing = relPaths.filter(p => !fs.existsSync(path.join(APPDIR, p)));
ok(missing.length === 0, `each ./icons and ./audios path exists (missing: ${missing.slice(0, 5).join(', ')})`);
ok(fs.existsSync(path.join(APPDIR, 'cursor.svg')) && bundle.includes("url('./cursor.svg')"), 'cursor.svg is local and relative');
ok(!/["'`]\/api\//.test(bundle), 'bundle has no root /api/ request');
ok(!/["'`(]\/(icons|audios)\//.test(bundle), 'bundle has no root /icons or /audios path');
ok(/__SN_ENV\.NEXT_PUBLIC_ASSETS_CDN_URL/.test(bundle), 'asset origin comes from __SN_ENV');

// Size.
let bytes = 0;
const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else bytes += fs.statSync(p).size; } };
walk(APPDIR);
ok(bytes < 25 * 1024 * 1024, `app/ is ${(bytes / 1048576).toFixed(1)} MB, under 25 MB`);

// Local URLs from the sub-path, through a static server.
const local = [
  ...[...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map(m => m[1]),
  ...[...css.matchAll(/url\(["']?([^"')#:]+)/g)].map(m => m[1]),
].filter(u => !u.startsWith('//'));
const appLocal = [...mods, ...sheets].map(u => 'app/' + u.replace(/^\.\//, ''));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const p = path.join(SN, decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/^\/stella-nova\//, '/')));
  if (!p.startsWith(SN) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/stella-nova/pages/pascal-editor/`;
const urls = [base, base + 'index.html', ...[...local, ...appLocal].map(u => new URL(u, base + 'index.html').href)];
for (const u of [...new Set(urls)]) {
  const r = await fetch(u.endsWith('/') ? u + 'index.html' : u);
  await r.arrayBuffer();
  ok(r.status === 200, `GET ${u.replace(base, '')} -> ${r.status}`);
}
server.close();
console.log(`local URLs fetched: ${new Set(urls).size}, bundle import.meta assets: ${metaUrls.length}, icon/sound paths: ${relPaths.length}`);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
