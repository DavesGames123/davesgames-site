// ============================================================================
//  DLA TERRAIN  ·  tests.mjs — every node check of the page (package CORE)
// ----------------------------------------------------------------------------
//  node stella-nova/pages/dla-terrain/tests.mjs
//    1 node --check on every .js of the page
//    2 import of the DOM-free modules; main.js and ui.js must stop only on
//      a browser global (ReferenceError), never on a SyntaxError or a
//      missing export
//    3 naga (~/.cargo/bin/naga) on every WGSL file after the join that
//      gpu.loadWGSL does: common.wgsl + lib/dla-terrain-detail.wgsl (or
//      gpu/detail-stub.wgsl) + the file. SKY's clouds.wgsl and weather.wgsl
//      compile after the SKY library (sky.wgsl up to "// @@SKY-ENTRY").
//      gpu/terrain.wgsl compiles alone. Plus a Tint rule: no mixed && and
//      || without parentheses on one line.
//    4 index.html: the head script order, the metas, [hidden] in style.css,
//      no element with the hidden attribute that style.css gives a display
//    5 no network: page code fetches only same-origin files
//    6 each tests/*.test.mjs in its own node process (CORE, GROUND, SKY,
//      WATER, VEG ...)
//  Exit code 1 when a check fails. naga missing: the WGSL step is skipped
//  and named.
//  grep -n targets: "── 1", "── 2", "── 3", "── 4", "── 5", "── 6"
// ============================================================================
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdtempSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir, homedir } from 'node:os';

const DIR = dirname(fileURLToPath(import.meta.url));
const LIB = join(DIR, '../../lib');
let pass = 0, fail = 0;
const failed = [];
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`ok ${pass + fail} ${name}`); }
  else { fail++; failed.push(name); console.log(`not ok ${pass + fail} ${name} ${extra}`); }
}
const walk = (d, ext, out = []) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { if (f !== 'node_modules' && !f.startsWith('.')) walk(p, ext, out); }
    else if (f.endsWith(ext)) out.push(p);
  }
  return out;
};
const rel = p => relative(DIR, p);

// ── 1 node --check
for (const f of walk(DIR, '.js').concat(walk(DIR, '.mjs'))) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  ok(r.status === 0, 'node --check ' + rel(f), (r.stderr || '').split('\n').slice(0, 3).join(' '));
}

// ── 2 imports
const domFree = ['gpu/globals.js', 'gpu/mat.js', 'gpu/shadows.js', 'gpu/terrain-gpu.js', 'gpu/frame.js', 'gpu/device.js', 'gpu/fallback.js',
  'gpu/sky-stub.js', 'gpu/stub-terrain.js', 'camera.js', 'saver.js', 'ui.js', 'render/post.js', 'world-state.js',
  'build.js', 'build-player.js', 'render/build.js'];
for (const f of domFree) {
  try { await import(pathToFileURL(join(DIR, f)).href); ok(true, 'import ' + f); }
  catch (e) { ok(false, 'import ' + f, e.message); }
}
for (const f of ['main.js']) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(join(DIR, f)).href)})`], { encoding: 'utf8' });
  const err = r.stderr || '';
  ok(/ReferenceError: (document|window|matchMedia|location|navigator|addEventListener) is not defined/.test(err) && !/SyntaxError|does not provide an export/.test(err), `import ${f} stops only on a browser global`, err.split('\n').find(l => /Error/.test(l)) || '');
}

// ── 3 WGSL
const NAGA = [join(homedir(), '.cargo/bin/naga')].find(p => existsSync(p));
const common = readFileSync(join(DIR, 'shaders/common.wgsl'), 'utf8');
const detailLib = join(LIB, 'dla-terrain-detail.wgsl');
const detail = existsSync(detailLib) ? readFileSync(detailLib, 'utf8') : readFileSync(join(DIR, 'gpu/detail-stub.wgsl'), 'utf8');
const detailName = existsSync(detailLib) ? 'lib/dla-terrain-detail.wgsl' : 'gpu/detail-stub.wgsl';
const prefix = common + '\n' + detail + '\n';
const tmp = mkdtempSync(join(tmpdir(), 'dla-terrain-wgsl-'));
function naga(name, text) {
  if (!NAGA) return;
  const p = join(tmp, name.replace(/[^A-Za-z0-9.]+/g, '_') + '.wgsl');
  writeFileSync(p, text);
  const r = spawnSync(NAGA, [p], { encoding: 'utf8' });
  const msg = ((r.stdout || '') + (r.stderr || '')).trim();
  ok(r.status === 0 && /Validation successful/.test(msg), `naga ${name}`, msg.split('\n').slice(0, 6).join(' | '));
}
if (!NAGA) console.log('# naga is not at ~/.cargo/bin/naga: the WGSL step did not run');
else console.log(`# naga ${NAGA}, detail = ${detailName}`);
const skyPath = join(DIR, 'shaders/sky.wgsl');
let skyLibText = null;
if (existsSync(skyPath)) {
  const s = readFileSync(skyPath, 'utf8');
  const m = s.match(/^\/\/ @@SKY-ENTRY.*$/m);
  if (m) skyLibText = prefix + s.slice(0, m.index);
}
const wgsl = walk(join(DIR, 'shaders'), '.wgsl').concat(walk(join(DIR, 'gpu'), '.wgsl'));
for (const f of wgsl) {
  const name = rel(f), body = readFileSync(f, 'utf8');
  if (name === 'shaders/common.wgsl' || name === 'gpu/detail-stub.wgsl') continue;
  if (name === 'gpu/terrain.wgsl') naga(name, body);
  else if ((name === 'shaders/clouds.wgsl' || name === 'shaders/weather.wgsl') && skyLibText) naga(name + ' (after the SKY library)', skyLibText + '\n' + body);
  else naga(name, prefix + body);
  // Tint: mixed && and || need parentheses (a crude per-line check)
  const bad = body.split('\n').map((l, i) => [l.replace(/\/\/.*$/, ''), i + 1]).filter(([l]) => /&&/.test(l) && /\|\|/.test(l) && !/\(/.test(l));
  ok(bad.length === 0, `Tint rule (&& with || needs parentheses) ${name}`, bad.map(b => 'line ' + b[1]).join(', '));
}
naga('common.wgsl + ' + detailName, prefix + '@fragment fn fs_t() -> @location(0) vec4f { return vec4f(terrainHeight(vec2f(0.0)), 0.0, 0.0, 1.0); }\n');

// ── 4 index.html and style.css
const html = readFileSync(join(DIR, 'index.html'), 'utf8');
const css = readFileSync(join(DIR, 'style.css'), 'utf8');
const head = html.slice(0, html.indexOf('</head>'));
const scripts = [...head.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
ok(JSON.stringify(scripts) === JSON.stringify(['../../lib/gpu-guard.js', '../../lib/wishlist.js', '../../lib/stats-beacon.js']), 'head scripts: gpu-guard, wishlist, stats-beacon in that order', scripts.join(', '));
ok(head.indexOf('gpu-guard.js') < head.indexOf('name="viewport"') && /viewport-fit=cover/.test(head) && /<meta name="description" content="[^"]{40,}"/.test(head), 'viewport (viewport-fit=cover) and description metas after the site scripts');
ok(head.indexOf('href="style.css"') > 0 && head.indexOf('href="style.css"') < head.indexOf('../../lib/sci.css'), 'style.css, then lib/sci.css');
ok(/<body>\s*<script>if\(window!==window\.top\)document\.documentElement\.classList\.add\('in-frame'\)<\/script>/.test(html), 'the in-frame script is first in the body');
ok(/\[hidden\]\s*\{\s*display\s*:\s*none\s*!important\s*\}/.test(css), 'style.css has [hidden]{display:none!important}');
const hiddenIds = [...html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*\bhidden\b[^>]*>/g)].map(m => m[1]);
const withDisplay = hiddenIds.filter(id => new RegExp('#' + id + '\\s*\\{[^}]*display\\s*:').test(css));
ok(withDisplay.length === 0, `elements with the hidden attribute have no display rule (${hiddenIds.join(', ')})`, withDisplay.join(', '));
ok(/type="module" src="main\.js"/.test(html), 'main.js loads as a module');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const main = readFileSync(join(DIR, 'main.js'), 'utf8') + readFileSync(join(DIR, 'ui.js'), 'utf8');
const used = [...main.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map(m => m[1]);
const missing = [...new Set(used)].filter(id => !ids.includes(id));
ok(missing.length === 0, 'every $(id) in main.js and ui.js is in index.html', missing.join(', '));

// ── 5 no network
const pageCode = walk(DIR, '.js').filter(f => !f.includes('/tests/'));
const net = [];
for (const f of pageCode) {
  const src = readFileSync(f, 'utf8').split('\n');
  src.forEach((l, i) => {
    const code = l.replace(/\/\/.*$/, '');
    if (/(fetch|import|Worker|EventSource|WebSocket)\s*\(\s*['"`]https?:/.test(code) || /new URL\(\s*['"`]https?:/.test(code) || /['"`]wss?:\/\//.test(code)) net.push(rel(f) + ':' + (i + 1));
  });
}
ok(net.length === 0, 'no network calls: page code fetches only same-origin files', net.join(', '));

// ── 6 package tests
const tests = existsSync(join(DIR, 'tests')) ? readdirSync(join(DIR, 'tests')).filter(f => f.endsWith('.test.mjs')).sort() : [];
for (const t of tests) {
  const r = spawnSync(process.execPath, [join(DIR, 'tests', t)], { encoding: 'utf8', timeout: 600000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const lines = out.split('\n');
  // TAP lines ("ok 3 ...", "not ok 4 ...") or indented ("  ok   ...", "  FAIL ...")
  const nOk = lines.filter(l => /^\s*ok\b/.test(l)).length, nBad = lines.filter(l => /^\s*(not ok|FAIL)\b/.test(l));
  for (const b of nBad) console.log('  ' + t + ': ' + b);
  ok(r.status === 0 && nBad.length === 0, `tests/${t}: ${nOk} ok, ${nBad.length} not ok`, r.status !== 0 ? 'exit ' + r.status + ' ' + (lines.filter(l => /Error/.test(l)).slice(0, 2).join(' | ')) : '');
}

console.log(`\n# dla-terrain tests: ${pass} pass, ${fail} fail`);
if (fail) { console.log('# failed: ' + failed.join('; ')); process.exitCode = 1; }
