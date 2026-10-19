// ============================================================================
//  POOL PHYSICS  ·  all node tests (no browser):  node tests.mjs
// ----------------------------------------------------------------------------
//  Runs every tests/*.test.mjs file in its own node process:
//    physics.test.mjs  the 90 and 30 deg rules, energy, slide to roll,
//                      cushions, the break, determinism, pockets
//    rules.test.mjs    legal racks, fouls, ball in hand, the 8, groups, 9-ball
//    ai.test.mjs       seeded whole games: pot rate, fouls, winners; the
//                      share of banks, kicks and combinations; the stroke
//                      error (aimed vs observed)
//    cue.test.mjs      the cue clears the rail and the balls (20000 poses);
//                      bank, kick and combination geometry
//    shot.test.mjs     predictions, the maths steps, TeX in MathJax
//    view.test.mjs     the 2D decals turn with w; the fixed contact inset
//    scene.test.mjs    the 3D table in jsdom: pockets open, contact
//                      shadows, shadow cameras, arrows from the centre, cue
//    page.test.mjs     the page in jsdom: desktop, take over and plan, no
//                      layout shift, phone order, the saver and its framing
//    online-worker.test.mjs  the room server (worker/worker.js) on a fake
//                      Durable Object runtime: password, seats, turns,
//                      versions, restart, expiry, sockets, limits
//    online-sync.test.mjs  core/netstate.js: compute, replay, snap
//    online-page.test.mjs  the Online mode in jsdom against the real
//                      Worker code: no URL, create, join, shots both
//                      ways, reload, leave
//  Needs (a missing one FAILS, it does not skip):
//    JSDOM_DIR or NODE_PATH  a folder with jsdom 24 (page, scene)
//    MATHJAX_DIR or NODE_PATH  a folder with mathjax-full 3.2.2 (shot.test.mjs)
//  node tests.mjs physics rules   runs only the files whose names match.
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
