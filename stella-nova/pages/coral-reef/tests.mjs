// ============================================================================
//  CORAL REEF  ·  all node tests (no browser):  node tests.mjs
// ----------------------------------------------------------------------------
//  Runs every tests/*.test.mjs file of the page (one node process each, so
//  the packages do not share state) and prints a summary:
//    tests/scene.test.mjs ... SCENE: caustics, plot fade, saver, GLSL, boot
//    tests/coral.test.mjs ... CORAL: growth, SDF meshes, the reef worker
//    tests/rock.test.mjs .... ROCK: the rock SDF, features, meshes
//    tests/rov.test.mjs ..... ROV: paths, vehicles, the SSTV link
//    tests/gpu.test.mjs ..... SCENE: the main view passes on a fake WebGL2
//                             (tests/fake-gl.mjs), formats, exposure
//    tests/budget.test.mjs .. SCENE: device profiles, the memory model,
//                             context loss policy, the frame governor
//    tests/robust.test.mjs .. SCENE: main.js in jsdom on the fake GL
//                             (tests/page-harness.mjs): shader error box,
//                             context loss, worker fall back, phone boot
//    tests/saver-safe.test.mjs  SCENE: saver sites, safe camera, card place
//    tests/saver-page.test.mjs  SCENE: the saver end to end in jsdom
//    tests/follow.test.mjs .. SCENE: the camera follows an ROV by default
//    tests/lock.test.mjs .... CORAL, SCENE: a grown reef stays locked in while
//                             the cameras move (no fine mesh made again, one
//                             full mesh per colony in each frame)
//    tests/form.test.mjs .... CORAL: the colony form (one root per colony)
//    tests/world.test.mjs ... WORLD: the infinite seafloor field, its bound,
//                             arches and canyons, seamless chunk meshes
//    tests/stream.test.mjs .. WORLD: the worker pool, a 2 km streaming
//                             flight (bytes bounded, no leak), corals shown
//                             only grown, no grow-in, fine focus
//    tests/squad.test.mjs ... WORLD, ROV: the squad never in rock or coral,
//                             it keeps exploring, the follow camera
//    tests/size.test.mjs .... CORAL, ROV: the larger colonies (heights,
//                             extents, budgets) and the ROVs keep clear
//                             of the coral (rov/coral-field.js)
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
