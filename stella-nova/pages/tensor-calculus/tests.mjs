// ============================================================================
//  TENSOR CALCULUS  ·  tests.mjs  ·  run every tests/*.test.mjs  (CORE)
// ----------------------------------------------------------------------------
//  node stella-nova/pages/tensor-calculus/tests.mjs [filter]
//  Each test file runs in its own node process. The runner prints the last
//  lines of each file and a total, and exits 1 when one file fails. A
//  filter string runs only the files whose name holds it.
//  NODE_PATH passes through, so a test can find a scratchpad jsdom.
//  JSDOM_DIR and MATHJAX_DIR (node_modules folders) are added to NODE_PATH
//  for the child processes, so every package test sees the same copies.
// ============================================================================
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'tests');
const filter = process.argv[2] || '';
const files = readdirSync(dir).filter(f => f.endsWith('.test.mjs') && f.includes(filter)).sort();
const env = { ...process.env };
const extra = [env.JSDOM_DIR, env.MATHJAX_DIR].filter(Boolean);
if (extra.length) env.NODE_PATH = [...new Set([...(env.NODE_PATH || '').split(':').filter(Boolean), ...extra])].join(':');
let failed = 0;
for (const f of files) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [join(dir, f)], { encoding: 'utf8', timeout: 600000, env });
  const ok = r.status === 0;
  if (!ok) failed++;
  const out = (r.stdout || '').trim().split('\n');
  const tail = ok ? out.slice(-1) : out.slice(-25).concat((r.stderr || '').trim().split('\n').slice(-15));
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${f} (${Date.now() - t0} ms)`);
  for (const line of tail) if (line) console.log('     ' + line);
}
console.log(`${files.length - failed}/${files.length} test files pass`);
process.exit(failed ? 1 : 0);
