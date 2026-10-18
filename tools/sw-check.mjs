#!/usr/bin/env node
// ============================================================================
//  tools/sw-check.mjs — node checks of the service worker (sw.js)
// ----------------------------------------------------------------------------
//  Runs sw.js in a node vm with a fake Cache Storage, a fake fetch and a
//  small fake manifest. No browser runs.
//
//  Why: in Safari (WebKit), cache.match() gives a response with its body
//  already in memory, and the worker can run in the process of an open
//  tab. The old worker called match() on each stored file to read its
//  x-sn-hash header: on each shell load (background pass), at each install
//  (copy of the whole core cache to a new cache) and at each activate.
//  That moved some 340 MB of bodies through the tab process. The new
//  worker puts the hash in the cache key (path?sn=<hash>), so it reads
//  keys only, and body reads count only real copies.
//
//  The fake cache counts "body reads": match() calls that find an entry.
//  The checks:
//    1. first visit: install, activate, background pass download each file once
//    2. a second shell load (same version): the background pass reads no
//       body and downloads nothing
//    3. a new version with one core and one lazy file changed: install and
//       activate read no body, download only the changed core file, and
//       delete the old keys; the next background pass downloads one file
//    4. requests: a core file and a lazy file come from the cache with the
//       current bytes; a missing lazy file downloads and stays
//    5. migration from the old worker (git HEAD~ format, path keys and
//       sn-core-<version> caches): the old caches go, the content is right
//
//  Usage (repo root):
//    node tools/sw-check.mjs            check ./sw.js
//    node tools/sw-check.mjs --old REV  run the same scenarios on
//                                       git show REV:sw.js and print the
//                                       counts (a worker in the old format
//                                       fails checks 2 and 3)
//  Exit 1 on any failure.
// ============================================================================
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argOld = process.argv.indexOf('--old');
const OLD_REV = argOld > 0 ? process.argv[argOld + 1] : null;
const ORIGIN = 'https://davesgames.io';
const SCOPE = ORIGIN + '/';

let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('ok    ' + m); } else { fail++; console.log('FAIL  ' + m + (d ? '\n      ' + d : '')); } };

// ── fake Cache Storage ───────────────────────────────────────────────────────
const stats = { bodyReads: 0, downloads: 0 };
const store = new Map();          // cache name -> Map(url -> { body, headers })
const urlOf = r => (typeof r === 'string' ? new URL(r, SCOPE).href : r.url);
function makeCache(name) {
  const m = store.get(name);
  return {
    async match(r) {
      const e = m.get(urlOf(r));
      if (!e) return undefined;
      stats.bodyReads++;
      return new Response(e.body, { headers: e.headers });
    },
    async put(r, res) {
      const body = await res.text();
      m.set(urlOf(r), { body, headers: [...res.headers] });
    },
    async keys() { return [...m.keys()].map(u => new Request(u)); },
    async delete(r) { return m.delete(urlOf(r)); },
  };
}
const caches = {
  async open(n) { if (!store.has(n)) store.set(n, new Map()); return makeCache(n); },
  async keys() { return [...store.keys()]; },
  async delete(n) { return store.delete(n); },
  async has(n) { return store.has(n); },
};

// ── fake site ────────────────────────────────────────────────────────────────
// files: path -> hash. The served body is "<path>@<hash>".
let site = {};
async function fakeFetch(req) {
  const u = new URL(urlOf(req));
  const p = u.pathname.slice(1);
  if (!(p in site)) return new Response('nf', { status: 404 });
  stats.downloads++;
  return new Response(p + '@' + site[p], { status: 200, headers: { 'content-type': 'text/plain' } });
}

// ── worker instance ─────────────────────────────────────────────────────────
function loadWorker(src, version, manifest) {
  const listeners = {};
  const self = {
    location: new URL(SCOPE + 'sw.js'),
    addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
    skipWaiting: async () => {},
    clients: { claim: async () => {}, matchAll: async () => [] },
    registration: { unregister: async () => true },
  };
  const code = src.replace(/^const VERSION = '[^']*';$/m, `const VERSION = '${version}';`);
  const ctx = vm.createContext({
    self, caches, fetch: fakeFetch, Response, Request, Headers, URL, console, Map, Set, Promise,
    importScripts: () => { self.SN_OFFLINE = manifest; },
  });
  vm.runInContext(code, ctx, { filename: 'sw.js' });
  async function fire(type, extra = {}) {
    const waits = [];
    let responded = null;
    const ev = { waitUntil: p => waits.push(p), respondWith: p => { responded = p; }, ...extra };
    for (const f of listeners[type] || []) f(ev);
    await Promise.all(waits);
    return responded ? await responded : null;
  }
  return {
    install: () => fire('install'),
    activate: () => fire('activate'),
    warm: () => fire('message', { data: { type: 'sn-warm' }, ports: [] }),
    get: p => fire('fetch', { request: new Request(SCOPE + p) }),
  };
}

function manifestOf(files, lazyKeys) {
  const core = [], lazy = [];
  for (const [p, h] of Object.entries(files)) (lazyKeys.has(p) ? lazy : core).push([p, h]);
  return { version: 'x', core, lazy };
}
const reset = () => { stats.bodyReads = 0; stats.downloads = 0; };

// 40 core files and 12 lazy files.
const LAZY = new Set();
const v1 = {};
for (let i = 0; i < 40; i++) v1[`stella-nova/lib/f${i}.js`] = 'a' + i;
for (let i = 0; i < 12; i++) { const p = `stella-nova/pages/x/m${i}.bin`; v1[p] = 'b' + i; LAZY.add(p); }
const v2 = { ...v1, 'stella-nova/lib/f3.js': 'c3', 'stella-nova/pages/x/m5.bin': 'd5' };
const nCore = 40, nLazy = 12;

async function scenarios(src, label) {
  store.clear();
  console.log(`\n== ${label}`);
  // 1. first visit
  site = v1; reset();
  let w = loadWorker(src, 'v1', manifestOf(v1, LAZY));
  await w.install(); await w.activate(); await w.warm();
  ok(stats.downloads === nCore + nLazy, `${label} 1: first visit downloads each file once`, `downloads ${stats.downloads}`);
  // 2. second shell load, same version
  reset();
  w = loadWorker(src, 'v1', manifestOf(v1, LAZY));
  await w.warm();
  console.log(`      second load: ${stats.bodyReads} body reads, ${stats.downloads} downloads`);
  ok(stats.bodyReads === 0 && stats.downloads === 0, `${label} 2: a second load reads no body and downloads nothing`, `body reads ${stats.bodyReads}, downloads ${stats.downloads}`);
  // 3. new version
  site = v2; reset();
  w = loadWorker(src, 'v2', manifestOf(v2, LAZY));
  await w.install(); await w.activate();
  console.log(`      new version install+activate: ${stats.bodyReads} body reads, ${stats.downloads} downloads`);
  ok(stats.bodyReads === 0, `${label} 3: install and activate of a new version read no body`, `body reads ${stats.bodyReads}`);
  ok(stats.downloads === 1, `${label} 3: install downloads only the changed core file`, `downloads ${stats.downloads}`);
  const keyCount = [...store.values()].reduce((a, m) => a + m.size, 0);
  ok(keyCount === nCore + nLazy - 1, `${label} 3: activate keeps one entry per current file`, `entries ${keyCount}, caches ${[...store.keys()].join(',')}`);
  reset(); await w.warm();
  ok(stats.downloads === 1, `${label} 3: the next background pass downloads the changed lazy file`, `downloads ${stats.downloads}`);
  // 4. requests
  reset();
  const a = await w.get('stella-nova/lib/f3.js'), b = await w.get('stella-nova/pages/x/m5.bin');
  ok(a && (await a.text()) === 'stella-nova/lib/f3.js@c3', `${label} 4: a core file comes from the cache with the current bytes`);
  ok(b && (await b.text()) === 'stella-nova/pages/x/m5.bin@d5', `${label} 4: a lazy file comes from the cache with the current bytes`);
  ok(stats.downloads === 0, `${label} 4: no download for stored files`, `downloads ${stats.downloads}`);
  for (const m of store.values()) for (const k of [...m.keys()]) if (k.includes('m7.bin')) m.delete(k);
  reset();
  const c = await w.get('stella-nova/pages/x/m7.bin');
  ok(c && (await c.text()) === 'stella-nova/pages/x/m7.bin@b7' && stats.downloads === 1, `${label} 4: a missing lazy file downloads once`);
  reset(); await w.get('stella-nova/pages/x/m7.bin');
  ok(stats.downloads === 0, `${label} 4: then it is stored`, `downloads ${stats.downloads}`);
}

async function migration(oldSrc, newSrc) {
  store.clear();
  console.log('\n== migration from the old worker format');
  site = v1; reset();
  let w = loadWorker(oldSrc, 'v1', manifestOf(v1, LAZY));
  await w.install(); await w.activate(); await w.warm();
  site = v2; reset();
  w = loadWorker(newSrc, 'v2', manifestOf(v2, LAZY));
  await w.install(); await w.activate();
  console.log(`      migration install+activate: ${stats.bodyReads} body reads (one time), ${stats.downloads} downloads`);
  const names = [...store.keys()];
  ok(!names.some(n => /^sn-core-/.test(n)), '5: the old sn-core-<version> caches are deleted', names.join(','));
  ok(stats.downloads === 1, '5: unchanged core files are copied, not downloaded', `downloads ${stats.downloads}`);
  const a = await w.get('stella-nova/lib/f3.js'), b = await w.get('stella-nova/lib/f9.js');
  ok(a && (await a.text()) === 'stella-nova/lib/f3.js@c3' && b && (await b.text()) === 'stella-nova/lib/f9.js@a9', '5: core files serve the current bytes after migration');
  reset(); await w.warm(); w = loadWorker(newSrc, 'v2', manifestOf(v2, LAZY)); reset(); await w.warm();
  ok(stats.bodyReads === 0 && stats.downloads === 0, '5: after migration a shell load reads no body', `body reads ${stats.bodyReads}, downloads ${stats.downloads}`);
}

const cur = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
if (OLD_REV) {
  const old = execFileSync('git', ['show', OLD_REV + ':sw.js'], { cwd: ROOT, encoding: 'utf8' });
  await scenarios(old, 'old ' + OLD_REV);
} else {
  await scenarios(cur, 'sw.js');
  // The format before the hash-in-key change: the last commit whose sw.js
  // still names caches sn-core-<VERSION>.
  let oldSrc = null;
  try {
    const revs = execFileSync('git', ['log', '--format=%H', '-n', '40', '--', 'sw.js'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n');
    for (const rev of revs) {
      const s = execFileSync('git', ['show', rev + ':sw.js'], { cwd: ROOT, encoding: 'utf8' });
      if (s.includes("'sn-core-' + VERSION")) { oldSrc = s; break; }
    }
  } catch (e) {}
  if (oldSrc && oldSrc.includes("'sn-core-' + VERSION")) await migration(oldSrc, cur);
  else console.log('\nnote  no old-format sw.js in git history, migration check skipped');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
