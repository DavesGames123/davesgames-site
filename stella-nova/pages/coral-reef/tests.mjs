// ============================================================================
//  CORAL REEF  ·  all node tests (no browser):  node tests.mjs
// ----------------------------------------------------------------------------
//  Runs every tests/*.test.mjs file of the page (one node process each, so
//  the packages do not share state) and prints a summary:
//    tests/scene.test.mjs ... SCENE: caustics, plot fade, saver, GLSL, boot
//    tests/coral.test.mjs ... CORAL: growth, SDF meshes, the reef worker
//    tests/rock.test.mjs .... ROCK: the rock SDF, features, meshes
//    tests/rov.test.mjs ..... ROV: paths, vehicles, the SSTV link
//  The jsdom boot (mobile-check.mjs, in scene.test.mjs) needs jsdom 24:
//  give its folder as JSDOM_DIR or NODE_PATH. Without it the boot skips.
//  Exit code 1 if any file fails.
// ============================================================================
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const only = process.argv.slice(2);
const files = fs.readdirSync(path.join(HERE, 'tests')).filter(f => f.endsWith('.test.mjs') && (!only.length || only.some(o => f.includes(o)))).sort();
let bad = 0;
const rows = [];
for (const f of files) {
  const t0 = Date.now();
  let out = '', code = 0;
  try { out = execFileSync(process.execPath, [path.join(HERE, 'tests', f)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 900000, maxBuffer: 64 << 20 }); }
  catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); code = e.status ?? 1; }
  const lines = out.trim().split('\n');
  for (const l of lines) console.log(`[${f.replace('.test.mjs', '')}] ${l}`);
  const sum = lines.filter(l => /\d+ passed, \d+ failed/.test(l)).pop() || `exit ${code}`;
  rows.push(`${f.padEnd(18)} ${code ? 'FAIL' : 'ok  '} ${sum} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  if (code) bad++;
}
console.log('\n' + rows.join('\n'));
console.log(`tests: ${files.length - bad} of ${files.length} files passed`);
process.exit(bad ? 1 : 0);
