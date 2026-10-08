// OUTBREAK · tests.mjs — node tests (no browser). Run: node tests.mjs
// Runs every tests/*.test.mjs. Each file exports default function (ok),
// ok(name, cond, info). One file per work package (see CONTRACT.md), so
// parallel packages do not edit the same test file.
import { readdirSync } from 'node:fs';

let fails = 0, runs = 0;
const ok = (name, cond, info = '') => { runs++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${info ? ' · ' + info : ''}`); if (!cond) fails++; };
const dir = new URL('tests/', import.meta.url);
for (const f of readdirSync(dir).filter(f => f.endsWith('.test.mjs')).sort()) {
  try { await (await import(new URL(f, dir))).default(ok); }
  catch (e) { ok(`${f}: runs`, false, e.message); }
}
if (fails) { console.log(`${fails} of ${runs} failed`); process.exit(1); }
console.log(`all ${runs} passed`);
