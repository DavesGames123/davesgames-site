// Module waterfall of em-explorer: fetch each module from the live site
// only after its importer arrived (the browser behaviour with no
// modulepreload). Dynamic imports in boot() start after main.js and its
// static graph are in. Prints the time the three packages are in.
// usage: node stella-nova/pages/em-explorer/data/perf/measure-modules.mjs [--preload]   (--preload: all at once)
import fs from 'node:fs';
import path from 'node:path';
const ROOT = new URL('../../../../..', import.meta.url).pathname.replace(/\/$/, '');
const PAGE = ROOT + '/stella-nova/pages/em-explorer';
const SITE = 'https://davesgames.io';
const preload = process.argv.includes('--preload');
const T0 = performance.now();
const t = () => Math.round(performance.now() - T0);
const urlOf = (f) => SITE + f.slice(ROOT.length);
function staticDeps(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = [];
  for (const m of src.matchAll(/^\s*(?:import|export)\s[^;'"]*?from\s*['"]([^'"]+)['"]/gm)) out.push(path.resolve(path.dirname(file), m[1]));
  for (const m of src.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)) out.push(path.resolve(path.dirname(file), m[1]));
  return out;
}
const got = new Map();
let n = 0, maxDepth = 0;
function load(file, depth = 0) {
  if (got.has(file)) return got.get(file);
  const p = (async () => {
    const r = await fetch(urlOf(file));
    await r.arrayBuffer(); n++;
    maxDepth = Math.max(maxDepth, depth);
    await Promise.all(staticDeps(file).map((d) => load(d, depth + 1)));
    return t();
  })();
  got.set(file, p);
  return p;
}
function allDeps(file, seen = new Set()) {
  if (seen.has(file)) return seen; seen.add(file);
  for (const d of staticDeps(file)) allDeps(d, seen);
  return seen;
}
const html = await (await fetch(SITE + '/stella-nova/pages/em-explorer/')).text();
console.log(`${t()} ms  index.html (${html.length} B)`);
const head = ['/stella-nova/lib/gpu-guard.js', '/stella-nova/lib/wishlist.js', '/stella-nova/lib/stats-beacon.js'];
const pk = ['catalog', 'data', 'view'].map((k) => `${PAGE}/${k}/index.js`);
if (preload) {
  const all = new Set([...allDeps(PAGE + '/main.js'), ...pk.flatMap((f) => [...allDeps(f)]), ...allDeps(PAGE + '/data/worker.js')]);
  await Promise.all([...head.map((h) => fetch(SITE + h).then((r) => r.arrayBuffer())), ...[...all].map((f) => fetch(urlOf(f)).then((r) => r.arrayBuffer()))]);
  console.log(`${t()} ms  everything (${all.size} modules) in, one wave`);
  process.exit(0);
}
// sync head scripts: each blocks the parser in turn
for (const h of head) { await (await fetch(SITE + h)).arrayBuffer(); }
console.log(`${t()} ms  three blocking head scripts`);
const tm = await load(PAGE + '/main.js');
console.log(`${t()} ms  main.js static graph in (${n} modules, depth ${maxDepth})`);
n = 0; maxDepth = 0;
const times = await Promise.all(pk.map((f) => load(f)));
console.log(`${t()} ms  catalog ${times[0]}, data ${times[1]}, view ${times[2]} (${n} more modules, depth ${maxDepth})`);
const tw = await load(PAGE + '/data/worker.js');
console.log(`${t()} ms  worker.js graph (mostly cached in a browser)`);
const ti = await (await fetch('https://storage.googleapis.com/neuroglancer-janelia-flyem-hemibrain/emdata/clahe_yz/jpeg/info')).arrayBuffer();
console.log(`${t()} ms  hemibrain info`);
