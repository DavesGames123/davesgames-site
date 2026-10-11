// ============================================================================
//  FLY DUEL  ·  node test runner  (node tests.mjs)
// ----------------------------------------------------------------------------
//  Runs every tests/*.test.mjs file in its own node process. Each package
//  owns one test file. Exit code 1 when one file fails.
// ============================================================================
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'tests');
const files = readdirSync(dir).filter(f => f.endsWith('.test.mjs')).sort();
let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [join(dir, f)], { stdio: 'inherit' });
  console.log(`${r.status === 0 ? 'ok  ' : 'FAIL'} ${f}`);
  if (r.status !== 0) bad++;
}
console.log(`${files.length - bad}/${files.length} test files pass`);
process.exit(bad ? 1 : 0);
