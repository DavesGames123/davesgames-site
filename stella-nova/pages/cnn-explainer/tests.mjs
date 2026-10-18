// CNN Explainer · tests.mjs  runs every tests/*.test.mjs and a link check.
//   NODE_PATH=<dir with jsdom>/node_modules node stella-nova/pages/cnn-explainer/tests.mjs
// page.test.mjs needs jsdom (NODE_PATH or JSDOM_DIR); without it that file
// fails, so a run without jsdom is never green.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let bad = 0;
// link check: every module of the page parses and links in node
globalThis.__cnnLink = true;
for (const f of fs.readdirSync(HERE).filter(f => f.endsWith('.js'))) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `globalThis.window={__cnnNoAutoBoot:true};await import(${JSON.stringify(pathToFileURL(path.join(HERE, f)).href)})`], { encoding: 'utf8' });
  const msg = (r.stderr || '').split('\n').find(l => /Error/.test(l)) || '';
  if (r.status !== 0 && !/ReferenceError: (document|matchMedia|localStorage|navigator) is not defined/.test(msg)) { bad++; console.log(`FAIL  link ${f}: ${msg}`); }
}
console.log(`link: ${bad ? 'FAILED' : 'every module links'}`);
for (const f of fs.readdirSync(path.join(HERE, 'tests')).filter(f => f.endsWith('.test.mjs')).sort()) {
  const r = spawnSync(process.execPath, [path.join(HERE, 'tests', f)], { encoding: 'utf8', env: process.env, timeout: 180000 });
  process.stdout.write(r.stdout.split('\n').filter(l => /^(FAIL|SKIP)|passed|reference:/.test(l)).map(l => l + '\n').join(''));
  if (r.status !== 0) { bad++; if (r.stderr) console.log(r.stderr.split('\n').slice(0, 8).join('\n')); }
}
console.log(bad ? `tests.mjs: ${bad} file(s) failed` : 'tests.mjs: all passed');
process.exitCode = bad ? 1 : 0;
